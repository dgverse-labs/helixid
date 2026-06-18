import 'dotenv/config';
import { attachHelixVP, helixidMCPMiddleware, type MCPRequestLike } from '../../packages/mcp/src/index.js';
import type { SignedVP } from '@helix-id/core';
import {
  createHelixClient,
  extractScopes,
  loadWalletSummary,
  logStep,
  targetService,
  userDid,
  verifyWithScopes,
  walletPassphrase,
  walletPath,
} from './shared.js';

async function main(): Promise<void> {
  const client = createHelixClient();
  const { wallet, credential } = await loadWalletSummary();

  const realVerifier = {
    verifySessionToken: client.verifySessionToken.bind(client),
  };

  logStep('MCP', `Loaded wallet for ${wallet.did}.`);
  logStep('MCP', `Attaching a real HelixVP authorization header for ${targetService}.`);
  const outboundCall = await attachHelixVP(
    { name: 'orders.lookup', arguments: { orderId: 'ORD-1001' } },
    {
      walletPassphrase,
      walletFilePath: walletPath,
      vcId: credential.vcId,
      vcType: 'HelixAgentCredential',
      userDid,
      targetService,
    },
  );

  const authHeader = outboundCall.headers?.Authorization;
  logStep('MCP', `Authorization header attached (${authHeader?.length ?? 0} chars; private key not printed).`);

  const requireReadOrders = helixidMCPMiddleware({
    helixClient: realVerifier,
    verifyVP: verifyWithScopes,
    requiredScopes: ['read:orders'],
  });
  const accepted = await requireReadOrders(
    { headers: outboundCall.headers, context: {}, tool: outboundCall.name } satisfies MCPRequestLike,
    (request) => ({ ok: true, helix: request.context?.helix }),
  );
  logStep('MCP', `Allowed request: ${JSON.stringify(accepted)}`);

  const deniedCall = await attachHelixVP(
    { name: 'inventory.admin', arguments: { sku: 'SKU-1001' } },
    {
      walletPassphrase,
      walletFilePath: walletPath,
      vcId: credential.vcId,
      vcType: 'HelixAgentCredential',
      userDid,
      targetService,
    },
  );
  const requireWriteInventory = helixidMCPMiddleware({
    helixClient: realVerifier,
    verifyVP: verifyWithScopes,
    requiredScopes: ['write:inventory'],
  });
  const denied = await requireWriteInventory({ headers: deniedCall.headers, context: {} });
  logStep('MCP', `Denied request: ${JSON.stringify(denied)}`);

  if (authHeader?.startsWith('HelixVP ')) {
    const encoded = authHeader.slice('HelixVP '.length);
    const signedVP = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedVP;
    logStep('MCP', `Outbound VP scopes: ${extractScopes(signedVP).join(', ')}.`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
