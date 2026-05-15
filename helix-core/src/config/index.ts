// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { z } from 'zod';

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),

  // Hedera
  HEDERA_NETWORK: z.enum(['testnet', 'previewnet', 'mainnet']).default('testnet'),
  HEDERA_OPERATOR_ID: z.string().min(1),
  HEDERA_OPERATOR_KEY: z.string().min(1),
  HEDERA_TOPIC_ID: z.string().min(1),

  // Helix ID signing key for VC issuance
  HELIX_SIGNING_KEY: z.string().min(64),

  // TTLs
  ENROLLMENT_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(300),
  VP_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),

  // Audit
  AUDIT_LOG_DESTINATION: z.enum(['stdout', 'file', 'both']).default('stdout'),
  AUDIT_LOG_PATH: z.string().optional(),

  // E2E / Testing
  HEDERA_E2E_TESTNET: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(input: Record<string, unknown>): Config {
  const result = ConfigSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment configuration is invalid:\n${issues}`);
  }

  const config = result.data;

  // SA-9: Reject mainnet unless explicitly in production
  if (config.HEDERA_NETWORK === 'mainnet' && config.NODE_ENV !== 'production') {
    throw new Error(
      'HEDERA_NETWORK=mainnet is only permitted when NODE_ENV=production. ' +
        'This safeguard prevents accidental writes to mainnet in development or CI.',
    );
  }

  return config;
}

/**
 * API/runtime helper. Library consumers should pass explicit config to their
 * own application boundary instead of importing a process-bound singleton.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  return loadConfig(env);
}
