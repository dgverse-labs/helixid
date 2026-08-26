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
//
// See docs/proposal-hosted-instance.md ("DID auto-provisioning"). Serves
// the did:web:<domain>:accounts:<accountId> document straight from the
// hosted database — this is exactly how did:web with path segments is
// meant to resolve, no special-casing needed beyond routing the path.

import type { FastifyPluginAsync } from 'fastify';
import type { DIDDocument } from '../../core/index.js';
import { buildAccountIssuerDid } from '../../services/auth/provision-issuer-did.js';

interface AccountDidRouteOptions {
  didDomain: string;
  didRepository: {
    findDidById(did: string): Promise<{ didDocument: unknown } | null>;
  };
}

const accountDidRoutes: FastifyPluginAsync<AccountDidRouteOptions> = async (fastify, options) => {
  fastify.get('/accounts/:accountId/did.json', async (request, reply) => {
    const { accountId } = request.params as { accountId: string };
    const did = buildAccountIssuerDid(options.didDomain, accountId);
    const record = await options.didRepository.findDidById(did);
    if (!record) {
      return reply.code(404).send({
        error: { code: 'DID_NOT_FOUND', message: 'No account DID document found for this id.' },
      });
    }
    return reply
      .type('application/json')
      .header('Cache-Control', 'public, max-age=3600')
      .send(record.didDocument as DIDDocument);
  });
};

export default accountDidRoutes;
