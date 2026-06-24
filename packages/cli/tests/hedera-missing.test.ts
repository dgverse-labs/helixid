import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('helix did create --method hedera without did-hedera', () => {
  let tempDir: string;
  let stderr: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'helix-cli-hedera-'));
    stderr = [];
    process.env.HELIX_WALLET_PASSPHRASE = 'test-passphrase';
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      stderr.push(args.join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
    delete process.env.HELIX_WALLET_PASSPHRASE;
  });

  it('exits with install instruction when did-hedera cannot be imported', async () => {
    vi.doMock('@helixid/did-hedera', () => {
      throw new Error('Cannot find module @helixid/did-hedera');
    });

    const { runDidCreate } = await import('../src/commands/did.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);

    await expect(runDidCreate({
      method: 'hedera',
      network: 'testnet',
      wallet: join(tempDir, 'issuer.enc'),
    })).rejects.toThrow('exit:1');

    expect(stderr.some((line) => line.includes('Hedera DID method requires: npm install @helixid/did-hedera'))).toBe(true);
    exitSpy.mockRestore();
  });
});
