// Jest setup (CRA loads this file automatically before every test).
// - fake-indexeddb: a real IndexedDB implementation for the offline queue/cache tests.
// - WebCrypto + TextEncoder: jsdom has neither SubtleCrypto nor a full crypto, which
//   the offline sign-in verifier (PBKDF2) needs. Node's webcrypto is the same API.
import 'fake-indexeddb/auto';
import { TextEncoder, TextDecoder } from 'util';
import { webcrypto } from 'crypto';
import v8 from 'v8';

if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;
if (!global.crypto || !global.crypto.subtle) {
  Object.defineProperty(global, 'crypto', { value: webcrypto, configurable: true });
}
// fake-indexeddb copies stored values with structuredClone, which jsdom does not provide.
// V8's serializer performs the same deep copy for the plain data stored here.
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (value) => v8.deserialize(v8.serialize(value));
}
