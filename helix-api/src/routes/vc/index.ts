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

import { FastifyPluginAsync } from 'fastify';
import { AdminAuthRequiredError } from '@helix-id/core';
import type { IVCService, IssueVCParams, RenewVCOptions } from '../../services/vc/vc.service.js';

export interface VcRouteOptions {
  vcService: IVCService;
  adminApiKey?: string | undefined;
}

interface VCParams {
  vcId: string;
}

/**
 * VC API Route Definitions (Boundary 2).
 */
const vcRoutes: FastifyPluginAsync<VcRouteOptions> = async (fastify, options) => {
  const { vcService, adminApiKey } = options;

  function requireAdmin(request: { headers: Record<string, string | string[] | undefined> }): void {
    const submitted = request.headers['x-admin-api-key'];
    const submittedKey = Array.isArray(submitted) ? submitted[0] : submitted;
    if (!adminApiKey || submittedKey !== adminApiKey) {
      throw new AdminAuthRequiredError();
    }
  }

  // POST /v1/vcs - Issue a VC
  fastify.post('', async (request, reply) => {
    requireAdmin(request);
    const params = request.body as IssueVCParams;
    const result = await vcService.issueVC(params, request.id);
    return reply.status(201).send(result);
  });

  // GET /v1/vcs/:vcId - Get VC details
  fastify.get('/:vcId', async (request, reply) => {
    const { vcId } = request.params as VCParams;
    const result = await vcService.getVC(vcId, request.id);
    return reply.send(result);
  });

  // POST /v1/vcs/:vcId/revoke - Revoke a VC
  fastify.post('/:vcId/revoke', async (request, reply) => {
    requireAdmin(request);
    const { vcId } = request.params as VCParams;
    const result = await vcService.revokeVC(vcId, request.id);
    return reply.send(result);
  });

  // POST /v1/vcs/:vcId/renew - Renew a VC
  fastify.post('/:vcId/renew', async (request, reply) => {
    requireAdmin(request);
    const { vcId } = request.params as VCParams;
    const overrides = request.body as RenewVCOptions;
    const result = await vcService.renewVC(vcId, overrides, request.id);
    return reply.status(201).send(result);
  });
};

export default vcRoutes;
