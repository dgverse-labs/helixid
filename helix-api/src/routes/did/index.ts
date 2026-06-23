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

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ErrorCode, HelixError, type ServiceEndpoint } from '@helixid/core';
import type { IDIDService } from '../../services/did/did.service.js';

interface DIDRouteOptions {
  didService: IDIDService;
}

interface CreateDIDBody {
  publicKeyHex: string;
  subjectType: 'agent' | 'user';
  domains?: string[];
}

interface DIDParams {
  did: string;
}

interface ResolveDIDQuery {
  live?: boolean;
}

interface DIDServiceEndpointParams extends DIDParams {
  endpointId: string;
}

/**
 * Routes for DID Management (Boundary 1).
 */
const didRoutes: FastifyPluginAsync<DIDRouteOptions> = async (fastify: FastifyInstance, options) => {
  const { didService } = options;

  const didPattern = '^did:hedera:testnet:[a-zA-Z0-9._-]+$';
  // Pattern for Ed25519 public key: 64 hex chars
  const publicKeyPattern = '^[0-9a-fA-F]{64}$';

  // POST /v1/dids - Create a new DID
  fastify.post('/v1/dids', {
    schema: {
      description: 'Create a new Helix DID from a public key',
      tags: ['DID Lifecycle'],
      body: {
        type: 'object',
        required: ['publicKeyHex', 'subjectType'],
        properties: {
          publicKeyHex: { 
            type: 'string', 
            pattern: publicKeyPattern, 
            description: 'Hex-encoded Ed25519 public key (32 bytes)' 
          },
          subjectType: { 
            type: 'string', 
            enum: ['agent', 'user'],
            description: 'The type of subject this DID represents'
          },
          domains: {
            type: 'array',
            items: { type: 'string', format: 'uri', pattern: '^https://' },
            maxItems: 10,
            description: 'Optional linked domain service endpoints',
          },
        },
      },
      response: {
        201: {
          description: 'DID created successfully',
          type: 'object',
          required: ['id', 'subjectType', 'publicKey', 'didDocument'],
          properties: {
            id: { type: 'string', pattern: didPattern },
            subjectType: { type: 'string' },
            controller: { type: 'string' },
            publicKey: { type: 'string' },
            hederaTransactionId: { type: 'string' },
            didDocument: { type: 'object', additionalProperties: true }
          }
        },
        400: { $ref: 'BadRequest#' },
        409: { $ref: 'Conflict#' }
      }
    },
    handler: async (request, reply) => {
      const { publicKeyHex, subjectType, domains = [] } = request.body as CreateDIDBody;
      const result = await didService.createDID(publicKeyHex, subjectType, domains, request.id);
      return reply.status(201).send({
        id: result.did,
        subjectType,
        controller: result.didDocument.controller,
        publicKey: publicKeyHex,
        hederaTransactionId: result.hederaTransactionId,
        didDocument: result.didDocument,
      });
    },
  });

  // GET /v1/dids/:did - Resolve a DID
  fastify.get('/v1/dids/:did', {
    schema: {
      description: 'Resolve a Helix DID to its current DID Document',
      tags: ['DID Lifecycle'],
      params: {
        type: 'object',
        required: ['did'],
        properties: {
          did: { type: 'string', pattern: didPattern, description: 'The DID to resolve' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          live: { 
            type: 'boolean', 
            description: 'If true, forces a live resolution from Hedera HCS instead of the local cache' 
          },
        },
      },
      response: {
        200: {
          description: 'Successful resolution',
          type: 'object',
          required: ['id'],
          properties: {
            '@context': { type: 'array', items: { type: 'string' } },
            id: { type: 'string', pattern: didPattern },
            controller: { type: 'string' },
            verificationMethod: { type: 'array', items: { type: 'object', additionalProperties: true } },
            authentication: { type: 'array', items: { type: 'string' } },
            assertionMethod: { type: 'array', items: { type: 'string' } },
            service: { type: 'array', items: { type: 'object', additionalProperties: true } }
          }
        },
        404: { $ref: 'NotFound#' }
      }
    },
    handler: async (request) => {
      const { did } = request.params as DIDParams;
      const { live } = request.query as ResolveDIDQuery;
      const result = await didService.resolveDID(
        did,
        typeof live === 'boolean' ? { live } : {},
        request.id,
      );
      
      if (result.deactivated) {
        throw new HelixError(ErrorCode.DID_DEACTIVATED, 'DID is deactivated', 410, { did });
      }
      
      return result.document;
    },
  });

  // POST /v1/dids/:did/services - Add a service endpoint
  fastify.post('/v1/dids/:did/services', {
    schema: {
      description: 'Add a new service endpoint to a DID Document',
      tags: ['DID Updates'],
      params: { 
        type: 'object', 
        required: ['did'], 
        properties: { did: { type: 'string', pattern: didPattern } } 
      },
      body: {
        type: 'object',
        required: ['id', 'type', 'serviceEndpoint'],
        properties: {
          id: { type: 'string', description: 'Fragment identifier (e.g. #service-1)' },
          type: { type: 'string' },
          serviceEndpoint: { type: 'string', format: 'uri', pattern: '^https://' },
        },
      },
      response: {
        200: {
          description: 'DID updated successfully',
          type: 'object',
          additionalProperties: true
        },
        404: { $ref: 'NotFound#' },
        410: { description: 'DID Deactivated', content: { 'application/json': { schema: { $ref: 'Error#' } } } }
      }
    },
    handler: async (request) => {
      const { did } = request.params as DIDParams;
      const endpoint = request.body as ServiceEndpoint;
      const result = await didService.addServiceEndpoint(did, endpoint, request.id);
      return result;
    },
  });

  // DELETE /v1/dids/:did/services/:endpointId - Remove a service endpoint
  fastify.delete('/v1/dids/:did/services/:endpointId', {
    schema: {
      description: 'Remove an existing service endpoint from a DID Document',
      tags: ['DID Updates'],
      params: {
        type: 'object',
        required: ['did', 'endpointId'],
        properties: {
          did: { type: 'string', pattern: didPattern },
          endpointId: { type: 'string' },
        },
      },
      response: {
        200: {
          description: 'DID updated successfully',
          type: 'object',
          additionalProperties: true
        },
        404: { $ref: 'NotFound#' },
        410: { description: 'DID Deactivated', content: { 'application/json': { schema: { $ref: 'Error#' } } } }
      }
    },
    handler: async (request) => {
      const { did, endpointId } = request.params as DIDServiceEndpointParams;
      const result = await didService.removeServiceEndpoint(did, endpointId, request.id);
      return result;
    },
  });

  // POST /v1/dids/:did/deactivate - Deactivate a DID
  fastify.post('/v1/dids/:did/deactivate', {
    schema: {
      description: 'Permanently deactivate a Helix DID',
      tags: ['DID Lifecycle'],
      params: { 
        type: 'object', 
        required: ['did'], 
        properties: { did: { type: 'string', pattern: didPattern } } 
      },
      response: {
        200: {
          description: 'DID deactivated successfully',
          type: 'object',
          properties: {
            did: { type: 'string', pattern: didPattern },
            deactivated: { type: 'boolean' },
          },
        },
        404: { $ref: 'NotFound#' }
      }
    },
    handler: async (request, reply) => {
      const { did } = request.params as DIDParams;
      await didService.deactivateDID(did, request.id);
      return reply.status(200).send({ did, deactivated: true });
    },
  });
};

export default didRoutes;
