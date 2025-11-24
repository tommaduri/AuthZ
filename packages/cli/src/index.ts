#!/usr/bin/env node

import { Program } from 'commander';
import chalk from 'chalk';
import { checkCommand } from './commands/check.js';
import { policyCommand } from './commands/policy.js';
import { serverCommand } from './commands/server.js';
import { testCommand } from './commands/test.js';

const program = new Program();

program
  .name('authz')
  .description('Aegis Authorization Engine - CLI for policy management and testing')
  .version('0.1.0', '-v, --version');

// Register commands
checkCommand(program);
policyCommand(program);
serverCommand(program);
testCommand(program);

// Global error handler
program.on('command:*', () => {
  console.error(
    chalk.red(
      `\nInvalid command: ${program.args.join(' ')}\nSee --help for a list of available commands.\n`
    )
  );
  process.exit(1);
});

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

program.parse(process.argv);
