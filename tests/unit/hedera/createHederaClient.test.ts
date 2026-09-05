import { describe, expect, it } from 'vitest';
import { DisabledHederaClient } from '../../../src/hedera/DisabledHederaClient.js';
import { MockHederaClient } from '../../../src/hedera/mock/MockHederaClient.js';
import { createHederaClient } from '../../../src/hedera/createHederaClient.js';

const baseConfig = {
  HEDERA_NETWORK: 'testnet' as const,
  HEDERA_OPERATOR_ID: '0.0.123',
  HEDERA_OPERATOR_KEY: '302e020100300506032b657004220420' + 'a'.repeat(64),
};

describe('createHederaClient', () => {
  it('returns MockHederaClient when HEDERA_MOCK=true', async () => {
    const client = await createHederaClient(baseConfig as never, {
      HEDERA_MOCK: 'true',
      DID_METHOD: 'hedera',
    });
    expect(client).toBeInstanceOf(MockHederaClient);
  });

  it('returns DisabledHederaClient when DID_METHOD is not hedera', async () => {
    const client = await createHederaClient(baseConfig as never, {
      DID_METHOD: 'web',
    });
    expect(client).toBeInstanceOf(DisabledHederaClient);
  });

  it('returns HieroHederaClient when DID_METHOD=hedera and mock is off', async () => {
    const { HieroHederaClient } = await import('@helixid/did-hedera');
    const client = await createHederaClient(baseConfig as never, {
      DID_METHOD: 'hedera',
    });
    expect(client).toBeInstanceOf(HieroHederaClient);
  });

  it('fails fast with a clear error when the Hedera package cannot be imported', async () => {
    await expect(
      createHederaClient(
        baseConfig as never,
        { DID_METHOD: 'hedera' },
        async () => {
          throw new Error('module not found');
        },
      ),
    ).rejects.toThrow(/DID_METHOD=hedera requires @helixid\/did-hedera/);
  });

  it('rejects Hedera operations with a clear message when disabled', async () => {
    const client = new DisabledHederaClient('web');
    await expect(client.prepareDIDCreation('zKey')).rejects.toThrow(/DID_METHOD=web/);
  });
});
