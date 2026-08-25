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

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AccountSummary {
  id: string;
  email: string;
  issuerDid: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
}

export interface RegisterInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface GoogleProfile {
  googleId: string;
  /** Google-verified email — see design doc, this is what enables account linking without a confirmation step. */
  email: string;
  emailVerified: boolean;
}

export interface IAuthService {
  /** Creates the Account, auto-provisions its issuer DID + key, returns session tokens. */
  register(input: RegisterInput): Promise<{ account: AccountSummary; tokens: AuthTokens }>;
  login(input: LoginInput): Promise<{ account: AccountSummary; tokens: AuthTokens }>;
  /** Find-or-create by googleId, falling back to a verified-email match. */
  loginWithGoogle(profile: GoogleProfile): Promise<{ account: AccountSummary; tokens: AuthTokens }>;
  /** Validates + rotates a refresh token; revokes every session for the account on reuse detection. */
  refresh(refreshToken: string): Promise<AuthTokens>;
  logout(refreshToken: string): Promise<void>;
  verifyAccessToken(accessToken: string): { accountId: string; scope: string[] };
}
