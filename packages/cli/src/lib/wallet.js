import { access } from 'node:fs/promises';
import { AgentWallet } from '@helixid/sdk-js';
import chalk from 'chalk';
export async function loadWallet(walletPath, passphrase) {
    try {
        await access(walletPath);
    }
    catch {
        console.error(chalk.red(`Error: Wallet file not found: ${walletPath}`));
        console.error(chalk.yellow('Create one with: helix did create --method web --domain example.com --wallet <path>'));
        process.exit(1);
    }
    try {
        return await AgentWallet.load(walletPath, passphrase);
    }
    catch {
        console.error(chalk.red('Error: Invalid passphrase or corrupted wallet'));
        process.exit(1);
    }
}
export async function loadIssuerKeyMaterial(walletPath, passphrase) {
    const wallet = await loadWallet(walletPath, passphrase);
    return {
        did: wallet.getDID(),
        privateKeyHex: wallet.getPrivateKeyHex(),
        publicKeyHex: wallet.getPublicKey(),
    };
}
export async function saveNewWallet(walletPath, passphrase, did, keyPair) {
    const now = new Date().toISOString();
    const wallet = new AgentWallet();
    await wallet.save({
        did,
        publicKeyHex: keyPair.publicKey,
        privateKeyHex: keyPair.privateKey,
        credentials: [],
        createdAt: now,
        updatedAt: now,
    }, passphrase, walletPath);
}
//# sourceMappingURL=wallet.js.map