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

import type { FastifyRequest, FastifyReply, FastifyError } from 'fastify';
import { HelixError, InternalError } from '@helixid/core';

/**
 * Global Fastify error handler.
 * Ensures every error response follows the structured Helix ID format.
 * Satisfies EH-1, EH-3, and EH-5.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const requestId = (request.headers['x-request-id'] as string) || request.id;

  // Log the internal detail before returning (EH-5)
  request.log.error({
    requestId,
    code: error instanceof HelixError ? error.code : 'UNKNOWN_ERROR',
    stack: error.stack,
    message: error.message,
  });

  // Handle Helix-specific errors
  if (error instanceof HelixError) {
    return reply.status(error.httpStatus).send({
      error: {
        code: error.code,
        message: error.message,
        requestId,
        details: error.details,
      },
    });
  }

  // Handle validation errors from Fastify (AJV)
  if (error.validation) {
    return reply.status(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId,
        details: {
          issues: error.validation,
        },
      },
    });
  }

  // Generic fallback for all other errors (EH-3: never leak internal state)
  const internalError = new InternalError();
  return reply.status(internalError.httpStatus).send({
    error: {
      code: internalError.code,
      message: internalError.message,
      requestId,
    },
  });
}
