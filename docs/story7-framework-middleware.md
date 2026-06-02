# STORY 7 — Framework Middleware

## Overview

Two thin TypeScript middleware packages — `@helix-id/mcp` and `@helix-id/langchain` — each wrapping the existing SDK/API flow so developers using those frameworks get automatic VP creation, attachment, and verification at tool boundaries. No new API endpoints. No new helix-core primitives. This story is purely additive packages on top of the completed SDK.

Each active package follows the same pattern: intercept the outbound call, retrieve the signed VP from the SDK, attach it as a header or parameter, pass through. The packages are thin by design — if the core SDK changes, only the adapter layer in each package needs updating.

These packages live in `helix-id/packages/` as constitution-approved framework adapters. They are separate from the main monorepo packages but use existing workspace packages such as `@helix-id/sdk-js` and `@helix-id/core`. CrewAI is parked until `helix-sdk-py` exists; Story 7 must not introduce a temporary Python signing path.

---

## 7.0 — Monorepo Structure Addition

Add to `helix-id/`:

```
packages/
├── mcp/                 # @helix-id/mcp
│   ├── src/
│   │   ├── middleware.ts
│   │   └── index.ts
│   ├── tests/
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
└── langchain/           # @helix-id/langchain
│   ├── src/
│   │   ├── middleware.ts
│   │   └── index.ts
│   ├── tests/
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
```

Add to `turbo.json` pipeline so `build` and `test` tasks run across `packages/*` as well as the existing workspace packages.

Add `decisions.md` entries for each framework dependency added (`@modelcontextprotocol/sdk`, `@langchain/core`) per DP-2.

---

## 7.1 — `@helix-id/mcp` — MCP Middleware

### What it does

MCP servers require a valid signed VP before executing any tool. The middleware intercepts every incoming tool call request, extracts the VP from the `Authorization` header, calls `helixClient.verifyVP()`, and either passes through to the tool handler or rejects with a structured error.

On the client side (the agent calling MCP tools), the middleware intercepts outbound tool calls, fetches a VP template, signs it, and attaches it as `Authorization: HelixVP <base64url(signedVP)>`.

### Dependencies

```json
{
  "@helix-id/sdk-js": "workspace:*",
  "@helix-id/core": "workspace:*"
}
```

Declare `@modelcontextprotocol/sdk` as an optional peer dependency, not a hard dependency. Add `@modelcontextprotocol/sdk` to `decisions.md`.

### `packages/mcp/src/middleware.ts`

**Server-side middleware — `helixidMCPMiddleware(options)`:**

```typescript
interface MCPMiddlewareOptions {
  helixClient: HelixClient;
  requiredScopes?: string[];       // if set, JWT or VP must contain all of these
  allowSession?: boolean;          // if true, also accepts a HelixSession JWT instead of VP
  sessionPublicKeyHex?: string;    // required if allowSession: true
}

function helixidMCPMiddleware(options: MCPMiddlewareOptions): MCPMiddleware
```

On each tool call request:

1. Extract `Authorization` header — if missing, return MCP error `{ code: -32001, message: 'Missing authorization' }`
2. Parse scheme: `HelixVP <token>` or `HelixSession <jwt>` (if `allowSession` true)
3. **VP path:** base64url-decode token, parse as `SignedVP`, call `options.helixClient.verifyVP(signedVP)`
4. **Session path:** call `options.helixClient.verifySessionToken(jwt, options.sessionPublicKeyHex)`
5. If `requiredScopes` set: check all required scopes are present in result — return MCP error `{ code: -32003, message: 'Insufficient scopes' }` if not
6. Attach verified identity to request context: `{ agentDid, userDid, scopes, targetService }`
7. Call next handler

**Client-side helper — `attachHelixVP(toolCall, options)`:**

```typescript
interface VPAttachOptions {
  helixClient: HelixClient;
  walletPassphrase: string;
  walletFilePath: string;
  targetService: string;
  userDid: string;
}

async function attachHelixVP(
  toolCall: MCPToolCall,
  options: VPAttachOptions
): Promise<MCPToolCall>
```

1. Load wallet via `AgentWallet.load`
2. Request VP template from Helix ID
3. Sign locally with `VPBuilder`
4. Base64url-encode the signed VP JSON string
5. Set `toolCall.headers['Authorization'] = 'HelixVP ' + encoded`
6. Return modified tool call

### `packages/mcp/src/index.ts`

```typescript
export { helixidMCPMiddleware } from './middleware';
export { attachHelixVP } from './middleware';
export type { MCPMiddlewareOptions, VPAttachOptions };
```

### MCP README

Cover: install, server setup (3-line example), client setup (3-line example), scope enforcement, session token path.

---

## 7.2 — `@helix-id/langchain` — LangChain/LangGraph Middleware

### What it does

Wraps LangChain tool calls so every outbound tool invocation automatically carries a signed VP. The developer wraps their `HelixClient` and wallet config once at chain setup time — no per-call boilerplate.

