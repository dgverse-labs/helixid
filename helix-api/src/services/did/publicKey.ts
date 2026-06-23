// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import { HelixError, ErrorCode, multibaseToPublicKeyHex } from '@helixid/core';

type DIDVerificationMethodLike = {
  type?: unknown;
  publicKeyHex?: unknown;
  publicKeyMultibase?: unknown;
};

type DIDDocumentLike = {
  verificationMethod?: DIDVerificationMethodLike[];
};

type DIDResolveLike = DIDDocumentLike & {
  document?: DIDDocumentLike;
  didDocument?: DIDDocumentLike;
};

export function extractEd25519PublicKeyHexFromDIDDocument(value: unknown): string {
  const wrapped = value as DIDResolveLike;
  const document = wrapped.document ?? wrapped.didDocument ?? wrapped;
  const method = document.verificationMethod?.find(
    (item) => typeof item.type === 'string' && item.type.includes('Ed25519'),
  );

  if (!method) {
    throw new HelixError(ErrorCode.VC_ISSUER_NOT_FOUND, 'Issuer DID document does not contain an Ed25519 verification method', 500);
  }
  if (typeof method.publicKeyHex === 'string') {
    return method.publicKeyHex.toLowerCase();
  }
  if (typeof method.publicKeyMultibase === 'string') {
    return multibaseToPublicKeyHex(method.publicKeyMultibase).toLowerCase();
  }

  throw new HelixError(ErrorCode.VC_ISSUER_NOT_FOUND, 'Issuer DID document does not contain usable public key material', 500);
}
