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

import type { ErrorCode } from './codes.js';

export interface HelixErrorBody {
  code: ErrorCode;
  message: string;
  requestId?: string;
  /** Additional context — never contains sensitive data */
  details?: Record<string, unknown> | undefined;
}

/**
 * Base error class for all Helix ID errors.
 * Used by helix-api to construct HTTP error responses.
 * Used by helix-sdk-js to construct typed SDK errors.
 */
export class HelixError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = 'HelixError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

// ── Convenience constructors ────────────────────────────────────────────────

export class InvalidPublicKeyError extends HelixError {
  constructor() {
    super(
      'INVALID_PUBLIC_KEY',
      'The submitted public key is not a valid 32-byte Ed25519 public key.',
      400,
    );
  }
}

export class InvalidDIDFormatError extends HelixError {
  constructor(did: string) {
    super('INVALID_DID_FORMAT', `The value '${did}' is not a valid Helix DID.`, 400);
  }
}

export class DIDNotFoundError extends HelixError {
  constructor(did: string) {
    super('DID_NOT_FOUND', `DID '${did}' was not found.`, 404);
  }
}

export class DIDAlreadyExistsError extends HelixError {
  constructor() {
    super('DID_ALREADY_EXISTS', 'A DID already exists for this public key.', 409);
  }
}

export class DIDDeactivatedError extends HelixError {
  constructor(did: string) {
    super(
      'DID_DEACTIVATED',
      `DID '${did}' has been deactivated and cannot be used.`,
      410,
    );
  }
}

export class InvalidServiceEndpointUrlError extends HelixError {
  constructor(url: string) {
    super(
      'INVALID_SERVICE_ENDPOINT_URL',
      `Service endpoint URL '${url}' must be a valid HTTPS URL.`,
      400,
    );
  }
}

export class ServiceEndpointNotFoundError extends HelixError {
  constructor(endpointId: string) {
    super(
      'SERVICE_ENDPOINT_NOT_FOUND',
      `Service endpoint '${endpointId}' was not found in the DID document.`,
      404,
    );
  }
}

export class ServiceEndpointAlreadyExistsError extends HelixError {
  constructor(endpointId: string) {
    super(
      'SERVICE_ENDPOINT_ALREADY_EXISTS',
      `A service endpoint with ID '${endpointId}' already exists.`,
      409,
    );
  }
}

export class HederaAnchorFailedError extends HelixError {
  constructor() {
    super(
      'HEDERA_ANCHOR_FAILED',
      'Failed to anchor the DID document on Hedera. Please retry.',
      502,
    );
  }
}

export class HederaResolutionFailedError extends HelixError {
  constructor() {
    super(
      'HEDERA_RESOLUTION_FAILED',
      'Failed to resolve the DID document from Hedera.',
      502,
    );
  }
}

export class InternalError extends HelixError {
  constructor() {
    super('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
  }
}

export class ValidationError extends HelixError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
  }
}