### Dependencies

```json
{
  "@helix-id/sdk-js": "workspace:*",
  "@helix-id/core": "workspace:*"
}
```

Declare `@langchain/core` as an optional peer dependency, not a hard dependency. The adapter exports structural TypeScript types so unit tests and non-LangChain users do not need to install LangChain.

### `packages/langchain/src/middleware.ts`

**`HelixIDMiddleware(options)` — LangChain runnable wrapper:**

```typescript
interface LangChainMiddlewareOptions {
  helixClient: HelixClient;
  walletPassphrase: string;
  walletFilePath: string;
  targetService: string;
  userDid: string;
}

function HelixIDMiddleware(options: LangChainMiddlewareOptions): RunnableConfig
```

Returns a LangChain-compatible `RunnableConfig` with `callbacks` that intercept `handleToolStart`. On each tool invocation:

1. Request VP template (agentDid from wallet, targetService from options)
2. Load wallet, sign VP locally
3. Inject signed VP into tool input metadata: `toolInput['_helixVP'] = base64url(signedVP)`
4. The receiving tool/service extracts `_helixVP` from input metadata and verifies

**`HelixIDToolWrapper(tool, options)` — wraps an individual tool:**

```typescript
function HelixIDToolWrapper(
  tool: StructuredToolLike,
  options: LangChainMiddlewareOptions
): StructuredToolLike
```

Returns a new `StructuredTool` whose `_call` method prepends VP attachment before calling the original tool's `_call`. Use this when wrapping individual tools rather than an entire chain.

### `packages/langchain/src/index.ts`

```typescript
export { HelixIDMiddleware, HelixIDToolWrapper } from './middleware';
export type { LangChainMiddlewareOptions };
```

### LangChain README

Cover: install, middleware usage (wrap a chain), tool wrapper usage (wrap individual tools), how the VP flows through to the receiving service.

---

## 7.3 — Parked: CrewAI Middleware

CrewAI is intentionally out of active Story 7 scope. It is a Python framework adapter and should be built only after `helix-sdk-py` exists.

Rules for the future CrewAI story:

- Package name: `helix-crewai` published as a Python package, imported as `helix_crewai`.
- Location: `packages/crewai/`.
- It must use `helix-sdk-py` for wallet loading, VP template retrieval, and local signing.
- It must not hand-roll VP canonicalization, base58/base64url encoding, Ed25519 signing, or verification semantics.
- It must not introduce new API endpoints, new trust semantics, or a second source of truth for Helix ID signing behavior.
- Compatibility tests must prove CrewAI-generated VPs verify through the same API path as JS SDK VPs.

The temporary direct HTTP + PyCA signing path is not part of Story 7. If we ever need it, it requires a separate constitution/decisions review.

---

## 7.4 — Tests

### `@helix-id/mcp` — `packages/mcp/tests/`

**Unit tests:**
- `helixidMCPMiddleware` with valid VP in header → calls next handler, context contains `agentDid`
- Missing `Authorization` header → returns MCP error `{ code: -32001 }`
- Valid VP but missing required scope → returns MCP error `{ code: -32003 }`
- `allowSession: true` with valid JWT in `HelixSession` header → passes through
- `attachHelixVP` adds `Authorization: HelixVP ...` header to tool call

All tests use a mock `HelixClient` (stub `verifyVP` and `verifySessionToken`). No real API calls.

### `@helix-id/langchain` — `packages/langchain/tests/`

**Unit tests:**
- `HelixIDMiddleware` intercepts `handleToolStart` and injects `_helixVP` into tool input
- `HelixIDToolWrapper` wraps tool `_call` — original tool receives `_helixVP` in input
- VP is signed locally — mock `HelixClient.verifyVP` is never called during attachment (signing is local)
- Wrong passphrase in options → wallet load failure propagates as error before tool call

All tests mock `HelixClient` and `AgentWallet`.

---

## Story 7 Acceptance Criteria

- [x] `@helix-id/mcp` server middleware verifies VP or session JWT on every tool call — missing auth returns MCP error
- [x] `@helix-id/mcp` client helper attaches signed VP to tool call `Authorization` header
- [x] `@helix-id/langchain` middleware intercepts `handleToolStart` and injects VP into tool input
- [x] `@helix-id/langchain` tool wrapper works on individual tools without full chain setup
- [x] Both active packages have `README.md` with working install + usage examples
- [x] All unit tests pass — no real API calls in any middleware test (mocked clients throughout)
- [x] Private key never appears in any middleware output, log, or test fixture
- [x] `decisions.md` entries for `@modelcontextprotocol/sdk` and `@langchain/core`
- [x] `turbo.json` updated to include `packages/*` in build and test pipeline
- [x] CrewAI remains parked and is not added to build/test scope in this story
- [ ] `pnpm audit` clean across both active packages
