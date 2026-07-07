// The one place shared constants live. Everything else in this example is a
// single-responsibility file: the seeder enrolls, the MCP server verifies, the
// agent presents. If you find yourself hardcoding a scope or a service name in
// one of those, put it here instead.

/**
 * The demo maps one travel action onto one already-shipped HelixID scope.
 * HelixID's current privilege-scope allow-list is commerce-oriented, so — like
 * v1 — "book a flight" is expressed as `write:orders`. The agent is *also*
 * granted `read:catalog` (flight search) so the credential is realistic, but
 * only `write:orders` gates the protected tool.
 */
export const SCOPES = {
  /** Flight search — granted but not required by the one protected tool. */
  FLIGHTS_READ: 'read:catalog',
  /** Flight booking — the scope the MCP server enforces on `book_flight`. */
  FLIGHTS_BOOK: 'write:orders',
} as const;

/** Scopes the agent enrolls with (what its VC will carry). */
export const AGENT_REQUESTED_SCOPES: string[] = [SCOPES.FLIGHTS_READ, SCOPES.FLIGHTS_BOOK];

/**
 * The service the VP is bound to. The agent stamps this into every presentation
 * (`targetService`) and the MCP server is the audience. It is a plain string
 * identifier — not a URL — and does not need to be pre-registered for the
 * shipped verify + scope path this demo uses.
 */
export const TARGET_SERVICE = 'travel-booking-mcp';

/** The single protected MCP tool this demo exposes. */
export const PROTECTED_TOOL = 'book_flight';

export const AGENT_NAME = 'travel-concierge-v2';

/**
 * A demo user DID the agent claims to act on behalf of. In production this
 * comes from a real user-DID verification flow before the agent acts; here it
 * is a fixed placeholder so the happy path is deterministic.
 */
export const USER_DID = 'did:web:demo-traveler';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/** Config resolved from the environment, with container-friendly defaults. */
export const env = {
  /** Internal HelixID API URL (compose service DNS name inside the network). */
  helixApiUrl: process.env.HELIX_API_URL ?? 'http://helix-api:3000',
  /** Admin key — only the seeder needs it, to mint an enrollment token. */
  adminApiKey: process.env.HELIX_ADMIN_API_KEY ?? 'dev-admin-key-change-in-production',
  /** Encrypted wallet file, on a volume shared between the seeder and the agent. */
  walletPath: process.env.WALLET_PATH ?? '/wallets/agent.enc',
  walletPassphrase: process.env.WALLET_PASSPHRASE ?? 'demo-passphrase',
  /** MCP server URL the agent connects to. */
  mcpServerUrl: process.env.MCP_SERVER_URL ?? 'http://mcp-server:7100/mcp',
  /** Ports. */
  mcpPort: Number(process.env.MCP_PORT ?? 7100),
  agentPort: Number(process.env.AGENT_PORT ?? 4000),
  /** LLM provider selection. */
  llmProvider: (process.env.LLM_PROVIDER ?? 'anthropic') as 'anthropic' | 'openai' | 'azure',
  llmApiKeyOrThrow: () => required('LLM_API_KEY'),
  /**
   * Azure OpenAI settings — used only when LLM_PROVIDER=azure. LLM_API_KEY is
   * the Azure resource key; the "model" is your chat deployment name.
   */
  azureOpenAI: {
    endpointOrThrow: () => required('AZURE_OPENAI_ENDPOINT'),
    deploymentOrThrow: () => required('AZURE_OPENAI_DEPLOYMENT'),
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',
  },
};
