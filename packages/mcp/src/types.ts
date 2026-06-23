import type { SignedVP } from '@helixid/core';

export interface MCPToolCall {
  name?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MCPMiddlewareOptions {
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
