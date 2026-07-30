import { InsufficientScopeError, } from '@helixid/core';
export function checkScope(result, requiredScope) {
    // Enforcement reads effectiveScopes: identical to privilegeScopes when no
    // consent grant is in the VP, the grant intersection when one is (§2.7).
    return result.effectiveScopes.includes(requiredScope);
}
export function requireScope(result, requiredScope) {
    if (!checkScope(result, requiredScope)) {
        throw new InsufficientScopeError(requiredScope);
    }
}
//# sourceMappingURL=scope.js.map