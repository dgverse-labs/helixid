STORY 1 — Boundary 1: DID & Hedera Integration
Overview
Implement everything related to DID lifecycle and Hedera anchoring. After this story a DID can be created, anchored on Hedera HCS, resolved, and updated. Both agent DIDs and user DIDs are created via this boundary. No VC issuance, no VP logic, no onboarding flow — those come later. This story delivers the raw DID infrastructure that every other boundary depends on.
What is mocked so other boundaries can start in parallel:

VC issuance (B2) can mock resolveDID by returning a hardcoded DID document
VP flows (B3) can mock the DID resolution step entirely
Agent onboarding (B4) can mock anchorDID returning a fake transaction ID and createDID returning a fake DID

Dependencies this story has:

Story 0 complete (project scaffold, Prisma running, Fastify server running)
Hedera testnet credentials in .env
PostgreSQL running


1.1 — Database Schema (Prisma)
Add to helix-api/prisma/schema.prisma:
prismamodel Did {
  id                  String    @id @default(cuid())
  did                 String    @unique
  // "agent" or "user"
  subjectType         String
  publicKeyMultibase  String
  // Hedera HCS topic ID used for anchoring
  hederaTopicId       String
  // Hedera sequence number of the anchoring message
  hederaSequenceNumber Int
  // The transaction consensus timestamp from Hedera (ISO 8601)
  hederaTransactionId String
  // The full DID document JSON — stored for fast resolution
  // without needing to re-fetch from Hedera every time
  didDocumentJson     String
  // Soft-delete marker — DID is never hard-deleted,
  // deactivated flag flips when key is lost and re-onboarding occurs
  deactivated         Boolean   @default(false)
  deactivatedAt       DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  // Relations
  didUpdates          DidUpdate[]

  @@map("dids")
}

model DidUpdate {
  id                   String   @id @default(cuid())
  didId                String
  did                  Did      @relation(fields: [didId], references: [id])
  // "add_service_endpoint" | "remove_service_endpoint" | "deactivate"
  updateType           String
  // JSON snapshot of what changed
  updatePayloadJson    String
  hederaTransactionId  String
  createdAt            DateTime @default(now())

  @@map("did_updates")
}
Migration command after editing schema:
bashcd helix-api && npx prisma migrate dev --name init_did_tables

1.2 — helix-core: Crypto Primitives
Install dependencies in helix-core:
bashnpm install @noble/curves @noble/ed25519 @noble/hashes
Record in decisions.md:

@noble/curves, @noble/ed25519, @noble/hashes — approved cryptographic libraries per DP-3 and constitution crypto policy.

helix-core/src/crypto/keys.ts
typescriptimport { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/curves/abstract/utils';

export interface KeyPair {
  /** Hex-encoded Ed25519 private key (32 bytes) */
  privateKey: string;
  /** Hex-encoded Ed25519 public key (32 bytes) */
  publicKey: string;
}

/**
 * Generate a new Ed25519 keypair.
 * The private key is 32 bytes of cryptographically secure random data.
 * NEVER log or transmit the private key.
 */
export function generateKeyPair(): KeyPair {
  const privateKeyBytes = ed25519.utils.randomPrivateKey();
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  return {
    privateKey: bytesToHex(privateKeyBytes),
    publicKey: bytesToHex(publicKeyBytes),
  };
}

/**
 * Derive public key from a hex-encoded private key.
 */
export function derivePublicKey(privateKeyHex: string): string {
  const publicKeyBytes = ed25519.getPublicKey(hexToBytes(privateKeyHex));
  return bytesToHex(publicKeyBytes);
}

/**
 * Sign arbitrary bytes with an Ed25519 private key.
 * Returns hex-encoded signature (64 bytes).
 */
export function signBytes(message: Uint8Array, privateKeyHex: string): string {
  const sig = ed25519.sign(message, hexToBytes(privateKeyHex));
  return bytesToHex(sig);
}

/**
 * Verify an Ed25519 signature.
 */
export function verifySignature(
  message: Uint8Array,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    return ed25519.verify(hexToBytes(signatureHex), message, hexToBytes(publicKeyHex));
  } catch {
    // Noble throws on malformed input — treat as invalid
    return false;
  }
}

/**
 * Encode raw public key bytes as multibase (base58btc, prefix 'z').
 * This is the format used in W3C DID documents for publicKeyMultibase.
 */
export function publicKeyToMultibase(publicKeyHex: string): string {
  // Multicodec prefix for Ed25519 public key: 0xed01
  const multicodecPrefix = new Uint8Array([0xed, 0x01]);
  const keyBytes = hexToBytes(publicKeyHex);
  const combined = concatBytes(multicodecPrefix, keyBytes);
  return 'z' + base58BtcEncode(combined);
}

/**
 * Decode a multibase-encoded public key back to hex.
 * Strips the multicodec prefix.
 */
export function multibaseToPublicKeyHex(multibase: string): string {
  if (!multibase.startsWith('z')) {
    throw new Error('Only base58btc multibase (prefix z) is supported');
  }
  const decoded = base58BtcDecode(multibase.slice(1));
  // Strip 2-byte multicodec prefix
  return bytesToHex(decoded.slice(2));
}

// ── Base58 BTC helpers ──────────────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58BtcEncode(bytes: Uint8Array): string {
  let num = BigInt('0x' + bytesToHex(bytes));
  let result = '';
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)]! + result;
    num = num / 58n;
  }
  for (const byte of bytes) {
    if (byte === 0) result = '1' + result;
    else break;
  }
  return result;
}

function base58BtcDecode(str: string): Uint8Array {
  let num = 0n;
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx < 0) throw new Error(`Invalid base58 character: ${char}`);
    num = num * 58n + BigInt(idx);
  }
  const hex = num.toString(16).padStart(2, '0');
  const bytes = hexToBytes(hex.length % 2 === 0 ? hex : '0' + hex);
  const leadingZeros = [...str].filter((c) => c === '1').length;
  return concatBytes(new Uint8Array(leadingZeros), bytes);
}
helix-core/src/crypto/did.ts
typescriptimport { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/curves/abstract/utils';
import { publicKeyToMultibase, multibaseToPublicKeyHex } from './keys.js';

export interface DIDDocument {
  '@context': string[];
  id: string;
  controller: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  service?: ServiceEndpoint[];
}

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export type DIDSubjectType = 'agent' | 'user';

/**
 * Construct a DID string from a public key.
 * Format: did:helix:<base58btc-encoded-first-16-bytes-of-sha256-of-pubkey>
 *
 * The DID identifier is derived deterministically from the public key.
 * If the same public key is submitted twice, the same DID is produced —
 * the onboarding flow must check for duplicate DIDs before anchoring.
 */
export function deriveDidFromPublicKey(publicKeyHex: string): string {
  const pubKeyBytes = Buffer.from(publicKeyHex, 'hex');
  const hash = sha256(pubKeyBytes);
  // Take first 16 bytes (128 bits) — sufficient collision resistance for identifiers
  const identifier = bytesToHex(hash.slice(0, 16));
  return `did:helix:${identifier}`;
}

/**
 * Build a W3C-compliant DID document.
 *
 * @param did - The DID string (did:helix:...)
 * @param publicKeyHex - Hex-encoded Ed25519 public key
 * @param serviceEndpoints - Optional list of service endpoints (agent domains)
 */
export function buildDIDDocument(
  did: string,
  publicKeyHex: string,
  serviceEndpoints: ServiceEndpoint[] = [],
): DIDDocument {
  const verificationMethodId = `${did}#key-1`;
  const multibase = publicKeyToMultibase(publicKeyHex);

  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    controller: did,
    verificationMethod: [
      {
        id: verificationMethodId,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase: multibase,
      },
    ],
    // Both authentication and assertionMethod reference the same key.
    // Authentication: proving identity (challenge-response)
    // AssertionMethod: signing VPs
    authentication: [verificationMethodId],
    assertionMethod: [verificationMethodId],
    service: serviceEndpoints.length > 0 ? serviceEndpoints : undefined,
  };
}

/**
 * Extract the public key from a DID document.
 * Throws if the document has no Ed25519 verification method.
 */
export function extractPublicKeyFromDIDDocument(document: DIDDocument): string {
  const method = document.verificationMethod.find(
    (vm) => vm.type === 'Ed25519VerificationKey2020',
  );
  if (!method) {
    throw new Error('DID document contains no Ed25519VerificationKey2020 verification method');
  }
  return multibaseToPublicKeyHex(method.publicKeyMultibase);
}

/**
 * Build service endpoints from domain strings.
 * Each domain becomes a LinkedDomains service endpoint entry.
 */
export function buildServiceEndpoints(domains: string[]): ServiceEndpoint[] {
  return domains.map((domain, index) => ({
    id: `#domain-${index + 1}`,
    type: 'LinkedDomains',
    serviceEndpoint: domain,
  }));
}

/**
 * Add a new service endpoint to an existing DID document.
 * Returns a new document — does not mutate the original.
 */
export function addServiceEndpoint(
  document: DIDDocument,
  endpoint: ServiceEndpoint,
): DIDDocument {
  const existing = document.service ?? [];
  // Prevent duplicate IDs
  if (existing.some((s) => s.id === endpoint.id)) {
    throw new Error(`Service endpoint with id ${endpoint.id} already exists`);
  }
  return { ...document, service: [...existing, endpoint] };
}

/**
 * Remove a service endpoint from an existing DID document.
 * Returns a new document — does not mutate the original.
 * Throws if the endpoint ID does not exist.
 */
