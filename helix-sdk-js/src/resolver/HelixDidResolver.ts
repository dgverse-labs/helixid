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

import type { IDidResolver } from './IDidResolver.js';
import type { DIDResolutionResult } from './types.js';
import { mapApiError } from '../errors/index.js';

export interface HelixDidResolverOptions {
  baseUrl: string;
}

type ResolveApiResponse = {
  document?: DIDResolutionResult['didDocument'];
  deactivated?: boolean;
} & NonNullable<DIDResolutionResult['didDocument']>;

/**
 * DID Resolver implementation that uses the Helix ID API.
 */
export class HelixDidResolver implements IDidResolver {
  private baseUrl: string;

  constructor(options: HelixDidResolverOptions) {
    this.baseUrl = options.baseUrl.endsWith('/') 
      ? options.baseUrl.slice(0, -1) 
      : options.baseUrl;
  }

  async resolve(did: string, options: { live?: boolean } = {}): Promise<DIDResolutionResult> {
    const url = new URL(`${this.baseUrl}/v1/dids/${encodeURIComponent(did)}`);
    if (options.live) {
      url.searchParams.append('live', 'true');
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/did+ld+json,application/json',
        },
      });

      if (response.status === 404) {
        return {
          didDocument: null,
          didResolutionMetadata: { error: 'notFound' },
          didDocumentMetadata: {},
        };
      }

      if (response.status === 410) {
        // Special case for DIDs that are permanently deactivated
        const body = (await response.json()) as ResolveApiResponse;
        return {
          didDocument: body.document || null,
          didResolutionMetadata: { deactivated: true },
          didDocumentMetadata: { deactivated: true },
        };
      }

      const body = (await response.json()) as ResolveApiResponse;

      if (!response.ok) {
        throw mapApiError(body);
      }

      // Handle successful response (might still have deactivated flag in body from our API implementation)
      const isDeactivated = body.deactivated === true;

      return {
        didDocument: isDeactivated ? (body.document || null) : body,
        didResolutionMetadata: { 
          contentType: 'application/did+ld+json',
          deactivated: isDeactivated
        },
        didDocumentMetadata: {
          deactivated: isDeactivated
        },
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'HelixError') {
        throw error;
      }
      // Re-wrap generic network errors if necessary
      throw error;
    }
  }
}
