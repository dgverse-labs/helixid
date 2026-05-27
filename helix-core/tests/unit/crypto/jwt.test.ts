import { describe, expect, it } from 'vitest';
import {
  decodeJWTUnsafe,
  generateKeyPair,
  InvalidJWTError,
  issueJWT,
  JWTExpiredError,
  JWTPublicKeyNotFoundError,
  verifyJWT,
  type HelixJWTPayload,
} from '../../../src/index.js';

function payload(overrides: Partial<HelixJWTPayload> = {}): HelixJWTPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: 'did:hedera:testnet:issuer',
    sub: 'did:hedera:testnet:agent',
    iat: now,
    exp: now + 600,
    jti: 'jwt:test',
    userDid: 'did:hedera:testnet:user',
    targetService: 'amazon',
    scopes: ['read:orders', 'write:orders'],
    vpId: 'vp:helix:test',
    ...overrides,
  };
}

describe('JWT crypto', () => {
  it('issues and verifies a three-part EdDSA JWT', () => {
    const keys = generateKeyPair();
    const token = issueJWT(payload(), keys.privateKey);

    expect(token.split('.')).toHaveLength(3);
    expect(verifyJWT(token, keys.publicKey)).toMatchObject({
      sub: 'did:hedera:testnet:agent',
      targetService: 'amazon',
      scopes: ['read:orders', 'write:orders'],
    });
  });

  it('decodes payload without verifying signature', () => {
    const keys = generateKeyPair();
    const token = issueJWT(payload({ jti: 'jwt:unsafe' }), keys.privateKey);

    expect(decodeJWTUnsafe(token).jti).toBe('jwt:unsafe');
  });

  it('rejects wrong public key', () => {
    const keys = generateKeyPair();
    const wrongKeys = generateKeyPair();
    const token = issueJWT(payload(), keys.privateKey);

    expect(() => verifyJWT(token, wrongKeys.publicKey)).toThrow(InvalidJWTError);
  });

  it('rejects payload tampering', () => {
    const keys = generateKeyPair();
    const token = issueJWT(payload(), keys.privateKey);
    const [header, body, signature] = token.split('.') as [string, string, string];
    const tampered = Buffer.from(JSON.stringify(payload({ targetService: 'other' })), 'utf8').toString('base64url');

    expect(() => verifyJWT(`${header}.${tampered}.${signature}`, keys.publicKey)).toThrow(InvalidJWTError);
    expect(body).not.toBe(tampered);
  });

  it('rejects expired tokens', () => {
    const keys = generateKeyPair();
    const token = issueJWT(payload({ exp: Math.floor(Date.now() / 1000) - 1 }), keys.privateKey);

    expect(() => verifyJWT(token, keys.publicKey)).toThrow(JWTExpiredError);
  });

  it('rejects malformed tokens', () => {
    expect(() => verifyJWT('only.two', generateKeyPair().publicKey)).toThrow(InvalidJWTError);
  });

  it('rejects unsupported headers', () => {
    const keys = generateKeyPair();
    const token = issueJWT(payload(), keys.privateKey);
    const [, body, signature] = token.split('.') as [string, string, string];
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', crv: 'Ed25519' }), 'utf8').toString('base64url');

    expect(() => verifyJWT(`${header}.${body}.${signature}`, keys.publicKey)).toThrow(InvalidJWTError);
  });

  it('rejects invalid payload claims while decoding', () => {
    const keys = generateKeyPair();
    const token = issueJWT(payload(), keys.privateKey);
    const [header, , signature] = token.split('.') as [string, string, string];
    const body = Buffer.from(JSON.stringify({ sub: 'missing-required-claims' }), 'utf8').toString('base64url');

    expect(() => decodeJWTUnsafe(`${header}.${body}.${signature}`)).toThrow(InvalidJWTError);
  });

  it('rejects non-json token parts', () => {
    const keys = generateKeyPair();
    const badJson = Buffer.from('not json', 'utf8').toString('base64url');
    const token = issueJWT(payload(), keys.privateKey);
    const [, body, signature] = token.split('.') as [string, string, string];

    expect(() => verifyJWT(`${badJson}.${body}.${signature}`, keys.publicKey)).toThrow(InvalidJWTError);
  });

  it('exposes a public key configuration error class', () => {
    expect(new JWTPublicKeyNotFoundError()).toMatchObject({
      code: 'JWT_PUBLIC_KEY_NOT_FOUND',
      httpStatus: 500,
    });
  });
});
