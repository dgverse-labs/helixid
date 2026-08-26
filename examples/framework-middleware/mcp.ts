import 'dotenv/config';
import { attachHelixVP, helixidMCPMiddleware } from '../../packages/mcp/src/index.js';
import type { SignedVP } from '@helixid/sdk-js';
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
  logStep('MCP', `Attaching a real HelixVP to tool input for ${targetService}.`);
  const outboundCall = await attachHelixVP(
    { name: 'orders.lookup', input: { orderId: 'ORD-1001' } },
    {
      walletPassphrase,
      walletFilePath: walletPath,
      userDid,
      targetService,
    },
  );

  logStep(
    'MCP',
    `_helixVP attached to tool input (vpId: ${(outboundCall.input?._helixVP as { id?: string })?.id ?? 'unknown'})`,
  );

  const requireReadOrders = helixidMCPMiddleware({
    requiredScopes: ['read:orders'],
    allowSelfSigned: false,
  });

  // Call the middleware with the full tool call (it expects toolCall.input._helixVP)
  const accepted = await requireReadOrders(outboundCall as any);
  logStep('MCP', `Allowed request: ${JSON.stringify(accepted)}`);

  const deniedCall = await attachHelixVP(
    { name: 'inventory.admin', input: { sku: 'SKU-1001' } },
    {
      walletPassphrase,
      walletFilePath: walletPath,
      userDid,
      targetService,
    },
  );
  const requireWriteInventory = helixidMCPMiddleware({ requiredScopes: ['write:inventory'] });
  try {
    await requireWriteInventory(deniedCall as any);
    logStep('MCP', 'Denied request: unexpectedly allowed');
  } catch (err: unknown) {
    logStep('MCP', `Denied request: ${(err as Error).message}`);
  }

  const signedVP = outboundCall.input?._helixVP as SignedVP | undefined;
  if (signedVP) {
    logStep('MCP', `Outbound VP scopes: ${extractScopes(signedVP).join(', ')}.`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
