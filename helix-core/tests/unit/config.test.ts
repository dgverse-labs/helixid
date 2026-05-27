import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('does not validate environment on import', async () => {
    process.env = {};

    await expect(import('../../src/config/index.js')).resolves.toBeDefined();
  });

  it('loads valid configuration from environment', async () => {
    process.env.API_BASE_URL = 'https://api.test.com';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.HEDERA_OPERATOR_ID = '0.0.123';
    process.env.HEDERA_OPERATOR_KEY = '302e020100300506032b657004220420...';
    process.env.HEDERA_TOPIC_ID = '0.0.456';
    process.env.HELIX_SIGNING_KEY = 'a'.repeat(64);
    process.env.HELIX_ISSUER_DID = 'did:hedera:testnet:testissuer';
    process.env.HELIX_JWT_SIGNING_KEY = 'b'.repeat(64);
    process.env.HELIX_JWT_PUBLIC_KEY = '7d59c5623dd40a74aa4d5a32ac645d3b3f95daeae4c22be25476dd6a486f7382';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    const config = loadConfigFromEnv();
    expect(config.API_BASE_URL).toBe('https://api.test.com');
    expect(config.HELIX_ISSUER_DID).toBe('did:hedera:testnet:testissuer');
    expect(config.NODE_ENV).toBe('test'); // Vitest sets this
  });

  it('accepts a PKCS8 DER seed Helix signing key', async () => {
    process.env.API_BASE_URL = 'https://api.test.com';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.HEDERA_OPERATOR_ID = '0.0.123';
    process.env.HEDERA_OPERATOR_KEY = '302e020100300506032b657004220420...';
    process.env.HEDERA_TOPIC_ID = '0.0.456';
    process.env.HELIX_SIGNING_KEY = '302e020100300506032b657004220420' + 'a'.repeat(64);
    process.env.HELIX_ISSUER_DID = 'did:hedera:testnet:testissuer';
    process.env.HELIX_JWT_SIGNING_KEY = 'b'.repeat(64);
    process.env.HELIX_JWT_PUBLIC_KEY = '7d59c5623dd40a74aa4d5a32ac645d3b3f95daeae4c22be25476dd6a486f7382';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    expect(loadConfigFromEnv().HELIX_SIGNING_KEY).toHaveLength(96);
  });

  it('throws on invalid configuration', async () => {
    process.env.API_BASE_URL = 'invalid-url';
    
    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    expect(() => loadConfigFromEnv()).toThrow(/Environment configuration is invalid/);
  });

  it('prevents mainnet network outside production', async () => {
    process.env.HEDERA_NETWORK = 'mainnet';
    process.env.NODE_ENV = 'development';
    process.env.API_BASE_URL = 'https://api.test.com';
    process.env.DATABASE_URL = 'db';
    process.env.HEDERA_OPERATOR_ID = 'id';
    process.env.HEDERA_OPERATOR_KEY = 'key';
    process.env.HEDERA_TOPIC_ID = 'topic';
    process.env.HELIX_SIGNING_KEY = 'a'.repeat(64);
    process.env.HELIX_ISSUER_DID = 'did:hedera:testnet:testissuer';
    process.env.HELIX_JWT_SIGNING_KEY = 'b'.repeat(64);
    process.env.HELIX_JWT_PUBLIC_KEY = '7d59c5623dd40a74aa4d5a32ac645d3b3f95daeae4c22be25476dd6a486f7382';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    expect(() => loadConfigFromEnv()).toThrow(/HEDERA_NETWORK=mainnet is only permitted when NODE_ENV=production/);
  });
});
