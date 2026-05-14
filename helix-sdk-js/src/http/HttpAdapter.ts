export class HttpAdapter {
  constructor(private readonly baseUrl: string) {}

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } };
      throw this.toError(payload);
    }
    return (await response.json()) as T;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } };
      throw this.toError(payload);
    }
    return (await response.json()) as T;
  }

  async delete<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } };
      throw this.toError(payload);
    }
    return (await response.json()) as T;
  }

  private toError(payload: { error?: { code?: string; message?: string } }): Error {
    const message = payload.error?.message ?? 'Request failed';
    const error = new Error(message);
    if (payload.error?.code) {
      (error as Error & { code?: string }).code = payload.error.code;
    }
    return error;
  }
}
