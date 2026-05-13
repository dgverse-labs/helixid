import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { randomBytes } from '@noble/hashes/utils';

ed25519.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => sha512(ed25519.etc.concatBytes(...m));
ed25519.etc.sha512Async = (...m: Uint8Array[]): Promise<Uint8Array> =>
  Promise.resolve(sha512(ed25519.etc.concatBytes(...m)));

const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateKeyPair(): KeyPair {
  const privateKeyBytes = randomBytes(32);
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  return {
    privateKey: Buffer.from(privateKeyBytes).toString('hex'),
    publicKey: Buffer.from(publicKeyBytes).toString('hex'),
  };
}

export function derivePublicKey(privateKeyHex: string): string {
  return Buffer.from(ed25519.getPublicKey(Buffer.from(privateKeyHex, 'hex'))).toString('hex');
}

export function signData(data: string | Uint8Array, privateKeyHex: string): string {
  const message = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return Buffer.from(ed25519.sign(message, Buffer.from(privateKeyHex, 'hex'))).toString('hex');
}

export function verifySignature(message: Uint8Array, signatureHex: string, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(
      Buffer.from(signatureHex, 'hex'),
      message,
      Buffer.from(publicKeyHex, 'hex'),
    );
  } catch {
    return false;
  }
}

export function publicKeyToMultibase(publicKeyHex: string): string {
  const publicKeyBytes = Buffer.from(publicKeyHex, 'hex');
  const prefixed = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + publicKeyBytes.length);
  prefixed.set(ED25519_MULTICODEC_PREFIX, 0);
  prefixed.set(publicKeyBytes, ED25519_MULTICODEC_PREFIX.length);
  return `z${base58BtcEncode(prefixed)}`;
}

export function multibaseToPublicKeyHex(multibase: string): string {
  if (!multibase.startsWith('z')) {
    throw new Error('Only base58btc multibase values are supported');
  }
  const decoded = base58BtcDecode(multibase.slice(1));
  return Buffer.from(decoded.slice(ED25519_MULTICODEC_PREFIX.length)).toString('hex');
}

function base58BtcEncode(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
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
  for (let i = 0; i < bytes.length && bytes[i] === 0; i += 1) result += BASE58_ALPHABET[0];
  for (let i = digits.length - 1; i >= 0; i -= 1) result += BASE58_ALPHABET[digits[i]!];
  return result;
}

function base58BtcDecode(value: string): Uint8Array {
  const bytes: number[] = [0];
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Invalid base58 character: ${char}`);
    let carry = index;
    for (let j = 0; j < bytes.length; j += 1) {
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
  while (leadingZeroes < value.length && value[leadingZeroes] === BASE58_ALPHABET[0]) leadingZeroes += 1;
  const decoded = new Uint8Array(leadingZeroes + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) decoded[decoded.length - 1 - i] = bytes[i]!;
  return decoded;
}
