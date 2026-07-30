// Boots one SP app from its provisioned identity. Both sp-airline/server.ts and
// sp-hotel/server.ts are three-line wrappers around this.

import 'dotenv/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStatusListCredential, createStatusList } from '@helixid/core';
import { env, type SpDefinition } from '../helixid-config/index.js';
import { createSpApp } from './app.js';
import { loadSpIdentity, statePath, STATUS_LIST_LENGTH } from './identity.js';
import { SpStore } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function serveSp(definition: SpDefinition): Promise<void> {
  const identity = await loadSpIdentity(env.walletsDir, definition.id);
  const store = await SpStore.open(
    statePath(env.walletsDir, definition.id),
    buildStatusListCredential('1', createStatusList(STATUS_LIST_LENGTH), identity.did, identity.baseUrl),
  );

  const { app } = createSpApp({
    definition,
    issuer: {
      did: identity.did,
      privateKeyHex: identity.privateKeyHex,
      publicKeyHex: identity.publicKeyHex,
    },
    baseUrl: identity.baseUrl,
    store,
    widgetDistPath: resolve(here, '../../../packages/widget/dist'),
  });

  app.listen(definition.port, '0.0.0.0', () => {
    console.log(`[${definition.id}] ${definition.displayName} listening on :${definition.port}`);
    console.log(`[${definition.id}] did:web  ${identity.did}`);
    console.log(`[${definition.id}] status   ${identity.statusListUrl}`);
    console.log(`[${definition.id}] consent  ${identity.baseUrl}/consent`);
  });
}
