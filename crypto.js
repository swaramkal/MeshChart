const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class CryptoService {
  constructor() { this.keyPair = null; }
  supported() { return Boolean(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues); }
  async createIdentity() {
    if (!this.supported()) throw new Error('Web Crypto is not available. Use HTTPS or the Android application.');
    this.keyPair = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);
    const publicKey = await crypto.subtle.exportKey('spki',this.keyPair.publicKey);
    return {algorithm:'ECDH-P256',publicKey:this.toBase64(publicKey)};
  }
  async importPeerPublicKey(encoded) {
    const bytes=this.fromBase64(encoded);
    return crypto.subtle.importKey('spki',bytes,{name:'ECDH',namedCurve:'P-256'},false,[]);
  }
  async deriveSessionKey(peerPublicKey) {
    if (!this.keyPair) throw new Error('Create a local identity before deriving a session key.');
    const peer=await this.importPeerPublicKey(peerPublicKey);
    return crypto.subtle.deriveKey({name:'ECDH',public:peer},this.keyPair.privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async encrypt(key, plaintext, additionalData='') {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(additionalData)},key,encoder.encode(plaintext));
    return {algorithm:'AES-256-GCM',iv:this.toBase64(iv),ciphertext:this.toBase64(ciphertext)};
  }
  async decrypt(key, envelope, additionalData='') {
    if (envelope?.algorithm!=='AES-256-GCM') throw new Error('Unsupported encrypted message format.');
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:this.fromBase64(envelope.iv),additionalData:encoder.encode(additionalData)},key,this.fromBase64(envelope.ciphertext));
    return decoder.decode(plaintext);
  }
  toBase64(buffer) {
    const bytes=new Uint8Array(buffer); let binary='';
    for (let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return btoa(binary);
  }
  fromBase64(value) {
    if (typeof value!=='string' || value.length>2_000_000) throw new Error('Invalid encoded data.');
    const binary=atob(value); const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    return bytes;
  }
}
