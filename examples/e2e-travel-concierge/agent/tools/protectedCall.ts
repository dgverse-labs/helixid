// The single choke point where a verifiable presentation is created. It loads
// the *selected persona's* wallet, picks either its default credential or the
// delegated credential selected by Use case 4, and signs a fresh VP bound to the
// MCP server. The private key is decrypted in-process and never transmitted.
import { AgentWallet, VPBuilder } from '@helixid/sdk-js';
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
  const wallet = await AgentWallet.load(persona.walletFile, env.walletPassphrase);
  const credentials = wallet.credentials;
  if (credentials.length === 0) {
    throw new Error(`Persona "${persona.id}" has no credential in its wallet`);
  }

  const vc = persona.activeCredentialId
    ? credentials.find((candidate) => candidate.id === persona.activeCredentialId)
    : credentials[0];
  if (!vc) {
    throw new Error(
      `Persona "${persona.id}" active credential ${persona.activeCredentialId} was not found in its wallet`,
    );
  }

  const vp = await new VPBuilder({
    credentials: [vc],
    holderDid: wallet.getDID(),
    targetService: TARGET_SERVICE,
    userDid: USER_DID,
  }).sign(wallet.getPrivateKeyHex(), `${wallet.getDID()}#key-1`);

  const result = await callMcpTool(toolName, { ...input, _helixVP: vp });
  // Surface the real result (success or the real rejection reason) so the model
  // can report it truthfully — the agent never writes the outcome itself.
  return { success: !result.isError, detail: result.text };
}
