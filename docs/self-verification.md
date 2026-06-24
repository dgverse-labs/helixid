# Self Verification Guide

## DID Resolution

Resolve `did:hedera:testnet:<topicId>:<sequenceNumber>` by fetching:
`https://testnet.mirrornode.hedera.com/api/v1/topics/{topicId}/messages/{sequenceNumber}`.
Decode the message payload and parse the DID document JSON.

## Public Key Extraction

Locate a `verificationMethod` entry with type `Ed25519VerificationKey2020`.
Read `publicKeyMultibase` and decode from base58btc (strip leading `z`) to raw bytes.

## Signature Verification

1. Remove `proof` from VP payload.
2. Canonicalize JSON with recursively sorted keys.
3. SHA-256 hash canonical JSON bytes.
4. Decode `proof.proofValue` from base58btc.
5. Verify Ed25519 signature with extracted public key.

## Status List Check

Fetch VC status list URL from `vc.credentialStatus.statusListCredential`.
Decode `encodedList` (base64url decode, gzip decompress), then read bit at `statusListIndex`.
`0` means active; `1` means revoked.

## VP Expiry

Reject if `signedVP.expirationDate` is not in the future.

## VC Expiry

Reject if embedded `vc.expirationDate` is not in the future.

## Your Obligation for Replay Prevention

If you self-verify rather than calling the Helix ID verify endpoint, you are responsible for implementing vpId consumption tracking. You must store every `signedVP.id` value you have successfully verified and reject any subsequent request presenting the same `id`. Helix ID's verify endpoint handles this automatically. If you self-verify and do not implement this tracking, you are vulnerable to replay attacks.

## Test Vector

- Unsigned VP:
  `{"@context":["https://www.w3.org/2018/credentials/v1"],"type":["VerifiablePresentation"],"id":"vp:helix:test-vector-1","holder":"did:hedera:testnet:agent1","verifiableCredential":[{"id":"vc:test:1"}],"nonce":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","expirationDate":"2030-01-01T00:00:00.000Z","delegatedBy":"did:hedera:testnet:user1","targetService":"amazon"}`
- Canonical JSON:
  same as above (already sorted)
- SHA-256:
  `7f9517e90b32ac882d9f615f0eea9d53d72abf4cc78f6dfb30ccf90f84687c5a`
- Test private key:
  `4f3edf983ac636a65a842ce7c78d9aa706d3b113bce036f3f6fdc57d4fcbfe2e`
