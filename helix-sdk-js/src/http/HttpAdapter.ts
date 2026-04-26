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
      throw new Error(payload.error?.message ?? 'Request failed');
    }
    return (await response.json()) as T;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { code?: string; message?: string } };
      throw new Error(payload.error?.message ?? 'Request failed');
    }
    return (await response.json()) as T;
  }
}
