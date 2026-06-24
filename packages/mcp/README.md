# @helixid/mcp

Thin MCP adapter for Helix ID. It verifies `_helixVP` on inbound tool calls and attaches a locally signed VP to outbound tool calls. No API URL or `HelixClient` required at runtime.

```ts
import { helixidMCPMiddleware, attachHelixVP } from '@helixid/mcp';

const requireHelix = helixidMCPMiddleware({
  requiredScopes: ['read:orders'],
});

const outboundCall = await attachHelixVP(
  { name: 'orders.lookup', input: { orderId: 'ORD-1001' } },
  {
    walletPassphrase: process.env.AGENT_WALLET_PASSPHRASE!,
    walletFilePath: './agent-wallet.json',
    targetService: 'orders',
    userDid: 'did:web:user.example.com',
  },
);

await requireHelix(outboundCall);
```

VP signing and verification use standalone `@helixid/sdk-js` functions (`VPBuilder`, `verifyVP`, `requireScope`). Replay protection remains the verifier's responsibility (see `examples/replay-protection/`).
