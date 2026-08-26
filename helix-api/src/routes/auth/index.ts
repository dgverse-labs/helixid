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
// See docs/proposal-hosted-instance.md ("Rough endpoint list").

import type { FastifyPluginAsync } from 'fastify';
import { HelixError, ErrorCode, GoogleOAuthFailedError } from '../../core/index.js';
import type { IAuthService } from '../../services/auth/IAuthService.js';

export interface AuthRouteOptions {
  authService: IAuthService;
  googleClientId?: string | undefined;
  googleClientSecret?: string | undefined;
  googleRedirectUri?: string | undefined;
  rateLimits?:
    | {
        loginMax?: number;
        registerMax?: number;
        refreshMax?: number;
      }
    | undefined;
}

interface EmailPasswordBody {
  email?: unknown;
  password?: unknown;
}

interface RefreshBody {
  refreshToken?: unknown;
}

function requireEmailPassword(body: EmailPasswordBody): { email: string; password: string } {
  if (typeof body.email !== 'string' || !body.email.includes('@')) {
    throw new HelixError(ErrorCode.VALIDATION_ERROR, 'A valid email is required', 400);
  }
  if (typeof body.password !== 'string' || body.password.length < 8) {
    throw new HelixError(
      ErrorCode.VALIDATION_ERROR,
      'password is required and must be at least 8 characters',
      400,
    );
  }
  return { email: body.email, password: body.password };
}

const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (fastify, options) => {
  fastify.post(
    '/register',
    { config: { rateLimit: { max: options.rateLimits?.registerMax ?? 3, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const { email, password } = requireEmailPassword(request.body as EmailPasswordBody);
      const { account, tokens } = await options.authService.register({ email, password });
      return reply.code(201).send({ account, ...tokens });
    },
  );

  fastify.post(
    '/login',
    { config: { rateLimit: { max: options.rateLimits?.loginMax ?? 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { email, password } = requireEmailPassword(request.body as EmailPasswordBody);
      const { account, tokens } = await options.authService.login({ email, password });
      return reply.code(200).send({ account, ...tokens });
    },
  );

  fastify.post(
    '/refresh',
    { config: { rateLimit: { max: options.rateLimits?.refreshMax ?? 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = request.body as RefreshBody;
      if (typeof body.refreshToken !== 'string' || body.refreshToken.length === 0) {
        throw new HelixError(ErrorCode.VALIDATION_ERROR, 'refreshToken is required', 400);
      }
      const tokens = await options.authService.refresh(body.refreshToken);
      return reply.code(200).send(tokens);
    },
  );

  fastify.post('/logout', async (request, reply) => {
    const body = request.body as RefreshBody;
    if (typeof body.refreshToken !== 'string' || body.refreshToken.length === 0) {
      throw new HelixError(ErrorCode.VALIDATION_ERROR, 'refreshToken is required', 400);
    }
    await options.authService.logout(body.refreshToken);
    return reply.code(204).send();
  });

  fastify.post('/verify-email', async (request, reply) => {
    const body = request.body as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length === 0) {
      throw new HelixError(ErrorCode.VALIDATION_ERROR, 'token is required', 400);
    }
    const account = await options.authService.verifyEmail(body.token);
    return reply.code(200).send({ account });
  });

  fastify.post('/resend-verification', async (request, reply) => {
    const body = request.body as EmailPasswordBody;
    if (typeof body.email !== 'string' || !body.email.includes('@')) {
      throw new HelixError(ErrorCode.VALIDATION_ERROR, 'A valid email is required', 400);
    }
    await options.authService.resendVerificationEmail(body.email);
    // Always 202, whether or not the account exists/is already verified —
    // this endpoint must not leak account existence.
    return reply.code(202).send();
  });

  // ── Google OAuth2/OIDC (authorization-code flow) ──────────────────────────
  // Standard redirect flow. Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
  // GOOGLE_OAUTH_REDIRECT_URI to be configured — self-hosted deployments and
  // dev environments without these simply don't expose this path (the
  // console's "Continue with Google" button is hidden if it 404s/501s).

  fastify.get('/google', async (_request, reply) => {
    if (!options.googleClientId || !options.googleRedirectUri) {
      throw new HelixError(
        ErrorCode.VALIDATION_ERROR,
        'Google sign-in is not configured on this instance',
        501,
      );
    }
    const params = new URLSearchParams({
      client_id: options.googleClientId,
      redirect_uri: options.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  fastify.get('/google/callback', async (request, reply) => {
    if (!options.googleClientId || !options.googleClientSecret || !options.googleRedirectUri) {
      throw new HelixError(
        ErrorCode.VALIDATION_ERROR,
        'Google sign-in is not configured on this instance',
        501,
      );
    }
    const { code } = request.query as { code?: string };
    if (!code) {
      throw new GoogleOAuthFailedError('Missing authorization code');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: options.googleClientId,
        client_secret: options.googleClientSecret,
        redirect_uri: options.googleRedirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) {
      throw new GoogleOAuthFailedError('Google token exchange failed');
    }
    const tokenJson = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new GoogleOAuthFailedError('Google token exchange returned no access token');
    }

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!profileResponse.ok) {
      throw new GoogleOAuthFailedError('Failed to fetch Google profile');
    }
    const profileJson = (await profileResponse.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
    };
    if (!profileJson.sub || !profileJson.email) {
      throw new GoogleOAuthFailedError('Google profile response missing sub/email');
    }

    const { account, tokens } = await options.authService.loginWithGoogle({
      googleId: profileJson.sub,
      email: profileJson.email,
      emailVerified: profileJson.email_verified ?? false,
    });
    return reply.code(200).send({ account, ...tokens });
  });
};

export default authRoutes;
