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

import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { createStatusList, setBit, getBit, buildStatusListCredential } from '../../src/status-list/index.js';

function decodeStatusList(encodedList: string): Buffer {
  const base64 = encodedList.replace(/-/g, '+').replace(/_/g, '/');
  return gunzipSync(Buffer.from(base64, 'base64'));
}

describe('BitstringStatusList', () => {
  it('createStatusList produces a non-empty base64url string', () => {
    const list = createStatusList(100);
    expect(list).toBeDefined();
    expect(typeof list).toBe('string');
    expect(list.length).toBeGreaterThan(0);
  });

  it('setBit(list, 5, 1) then getBit(list, 5) returns 1', () => {
    const initialList = createStatusList(100);
    const updatedList = setBit(initialList, 5, 1);
    expect(getBit(updatedList, 5)).toBe(1);
  });

  it('getBit on a freshly created list always returns 0', () => {
    const list = createStatusList(100);
    for (let i = 0; i < 100; i++) {
      expect(getBit(list, i)).toBe(0);
    }
  });

  it('setBit does not mutate other bits', () => {
    const initialList = createStatusList(100);
    const updatedList = setBit(initialList, 5, 1);
    
    expect(getBit(updatedList, 4)).toBe(0);
    expect(getBit(updatedList, 5)).toBe(1);
    expect(getBit(updatedList, 6)).toBe(0);
  });

  it('uses W3C left-most bit ordering within each byte', () => {
    let list = createStatusList(16);
    list = setBit(list, 0, 1);
    expect(decodeStatusList(list)[0]).toBe(0b10000000);

    list = createStatusList(16);
    list = setBit(list, 7, 1);
    expect(decodeStatusList(list)[0]).toBe(0b00000001);

    list = createStatusList(16);
    list = setBit(list, 8, 1);
    expect(decodeStatusList(list)[1]).toBe(0b10000000);

    list = createStatusList(16);
    list = setBit(list, 11, 1);
    expect(decodeStatusList(list)[1]).toBe(0b00010000);
  });

  it('handles roundtrip with multiple bits correctly', () => {
    let list = createStatusList(1024);
    const indices = [0, 7, 8, 15, 1023];
    
    for (const idx of indices) {
      list = setBit(list, idx, 1);
    }
    
    for (let i = 0; i < 1024; i++) {
      if (indices.includes(i)) {
        expect(getBit(list, i)).toBe(1);
      } else {
        expect(getBit(list, i)).toBe(0);
      }
    }
  });

  it('buildStatusListCredential includes correct @context and type', () => {
    const list = createStatusList(100);
    const cred = buildStatusListCredential('list-1', list, 'did:helix:issuer', 'http://api.test');
    
    expect(cred['@context']).toContain('https://www.w3.org/ns/credentials/status/v1');
    expect(cred.type).toContain('BitstringStatusListCredential');
    expect(cred.credentialSubject.encodedList).toBe(list);
  });
});
