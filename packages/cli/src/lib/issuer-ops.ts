import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createEd25519Proof } from '../core/proof.js';
import { createStatusList, getBit, setBit } from '../core/status-list-schema.js';
import type { SignedVC } from '../core/schemas/vc.js';

export interface IssuerKeyMaterial {
  did: string;
  privateKeyHex: string;
  publicKeyHex: string;
}

export interface CliStatusListCredential extends Record<string, unknown> {
  '@context': string[];
  id: string;
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: {
    id: string;
    type: 'BitstringStatusList';
    statusPurpose: 'revocation';
    encodedList: string;
  };
  helixIndexRegistry?: Record<string, number>;
  proof?: SignedVC['proof'];
}

export async function signCredential(
  credential: Record<string, unknown>,
  issuerDid: string,
  privateKeyHex: string,
): Promise<SignedVC> {
  return {
    ...credential,
    proof: await createEd25519Proof(credential, privateKeyHex, `${issuerDid}#key-1`),
  } as SignedVC;
}

export function buildCliStatusListPayload(
  baseUrl: string,
  issuerDid: string,
  length: number,
  registry: Record<string, number> = {},
): CliStatusListCredential {
  return {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://www.w3.org/ns/credentials/status/v1',
    ],
    id: baseUrl,
    type: ['VerifiableCredential', 'BitstringStatusListCredential'],
    issuer: issuerDid,
    validFrom: new Date().toISOString(),
    credentialSubject: {
      id: `${baseUrl}#list`,
      type: 'BitstringStatusList',
      statusPurpose: 'revocation',
      encodedList: createStatusList(length),
    },
    helixIndexRegistry: registry,
  };
}

export function findNextAvailableIndex(encodedList: string, length: number): number {
  for (let index = 0; index < length; index += 1) {
    if (getBit(encodedList, index) === 0) {
      return index;
    }
  }
  throw new Error('Status list is full — no available index');
}

export function getStatusListLength(encodedList: string): number {
  const base64 = encodedList.replace(/-/g, '+').replace(/_/g, '/');
  const compressed = Buffer.from(base64, 'base64');
  const buffer = gunzipSync(compressed);
  return buffer.length * 8;
}

export async function issueAgentCredential(options: {
  issuer: IssuerKeyMaterial;
  agentDid: string;
  scopes: string[];
  expiresMs: number;
  statusList: CliStatusListCredential;
  baseUrl: string;
  maxDelegationDepth: number;
}): Promise<{ vc: SignedVC; statusList: SignedVC; index: number }> {
  const registry = { ...(options.statusList.helixIndexRegistry ?? {}) };
  const encodedList = options.statusList.credentialSubject.encodedList;
  const listLength = getStatusListLength(encodedList);
  const index = findNextAvailableIndex(encodedList, listLength);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + options.expiresMs);
  const vcId = `urn:uuid:${randomUUID()}`;

  const credential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: vcId,
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: options.issuer.did,
    validFrom: now.toISOString(),
    validUntil: expiresAt.toISOString(),
    credentialStatus: {
      id: `${options.baseUrl}#${index}`,
      type: 'BitstringStatusListEntry' as const,
      statusPurpose: 'revocation' as const,
      statusListIndex: index.toString(),
      statusListCredential: options.baseUrl,
    },
    credentialSubject: {
      id: options.agentDid,
      type: 'HelixAgent' as const,
      privilegeScopes: options.scopes,
      agentName: options.agentDid,
      delegationDepth: 0,
      maxDelegationDepth: options.maxDelegationDepth,
    },
  };

  const vc = await signCredential(credential, options.issuer.did, options.issuer.privateKeyHex);
  registry[vcId] = index;

  const updatedListPayload = {
    ...options.statusList,
    credentialSubject: {
      ...options.statusList.credentialSubject,
      encodedList,
    },
    helixIndexRegistry: registry,
    validFrom: options.statusList.validFrom,
  };
  const statusList = await signCredential(updatedListPayload, options.issuer.did, options.issuer.privateKeyHex);

  return { vc, statusList, index };
}

export async function revokeCredentialInStatusList(options: {
  issuer: IssuerKeyMaterial;
  statusList: CliStatusListCredential;
  vcId: string;
}): Promise<{ statusList: SignedVC; index: number; previousBit: 0 | 1 }> {
  const registry = options.statusList.helixIndexRegistry ?? {};
  const index = registry[options.vcId];
  if (index === undefined) {
    throw new Error(`VC ID not found in status list registry: ${options.vcId}`);
  }

  const encodedList = options.statusList.credentialSubject.encodedList;
  const previousBit = getBit(encodedList, index);
  const updatedEncoded = setBit(encodedList, index, 1);

  const updatedListPayload = {
    ...options.statusList,
    credentialSubject: {
      ...options.statusList.credentialSubject,
      encodedList: updatedEncoded,
    },
    helixIndexRegistry: registry,
  };
  const statusList = await signCredential(updatedListPayload, options.issuer.did, options.issuer.privateKeyHex);
  return { statusList, index, previousBit };
}

export function parseStatusListFile(raw: unknown): CliStatusListCredential {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Status list file is not valid JSON');
  }
  const parsed = raw as CliStatusListCredential;
  if (!parsed.credentialSubject?.encodedList) {
    throw new Error('Status list file is missing credentialSubject.encodedList');
  }
  return parsed;
}
