export declare function runVcIssue(options: {
    agentDid: string;
    scopes: string;
    expires: string;
    statusList: string;
    baseUrl: string;
    wallet: string;
    output?: string;
    maxDelegationDepth: number;
}): Promise<void>;
export declare function runVcSelfIssue(options: {
    scopes: string;
    expires: string;
    wallet: string;
}): Promise<void>;
//# sourceMappingURL=vc.d.ts.map