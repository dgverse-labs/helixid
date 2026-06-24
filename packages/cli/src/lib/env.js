import chalk from 'chalk';
export function requirePassphrase() {
    const passphrase = process.env.HELIX_WALLET_PASSPHRASE;
    if (!passphrase) {
        console.error(chalk.red('Error: HELIX_WALLET_PASSPHRASE environment variable is required'));
        process.exit(1);
    }
    return passphrase;
}
export function requireHederaOperator() {
    const operatorId = process.env.HEDERA_OPERATOR_ID;
    const operatorKey = process.env.HEDERA_OPERATOR_KEY;
    if (!operatorId || !operatorKey) {
        console.error(chalk.red('Error: HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY environment variables are required'));
        process.exit(1);
    }
    return { operatorId, operatorKey };
}
//# sourceMappingURL=env.js.map