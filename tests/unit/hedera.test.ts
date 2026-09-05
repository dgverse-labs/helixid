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

import { describe, it, expect, beforeEach } from 'vitest';
import { MockHederaClient } from '../../src/hedera/mock/MockHederaClient.js';

describe('MockHederaClient', () => {
  let client: MockHederaClient;

  beforeEach(() => {
    client = new MockHederaClient();
  });

  it('records anchored payloads and increments sequence numbers', async () => {
    const res1 = await client.anchorDocument('payload 1');
    expect(res1.sequenceNumber).toBe(1);
    expect(client.anchoredPayloads).toHaveLength(1);
    expect(client.anchoredPayloads[0]).toBe('payload 1');

    const res2 = await client.anchorDocument('payload 2');
    expect(res2.sequenceNumber).toBe(2);
    expect(client.anchoredPayloads).toHaveLength(2);
  });

  it('resolves the latest payload', async () => {
    await client.anchorDocument('first');
    await client.anchorDocument('second');
    const resolved = await client.resolveDocument('0.0.123', 2);
    expect(resolved).toBe('second');
  });

  it('resets state correctly', async () => {
    await client.anchorDocument('test');
    client.reset();
    expect(client.anchoredPayloads).toHaveLength(0);
    expect(client.txCounter).toBe(0);
  });
});