export function removeServiceEndpoint(document: DIDDocument, endpointId: string): DIDDocument {
  const existing = document.service ?? [];
  const filtered = existing.filter((s) => s.id !== endpointId);
  if (filtered.length === existing.length) {
    throw new Error(`Service endpoint with id ${endpointId} not found`);
  }
  return { ...document, service: filtered.length > 0 ? filtered : undefined };
}
helix-core/src/crypto/index.ts
typescriptexport * from './keys.js';
export * from './did.js';

1.3 — helix-core: Error Types
helix-core/src/errors/codes.ts
Define all error codes that Boundary 1 can produce. Other boundaries' codes are added in their respective stories.
typescript/**
 * All Helix ID error codes.
 * These are the only permitted error codes — no ad hoc strings in helix-api.
 * Grouped by boundary for readability.
 */
export const ErrorCode = {
  // ── B1 — DID & Hedera ───────────────────────────────────────────────────────
  /** Public key submitted during DID creation is not valid Ed25519 */
  INVALID_PUBLIC_KEY: 'INVALID_PUBLIC_KEY',

  /** DID string does not match did:helix:<identifier> format */
  INVALID_DID_FORMAT: 'INVALID_DID_FORMAT',

  /** DID lookup found no record in database or on Hedera */
  DID_NOT_FOUND: 'DID_NOT_FOUND',

  /** Attempted to create a DID for a public key that already has one */
  DID_ALREADY_EXISTS: 'DID_ALREADY_EXISTS',

  /** DID has been deactivated — no further operations permitted */
  DID_DEACTIVATED: 'DID_DEACTIVATED',

  /** Service endpoint URL is not a valid HTTPS URL */
  INVALID_SERVICE_ENDPOINT_URL: 'INVALID_SERVICE_ENDPOINT_URL',

  /** Service endpoint ID not found in the DID document */
  SERVICE_ENDPOINT_NOT_FOUND: 'SERVICE_ENDPOINT_NOT_FOUND',

  /** Service endpoint ID already exists in the DID document */
  SERVICE_ENDPOINT_ALREADY_EXISTS: 'SERVICE_ENDPOINT_ALREADY_EXISTS',

  /** Hedera HCS transaction failed or timed out */
  HEDERA_ANCHOR_FAILED: 'HEDERA_ANCHOR_FAILED',

  /** Hedera DID resolution failed — topic not found or no messages */
  HEDERA_RESOLUTION_FAILED: 'HEDERA_RESOLUTION_FAILED',

  // ── General ────────────────────────────────────────────────────────────────
  /** Generic internal error — details logged, not exposed */
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  /** Request body or query params failed schema validation */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
helix-core/src/errors/HelixError.ts
typescriptimport type { ErrorCode } from './codes.js';

export interface HelixErrorBody {
  code: ErrorCode;
  message: string;
  requestId?: string;
  /** Additional context — never contains sensitive data */
  details?: Record<string, unknown>;
}

/**
 * Base error class for all Helix ID errors.
 * Used by helix-api to construct HTTP error responses.
 * Used by helix-sdk-js to construct typed SDK errors.
 */
export class HelixError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HelixError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

// ── Convenience constructors ────────────────────────────────────────────────

export class InvalidPublicKeyError extends HelixError {
  constructor() {
    super(
      'INVALID_PUBLIC_KEY',
      'The submitted public key is not a valid 32-byte Ed25519 public key.',
      400,
    );
  }
}

export class InvalidDIDFormatError extends HelixError {
  constructor(did: string) {
    super('INVALID_DID_FORMAT', `The value '${did}' is not a valid Helix DID.`, 400);
  }
}

export class DIDNotFoundError extends HelixError {
  constructor(did: string) {
    super('DID_NOT_FOUND', `DID '${did}' was not found.`, 404);
  }
}

export class DIDAlreadyExistsError extends HelixError {
  constructor() {
    super('DID_ALREADY_EXISTS', 'A DID already exists for this public key.', 409);
  }
}

export class DIDDeactivatedError extends HelixError {
  constructor(did: string) {
    super(
      'DID_DEACTIVATED',
      `DID '${did}' has been deactivated and cannot be used.`,
      410,
    );
  }
}

export class InvalidServiceEndpointUrlError extends HelixError {
  constructor(url: string) {
    super(
      'INVALID_SERVICE_ENDPOINT_URL',
      `Service endpoint URL '${url}' must be a valid HTTPS URL.`,
      400,
    );
  }
}

export class ServiceEndpointNotFoundError extends HelixError {
  constructor(endpointId: string) {
    super(
      'SERVICE_ENDPOINT_NOT_FOUND',
      `Service endpoint '${endpointId}' was not found in the DID document.`,
      404,
    );
  }
}

export class ServiceEndpointAlreadyExistsError extends HelixError {
  constructor(endpointId: string) {
    super(
      'SERVICE_ENDPOINT_ALREADY_EXISTS',
      `A service endpoint with ID '${endpointId}' already exists.`,
      409,
    );
  }
}

export class HederaAnchorFailedError extends HelixError {
  constructor() {
    super(
      'HEDERA_ANCHOR_FAILED',
      'Failed to anchor the DID document on Hedera. Please retry.',
      502,
    );
  }
}

export class HederaResolutionFailedError extends HelixError {
  constructor() {
    super(
      'HEDERA_RESOLUTION_FAILED',
      'Failed to resolve the DID document from Hedera.',
      502,
    );
  }
}

export class InternalError extends HelixError {
  constructor() {
    super('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
  }
}
helix-core/src/errors/index.ts
typescriptexport * from './codes.js';
export * from './HelixError.js';

1.4 — helix-core: Audit Log Interface
helix-core/src/audit/events.ts
typescript/**
 * All audit event types for Boundary 1.
 * Events for other boundaries added in their stories.
 */
export type AuditEventType =
  // B1
  | 'DID_CREATED'
  | 'DID_CREATION_FAILED'
  | 'DID_RESOLVED'
  | 'DID_UPDATED'
  | 'DID_UPDATE_FAILED'
  | 'DID_DEACTIVATED';

export interface BaseAuditEvent {
  timestamp: string;         // ISO 8601
  event: AuditEventType;
  requestId: string;
}

export interface DidCreatedEvent extends BaseAuditEvent {
  event: 'DID_CREATED';
  did: string;
  subjectType: 'agent' | 'user';
  hederaTransactionId: string;
  publicKeyMultibase: string; // public key only — never private key
}

export interface DidCreationFailedEvent extends BaseAuditEvent {
  event: 'DID_CREATION_FAILED';
  reason: string;
  publicKeyMultibase?: string;
}

export interface DidResolvedEvent extends BaseAuditEvent {
  event: 'DID_RESOLVED';
  did: string;
  source: 'cache' | 'hedera'; // cache = served from DB; hedera = fetched live
}

export interface DidUpdatedEvent extends BaseAuditEvent {
  event: 'DID_UPDATED';
  did: string;
  updateType: 'add_service_endpoint' | 'remove_service_endpoint' | 'deactivate';
  hederaTransactionId: string;
}

export interface DidUpdateFailedEvent extends BaseAuditEvent {
  event: 'DID_UPDATE_FAILED';
  did: string;
  updateType: string;
  reason: string;
}

export interface DidDeactivatedEvent extends BaseAuditEvent {
  event: 'DID_DEACTIVATED';
  did: string;
  reason: string;
}

export type B1AuditEvent =
  | DidCreatedEvent
  | DidCreationFailedEvent
  | DidResolvedEvent
  | DidUpdatedEvent
  | DidUpdateFailedEvent
  | DidDeactivatedEvent;

// Combined type — extended by each story
export type AuditEvent = B1AuditEvent;
helix-core/src/audit/IAuditLogger.ts
typescriptimport type { AuditEvent } from './events.js';

/**
 * Audit logger interface.
 * helix-api implements this against PostgreSQL + stdout.
 * helix-sdk-js implements this against a local file.
 * Tests use a no-op or in-memory implementation.
 */
export interface IAuditLogger {
  log(event: AuditEvent): Promise<void>;
}

1.5 — helix-core: Config Module
helix-core/src/config/index.ts
typescriptimport { z } from 'zod';

const ConfigSchema = z.object({
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

function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);
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

// Singleton — loaded once, validated at startup, imported everywhere
export const config: Config = loadConfig();
This module is the only place process.env is accessed. ESLint enforces this everywhere else.

1.6 — helix-api: IHederaClient Interface and Implementations
helix-api/src/hedera/IHederaClient.ts
typescriptexport interface HederaTransactionResult {
  /** Hedera consensus timestamp, used as the canonical transaction ID */
  transactionId: string;
  /** Topic sequence number — needed for future resolution */
  sequenceNumber: number;
  topicId: string;
}

export interface HederaMessage {
  sequenceNumber: number;
  consensusTimestamp: string;
  contents: string; // raw JSON string of the DID document
}

/**
 * All Hedera HCS operations go through this interface.
 * Production: HederaHCSClient (uses @hashgraph/sdk)
 * Tests: MockHederaClient (in-memory, no network)
 */
export interface IHederaClient {
  /**
   * Submit a DID document (serialized as JSON string) to the HCS topic.
   * Returns the transaction result for storage.
   */
  anchorDocument(payload: string): Promise<HederaTransactionResult>;

  /**
   * Fetch a specific message from the HCS topic by sequence number.
   * Used during DID resolution if the cached DID document is stale or missing.
   */
  fetchMessage(topicId: string, sequenceNumber: number): Promise<HederaMessage>;
}
helix-api/src/hedera/HederaHCSClient.ts
typescriptimport {
  Client,
  TopicMessageSubmitTransaction,
  TopicMessageQuery,
  TopicId,
  PrivateKey,
  AccountId,
} from '@hashgraph/sdk';
import { config } from '@helix-id/core';
import type { IHederaClient, HederaTransactionResult, HederaMessage } from './IHederaClient.js';
import { HederaAnchorFailedError, HederaResolutionFailedError } from '@helix-id/core';

export class HederaHCSClient implements IHederaClient {
  private readonly client: Client;
  private readonly topicId: TopicId;

  constructor() {
    // Config is pre-validated by the config module — safe to use directly
    this.client =
      config.HEDERA_NETWORK === 'testnet'
        ? Client.forTestnet()
        : Client.forPreviewnet();

    this.client.setOperator(
      AccountId.fromString(config.HEDERA_OPERATOR_ID),
      PrivateKey.fromString(config.HEDERA_OPERATOR_KEY),
    );

    this.topicId = TopicId.fromString(config.HEDERA_TOPIC_ID);
  }

  async anchorDocument(payload: string): Promise<HederaTransactionResult> {
    try {
      const tx = await new TopicMessageSubmitTransaction({
        topicId: this.topicId,
        message: payload,
      }).execute(this.client);

      const receipt = await tx.getReceipt(this.client);

      if (!receipt.topicSequenceNumber) {
        throw new HederaAnchorFailedError();
      }

      return {
        transactionId: tx.transactionId?.toString() ?? '',
        sequenceNumber: Number(receipt.topicSequenceNumber),
        topicId: this.topicId.toString(),
      };
    } catch (err) {
      if (err instanceof HederaAnchorFailedError) throw err;
      throw new HederaAnchorFailedError();
    }
  }

  async fetchMessage(topicId: string, sequenceNumber: number): Promise<HederaMessage> {
    // Hedera SDK message query — fetches a single message by sequence number
    // This is a simplified implementation; production may use Mirror Node REST API
    // for more reliable historical queries
    try {
      // Use Hedera Mirror Node REST API (more reliable for historical reads):
      const network = config.HEDERA_NETWORK;
      const mirrorUrl =
        network === 'testnet'
          ? 'https://testnet.mirrornode.hedera.com'
          : 'https://previewnet.mirrornode.hedera.com';

      const response = await fetch(
        `${mirrorUrl}/api/v1/topics/${topicId}/messages/${sequenceNumber}`,
      );

      if (!response.ok) {
        throw new HederaResolutionFailedError();
      }

      const data = await response.json() as {
        consensus_timestamp: string;
        sequence_number: number;
        message: string; // base64 encoded
      };

      const contents = Buffer.from(data.message, 'base64').toString('utf-8');

      return {
        sequenceNumber: data.sequence_number,
        consensusTimestamp: data.consensus_timestamp,
        contents,
      };
    } catch (err) {
      if (err instanceof HederaResolutionFailedError) throw err;
      throw new HederaResolutionFailedError();
    }
  }
}
Add to decisions.md:

@hashgraph/sdk — Hedera official SDK. Required for HCS topic message submission. No alternatives — it is the only SDK for Hedera.

helix-api/src/hedera/mock/MockHederaClient.ts
typescriptimport type { IHederaClient, HederaTransactionResult, HederaMessage } from '../IHederaClient.js';

interface StoredMessage {
  sequenceNumber: number;
  contents: string;
  consensusTimestamp: string;
}

/**
 * In-memory mock Hedera client for tests.
 * Records all anchored documents. Supports programmatic inspection.
 * Never makes network calls.
 */
export class MockHederaClient implements IHederaClient {
  private messages: Map<number, StoredMessage> = new Map();
  private sequenceCounter = 1;
  public anchoredPayloads: string[] = []; // public for test assertion

  async anchorDocument(payload: string): Promise<HederaTransactionResult> {
    const seq = this.sequenceCounter++;
    const timestamp = new Date().toISOString();

    this.messages.set(seq, {
      sequenceNumber: seq,
      contents: payload,
      consensusTimestamp: timestamp,
    });

    this.anchoredPayloads.push(payload);

    return {
      transactionId: `mock-tx-${seq}-${Date.now()}`,
      sequenceNumber: seq,
      topicId: '0.0.999999',
    };
  }

  async fetchMessage(_topicId: string, sequenceNumber: number): Promise<HederaMessage> {
    const msg = this.messages.get(sequenceNumber);
    if (!msg) {
      throw new Error(`MockHederaClient: no message at sequence ${sequenceNumber}`);
    }
    return msg;
  }

  /** Reset state between tests */
  reset(): void {
    this.messages.clear();
    this.anchoredPayloads = [];
    this.sequenceCounter = 1;
  }
}

1.7 — helix-api: Repository Layer
helix-api/src/repositories/did.repository.ts
typescriptimport { PrismaClient } from '@prisma/client';
import type { Did, DidUpdate } from '@prisma/client';

/**
 * All database access for DID records.
 * No business logic here — only Prisma queries.
 */
export class DidRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: {
    did: string;
    subjectType: 'agent' | 'user';
    publicKeyMultibase: string;
    hederaTopicId: string;
    hederaSequenceNumber: number;
    hederaTransactionId: string;
    didDocumentJson: string;
  }): Promise<Did> {
    return this.prisma.did.create({ data });
  }

  async findByDid(did: string): Promise<Did | null> {
    return this.prisma.did.findUnique({ where: { did } });
  }

  async findByPublicKeyMultibase(multibase: string): Promise<Did | null> {
    return this.prisma.did.findFirst({ where: { publicKeyMultibase: multibase } });
  }

  async updateDIDDocument(
    did: string,
    didDocumentJson: string,
    hederaTransactionId: string,
  ): Promise<Did> {
    return this.prisma.did.update({
      where: { did },
      data: { didDocumentJson, updatedAt: new Date() },
    });
  }

  async deactivate(did: string): Promise<Did> {
    return this.prisma.did.update({
      where: { did },
      data: { deactivated: true, deactivatedAt: new Date() },
    });
  }

  async createDidUpdate(data: {
    didId: string;
    updateType: string;
    updatePayloadJson: string;
    hederaTransactionId: string;
  }): Promise<DidUpdate> {
    return this.prisma.didUpdate.create({ data });
  }

  async getDidUpdates(did: string): Promise<DidUpdate[]> {
    const record = await this.prisma.did.findUnique({
      where: { did },
      include: { didUpdates: { orderBy: { createdAt: 'asc' } } },
    });
    return record?.didUpdates ?? [];
  }
}

1.8 — helix-api: Service Layer
helix-api/src/services/did/did.service.ts
This is the core business logic. All DID operations flow through here.
typescriptimport {
  buildDIDDocument,
  buildServiceEndpoints,
  addServiceEndpoint,
  removeServiceEndpoint,
  extractPublicKeyFromDIDDocument,
  deriveDidFromPublicKey,
  publicKeyToMultibase,
  multibaseToPublicKeyHex,
  verifySignature,
  type DIDDocument,
  type ServiceEndpoint,
  DIDNotFoundError,
  DIDAlreadyExistsError,
  DIDDeactivatedError,
  InvalidPublicKeyError,
  InvalidServiceEndpointUrlError,
  ServiceEndpointNotFoundError,
  ServiceEndpointAlreadyExistsError,
  HederaAnchorFailedError,
} from '@helix-id/core';
import type { DidRepository } from '../../repositories/did.repository.js';
import type { IHederaClient } from '../../hedera/IHederaClient.js';
import type { IAuditLogger } from '@helix-id/core';
import { hexToBytes } from '@noble/curves/abstract/utils';

export interface CreateDIDResult {
  did: string;
  didDocument: DIDDocument;
  hederaTransactionId: string;
}

export interface ResolveDIDResult {
  did: string;
  didDocument: DIDDocument;
  source: 'cache' | 'hedera';
}

export class DIDService {
  constructor(
    private readonly didRepository: DidRepository,
    private readonly hederaClient: IHederaClient,
    private readonly auditLogger: IAuditLogger,
  ) {}

  /**
   * Create a new DID for an agent or user.
   *
   * Steps:
   * 1. Validate public key is 32 bytes (Ed25519)
   * 2. Derive DID from public key
   * 3. Check no existing DID for this public key
   * 4. Build DID document with optional service endpoints
   * 5. Anchor on Hedera HCS
   * 6. Persist to database
   * 7. Emit audit event
   *
   * @param publicKeyHex - Hex-encoded Ed25519 public key (32 bytes = 64 hex chars)
   * @param subjectType - 'agent' or 'user'
   * @param domains - Optional domain URLs for agent service endpoints
   * @param requestId - For audit and error correlation
   */
  async createDID(
    publicKeyHex: string,
    subjectType: 'agent' | 'user',
    domains: string[],
    requestId: string,
  ): Promise<CreateDIDResult> {
    // Validate public key
    this.validatePublicKey(publicKeyHex);

    // Validate domains if provided
    for (const domain of domains) {
      this.validateServiceEndpointUrl(domain);
    }

    const multibase = publicKeyToMultibase(publicKeyHex);

    // Check for duplicate
    const existing = await this.didRepository.findByPublicKeyMultibase(multibase);
    if (existing) {
      await this.auditLogger.log({
        timestamp: new Date().toISOString(),
        event: 'DID_CREATION_FAILED',
        requestId,
        reason: 'DID already exists for this public key',
        publicKeyMultibase: multibase,
      });
      throw new DIDAlreadyExistsError();
    }

    const did = deriveDidFromPublicKey(publicKeyHex);
    const serviceEndpoints = buildServiceEndpoints(domains);
    const didDocument = buildDIDDocument(did, publicKeyHex, serviceEndpoints);

    // Anchor on Hedera
    let hederaResult;
    try {
      hederaResult = await this.hederaClient.anchorDocument(JSON.stringify(didDocument));
    } catch {
      await this.auditLogger.log({
        timestamp: new Date().toISOString(),
        event: 'DID_CREATION_FAILED',
        requestId,
        reason: 'Hedera anchor failed',
        publicKeyMultibase: multibase,
      });
      throw new HederaAnchorFailedError();
    }

    // Persist
    await this.didRepository.create({
      did,
      subjectType,
      publicKeyMultibase: multibase,
      hederaTopicId: hederaResult.topicId,
      hederaSequenceNumber: hederaResult.sequenceNumber,
      hederaTransactionId: hederaResult.transactionId,
      didDocumentJson: JSON.stringify(didDocument),
    });

    await this.auditLogger.log({
      timestamp: new Date().toISOString(),
      event: 'DID_CREATED',
      requestId,
      did,
      subjectType,
      hederaTransactionId: hederaResult.transactionId,
      publicKeyMultibase: multibase,
    });

    return { did, didDocument, hederaTransactionId: hederaResult.transactionId };
  }

  /**
   * Resolve a DID document.
   * Resolution order:
   * 1. Look up in database (cache)
   * 2. If not found, return DID_NOT_FOUND
   * 3. If deactivated, return DID_DEACTIVATED
   *
   * Note: We use the database as a cache of the Hedera state.
   * The Hedera record is the ground truth, but for normal operation,
   * the DB is always up-to-date because all writes go through this service.
   * Live Hedera resolution is available as a separate endpoint for
   * verifiers who want to bypass the cache.
   */
  async resolveDID(did: string, requestId: string): Promise<ResolveDIDResult> {
    this.validateDIDFormat(did);

    const record = await this.didRepository.findByDid(did);

    if (!record) {
      throw new DIDNotFoundError(did);
    }

    if (record.deactivated) {
      throw new DIDDeactivatedError(did);
    }

    const didDocument = JSON.parse(record.didDocumentJson) as DIDDocument;

    await this.auditLogger.log({
      timestamp: new Date().toISOString(),
      event: 'DID_RESOLVED',
      requestId,
      did,
      source: 'cache',
    });

    return { did, didDocument, source: 'cache' };
  }

  /**
   * Resolve a DID directly from Hedera (bypasses DB cache).
   * Used by external verifiers and for integrity checks.
   */
  async resolveDIDFromHedera(did: string, requestId: string): Promise<ResolveDIDResult> {
    this.validateDIDFormat(did);

    const record = await this.didRepository.findByDid(did);
    if (!record) {
      throw new DIDNotFoundError(did);
    }

    // Fetch the latest message from Hedera at the stored sequence number
    const message = await this.hederaClient.fetchMessage(
      record.hederaTopicId,
      record.hederaSequenceNumber,
    );

    const didDocument = JSON.parse(message.contents) as DIDDocument;

    await this.auditLogger.log({
      timestamp: new Date().toISOString(),
      event: 'DID_RESOLVED',
      requestId,
      did,
      source: 'hedera',
    });

    return { did, didDocument, source: 'hedera' };
  }

  /**
   * Add a service endpoint (domain) to an existing DID document.
   * The updated document is re-anchored on Hedera.
   */
  async addServiceEndpoint(
    did: string,
    endpoint: ServiceEndpoint,
    requestId: string,
  ): Promise<DIDDocument> {
    this.validateDIDFormat(did);
    this.validateServiceEndpointUrl(endpoint.serviceEndpoint);

    const record = await this.getActiveRecord(did);
    const current = JSON.parse(record.didDocumentJson) as DIDDocument;

    let updated: DIDDocument;
    try {
      updated = addServiceEndpoint(current, endpoint);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        throw new ServiceEndpointAlreadyExistsError(endpoint.id);
      }
      throw err;
    }

    const hederaResult = await this.anchorUpdate(updated);

    await this.didRepository.updateDIDDocument(did, JSON.stringify(updated), hederaResult.transactionId);
    await this.didRepository.createDidUpdate({
      didId: record.id,
      updateType: 'add_service_endpoint',
      updatePayloadJson: JSON.stringify({ endpoint }),
      hederaTransactionId: hederaResult.transactionId,
    });

    await this.auditLogger.log({
      timestamp: new Date().toISOString(),
      event: 'DID_UPDATED',
      requestId,
      did,
      updateType: 'add_service_endpoint',
      hederaTransactionId: hederaResult.transactionId,
    });

    return updated;
  }

  /**
   * Remove a service endpoint (domain) from an existing DID document.
   */
  async removeServiceEndpoint(
    did: string,
    endpointId: string,
    requestId: string,
  ): Promise<DIDDocument> {
    this.validateDIDFormat(did);

    const record = await this.getActiveRecord(did);
    const current = JSON.parse(record.didDocumentJson) as DIDDocument;

    let updated: DIDDocument;
    try {
      updated = removeServiceEndpoint(current, endpointId);
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        throw new ServiceEndpointNotFoundError(endpointId);
      }
      throw err;
    }

    const hederaResult = await this.anchorUpdate(updated);

    await this.didRepository.updateDIDDocument(did, JSON.stringify(updated), hederaResult.transactionId);
    await this.didRepository.createDidUpdate({
      didId: record.id,
      updateType: 'remove_service_endpoint',
      updatePayloadJson: JSON.stringify({ endpointId }),
      hederaTransactionId: hederaResult.transactionId,
    });

    await this.auditLogger.log({
      timestamp: new Date().toISOString(),
      event: 'DID_UPDATED',
      requestId,
      did,
      updateType: 'remove_service_endpoint',
      hederaTransactionId: hederaResult.transactionId,
    });

    return updated;
  }

  /**
   * Deactivate a DID.
   * Called when a private key is lost or an agent is decommissioned.
   * After deactivation, the DID cannot be resolved or used.
   * Re-onboarding creates a new DID — deactivated DIDs are never reactivated.
   */
  async deactivateDID(did: string, reason: string, requestId: string): Promise<void> {
    this.validateDIDFormat(did);
    const record = await this.getActiveRecord(did);
    const current = JSON.parse(record.didDocumentJson) as DIDDocument;

    // Anchor the deactivation event on Hedera (DID document with deactivated marker)
    const deactivatedDoc = { ...current, deactivated: true };
    await this.anchorUpdate(deactivatedDoc).catch(() => {
      // Hedera failure does not block local deactivation —
      // the DB record is the authoritative state for Helix ID
    });

    await this.didRepository.deactivate(did);

    await this.auditLogger.log({
      timestamp: new Date().toISOString(),
      event: 'DID_DEACTIVATED',
      requestId,
      did,
      reason,
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getActiveRecord(did: string) {
    const record = await this.didRepository.findByDid(did);
    if (!record) throw new DIDNotFoundError(did);
    if (record.deactivated) throw new DIDDeactivatedError(did);
    return record;
  }

  private async anchorUpdate(document: DIDDocument) {
    try {
      return await this.hederaClient.anchorDocument(JSON.stringify(document));
    } catch {
      throw new HederaAnchorFailedError();
    }
  }

  private validatePublicKey(publicKeyHex: string): void {
    // Ed25519 public key must be exactly 32 bytes = 64 hex characters
    if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) {
      throw new InvalidPublicKeyError();
    }
    // Attempt to derive public key validates it is a real point on the curve
    try {
      hexToBytes(publicKeyHex); // will throw on invalid hex
    } catch {
      throw new InvalidPublicKeyError();
    }
  }

  private validateDIDFormat(did: string): void {
    if (!/^did:helix:[0-9a-f]{32}$/.test(did)) {
      throw new InvalidDIDFormatError(did);
    }
  }

  private validateServiceEndpointUrl(url: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        throw new InvalidServiceEndpointUrlError(url);
      }
    } catch {
      throw new InvalidServiceEndpointUrlError(url);
    }
  }
}

