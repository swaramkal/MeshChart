import './styles.css';
import { MeshDatabase } from './services/database.js';
import { CryptoService } from './services/crypto.js';
import { BluetoothAdapter } from './services/bluetooth.js';
import { ChatController } from './services/chat.js';

const $ = (selector) => document.querySelector(selector);
const db = new MeshDatabase();
const bluetooth = new BluetoothAdapter();
const cryptoService = new CryptoService();
const chat = new ChatController(db);
let activeView = 'chats';
let scanning = false;
let toastTimer;

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2800);
}
function initials(name='?') { return name.trim().slice(0,1).toUpperCase() || '?'; }
function escapeHTML(value='') {
  return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function setView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
  document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
}
function renderChatList() {
  const chats = chat.getConversations();
  $('#chat-count').textContent = String(chats.length);
  const query = $('#chat-search').value.trim().toLowerCase();
  const filtered = chats.filter(c => c.peerName.toLowerCase().includes(query));
  $('#chat-list').innerHTML = filtered.length ? filtered.map(c => `<button class="chat-item ${chat.activePeerId===c.peerId?'selected':''}" data-peer="${escapeHTML(c.peerId)}"><span class="avatar">${escapeHTML(initials(c.peerName))}</span><span class="chat-item-copy"><strong>${escapeHTML(c.peerName)}</strong><small>${escapeHTML(c.lastMessage || 'Start a conversation')}</small></span><small class="chat-time">${c.updatedAt ? new Date(c.updatedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}</small></button>`).join('') : '<div class="empty-small">No conversations found.</div>';
  document.querySelectorAll('.chat-item').forEach(el => el.addEventListener('click', () => openConversation(el.dataset.peer)));
}
async function renderMessages() {
  const peerId = chat.activePeerId;
  if (!peerId) return;
  const messages = await chat.getMessages(peerId);
  $('#message-list').innerHTML = messages.length ? messages.map(m => `<div class="message-row ${m.direction==='out'?'outgoing':'incoming'}"><div class="message-bubble">${escapeHTML(m.text)}<small>${new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}${m.status==='queued'?' · queued locally':''}</small></div></div>`).join('') : '<div class="conversation-empty">This is the beginning of your conversation.</div>';
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
  $('#conversation-status').textContent = conversation.connected ? 'Connected nearby' : 'Saved conversation · not connected';
  await renderMessages(); renderChatList(); setView('chats');
}
function renderPeers(peers) {
  $('#peer-count').textContent = `${peers.length} device${peers.length===1?'':'s'}`;
  $('#peer-list').innerHTML = peers.length ? peers.map(p => `<div class="peer-item"><span class="avatar">${escapeHTML(initials(p.name))}</span><div class="peer-copy"><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(p.id)}</small></div><span class="peer-signal">Nearby</span><button class="secondary-button connect-peer" data-peer="${escapeHTML(p.id)}" data-name="${escapeHTML(p.name)}">Connect</button></div>`).join('') : '<div class="empty-state">No devices discovered yet.</div>';
  document.querySelectorAll('.connect-peer').forEach(button => button.addEventListener('click', async () => {
    const peer = { id: button.dataset.peer, name: button.dataset.name };
    try {
      await bluetooth.connect(peer.id);
      await db.saveConversation({
        peerId: peer.id,
        peerName: peer.name,
        connected: true
      });
      await chat.load();
      toast('Bluetooth connected. Secure chat handshake is not enabled yet; messages remain local.');
      renderChatList();
      openConversation(peer.id);
    } catch (error) { toast(error.message); }
  }));
}
async function refreshProfile() {
  const profile = await db.getProfile();
  $('#profile-name').textContent = profile.name;
  $('#name-field').value = profile.name;
  $('#profile-edit').title = 'Edit profile';
}
async function saveProfile(event) {
  event.preventDefault();
  const name = $('#name-field').value.trim();
  if (!name) return;
  await db.saveProfile({name});
  $('#profile-dialog').close();
  await refreshProfile();
  toast('Profile saved on this device.');
}
async function init() {
  await db.open();
  await refreshProfile();
  await chat.load();
  renderChatList();
  $('#network-state').textContent = 'Ready · offline mode';
  $('#top-status').textContent = 'Offline-ready · No internet required';
  $('#profile-edit').addEventListener('click', () => $('#profile-dialog').showModal());
  $('#settings-profile').addEventListener('click', () => $('#profile-dialog').showModal());
  $('#profile-form').addEventListener('submit', saveProfile);
  $('#chat-search').addEventListener('input', renderChatList);
  $('#discover-cta').addEventListener('click', () => { setView('nearby'); startScan(); });
  $('#scan-button').addEventListener('click', startScan);
  $('#learn-more').addEventListener('click', () => $('#info-dialog').showModal());
  $('#conversation-info').addEventListener('click', () => $('#info-dialog').showModal());
  $('#back-chats').addEventListener('click', () => { chat.activePeerId=null; $('#conversation-panel').classList.add('hidden'); $('#welcome-panel').classList.remove('hidden'); });
  $('#message-form').addEventListener('submit', sendMessage);
  $('#attach-button').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', handleFile);
  $('#theme-toggle').addEventListener('click', () => { document.documentElement.classList.toggle('light'); localStorage.setItem('meshchat-theme', document.documentElement.classList.contains('light')?'light':'dark'); });
  if (localStorage.getItem('meshchat-theme')==='light') document.documentElement.classList.add('light');
  document.querySelectorAll('.nav-link').forEach(el => el.addEventListener('click', () => setView(el.dataset.view)));
  $('#export-data').addEventListener('click', exportData);
  $('#clear-data').addEventListener('click', clearData);
  $('#mobile-menu')?.addEventListener('click', () => document.querySelector('.sidebar')?.classList.toggle('mobile-open'));
  bluetooth.onPeer(peer => renderPeers(bluetooth.getPeers()));

  bluetooth.onIncomingConnection(async peer => {
    try {
      await db.saveConversation({
        peerId: peer.id,
        peerName: peer.name || 'Nearby MeshChat device',
        connected: true
      });
      await chat.load();
      renderChatList();
      toast('A nearby MeshChat device connected.');
    } catch (error) {
      console.error('Unable to save incoming peer:', error);
    }
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(()=>{});
}
async function startScan() {
  if (scanning) {
    await bluetooth.stopScan(); scanning=false; $('#scan-button').textContent='Start discovery'; $('#discovery-title').textContent='Discovery paused'; return;
  }
  try {
    await bluetooth.startScan();
    scanning=true;
    $('#scan-button').textContent='Stop discovery';
    $('#discovery-title').textContent='Looking for devices…';
    $('#discovery-description').textContent='Keep this screen open while MeshChat searches nearby.';
  } catch (error) {
    toast(error.message || 'Bluetooth discovery is unavailable in this browser.');
    $('#discovery-description').textContent='Use the Android app on a supported device to enable native Bluetooth discovery.';
  }
}
async function sendMessage(event) {
  event.preventDefault();
  const text = $('#message-input').value.trim();
  if (!text || !chat.activePeerId) return;
  await chat.addMessage(chat.activePeerId, text, 'out');
  $('#message-input').value='';
  await renderMessages(); renderChatList();
  toast('Saved locally. Peer delivery is unavailable until a secure transport session is established.');
}
async function handleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('For this build, local attachments are limited to 10 MB.'); return; }
  await db.saveAttachment({name:file.name,type:file.type,size:file.size,createdAt:Date.now()});
  toast(`Attachment "${file.name}" recorded locally. Peer transfer is not enabled yet.`);
  event.target.value='';
}
async function exportData() {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='meshchat-local-data.json'; a.click(); URL.revokeObjectURL(url);
}
async function clearData() {
  if (!confirm('Delete all MeshChat local data from this device? This cannot be undone.')) return;
  await db.clear(); await chat.load(); chat.activePeerId=null;
  $('#conversation-panel').classList.add('hidden'); $('#welcome-panel').classList.remove('hidden');
  await refreshProfile(); renderChatList(); renderPeers([]);
  toast('Local data cleared.');
}
init().catch(error => { console.error(error); toast(`Startup error: ${error.message}`); });
