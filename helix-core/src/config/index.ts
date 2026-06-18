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
import { isSupportedEd25519PrivateKeyHex } from '../crypto/keys.js';

const BooleanEnvSchema = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return value;
}, z.boolean());

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),

  // DID method — DID_METHOD takes precedence over HELIX_DID_METHOD (constitution HR-6)
  DID_METHOD: z.enum(['web', 'hedera', 'key']).optional(),
  HELIX_DID_METHOD: z.enum(['web', 'hedera', 'key']).optional(),
  DID_DOMAIN: z.string().default(''),

  // Hedera
  HEDERA_NETWORK: z.enum(['testnet', 'previewnet', 'mainnet']).default('testnet'),
  HEDERA_OPERATOR_ID: z.string().default(''),
  HEDERA_OPERATOR_KEY: z.string().default(''),
  HEDERA_TOPIC_ID: z.string().default(''),

  // Helix ID signing key for VC issuance
  HELIX_SIGNING_KEY: z.string().refine(isSupportedEd25519PrivateKeyHex, {
    message: 'must be raw 32-byte Ed25519 private key hex or PKCS8 DER seed hex',
  }),
  HELIX_ISSUER_DID: z.string().default(''),
  HELIX_ADMIN_API_KEY: z.string().min(16),

  // TTLs
  ENROLLMENT_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(300),
  VP_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  JWT_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),

  // Cache
  CACHE_ENABLED: BooleanEnvSchema.default(true),
  CACHE_L2_ENABLED: BooleanEnvSchema.default(true),
  REDIS_URL: z.string().url().optional(),
  DID_CACHE_L1_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  DID_CACHE_L2_TTL_SECONDS: z.coerce.number().int().min(1).max(86400).default(900),
  STATUS_LIST_CACHE_L1_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  STATUS_LIST_CACHE_L2_TTL_SECONDS: z.coerce.number().int().min(1).max(86400).default(300),

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
export type DidMethod = 'web' | 'hedera' | 'key';

export function resolveDidMethod(input: Record<string, unknown>): DidMethod {
  const method = input.DID_METHOD ?? input.HELIX_DID_METHOD ?? 'web';
  if (method === 'web' || method === 'hedera' || method === 'key') {
    return method;
  }
  throw new Error(
    `Invalid DID method '${String(method)}'. Allowed values: web, hedera, key.`,
  );
}

export function loadConfig(input: Record<string, unknown>): Config {
  const result = ConfigSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment configuration is invalid:\n${issues}`);
  }

  const config = result.data;
  const didMethod = resolveDidMethod(config);

  if (didMethod === 'web') {
    if (!config.DID_DOMAIN) {
      throw new Error(
        'Environment configuration is invalid:\n  DID_DOMAIN: required when DID_METHOD=web',
      );
    }
    if (!config.HELIX_ISSUER_DID) {
      config.HELIX_ISSUER_DID = `did:web:${config.DID_DOMAIN}`;
    }
    if (!config.HELIX_ISSUER_DID.startsWith('did:web:')) {
      throw new Error(
        'Environment configuration is invalid:\n  HELIX_ISSUER_DID: must be a did:web issuer DID when DID_METHOD=web',
      );
    }
  }

  if (didMethod === 'hedera') {
    const issues: string[] = [];
    if (!config.HEDERA_OPERATOR_ID) issues.push('  HEDERA_OPERATOR_ID: required when DID_METHOD=hedera');
    if (!config.HEDERA_OPERATOR_KEY) issues.push('  HEDERA_OPERATOR_KEY: required when DID_METHOD=hedera');
    if (!config.HELIX_ISSUER_DID) issues.push('  HELIX_ISSUER_DID: required when DID_METHOD=hedera');
    if (config.HELIX_ISSUER_DID && !/^did:hedera:(testnet|previewnet|mainnet):.+$/.test(config.HELIX_ISSUER_DID)) {
      issues.push('  HELIX_ISSUER_DID: must be a did:hedera issuer DID when DID_METHOD=hedera');
    }
    if (issues.length > 0) {
      throw new Error(`Environment configuration is invalid:\n${issues.join('\n')}`);
    }
  }

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