1.9 — helix-api: Route Layer
OpenAPI spec first (AC-1)
helix-core/src/openapi/openapi.yaml — B1 endpoints:
yamlopenapi: "3.1.0"
info:
  title: Helix ID API
  version: "0.1.0"
  description: Agent identity and trust infrastructure

paths:
  /health:
    get:
      operationId: getHealth
      summary: Health check
      responses:
        "200":
          description: API is running
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/HealthResponse"

  /v1/dids:
    post:
      operationId: createDID
      summary: Create and anchor a new DID
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateDIDRequest"
      responses:
        "201":
          description: DID created and anchored
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CreateDIDResponse"
        "400":
          $ref: "#/components/responses/ValidationError"
        "409":
          $ref: "#/components/responses/ConflictError"
        "502":
          $ref: "#/components/responses/HederaError"

  /v1/dids/{did}:
    get:
      operationId: resolveDID
      summary: Resolve a DID document (from cache)
      parameters:
        - $ref: "#/components/parameters/DIDParam"
        - name: live
          in: query
          required: false
          schema:
            type: boolean
            default: false
          description: >
            When true, resolve directly from Hedera instead of DB cache.
            Slower but guarantees freshest state.
      responses:
        "200":
          description: DID resolved successfully
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ResolveDIDResponse"
        "400":
          $ref: "#/components/responses/ValidationError"
        "404":
          $ref: "#/components/responses/NotFoundError"
        "410":
          $ref: "#/components/responses/GoneError"

  /v1/dids/{did}/services:
    post:
      operationId: addServiceEndpoint
      summary: Add a service endpoint to a DID document
      parameters:
        - $ref: "#/components/parameters/DIDParam"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/AddServiceEndpointRequest"
      responses:
        "200":
          description: Service endpoint added
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UpdateDIDResponse"
        "400":
          $ref: "#/components/responses/ValidationError"
        "404":
          $ref: "#/components/responses/NotFoundError"
        "409":
          $ref: "#/components/responses/ConflictError"

  /v1/dids/{did}/services/{endpointId}:
    delete:
      operationId: removeServiceEndpoint
      summary: Remove a service endpoint from a DID document
      parameters:
        - $ref: "#/components/parameters/DIDParam"
        - name: endpointId
          in: path
          required: true
          schema:
            type: string
            pattern: "^#[a-zA-Z0-9\\-]+$"
      responses:
        "200":
          description: Service endpoint removed
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UpdateDIDResponse"
        "404":
          $ref: "#/components/responses/NotFoundError"

  /v1/dids/{did}/deactivate:
    post:
      operationId: deactivateDID
      summary: Deactivate a DID (key loss or agent decommission)
      parameters:
        - $ref: "#/components/parameters/DIDParam"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/DeactivateDIDRequest"
      responses:
        "200":
          description: DID deactivated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DeactivateDIDResponse"
        "404":
          $ref: "#/components/responses/NotFoundError"
        "410":
          $ref: "#/components/responses/GoneError"

