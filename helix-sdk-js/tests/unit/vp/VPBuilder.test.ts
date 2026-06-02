import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { getPublicKey } from '@noble/ed25519';
import { VPBuilder } from '../../../src/vp/VPBuilder.js';
import { VPInvalidStructureError, VPExpiredError, verifySignature, hashCanonicalPayload, base58btcDecode } from '@helix-id/core';

describe('VPBuilder (SDK Unit Tests)', () => {
  const privateKeyHex = randomBytes(32).toString('hex');
  const wrongPrivateKeyHex = randomBytes(32).toString('hex');
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getValidUnsignedVP = (): any => ({
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiablePresentation'],
    id: `vp:helix:${randomBytes(12).toString('hex')}`,
    holder: 'did:hedera:testnet:agent-sdk',
    verifiableCredential: [{ id: 'vc:test:1', credentialSubject: {} }],
    nonce: randomBytes(32).toString('hex'),
    expirationDate: new Date(Date.now() + 60000).toISOString(),
    delegatedBy: 'did:hedera:testnet:user1',
    targetService: 'amazon'
  });

  it('builds and signs a valid VP correctly', async () => {
    const unsigned = getValidUnsignedVP();
    const builder = new VPBuilder(unsigned);
    const signed = await builder.sign(privateKeyHex, 'did:hedera:testnet:agent-sdk#key-1');

    expect(signed).toBeDefined();
    expect(signed.proof).toBeDefined();
    expect(signed.proof.verificationMethod).toBe('did:hedera:testnet:agent-sdk#key-1');

    // Verify self
    const { proof, ...payload } = signed;
    const publicKeyHex = Buffer.from(await getPublicKey(privateKeyHex)).toString('hex');
    const hash = hashCanonicalPayload(payload);
    const valid = await verifySignature(
      hash,
      Buffer.from(base58btcDecode(proof.proofValue)).toString('hex'),
      publicKeyHex
    );

    expect(valid).toBe(true);
  });

  it('throws VPInvalidStructureError on invalid unsigned VP structure', async () => {
    const invalid = getValidUnsignedVP();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (invalid as any).holder;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = new VPBuilder(invalid as any);
    await expect(builder.sign(privateKeyHex, 'did:hedera:testnet:agent-sdk#key-1'))
      .rejects.toThrow(VPInvalidStructureError);
  });

  it('throws VPExpiredError when unsigned VP is expired', async () => {
    const expired = getValidUnsignedVP();
    expired.expirationDate = new Date(Date.now() - 60000).toISOString();

    const builder = new VPBuilder(expired);
    await expect(builder.sign(privateKeyHex, 'did:hedera:testnet:agent-sdk#key-1'))
      .rejects.toThrow(VPExpiredError);
  });

  it('verifies signature correctly with matching public key', async () => {
    const unsigned = getValidUnsignedVP();
    const builder = new VPBuilder(unsigned);
    const signed = await builder.sign(privateKeyHex, 'did:hedera:testnet:agent-sdk#key-1');

    const publicKeyHex = Buffer.from(await getPublicKey(privateKeyHex)).toString('hex');
    const valid = await VPBuilder.verify(signed, publicKeyHex);
    expect(valid).toBe(true);
  });

  it('fails signature verification with different public key', async () => {
    const unsigned = getValidUnsignedVP();
    const builder = new VPBuilder(unsigned);
    const signed = await builder.sign(privateKeyHex, 'did:hedera:testnet:agent-sdk#key-1');

    const wrongPublicKeyHex = Buffer.from(await getPublicKey(wrongPrivateKeyHex)).toString('hex');
    const valid = await VPBuilder.verify(signed, wrongPublicKeyHex);
    expect(valid).toBe(false);
  });
});
