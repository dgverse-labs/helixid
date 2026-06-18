import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDIDDocument,
  buildDelegationVC,
  clearDIDCache,
  createStatusList,
  generateKeyPair,
  getBit,
  publicKeyToMultibase,
  resolveDID,
  selfIssueVC,
  setBit,
  verifySignature,
  verifyVP,
  VPBuilder,
  base58btcDecode,
  type SignedVC,
} from '../../src/index.js';
import { base58btcEncode, hashCanonicalPayload } from '../../src/crypto/vp.js';
import { createEd25519Proof } from '../../src/proof.js';

function didKey(publicKeyHex: string): string {
  return `did:key:${publicKeyToMultibase(publicKeyHex)}`;
}

function mockJsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

async function issuerSignedVC(
  issuer: { did: string; privateKeyHex: string },
  subjectDid: string,
  scopes = ['read:orders'],
  overrides: Partial<SignedVC> & { credentialSubject?: Partial<SignedVC['credentialSubject']> } = {},
): Promise<SignedVC> {
  const now = new Date();
  const { credentialSubject: subjectOverrides, ...vcOverrides } = overrides;
  const baseSubject = {
    id: subjectDid,
    type: 'HelixAgent' as const,
    privilegeScopes: scopes,
    agentName: subjectDid,
    delegationDepth: 0,
    maxDelegationDepth: 1,
  };
  const payload = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helix-id.io/contexts/v1'],
    id: `vc:test:${crypto.randomUUID()}`,
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: issuer.did,
    validFrom: now.toISOString(),
    validUntil: new Date(now.getTime() + 60_000).toISOString(),
    credentialStatus: {
      id: 'https://issuer.example/status/1#0',
      type: 'BitstringStatusListEntry' as const,
      statusPurpose: 'revocation' as const,
      statusListIndex: '0',
      statusListCredential: 'https://issuer.example/status/1',
    },
    credentialSubject: { ...baseSubject, ...subjectOverrides },
    ...vcOverrides,
  };
  return {
    ...payload,
    proof: await createEd25519Proof(payload, issuer.privateKeyHex, `${issuer.did}#key-1`),
  } as SignedVC;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearDIDCache();
});