components:
  parameters:
    DIDParam:
      name: did
      in: path
      required: true
      schema:
        type: string
        pattern: "^did:helix:[0-9a-f]{32}$"
        example: "did:helix:3a7f1b2c4d5e6f7a8b9c0d1e2f3a4b5c"

  schemas:
    HealthResponse:
      type: object
      required: [status, version]
      properties:
        status:
          type: string
          enum: [ok]
        version:
          type: string

    CreateDIDRequest:
      type: object
      required: [publicKeyHex, subjectType]
      properties:
        publicKeyHex:
          type: string
          pattern: "^[0-9a-fA-F]{64}$"
          description: Hex-encoded Ed25519 public key (32 bytes)
          example: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
        subjectType:
          type: string
          enum: [agent, user]
        domains:
          type: array
          items:
            type: string
            format: uri
            pattern: "^https://"
          maxItems: 10
          description: Optional HTTPS domain URLs for agent service endpoints
          example: ["https://myagent.example.com"]

    CreateDIDResponse:
      type: object
      required: [did, didDocument, hederaTransactionId]
      properties:
        did:
          type: string
          pattern: "^did:helix:[0-9a-f]{32}$"
        didDocument:
          $ref: "#/components/schemas/DIDDocument"
        hederaTransactionId:
          type: string

    ResolveDIDResponse:
      type: object
      required: [did, didDocument, source]
      properties:
        did:
          type: string
        didDocument:
          $ref: "#/components/schemas/DIDDocument"
        source:
          type: string
          enum: [cache, hedera]

    AddServiceEndpointRequest:
      type: object
      required: [id, type, serviceEndpoint]
      properties:
        id:
          type: string
          pattern: "^#[a-zA-Z0-9\\-]+$"
          example: "#domain-2"
        type:
          type: string
          enum: [LinkedDomains]
        serviceEndpoint:
          type: string
          format: uri
          pattern: "^https://"

    UpdateDIDResponse:
      type: object
      required: [did, didDocument, hederaTransactionId]
      properties:
        did:
          type: string
        didDocument:
          $ref: "#/components/schemas/DIDDocument"
        hederaTransactionId:
          type: string

    DeactivateDIDRequest:
      type: object
      required: [reason]
      properties:
        reason:
          type: string
          minLength: 1
          maxLength: 500
          example: "Private key lost"

    DeactivateDIDResponse:
      type: object
      required: [did, deactivated]
      properties:
        did:
          type: string
        deactivated:
          type: boolean
          enum: [true]

    DIDDocument:
      type: object
      required: ["@context", id, controller, verificationMethod, authentication, assertionMethod]
      properties:
        "@context":
          type: array
          items:
            type: string
        id:
          type: string
        controller:
          type: string
        verificationMethod:
          type: array
          items:
            $ref: "#/components/schemas/VerificationMethod"
        authentication:
          type: array
          items:
            type: string
        assertionMethod:
          type: array
          items:
            type: string
        service:
          type: array
          items:
            $ref: "#/components/schemas/ServiceEndpoint"

    VerificationMethod:
      type: object
      required: [id, type, controller, publicKeyMultibase]
      properties:
        id:
          type: string
        type:
          type: string
        controller:
          type: string
        publicKeyMultibase:
          type: string

    ServiceEndpoint:
      type: object
      required: [id, type, serviceEndpoint]
      properties:
        id:
          type: string
        type:
          type: string
        serviceEndpoint:
          type: string

    ErrorResponse:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [code, message, requestId]
          properties:
            code:
              type: string
            message:
              type: string
            requestId:
              type: string

  responses:
    ValidationError:
      description: Request body failed schema validation
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
          example:
            error:
              code: VALIDATION_ERROR
              message: "publicKeyHex must be a 64-character hex string"
              requestId: "req_01abc"
    NotFoundError:
      description: DID not found
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    ConflictError:
      description: DID already exists
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    GoneError:
      description: DID has been deactivated
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    HederaError:
      description: Hedera anchor or resolution failed
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
helix-api/src/routes/did/index.ts
typescriptimport type { FastifyInstance } from 'fastify';
import type { DIDService } from '../../services/did/did.service.js';

