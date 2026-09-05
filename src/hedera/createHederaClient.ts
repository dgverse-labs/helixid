// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
import { resolveDidMethod, type Config } from '../core/index.js';
import { DisabledHederaClient } from './DisabledHederaClient.js';
import { MockHederaClient } from './mock/MockHederaClient.js';
import type { IHederaClient } from './IHederaClient.js';

type HederaModule = {
  HieroHederaClient: new (config: Config) => IHederaClient;
};

export async function createHederaClient(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
  loadHederaModule: () => Promise<HederaModule> = () => import('@helixid/did-hedera') as Promise<HederaModule>,
): Promise<IHederaClient> {
  if (env.HEDERA_MOCK === 'true') {
    return new MockHederaClient();
  }

  const didMethod = resolveDidMethod(env);
  if (didMethod !== 'hedera') {
    return new DisabledHederaClient(didMethod);
  }

  try {
    const { HieroHederaClient } = await loadHederaModule();
    return new HieroHederaClient(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      'DID_METHOD=hedera requires @helixid/did-hedera to be installed and importable. ' +
        message,
    );
  }
}