describe('DID resolver', () => {
  it('resolves did:key offline without fetch', async () => {
    const key = generateKeyPair();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const did = didKey(key.publicKey);

    const doc = await resolveDID(did);

    expect(doc.id).toBe(did);
    expect(doc.verificationMethod[0]?.publicKeyMultibase).toBe(publicKeyToMultibase(key.publicKey));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves did:web from the expected URL and caches within TTL', async () => {
    const key = generateKeyPair();
    const did = 'did:web:example.com:agents:booking';
    const doc = buildDIDDocument(did, key.publicKey);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(doc));

    await expect(resolveDID(did)).resolves.toMatchObject({ id: did });
    await expect(resolveDID(did)).resolves.toMatchObject({ id: did });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/agents/booking/did.json');
  });

  it('throws UNSUPPORTED_DID_METHOD for unknown DID methods', async () => {
    await expect(resolveDID('did:unknown:abc')).rejects.toMatchObject({
      code: 'UNSUPPORTED_DID_METHOD',
    });
  });

  it('maps bare did:web hosts to /.well-known/did.json', async () => {
    const key = generateKeyPair();
    const did = 'did:web:example.com';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(buildDIDDocument(did, key.publicKey)));

    await resolveDID(did);

    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe('https://example.com/.well-known/did.json');
  });

  it('rejects malformed did:key fingerprints and invalid did:web documents', async () => {
    await expect(resolveDID('did:key:not-multibase')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(resolveDID(`did:key:${base58btcEncode(new Uint8Array([1, 2, 3]))}`))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockJsonResponse({}, false, 404));
    await expect(resolveDID('did:web:notfound.example')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockJsonResponse({ id: 'did:web:other.example' }));
    await expect(resolveDID('did:web:bad.example')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(resolveDID('did:web:')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('VP builder and verifier', () => {
  it('signs a VP with a fresh UUID-backed vpId and a verifiable signature', async () => {
    const holder = generateKeyPair();
    const issuer = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const issuerDid = didKey(issuer.publicKey);
    const vc = await issuerSignedVC({ did: issuerDid, privateKeyHex: issuer.privateKey }, holderDid);

    const vp = await new VPBuilder({
      vc,
      holderDid,
      targetService: 'orders',
      userDid: 'did:web:user.example',
    }).sign(holder.privateKey, `${holderDid}#key-1`);
    const { proof, ...payload } = vp;

    expect(vp.id).toMatch(/^vp:helix:[0-9a-f-]{36}$/);
    await expect(verifySignature(
      hashCanonicalPayload(payload),
      Buffer.from(base58btcDecode(proof.proofValue)).toString('hex'),
      holder.publicKey,
    )).resolves.toBe(true);
  });

  it('verifies a valid VP and returns scopes and vpId', async () => {
    const holder = generateKeyPair();
    const issuer = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const issuerDid = didKey(issuer.publicKey);
    const vc = await issuerSignedVC({ did: issuerDid, privateKeyHex: issuer.privateKey }, holderDid);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse({
      credentialSubject: { encodedList: createStatusList(8) },
    }));

    const vp = await new VPBuilder({ vc, holderDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(holder.privateKey, `${holderDid}#key-1`);

    await expect(verifyVP(vp, { expectedTargetService: 'orders' })).resolves.toMatchObject({
      valid: true,
      agentDid: holderDid,
      privilegeScopes: ['read:orders'],
      vpId: vp.id,
    });
  });

  it('throws VC_EXPIRED for expired credentials', async () => {
    const holder = generateKeyPair();
    const issuer = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const issuerDid = didKey(issuer.publicKey);
    const vc = await issuerSignedVC({ did: issuerDid, privateKeyHex: issuer.privateKey }, holderDid, ['read:orders'], {
      validUntil: new Date(Date.now() - 1000).toISOString(),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse({
      credentialSubject: { encodedList: createStatusList(8) },
    }));
    const vp = await new VPBuilder({ vc, holderDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(holder.privateKey, `${holderDid}#key-1`);

    await expect(verifyVP(vp)).rejects.toMatchObject({ code: 'VC_EXPIRED' });
  });

  it('throws VC_REVOKED when the status bit is set', async () => {
    const holder = generateKeyPair();
    const issuer = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const issuerDid = didKey(issuer.publicKey);
    const vc = await issuerSignedVC({ did: issuerDid, privateKeyHex: issuer.privateKey }, holderDid);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse({
      credentialSubject: { encodedList: setBit(createStatusList(8), 0, 1) },
    }));
    expect(getBit(setBit(createStatusList(8), 0, 1), 0)).toBe(1);
    const vp = await new VPBuilder({ vc, holderDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(holder.privateKey, `${holderDid}#key-1`);

    await expect(verifyVP(vp)).rejects.toMatchObject({ code: 'VC_REVOKED' });
  });

  it('rejects self-signed VCs by default and accepts them with a warning when enabled', async () => {
    const holder = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const vc = await selfIssueVC({ scopes: ['read:orders'] }, { did: holderDid, privateKeyHex: holder.privateKey });
    const vp = await new VPBuilder({ vc, holderDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(holder.privateKey, `${holderDid}#key-1`);

    await expect(verifyVP(vp)).rejects.toMatchObject({ code: 'SELF_SIGNED_VC_NOT_ALLOWED' });
    await expect(verifyVP(vp, { allowSelfSigned: true })).resolves.toMatchObject({
      valid: true,
      warning: 'self-signed credential, not trusted in production',
    });
  });

  it('rejects invalid VP signatures, expired VPs, target mismatches, and unsigned VC payloads', async () => {
    const holder = generateKeyPair();
    const issuer = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const issuerDid = didKey(issuer.publicKey);
    const vc = await issuerSignedVC({ did: issuerDid, privateKeyHex: issuer.privateKey }, holderDid, ['read:orders'], {
      credentialStatus: undefined,
    });
    const vp = await new VPBuilder({ vc, holderDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(holder.privateKey, `${holderDid}#key-1`);

    await expect(verifyVP({ ...vp, expirationDate: new Date(Date.now() - 1000).toISOString() }))
      .rejects.toMatchObject({ code: 'VP_EXPIRED' });
    await expect(verifyVP(vp, { expectedTargetService: 'payments' }))
      .rejects.toMatchObject({ code: 'VP_INVALID_STRUCTURE' });
    await expect(verifyVP({ ...vp, proof: { ...vp.proof, proofValue: base58btcEncode(new Uint8Array(64)) } }))
      .rejects.toMatchObject({ code: 'VP_SIGNATURE_INVALID' });
    const unsignedVcVp = await new VPBuilder({
      vc: { id: 'vc:unsigned' } as SignedVC,
      holderDid,
      targetService: 'orders',
      userDid: 'did:web:user.example',
    }).sign(holder.privateKey, `${holderDid}#key-1`);
    await expect(verifyVP(unsignedVcVp))
      .rejects.toMatchObject({ code: 'VP_INVALID_STRUCTURE' });
    const targetMismatchVp = await new VPBuilder({
      vc: { ...vc, targetService: 'payments' } as SignedVC,
      holderDid,
      targetService: 'orders',
      userDid: 'did:web:user.example',
    }).sign(holder.privateKey, `${holderDid}#key-1`);
    await expect(verifyVP(targetMismatchVp))
      .rejects.toMatchObject({ code: 'VP_INVALID_STRUCTURE' });
  });

  it('rejects invalid VC signatures and not-yet-valid credentials', async () => {
    const holder = generateKeyPair();
    const issuer = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const issuerDid = didKey(issuer.publicKey);
    const vc = await issuerSignedVC({ did: issuerDid, privateKeyHex: issuer.privateKey }, holderDid, ['read:orders'], {
      credentialStatus: undefined,
    });
    const futureVC = await issuerSignedVC({ did: issuerDid, privateKeyHex: issuer.privateKey }, holderDid, ['read:orders'], {
      credentialStatus: undefined,
      validFrom: new Date(Date.now() + 60_000).toISOString(),
    });
    const vp = await new VPBuilder({ vc, holderDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(holder.privateKey, `${holderDid}#key-1`);
    const futureVp = await new VPBuilder({ vc: futureVC, holderDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(holder.privateKey, `${holderDid}#key-1`);

    const badVcSignatureVp = await new VPBuilder({
      vc: { ...vc, proof: { ...vc.proof, proofValue: base58btcEncode(new Uint8Array(64)) } },
      holderDid,
      targetService: 'orders',
      userDid: 'did:web:user.example',
    }).sign(holder.privateKey, `${holderDid}#key-1`);
    await expect(verifyVP(badVcSignatureVp))
      .rejects.toMatchObject({ code: 'VC_SIGNATURE_INVALID' });
    await expect(verifyVP(futureVp)).rejects.toMatchObject({ code: 'VC_NOT_YET_VALID' });
  });

  it('accepts multibase z-prefixed proof values as a compatibility fallback', async () => {
    const holder = generateKeyPair();
    const issuer = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const issuerDid = didKey(issuer.publicKey);
    const vc = await issuerSignedVC({ did: issuerDid, privateKeyHex: issuer.privateKey }, holderDid, ['read:orders'], {
      credentialStatus: undefined,
    });
    const prefixedVC = { ...vc, proof: { ...vc.proof, proofValue: `z${vc.proof.proofValue}` } };
    const vp = await new VPBuilder({ vc: prefixedVC, holderDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(holder.privateKey, `${holderDid}#key-1`);

    await expect(verifyVP(vp)).resolves.toMatchObject({ valid: true });
  });

  it('rejects unavailable or malformed revocation status checks', async () => {
    const holder = generateKeyPair();
    const issuer = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const issuerDid = didKey(issuer.publicKey);
    const vc = await issuerSignedVC({ did: issuerDid, privateKeyHex: issuer.privateKey }, holderDid);
    const vp = await new VPBuilder({ vc, holderDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(holder.privateKey, `${holderDid}#key-1`);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockJsonResponse({}, false, 503));
    await expect(verifyVP(vp)).rejects.toMatchObject({ code: 'VC_REVOKED' });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockJsonResponse({
      credentialSubject: { encodedList: createStatusList(8) },
    }));
    const badIndexVC = await issuerSignedVC({ did: issuerDid, privateKeyHex: issuer.privateKey }, holderDid, ['read:orders'], {
      credentialStatus: {
        id: 'https://issuer.example/status/1#not-a-number',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: 'not-a-number',
        statusListCredential: 'https://issuer.example/status/1',
      },
    });
    const badIndexVP = await new VPBuilder({ vc: badIndexVC, holderDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(holder.privateKey, `${holderDid}#key-1`);
    await expect(verifyVP(badIndexVP)).rejects.toMatchObject({ code: 'VC_REVOKED' });
  });

  it('verifies a valid delegated VP chain', async () => {
    const issuer = generateKeyPair();
    const holder = generateKeyPair();
    const delegate = generateKeyPair();
    const issuerDid = 'did:web:issuer.example';
    const holderDid = didKey(holder.publicKey);
    const delegateDid = didKey(delegate.publicKey);
    const root = await issuerSignedVC(
      { did: issuerDid, privateKeyHex: issuer.privateKey },
      holderDid,
      ['read:orders', 'write:orders'],
      { credentialStatus: undefined },
    );
    const child = await buildDelegationVC(
      { to: delegateDid, scopes: ['read:orders'], expiresIn: 60, fromVC: root },
      { did: holderDid, privateKeyHex: holder.privateKey },
    );
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(buildDIDDocument(issuerDid, issuer.publicKey)));

    const vp = await new VPBuilder({ vc: child, holderDid: delegateDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(delegate.privateKey, `${delegateDid}#key-1`);

    await expect(verifyVP(vp)).resolves.toMatchObject({
      valid: true,
      agentDid: delegateDid,
      delegationChain: [
        expect.objectContaining({ subject: holderDid, delegationDepth: 0 }),
        expect.objectContaining({ subject: delegateDid, delegationDepth: 1 }),
      ],
    });
  });

  it('rejects delegated VCs with missing or broken chains', async () => {
    const holder = generateKeyPair();
    const delegate = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const delegateDid = didKey(delegate.publicKey);
    const selfRoot = await selfIssueVC(
      { scopes: ['read:orders', 'write:orders'], maxDelegationDepth: 1 },
      { did: holderDid, privateKeyHex: holder.privateKey },
    );
    const child = await buildDelegationVC(
      { to: delegateDid, scopes: ['read:orders'], expiresIn: 60, fromVC: selfRoot },
      { did: holderDid, privateKeyHex: holder.privateKey },
    );
    const vp = await new VPBuilder({ vc: child, holderDid: delegateDid, targetService: 'orders', userDid: 'did:web:user.example' })
      .sign(delegate.privateKey, `${delegateDid}#key-1`);

    const { proof: _proof, delegationChain: _chain, ...missingChainPayload } = child as SignedVC & { delegationChain?: SignedVC[] };
    const missingChainChild = {
      ...missingChainPayload,
      proof: await createEd25519Proof(missingChainPayload, holder.privateKey, `${holderDid}#key-1`),
    } as SignedVC;
    const missingChainVp = await new VPBuilder({
      vc: missingChainChild,
      holderDid: delegateDid,
      targetService: 'orders',
      userDid: 'did:web:user.example',
    }).sign(delegate.privateKey, `${delegateDid}#key-1`);

    await expect(verifyVP(missingChainVp, { allowSelfSigned: true }))
      .rejects.toMatchObject({ code: 'DELEGATION_CHAIN_INVALID' });
    await expect(verifyVP(vp, { allowSelfSigned: true }))
      .rejects.toMatchObject({ code: 'DELEGATION_CHAIN_INVALID' });
  });

  it('rejects delegated chain link mismatches after signature validation', async () => {
    const issuer = generateKeyPair();
    const holder = generateKeyPair();
    const delegate = generateKeyPair();
    const rogue = generateKeyPair();
    const issuerDid = 'did:web:issuer.example';
    const holderDid = didKey(holder.publicKey);
    const delegateDid = didKey(delegate.publicKey);
    const rogueDid = didKey(rogue.publicKey);
    const root = await issuerSignedVC(
      { did: issuerDid, privateKeyHex: issuer.privateKey },
      holderDid,
      ['read:orders', 'write:orders'],
      { credentialStatus: undefined },
    );
    const child = await buildDelegationVC(
      { to: delegateDid, scopes: ['read:orders'], expiresIn: 60, fromVC: root },
      { did: holderDid, privateKeyHex: holder.privateKey },
    ) as SignedVC & { delegationChain?: SignedVC[] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(buildDIDDocument(issuerDid, issuer.publicKey)));

    const expectBrokenChild = async (
      mutate: (payload: SignedVC & { delegationChain?: SignedVC[] }) => SignedVC & { delegationChain?: SignedVC[] },
      signer = holder,
      signerDid = holderDid,
    ) => {
      const { proof: _proof, ...basePayload } = mutate(child);
      const brokenChild = {
        ...basePayload,
        proof: await createEd25519Proof(basePayload, signer.privateKey, `${signerDid}#key-1`),
      } as SignedVC;
      const vp = await new VPBuilder({ vc: brokenChild, holderDid: delegateDid, targetService: 'orders', userDid: 'did:web:user.example' })
        .sign(delegate.privateKey, `${delegateDid}#key-1`);
      await expect(verifyVP(vp)).rejects.toMatchObject({ code: 'DELEGATION_CHAIN_INVALID' });
    };

    await expectBrokenChild((payload) => ({ ...payload, issuer: rogueDid }), rogue, rogueDid);
    await expectBrokenChild((payload) => ({
      ...payload,
      credentialSubject: { ...payload.credentialSubject, delegatedFrom: delegateDid },
    }));
    await expectBrokenChild((payload) => ({
      ...payload,
      credentialSubject: { ...payload.credentialSubject, parentVcId: 'vc:other' },
    }));
    await expectBrokenChild((payload) => ({
      ...payload,
      credentialSubject: { ...payload.credentialSubject, delegationDepth: 2 },
    }));
    await expectBrokenChild((payload) => ({
      ...payload,
      credentialSubject: { ...payload.credentialSubject, maxDelegationDepth: 2 },
    }));
    await expectBrokenChild((payload) => ({
      ...payload,
      credentialSubject: { ...payload.credentialSubject, privilegeScopes: ['read:orders', 'admin:all'] },
    }));
  });
});

describe('delegation and self-issued VC helpers', () => {
  it('rejects scope escalation and max depth overflow', async () => {
    const holder = generateKeyPair();
    const issuer = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const issuerDid = didKey(issuer.publicKey);
    const parent = await issuerSignedVC(
      { did: issuerDid, privateKeyHex: issuer.privateKey },
      holderDid,
      ['read:orders'],
      { credentialStatus: undefined, credentialSubject: { maxDelegationDepth: 0 } },
    );

    await expect(buildDelegationVC(
      { to: didKey(generateKeyPair().publicKey), scopes: ['write:orders'], expiresIn: 60, fromVC: parent },
      { did: holderDid, privateKeyHex: holder.privateKey },
    )).rejects.toMatchObject({ code: 'SCOPE_ESCALATION_DENIED' });

    await expect(buildDelegationVC(
      { to: didKey(generateKeyPair().publicKey), scopes: [], expiresIn: 60, fromVC: parent },
      { did: holderDid, privateKeyHex: holder.privateKey },
    )).rejects.toMatchObject({ code: 'MAX_DELEGATION_DEPTH_EXCEEDED' });
  });

  it('rejects non-agent parents and equal-scope delegations', async () => {
    const holder = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const userVC = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: 'vc:user',
      type: ['VerifiableCredential', 'HelixUserCredential'],
      issuer: holderDid,
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      credentialSubject: { id: holderDid, type: 'HelixUser' as const, userId: 'u1' },
      proof: await createEd25519Proof({ id: 'vc:user' }, holder.privateKey, `${holderDid}#key-1`),
    } as SignedVC;
    const parent = await selfIssueVC(
      { scopes: ['read:orders'], maxDelegationDepth: 1 },
      { did: holderDid, privateKeyHex: holder.privateKey },
    );

    await expect(buildDelegationVC(
      { to: didKey(generateKeyPair().publicKey), scopes: [], expiresIn: 60, fromVC: userVC },
      { did: holderDid, privateKeyHex: holder.privateKey },
    )).rejects.toMatchObject({ code: 'SCOPE_ESCALATION_DENIED' });
    await expect(buildDelegationVC(
      { to: didKey(generateKeyPair().publicKey), scopes: ['read:orders'], expiresIn: 60, fromVC: parent },
      { did: holderDid, privateKeyHex: holder.privateKey },
    )).rejects.toMatchObject({ code: 'SCOPE_ESCALATION_DENIED' });
  });

  it('builds valid delegation VC structure', async () => {
    const holder = generateKeyPair();
    const issuer = generateKeyPair();
    const delegate = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const issuerDid = didKey(issuer.publicKey);
    const delegateDid = didKey(delegate.publicKey);
    const parent = await issuerSignedVC(
      { did: issuerDid, privateKeyHex: issuer.privateKey },
      holderDid,
      ['read:orders', 'write:orders'],
      { credentialStatus: undefined },
    );

    const child = await buildDelegationVC(
      { to: delegateDid, scopes: ['read:orders'], expiresIn: 60, fromVC: parent },
      { did: holderDid, privateKeyHex: holder.privateKey },
    );

    expect(child.issuer).toBe(holderDid);
    expect(child.credentialSubject).toMatchObject({
      id: delegateDid,
      delegatedFrom: holderDid,
      delegationDepth: 1,
      privilegeScopes: ['read:orders'],
    });
  });

  it('selfIssueVC creates a self-signed dev credential without credentialStatus', async () => {
    const holder = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const vc = await selfIssueVC({ scopes: ['read:orders'] }, { did: holderDid, privateKeyHex: holder.privateKey });

    expect(vc.issuer).toBe(vc.credentialSubject.id);
    expect(vc).not.toHaveProperty('credentialStatus');
    expect((vc as unknown as { evidence: { type: string }[] }).evidence[0]?.type).toBe('SelfSignedDevCredential');
  });

  it('selfIssueVC supports duration units and rejects malformed durations', async () => {
    const holder = generateKeyPair();
    const holderDid = didKey(holder.publicKey);
    const seconds = await selfIssueVC({ scopes: [], expiresIn: '1s' }, { did: holderDid, privateKeyHex: holder.privateKey });
    const days = await selfIssueVC({ scopes: [], expiresIn: '1d' }, { did: holderDid, privateKeyHex: holder.privateKey });

    expect(new Date(days.validUntil).getTime()).toBeGreaterThan(new Date(seconds.validUntil).getTime());
    await expect(selfIssueVC({ scopes: [], expiresIn: 'forever' }, { did: holderDid, privateKeyHex: holder.privateKey }))
      .rejects.toThrow('expiresIn must use s, m, h, or d suffix');
  });
});
