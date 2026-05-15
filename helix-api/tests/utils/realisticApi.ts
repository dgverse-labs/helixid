import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createTestPrisma } from './prisma.js';

export interface RealisticApi {
  baseUrl: string;
  stop(): Promise<void>;
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

export async function resetTestDatabase(): Promise<void> {
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

export async function startRealisticApi(): Promise<RealisticApi> {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiRoot = fileURLToPath(new URL('../..', import.meta.url));
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    API_BASE_URL: baseUrl,
    HEDERA_MOCK: 'true',
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
    async stop() {
      await stopChild(child);
    },
  };
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcessWithoutNullStreams,
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

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
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
