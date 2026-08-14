// SP identity provisioning.
//
// This is the programmatic equivalent of Epic 1's onboarding command,
// `helix did create --method web`, which since A5 produces BOTH artifacts in
// one step: the did:web document and the SP's initial status list. The seeder
// calls provisionSpIdentity() once; each SP server calls loadSpIdentity() on
// boot and hosts what it finds.
//
// Done with core primitives rather than by shelling out to the CLI so the
// seeder cannot be killed by the CLI's process.exit() error path. The output
// is the same shape the CLI writes.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildStatusListCredential,
  createStatusList,
  generateKeyPair,
  type StatusListCredential,
} from '@helixid/core';
import { spDidFor } from '../helixid-config/index.js';

/** Generous by design: grant indices are assigned randomly, unused bits are free. */
export const STATUS_LIST_LENGTH = 131072;

export interface SpIdentityFile {
  did: string;
  privateKeyHex: string;
  publicKeyHex: string;
  statusListUrl: string;
  baseUrl: string;
}

function identityPath(dir: string, spId: string): string {
  return join(dir, `sp-${spId}.identity.json`);
}

export function statePath(dir: string, spId: string): string {
  return join(dir, `sp-${spId}.state.json`);
}

export async function provisionSpIdentity(params: {
  dir: string;
  spId: string;
  host: string;
  port: number;
}): Promise<{ identity: SpIdentityFile; statusList: StatusListCredential; created: boolean }> {
  const path = identityPath(params.dir, params.spId);

  try {
    const existing = JSON.parse(await readFile(path, 'utf8')) as SpIdentityFile;
    const statusList = JSON.parse(
      await readFile(statePath(params.dir, params.spId), 'utf8'),
    ) as { statusList: StatusListCredential };
    return { identity: existing, statusList: statusList.statusList, created: false };
  } catch {
    // Not provisioned yet — fall through and create.
  }

  const keyPair = generateKeyPair();
  const did = spDidFor(params.host, params.port);
  const baseUrl = `http://${params.host}:${params.port}`;
  const statusListUrl = `${baseUrl}/status-list/1`;

  const identity: SpIdentityFile = {
    did,
    privateKeyHex: keyPair.privateKey,
    publicKeyHex: keyPair.publicKey,
    statusListUrl,
    baseUrl,
  };

  // Same shared StatusListCredential shape helix-api uses for its own lists.
  const statusList = buildStatusListCredential(
    '1',
    createStatusList(STATUS_LIST_LENGTH),
    did,
    baseUrl,
  );

  await mkdir(params.dir, { recursive: true });
  await writeFile(path, JSON.stringify(identity, null, 2), 'utf8');

  return { identity, statusList, created: true };
}

export async function loadSpIdentity(dir: string, spId: string): Promise<SpIdentityFile> {
  const path = identityPath(dir, spId);
  try {
    return JSON.parse(await readFile(path, 'utf8')) as SpIdentityFile;
  } catch {
    throw new Error(
      `SP "${spId}" is not provisioned (${path} not found). Run the seeder first: pnpm run setup`,
    );
  }
}
