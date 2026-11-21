import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { CryptoService } from '../src/services/crypto.js';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
if (!globalThis.btoa) globalThis.btoa = value => Buffer.from(value,'binary').toString('base64');
if (!globalThis.atob) globalThis.atob = value => Buffer.from(value,'base64').toString('binary');

test('ECDH peers derive compatible AES-GCM keys and decrypt', async () => {
  const alice=new CryptoService(), bob=new CryptoService();
  const a=await alice.createIdentity(), b=await bob.createIdentity();
  const [ka,kb]=await Promise.all([alice.deriveSessionKey(b.publicKey),bob.deriveSessionKey(a.publicKey)]);
  const envelope=await alice.encrypt(ka,'MeshChat secure test','peer-42');
  assert.equal(await bob.decrypt(kb,envelope,'peer-42'),'MeshChat secure test');
});
test('AES-GCM rejects modified ciphertext', async () => {
  const service=new CryptoService(); const identity=await service.createIdentity();
  const key=await service.deriveSessionKey(identity.publicKey);
  const envelope=await service.encrypt(key,'secret');
  envelope.ciphertext=envelope.ciphertext.slice(0,-4)+'AAAA';
  await assert.rejects(()=>service.decrypt(key,envelope));
});