// JSON Schema for route validation (derived from OpenAPI spec)
const createDIDSchema = {
  body: {
    type: 'object',
    required: ['publicKeyHex', 'subjectType'],
    properties: {
      publicKeyHex: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
      subjectType: { type: 'string', enum: ['agent', 'user'] },
      domains: {
        type: 'array',
        items: { type: 'string', pattern: '^https://' },
        maxItems: 10,
      },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      required: ['did', 'didDocument', 'hederaTransactionId'],
      properties: {
        did: { type: 'string' },
        didDocument: { type: 'object' },
        hederaTransactionId: { type: 'string' },
      },
    },
  },
};

const resolveDIDSchema = {
  params: {
    type: 'object',
    required: ['did'],
    properties: {
      did: { type: 'string', pattern: '^did:helix:[0-9a-f]{32}$' },
    },
  },
  querystring: {
    type: 'object',
    properties: {
      live: { type: 'boolean', default: false },
    },
  },
};

const addServiceEndpointSchema = {
  params: {
    type: 'object',
    required: ['did'],
    properties: {
      did: { type: 'string', pattern: '^did:helix:[0-9a-f]{32}$' },
    },
  },
  body: {
    type: 'object',
    required: ['id', 'type', 'serviceEndpoint'],
    properties: {
      id: { type: 'string', pattern: '^#[a-zA-Z0-9\\-]+$' },
      type: { type: 'string', enum: ['LinkedDomains'] },
      serviceEndpoint: { type: 'string', pattern: '^https://' },
    },
    additionalProperties: false,
  },
};

const removeServiceEndpointSchema = {
  params: {
    type: 'object',
    required: ['did', 'endpointId'],
    properties: {
      did: { type: 'string', pattern: '^did:helix:[0-9a-f]{32}$' },
      endpointId: { type: 'string', pattern: '^#[a-zA-Z0-9\\-]+$' },
    },
  },
};

const deactivateDIDSchema = {
  params: {
    type: 'object',
    required: ['did'],
    properties: {
      did: { type: 'string', pattern: '^did:helix:[0-9a-f]{32}$' },
    },
  },
  body: {
    type: 'object',
    required: ['reason'],
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: 500 },
    },
    additionalProperties: false,
  },
};

export async function didRoutes(
  fastify: FastifyInstance,
  options: { didService: DIDService },
): Promise<void> {
  const { didService } = options;

  // POST /v1/dids
  fastify.post('/v1/dids', { schema: createDIDSchema }, async (request, reply) => {
    const body = request.body as {
      publicKeyHex: string;
      subjectType: 'agent' | 'user';
      domains?: string[];
    };
    const requestId = request.id;
    const result = await didService.createDID(
      body.publicKeyHex,
      body.subjectType,
      body.domains ?? [],
      requestId,
    );
    return reply.status(201).send(result);
  });

  // GET /v1/dids/:did
  fastify.get('/v1/dids/:did', { schema: resolveDIDSchema }, async (request, reply) => {
    const { did } = request.params as { did: string };
    const { live } = request.query as { live?: boolean };
    const requestId = request.id;

    const result = live
      ? await didService.resolveDIDFromHedera(did, requestId)
      : await didService.resolveDID(did, requestId);

    return reply.send(result);
  });

  // POST /v1/dids/:did/services
  fastify.post(
    '/v1/dids/:did/services',
    { schema: addServiceEndpointSchema },
    async (request, reply) => {
      const { did } = request.params as { did: string };
      const body = request.body as {
        id: string;
        type: 'LinkedDomains';
        serviceEndpoint: string;
      };
      const requestId = request.id;
      const updatedDoc = await didService.addServiceEndpoint(did, body, requestId);
      return reply.send({ did, didDocument: updatedDoc });
    },
  );

  // DELETE /v1/dids/:did/services/:endpointId
  fastify.delete(
    '/v1/dids/:did/services/:endpointId',
    { schema: removeServiceEndpointSchema },
    async (request, reply) => {
      const { did, endpointId } = request.params as { did: string; endpointId: string };
      const requestId = request.id;
      const updatedDoc = await didService.removeServiceEndpoint(did, endpointId, requestId);
      return reply.send({ did, didDocument: updatedDoc });
    },
  );

  // POST /v1/dids/:did/deactivate
  fastify.post(
    '/v1/dids/:did/deactivate',
    { schema: deactivateDIDSchema },
    async (request, reply) => {
      const { did } = request.params as { did: string };
      const { reason } = request.body as { reason: string };
      const requestId = request.id;
      await didService.deactivateDID(did, reason, requestId);
      return reply.send({ did, deactivated: true });
    },
  );
}

