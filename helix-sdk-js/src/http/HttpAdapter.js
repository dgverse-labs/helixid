import { mapApiError } from '../errors/index.js';
export class HttpAdapter {
    baseUrl;
    adminApiKey;
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.adminApiKey = options.adminApiKey;
    }
    async get(path) {
        return this.request('GET', path);
    }
    async post(path, body) {
        return this.request('POST', path, body);
    }
    async delete(path) {
        return this.request('DELETE', path);
    }
    async request(method, path, body) {
        const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
        const init = {
            method,
            headers: {
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                ...(this.adminApiKey ? { 'x-admin-api-key': this.adminApiKey } : {}),
            },
        };
        if (body !== undefined) {
            init.body = JSON.stringify(body);
        }
        const response = await fetch(url, init);
        if (response.status === 204) {
            return {};
        }
        const data = await response.json();
        if (!response.ok) {
            throw this.mapErrorResponse(data, response.status);
        }
        return data;
    }
    mapErrorResponse(data, status) {
        return mapApiError({ ...(typeof data === 'object' && data !== null ? data : {}), status });
    }
}
//# sourceMappingURL=HttpAdapter.js.map