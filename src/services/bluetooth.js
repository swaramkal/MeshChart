const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export class BluetoothAdapter {
  constructor() {
    this.peers = new Map();
    this.listeners = new Set();
    this.incomingListeners = new Set();
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.messageHandler = null;
    this.native = null;
    this.nativeBound = false;
    this.advertising = false;
    this.advertisedName = '';
    this.scanning = false;
    this.roles = new Map();
  }

  getNative() {
    return globalThis.Capacitor?.Plugins?.MeshBle || null;
  }

  onPeer(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onIncomingConnection(callback) {
    this.incomingListeners.add(callback);
    return () => this.incomingListeners.delete(callback);
  }

  getPeers() {
    return [...this.peers.values()];
  }

  emit(peer) {
    for (const callback of this.listeners) callback(peer);
  }

  addPeer(peer) {
    this.peers.set(peer.id, {
      ...(this.peers.get(peer.id) || {}),
      ...peer,
      seenAt: Date.now()
    });
    this.emit(this.peers.get(peer.id));
  }

  async bindNativeEvents(native) {
    if (this.nativeBound) return;

    this.native = native;

    await native.addListener('onDeviceDiscovered', event => {
      if (!event?.deviceId) return;

      this.addPeer({
        id: event.deviceId,
        name: event.username || 'MeshPeer',
        rssi: event.rssi,
        native: true
      });
    });

    await native.addListener('onServerPeerConnected', event => {
      const id = event?.deviceId;
      if (!id) return;

      this.roles.set(id, 'server');

      const peer = {
        id,
        name: this.peers.get(id)?.name || 'Nearby MeshChat device',
        native: true,
        connected: true
      };

      this.addPeer(peer);

      for (const callback of this.incomingListeners) {
        callback(peer);
      }
    });

    await native.addListener('onPeerConnected', event => {
      const id = event?.deviceId;
      if (!id) return;

      this.roles.set(id, 'client');

      const peer = this.peers.get(id);
      if (peer) this.addPeer({ ...peer, connected: true });
    });

    await native.addListener('onPeerDisconnected', event => {
      const id = event?.deviceId;
      if (!id) return;

      this.roles.delete(id);

      const peer = this.peers.get(id);
      if (peer) this.addPeer({ ...peer, connected: false });
    });

    await native.addListener('onPacketReceived', event => {
      if (!event?.data) return;

      this.emitMessage(
        event.data,
        event.deviceId || event.senderId
      );
    });

    await native.addListener('onScanError', event => {
      console.error('MeshChat BLE scan error:', event);
    });

    await native.addListener('onAdvertiseError', event => {
      console.error('MeshChat BLE advertising error:', event);
    });

    this.nativeBound = true;
  }

  async startScan(displayName = '') {
    const native = this.getNative();

    if (native?.startScan) {
      await this.bindNativeEvents(native);

      // Each phone must advertise as well as scan.
      const safeName = String(displayName || '').trim();
      if (!this.advertising || this.advertisedName !== safeName) {
        await native.startAdvertising({ displayName: safeName });
        this.advertising = true;
        this.advertisedName = safeName;
      }

      await native.startScan({ serviceUuid: SERVICE_UUID });
      this.scanning = true;
      return;
    }

    if (!navigator.bluetooth?.requestDevice) {
      throw new Error(
        'Bluetooth discovery requires the installed Android app with native BLE support.'
      );
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID]
    });

    this.device = device;

    this.addPeer({
      id: device.id,
      name: device.name || 'MeshChat device',
      device
    });

    device.addEventListener('gattserverdisconnected', () => {
      this.server = null;
      this.characteristic = null;
    });
  }

  async updateDisplayName(displayName) {
    const native = this.getNative();
    const safeName = String(displayName || '').trim();
    if (!native?.startAdvertising || !this.advertising) return;

    // Avoid restarting the GATT server while a peer is connected.
    if (this.roles.size > 0) {
      this.advertisedName = '';
      return;
    }

    await native.startAdvertising({ displayName: safeName });
    this.advertisedName = safeName;
  }

  async connect(deviceId) {
    const peer = this.peers.get(deviceId);
    const native = this.getNative();

    if (native && peer?.native) {
      await this.bindNativeEvents(native);

      const result = await native.connect({ deviceId });

      this.roles.set(deviceId, 'client');
      this.addPeer({ ...peer, connected: true });

      return result;
    }

    if (!peer?.device) {
      throw new Error('Select a Bluetooth device discovered in this session.');
    }

    this.server = await peer.device.gatt.connect();

    const service = await this.server.getPrimaryService(SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(TX_UUID);

    await this.characteristic.startNotifications();

    this.characteristic.addEventListener(
      'characteristicvaluechanged',
      event => {
        const bytes = new Uint8Array(event.target.value.buffer);
        this.emitMessage(new TextDecoder().decode(bytes), deviceId);
      }
    );

    return true;
  }

  emitMessage(data, peerId) {
    this.messageHandler?.({ data, peerId });
  }

  onMessage(callback) {
    this.messageHandler = callback;
  }

  async send(data, deviceId) {
    const native = this.getNative();

    if (native) {
      const role = this.roles.get(deviceId);

      if (role === 'client') {
        return native.writePacket({ deviceId, data });
      }

      if (role === 'server') {
        return native.notifyPacket({ deviceId, data });
      }

      throw new Error('No active BLE connection role for this peer.');
    }

    if (!this.characteristic) {
      throw new Error('No connected Bluetooth GATT characteristic.');
    }

    const service = this.characteristic.service;
    const rx = await service.getCharacteristic(RX_UUID);
    const bytes = new TextEncoder().encode(data);

    if (bytes.length > 20) {
      throw new Error('Browser BLE transport does not support fragmentation.');
    }

    await rx.writeValueWithResponse(bytes);
  }

  async stopScan() {
    const native = this.getNative();

    if (native?.stopScan) {
      await native.stopScan();
      this.scanning = false;
    }
  }
}
