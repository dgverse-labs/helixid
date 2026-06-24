# @helixid/langchain

Thin LangChain/LangGraph adapter for Helix ID. It injects a locally signed VP into tool input metadata as `_helixVP`.

```ts
import { HelixIDMiddleware, HelixIDToolWrapper, filterToolsByScope } from '@helixid/langchain';

const helix = HelixIDMiddleware({
  walletPassphrase: process.env.AGENT_WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.json',
  targetService: 'orders',
  userDid: 'did:key:user', // Optional, defaults to 'did:key:anonymous'
});

const wrappedTool = HelixIDToolWrapper(existingTool, {
  walletPassphrase: process.env.AGENT_WALLET_PASSPHRASE!,
  walletFilePath: './agent-wallet.json',
  targetService: 'orders',
  userDid: 'did:key:user',
});
```

## Features

- **Local Signing**: signs verifiable presentations locally using the wallet keypair. No API client / network calls.
- **Closure Cache**: loaded agent wallet is cached in the middleware closure to avoid expensive file decrypts on subsequent tool calls.
- **Scope-based Tool Filtering**: filters a list of tools using `filterToolsByScope(tools, walletFilePath, walletPassphrase)` to only include tools whose metadata scope tag (`tool.metadata?.requiredScope`) or name matches the active privilege scopes of the agent VC.
