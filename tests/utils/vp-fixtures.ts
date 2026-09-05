// Copyright 2026 DgVerse LLP
// Shared fixtures for the post-consolidation VP test suites (§9.4). All
// identities are did:key so core's resolver works offline; status lists are
// served either through the API's injected local-repo resolver (own URLs) or
// a fetch stub (SP-hosted URLs).

import { vi } from 'vitest';
import {
  buildStatusListCredential,
  createEd25519Proof,
  createStatusList,
  generateKeyPair,
  issueGrant,
  publicKeyToMultibase,
  VPBuilder,
  type SignedVC,
  type SignedVP,
  type StatusListCredential,
} from '../../src/core/index.js';
import type { IVCService } from '../../src/services/vc/IVCService.js';

export const API_BASE_URL = 'http://localhost:3000';
export const OWN_LIST_ID = 'helix-status-list-1';
export const OWN_LIST_URL = `${API_BASE_URL}/v1/status-list/${OWN_LIST_ID}`;
export const SP_LIST_URL = 'https://sp.example/status/1';
export const USER_DID = 'did:web:user.example';

export interface Actor {
  did: string;
  privateKeyHex: string;
}

export function makeActor(): Actor {
  const keys = generateKeyPair();
  return { did: `did:key:${publicKeyToMultibase(keys.publicKey)}`, privateKeyHex: keys.privateKey };
}

export async function signVC(payload: Record<string, unknown>, signer: Actor): Promise<SignedVC> {
  return {
    ...payload,
    proof: await createEd25519Proof(payload, signer.privateKeyHex, `${signer.did}#key-1`),
  } as SignedVC;
}

export async function makeAgentVC(
  issuer: Actor,
  holderDid: string,
  scopes: string[] = ['read:orders', 'book:flights'],
  overrides: Record<string, unknown> = {},
): Promise<SignedVC> {
  const now = Date.now();
  return signVC(
    {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
      id: `vc:test:agent:${crypto.randomUUID()}`,
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: issuer.did,
      validFrom: new Date(now - 60_000).toISOString(),
      validUntil: new Date(now + 60 * 60_000).toISOString(),
      credentialStatus: {
        id: `${OWN_LIST_URL}#0`,
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: '0',
        statusListCredential: OWN_LIST_URL,
      },
      credentialSubject: {
        id: holderDid,
        type: 'HelixAgent',
        privilegeScopes: scopes,
        agentName: 'test-agent',
        delegationDepth: 0,
        maxDelegationDepth: 2,
      },
      ...overrides,
    },
    issuer,
  );
}

export function makeOwnStatusList(issuer: Actor): StatusListCredential {
  return buildStatusListCredential(OWN_LIST_ID, createStatusList(256), issuer.did, API_BASE_URL);
}

export function makeSpStatusList(sp: Actor): StatusListCredential {
  return buildStatusListCredential('1', createStatusList(256), sp.did, 'https://sp.example');
}

export async function makeGrant(
  sp: Actor,
  agentDid: string,
  userDid: string,
  scopes: string[],
  statusList: StatusListCredential,
): Promise<SignedVC> {
  const { grantVC } = await issueGrant(
    {
      agentDid,
      userDid,
      scopes,
      durability: 'standing',
      statusList,
      statusListCredentialUrl: SP_LIST_URL,
    },
    sp,
  );
  return grantVC;
}

export async function buildSignedVP(
  credentials: SignedVC[],
  holder: Actor,
  userDid?: string,
  targetService = 'orders',
): Promise<SignedVP> {
  return new VPBuilder({
    credentials,
    holderDid: holder.did,
    targetService,
    ...(userDid !== undefined ? { userDid } : {}),
  }).sign(holder.privateKeyHex, `${holder.did}#key-1`);
}

/** Minimal IVCService stub exposing only the local status-list read. */
export function makeVcServiceStub(lists: Record<string, StatusListCredential>): IVCService {
  return {
    getStatusList: async (listId: string) => {
      const list = lists[listId];
      if (!list) throw new Error(`status list not found: ${listId}`);
      return list;
    },
  } as unknown as IVCService;
}

export function stubFetch(bodies: Record<string, unknown>): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const body = bodies[String(url)];
    if (body === undefined) {
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}
