import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { DecisionEngine, type CheckRequest, type CheckResponse } from '@authz-engine/core';
import * as fs from 'fs';
import * as path from 'path';

interface CheckOptions {
  principal: string;
  resource: string;
  action: string;
  json?: boolean;
  verbose?: boolean;
  policy?: string;
}

async function performCheck(options: CheckOptions): Promise<void> {
  const spinner = ora('Evaluating policy...').start();

  try {
    // Load policy file if specified
    if (options.policy) {
      const policyPath = path.resolve(options.policy);
      if (!fs.existsSync(policyPath)) {
        spinner.fail(`Policy file not found: ${policyPath}`);
        process.exit(1);
      }
      const policyContent = fs.readFileSync(policyPath, 'utf-8');
      try {
        JSON.parse(policyContent);
      } catch {
        spinner.fail('Invalid policy JSON');
        process.exit(1);
      }
    }

    // Create check request
    const request: CheckRequest = {
      principal: {
        id: options.principal,
        roles: [],
        attributes: {}
      },
      resource: {
        id: options.resource,
        kind: options.resource.split('/')[0],
        attributes: {}
      },
      actions: [options.action]
    };

    // Initialize decision engine
    const engine = new DecisionEngine();

    // Evaluate decision using check() method
    const response: CheckResponse = engine.check(request);

    // Get result for the requested action
    const actionResult = response.results[options.action];
    const isAllowed = actionResult?.effect === 'allow';

    spinner.stop();

    if (options.json) {
      console.log(
        JSON.stringify({
          allowed: isAllowed,
          principal: request.principal.id,
          resource: request.resource.id,
          action: options.action,
          effect: actionResult?.effect,
          policy: actionResult?.policy,
          metadata: actionResult?.meta
        }, null, 2)
      );
    } else {
      const statusColor = isAllowed ? chalk.green : chalk.red;
      const statusText = isAllowed ? 'ALLOWED' : 'DENIED';

      console.log('\n' + chalk.bold('Authorization Decision'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Principal: ${chalk.cyan(request.principal.id)}`);
      console.log(`Resource:  ${chalk.cyan(request.resource.id)}`);
      console.log(`Action:    ${chalk.cyan(options.action)}`);
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Result:    ${statusColor.bold(statusText)}`);

      if (options.verbose && actionResult) {
        console.log(chalk.gray('─'.repeat(50)));
        console.log(`Policy:    ${actionResult.policy}`);
        if (actionResult.meta?.matchedRule) {
          console.log(`Rule:      ${actionResult.meta.matchedRule}`);
        }
        if (actionResult.meta) {
          console.log('\nMetadata:');
          console.log(JSON.stringify(actionResult.meta, null, 2));
        }
      }
      console.log('');
    }

    // Exit with appropriate code
    process.exit(isAllowed ? 0 : 2);
  } catch (error) {
    spinner.fail('Error evaluating policy');
    if (options.verbose) {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }
    process.exit(1);
  }
}

export function checkCommand(program: Command): void {
  program
    .command('check')
    .description('Check if a principal can perform an action on a resource')
    .requiredOption('-p, --principal <id>', 'Principal identifier')
    .requiredOption('-r, --resource <id>', 'Resource identifier')
    .requiredOption('-a, --action <action>', 'Action to perform')
    .option('--policy <file>', 'Policy file to evaluate (optional)')
    .option('-j, --json', 'Output as JSON')
    .option('-v, --verbose', 'Verbose output with explanation')
    .action(performCheck);
}
