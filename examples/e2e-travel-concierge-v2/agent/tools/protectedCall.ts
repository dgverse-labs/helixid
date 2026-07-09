// The single choke point where a verifiable presentation is created. attachHelixVP
// loads the *selected persona's* wallet, picks its credential, and signs a fresh
// VP bound to the MCP server (targetService). The private key is decrypted
// in-process and never transmitted. The signed VP rides along as _helixVP in the
// MCP tool arguments; the MCP server's @helixid/mcp middleware decides whether the
// tool runs. Which persona's wallet is used is what makes switching meaningful.
import { attachHelixVP } from '@helixid/mcp';
import { callMcpTool } from '../mcpClient.js';
import { TARGET_SERVICE, USER_DID, env } from '../../config.js';
import type { Persona } from '../../personas/types.js';

export interface ProtectedResult {
  success: boolean;
  detail: string;
}

export async function callProtectedTool(
  persona: Persona,
  toolName: string,
  input: Record<string, unknown>,
): Promise<ProtectedResult> {
  const outbound = await attachHelixVP(
    { name: toolName, input },
    {
      walletPassphrase: env.walletPassphrase,
      walletFilePath: persona.walletFile,
      userDid: USER_DID,
      targetService: TARGET_SERVICE,
    },
  );

  const result = await callMcpTool(toolName, outbound.input ?? {});
  // Surface the real result (success or the real rejection reason) so the model
  // can report it truthfully — the agent never writes the outcome itself.
  return { success: !result.isError, detail: result.text };
}
