export * from './did.js';
export {
  generateKeyPair,
  derivePublicKey,
  publicKeyToMultibase,
  multibaseToPublicKeyHex,
  signData,
  verifySignature as verifySignatureSync,
  type KeyPair,
} from './keys.js';
export {
  base58btcDecode,
  base58btcEncode,
  hashCanonicalPayload,
  signBytes,
  toCanonicalJson,
  verifySignature,
} from './vp.js';
export * from './jwt.js';
