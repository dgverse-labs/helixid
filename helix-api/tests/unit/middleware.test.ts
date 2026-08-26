// Copyright 2026 DgVerse LLP
import { describe, expect, it, vi } from 'vitest';
import type { FastifyError } from 'fastify';
import { EnrollmentTokenNotFoundError } from '../../src/core/index.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { registerRequestLogger } from '../../src/middleware/requestLogger.js';

function makeReply() {
  const reply = {
    status: vi.fn(),
    send: vi.fn(),
  };
  reply.status.mockReturnValue(reply);
  return reply;
}

function makeRequest(headers: Record<string, string> = {}) {
  return {
    id: 'req-fallback',
    headers,
    log: {
      error: vi.fn(),
    },
  };
}

describe('middleware', () => {
  it('registerRequestLogger is currently a no-op placeholder', () => {
    const app = {};

    expect(() => registerRequestLogger(app as never)).not.toThrow();
  });

  it('formats Helix errors with request id and details', () => {
    const request = makeRequest({ 'x-request-id': 'req-1' });
    const reply = makeReply();

    errorHandler(new EnrollmentTokenNotFoundError(), request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'ENROLLMENT_TOKEN_NOT_FOUND',
        message: 'Enrollment token was not found',
        requestId: 'req-1',
        details: undefined,
      },
    });
    expect(request.log.error).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ENROLLMENT_TOKEN_NOT_FOUND',
      requestId: 'req-1',
    }));
  });

  it('formats Fastify validation errors as validation responses', () => {
    const request = makeRequest();
    const reply = makeReply();
    const error = Object.assign(new Error('bad request'), {
      validation: [{ instancePath: '/agentName', message: 'Required' }],
    });

    errorHandler(error as never, request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId: 'req-fallback',
        details: {
          issues: [{ instancePath: '/agentName', message: 'Required' }],
        },
      },
    });
  });

  it('formats generic errors as internal errors without leaking details', () => {
    const request = makeRequest();
    const reply = makeReply();

    errorHandler(new Error('database exploded') as FastifyError, request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: 'req-fallback',
      },
    });
  });
});
