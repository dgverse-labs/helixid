import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { signBytes } from '@helix-id/core';
import { HelixClient } from '../../../helix-sdk-js/src/client/HelixClient.js';
import { AgentWallet } from '../../../helix-sdk-js/src/wallet/AgentWallet.js';
import { resetTestDatabase, startRealisticApi, type RealisticApi } from '../utils/realisticApi.js';
import { createTestPrisma } from '../utils/prisma.js';

describe('Story 4 Realistic Agent And User Flows', () => {
  let apiServer: RealisticApi;

  beforeAll(async () => {
    await resetTestDatabase();
    apiServer = await startRealisticApi();
  });

  afterAll(async () => {
    await apiServer?.stop();
  });

  it('matches the constitutional onboarding flow end to end', async () => {
    const api = supertest(apiServer.baseUrl);
    const client = new HelixClient(apiServer.baseUrl);
    const wallet = new AgentWallet();
    const prisma = createTestPrisma();
    const dir = await mkdtemp(join(tmpdir(), 'helix-constitutional-onboard-'));
    const walletPath = join(dir, 'agent-wallet.json');
    const agentName = 'Constitutional Onboarding Agent';
    const requestedScopes = ['read:orders', 'write:orders'];
    const requestedDomains = ['https://constitutional.agent.example.com'];

    try {
      const tokenRes = await api
        .post('/v1/enrollment-tokens')
        .send({ agentName, requestedScopes, requestedDomains });

      expect(tokenRes.statusCode).toBe(201);
      expect(tokenRes.body.token).toMatch(/^enroll:[0-9a-f]{24}$/);
      expect(tokenRes.body.expiresAt).toBeDefined();

      const tokenTtlSeconds = Math.round(
        (new Date(tokenRes.body.expiresAt).getTime() - Date.now()) / 1000,
      );
      expect(tokenTtlSeconds).toBeGreaterThanOrEqual(14 * 60);
      expect(tokenTtlSeconds).toBeLessThanOrEqual(30 * 60);

      const tokenRecordBeforeUse = await prisma.enrollmentToken.findFirstOrThrow({
        where: { agentName },
        orderBy: { createdAt: 'desc' },
      });
      expect(tokenRecordBeforeUse.tokenHash).not.toBe(tokenRes.body.token);
      expect(tokenRecordBeforeUse.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenRecordBeforeUse.usedAt).toBeNull();
      expect(JSON.parse(tokenRecordBeforeUse.requestedScopes)).toEqual(requestedScopes);
      expect(JSON.parse(tokenRecordBeforeUse.requestedDomains)).toEqual(requestedDomains);

      const challenge = await client.requestOnboardingChallenge(tokenRes.body.token, requestedDomains);
      expect(challenge.challengeId).toMatch(/^chal:[0-9a-f]{16}$/);
      expect(challenge.nonce).toMatch(/^[0-9a-f]{64}$/);

      const pendingKeyPair = client.__getPendingKeyPairForTest();
      expect(pendingKeyPair?.publicKey).toMatch(/^[0-9a-f]{64}$/);
      expect(pendingKeyPair?.privateKey).toMatch(/^[0-9a-f]{64}$/);

      const tokenRecordAfterUse = await prisma.enrollmentToken.findUniqueOrThrow({
        where: { tokenHash: tokenRecordBeforeUse.tokenHash },
      });
      expect(tokenRecordAfterUse.usedAt).toBeInstanceOf(Date);

      const challengeRecord = await prisma.challenge.findUniqueOrThrow({
        where: { challengeId: challenge.challengeId },
      });
      expect(challengeRecord.purpose).toBe('agent_onboarding');
      expect(challengeRecord.pendingPublicKeyHex).toBe(pendingKeyPair?.publicKey);
      expect(challengeRecord.pendingDomains).toBe(JSON.stringify(requestedDomains));
      expect(JSON.stringify(challengeRecord)).not.toContain(pendingKeyPair?.privateKey);

      const reusedTokenRes = await api
        .post('/v1/onboard')
        .send({
          enrollmentToken: tokenRes.body.token,
          publicKeyHex: pendingKeyPair?.publicKey,
          domains: requestedDomains,
        });
      expect(reusedTokenRes.statusCode).toBe(409);
      expect(reusedTokenRes.body.error.code).toBe('ENROLLMENT_TOKEN_ALREADY_USED');

      const onboarding = await client.completeOnboarding(
        challenge.challengeId,
        challenge.nonce,
        'constitutional-passphrase',
        walletPath,
      );

      expect(onboarding.agentDid).toMatch(/^did:hedera:testnet:[a-zA-Z0-9._-]+$/);
      expect(onboarding.vcId).toMatch(/^vc:helix:/);
      expect(onboarding.walletSaved).toBe(true);

      const resolvedDid = await api.get(`/v1/dids/${onboarding.agentDid}`);
      expect(resolvedDid.statusCode).toBe(200);
      expect(resolvedDid.body.id).toBe(onboarding.agentDid);
      expect(resolvedDid.body.service[0].serviceEndpoint).toBe(requestedDomains[0]);

      const didRecord = await prisma.did.findUniqueOrThrow({ where: { id: onboarding.agentDid } });
      expect(didRecord.subjectType).toBe('agent');
      expect(didRecord.publicKey).toBe(pendingKeyPair?.publicKey);
      expect(didRecord.hederaTransactionId).toBeTruthy();

      const vcRecord = await prisma.vc.findUniqueOrThrow({ where: { vcId: onboarding.vcId } });
      expect(vcRecord.subjectDid).toBe(onboarding.agentDid);
      expect(vcRecord.subjectType).toBe('agent');
      expect(vcRecord.privilegeScopes).toEqual(requestedScopes);
      expect((vcRecord.vcJson as any).credentialSubject.agentName).toBe(agentName);

      const verifiedChallengeRecord = await prisma.challenge.findUniqueOrThrow({
        where: { challengeId: challenge.challengeId },
      });
      expect(verifiedChallengeRecord.verifiedAt).toBeInstanceOf(Date);

      const rawWallet = await readFile(walletPath, 'utf8');
      expect(rawWallet).toContain('encryptedPrivateKey');
      expect(rawWallet).toContain(pendingKeyPair?.publicKey ?? '');
      expect(rawWallet).not.toContain(pendingKeyPair?.privateKey ?? '');

      const savedWallet = await wallet.load('constitutional-passphrase', walletPath);
      expect(savedWallet.did).toBe(onboarding.agentDid);
      expect(savedWallet.vcId).toBe(onboarding.vcId);
      expect(savedWallet.publicKeyHex).toBe(pendingKeyPair?.publicKey);
      expect(savedWallet.privateKeyHex).toBe(pendingKeyPair?.privateKey);

      const auditLogs = await prisma.auditLog.findMany({
        where: {
          eventType: {
            in: [
              'ENROLLMENT_TOKEN_GENERATED',
              'ENROLLMENT_TOKEN_CONSUMED',
              'CHALLENGE_ISSUED',
              'CHALLENGE_VERIFIED',
              'DID_CREATED',
              'VC_ISSUED',
              'AGENT_ONBOARDED',
            ],
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      const eventTypes = auditLogs.map((entry) => entry.eventType);
      expect(eventTypes).toEqual(expect.arrayContaining([
        'ENROLLMENT_TOKEN_GENERATED',
        'ENROLLMENT_TOKEN_CONSUMED',
        'CHALLENGE_ISSUED',
        'CHALLENGE_VERIFIED',
        'DID_CREATED',
        'VC_ISSUED',
        'AGENT_ONBOARDED',
      ]));

      const auditPayload = auditLogs.map((entry) => entry.payloadJson).join('\n');
      expect(auditPayload).toContain(tokenRecordBeforeUse.tokenHash);
      expect(auditPayload).not.toContain(tokenRes.body.token);
      expect(auditPayload).not.toContain(pendingKeyPair?.privateKey ?? '');
      expect(auditPayload).not.toContain(rawWallet);
    } finally {
      await prisma.$disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('completes onboarding end to end through the SDK and persists the wallet', async () => {
    const client = new HelixClient(apiServer.baseUrl);
    const wallet = new AgentWallet();
    const dir = await mkdtemp(join(tmpdir(), 'helix-story4-onboard-'));
    const walletPath = join(dir, 'agent-wallet.json');

    try {
      const tokenRes = await fetch(`${apiServer.baseUrl}/v1/enrollment-tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentName: 'Story4 Realistic Agent',
          requestedScopes: ['read:orders', 'write:orders'],
          requestedDomains: ['https://story4.agent.example.com']
        })
      });

      expect(tokenRes.status).toBe(201);
      const tokenBody = await tokenRes.json() as { token: string };

      const challenge = await client.requestOnboardingChallenge(
        tokenBody.token,
        ['https://story4.agent.example.com']
      );

      const onboarding = await client.completeOnboarding(
        challenge.challengeId,
        challenge.nonce,
        'story4-passphrase',
        walletPath
      );

      expect(onboarding.agentDid).toMatch(/^did:hedera:testnet:/);
      expect(onboarding.walletSaved).toBe(true);
      expect(onboarding.vcId).toBeTruthy();

      const savedWallet = await wallet.load('story4-passphrase', walletPath);
      expect(savedWallet.did).toBe(onboarding.agentDid);
      expect(savedWallet.vcId).toBe(onboarding.vcId);
      expect(savedWallet.privateKeyHex).toHaveLength(64);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('issues and verifies a real challenge response for an existing DID', async () => {
    const client = new HelixClient(apiServer.baseUrl);
    const didResult = await client.createDID({
      subjectType: 'user',
      domains: ['https://story4.user.example.com']
    });

    const challenge = await client.requestUserChallenge(didResult.did);
    const signature = await signBytes(Buffer.from(challenge.nonce, 'hex'), didResult.keyPair.privateKey);
    const verification = await client.verifyUserChallenge(challenge.challengeId, signature);

    expect(verification.verified).toBe(true);
    expect(verification.did).toBe(didResult.did);
    expect(verification.vc).toBeDefined();
  });
});
