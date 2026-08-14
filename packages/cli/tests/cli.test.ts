import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDidCreate } from '../src/commands/did.js';
import { runIssuerInit } from '../src/commands/issuer.js';
import { runRevoke } from '../src/commands/revoke.js';
import { runStatusListCreate } from '../src/commands/status-list.js';
import { runVcIssue, runVcSelfIssue } from '../src/commands/vc.js';
import { runWalletInspect } from '../src/commands/wallet.js';
import { requirePassphrase } from '../src/lib/env.js';

describe('helix CLI', () => {
  let tempDir: string;
  let stdout: string[];
  let stderr: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'helix-cli-'));
    stdout = [];
    stderr = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      stdout.push(args.join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      stderr.push(args.join(' '));
    });
    process.env.HELIX_WALLET_PASSPHRASE = 'test-passphrase';
    delete process.env.HEDERA_OPERATOR_ID;
    delete process.env.HEDERA_OPERATOR_KEY;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
    delete process.env.HELIX_WALLET_PASSPHRASE;
  });

  it('requires HELIX_WALLET_PASSPHRASE for all commands', () => {
    delete process.env.HELIX_WALLET_PASSPHRASE;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);

    expect(() => requirePassphrase()).toThrow('exit:1');
    expect(stderr.some((line) => line.includes('HELIX_WALLET_PASSPHRASE environment variable is required'))).toBe(true);
    exitSpy.mockRestore();
  });

  it('helix did create --method web creates wallet and prints did.json', async () => {
    const walletPath = join(tempDir, 'issuer.enc');

    await runDidCreate({ method: 'web', domain: 'example.com', wallet: walletPath });

    const saved = JSON.parse(await readFile(walletPath, 'utf8'));
    expect(saved.did).toBe('did:web:example.com');
    expect(stdout.some((line) => line.includes('Issuer DID created: did:web:example.com'))).toBe(true);
    expect(stdout.some((line) => line.includes('Serve this file at: https://example.com/.well-known/did.json'))).toBe(true);
    expect(stdout.some((line) => line.includes('"id": "did:web:example.com"'))).toBe(true);
  });

  it('helix did create --method web produces both the DID document and a status list by default', async () => {
    const walletPath = join(tempDir, 'sp-issuer.enc');

    await runDidCreate({ method: 'web', domain: 'sp.example.com', wallet: walletPath });

    const statusListPath = join(tempDir, 'status-list.json');
    const statusList = JSON.parse(await readFile(statusListPath, 'utf8'));
    expect(statusList.id).toBe('https://sp.example.com/.well-known/helix-status-list.json');
    expect(statusList.issuer).toBe('did:web:sp.example.com');
    expect(statusList.proof?.proofValue).toBeTruthy();
    expect(stdout.some((line) => line.includes('StatusList created'))).toBe(true);
    expect(stdout.some((line) => line.includes('Host both on your domain'))).toBe(true);
  });

  it('helix did create --method web --no-status-list produces only the DID document', async () => {
    const walletPath = join(tempDir, 'sp-issuer-optout.enc');

    await runDidCreate({
      method: 'web',
      domain: 'sp.example.com',
      wallet: walletPath,
      statusList: false,
    });

    const saved = JSON.parse(await readFile(walletPath, 'utf8'));
    expect(saved.did).toBe('did:web:sp.example.com');
    await expect(readFile(join(tempDir, 'status-list.json'), 'utf8')).rejects.toThrow();
    expect(stdout.some((line) => line.includes('StatusList created'))).toBe(false);
  });

  it('helix did create --method key creates did:key wallet', async () => {
    const walletPath = join(tempDir, 'agent.enc');
    await runDidCreate({ method: 'key', wallet: walletPath });
    const saved = JSON.parse(await readFile(walletPath, 'utf8'));
    expect(saved.did).toMatch(/^did:key:z/);
    expect(stdout.some((line) => line.includes('Agent DID created:'))).toBe(true);
  });

  it('helix issuer init loads wallet and prints DID info', async () => {
    const walletPath = join(tempDir, 'issuer.enc');
    await runDidCreate({ method: 'web', domain: 'example.com', wallet: walletPath });
    stdout.length = 0;

    await runIssuerInit({ wallet: walletPath });

    expect(stdout.some((line) => line.includes('Issuer ready'))).toBe(true);
    expect(stdout.some((line) => line.includes('did:web:example.com'))).toBe(true);
    expect(stdout.some((line) => line.includes('#key-1'))).toBe(true);
  });

  it('helix status-list create writes a signed status list file', async () => {
    const walletPath = join(tempDir, 'issuer.enc');
    const outputPath = join(tempDir, 'status', '1.json');
    await runDidCreate({ method: 'web', domain: 'example.com', wallet: walletPath });

    await runStatusListCreate({
      length: 128,
      output: outputPath,
      baseUrl: 'https://example.com/status/1',
      wallet: walletPath,
    });

    const saved = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(saved.id).toBe('https://example.com/status/1');
    expect(saved.proof?.proofValue).toBeTruthy();
    expect(stdout.some((line) => line.includes('StatusList created'))).toBe(true);
  });

  it('helix vc issue issues VC and updates status list', async () => {
    const issuerWallet = join(tempDir, 'issuer.enc');
    const agentWallet = join(tempDir, 'agent.enc');
    const statusListPath = join(tempDir, 'status.json');
    const vcOutput = join(tempDir, 'vc.json');

    await runDidCreate({ method: 'web', domain: 'example.com', wallet: issuerWallet });
    await runDidCreate({ method: 'key', wallet: agentWallet });
    const agentSaved = JSON.parse(await readFile(agentWallet, 'utf8'));

    await runStatusListCreate({
      length: 128,
      output: statusListPath,
      baseUrl: 'https://example.com/status/1',
      wallet: issuerWallet,
    });

    await runVcIssue({
      agentDid: agentSaved.did,
      scopes: 'read:orders,write:bookings',
      expires: '90d',
      statusList: statusListPath,
      baseUrl: 'https://example.com/status/1',
      wallet: issuerWallet,
      output: vcOutput,
      maxDelegationDepth: 1,
    });

    const vc = JSON.parse(await readFile(vcOutput, 'utf8'));
    const updatedList = JSON.parse(await readFile(statusListPath, 'utf8'));
    expect(vc.credentialSubject.privilegeScopes).toEqual(['read:orders', 'write:bookings']);
    expect(vc.proof?.proofValue).toBeTruthy();
    expect(updatedList.helixIndexRegistry?.[vc.id]).toBe(0);
    expect(stdout.some((line) => line.includes('VC issued'))).toBe(true);
  });

  it('helix vc self-issue adds self-signed VC and prints warning', async () => {
    const agentWallet = join(tempDir, 'agent.enc');
    await runDidCreate({ method: 'key', wallet: agentWallet });

    await runVcSelfIssue({
      scopes: 'read:orders',
      expires: '24h',
      wallet: agentWallet,
    });

    const saved = JSON.parse(await readFile(agentWallet, 'utf8'));
    expect(saved.credentials).toHaveLength(1);
    expect(stdout.some((line) => line.includes('Self-signed VC'))).toBe(true);
    expect(stdout.some((line) => line.includes('local development only'))).toBe(true);
  });

  it('helix revoke flips bit and re-signs status list', async () => {
    const issuerWallet = join(tempDir, 'issuer.enc');
    const agentWallet = join(tempDir, 'agent.enc');
    const statusListPath = join(tempDir, 'status.json');
    const vcOutput = join(tempDir, 'vc.json');

    await runDidCreate({ method: 'web', domain: 'example.com', wallet: issuerWallet });
    await runDidCreate({ method: 'key', wallet: agentWallet });
    const agentSaved = JSON.parse(await readFile(agentWallet, 'utf8'));

    await runStatusListCreate({
      length: 128,
      output: statusListPath,
      baseUrl: 'https://example.com/status/1',
      wallet: issuerWallet,
    });

    await runVcIssue({
      agentDid: agentSaved.did,
      scopes: 'read:orders',
      expires: '90d',
      statusList: statusListPath,
      baseUrl: 'https://example.com/status/1',
      wallet: issuerWallet,
      output: vcOutput,
      maxDelegationDepth: 1,
    });

    const vc = JSON.parse(await readFile(vcOutput, 'utf8'));
    stdout.length = 0;

    await runRevoke({
      vcId: vc.id,
      statusList: statusListPath,
      wallet: issuerWallet,
    });

    expect(stdout.some((line) => line.includes('VC revoked'))).toBe(true);
    expect(stdout.some((line) => line.includes('Bit flipped:  0 → 1'))).toBe(true);
  });

  it('helix revoke unknown vc-id exits with clear error', async () => {
    const issuerWallet = join(tempDir, 'issuer.enc');
    const statusListPath = join(tempDir, 'status.json');

    await runDidCreate({ method: 'web', domain: 'example.com', wallet: issuerWallet });
    await runStatusListCreate({
      length: 128,
      output: statusListPath,
      baseUrl: 'https://example.com/status/1',
      wallet: issuerWallet,
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);

    await expect(runRevoke({
      vcId: 'urn:uuid:missing',
      statusList: statusListPath,
      wallet: issuerWallet,
    })).rejects.toThrow('exit:1');

    expect(stderr.some((line) => line.includes('VC ID not found'))).toBe(true);
    exitSpy.mockRestore();
  });

  it('helix wallet inspect prints wallet info without private key', async () => {
    const agentWallet = join(tempDir, 'agent.enc');
    await runDidCreate({ method: 'key', wallet: agentWallet });
    await runVcSelfIssue({ scopes: 'read:orders', expires: '24h', wallet: agentWallet });

    stdout.length = 0;
    await runWalletInspect({ wallet: agentWallet });

    const output = stdout.join('\n');
    expect(output).toMatch(/^DID: did:key:/);
    expect(output).toContain('Credentials: 1');
    expect(output).not.toMatch(/privateKey/i);
  });

});
