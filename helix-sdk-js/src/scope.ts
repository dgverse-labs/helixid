import {
  InsufficientScopeError,
  type VerifyVPResult,
} from '@helix-id/core';

export function checkScope(result: VerifyVPResult, requiredScope: string): boolean {
  return result.privilegeScopes.includes(requiredScope);
}

export function requireScope(result: VerifyVPResult, requiredScope: string): void {
  if (!checkScope(result, requiredScope)) {
    throw new InsufficientScopeError(requiredScope);
  }
}
