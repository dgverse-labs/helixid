# @helix-id/langchain

Thin LangChain/LangGraph adapter for Helix ID. It injects a locally signed VP into tool input metadata as `_helixVP`.

```ts
import { HelixIDMiddleware, HelixIDToolWrapper } from '@helix-id/langchain';
import { HelixClient } from '@helix-id/sdk-js';

const helixClient = new HelixClient('https://helix.example.com');

const helix = HelixIDMiddleware({
  helixClient,
  walletPassphrase: process.env.AGENT_WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.json',
  vcId: process.env.AGENT_VC_ID!,
  userDid: 'did:hedera:testnet:user',
  targetService: 'orders',
});

const wrappedTool = HelixIDToolWrapper(existingTool, {
  helixClient,
  walletPassphrase: process.env.AGENT_WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.json',
  vcId: process.env.AGENT_VC_ID!,
  userDid: 'did:hedera:testnet:user',
  targetService: 'orders',
});
```

If the wallet has exactly one matching, unexpired credential, the adapter can use it. If the wallet has zero or multiple matching active credentials, pass the `vcId` your application selected from its wallet or credential store. The adapter only prepares proof material for outbound tool calls. Verification remains the responsibility of the receiving service through the normal Helix ID verify path.