1.10 — helix-api: Error Handler Middleware
helix-api/src/middleware/errorHandler.ts
typescriptimport type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { HelixError } from '@helix-id/core';

export function errorHandler(
  error: FastifyError | HelixError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const requestId = request.id;

  // HelixError — typed business error from service layer
  if (error instanceof HelixError) {
    request.log.warn({ code: error.code, requestId }, error.message);
    void reply.status(error.httpStatus).send({
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    });
    return;
  }

  // Fastify validation error (JSON Schema rejection)
  if ('validation' in error && error.validation) {
    request.log.warn({ validation: error.validation, requestId }, 'Validation error');
    void reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        requestId,
      },
    });
    return;
  }

  // Unknown error — log detail internally, return generic response (EH-3)
  request.log.error(
    {
      err: error,
      requestId,
      // Explicitly NOT including: error.stack in production, no DB details
    },
    'Unexpected internal error',
  );

  void reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    },
  });
}

1.11 — helix-api: Audit Log Implementation
helix-api/src/audit/index.ts
typescriptimport { PrismaClient } from '@prisma/client';
import type { IAuditLogger, AuditEvent } from '@helix-id/core';
import { config } from '@helix-id/core';
import * as fs from 'node:fs/promises';

export class ApiAuditLogger implements IAuditLogger {
  constructor(private readonly prisma: PrismaClient) {}

  async log(event: AuditEvent): Promise<void> {
    const entry = JSON.stringify(event);

    // Always write to DB
    await this.prisma.auditLog.create({
      data: {
        timestamp: event.timestamp,
        eventType: event.event,
        requestId: event.requestId,
        payloadJson: entry,
      },
    });

    // Write to stdout and/or file based on config
    if (config.AUDIT_LOG_DESTINATION === 'stdout' || config.AUDIT_LOG_DESTINATION === 'both') {
      process.stdout.write(entry + '\n');
    }

    if (
      (config.AUDIT_LOG_DESTINATION === 'file' || config.AUDIT_LOG_DESTINATION === 'both') &&
      config.AUDIT_LOG_PATH
    ) {
      await fs.appendFile(config.AUDIT_LOG_PATH, entry + '\n', 'utf-8');
    }
  }
}
Add audit log table to Prisma schema:
prismamodel AuditLog {
  id          String   @id @default(cuid())
  timestamp   String
  eventType   String
  requestId   String
  payloadJson String   // full event JSON — see AL-4
  createdAt   DateTime @default(now())

  @@index([eventType])
  @@index([requestId])
  @@map("audit_log")
}

1.12 — helix-api: Wire Everything in server.ts
typescriptimport Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { config } from '@helix-id/core';
import { HederaHCSClient } from './hedera/HederaHCSClient.js';
import { DidRepository } from './repositories/did.repository.js';
import { DIDService } from './services/did/did.service.js';
import { ApiAuditLogger } from './audit/index.js';
import { didRoutes } from './routes/did/index.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    // Redact sensitive fields from all logs
    redact: ['req.headers.authorization', 'req.body.privateKey'],
  },
  // Fastify assigns a unique requestId to every request — used in audit logs
  genReqId: () => `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
});

// Global error handler
app.setErrorHandler(errorHandler);

// Bootstrap services (dependency injection)
const prisma = new PrismaClient();
const hederaClient = new HederaHCSClient();
const auditLogger = new ApiAuditLogger(prisma);
const didRepository = new DidRepository(prisma);
const didService = new DIDService(didRepository, hederaClient, auditLogger);

// Register routes
await app.register(didRoutes, { didService });

app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  await app.close();
  await prisma.$disconnect();
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

const start = async (): Promise<void> => {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
};

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});

1.13 — SDK: DID Methods in HelixClient
The SDK's role is to call the API and provide typed convenience methods. Key generation happens locally in the SDK.
helix-sdk-js/src/client/HelixClient.ts
typescriptimport { generateKeyPair, derivePublicKey, type KeyPair } from '@helix-id/core';
import type { HttpAdapter } from '../http/HttpAdapter.js';
import type { AgentWallet } from '../wallet/AgentWallet.js';
import type { DIDDocument } from '@helix-id/core';

export interface CreateDIDOptions {
  subjectType: 'agent' | 'user';
  domains?: string[];
}

export interface CreateDIDResult {
  did: string;
  keyPair: KeyPair;
  didDocument: DIDDocument;
  hederaTransactionId: string;
}

export interface ResolveDIDOptions {
  /** When true, resolve directly from Hedera. Slower but guarantees freshness. */
  live?: boolean;
}

export class HelixClient {
  constructor(
    private readonly http: HttpAdapter,
    private readonly wallet: AgentWallet,
  ) {}

  /**
   * Generate a keypair and create a DID.
   * The private key is generated locally and NEVER sent to the API.
   * Only the public key is transmitted.
   *
   * @returns CreateDIDResult including the keypair — caller is responsible
   *          for storing the private key securely (e.g. via AgentWallet)
   */
  async createDID(options: CreateDIDOptions): Promise<CreateDIDResult> {
    const keyPair = generateKeyPair();

    const response = await this.http.post<{
      did: string;
      didDocument: DIDDocument;
      hederaTransactionId: string;
    }>('/v1/dids', {
      publicKeyHex: keyPair.publicKey,
      subjectType: options.subjectType,
      domains: options.domains ?? [],
    });

    return {
      did: response.did,
      keyPair,
      didDocument: response.didDocument,
      hederaTransactionId: response.hederaTransactionId,
    };
  }

  /**
   * Resolve a DID document.
   * @param did - The DID string to resolve (did:helix:...)
   */
  async resolveDID(
    did: string,
    options: ResolveDIDOptions = {},
  ): Promise<{ did: string; didDocument: DIDDocument; source: 'cache' | 'hedera' }> {
    const query = options.live ? '?live=true' : '';
    return this.http.get(`/v1/dids/${encodeURIComponent(did)}${query}`);
  }

  /**
   * Add a service endpoint (domain) to a DID.
   */
  async addServiceEndpoint(
    did: string,
    endpoint: { id: string; type: 'LinkedDomains'; serviceEndpoint: string },
  ): Promise<{ did: string; didDocument: DIDDocument }> {
    return this.http.post(`/v1/dids/${encodeURIComponent(did)}/services`, endpoint);
  }

  /**
   * Remove a service endpoint from a DID.
   */
  async removeServiceEndpoint(
    did: string,
    endpointId: string,
  ): Promise<{ did: string; didDocument: DIDDocument }> {
    return this.http.delete(
      `/v1/dids/${encodeURIComponent(did)}/services/${encodeURIComponent(endpointId)}`,
    );
  }

  /**
   * Deactivate a DID.
   */
  async deactivateDID(did: string, reason: string): Promise<{ did: string; deactivated: true }> {
    return this.http.post(`/v1/dids/${encodeURIComponent(did)}/deactivate`, { reason });
  }
}
helix-sdk-js/src/http/HttpAdapter.ts
typescriptimport {
  HelixError,
  type ErrorCode,
  DIDNotFoundError,
  DIDAlreadyExistsError,
  DIDDeactivatedError,
  InvalidPublicKeyError,
  HederaAnchorFailedError,
  InternalError,
} from '@helix-id/core';

export class HttpAdapter {
  constructor(private readonly baseUrl: string) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await response.json() as unknown;

    if (!response.ok) {
      throw this.mapErrorResponse(data);
    }

    return data as T;
  }

  /**
   * Map API error responses to typed SDK errors.
   * This is the SDK-side of EH-6 — typed errors for every API error code.
   */
  private mapErrorResponse(data: unknown): HelixError {
    const errorBody = (data as { error?: { code?: string; message?: string } }).error;
    const code = errorBody?.code as ErrorCode | undefined;
    const message = errorBody?.message ?? 'Unknown error';

    switch (code) {
      case 'DID_NOT_FOUND':
        return new DIDNotFoundError(message);
      case 'DID_ALREADY_EXISTS':
        return new DIDAlreadyExistsError();
      case 'DID_DEACTIVATED':
        return new DIDDeactivatedError(message);
      case 'INVALID_PUBLIC_KEY':
        return new InvalidPublicKeyError();
      case 'HEDERA_ANCHOR_FAILED':
        return new HederaAnchorFailedError();
      default:
        return new InternalError();
    }
  }
}

1.14 — Tests
Unit Tests — helix-core/tests/unit/crypto/keys.test.ts
typescriptimport { describe, it, expect } from 'vitest';
import {
  generateKeyPair,
  derivePublicKey,
  signBytes,
  verifySignature,
  publicKeyToMultibase,
  multibaseToPublicKeyHex,
} from '../../../src/crypto/keys.js';

describe('generateKeyPair', () => {
  it('produces a 64-char hex private key and 64-char hex public key', () => {
    const kp = generateKeyPair();
    expect(kp.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique keypairs on each call', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});

describe('derivePublicKey', () => {
  it('derives the same public key that generateKeyPair returns', () => {
    const kp = generateKeyPair();
    expect(derivePublicKey(kp.privateKey)).toBe(kp.publicKey);
  });
});

describe('signBytes / verifySignature', () => {
  it('signature verifies with matching public key', () => {
    const kp = generateKeyPair();
    const message = new TextEncoder().encode('test message');
    const sig = signBytes(message, kp.privateKey);
    expect(verifySignature(message, sig, kp.publicKey)).toBe(true);
  });

  it('signature fails with wrong public key', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const message = new TextEncoder().encode('test message');
    const sig = signBytes(message, kp1.privateKey);
    expect(verifySignature(message, sig, kp2.publicKey)).toBe(false);
  });

  it('signature fails if message is altered', () => {
    const kp = generateKeyPair();
    const message = new TextEncoder().encode('test message');
    const tampered = new TextEncoder().encode('test messagX');
    const sig = signBytes(message, kp.privateKey);
    expect(verifySignature(tampered, sig, kp.publicKey)).toBe(false);
  });

  it('returns false for malformed signature hex', () => {
    const kp = generateKeyPair();
    const message = new TextEncoder().encode('test');
    expect(verifySignature(message, 'not-hex', kp.publicKey)).toBe(false);
  });
});

describe('publicKeyToMultibase / multibaseToPublicKeyHex', () => {
  it('roundtrips: encode → decode returns original hex', () => {
    const kp = generateKeyPair();
    const multibase = publicKeyToMultibase(kp.publicKey);
    expect(multibase.startsWith('z')).toBe(true);
    expect(multibaseToPublicKeyHex(multibase)).toBe(kp.publicKey);
  });

  it('throws on non-base58btc multibase prefix', () => {
    expect(() => multibaseToPublicKeyHex('u' + 'abc')).toThrow();
  });
});
Unit Tests — helix-core/tests/unit/crypto/did.test.ts
typescriptimport { describe, it, expect } from 'vitest';
import {
  deriveDidFromPublicKey,
  buildDIDDocument,
  extractPublicKeyFromDIDDocument,
  buildServiceEndpoints,
  addServiceEndpoint,
  removeServiceEndpoint,
} from '../../../src/crypto/did.js';
import { generateKeyPair } from '../../../src/crypto/keys.js';

describe('deriveDidFromPublicKey', () => {
  it('produces a did:helix: prefixed string', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    expect(did).toMatch(/^did:helix:[0-9a-f]{32}$/);
  });

  it('produces the same DID for the same public key', () => {
    const { publicKey } = generateKeyPair();
    expect(deriveDidFromPublicKey(publicKey)).toBe(deriveDidFromPublicKey(publicKey));
  });

  it('produces different DIDs for different public keys', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    expect(deriveDidFromPublicKey(kp1.publicKey)).not.toBe(deriveDidFromPublicKey(kp2.publicKey));
  });
});

describe('buildDIDDocument', () => {
  it('contains correct @context', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
  });

  it('id and controller match the DID', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(doc.id).toBe(did);
    expect(doc.controller).toBe(did);
  });

  it('verificationMethod uses Ed25519VerificationKey2020 type', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(doc.verificationMethod[0]?.type).toBe('Ed25519VerificationKey2020');
  });

  it('authentication and assertionMethod reference the key ID', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    const keyId = `${did}#key-1`;
    expect(doc.authentication).toContain(keyId);
    expect(doc.assertionMethod).toContain(keyId);
  });

  it('includes service endpoints when provided', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const endpoints = buildServiceEndpoints(['https://example.com']);
    const doc = buildDIDDocument(did, publicKey, endpoints);
    expect(doc.service).toHaveLength(1);
    expect(doc.service?.[0]?.serviceEndpoint).toBe('https://example.com');
  });

  it('service is undefined when no endpoints provided', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(doc.service).toBeUndefined();
  });
});

