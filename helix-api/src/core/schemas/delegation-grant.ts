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
import { VCBaseSchema } from './vc.js';

/**
 * Consent grant credential subject: one grant per (user, agent, service)
 * triple, issued by the Service Provider itself.
 */
export const DelegationGrantSubjectSchema = z.object({
  id: z.string(), // agent DID being authorized
  type: z.literal('DelegationGrant'),
  userDid: z.string(), // DID or plain email string
  scopes: z.array(z.string()),
  durability: z.enum(['standing', 'session']),
  serviceDid: z.string().optional(),
});

export const DelegationGrantVCSchema = VCBaseSchema.extend({
  type: z.array(z.string()).superRefine((val, ctx) => {
    if (!val.includes('VerifiableCredential') || !val.includes('DelegationGrantCredential')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Delegation Grant VC types' });
    }
  }),
  credentialSubject: DelegationGrantSubjectSchema,
});

export type DelegationGrantVC = z.infer<typeof DelegationGrantVCSchema>;
