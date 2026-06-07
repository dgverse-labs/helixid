import 'dotenv/config';
import {
  HelixIDMiddleware,
  HelixIDToolWrapper,
  type StructuredToolLike,
} from '../../packages/langchain/src/index.js';
import {
  createHelixClient,
  decodeHelixVP,
  logStep,
  loadWalletSummary,
  targetService,
  userDid,
  verifyWithScopes,
  walletPassphrase,
  walletPath,
} from './shared.js';

async function main(): Promise<void> {
  const client = createHelixClient();
  const { wallet, credential } = await loadWalletSummary();

  logStep('LangChain', `Loaded wallet for ${wallet.did}.`);
  logStep('LangChain', `Using VC ${credential.vcId} for target service ${targetService}.`);

  const middleware = HelixIDMiddleware({
    helixClient: client,
    walletPassphrase,
    walletFilePath: walletPath,
    vcId: credential.vcId,
    vcType: 'HelixAgentCredential',
    userDid,
    targetService,
  });

  const input: Record<string, unknown> = { query: 'Look up order ORD-1001' };
  await middleware.callbacks[0]!.handleToolStart({ name: 'orders.lookup' }, input);
  logStep('LangChain', `_helixVP injected into tool input (${String(input._helixVP).length} base64url chars).`);

  const signedVP = decodeHelixVP(input._helixVP);
  const verified = await verifyWithScopes(client, signedVP);
  logStep('Helix ID', `Verified injected VP for ${verified.agentDid}; scopes: ${verified.scopes.join(', ')}.`);

  const verifierClient = createHelixClient();
  const ordersTool: StructuredToolLike = {
    name: 'orders.lookup',
    async _call(toolInput: unknown): Promise<string> {
      if (!toolInput || typeof toolInput !== 'object' || !('_helixVP' in toolInput)) {
        throw new Error('Tool did not receive _helixVP');
      }

      // This is the receiving side of the integration. In a real LangChain app,
      // the protected tool or service verifies the VP before trusting the call.
      const toolVP = decodeHelixVP((toolInput as Record<string, unknown>)._helixVP);
      const toolVerification = await verifyWithScopes(verifierClient, toolVP);
      if (toolVerification.targetService !== targetService) {
        throw new Error(`VP target service mismatch: ${toolVerification.targetService}`);
      }
      if (!toolVerification.scopes.includes('read:orders')) {
        throw new Error('VP is missing required scope read:orders');
      }

      logStep('Orders Tool', `Verified ${toolVerification.agentDid} for read:orders.`);
      return 'order ORD-1001 is ready for fulfillment';
    },
  };

  const wrappedTool = HelixIDToolWrapper(ordersTool, {
    helixClient: client,
    walletPassphrase,
    walletFilePath: walletPath,
    vcId: credential.vcId,
    vcType: 'HelixAgentCredential',
    userDid,
    targetService,
  });
  const result = await wrappedTool._call({ orderId: 'ORD-1001' });
  logStep('LangChain', `Wrapped tool completed: ${String(result)}.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