describe('extractPublicKeyFromDIDDocument', () => {
  it('extracts the same public key that was used to build the document', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(extractPublicKeyFromDIDDocument(doc)).toBe(publicKey);
  });

  it('throws if no Ed25519 verification method is present', () => {
    const doc = {
      '@context': [],
      id: 'did:helix:abc',
      controller: 'did:helix:abc',
      verificationMethod: [{ id: '#k', type: 'RSAVerificationKey', controller: '#', publicKeyMultibase: 'z123' }],
      authentication: [],
      assertionMethod: [],
    };
    expect(() => extractPublicKeyFromDIDDocument(doc as never)).toThrow();
  });
});

describe('addServiceEndpoint', () => {
  it('adds the endpoint to the document', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    const updated = addServiceEndpoint(doc, {
      id: '#domain-2',
      type: 'LinkedDomains',
      serviceEndpoint: 'https://newdomain.com',
    });
    expect(updated.service).toHaveLength(1);
  });

  it('throws if endpoint ID already exists', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const endpoints = buildServiceEndpoints(['https://example.com']);
    const doc = buildDIDDocument(did, publicKey, endpoints);
    expect(() =>
      addServiceEndpoint(doc, {
        id: '#domain-1',
        type: 'LinkedDomains',
        serviceEndpoint: 'https://other.com',
      }),
    ).toThrow('already exists');
  });

  it('does not mutate the original document', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    const original = JSON.stringify(doc);
    addServiceEndpoint(doc, {
      id: '#domain-1',
      type: 'LinkedDomains',
      serviceEndpoint: 'https://new.com',
    });
    expect(JSON.stringify(doc)).toBe(original);
  });
});

