import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { expect } from 'vitest';
import { AgentWallet, HelixClient } from '@helix-id/sdk-js';
import { createTestPrisma } from './prisma.js';

export const LIVE_HEDERA_TIMEOUT_MS = 240_000;

export interface LiveApi {
  baseUrl: string;
  adminApiKey: string;
  issuerDid: string | undefined;
  stop(): Promise<void>;
}

export interface LiveAgent {
  did: string;
  vcId: string;
  privateKeyHex: string;
  walletPath: string;
  cleanup(): Promise<void>;
}

export async function resetLiveTestDatabase(): Promise<void> {
  assertTestDatabaseUrl(process.env['DATABASE_URL']);
  const prisma = createTestPrisma();
  await prisma.auditLog.deleteMany();
  await prisma.vc.deleteMany();
  await prisma.statusListEntry.deleteMany();
  await prisma.vpId.deleteMany();
  await prisma.challenge.deleteMany();
  await prisma.enrollmentToken.deleteMany();
  await prisma.serviceRegistry.deleteMany();
  await prisma.didUpdate.deleteMany();
  await prisma.did.deleteMany();
  await prisma.$disconnect();
}

export async function startLiveApi(): Promise<LiveApi> {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiRoot = fileURLToPath(new URL('../..', import.meta.url));
  const workspaceEnv = readEnvFile(`${apiRoot}/../.env`);
  const apiEnv = readEnvFile(`${apiRoot}/.env`);
  const testEnv = readEnvFile(`${apiRoot}/.env.test`);
  const adminApiKey =
    apiEnv['HELIX_ADMIN_API_KEY'] ?? workspaceEnv['HELIX_ADMIN_API_KEY'] ?? process.env['HELIX_ADMIN_API_KEY'] ?? 'test-admin-key-0001';
  const issuerDid = apiEnv['HELIX_ISSUER_DID'] ?? workspaceEnv['HELIX_ISSUER_DID'] ?? process.env['HELIX_ISSUER_DID'];
  const databaseUrl = testEnv['DATABASE_URL'] ?? process.env['DATABASE_URL'];
  assertTestDatabaseUrl(databaseUrl);

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    HEDERA_NETWORK: apiEnv['HEDERA_NETWORK'] ?? workspaceEnv['HEDERA_NETWORK'] ?? process.env['HEDERA_NETWORK'],
    HEDERA_OPERATOR_ID: apiEnv['HEDERA_OPERATOR_ID'] ?? workspaceEnv['HEDERA_OPERATOR_ID'] ?? process.env['HEDERA_OPERATOR_ID'],
    HEDERA_OPERATOR_KEY: apiEnv['HEDERA_OPERATOR_KEY'] ?? workspaceEnv['HEDERA_OPERATOR_KEY'] ?? process.env['HEDERA_OPERATOR_KEY'],
    HEDERA_TOPIC_ID: apiEnv['HEDERA_TOPIC_ID'] ?? workspaceEnv['HEDERA_TOPIC_ID'] ?? process.env['HEDERA_TOPIC_ID'],
    HELIX_SIGNING_KEY: apiEnv['HELIX_SIGNING_KEY'] ?? workspaceEnv['HELIX_SIGNING_KEY'] ?? process.env['HELIX_SIGNING_KEY'],
    HELIX_ISSUER_DID: issuerDid,
    HELIX_ADMIN_API_KEY: adminApiKey,
    NODE_ENV: 'test',
    PORT: String(port),
    API_BASE_URL: baseUrl,
  };

  const child = spawn('pnpm', ['--config.engine-strict=false', 'exec', 'tsx', 'src/server.ts'], {
    cwd: apiRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  const appendLogs = (chunk: Buffer) => {
    logs += chunk.toString();
    logs = logs.slice(-8000);
  };
  child.stdout.on('data', appendLogs);
  child.stderr.on('data', appendLogs);

  await waitForHealth(baseUrl, child, () => logs);

  return {
    baseUrl,
    adminApiKey,
    issuerDid,
    async stop() {
      await stopChild(child);
    },
  };
}

export async function onboardLiveAgent(
  api: LiveApi,
  client: HelixClient,
  options: {
    agentName: string;
    requestedScopes: string[];
    requestedDomains: string[];
    passphrase: string;
  },
): Promise<LiveAgent> {
  const dir = await mkdtemp(join(tmpdir(), 'helix-live-agent-'));
  const walletPath = join(dir, 'agent-wallet.json');

  const tokenRes = await fetch(`${api.baseUrl}/v1/enrollment-tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentName: options.agentName,
      requestedScopes: options.requestedScopes,
      requestedDomains: options.requestedDomains,
    }),
  });
  expect(tokenRes.status).toBe(201);
  const { token } = (await tokenRes.json()) as { token: string };

  const challenge = await client.requestOnboardingChallenge(token, options.requestedDomains);
  const onboarding = await client.completeOnboarding(
    challenge.challengeId,
    challenge.nonce,
    options.passphrase,
    walletPath,
  );
  const wallet = await new AgentWallet().load(options.passphrase, walletPath);

  return {
    did: onboarding.agentDid,
    vcId: onboarding.vcId,
    privateKeyHex: wallet.privateKeyHex,
    walletPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to allocate test port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function assertTestDatabaseUrl(databaseUrl: string | undefined): void {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for live integration tests');
  }
  let dbName = '';
  try {
    dbName = new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to reset non-test database '${dbName}'. Use helix-api/.env.test for live integration tests.`);
  }
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    values[key] = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcess,
  getLogs: () => string,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API server exited before becoming ready:\n${getLogs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Keep polling until the child has bound the socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for API server:\n${getLogs()}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
      resolve();
    }, 3000);
  });
  await Promise.race([exited, timeout]);
}
