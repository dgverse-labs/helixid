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
// See docs/proposal-hosted-instance.md ("Sessions: access + refresh
// tokens"). Deliberately separate from helix-core's issueJWT/verifyJWT
// (crypto/jwt.ts), which is schema-locked to VP session claims
// (userDid/targetService/vpId) — account access tokens carry a different,
// simpler shape (accountId + scope) and are HMAC-signed with a server
// secret rather than EdDSA, per the design doc.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AccessTokenExpiredError, AccessTokenInvalidError } from '@helixid/core';

export interface AccessTokenPayload {
  accountId: string;
  scope: string[];
  iat: number;
  exp: number;
  /** Per-issuance nonce — guarantees uniqueness even for two tokens issued within the same second. */
  jti: string;
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecodeToString(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/** Short-lived (~15 min) bearer access token. Stateless — nothing stored server-side. */
export function issueAccessToken(
  accountId: string,
  secret: string,
  ttlSeconds: number,
  scope: string[] = ['account'],
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenPayload = {
    accountId,
    scope,
    iat: now,
    exp: now + ttlSeconds,
    jti: randomBytes(9).toString('base64url'),
  };
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AccessTokenInvalidError();
  }
  const [headerPart, bodyPart, signaturePart] = parts as [string, string, string];
  const expectedSignature = createHmac('sha256', secret)
    .update(`${headerPart}.${bodyPart}`)
    .digest('base64url');

  const provided = Buffer.from(signaturePart);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new AccessTokenInvalidError();
  }

  let payload: AccessTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecodeToString(bodyPart)) as AccessTokenPayload;
  } catch {
    throw new AccessTokenInvalidError();
  }

  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new AccessTokenExpiredError();
  }
  return payload;
}

/** Opaque bearer-style refresh token. Only its sha256 hash is ever persisted. */
export function generateRefreshToken(): string {
  return generateOpaqueToken('rft');
}

export function hashRefreshToken(token: string): string {
  return hashOpaqueToken(token);
}

/** Generic opaque-token helper, reused for refresh tokens and email-verification tokens alike. */
export function generateOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