describe('removeServiceEndpoint', () => {
  it('removes the endpoint', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const endpoints = buildServiceEndpoints(['https://a.com', 'https://b.com']);
    const doc = buildDIDDocument(did, publicKey, endpoints);
    const updated = removeServiceEndpoint(doc, '#domain-1');
    expect(updated.service).toHaveLength(1);
    expect(updated.service?.[0]?.id).toBe('#domain-2');
  });

  it('throws if endpoint not found', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const doc = buildDIDDocument(did, publicKey);
    expect(() => removeServiceEndpoint(doc, '#nonexistent')).toThrow('not found');
  });

  it('sets service to undefined when last endpoint is removed', () => {
    const { publicKey } = generateKeyPair();
    const did = deriveDidFromPublicKey(publicKey);
    const endpoints = buildServiceEndpoints(['https://only.com']);
    const doc = buildDIDDocument(did, publicKey, endpoints);
    const updated = removeServiceEndpoint(doc, '#domain-1');
    expect(updated.service).toBeUndefined();
  });
});
Integration Tests — helix-api/tests/integration/did.integration.test.ts
typescriptimport { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import supertest from 'supertest';
import { PrismaClient } from '@prisma/client';
import { MockHederaClient } from '../../src/hedera/mock/MockHederaClient.js';
import { DidRepository } from '../../src/repositories/did.repository.js';
import { DIDService } from '../../src/services/did/did.service.js';
import { ApiAuditLogger } from '../../src/audit/index.js';
import { didRoutes } from '../../src/routes/did/index.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { generateKeyPair } from '@helix-id/core';

// These tests use a real PostgreSQL instance (docker-compose.test.yml)
// and a MockHederaClient. No real Hedera calls.

let app: ReturnType<typeof Fastify>;
let prisma: PrismaClient;
let mockHedera: MockHederaClient;

beforeAll(async () => {
  prisma = new PrismaClient({
    datasources: { db: { url: process.env['DATABASE_URL'] } },
  });

  mockHedera = new MockHederaClient();
  const auditLogger = new ApiAuditLogger(prisma);
  const didRepository = new DidRepository(prisma);
  const didService = new DIDService(didRepository, mockHedera, auditLogger);

  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(didRoutes, { didService });
  await app.ready();
});

afterEach(async () => {
  // Clean DB state between tests — prevents test pollution
  await prisma.auditLog.deleteMany();
  await prisma.didUpdate.deleteMany();
  await prisma.did.deleteMany();
  mockHedera.reset();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('POST /v1/dids', () => {
  it('creates a DID and returns 201', async () => {
    const { publicKey } = generateKeyPair();
    const response = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    expect(response.body.did).toMatch(/^did:helix:[0-9a-f]{32}$/);
    expect(response.body.didDocument.id).toBe(response.body.did);
    expect(response.body.hederaTransactionId).toMatch(/^mock-tx-/);
  });

  it('creates DID with service endpoints', async () => {
    const { publicKey } = generateKeyPair();
    const response = await supertest(app.server)
      .post('/v1/dids')
      .send({
        publicKeyHex: publicKey,
        subjectType: 'agent',
        domains: ['https://myagent.example.com'],
      })
      .expect(201);

    expect(response.body.didDocument.service).toHaveLength(1);
    expect(response.body.didDocument.service[0].serviceEndpoint).toBe(
      'https://myagent.example.com',
    );
  });

  it('returns 409 if same public key is submitted twice', async () => {
    const { publicKey } = generateKeyPair();
    await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    const response = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(409);

    expect(response.body.error.code).toBe('DID_ALREADY_EXISTS');
  });

  it('returns 400 for invalid public key (too short)', async () => {
    const response = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: 'abc123', subjectType: 'agent' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for non-hex characters in public key', async () => {
    const invalidKey = 'z'.repeat(64);
    await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: invalidKey, subjectType: 'agent' })
      .expect(400);
  });

  it('returns 400 for HTTP (non-HTTPS) service endpoint', async () => {
    const { publicKey } = generateKeyPair();
    const response = await supertest(app.server)
      .post('/v1/dids')
      .send({
        publicKeyHex: publicKey,
        subjectType: 'agent',
        domains: ['http://insecure.com'],
      })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_SERVICE_ENDPOINT_URL');
  });

  it('anchors the DID document on Hedera', async () => {
    const { publicKey } = generateKeyPair();
    await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    expect(mockHedera.anchoredPayloads).toHaveLength(1);
    const anchored = JSON.parse(mockHedera.anchoredPayloads[0]!);
    expect(anchored['@context']).toContain('https://www.w3.org/ns/did/v1');
  });

  it('writes a DID_CREATED audit log entry', async () => {
    const { publicKey } = generateKeyPair();
    await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    const log = await prisma.auditLog.findFirst({ where: { eventType: 'DID_CREATED' } });
    expect(log).not.toBeNull();
    const payload = JSON.parse(log!.payloadJson);
    expect(payload.did).toMatch(/^did:helix:/);
    // SA-8: no private key in audit log
    expect(log!.payloadJson).not.toContain('privateKey');
  });
});

describe('GET /v1/dids/:did', () => {
  it('resolves an existing DID', async () => {
    const { publicKey } = generateKeyPair();
    const create = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    const resolve = await supertest(app.server)
      .get(`/v1/dids/${create.body.did}`)
      .expect(200);

    expect(resolve.body.did).toBe(create.body.did);
    expect(resolve.body.source).toBe('cache');
  });

  it('returns 404 for unknown DID', async () => {
    const response = await supertest(app.server)
      .get('/v1/dids/did:helix:' + 'a'.repeat(32))
      .expect(404);

    expect(response.body.error.code).toBe('DID_NOT_FOUND');
  });

  it('returns 400 for malformed DID format', async () => {
    await supertest(app.server).get('/v1/dids/not-a-did').expect(400);
  });

  it('returns 410 for deactivated DID', async () => {
    const { publicKey } = generateKeyPair();
    const create = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    await supertest(app.server)
      .post(`/v1/dids/${create.body.did}/deactivate`)
      .send({ reason: 'test' })
      .expect(200);

    const response = await supertest(app.server)
      .get(`/v1/dids/${create.body.did}`)
      .expect(410);

    expect(response.body.error.code).toBe('DID_DEACTIVATED');
  });
});

describe('POST /v1/dids/:did/services', () => {
  it('adds a service endpoint', async () => {
    const { publicKey } = generateKeyPair();
    const create = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    const update = await supertest(app.server)
      .post(`/v1/dids/${create.body.did}/services`)
      .send({ id: '#domain-1', type: 'LinkedDomains', serviceEndpoint: 'https://example.com' })
      .expect(200);

    expect(update.body.didDocument.service).toHaveLength(1);
    // Check update was re-anchored on Hedera
    expect(mockHedera.anchoredPayloads).toHaveLength(2); // create + update
  });

  it('returns 409 if endpoint ID already exists', async () => {
    const { publicKey } = generateKeyPair();
    const create = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    await supertest(app.server)
      .post(`/v1/dids/${create.body.did}/services`)
      .send({ id: '#domain-1', type: 'LinkedDomains', serviceEndpoint: 'https://a.com' })
      .expect(200);

    const response = await supertest(app.server)
      .post(`/v1/dids/${create.body.did}/services`)
      .send({ id: '#domain-1', type: 'LinkedDomains', serviceEndpoint: 'https://b.com' })
      .expect(409);

    expect(response.body.error.code).toBe('SERVICE_ENDPOINT_ALREADY_EXISTS');
  });
});

describe('DELETE /v1/dids/:did/services/:endpointId', () => {
  it('removes a service endpoint', async () => {
    const { publicKey } = generateKeyPair();
    const create = await supertest(app.server)
      .post('/v1/dids')
      .send({
        publicKeyHex: publicKey,
        subjectType: 'agent',
        domains: ['https://example.com'],
      })
      .expect(201);

    const update = await supertest(app.server)
      .delete(`/v1/dids/${create.body.did}/services/%23domain-1`)
      .expect(200);

    expect(update.body.didDocument.service).toBeUndefined();
  });

  it('returns 404 if endpoint does not exist', async () => {
    const { publicKey } = generateKeyPair();
    const create = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    const response = await supertest(app.server)
      .delete(`/v1/dids/${create.body.did}/services/%23nonexistent`)
      .expect(404);

    expect(response.body.error.code).toBe('SERVICE_ENDPOINT_NOT_FOUND');
  });
});
Security Tests — helix-api/tests/security/did.security.test.ts
typescriptimport { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import supertest from 'supertest';
import { PrismaClient } from '@prisma/client';
import { MockHederaClient } from '../../src/hedera/mock/MockHederaClient.js';
import { DidRepository } from '../../src/repositories/did.repository.js';
import { DIDService } from '../../src/services/did/did.service.js';
import { ApiAuditLogger } from '../../src/audit/index.js';
import { didRoutes } from '../../src/routes/did/index.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { generateKeyPair } from '@helix-id/core';

// SECURITY TESTS: these may NEVER be skipped. See SA-10.

let app: ReturnType<typeof Fastify>;
let prisma: PrismaClient;
let mockHedera: MockHederaClient;

beforeAll(async () => {
  prisma = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL'] } } });
  mockHedera = new MockHederaClient();
  const auditLogger = new ApiAuditLogger(prisma);
  const didRepository = new DidRepository(prisma);
  const didService = new DIDService(didRepository, mockHedera, auditLogger);
  app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(didRoutes, { didService });
  await app.ready();
});

afterEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.didUpdate.deleteMany();
  await prisma.did.deleteMany();
  mockHedera.reset();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('SECURITY: DID deduplication', () => {
  it('rejects second DID creation for same public key — prevents key reuse', async () => {
    const { publicKey } = generateKeyPair();

    await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    const second = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'user' })
      .expect(409);

    expect(second.body.error.code).toBe('DID_ALREADY_EXISTS');
    // Exactly one DID in DB — second attempt did not create a record
    const count = await prisma.did.count();
    expect(count).toBe(1);
  });
});

describe('SECURITY: Deactivated DID cannot be used', () => {
  it('deactivated DID is not resolvable', async () => {
    const { publicKey } = generateKeyPair();
    const create = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    await supertest(app.server)
      .post(`/v1/dids/${create.body.did}/deactivate`)
      .send({ reason: 'key compromised' })
      .expect(200);

    await supertest(app.server).get(`/v1/dids/${create.body.did}`).expect(410);
  });

  it('cannot add service endpoint to deactivated DID', async () => {
    const { publicKey } = generateKeyPair();
    const create = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    await supertest(app.server)
      .post(`/v1/dids/${create.body.did}/deactivate`)
      .send({ reason: 'test' })
      .expect(200);

    const response = await supertest(app.server)
      .post(`/v1/dids/${create.body.did}/services`)
      .send({ id: '#d', type: 'LinkedDomains', serviceEndpoint: 'https://x.com' })
      .expect(410);

    expect(response.body.error.code).toBe('DID_DEACTIVATED');
  });
});

describe('SECURITY: Audit log integrity for DID operations', () => {
  it('DID_CREATED audit entry contains no private key', async () => {
    const { publicKey } = generateKeyPair();
    await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    const logs = await prisma.auditLog.findMany();
    for (const log of logs) {
      expect(log.payloadJson).not.toMatch(/private[Kk]ey/);
      expect(log.payloadJson).not.toMatch(/[0-9a-f]{64}/); // no raw hex private key
    }
  });

  it('DID_DEACTIVATED audit entry is written on deactivation', async () => {
    const { publicKey } = generateKeyPair();
    const create = await supertest(app.server)
      .post('/v1/dids')
      .send({ publicKeyHex: publicKey, subjectType: 'agent' })
      .expect(201);

    await supertest(app.server)
      .post(`/v1/dids/${create.body.did}/deactivate`)
      .send({ reason: 'key lost' })
      .expect(200);

    const log = await prisma.auditLog.findFirst({ where: { eventType: 'DID_DEACTIVATED' } });
    expect(log).not.toBeNull();
    const payload = JSON.parse(log!.payloadJson);
    expect(payload.reason).toBe('key lost');
  });
});

describe('SECURITY: Non-HTTPS service endpoints rejected', () => {
  it('rejects http:// domains', async () => {
    const { publicKey } = generateKeyPair();
    const response = await supertest(app.server)
      .post('/v1/dids')
      .send({
        publicKeyHex: publicKey,
        subjectType: 'agent',
        domains: ['http://notallowed.com'],
      })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_SERVICE_ENDPOINT_URL');
    // No DID created
    const count = await prisma.did.count();
    expect(count).toBe(0);
  });

  it('rejects ftp:// domains', async () => {
    const { publicKey } = generateKeyPair();
    await supertest(app.server)
      .post('/v1/dids')
      .send({
        publicKeyHex: publicKey,
        subjectType: 'agent',
        domains: ['ftp://old-school.com'],
      })
      .expect(400);
  });
});

Story 1 Acceptance Criteria
B1 is complete when:

 POST /v1/dids creates a DID, anchors on Hedera (mock in tests, real in dev), returns DID + DID document + Hedera transaction ID
 GET /v1/dids/:did resolves a DID from DB cache; ?live=true fetches from Hedera
 POST /v1/dids/:did/services adds a service endpoint and re-anchors
 DELETE /v1/dids/:did/services/:endpointId removes a service endpoint and re-anchors
 POST /v1/dids/:did/deactivate deactivates the DID — all subsequent operations return 410
 All error codes defined in helix-core, all error responses match the structured format
 All audit events from AL-1 that apply to B1 are emitted — checked by integration tests via DB assertions
 No private key appears in any log, error response, or audit entry (security tests verify)
 MockHederaClient used in all unit and integration tests — no real Hedera calls in CI
 OpenAPI spec is complete for all B1 endpoints before implementation was written
 Unit test coverage ≥ 95% for helix-core crypto and did modules
 Integration tests cover all happy paths and all error paths listed above
 All security tests in tests/security/did.security.test.ts pass and none are skipped
 npm run build compiles without errors
 decisions.md updated with @hashgraph/sdk entry