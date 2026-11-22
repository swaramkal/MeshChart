import './styles.css';
import { MeshDatabase } from './services/database.js';
import { CryptoService } from './services/crypto.js';
import { BluetoothAdapter } from './services/bluetooth.js';
import { ChatController } from './services/chat.js';
import { PairingController } from './services/pairing.js';

const $ = (selector) => document.querySelector(selector);
const db = new MeshDatabase();
const bluetooth = new BluetoothAdapter();
const cryptoService = new CryptoService();
const chat = new ChatController(db);
let activeView = 'chats';
let scanning = false;
let onboardingRequired = false;
let toastTimer;
let activePairingPeerId = null;
const pairingStates = new Map();

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2800);
}


function pairingStatusText(status) {
  const messages = {
    negotiating: 'Establishing a secure connection…',
    'awaiting-confirmation': 'Compare the six-digit code on both phones. Confirm only if they match.',
    'awaiting-peer-confirmation': 'Waiting for the other person to confirm the matching code…',
    secure: 'Secure pairing confirmed. Encrypted one-to-one messaging is ready.',
    timeout: 'Pairing timed out. Reconnect and try again.',
    failed: 'Pairing failed. Please reconnect and try again.',
    disconnected: 'Bluetooth disconnected. Pairing was cancelled.',
    'peer-cancelled': 'The other device cancelled pairing.',
    'verification-failed': 'Verification failed. Pair again.',
    cancelled: 'Pairing cancelled.',
    restarted: 'Pairing restarted.',
    destroyed: 'Pairing session ended.'
  };
  return messages[status] || `Pairing status: ${String(status || 'unknown')}`;
}

function renderPairingState(state) {
  pairingStates.set(state.peerId, state);

  if (!activePairingPeerId || activePairingPeerId === state.peerId) {
    activePairingPeerId = state.peerId;
  } else {
    return;
  }

  const dialog = $('#pairing-dialog');
  if (!dialog) return;

  $('#pairing-peer-name').textContent = state.peerName || 'Nearby device';
  $('#pairing-status').textContent = pairingStatusText(state.status);
  $('#pairing-code').textContent = state.verificationCode || '------';
  $('#pairing-code-wrap').classList.toggle('hidden', !state.verificationCode);

  const terminal = [
    'secure', 'timeout', 'failed', 'disconnected',
    'peer-cancelled', 'verification-failed', 'cancelled',
    'restarted', 'destroyed'
  ].includes(state.status);

  $('#pairing-confirm').classList.toggle(
    'hidden', state.status !== 'awaiting-confirmation'
  );
  $('#pairing-cancel').textContent = terminal ? 'Close' : 'Cancel pairing';

  if (!dialog.open) dialog.showModal();
}

const pairing = new PairingController(bluetooth, {
  onState: renderPairingState,
  onSecure: (peerId) => {
    toast('Secure pairing confirmed. Encrypted chat is ready.');
    if (chat.activePeerId === peerId) {
      $('#conversation-status').textContent = 'Secure paired · encrypted chat';
    }
  }
});

// Encrypt every chat payload using the key established by verified pairing.
async function sendSecurePayload(peerId, payload) {
  const session = pairing.getSecureSession(peerId);
  if (!session || !session.sessionId || !session.encryptionKey) {
    throw new Error('Secure pairing is required before sending messages.');
  }

  const additionalData = `MeshChat message v1:${session.sessionId}`;
  const encrypted = await cryptoService.encrypt(
    session.encryptionKey,
    JSON.stringify(payload),
    additionalData
  );

  const packet = JSON.stringify({
    v: 1,
    type: 'message',
    sessionId: session.sessionId,
    encrypted
  });

  if (new TextEncoder().encode(packet).length > 2900) {
    throw new Error('Message is too large for the current Bluetooth transport.');
  }

  return bluetooth.send(packet, peerId);
}


function initials(name = '?') {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function setView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach((el) =>
    el.classList.toggle('active', el.id === `view-${view}`)
  );
  document.querySelectorAll('.nav-link').forEach((el) =>
    el.classList.toggle('active', el.dataset.view === view)
  );
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
}


