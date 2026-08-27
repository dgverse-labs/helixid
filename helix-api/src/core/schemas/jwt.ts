import { z } from 'zod';

export const HelixJWTPayloadSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  jti: z.string().min(1),
  userDid: z.string().min(1),
  targetService: z.string().min(1),
  scopes: z.array(z.string()),
  vpId: z.string().min(1),
});

export type HelixJWTPayload = z.infer<typeof HelixJWTPayloadSchema>;
