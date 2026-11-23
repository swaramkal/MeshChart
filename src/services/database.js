const DB_NAME = 'meshchat-local';
const DB_VERSION = 2;

// Stores that hold user data and are included in export / clear.
const DATA_STORES = ['profile', 'conversations', 'messages', 'attachments'];
// The identity store holds the device's non-extractable signing key.
const ALL_STORES = [...DATA_STORES, 'identity'];

export class MeshDatabase {
  constructor() {
    this.db = null;
  }

  async open() {
    if (!('indexedDB' in globalThis)) {
      throw new Error('This browser does not support local IndexedDB storage.');
    }

    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('profile')) {
          db.createObjectStore('profile', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('conversations')) {
          db.createObjectStore('conversations', { keyPath: 'peerId' });
        }
        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'id' });
          store.createIndex('peerId', 'peerId', { unique: false });
        }
        if (!db.objectStoreNames.contains('attachments')) {
          db.createObjectStore('attachments', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('identity')) {
          db.createObjectStore('identity', { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new Error('Unable to open local database.'));
      request.onblocked = () =>
        reject(new Error('Database upgrade is blocked by another open MeshChat tab.'));
    });

    return this;
  }

  transaction(store, mode = 'readonly') {
    if (!this.db) throw new Error('Database has not been opened.');
    return this.db.transaction(store, mode).objectStore(store);
  }

  request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getProfile() {
    return (
      (await this.request(this.transaction('profile').get('self'))) ||
      { id: 'self', name: '' }
    );
  }

  async saveProfile(profile) {
    return this.request(
      this.transaction('profile', 'readwrite').put({ id: 'self', ...profile })
    );
  }

  async getIdentity() {
    return (await this.request(this.transaction('identity').get('signing'))) || null;
  }

  async saveIdentity({ privateKey, publicKey, publicKeySpki }) {
    return this.request(
      this.transaction('identity', 'readwrite').put({
        id: 'signing',
        privateKey,
        publicKey,
        publicKeySpki
      })
    );
  }

  async getConversations() {
    return this.request(this.transaction('conversations').getAll());
  }

  // touch: false keeps the existing sort time, for changes that are not new
  // activity (unread count, delivery tick on the last message).
  async saveConversation(conversation, { touch = true } = {}) {
    if (!conversation?.peerId || !conversation?.peerName) {
      throw new Error('A peer ID and display name are required.');
    }

    const previous = await this.request(
      this.transaction('conversations').get(conversation.peerId)
    );

    const merged = { ...previous, ...conversation };

    return this.request(
      this.transaction('conversations', 'readwrite').put({
        ...merged,
        updatedAt: touch
          ? Date.now()
          : (conversation.updatedAt ?? previous?.updatedAt ?? Date.now())
      })
    );
  }

  async deleteConversation(peerId) {
    if (!peerId) return;

    const messages = await this.getMessages(peerId);

    if (messages.length) {
      const store = this.transaction('messages', 'readwrite');
      await Promise.all(
        messages.map((message) => this.request(store.delete(message.id)))
      );
    }

    await this.request(
      this.transaction('conversations', 'readwrite').delete(peerId)
    );
  }

  // Moves a conversation and its messages to a new peer ID. Used when a
  // pinned contact reconnects from a different Bluetooth address.
  async mergeConversation(fromPeerId, toPeerId) {
    if (!fromPeerId || !toPeerId || fromPeerId === toPeerId) return;

    const from = await this.request(
      this.transaction('conversations').get(fromPeerId)
    );
    if (!from) return;

    const to = await this.request(
      this.transaction('conversations').get(toPeerId)
    );

    const messages = await this.getMessages(fromPeerId);

    for (const message of messages) {
      await this.saveMessage({ ...message, peerId: toPeerId });
    }

    const newer = (to?.updatedAt || 0) > (from.updatedAt || 0) ? to : from;

    await this.request(
      this.transaction('conversations', 'readwrite').put({
        ...from,
        ...to,
        peerId: toPeerId,
        lastMessage: newer?.lastMessage,
        updatedAt: Math.max(from.updatedAt || 0, to?.updatedAt || 0)
      })
    );

    await this.request(
      this.transaction('conversations', 'readwrite').delete(fromPeerId)
    );
  }

  async getMessages(peerId) {
    const store = this.transaction('messages');
    const messages = store.indexNames.contains('peerId')
      ? await this.request(store.index('peerId').getAll(peerId))
      : (await this.request(store.getAll())).filter(m => m.peerId === peerId);

    return messages.sort((a, b) => a.createdAt - b.createdAt);
  }

  async saveMessage(message) {
    if (!message?.id || !message?.peerId || typeof message.text !== 'string') {
      throw new Error('Invalid message record.');
    }

    return this.request(this.transaction('messages', 'readwrite').put(message));
  }

  async saveAttachment(file) {
    return this.request(
      this.transaction('attachments', 'readwrite').put({
        id: crypto.randomUUID(),
        ...file
      })
    );
  }

  async exportAll() {
    const [profile, conversations, messages, attachments] = await Promise.all(
      DATA_STORES.map(store => this.request(this.transaction(store).getAll()))
    );

    return {
      schemaVersion: DB_VERSION,
      exportedAt: new Date().toISOString(),
      profile,
      conversations,
      messages,
      attachments
    };
  }

  async clear() {
    await Promise.all(
      ALL_STORES.map(store =>
        this.request(this.transaction(store, 'readwrite').clear())
      )
    );

    await this.saveProfile({ name: '' });
  }
}
