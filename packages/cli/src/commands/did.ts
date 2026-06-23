import { buildDIDDocument, generateKeyPair, publicKeyToMultibase } from '@helixid/core';
import { access } from 'node:fs/promises';
import { requireHederaOperator, requirePassphrase } from '../lib/env.js';
import { error, success } from '../lib/output.js';
import { saveNewWallet } from '../lib/wallet.js';

export interface DidCreateOptions {
  method: 'web' | 'hedera' | 'key';
  domain?: string;
  network?: 'testnet' | 'previewnet' | 'mainnet';
  wallet: string;
}

export async function runDidCreate(options: DidCreateOptions): Promise<void> {
  const passphrase = requirePassphrase();

  try {
    await access(options.wallet);
    error(`Wallet file already exists: ${options.wallet}. Use a different path or remove the file.`);
  } catch {
    // expected — wallet must not exist
  }

  const keyPair = generateKeyPair();

  if (options.method === 'web') {
    if (!options.domain) {
      error('--domain is required for --method web');
    }
    const did = `did:web:${options.domain}`;
    const didDocument = buildDIDDocument(did, keyPair.publicKey);
    await saveNewWallet(options.wallet, passphrase, did, keyPair);

    success(`Issuer DID created: ${did}`);
    console.log('');
    console.log(`Serve this file at: https://${options.domain}/.well-known/did.json`);
    console.log('');
    console.log(JSON.stringify(didDocument, null, 2));
    return;
  }

  if (options.method === 'key') {
    const did = `did:key:${publicKeyToMultibase(keyPair.publicKey)}`;
    await saveNewWallet(options.wallet, passphrase, did, keyPair);
    success(`Agent DID created: ${did}`);
    console.log('');
    console.log('Note: did:key is for agents, not issuers.');
    return;
  }

  if (options.method === 'hedera') {
    let anchorDidHedera: typeof import('@helixid/did-hedera').anchorDidHedera;
    try {
      ({ anchorDidHedera } = await import('@helixid/did-hedera'));
    } catch {
      error('Hedera DID method requires: npm install @helixid/did-hedera');
    }

    const network = options.network ?? 'testnet';
    const { operatorId, operatorKey } = requireHederaOperator();

    const result = await anchorDidHedera({
      privateKeyHex: keyPair.privateKey,
      operatorId,
      operatorKey,
      network,
    });

    await saveNewWallet(options.wallet, passphrase, result.did, keyPair);

    success(`Issuer DID created: ${result.did}`);
    console.log('');
    console.log(`Transaction ID: ${result.transactionId}`);
    console.log(`Topic ID:       ${result.topicId}`);
    return;
  }

  error(`Unknown method: ${options.method as string}`);
}
