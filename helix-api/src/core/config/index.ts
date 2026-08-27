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
import { derivePublicKey, isSupportedEd25519PrivateKeyHex, publicKeyToMultibase } from '../crypto/keys.js';

const BooleanEnvSchema = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return value;
}, z.boolean());

/**
 * Placeholder hosted API base URL used when API_BASE_URL is not explicitly
 * configured. This intentionally resolves to nothing (`.invalid` is an
 * IANA-reserved, guaranteed-unresolvable TLD) so it fails loudly instead of
 * silently pointing at a real service.
 *
 * TODO(#1 - enterprise hosted solution): replace with the real hosted
 * default URL once the enterprise hosting architecture is decided, and
 * update all call sites below that reference this constant.
 */
export const DEFAULT_HOSTED_API_BASE_URL = 'https://hosted.helixid.invalid';

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_BASE_URL: z.string().url().default(DEFAULT_HOSTED_API_BASE_URL),
  HELIX_STORAGE_ADAPTER: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DATABASE_URL: z.string().min(1).optional(),
  HELIX_SQLITE_PATH: z.string().min(1).default('./data/helixid.sqlite'),

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
  HELIX_CACHE_ADAPTER: z.enum(['memory', 'redis']).default('memory'),
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

  // Hosted accounts & auth (Item #1, see docs/proposal-hosted-instance.md).
  // All optional/defaulted so self-hosted deployments (which don't use
  // accounts at all — HELIX_ADMIN_API_KEY covers the single operator) never
  // need to set these. On the hosted instance itself these should be set
  // explicitly in production; unset values fall back to a randomly
  // generated per-process key (see server.ts), which is fine for local dev
  // but means encrypted IssuerKeyRecord rows and issued sessions don't
  // survive a restart.
  HOSTED_MODE: z.coerce.boolean().default(false),
  HOSTED_KEY_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex chars (32 bytes) for AES-256-GCM')
    .optional(),
  HOSTED_ACCESS_TOKEN_SECRET: z.string().min(32).optional(),
  HOSTED_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  HOSTED_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  HOSTED_DID_DOMAIN: z.string().default('hosted.helixid.io'),
  // Where the console is served, used to build email-verification links
  // (e.g. https://hosted.helixid.io/account/verify-email?token=...).
  HOSTED_CONSOLE_BASE_URL: z.string().url().default('https://hosted.helixid.io'),
  HOSTED_EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  // Hosted rate limiting & abuse prevention (proposal-hosted-rate-limiting.md).
  // Numeric values are the decided defaults from that doc; overridable via
  // env for tuning without a code change. Only enforced when HOSTED_MODE=true.
  HOSTED_RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(1).default(100),
  HOSTED_RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(5),
  HOSTED_RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().min(1).default(3),
  HOSTED_RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().min(1).default(20),
  HOSTED_QUOTA_VC_ISSUANCE_PER_DAY: z.coerce.number().int().min(1).default(1000),
  HOSTED_QUOTA_ENROLLMENT_TOKEN_PER_DAY: z.coerce.number().int().min(1).default(2000),
  TURNSTILE_SECRET_KEY: z.string().optional(),

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
  throw new Error(`Invalid DID method '${String(method)}'. Allowed values: web, hedera, key.`);
}

export function loadConfig(input: Record<string, unknown>): Config {
  const result = ConfigSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
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

  if (didMethod === 'key' && !config.HELIX_ISSUER_DID) {
    config.HELIX_ISSUER_DID = `did:key:${publicKeyToMultibase(derivePublicKey(config.HELIX_SIGNING_KEY))}`;
  }

  if (didMethod === 'hedera') {
    const issues: string[] = [];
    if (!config.HEDERA_OPERATOR_ID)
      issues.push('  HEDERA_OPERATOR_ID: required when DID_METHOD=hedera');
    if (!config.HEDERA_OPERATOR_KEY)
      issues.push('  HEDERA_OPERATOR_KEY: required when DID_METHOD=hedera');
    if (!config.HELIX_ISSUER_DID)
      issues.push('  HELIX_ISSUER_DID: required when DID_METHOD=hedera');
    if (
      config.HELIX_ISSUER_DID &&
      !/^did:hedera:(testnet|previewnet|mainnet):.+$/.test(config.HELIX_ISSUER_DID)
    ) {
      issues.push('  HELIX_ISSUER_DID: must be a did:hedera issuer DID when DID_METHOD=hedera');
    }
    if (issues.length > 0) {
      throw new Error(`Environment configuration is invalid:\n${issues.join('\n')}`);
    }
  }

  if (config.HELIX_STORAGE_ADAPTER === 'postgres' && !config.DATABASE_URL) {
    throw new Error(
      'Environment configuration is invalid:\n  DATABASE_URL: required when HELIX_STORAGE_ADAPTER=postgres',
    );
  }

  if (config.HELIX_CACHE_ADAPTER === 'redis' && !config.REDIS_URL) {
    throw new Error(
      'Environment configuration is invalid:\n  REDIS_URL: required when HELIX_CACHE_ADAPTER=redis',
    );
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
