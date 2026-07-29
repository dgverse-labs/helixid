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

import { z } from 'zod';

/**
 * Runtime schema for a fetched StatusListCredential. One shared format for
 * helix-api-hosted and SP-hosted lists — one validation path, no
 * special-casing by host.
 */
export const StatusListCredentialSchema = z.object({
  '@context': z.array(z.string()).min(1),
  id: z.string(),
  type: z.array(z.string()),
  issuer: z.string(),
  validFrom: z.string(),
  credentialSubject: z.object({
    id: z.string(),
    type: z.literal('BitstringStatusList'),
    statusPurpose: z.literal('revocation'),
    encodedList: z.string(),
  }),
});
