import type { DIDDocument } from '@helix-id/core';
import { fetchTopicMessage, parseDidDocumentFromMessage, parseHederaDid } from './mirror.js';

export async function resolveDidHedera(did: string): Promise<DIDDocument> {
  const { network, topicId } = parseHederaDid(did);
  const message = await fetchTopicMessage(network, topicId);
  return parseDidDocumentFromMessage(message.contents, did);
}

/** Alias consumed by helix-core did-resolver dynamic import. */
export const resolveDid = resolveDidHedera;