function renderChatList() {
  const chats = chat.getConversations();
  $('#chat-count').textContent = String(chats.length);

  const query = $('#chat-search').value.trim().toLowerCase();
  const filtered = chats.filter((c) =>
    String(c.peerName || '').toLowerCase().includes(query)
  );

  $('#chat-list').innerHTML = filtered.length
    ? filtered.map((c) => `
      <button class="chat-item ${chat.activePeerId === c.peerId ? 'selected' : ''}"
        data-peer="${escapeHTML(c.peerId)}">
        <span class="avatar">${escapeHTML(initials(c.peerName))}</span>
        <span class="chat-item-copy">
          <strong>${escapeHTML(c.peerName)}</strong>
          <small>${escapeHTML(c.lastMessage || 'Start a conversation')}</small>
        </span>
        <small class="chat-time">${
          c.updatedAt
            ? new Date(c.updatedAt).toLocaleTimeString([], {
                hour: '2-digit', minute: '2-digit'
              })
            : ''
        }</small>
      </button>
    `).join('')
    : '<div class="empty-small">No conversations found.</div>';

  document.querySelectorAll('.chat-item').forEach((el) =>
    el.addEventListener('click', () => openConversation(el.dataset.peer))
  );
}


async function renderMessages() {
  const peerId = chat.activePeerId;
  if (!peerId) return;

  const messages = await chat.getMessages(peerId);
  const statusLabel = (status) => {
    if (status === 'delivered') return ' · delivered';
    if (status === 'sent') return ' · sent';
    if (status === 'failed') return ' · failed';
    if (status === 'queued') return ' · sending';
    return '';
  };

  $('#message-list').innerHTML = messages.length
    ? messages.map((m) => `
      <div class="message-row ${m.direction === 'out' ? 'outgoing' : 'incoming'}">
        <div class="message-bubble">
          ${escapeHTML(m.text)}
          <small>${new Date(m.createdAt).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit'
          })}${statusLabel(m.status)}</small>
        </div>
      </div>
    `).join('')
    : '<div class="conversation-empty">This is the beginning of your conversation.</div>';

  $('#message-list').scrollTop = $('#message-list').scrollHeight;
}


async function openConversation(peerId) {
  const conversation = chat.getConversation(peerId);
  if (!conversation) return;

  chat.activePeerId = peerId;
  $('#welcome-panel').classList.add('hidden');
  $('#conversation-panel').classList.remove('hidden');
  $('#conversation-name').textContent = conversation.peerName;
  $('#conversation-avatar').textContent = initials(conversation.peerName);

  $('#conversation-status').textContent = pairing.isSecure(peerId)
    ? 'Secure paired · encrypted chat'
    : conversation.connected
      ? 'Connected nearby · pairing required'
      : 'Saved conversation · not connected';

  await renderMessages();
  renderChatList();
  setView('chats');
}


function renderPeers(peers) {
  $('#peer-count').textContent =
    `${peers.length} device${peers.length === 1 ? '' : 's'}`;

  $('#peer-list').innerHTML = peers.length
    ? peers.map((p) => `
      <div class="peer-item">
        <span class="avatar">${escapeHTML(initials(p.name))}</span>
        <div class="peer-copy">
          <strong>${escapeHTML(p.name)}</strong>
          <small>${escapeHTML(p.id)}</small>
        </div>
        <span class="peer-signal">Nearby</span>
        <button class="secondary-button connect-peer"
          data-peer="${escapeHTML(p.id)}"
          data-name="${escapeHTML(p.name)}">Connect</button>
      </div>
    `).join('')
    : '<div class="empty-state">No devices discovered yet.</div>';

  document.querySelectorAll('.connect-peer').forEach((button) =>
    button.addEventListener('click', async () => {
      const peer = {
        id: button.dataset.peer,
        name: button.dataset.name
      };

      try {
        await bluetooth.connect(peer.id);
        await db.saveConversation({
          peerId: peer.id,
          peerName: peer.name,
          connected: true
        });
        await chat.load();

        activePairingPeerId = peer.id;
        await pairing.start(peer.id, peer.name);

        renderChatList();
        await openConversation(peer.id);
        toast('Connected. Compare the verification codes on both phones.');
      } catch (error) {
        toast(error.message || 'Bluetooth connection failed.');
      }
    })
  );
}

async function refreshProfile() {
  const profile = await db.getProfile();
  const name = (profile.name || '').trim();
  $('#profile-name').textContent = name || 'Set your name';
  $('.avatar-self').textContent = initials(name || '?');
  $('#name-field').value = name;
  $('#profile-edit').title = 'Edit profile';
  return { ...profile, name };
}

function openProfileDialog(firstLaunch = false) {
  onboardingRequired = firstLaunch;
  const dialog = $('#profile-dialog');
  dialog.querySelectorAll('[value="cancel"]').forEach((button) => {
    button.style.display = firstLaunch ? 'none' : '';
  });
  dialog.querySelector('h2').textContent = firstLaunch
    ? 'Welcome to MeshChat'
    : 'Edit your profile';
  $('#name-field').required = true;
  if (!dialog.open) dialog.showModal();
  $('#name-field').focus();
}

