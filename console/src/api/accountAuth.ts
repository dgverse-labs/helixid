// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Client for the hosted-account auth endpoints (/v1/auth/*) — see
// docs/proposal-hosted-instance.md. Deliberately separate from api/client.ts,
// which speaks the admin-key-authenticated agent/VC API; this is the
// email/password + Google identity layer for hosted.helixid.io accounts.

import { getApiConfig } from '../runtimeConfig';

const { apiBaseUrl } = getApiConfig();

function buildUrl(path: string): string {
  return new URL(path, apiBaseUrl || window.location.origin).toString();
}

export interface AccountSummary {
  id: string;
  email: string;
  issuerDid: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      // Ignore non-JSON error payloads.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export const accountAuth = {
  register: (email: string, password: string) =>
    postJson<{ account: AccountSummary } & AuthTokens>('/v1/auth/register', { email, password }),
  login: (email: string, password: string) =>
    postJson<{ account: AccountSummary } & AuthTokens>('/v1/auth/login', { email, password }),
  googleSignInUrl: (): string => buildUrl('/v1/auth/google'),
};
