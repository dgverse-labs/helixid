// Browser stand-in for node:fs/promises, aliased in vite.config.ts.
// The SDK's AgentWallet imports these for file-based wallets; the Console
// never uses wallets, so the imports only need to resolve, not work.
function unavailable(): never {
  throw new Error('File-system access is not available in the Console');
}

export const access = unavailable;
export const readFile = unavailable;
export const writeFile = unavailable;
export default { access, readFile, writeFile };
