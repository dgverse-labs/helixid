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
//
// Duplicated verbatim from helix-core's status-list/schema.ts +
// status-list/index.ts (see docs/proposal-retire-core-package.md). Used by
// the CLI's local/offline issuer-ops flow (no API call involved).

import { z } from 'zod';
import { gzipSync, gunzipSync } from 'node:zlib';
import { VC_CONTEXTS } from './schemas/vc.js';

export const StatusListCredentialSchema = z.object({
  '@context': z.array(z.string()).min(1),
  id: z.string(),
  type: z.array(z.string()),
  issuer: z.string(),
  validFrom: z.string(),
  credentialSubject: z.object({
    id: z.string(),
    type: z.literal('BitstringStatusList'),
    statusPurpose: z.literal('revocation'),
    encodedList: z.string(),
  }),
});

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

function base64urlEncode(buffer: Buffer): string {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64urlDecode(str: string): Buffer {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

export function createStatusList(size: number = 131072): string {
  const buffer = Buffer.alloc(Math.ceil(size / 8), 0);
  const compressed = gzipSync(buffer);
  return base64urlEncode(compressed);
}

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

export function getStatusListLength(encodedList: string): number {
  const compressed = base64urlDecode(encodedList);
  const buffer = gunzipSync(compressed);
  return buffer.length * 8;
}

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
