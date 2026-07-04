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
import { AdminAuthRequiredError } from '@helixid/core';
import { IVCService } from '../../services/vc/vc.service.js';

export interface StatusListRouteOptions {
  vcService: IVCService;
  adminApiKey?: string | undefined;
}

/**
 * Public Status List Endpoint (Boundary 2).
 */
const statusListRoutes: FastifyPluginAsync<StatusListRouteOptions> = async (fastify, options) => {
  const { vcService, adminApiKey } = options;

  function requireAdmin(request: { headers: Record<string, string | string[] | undefined> }): void {
    const submitted = request.headers['x-admin-api-key'];
    const submittedKey = Array.isArray(submitted) ? submitted[0] : submitted;
    if (!adminApiKey || submittedKey !== adminApiKey) {
      throw new AdminAuthRequiredError();
    }
  }

  // GET /v1/status-list/:listId - Serve the Status List Credential
  fastify.get('/:listId', async (request, reply) => {
    const { listId } = request.params as { listId: string };
    const result = await vcService.getStatusList(listId);
    
    // Cache-friendly per STORY_2.md §152
    return reply
      .header('Cache-Control', 'public, max-age=300')
      .send(result);
  });

  // POST /v1/status-list - Create or replace the default Status List Credential
  fastify.post('', async (request, reply) => {
    requireAdmin(request);
    const body = (request.body as { listId?: string; length?: number } | undefined) ?? {};
    const input: { listId?: string; length?: number } = {};
    if (body.listId !== undefined) input.listId = body.listId;
    if (body.length !== undefined) input.length = body.length;
    const result = await vcService.createStatusList(input);
    return reply.status(201).send(result);
  });
};

export default statusListRoutes;
