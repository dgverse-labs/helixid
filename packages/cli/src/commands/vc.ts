import { readFile, writeFile } from 'node:fs/promises';
import { requirePassphrase } from '../lib/env.js';
import { parseDuration } from '../lib/duration.js';
import { issueAgentCredential, parseStatusListFile } from '../lib/issuer-ops.js';
import { error, success } from '../lib/output.js';
import { loadIssuerKeyMaterial, loadWallet } from '../lib/wallet.js';

export async function runVcIssue(options: {
  agentDid: string;
  scopes: string;
  expires: string;
  statusList: string;
  baseUrl: string;
  wallet: string;
  output?: string;
  maxDelegationDepth: number;
}): Promise<void> {
  const passphrase = requirePassphrase();
  const issuer = await loadIssuerKeyMaterial(options.wallet, passphrase);
  const scopes = options.scopes.split(',').map((scope) => scope.trim()).filter(Boolean);
  if (scopes.length === 0) {
    error('At least one scope is required in --scopes');
  }

  let statusListRaw: unknown;
  try {
    statusListRaw = JSON.parse(await readFile(options.statusList, 'utf8'));
  } catch {
    error(`Status list file not found or invalid: ${options.statusList}`);
  }

  const statusList = parseStatusListFile(statusListRaw);
  const expiresMs = parseDuration(options.expires);

  const { vc, statusList: updatedList, index } = await issueAgentCredential({
    issuer,
    agentDid: options.agentDid,
    scopes,
    expiresMs,
    statusList,
    baseUrl: options.baseUrl,
    maxDelegationDepth: options.maxDelegationDepth,
  });

  await writeFile(options.statusList, JSON.stringify(updatedList, null, 2), 'utf8');

  const outputPath = options.output;
  const vcJson = JSON.stringify(vc, null, 2);
  if (outputPath) {
    await writeFile(outputPath, vcJson, 'utf8');
  } else {
    console.log(vcJson);
  }

  success('VC issued');
  console.log('');
  console.log(`Agent DID:    ${options.agentDid}`);
  console.log(`VC ID:        ${vc.id}`);
  console.log(`Scopes:       ${scopes.join(', ')}`);
  console.log(`Expires:      ${vc.validUntil}`);
  console.log(`Status index: ${index}`);
  console.log('');
  if (outputPath) {
    console.log(`Send ${outputPath} to the agent out of band.`);
  } else {
    console.log('Send the VC JSON above to the agent out of band.');
  }
  console.log('Agent runs: wallet.addCredential(vc) to store it.');
}

export async function runVcSelfIssue(options: {
  scopes: string;
  expires: string;
  wallet: string;
}): Promise<void> {
  const passphrase = requirePassphrase();
  const wallet = await loadWallet(options.wallet, passphrase);
  const scopes = options.scopes.split(',').map((scope) => scope.trim()).filter(Boolean);

  await wallet.selfIssueVC({ scopes, expiresIn: options.expires });

  console.log('');
  console.log('⚠ Self-signed VC — for local development only');
  console.log('');
  console.log('This VC is not trusted in production. Any verifier running');
  console.log('verifyVP() in production mode will reject it.');
  console.log('');
  console.log(`VC added to wallet: ${options.wallet}`);
  console.log(`Scopes: ${scopes.join(', ')}`);
  console.log(`Expires: ${options.expires}`);
}
