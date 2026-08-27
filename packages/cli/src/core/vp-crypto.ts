import { sha256 } from '@noble/hashes/sha2';
import { sha512 } from '@noble/hashes/sha512';
import { utf8ToBytes } from '@noble/hashes/utils';
import * as ed25519 from '@noble/ed25519';
import { normalizeEd25519PrivateKey } from './keys.js';

ed25519.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => sha512(ed25519.etc.concatBytes(...m));
/* v8 ignore next */
ed25519.etc.sha512Async = (...m: Uint8Array[]): Promise<Uint8Array> => Promise.resolve(sha512(ed25519.etc.concatBytes(...m)));

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function toCanonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function hashCanonicalPayload(payload: unknown): Uint8Array {
  const canonical = toCanonicalJson(payload);
  return sha256(utf8ToBytes(canonical));
}

export async function signBytes(hashBytes: Uint8Array, privateKeyHex: string): Promise<string> {
  const signature = await ed25519.sign(hashBytes, normalizeEd25519PrivateKey(privateKeyHex));
  return Buffer.from(signature).toString('hex');
}

export async function verifySignature(
  hashBytes: Uint8Array,
  signatureHex: string,
  publicKeyHex: string
): Promise<boolean> {
  return ed25519.verify(signatureHex, hashBytes, publicKeyHex);
}

export function base58btcEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '';
  }

  const digits = [0];
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
  for (let i = 0; i < bytes.length && bytes[i] === 0; i += 1) {
    result += ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    result += ALPHABET[digits[i]!];
  }
  return result;
}

export function base58btcDecode(value: string): Uint8Array {
  if (value.length === 0) {
    return new Uint8Array();
  }

  const bytes = [0];
  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error('Invalid base58 string');
    }

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
  while (leadingZeroes < value.length && value[leadingZeroes] === ALPHABET[0]) {
    leadingZeroes += 1;
  }

  const decoded = new Uint8Array(leadingZeroes + bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    decoded[decoded.length - 1 - i] = bytes[i]!;
  }
  return decoded;
}
