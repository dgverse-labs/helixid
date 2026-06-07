# @helix-id/mcp

Thin MCP adapter for Helix ID. It verifies `HelixVP` or `HelixSession` authorization before a tool runs, and can attach a locally signed VP to outbound tool calls.

```ts
import { helixidMCPMiddleware, attachHelixVP } from '@helix-id/mcp';
import { HelixClient } from '@helix-id/sdk-js';

const helixClient = new HelixClient('https://helix.example.com');

const requireHelix = helixidMCPMiddleware({
  helixClient,
  requiredScopes: ['read:orders'],
});

const outboundCall = await attachHelixVP(
  { name: 'orders.lookup', headers: {} },
  {
    helixClient,
    walletPassphrase: process.env.AGENT_WALLET_PASSPHRASE!,
    walletFilePath: './agent-wallet.json',
    vcId: process.env.AGENT_VC_ID!,
    userDid: 'did:hedera:testnet:user',
    targetService: 'orders',
  },
);
```

If the wallet has exactly one matching, unexpired credential, the adapter can use it. If the wallet has zero or multiple matching active credentials, pass the `vcId` your application selected from its wallet or credential store. VP templates, signing, verification, replay protection, session JWTs, and scope checks all use the existing Helix ID SDK/API flow.
