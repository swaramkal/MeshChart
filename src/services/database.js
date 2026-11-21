const DB_NAME = 'meshchat-local';
const DB_VERSION = 1;
const STORES = ['profile','conversations','messages','attachments'];

export class MeshDatabase {
  constructor() { this.db = null; }
  async open() {
    if (!('indexedDB' in globalThis)) throw new Error('This browser does not support local IndexedDB storage.');
    this.db = await new Promise((resolve,reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile',{keyPath:'id'});
        if (!db.objectStoreNames.contains('conversations')) db.createObjectStore('conversations',{keyPath:'peerId'});
        if (!db.objectStoreNames.contains('messages')) {
          const store=db.createObjectStore('messages',{keyPath:'id'});
          store.createIndex('peerId','peerId',{unique:false});
        }
        if (!db.objectStoreNames.contains('attachments')) db.createObjectStore('attachments',{keyPath:'id'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error || new Error('Unable to open local database.'));
      request.onblocked=()=>reject(new Error('Database upgrade is blocked by another open MeshChat tab.'));
    });
    return this;
  }
  transaction(store, mode='readonly') {
    if (!this.db) throw new Error('Database has not been opened.');
    return this.db.transaction(store,mode).objectStore(store);
  }
  request(req) { return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}); }
  async getProfile() { return (await this.request(this.transaction('profile').get('self'))) || {id:'self',name:''}; }
  async saveProfile(profile) { return this.request(this.transaction('profile','readwrite').put({id:'self',...profile})); }
  async getConversations() { return this.request(this.transaction('conversations').getAll()); }
  async saveConversation(conversation) {
    if (!conversation?.peerId || !conversation?.peerName) throw new Error('A peer ID and display name are required.');
    const previous = await this.request(this.transaction('conversations').get(conversation.peerId));
    return this.request(this.transaction('conversations','readwrite').put({...previous,...conversation,updatedAt:Date.now()}));
  }
  async getMessages(peerId) {
    const store=this.transaction('messages');
    const all=await this.request(store.getAll());
    return all.filter(m=>m.peerId===peerId).sort((a,b)=>a.createdAt-b.createdAt);
  }
  async saveMessage(message) {
    if (!message?.id || !message?.peerId || typeof message.text!=='string') throw new Error('Invalid message record.');
    return this.request(this.transaction('messages','readwrite').put(message));
  }
  async saveAttachment(file) { return this.request(this.transaction('attachments','readwrite').put({id:crypto.randomUUID(),...file})); }
  async exportAll() {
    const [profile,conversations,messages,attachments]=await Promise.all(STORES.map(s=>this.request(this.transaction(s).getAll())));
    return {schemaVersion:DB_VERSION,exportedAt:new Date().toISOString(),profile,conversations,messages,attachments};
  }
  async clear() {
    await Promise.all(STORES.map(s=>this.request(this.transaction(s,'readwrite').clear())));
    await this.saveProfile({name:''});
  }
}