async function saveProfile(event) {
  event.preventDefault();
  const name = $('#name-field').value.trim();
  if (!name) return;
  await db.saveProfile({ name });
  onboardingRequired = false;
  $('#profile-dialog').querySelectorAll('[value="cancel"]').forEach((button) => {
    button.style.display = '';
  });
  $('#profile-dialog').close();
  await refreshProfile();

  try {
    await bluetooth.updateDisplayName(name);
  } catch (error) {
    console.warn('Unable to refresh BLE display name:', error);
    toast('Name saved. It will be advertised on the next discovery scan.');
    return;
  }

  toast('Profile saved on this device.');
}

async function init() {
  await db.open();
  const savedProfile = await refreshProfile();
  await chat.load();
  renderChatList();
  $('#network-state').textContent = 'Ready · offline mode';
  $('#top-status').textContent = 'Offline-ready · No internet required';
  $('#profile-edit').addEventListener('click', () => openProfileDialog(false));
  $('#settings-profile').addEventListener('click', () => openProfileDialog(false));
  $('#profile-form').addEventListener('submit', saveProfile);
  $('#profile-dialog').addEventListener('cancel', (event) => {
    if (onboardingRequired) event.preventDefault();
  });
  $('#chat-search').addEventListener('input', renderChatList);
  $('#discover-cta').addEventListener('click', () => {
    setView('nearby');
    startScan();
  });
  $('#scan-button').addEventListener('click', startScan);
  $('#learn-more').addEventListener('click', () => $('#info-dialog').showModal());
  $('#conversation-info').addEventListener('click', () => $('#info-dialog').showModal());
  $('#back-chats').addEventListener('click', () => {
    chat.activePeerId = null;
    $('#conversation-panel').classList.add('hidden');
    $('#welcome-panel').classList.remove('hidden');
  });
  $('#message-form').addEventListener('submit', sendMessage);
  $('#attach-button').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', handleFile);
  $('#theme-toggle').addEventListener('click', () => {
    document.documentElement.classList.toggle('light');
    localStorage.setItem(
      'meshchat-theme',
      document.documentElement.classList.contains('light') ? 'light' : 'dark'
    );
  });
  if (localStorage.getItem('meshchat-theme') === 'light')
    document.documentElement.classList.add('light');
  document.querySelectorAll('.nav-link').forEach((el) =>
    el.addEventListener('click', () => setView(el.dataset.view))
  );
  $('#export-data').addEventListener('click', exportData);
  $('#clear-data').addEventListener('click', clearData);
  $('#mobile-menu')?.addEventListener('click', () =>
    document.querySelector('.sidebar')?.classList.toggle('mobile-open')
  );
  bluetooth.onPeer((peer) => renderPeers(bluetooth.getPeers()));


  $('#pairing-confirm').addEventListener('click', async () => {
    if (!activePairingPeerId) return;

    const button = $('#pairing-confirm');
    button.disabled = true;
    try {
      await pairing.confirmLocal(activePairingPeerId);
    } catch (error) {
      toast(error.message || 'Unable to confirm pairing.');
    } finally {
      button.disabled = false;
    }
  });

  $('#pairing-cancel').addEventListener('click', () => {
    const peerId = activePairingPeerId;
    const state = peerId ? pairingStates.get(peerId) : null;
    const terminal = state && [
      'secure', 'timeout', 'failed', 'disconnected',
      'peer-cancelled', 'verification-failed', 'cancelled',
      'restarted', 'destroyed'
    ].includes(state.status);

    if (peerId && !terminal) pairing.cancel(peerId, 'cancelled', true);
    $('#pairing-dialog').close();
    activePairingPeerId = null;
  });

  $('#pairing-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    $('#pairing-cancel').click();
  });

  bluetooth.onIncomingConnection(async (peer) => {
    try {
      await db.saveConversation({
        peerId: peer.id,
        peerName: peer.name || 'Nearby MeshChat device',
        connected: true,
      });
      await chat.load();
      renderChatList();
      toast('A nearby MeshChat device connected.');
    } catch (error) {
      console.error('Unable to save incoming peer:', error);
    }
  });


  // Only accept encrypted chat packets from an established pairing session.
  bluetooth.onMessage(async ({ data, peerId }) => {
    if (!data || !peerId) return;

    try {
      let packet;
      try {
        packet = JSON.parse(data);
      } catch {
        return; // Never display legacy plaintext packets.
      }

      if (packet?.v !== 1 || packet.type !== 'message') return;

      const session = pairing.getSecureSession(peerId);
      if (!session || packet.sessionId !== session.sessionId) return;

      const additionalData = `MeshChat message v1:${session.sessionId}`;
      const plaintext = await cryptoService.decrypt(
        session.encryptionKey,
        packet.encrypted,
        additionalData
      );

      const payload = JSON.parse(plaintext);

      if (payload?.kind === 'ack' && typeof payload.id === 'string') {
        await chat.updateMessageStatus(payload.id, 'delivered');
        if (chat.activePeerId === peerId) await renderMessages();
        renderChatList();
        return;
      }

      if (
        payload?.kind !== 'text' ||
        typeof payload.id !== 'string' ||
        typeof payload.text !== 'string' ||
        !payload.text.trim()
      ) {
        return;
      }

      let conversation = chat.getConversation(peerId);
      if (!conversation) {
        const known = bluetooth.getPeers().find((p) => p.id === peerId);
        await db.saveConversation({
          peerId,
          peerName: known?.name || 'Nearby MeshChat device',
          connected: true
        });
        await chat.load();
      }

      await chat.addMessage(peerId, payload.text, 'in', 'delivered');

      // Send a cryptographically protected receipt to the sender.
      await sendSecurePayload(peerId, {
        kind: 'ack',
        id: payload.id
      });

      if (chat.activePeerId === peerId) await renderMessages();
      renderChatList();
    } catch (error) {
      console.error('Encrypted message processing failed:', error);
    }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:')
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {});

  if (!savedProfile.name) {
    openProfileDialog(true);
  }
}

