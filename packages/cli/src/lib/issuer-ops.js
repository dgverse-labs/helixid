import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createEd25519Proof, createStatusList, getBit, setBit, } from '@helixid/core';
export async function signCredential(credential, issuerDid, privateKeyHex) {
    return {
        ...credential,
        proof: await createEd25519Proof(credential, privateKeyHex, `${issuerDid}#key-1`),
    };
}
export function buildCliStatusListPayload(baseUrl, issuerDid, length, registry = {}) {
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
export function findNextAvailableIndex(encodedList, length) {
    for (let index = 0; index < length; index += 1) {
        if (getBit(encodedList, index) === 0) {
            return index;
        }
    }
    throw new Error('Status list is full — no available index');
}
export function getStatusListLength(encodedList) {
    const base64 = encodedList.replace(/-/g, '+').replace(/_/g, '/');
    const compressed = Buffer.from(base64, 'base64');
    const buffer = gunzipSync(compressed);
    return buffer.length * 8;
}
export async function issueAgentCredential(options) {
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
            type: 'BitstringStatusListEntry',
            statusPurpose: 'revocation',
            statusListIndex: index.toString(),
            statusListCredential: options.baseUrl,
        },
        credentialSubject: {
            id: options.agentDid,
            type: 'HelixAgent',
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
export async function revokeCredentialInStatusList(options) {
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
export function parseStatusListFile(raw) {
    if (typeof raw !== 'object' || raw === null) {
        throw new Error('Status list file is not valid JSON');
    }
    const parsed = raw;
    if (!parsed.credentialSubject?.encodedList) {
        throw new Error('Status list file is missing credentialSubject.encodedList');
    }
    return parsed;
}
//# sourceMappingURL=issuer-ops.js.map