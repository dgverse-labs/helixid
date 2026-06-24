// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HelixDidResolver } from '../../src/resolver/HelixDidResolver.js';
import { ErrorCode } from '@helixid/core';

describe('HelixDidResolver', () => {
  const baseUrl = 'http://api.test';
  const resolver = new HelixDidResolver({ baseUrl });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('resolves an active DID successfully', async () => {
    const mockDoc = { id: 'did:helix:123', controller: 'did:helix:123' };
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockDoc,
    });

    const result = await resolver.resolve('did:helix:123');
    
    expect(result.didDocument).toEqual(mockDoc);
    expect(result.didResolutionMetadata.deactivated).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/dids/did%3Ahelix%3A123'),
      expect.any(Object)
    );
  });

  it('handles 404 Not Found', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND' } }),
    });

    const result = await resolver.resolve('did:helix:none');
    
    expect(result.didDocument).toBeNull();
    expect(result.didResolutionMetadata.error).toBe('notFound');
  });

  it('handles 410 Gone / Deactivated', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({ deactivated: true, document: { id: 'did:helix:old' } }),
    });

    const result = await resolver.resolve('did:helix:old');
    
    expect(result.didResolutionMetadata.deactivated).toBe(true);
    expect(result.didDocumentMetadata.deactivated).toBe(true);
  });

  it('re-throws API errors as typed HelixErrors', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ 
        error: { 
          code: ErrorCode.VALIDATION_ERROR, 
          message: 'Invalid DID' 
        } 
      }),
    });

    await expect(resolver.resolve('invalid')).rejects.toThrow();
    try {
      await resolver.resolve('invalid');
    } catch (e: any) {
      expect(e.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(e.name).toBe('HelixError');
    }
  });
});
