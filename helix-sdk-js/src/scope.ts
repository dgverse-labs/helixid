import {
  InsufficientScopeError,
  type VerifyVPResult,
} from '@helixid/core';

export function checkScope(result: VerifyVPResult, requiredScope: string): boolean {
  // Enforcement reads effectiveScopes: identical to privilegeScopes when no
  // consent grant is in the VP, the grant intersection when one is (§2.7).
  return result.effectiveScopes.includes(requiredScope);
}

export function requireScope(result: VerifyVPResult, requiredScope: string): void {
  if (!checkScope(result, requiredScope)) {
    throw new InsufficientScopeError(requiredScope);
  }
}
