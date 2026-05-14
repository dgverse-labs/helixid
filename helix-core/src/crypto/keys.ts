/**
 * helix-core/src/crypto/keys.ts
 *
 * Ed25519 key utilities for DID lifecycle operations.
 * Uses @noble/ed25519 exclusively (SA-1, DP-3).
 * Private keys are NEVER logged or transmitted.
 */

import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { randomBytes } from '@noble/hashes/utils';

// Configure synchronous sha512 for @noble/ed25519 (required for sync API)
ed25519.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => sha512(ed25519.etc.concatBytes(...m));
ed25519.etc.sha512Async = (...m: Uint8Array[]): Promise<Uint8Array> =>
  Promise.resolve(sha512(ed25519.etc.concatBytes(...m)));


// Multicodec prefix for Ed25519 public key: 0xed 0x01
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);
const MULTIBASE_BASE58BTC_PREFIX = 'z';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const x = digits[i]! * 256 + carry;
      digits[i] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += BASE58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]!];
  }
  return result;
}

function base58Decode(value: string): Uint8Array {
  const bytes: number[] = [0];
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base58 character: ${char}`);
    let carry = index;
    for (let j = 0; j < bytes.length; j++) {
      const x = bytes[j]! * 58 + carry;
      bytes[j] = x & 0xff;
      carry = x >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === BASE58_ALPHABET[0]) {
    leadingZeroes++;
  }
  const decoded = new Uint8Array(leadingZeroes + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    decoded[decoded.length - 1 - i] = bytes[i]!;
  }
  return decoded;
}

export interface KeyPair {
  privateKey: string; // hex-encoded 32 bytes
  publicKey: string;  // hex-encoded 32 bytes
}

/**
 * Generate a new Ed25519 keypair.
 * Returns both keys as lowercase hex strings.
 * NEVER log or transmit the private key (SA-1).
 */
export function generateKeyPair(): KeyPair {
  const privateKeyBytes = randomBytes(32);
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  return {
    privateKey: Buffer.from(privateKeyBytes).toString('hex'),
    publicKey: Buffer.from(publicKeyBytes).toString('hex'),
  };
}

/**
 * Derive the Ed25519 public key from a hex-encoded private key.
 */
export function derivePublicKey(privateKeyHex: string): string {
  const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  return Buffer.from(publicKeyBytes).toString('hex');
}

/**
 * Sign arbitrary bytes with an Ed25519 private key.
 * Returns a hex-encoded 64-byte signature.
 */
export function signBytesSync(message: Uint8Array, privateKeyHex: string): string {
  const privateKeyBytes = Buffer.from(privateKeyHex, 'hex');
  // noble/ed25519 v2: sign works when etc.sha512Sync is configured
  const signature = ed25519.sign(message, privateKeyBytes);
  return Buffer.from(signature).toString('hex');
}

/**
 * Verify an Ed25519 signature.
 * Returns false (never throws) on malformed input.
 */
export function verifySignatureSync(
  message: Uint8Array,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const sigBytes = Buffer.from(signatureHex, 'hex');
    const pubBytes = Buffer.from(publicKeyHex, 'hex');
    return ed25519.verify(sigBytes, message, pubBytes);
  } catch {
    return false;
  }
}

/**
 * Encode an Ed25519 public key (hex) as multibase base58btc with `z` prefix
 * and Ed25519 multicodec prefix (0xed 0x01).
 */
export function publicKeyToMultibase(publicKeyHex: string): string {
  const pubBytes = Buffer.from(publicKeyHex, 'hex');
  const prefixed = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + pubBytes.length);
  prefixed.set(ED25519_MULTICODEC_PREFIX, 0);
  prefixed.set(pubBytes, ED25519_MULTICODEC_PREFIX.length);
  return MULTIBASE_BASE58BTC_PREFIX + base58Encode(prefixed);
}

/**
 * Decode a multibase base58btc string back to hex public key.
 * Strips the Ed25519 multicodec prefix.
 * Throws if prefix is not `z`.
 */
export function multibaseToPublicKeyHex(multibase: string): string {
  if (!multibase.startsWith(MULTIBASE_BASE58BTC_PREFIX)) {
    throw new Error(`Invalid multibase prefix — expected 'z', got '${multibase[0]}'`);
  }
  const decoded = base58Decode(multibase.slice(1));
  // Strip the 2-byte multicodec prefix
  const pubBytes = decoded.slice(ED25519_MULTICODEC_PREFIX.length);
  return Buffer.from(pubBytes).toString('hex');
}
