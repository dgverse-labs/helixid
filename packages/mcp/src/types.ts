import type { SignedVP } from '@helixid/sdk-js';
import type { HelixClient } from '@helixid/sdk-js';

export interface MCPToolCall {
  name?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MCPMiddlewareOptions {
  /**
   * Required now that verification calls the API (see
   * docs/proposal-sdk-api-only.md) rather than verifying locally.
   */
  client: HelixClient;
  requiredScopes?: string[];
  allowSelfSigned?: boolean;
}

export interface AttachHelixVPOptions {
  walletPassphrase: string;
  walletFilePath: string;
  targetService: string;
  userDid?: string;
}

export type HelixVPInput = SignedVP;
