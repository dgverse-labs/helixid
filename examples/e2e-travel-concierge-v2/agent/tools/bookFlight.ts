// The agent's book_flight implementation. This is the single choke point where a
// verifiable presentation is created: attachHelixVP loads the wallet, selects the
// credential, and signs a fresh VP bound to the MCP server (targetService). The
// private key is decrypted in-process and never transmitted. The signed VP rides
// along as _helixVP in the MCP tool arguments; the MCP server's @helixid/mcp
// middleware is what decides whether the tool runs.
import { attachHelixVP } from '@helixid/mcp';
import { callMcpTool } from '../mcpClient.js';
import { PROTECTED_TOOL, TARGET_SERVICE, USER_DID, env } from '../../config.js';

export interface BookFlightArgs {
  flightId: string;
  passengerName: string;
}

export interface BookFlightResult {
  success: boolean;
  detail: string;
}

export async function bookFlight(args: BookFlightArgs): Promise<BookFlightResult> {
  const outbound = await attachHelixVP(
    { name: PROTECTED_TOOL, input: { flightId: args.flightId, passengerName: args.passengerName } },
    {
      walletPassphrase: env.walletPassphrase,
      walletFilePath: env.walletPath,
      userDid: USER_DID,
      targetService: TARGET_SERVICE,
    },
  );

  const result = await callMcpTool(PROTECTED_TOOL, outbound.input ?? {});
  // Surface the real result (success or the real rejection reason) so the model
  // can report it truthfully — the agent never writes the outcome itself.
  return { success: !result.isError, detail: result.text };
}
