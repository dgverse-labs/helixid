import { HelixError } from '@helix-id/core';
import { mapApiError } from '../errors/index.js';

export class HttpAdapter {
  private readonly baseUrl: string;
  private readonly adminApiKey: string | undefined;

  constructor(baseUrl: string, options: { adminApiKey?: string } = {}) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.adminApiKey = options.adminApiKey;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const init: RequestInit = {
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
      return {} as T;
    }

    const data = await response.json();
    if (!response.ok) {
      throw this.mapErrorResponse(data, response.status);
    }
    return data as T;
  }

  private mapErrorResponse(data: unknown, status: number): HelixError {
    return mapApiError({ ...(typeof data === 'object' && data !== null ? data : {}), status });
  }
}
