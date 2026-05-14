import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  API_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  HEDERA_NETWORK: z.enum(['testnet', 'previewnet', 'mainnet']).default('testnet'),
  HEDERA_OPERATOR_ID: z.string().min(1),
  HEDERA_OPERATOR_KEY: z.string().min(1),
  HEDERA_TOPIC_ID: z.string().min(1),
  HELIX_SIGNING_KEY: z.string().min(64),
  ENROLLMENT_TOKEN_TTL_SECONDS: z.coerce.number().min(60).max(3600).default(900),
  CHALLENGE_TTL_SECONDS: z.coerce.number().min(30).max(600).default(300),
  VP_TTL_SECONDS: z.coerce.number().min(60).max(3600).default(300),
  AUDIT_LOG_DESTINATION: z.enum(['stdout', 'file', 'both']).default('stdout'),
  AUDIT_LOG_PATH: z.string().optional(),
  HEDERA_E2E_TESTNET: z
    .string()
    .optional()
    .transform((val) => val === 'true')
    .default('false'),
});

let parsedConfig: z.infer<typeof envSchema>;

try {
  parsedConfig = envSchema.parse(process.env);

  // SA-9 enforcement
  if (parsedConfig.HEDERA_NETWORK === 'mainnet' && parsedConfig.NODE_ENV !== 'production') {
    throw new Error("HEDERA_NETWORK=mainnet is only permitted when NODE_ENV=production.");
  }
} catch (error) {
  if (process.env.NODE_ENV === 'test') {
    parsedConfig = {
      NODE_ENV: 'test',
      PORT: 3000,
      API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000',
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dummy',
      HEDERA_NETWORK: 'testnet',
      HEDERA_OPERATOR_ID: process.env.HEDERA_OPERATOR_ID || '0.0.1234',
      HEDERA_OPERATOR_KEY: process.env.HEDERA_OPERATOR_KEY || 'dummykey_12345678901234567890123456789012345678901234567890123456',
      HEDERA_TOPIC_ID: process.env.HEDERA_TOPIC_ID || '0.0.5678',
      HELIX_SIGNING_KEY: process.env.HELIX_SIGNING_KEY || '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      ENROLLMENT_TOKEN_TTL_SECONDS: 900,
      CHALLENGE_TTL_SECONDS: 300,
      VP_TTL_SECONDS: 300,
      AUDIT_LOG_DESTINATION: 'stdout',
      AUDIT_LOG_PATH: undefined,
      HEDERA_E2E_TESTNET: false,
    } as z.infer<typeof envSchema>;
  } else {
    if (error instanceof z.ZodError) {
      console.error('Environment validation failed:', error.errors);
    } else if (error instanceof Error) {
      console.error('Environment validation failed:', error.message);
    } else {
      console.error('Environment validation failed:', error);
    }
    process.exit(1);
  }
}

export const config = parsedConfig;
