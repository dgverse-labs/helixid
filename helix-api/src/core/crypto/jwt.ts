import { utf8ToBytes } from '@noble/hashes/utils';
import { HelixJWTPayloadSchema, type HelixJWTPayload } from '../schemas/jwt.js';
import { InvalidJWTError, JWTExpiredError } from '../errors/HelixError.js';
import { signData, verifySignature } from './keys.js';

const JWT_HEADER = { alg: 'EdDSA', typ: 'JWT', crv: 'Ed25519' } as const;

function base64UrlEncode(bytes: Uint8Array | string): string {
  const buffer = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  return buffer.toString('base64url');
}

function base64UrlDecode(value: string): Buffer {
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    throw new InvalidJWTError('JWT contains invalid base64url encoding');
  }
}

function parseJsonPart(part: string, label: string): unknown {
  try {
    return JSON.parse(base64UrlDecode(part).toString('utf8')) as unknown;
  } catch {
    throw new InvalidJWTError(`JWT ${label} is invalid JSON`);
  }
}

function splitToken(token: string): [string, string, string] {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new InvalidJWTError('JWT must contain header, payload, and signature');
  }
  return parts as [string, string, string];
}

export function issueJWT(payload: HelixJWTPayload, privateKeyHex: string): string {
  const parsed = HelixJWTPayloadSchema.parse(payload);
  const header = base64UrlEncode(JSON.stringify(JWT_HEADER));
  const body = base64UrlEncode(JSON.stringify(parsed));
  const signingInput = `${header}.${body}`;
  const signatureHex = signData(utf8ToBytes(signingInput), privateKeyHex);
  const signature = base64UrlEncode(Buffer.from(signatureHex, 'hex'));
  return `${signingInput}.${signature}`;
}

export function decodeJWTUnsafe(token: string): HelixJWTPayload {
  const [, payloadPart] = splitToken(token);
  const parsed = HelixJWTPayloadSchema.safeParse(parseJsonPart(payloadPart, 'payload'));
  if (!parsed.success) {
    throw new InvalidJWTError('JWT payload has invalid Helix claims');
  }
  return parsed.data;
}

export function verifyJWT(token: string, publicKeyHex: string): HelixJWTPayload {
  const [headerPart, payloadPart, signaturePart] = splitToken(token);
  const header = parseJsonPart(headerPart, 'header') as Record<string, unknown>;
  if (header['alg'] !== 'EdDSA' || header['typ'] !== 'JWT' || header['crv'] !== 'Ed25519') {
    throw new InvalidJWTError('JWT header is not supported');
  }

  const signingInput = `${headerPart}.${payloadPart}`;
  const signatureHex = base64UrlDecode(signaturePart).toString('hex');
  const valid = verifySignature(utf8ToBytes(signingInput), signatureHex, publicKeyHex);
  if (!valid) {
    throw new InvalidJWTError('JWT signature is invalid');
  }

  const payload = decodeJWTUnsafe(token);
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new JWTExpiredError();
  }
  return payload;
}
