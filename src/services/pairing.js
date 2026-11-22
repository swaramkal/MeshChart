import { CryptoService } from './crypto.js';

const VERSION = 1;
const TIMEOUT_MS = 60000;
const MAX_PACKET_LENGTH = 3000;

function randomHex(bytes = 16) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map(value => value.toString(16).padStart(2, '0')).join('');
}

function validHex(value, length = 32) {
  return typeof value === 'string' &&
    value.length === length &&
    /^[0-9a-f]+$/i.test(value);
}

function makeTranscript(session) {
  return JSON.stringify([
    'MeshChat Pairing v1',
    session.sessionId,
    session.initiatorPublicKey,
    session.initiatorNonce,
    session.responderPublicKey,
    session.responderNonce
  ]);
}

export class PairingController {
  constructor(bluetooth, { onState = () => {}, onSecure = () => {} } = {}) {
    this.bluetooth = bluetooth;
    this.onState = onState;
    this.onSecure = onSecure;
    this.sessions = new Map();
    this.secureSessions = new Map();

    this.removeMessageListener = this.bluetooth.onMessage(({ data, peerId }) => {
      return this.handleMessage(data, peerId).catch(error => {
        console.warn('MeshChat pairing packet rejected:', error);
      });
    });

    this.removeDisconnectListener = this.bluetooth.onDisconnect(peerId => {
      this.cancel(peerId, 'disconnected', false);
    });
  }

  isCurrent(session) {
    return this.sessions.get(session.peerId) === session;
  }

  publish(session, status) {
    session.status = status;

    this.onState({
      peerId: session.peerId,
      peerName: session.peerName,
      role: session.role,
      status,
      verificationCode: session.material?.verificationCode || null
    });
  }

  armTimeout(session) {
    clearTimeout(session.timer);

    session.timer = setTimeout(() => {
      if (this.sessions.get(session.peerId) === session) {
        this.cancel(session.peerId, 'timeout', true);
      }
    }, TIMEOUT_MS);
  }

  async send(peerId, packet) {
    const encoded = JSON.stringify(packet);

    if (encoded.length > MAX_PACKET_LENGTH) {
      throw new Error('Pairing packet exceeds the allowed size.');
    }

    await this.bluetooth.send(encoded, peerId);
  }

  async start(peerId, peerName = 'Nearby device') {
    if (!peerId) throw new Error('A peer is required for pairing.');

    if (this.secureSessions.has(peerId)) {
      throw new Error('This peer already has a secure session.');
    }

    if (this.sessions.has(peerId)) {
      this.cancel(peerId, 'restarted', true);
    }

    const session = {
      peerId,
      peerName,
      role: 'initiator',
      sessionId: randomHex(),
      localNonce: randomHex(),
      crypto: new CryptoService(),
      material: null,
      localConfirmed: false,
      remoteConfirmed: false,
      timer: null
    };

    this.sessions.set(peerId, session);
    this.armTimeout(session);
    this.publish(session, 'negotiating');

    try {
      const identity = await session.crypto.createIdentity();

      if (!this.isCurrent(session)) {
        session.crypto.clearIdentity();
        return false;
      }

      session.localPublicKey = identity.publicKey;

      await this.send(peerId, {
        v: VERSION,
        type: 'hello',
        sessionId: session.sessionId,
        nonce: session.localNonce,
        publicKey: identity.publicKey
      });
    } catch (error) {
      if (this.isCurrent(session)) {
        this.cancel(peerId, 'failed', true);
      }
      throw error;
    }

    return true;
  }

  async handleMessage(data, peerId) {
    if (
      typeof data !== 'string' ||
      data.length === 0 ||
      data.length > MAX_PACKET_LENGTH ||
      !peerId
    ) {
      return;
    }

    let packet;

    try {
      packet = JSON.parse(data);
    } catch {
      return;
    }

    if (!packet || packet.v !== VERSION || typeof packet.type !== 'string') {
      return;
    }

    if (packet.type === 'hello') {
      await this.receiveHello(peerId, packet);
      return;
    }

    const session = this.sessions.get(peerId);

    if (!session || packet.sessionId !== session.sessionId) return;

    if (packet.type === 'ack') {
      await this.receiveAck(session, packet);
    } else if (packet.type === 'confirm') {
      await this.receiveConfirmation(session, packet);
    } else if (packet.type === 'cancel') {
      this.cancel(peerId, 'peer-cancelled', false);
    }
  }

