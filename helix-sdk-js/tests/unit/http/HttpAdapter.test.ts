import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HttpAdapter } from '../../../src/http/HttpAdapter.js';

describe('HttpAdapter', () => {
  let adapter: HttpAdapter;

  beforeEach(() => {
    adapter = new HttpAdapter('http://localhost');
    vi.stubGlobal('fetch', vi.fn());
  });

  it('performs successful POST', async () => {
    const mockData = { success: true };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockData
    });

    const result = await adapter.post('/test', { foo: 'bar' });
    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledWith('http://localhost/test', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ foo: 'bar' })
    }));
  });

  it('throws error on failed POST', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Failed' } })
    });

    await expect(adapter.post('/test', {})).rejects.toThrow('Failed');
  });

  it('performs successful GET', async () => {
    const mockData = { data: 123 };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockData
    });

    const result = await adapter.get('/test');
    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledWith('http://localhost/test');
  });

  it('throws error on failed GET', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Not Found' } })
    });

    await expect(adapter.get('/test')).rejects.toThrow('Not Found');
  });

  it('throws default error if no message in payload (POST/GET)', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({})
    });

    await expect(adapter.post('/test', {})).rejects.toThrow('Request failed');
    await expect(adapter.get('/test')).rejects.toThrow('Request failed');
  });
});
