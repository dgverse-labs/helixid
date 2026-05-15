// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HelixDidResolver } from '../../../src/resolver/HelixDidResolver.js';

describe('HelixDidResolver Branch Coverage', () => {
  let resolver: HelixDidResolver;
  const baseUrl = 'http://localhost';

  beforeEach(() => {
    resolver = new HelixDidResolver({ baseUrl });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('handles baseUrl with trailing slash', () => {
    const r2 = new HelixDidResolver({ baseUrl: 'http://localhost/' });
    expect((r2 as any).baseUrl).toBe('http://localhost');
  });

  it('handles live option', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'did:1' })
    } as any);

    await resolver.resolve('did:1', { live: true });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('live=true'), expect.anything());
  });

  it('returns notFound for 404', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404
    } as any);

    const res = await resolver.resolve('did:1');
    expect(res.didResolutionMetadata.error).toBe('notFound');
  });

  it('handles 410 deactivated status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 410,
      json: () => Promise.resolve({ document: { id: 'did:1' } })
    } as any);

    const res = await resolver.resolve('did:1');
    expect(res.didResolutionMetadata.deactivated).toBe(true);
    expect(res.didDocument).toEqual({ id: 'did:1' });
  });

  it('handles 410 with missing document', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 410,
      json: () => Promise.resolve({})
    } as any);

    const res = await resolver.resolve('did:1');
    expect(res.didDocument).toBeNull();
  });

  it('handles deactivated flag in successful body with missing document', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ deactivated: true })
    } as any);

    const res = await resolver.resolve('did:1');
    expect(res.didResolutionMetadata.deactivated).toBe(true);
    expect(res.didDocument).toBeNull();
  });

  it('handles deactivated flag in successful body', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ deactivated: true, document: { id: 'did:1' } })
    } as any);

    const res = await resolver.resolve('did:1');
    expect(res.didResolutionMetadata.deactivated).toBe(true);
    expect(res.didDocument).toEqual({ id: 'did:1' });
  });

  it('rethrows unexpected fetch errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network fail'));
    await expect(resolver.resolve('did:1')).rejects.toThrow('network fail');
  });
});
