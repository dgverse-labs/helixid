import { Command } from 'commander';
import { runDidCreate } from './commands/did.js';
import { runIssuerInit } from './commands/issuer.js';
import { runRevoke } from './commands/revoke.js';
import { runStatusListCreate } from './commands/status-list.js';
import { runVcIssue, runVcSelfIssue } from './commands/vc.js';
import { runWalletInspect } from './commands/wallet.js';
export function createProgram() {
    const program = new Command('helix')
        .description('HelixID CLI for Platform Operator setup')
        .version('0.1.0');
    // did <subcommands>
    const did = program.command('did').description('DID commands');
    did
        .command('create')
        .description('Create a new DID and wallet (did:web also creates its initial status list)')
        .requiredOption('--method <method>', 'DID method: web, hedera, or key')
        .option('--domain <domain>', 'Domain for did:web (required for web method)')
        .option('--network <network>', 'Hedera network: testnet, previewnet, or mainnet', 'testnet')
        .requiredOption('--wallet <path>', 'Path to encrypted wallet file')
        .option('--no-status-list', 'Skip creating the initial status list (did:web only)')
        .option('--status-list-length <bits>', 'Status list capacity in bits (did:web only)', (value) => Number.parseInt(value, 10))
        .option('--status-list-output <path>', 'Status list output file path (default: status-list.json next to the wallet file)')
        .option('--status-list-base-url <url>', 'Public URL where the status list will be served (default: https://<domain>/.well-known/helix-status-list.json)')
        .action(async (options) => {
        await runDidCreate({
            method: options.method,
            domain: options.domain,
            network: options.network,
            wallet: options.wallet,
            statusList: options.statusList,
            statusListLength: options.statusListLength,
            statusListOutput: options.statusListOutput,
            statusListBaseUrl: options.statusListBaseUrl,
        });
    });
    // issuer <subcommands>
    const issuer = program.command('issuer').description('Issuer commands');
    issuer
        .command('init')
        .description('Verify issuer wallet is ready')
        .requiredOption('--wallet <path>', 'Path to issuer wallet file')
        .action(async (options) => {
        await runIssuerInit({ wallet: options.wallet });
    });
    // status-list <subcommands>
    const statusList = program.command('status-list').description('Status list commands');
    statusList
        .command('create')
        .description('Create a signed BitstringStatusList credential file')
        .requiredOption('--length <bits>', 'Status list capacity in bits', (value) => Number.parseInt(value, 10))
        .requiredOption('--output <path>', 'Output file path')
        .requiredOption('--base-url <url>', 'Public URL where the status list will be served')
        .requiredOption('--wallet <path>', 'Path to issuer wallet file')
        .action(async (options) => {
        await runStatusListCreate({
            length: options.length,
            output: options.output,
            baseUrl: options.baseUrl,
            wallet: options.wallet,
        });
    });
    // vc <subcommands>
    const vc = program.command('vc').description('VC commands');
    vc.command('issue')
        .description('Issue a HelixAgentCredential to an agent DID')
        .requiredOption('--agent-did <did>', 'Agent DID')
        .requiredOption('--scopes <scopes>', 'Comma-separated privilege scopes')
        .requiredOption('--expires <duration>', 'Validity duration (e.g. 90d, 24h)')
        .requiredOption('--status-list <path>', 'Path to status list JSON file')
        .requiredOption('--base-url <url>', 'Public status list URL')
        .requiredOption('--wallet <path>', 'Path to issuer wallet file')
        .option('--output <path>', 'Output VC file path (stdout if omitted)')
        .option('--max-delegation-depth <depth>', 'Max delegation depth', (value) => Number.parseInt(value, 10), 1)
        .action(async (options) => {
        await runVcIssue({
            agentDid: options.agentDid,
            scopes: options.scopes,
            expires: options.expires,
            statusList: options.statusList,
            baseUrl: options.baseUrl,
            wallet: options.wallet,
            output: options.output,
            maxDelegationDepth: options.maxDelegationDepth,
        });
    });
    vc.command('self-issue')
        .description('Issue a self-signed dev credential to an agent wallet')
        .requiredOption('--scopes <scopes>', 'Comma-separated privilege scopes')
        .requiredOption('--expires <duration>', 'Validity duration (e.g. 24h)')
        .requiredOption('--wallet <path>', 'Path to agent wallet file')
        .action(async (options) => {
        await runVcSelfIssue({
            scopes: options.scopes,
            expires: options.expires,
            wallet: options.wallet,
        });
    });
    // revoke
    program
        .command('revoke')
        .description('Revoke a credential by flipping its status list bit')
        .requiredOption('--vc-id <vcId>', 'VC ID to revoke')
        .requiredOption('--status-list <path>', 'Path to status list JSON file')
        .requiredOption('--wallet <path>', 'Path to issuer wallet file')
        .action(async (options) => {
        await runRevoke({
            vcId: options.vcId,
            statusList: options.statusList,
            wallet: options.wallet,
        });
    });
    // wallet <subcommands>
    const walletCmd = program.command('wallet').description('Wallet commands');
    walletCmd
        .command('inspect')
        .description('Inspect wallet contents (never prints private key)')
        .requiredOption('--wallet <path>', 'Path to wallet file')
        .action(async (options) => {
        await runWalletInspect({ wallet: options.wallet });
    });
    return program;
}
export async function runCli(argv) {
    const program = createProgram();
    await program.parseAsync(argv);
}
//# sourceMappingURL=cli.js.map