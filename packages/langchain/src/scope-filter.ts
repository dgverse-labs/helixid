import { AgentWallet } from '@helix-id/sdk-js';

export interface StructuredTool {
  name: string;
  metadata?: {
    requiredScope?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export async function filterToolsByScope<T extends StructuredTool>(
  tools: T[],
  walletFilePath: string,
  walletPassphrase: string,
): Promise<T[]> {
  const wallet = await AgentWallet.load(walletFilePath, walletPassphrase);
  const vcs = wallet.credentials;
  if (!vcs || vcs.length === 0) {
    throw new Error('No credential in wallet. Run enrollment first.');
  }
  const vc = vcs[0]!;

  // read privilegeScopes from credentialSubject
  const credentialSubject = vc.credentialSubject as { privilegeScopes?: string[] };
  const scopes = credentialSubject.privilegeScopes ?? [];

  return tools.filter((tool) => {
    const requiredScope = tool.metadata?.requiredScope;
    if (!requiredScope) {
      return true;
    }
    return scopes.includes(requiredScope) || scopes.includes(tool.name);
  });
}
