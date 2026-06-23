import chalk from 'chalk';

export function success(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

export function error(message: string): never {
  console.error(chalk.red(`✗ ${message}`));
  process.exit(1);
}

export function warn(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}
