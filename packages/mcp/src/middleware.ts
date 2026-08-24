import { HelixError, VPMissingError, VPVerificationFailedError, type SignedVP } from '@helixid/core';
import { requireScope, verifyVP } from '@helixid/sdk-js';
import type { MCPToolCall, MCPMiddlewareOptions } from './types.js';

export function helixidMCPMiddleware(options: MCPMiddlewareOptions) {
  return async (toolCall: MCPToolCall): Promise<MCPToolCall> => {
    const vp = toolCall.input?._helixVP as SignedVP | undefined;
    if (!vp) {
      throw new VPMissingError();
    }

    const result = await verifyVP(vp, options.client, {
      allowSelfSigned: options.allowSelfSigned ?? false,
    });

    if (!result.valid) {
      throw new VPVerificationFailedError(result.error);
    }

    for (const scope of options.requiredScopes ?? []) {
      requireScope(result, scope);
    }

    return toolCall;
  };
}
