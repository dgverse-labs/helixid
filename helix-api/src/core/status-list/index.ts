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

import { gzipSync, gunzipSync } from 'node:zlib';
import { VC_CONTEXTS } from '../schemas/vc.js';

export { StatusListCredentialSchema } from './schema.js';

export interface StatusListCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: {
    id: string;
    type: 'BitstringStatusList';
    statusPurpose: 'revocation';
    encodedList: string;
  };
}

/**
 * Encodes a buffer to a base64url string.
 */
function base64urlEncode(buffer: Buffer): string {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Decodes a base64url string to a buffer.
 */
function base64urlDecode(str: string): Buffer {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

/**
 * Creates a new status list bitstring (W3C Bitstring Status List).
 * Default size: 131072 bits (16KB uncompressed).
 */
export function createStatusList(size: number = 131072): string {
  const buffer = Buffer.alloc(Math.ceil(size / 8), 0);
  const compressed = gzipSync(buffer);
  return base64urlEncode(compressed);
}

/**
 * Flips a bit in the encoded status list.
 * 0 = valid, 1 = revoked.
 */
export function setBit(encodedList: string, index: number, value: 0 | 1): string {
  const compressed = base64urlDecode(encodedList);
  const buffer = gunzipSync(compressed);

  const byteIndex = Math.floor(index / 8);
  const bitIndex = index % 8;

  const byte = buffer[byteIndex];
  if (byte === undefined) throw new Error('Status list index out of bounds');

  if (value === 1) {
    buffer[byteIndex] = byte | (1 << (7 - bitIndex));
  } else {
    buffer[byteIndex] = byte & ~(1 << (7 - bitIndex));
  }

  const newCompressed = gzipSync(buffer);
  return base64urlEncode(newCompressed);
}

/**
 * Reads a bit from the encoded status list.
 */
export function getBit(encodedList: string, index: number): 0 | 1 {
  const compressed = base64urlDecode(encodedList);
  const buffer = gunzipSync(compressed);

  const byteIndex = Math.floor(index / 8);
  const bitIndex = index % 8;

  const byte = buffer[byteIndex];
  if (byte === undefined) throw new Error('Status list index out of bounds');

  const bit = (byte >> (7 - bitIndex)) & 1;
  return bit === 1 ? 1 : 0;
}

/**
 * Returns the bit capacity of an encoded status list.
 */
export function getStatusListLength(encodedList: string): number {
  const compressed = base64urlDecode(encodedList);
  const buffer = gunzipSync(compressed);
  return buffer.length * 8;
}

/**
 * Builds the W3C Bitstring Status List credential JSON.
 */
export function buildStatusListCredential(
  listId: string, 
  encodedList: string, 
  issuerDid: string, 
  apiBaseUrl: string
): StatusListCredential {
  return {
    '@context': [...VC_CONTEXTS],
    id: `${apiBaseUrl}/v1/status-list/${listId}`,
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer: issuerDid,
    validFrom: new Date().toISOString(),
    credentialSubject: {
      id: `${apiBaseUrl}/v1/status-list/${listId}#list`,
      type: 'BitstringStatusList',
      statusPurpose: 'revocation',
      encodedList
    }
  };
}
