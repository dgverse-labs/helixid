import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDIDDocument } from '../src/core/did.js';
import { generateKeyPair } from '../src/core/keys.js';
import { mirrorBaseUrl, parseHederaDid } from '../src/mirror.js';
import { resolveDidHedera } from '../src/resolver.js';

function mockJsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseHederaDid', () => {
  it('extracts topic id from standard and Hiero DID formats', () => {
    expect(parseHederaDid('did:hedera:testnet:0.0.12345')).toEqual({
      network: 'testnet',
      topicId: '0.0.12345',
    });
    expect(parseHederaDid('did:hedera:mainnet:zAgent_0.0.789')).toEqual({
      network: 'mainnet',
      topicId: '0.0.789',
    });
  });
});

describe('resolveDidHedera', () => {
  it('fetches from the testnet mirror node URL', async () => {
    const key = generateKeyPair();
    const did = 'did:hedera:testnet:0.0.12345';
    const doc = buildDIDDocument(did, key.publicKey);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse({
      messages: [{
        sequence_number: 1,
        consensus_timestamp: '1.0',
        message: Buffer.from(JSON.stringify(doc), 'utf8').toString('base64'),
      }],
    }));

    await expect(resolveDidHedera(did)).resolves.toMatchObject({ id: did });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${mirrorBaseUrl('testnet')}/api/v1/topics/0.0.12345/messages?order=desc&limit=1`,
    );
  });

  it('fetches from the mainnet mirror node URL', async () => {
    const key = generateKeyPair();
    const did = 'did:hedera:mainnet:0.0.99999';
    const doc = buildDIDDocument(did, key.publicKey);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse({
      messages: [{
        sequence_number: 1,
        consensus_timestamp: '1.0',
        message: Buffer.from(JSON.stringify(doc), 'utf8').toString('base64'),
      }],
    }));

    await resolveDidHedera(did);

    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toContain(
      `${mirrorBaseUrl('mainnet')}/api/v1/topics/0.0.99999/messages`,
    );
  });

  it('throws HEDERA_RESOLUTION_FAILED on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    await expect(resolveDidHedera('did:hedera:testnet:0.0.1')).rejects.toMatchObject({
      code: 'HEDERA_RESOLUTION_FAILED',
      message: 'network down',
    });
  });
});
