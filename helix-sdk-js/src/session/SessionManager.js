import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
const HEADER = { alg: 'HS256', typ: 'JWT' };
function base64UrlEncode(value) {
    return Buffer.from(value).toString('base64url');
}
function base64UrlDecodeToString(value) {
    try {
        return Buffer.from(value, 'base64url').toString('utf8');
    }
    catch {
        throw new Error('JWT contains invalid base64url encoding');
    }
}
function parseToken(token) {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
        throw new Error('JWT must contain header, payload, and signature');
    }
    return [parts[0], parts[1], parts[2]];
}
function signSigningInput(signingInput, secret) {
    const digest = createHmac('sha256', secret).update(signingInput).digest();
    return base64UrlEncode(digest);
}
function assertClaims(value) {
    if (!value || typeof value !== 'object') {
        throw new Error('JWT payload is invalid');
    }
    const record = value;
    if (typeof record.agentDid !== 'string' || record.agentDid.length === 0) {
        throw new Error('JWT payload is missing agentDid');
    }
    if (!Array.isArray(record.scopes) || !record.scopes.every((scope) => typeof scope === 'string')) {
        throw new Error('JWT payload has invalid scopes');
    }
    if (!Array.isArray(record.delegationChain) ||
        !record.delegationChain.every((link) => !!link &&
            typeof link === 'object' &&
            typeof link.issuer === 'string' &&
            typeof link.subject === 'string' &&
            typeof link.vcId === 'string' &&
            Array.isArray(link.scopes) &&
            link.scopes.every((scope) => typeof scope === 'string') &&
            Number.isInteger(link.delegationDepth))) {
        throw new Error('JWT payload has invalid delegationChain');
    }
    if (typeof record.jti !== 'string' || record.jti.length === 0) {
        throw new Error('JWT payload is missing jti');
    }
    if (!Number.isInteger(record.iat) || !Number.isInteger(record.exp)) {
        throw new Error('JWT payload has invalid iat/exp');
    }
}
export class SessionManager {
    secret;
    ttl;
    constructor(options) {
        if (!options.secret || options.secret.length < 16) {
            throw new Error('SessionManager secret must be at least 16 characters');
        }
        if (!Number.isInteger(options.ttl) || options.ttl <= 0) {
            throw new Error('SessionManager ttl must be a positive integer (seconds)');
        }
        this.secret = options.secret;
        this.ttl = options.ttl;
    }
    async issue(input) {
        if (!input.agentDid) {
            throw new Error('issue() requires agentDid');
        }
        if (!Array.isArray(input.scopes)) {
            throw new Error('issue() requires scopes array');
        }
        const now = Math.floor(Date.now() / 1000);
        const claims = {
            agentDid: input.agentDid,
            scopes: input.scopes,
            delegationChain: input.delegationChain ?? [],
            iat: now,
            exp: now + this.ttl,
            jti: randomUUID(),
        };
        const headerPart = base64UrlEncode(JSON.stringify(HEADER));
        const payloadPart = base64UrlEncode(JSON.stringify(claims));
        const signingInput = `${headerPart}.${payloadPart}`;
        const signaturePart = signSigningInput(signingInput, this.secret);
        return `${signingInput}.${signaturePart}`;
    }
    async verify(token) {
        const [headerPart, payloadPart, signaturePart] = parseToken(token);
        let header;
        try {
            header = JSON.parse(base64UrlDecodeToString(headerPart));
        }
        catch {
            throw new Error('JWT header is invalid');
        }
        if (header.alg !== 'HS256' || header.typ !== 'JWT') {
            throw new Error('JWT header is not supported');
        }
        const expectedSignature = signSigningInput(`${headerPart}.${payloadPart}`, this.secret);
        const actual = Buffer.from(signaturePart, 'utf8');
        const expected = Buffer.from(expectedSignature, 'utf8');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
            throw new Error('JWT signature is invalid');
        }
        let payloadRaw;
        try {
            payloadRaw = JSON.parse(base64UrlDecodeToString(payloadPart));
        }
        catch {
            throw new Error('JWT payload is invalid');
        }
        assertClaims(payloadRaw);
        const claims = payloadRaw;
        const now = Math.floor(Date.now() / 1000);
        if (claims.exp <= now) {
            throw new Error('JWT has expired');
        }
        return claims;
    }
}
//# sourceMappingURL=SessionManager.js.map