async function startScan() {
  if (scanning) {
    await bluetooth.stopScan();
    scanning = false;
    $('#scan-button').textContent = 'Start discovery';
    $('#discovery-title').textContent = 'Discovery paused';
    return;
  }
  try {
    const profile = await db.getProfile();
    await bluetooth.startScan(profile.name || 'MeshChat');
    scanning = true;
    $('#scan-button').textContent = 'Stop discovery';
    $('#discovery-title').textContent = 'Looking for devices…';
    $('#discovery-description').textContent =
      'Keep this screen open while MeshChat searches nearby.';
  } catch (error) {
    toast(error.message || 'Bluetooth discovery is unavailable in this browser.');
    $('#discovery-description').textContent =
      'Use the Android app on a supported device to enable native Bluetooth discovery.';
  }
}


async function sendMessage(event) {
  event.preventDefault();

  const text = $('#message-input').value.trim();
  const peerId = chat.activePeerId;
  if (!text || !peerId) return;

  if (!pairing.isSecure(peerId)) {
    toast('Pair and verify this device before sending messages.');
    return;
  }

  // Leave room for JSON and AES-GCM overhead in the BLE packet limit.
  if (new TextEncoder().encode(text).length > 1400) {
    toast('Message is too long for this development build.');
    return;
  }

  const message = await chat.addMessage(peerId, text, 'out', 'queued');
  $('#message-input').value = '';

  // Set sent before transport so a fast encrypted acknowledgement cannot be overwritten.
  await chat.updateMessageStatus(message.id, 'sent');
  await renderMessages();
  renderChatList();

  try {
    await sendSecurePayload(peerId, {
      kind: 'text',
      id: String(message.id),
      text
    });
    toast('Encrypted message sent. Waiting for receipt…');
  } catch (error) {
    console.error('Encrypted BLE send failed:', error);
    await chat.updateMessageStatus(message.id, 'failed');
    await renderMessages();
    toast(error.message || 'Message could not be sent.');
  }
}

async function handleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    toast('For this build, local attachments are limited to 10 MB.');
    return;
  }
  await db.saveAttachment({
    name: file.name,
    type: file.type,
    size: file.size,
    createdAt: Date.now(),
  });
  toast(`Attachment "${file.name}" recorded locally. Peer transfer is not enabled yet.`);
  event.target.value = '';
}

async function exportData() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'meshchat-local-data.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function clearData() {
  if (!confirm('Delete all MeshChat local data from this device? This cannot be undone.'))
    return;
  await db.clear();
  await chat.load();
  chat.activePeerId = null;
  $('#conversation-panel').classList.add('hidden');
  $('#welcome-panel').classList.remove('hidden');
  await refreshProfile();
  renderChatList();
  renderPeers([]);
  openProfileDialog(true);
  toast('Local data cleared.');
}

init().catch((error) => {
  console.error(error);
  toast(`Startup error: ${error.message}`);
});