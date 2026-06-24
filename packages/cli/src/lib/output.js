import chalk from 'chalk';
export function success(message) {
    console.log(chalk.green(`✓ ${message}`));
}
export function error(message) {
    console.error(chalk.red(`✗ ${message}`));
    process.exit(1);
}
export function warn(message) {
    console.log(chalk.yellow(`⚠ ${message}`));
}
//# sourceMappingURL=output.js.map