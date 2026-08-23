import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// CI sets these at the job/step level for @helixid/api's Postgres and Hedera
// tests, but turbo runs every package's `test` script as a child of that same
// process, so they leak into this suite's ambient env too. Each test below
// declares exactly the vars it needs, so start every test from a clean slate
// instead of one that silently carries CI-injected values.
const CI_INJECTED_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'HEDERA_NETWORK',
  'HEDERA_OPERATOR_ID',
  'HEDERA_OPERATOR_KEY',
  'HEDERA_TOPIC_ID',
  'HELIX_SIGNING_KEY',
  'API_BASE_URL',
  'ENROLLMENT_TOKEN_TTL_SECONDS',
  'CHALLENGE_TTL_SECONDS',
  'VP_TTL_SECONDS',
  'AUDIT_LOG_DESTINATION',
];

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    for (const key of CI_INJECTED_VARS) delete process.env[key];
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
    process.env.DID_METHOD = 'hedera';
    process.env.HEDERA_OPERATOR_ID = '0.0.123';
    process.env.HEDERA_OPERATOR_KEY = '302e020100300506032b657004220420...';
    process.env.HEDERA_TOPIC_ID = '0.0.456';
    process.env.HELIX_SIGNING_KEY = 'a'.repeat(64);
    process.env.HELIX_ISSUER_DID = 'did:hedera:testnet:testissuer';
    process.env.HELIX_ADMIN_API_KEY = 'test-admin-key-0001';
    process.env.NODE_ENV = 'test';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    const config = loadConfigFromEnv();
    expect(config.API_BASE_URL).toBe('https://api.test.com');
    expect(config.HELIX_ISSUER_DID).toBe('did:hedera:testnet:testissuer');
    expect(config.NODE_ENV).toBe('test');
    expect(config.HELIX_STORAGE_ADAPTER).toBe('sqlite');
    expect(config.HELIX_CACHE_ADAPTER).toBe('memory');
  });

  it('falls back to the hosted default when API_BASE_URL is unset', async () => {
    process.env.DID_DOMAIN = 'example.com';
    process.env.HELIX_SIGNING_KEY = 'a'.repeat(64);
    process.env.HELIX_ADMIN_API_KEY = 'test-admin-key-0001';
    process.env.NODE_ENV = 'test';

    const { loadConfigFromEnv, DEFAULT_HOSTED_API_BASE_URL } = await import(
      '../../src/config/index.js'
    );
    const config = loadConfigFromEnv();
    expect(config.API_BASE_URL).toBe(DEFAULT_HOSTED_API_BASE_URL);
  });

  it('defaults to did:web and derives the issuer DID from DID_DOMAIN', async () => {
    process.env.API_BASE_URL = 'https://api.test.com';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.DID_DOMAIN = 'api.test.com';
    process.env.HELIX_SIGNING_KEY = 'a'.repeat(64);
    process.env.HELIX_ADMIN_API_KEY = 'test-admin-key-0001';
    process.env.NODE_ENV = 'test';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    const config = loadConfigFromEnv();
    expect(config.HELIX_ISSUER_DID).toBe('did:web:api.test.com');
    expect(config.HEDERA_OPERATOR_ID).toBe('');
  });

  it('requires DID_DOMAIN for did:web startup', async () => {
    process.env.API_BASE_URL = 'https://api.test.com';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.HELIX_SIGNING_KEY = 'a'.repeat(64);
    process.env.HELIX_ADMIN_API_KEY = 'test-admin-key-0001';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    expect(() => loadConfigFromEnv()).toThrow(/DID_DOMAIN: required when DID_METHOD=web/);
  });

  it('accepts a PKCS8 DER seed Helix signing key', async () => {
    process.env.API_BASE_URL = 'https://api.test.com';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.DID_METHOD = 'hedera';
    process.env.HEDERA_OPERATOR_ID = '0.0.123';
    process.env.HEDERA_OPERATOR_KEY = '302e020100300506032b657004220420...';
    process.env.HEDERA_TOPIC_ID = '0.0.456';
    process.env.HELIX_SIGNING_KEY = '302e020100300506032b657004220420' + 'a'.repeat(64);
    process.env.HELIX_ISSUER_DID = 'did:hedera:testnet:testissuer';
    process.env.HELIX_ADMIN_API_KEY = 'test-admin-key-0001';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    expect(loadConfigFromEnv().HELIX_SIGNING_KEY).toHaveLength(96);
  });

  it('throws on invalid configuration', async () => {
    process.env.API_BASE_URL = 'invalid-url';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    expect(() => loadConfigFromEnv()).toThrow(/Environment configuration is invalid/);
  });

  it('prevents mainnet network outside production', async () => {
    process.env.DID_METHOD = 'hedera';
    process.env.HEDERA_NETWORK = 'mainnet';
    process.env.NODE_ENV = 'development';
    process.env.API_BASE_URL = 'https://api.test.com';
    process.env.DATABASE_URL = 'db';
    process.env.HEDERA_OPERATOR_ID = 'id';
    process.env.HEDERA_OPERATOR_KEY = 'key';
    process.env.HEDERA_TOPIC_ID = 'topic';
    process.env.HELIX_SIGNING_KEY = 'a'.repeat(64);
    process.env.HELIX_ISSUER_DID = 'did:hedera:testnet:testissuer';
    process.env.HELIX_ADMIN_API_KEY = 'test-admin-key-0001';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    expect(() => loadConfigFromEnv()).toThrow(
      /HEDERA_NETWORK=mainnet is only permitted when NODE_ENV=production/,
    );
  });

  it('requires Hedera credentials only when DID_METHOD=hedera', async () => {
    process.env.DID_METHOD = 'hedera';
    process.env.API_BASE_URL = 'https://api.test.com';
    process.env.HELIX_SIGNING_KEY = 'a'.repeat(64);
    process.env.HELIX_ISSUER_DID = 'did:hedera:testnet:testissuer';
    process.env.HELIX_ADMIN_API_KEY = 'test-admin-key-0001';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    expect(() => loadConfigFromEnv()).toThrow(
      /HEDERA_OPERATOR_ID: required when DID_METHOD=hedera/,
    );
  });

  it('requires DATABASE_URL when HELIX_STORAGE_ADAPTER=postgres', async () => {
    process.env.API_BASE_URL = 'https://api.test.com';
    process.env.HELIX_STORAGE_ADAPTER = 'postgres';
    process.env.DID_DOMAIN = 'api.test.com';
    process.env.HELIX_SIGNING_KEY = 'a'.repeat(64);
    process.env.HELIX_ADMIN_API_KEY = 'test-admin-key-0001';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    expect(() => loadConfigFromEnv()).toThrow(
      /DATABASE_URL: required when HELIX_STORAGE_ADAPTER=postgres/,
    );
  });

  it('requires REDIS_URL when HELIX_CACHE_ADAPTER=redis', async () => {
    process.env.API_BASE_URL = 'https://api.test.com';
    process.env.HELIX_CACHE_ADAPTER = 'redis';
    process.env.DID_DOMAIN = 'api.test.com';
    process.env.HELIX_SIGNING_KEY = 'a'.repeat(64);
    process.env.HELIX_ADMIN_API_KEY = 'test-admin-key-0001';

    const { loadConfigFromEnv } = await import('../../src/config/index.js');
    expect(() => loadConfigFromEnv()).toThrow(/REDIS_URL: required when HELIX_CACHE_ADAPTER=redis/);
  });
});
