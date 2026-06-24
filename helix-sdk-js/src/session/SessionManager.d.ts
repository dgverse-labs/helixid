import type { DelegationLink } from '@helixid/core';
export interface SessionManagerOptions {
    secret: string;
    ttl: number;
}
export interface SessionIssueInput {
    agentDid: string;
    scopes: string[];
    delegationChain?: DelegationLink[];
}
export interface SessionClaims {
    agentDid: string;
    scopes: string[];
    delegationChain: DelegationLink[];
    iat: number;
    exp: number;
    jti: string;
}
export declare class SessionManager {
    private readonly secret;
    private readonly ttl;
    constructor(options: SessionManagerOptions);
    issue(input: SessionIssueInput): Promise<string>;
    verify(token: string): Promise<SessionClaims>;
}
//# sourceMappingURL=SessionManager.d.ts.map