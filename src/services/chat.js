export class ChatController {
  constructor(database) {
    this.db = database;
    this.conversations = [];
    this.activePeerId = null;
  }

  async load() {
    this.conversations = await this.db.getConversations();
    return this.conversations;
  }

  getConversations() {
    return [...this.conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  getConversation(peerId) {
    return this.conversations.find(c => c.peerId === peerId);
  }

  async getMessages(peerId) {
    return this.db.getMessages(peerId);
  }

  async addMessage(peerId, text, direction = 'out', status = 'queued') {
    const conversation = this.getConversation(peerId);
    if (!conversation) throw new Error('Conversation not found.');

    const message = {
      id: crypto.randomUUID(),
      peerId,
      text,
      direction,
      createdAt: Date.now(),
      status
    };

    await this.db.saveMessage(message);
    await this.db.saveConversation({
      ...conversation,
      lastMessage: text,
      updatedAt: message.createdAt
    });
    await this.load();
    return message;
  }

  async updateMessageStatus(messageId, status) {
    const store = this.db.transaction('messages', 'readwrite');
    const existing = await this.db.request(store.get(messageId));
    if (!existing) return null;
    const updated = { ...existing, status };
    await this.db.request(store.put(updated));
    return updated;
  }
}