  async receiveHello(peerId, packet) {
    if (
      !validHex(packet.sessionId) ||
      !validHex(packet.nonce) ||
      typeof packet.publicKey !== 'string' ||
      packet.publicKey.length > 4096
    ) {
      return;
    }

    const existing = this.sessions.get(peerId);

    if (existing) {
      if (existing.role !== 'initiator') return;

      // Deterministic collision handling: the lexicographically smaller
      // session ID becomes the winning initiator on both devices.
      if (existing.sessionId.toLowerCase() < packet.sessionId.toLowerCase()) {
        return;
      }

      this.discard(existing);
    }

    const session = {
      peerId,
      peerName: this.bluetooth.peers.get(peerId)?.name || 'Nearby device',
      role: 'responder',
      sessionId: packet.sessionId,
      remoteNonce: packet.nonce,
      remotePublicKey: packet.publicKey,
      crypto: new CryptoService(),
      material: null,
      localConfirmed: false,
      remoteConfirmed: false,
      timer: null
    };

    this.sessions.set(peerId, session);
    this.armTimeout(session);
    this.publish(session, 'negotiating');

    try {
      const identity = await session.crypto.createIdentity();

      if (!this.isCurrent(session)) {
        session.crypto.clearIdentity();
        return;
      }

      session.localPublicKey = identity.publicKey;
      session.localNonce = randomHex();

      session.initiatorPublicKey = packet.publicKey;
      session.initiatorNonce = packet.nonce;
      session.responderPublicKey = identity.publicKey;
      session.responderNonce = session.localNonce;

      session.material = await session.crypto.derivePairingMaterial(
        packet.publicKey,
        makeTranscript(session)
      );

      if (!this.isCurrent(session)) {
        session.crypto.clearIdentity();
        return;
      }

      await this.send(peerId, {
        v: VERSION,
        type: 'ack',
        sessionId: session.sessionId,
        nonce: session.localNonce,
        publicKey: identity.publicKey
      });

      this.publish(session, 'awaiting-confirmation');
    } catch (error) {
      if (this.isCurrent(session)) {
        this.cancel(peerId, 'failed', true);
      }
      throw error;
    }
  }

  async receiveAck(session, packet) {
    if (
      session.role !== 'initiator' ||
      session.material ||
      !validHex(packet.nonce) ||
      typeof packet.publicKey !== 'string' ||
      packet.publicKey.length > 4096
    ) {
      return;
    }

    try {
      session.initiatorPublicKey = session.localPublicKey;
      session.initiatorNonce = session.localNonce;
      session.responderPublicKey = packet.publicKey;
      session.responderNonce = packet.nonce;

      session.material = await session.crypto.derivePairingMaterial(
        packet.publicKey,
        makeTranscript(session)
      );

      if (!this.isCurrent(session)) {
        session.crypto.clearIdentity();
        return;
      }

      this.publish(session, 'awaiting-confirmation');
    } catch (error) {
      if (this.isCurrent(session)) {
        this.cancel(session.peerId, 'failed', true);
      }
      throw error;
    }
  }

  async confirmLocal(peerId) {
    const session = this.sessions.get(peerId);

    if (!session || !session.material) {
      throw new Error('Pairing is not ready for confirmation.');
    }

    if (session.localConfirmed || session.localConfirming) return;

    session.localConfirming = true;
    session.localConfirmed = true;

    try {
      const mac = await session.crypto.createConfirmationMac(
        session.material.confirmationKey,
        session.role,
        session.material.transcriptHash
      );

      if (!this.isCurrent(session)) return;

      await this.send(peerId, {
        v: VERSION,
        type: 'confirm',
        sessionId: session.sessionId,
        role: session.role,
        mac
      });

      if (!this.isCurrent(session)) return;

      session.localConfirming = false;
      this.publish(session, 'awaiting-peer-confirmation');
      await this.completeIfReady(session);
    } catch (error) {
      if (this.isCurrent(session)) {
        this.cancel(peerId, 'failed', true);
      }
      throw error;
    }
  }

  async receiveConfirmation(session, packet) {
    if (
      !session.material ||
      !['initiator', 'responder'].includes(packet.role) ||
      packet.role === session.role ||
      typeof packet.mac !== 'string'
    ) {
      return;
    }

    const valid = await session.crypto.verifyConfirmationMac(
      session.material.confirmationKey,
      packet.role,
      session.material.transcriptHash,
      packet.mac
    );

    if (!this.isCurrent(session)) return;

    if (!valid) {
      this.cancel(session.peerId, 'verification-failed', true);
      return;
    }

    session.remoteConfirmed = true;
    await this.completeIfReady(session);
  }

  async completeIfReady(session) {
    if (!session.localConfirmed || !session.remoteConfirmed) return;
    if (this.sessions.get(session.peerId) !== session) return;

    clearTimeout(session.timer);

    const secureSession = {
      sessionId: session.sessionId,
      encryptionKey: session.material.encryptionKey,
      establishedAt: Date.now(),
      peerName: session.peerName
    };

    this.secureSessions.set(session.peerId, secureSession);
    this.sessions.delete(session.peerId);
    session.crypto.clearIdentity();

    this.onState({
      peerId: session.peerId,
      peerName: session.peerName,
      role: session.role,
      status: 'secure',
      verificationCode: session.material.verificationCode
    });

    this.onSecure(session.peerId, secureSession);
  }

  discard(session) {
    clearTimeout(session.timer);
    session.crypto?.clearIdentity();

    if (this.sessions.get(session.peerId) === session) {
      this.sessions.delete(session.peerId);
    }
  }

  cancel(peerId, reason = 'cancelled', notifyPeer = true) {
    const session = this.sessions.get(peerId);

    if (session) {
      if (notifyPeer) {
        this.send(peerId, {
          v: VERSION,
          type: 'cancel',
          sessionId: session.sessionId
        }).catch(() => {});
      }

      this.discard(session);
    }

    this.secureSessions.delete(peerId);

    this.onState({
      peerId,
      status: reason,
      verificationCode: null
    });
  }

  getSecureSession(peerId) {
    return this.secureSessions.get(peerId) || null;
  }

  isSecure(peerId) {
    return this.secureSessions.has(peerId);
  }

  destroy() {
    this.removeMessageListener?.();
    this.removeDisconnectListener?.();

    for (const peerId of this.sessions.keys()) {
      this.cancel(peerId, 'destroyed', false);
    }

    for (const peerId of this.secureSessions.keys()) {
      this.secureSessions.delete(peerId);
    }
  }
}
