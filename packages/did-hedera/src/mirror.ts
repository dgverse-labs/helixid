import type { DIDDocument } from './core/did.js';
import { HederaResolutionFailedError, ValidationError } from './core/HelixError.js';

export type HederaNetwork = 'testnet' | 'mainnet' | 'previewnet';

export interface ParsedHederaDid {
  network: HederaNetwork;
  topicId: string;
}

export function mirrorBaseUrl(network: HederaNetwork): string {
  return `https://${network}.mirrornode.hedera.com`;
}

export function parseHederaDid(did: string): ParsedHederaDid {
  const parts = did.split(':');
  if (parts.length < 4 || parts[0] !== 'did' || parts[1] !== 'hedera') {
    throw new ValidationError(`Invalid did:hedera DID: ${did}`);
  }

  const network = parts[2] as HederaNetwork;
  if (network !== 'testnet' && network !== 'mainnet' && network !== 'previewnet') {
    throw new ValidationError(`Unsupported Hedera network in DID: ${did}`);
  }

  const identifier = parts.slice(3).join(':');
  const topicMatch = identifier.match(/(0\.0\.\d+)$/);
  const topicId = topicMatch?.[1];
  if (!topicId) {
    throw new ValidationError(`Could not extract Hedera topic id from DID: ${did}`);
  }

  return { network, topicId };
}

export function validateDidDocument(doc: DIDDocument, expectedDid: string): DIDDocument {
  if (doc.id !== expectedDid || !Array.isArray(doc.verificationMethod) || doc.verificationMethod.length === 0) {
    throw new ValidationError(`Invalid DID document for ${expectedDid}`);
  }
  return doc;
}

interface MirrorMessagesResponse {
  messages?: Array<{
    sequence_number: number;
    consensus_timestamp: string;
    message: string;
  }>;
}

export async function fetchTopicMessage(
  network: HederaNetwork,
  topicId: string,
  sequenceNumber?: number,
): Promise<{ sequenceNumber: number; consensusTimestamp: string; contents: string }> {
  const baseUrl = mirrorBaseUrl(network);
  const query = sequenceNumber && sequenceNumber > 0
    ? `?sequencenumber=${sequenceNumber}`
    : '?order=desc&limit=1';
  const url = `${baseUrl}/api/v1/topics/${encodeURIComponent(topicId)}/messages${query}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mirror node request failed';
    throw new HederaResolutionFailedError(message, { network, topicId, url });
  }

  if (!response.ok) {
    throw new HederaResolutionFailedError(
      `Mirror node returned HTTP ${response.status}`,
      { network, topicId, status: response.status, url },
    );
  }

  const body = await response.json() as MirrorMessagesResponse;
  const message = body.messages?.[0];
  if (!message?.message) {
    throw new HederaResolutionFailedError(
      'No HCS messages found for topic',
      { network, topicId, sequenceNumber },
    );
  }

  const contents = Buffer.from(message.message, 'base64').toString('utf8');
  return {
    sequenceNumber: message.sequence_number,
    consensusTimestamp: message.consensus_timestamp,
    contents,
  };
}

export function parseDidDocumentFromMessage(contents: string, expectedDid: string): DIDDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new HederaResolutionFailedError('HCS message is not valid JSON', { expectedDid });
  }
  return validateDidDocument(parsed as DIDDocument, expectedDid);
}
