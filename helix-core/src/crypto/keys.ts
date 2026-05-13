// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/curves/abstract/utils';

export interface KeyPair {
  /** Hex-encoded Ed25519 private key (32 bytes) */
  privateKey: string;
  /** Hex-encoded Ed25519 public key (32 bytes) */
  publicKey: string;
}

/**
 * Generate a new Ed25519 keypair.
 * The private key is 32 bytes of cryptographically secure random data.
 * NEVER log or transmit the private key.
 */
export function generateKeyPair(): KeyPair {
  const privateKeyBytes = ed25519.utils.randomPrivateKey();
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  return {
    privateKey: bytesToHex(privateKeyBytes),
    publicKey: bytesToHex(publicKeyBytes),
  };
}

/**
 * Derive public key from a hex-encoded private key.
 */
export function derivePublicKey(privateKeyHex: string): string {
  const publicKeyBytes = ed25519.getPublicKey(hexToBytes(privateKeyHex));
  return bytesToHex(publicKeyBytes);
}

/**
 * Sign arbitrary data (string or bytes) with an Ed25519 private key.
 * Returns hex-encoded signature (64 bytes).
 */
export function signData(data: string | Uint8Array, privateKeyHex: string): string {
  const message = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const sig = ed25519.sign(message, hexToBytes(privateKeyHex));
  return bytesToHex(sig);
}

/**
 * Verify an Ed25519 signature.
 * Catches all internal exceptions and returns false.
 */
export function verifySignature(
  message: Uint8Array,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    return ed25519.verify(hexToBytes(signatureHex), message, hexToBytes(publicKeyHex));
  } catch {
    // Treat any parsing or verification error as failure
    return false;
  }
}

/**
 * Encode raw public key bytes as multibase (base58btc, prefix 'z').
 * This is the format used in W3C DID documents for publicKeyMultibase.
 * Prepends Ed25519 multicodec prefix [0xed, 0x01].
 */
export function publicKeyToMultibase(publicKeyHex: string): string {
  const multicodecPrefix = new Uint8Array([0xed, 0x01]);
  const keyBytes = hexToBytes(publicKeyHex);
  const combined = concatBytes(multicodecPrefix, keyBytes);
  return 'z' + base58BtcEncode(combined);
}

/**
 * Decode a multibase-encoded public key back to hex.
 * Strips the 'z' prefix and the multicodec prefix.
 */
export function multibaseToPublicKeyHex(multibase: string): string {
  if (!multibase.startsWith('z')) {
    throw new Error('Only base58btc multibase (prefix z) is supported');
  }
  const decoded = base58BtcDecode(multibase.slice(1));
  // Strip 2-byte multicodec prefix [0xed, 0x01]
  return bytesToHex(decoded.slice(2));
}

// ── Base58 BTC implementation ────────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58BtcEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let num = BigInt('0x' + bytesToHex(bytes));
  let result = '';
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)]! + result;
    num = num / 58n;
  }
  for (const byte of bytes) {
    if (byte === 0) result = '1' + result;
    else break;
  }
  return result;
}

function base58BtcDecode(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);
  let num = 0n;
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx < 0) throw new Error(`Invalid base58 character: ${char}`);
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const bytes = hexToBytes(hex);
  const leadingZeros = [...str].findIndex((c) => c !== '1');
  const count = leadingZeros === -1 ? str.length : leadingZeros;
  return concatBytes(new Uint8Array(count), bytes);
}
