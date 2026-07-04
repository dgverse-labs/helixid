export declare class HttpAdapter {
    private readonly baseUrl;
    private readonly adminApiKey;
    constructor(baseUrl: string, options?: {
        adminApiKey?: string;
    });
    get<T>(path: string): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    delete<T>(path: string): Promise<T>;
    hasAdminApiKey(): boolean;
    private request;
    private mapErrorResponse;
}
//# sourceMappingURL=HttpAdapter.d.ts.map
