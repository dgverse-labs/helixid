// Copyright 2026 DgVerse LLP
import { AccountId, Client, PrivateKey } from '@hashgraph/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HieroHederaClient } from '../../../src/hedera/HieroHederaClient.js';

describe('HieroHederaClient', () => {
  type Registrar = NonNullable<ConstructorParameters<typeof HieroHederaClient>[1]>;
  let fakeClient: { setOperator: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let registrar: Registrar;

  function makeClient(network: 'testnet' | 'previewnet' | 'mainnet' = 'testnet'): HieroHederaClient {
    return new HieroHederaClient({
      HEDERA_NETWORK: network,
      HEDERA_OPERATOR_ID: '0.0.123',
      HEDERA_OPERATOR_KEY: PrivateKey.generateED25519().toString(),
    }, registrar);
  }

  beforeEach(() => {
    fakeClient = {
      setOperator: vi.fn(),
      close: vi.fn(),
    };
    registrar = {
      generateCreateDIDRequest: vi.fn(),
      submitCreateDIDRequest: vi.fn(),
    };
    vi.spyOn(Client, 'forTestnet').mockReturnValue(fakeClient as unknown as Client);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('anchorDocument rejects direct payload anchoring', async () => {
    await expect(makeClient().anchorDocument('payload'))
      .rejects.toThrow(/prepareDIDCreation\/submitDIDCreation/);
  });

  it('fetchMessage throws until live message fetching is implemented', async () => {
    await expect(makeClient().fetchMessage('topic', 1))
      .rejects.toThrow(/Live Hedera message fetching is not implemented/);
  });

  it('prepares DID creation with Hiero registrar and closes the client', async () => {
    vi.mocked(registrar.generateCreateDIDRequest).mockResolvedValue({
      state: { message: [1, 2, 3] },
      signingRequest: { serializedPayload: Uint8Array.from([4, 5, 6]) },
    });

    const result = await makeClient().prepareDIDCreation('zPublicKey');

    expect(Client.forTestnet).toHaveBeenCalled();
    expect(fakeClient.setOperator).toHaveBeenCalledWith(
      AccountId.fromString('0.0.123'),
      expect.any(PrivateKey),
    );
    expect(registrar.generateCreateDIDRequest).toHaveBeenCalledWith(
      { multibasePublicKey: 'zPublicKey' },
      { client: fakeClient },
    );
    expect(result).toEqual({
      stateJson: JSON.stringify({ message: [1, 2, 3] }),
      signingPayloadHex: '040506',
    });
    expect(fakeClient.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['array message', { message: [1, 2] }, [1, 2]],
    ['buffer-shaped message', { message: { type: 'Buffer', data: [3, 4] } }, [3, 4]],
    ['object-indexed message', { message: { 1: 6, 0: 5 } }, [5, 6]],
  ])('submits DID creation after restoring %s state bytes', async (_name, state, expectedBytes) => {
    vi.mocked(registrar.submitCreateDIDRequest).mockResolvedValue({
      did: 'did:hedera:testnet:zAgent_0.0.789',
      didDocument: { id: 'did:hedera:testnet:zAgent_0.0.789' },
    });

    const result = await makeClient().submitDIDCreation(JSON.stringify(state), '0a0b');

    expect(registrar.submitCreateDIDRequest).toHaveBeenCalledWith(
      {
        state: { message: Uint8Array.from(expectedBytes) },
        signature: Buffer.from('0a0b', 'hex'),
        waitForDIDVisibility: true,
        visibilityTimeoutMs: 180_000,
      },
      { client: fakeClient },
    );
    expect(result).toEqual({
      did: 'did:hedera:testnet:zAgent_0.0.789',
      didDocument: { id: 'did:hedera:testnet:zAgent_0.0.789' },
      transactionId: 'hiero-did:did:hedera:testnet:zAgent_0.0.789',
      topicId: '0.0.789',
      sequenceNumber: 0,
    });
    expect(fakeClient.close).toHaveBeenCalledOnce();
  });

  it('supports previewnet and mainnet client selection', async () => {
    const previewClient = { setOperator: vi.fn(), close: vi.fn() };
    const mainClient = { setOperator: vi.fn(), close: vi.fn() };
    vi.spyOn(Client, 'forPreviewnet').mockReturnValue(previewClient as unknown as Client);
    vi.spyOn(Client, 'forMainnet').mockReturnValue(mainClient as unknown as Client);
    vi.mocked(registrar.generateCreateDIDRequest).mockResolvedValue({
      state: {},
      signingRequest: { serializedPayload: Uint8Array.from([]) },
    });

    await makeClient('previewnet').prepareDIDCreation('zPreview');
    await makeClient('mainnet').prepareDIDCreation('zMain');

    expect(Client.forPreviewnet).toHaveBeenCalledOnce();
    expect(Client.forMainnet).toHaveBeenCalledOnce();
    expect(previewClient.close).toHaveBeenCalledOnce();
    expect(mainClient.close).toHaveBeenCalledOnce();
  });

  it('patches AccountId.fromString to accept object values', () => {
    const parsed = AccountId.fromString({
      toString: () => '0.0.456',
    } as unknown as string);

    expect(parsed.toString()).toBe('0.0.456');
  });
});
