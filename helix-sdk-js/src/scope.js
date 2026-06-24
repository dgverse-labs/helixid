import { InsufficientScopeError, } from '@helixid/core';
export function checkScope(result, requiredScope) {
    return result.privilegeScopes.includes(requiredScope);
}
export function requireScope(result, requiredScope) {
    if (!checkScope(result, requiredScope)) {
        throw new InsufficientScopeError(requiredScope);
    }
}
//# sourceMappingURL=scope.js.map