import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { DecisionEngine, type EvaluationContext, type Policy } from '@authz-engine/core';
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

    // Create evaluation context
    const context: EvaluationContext = {
      principal: {
        id: options.principal,
        roles: [],
        attributes: {}
      },
      resource: {
        id: options.resource,
        type: options.resource.split('/')[0],
        attributes: {}
      },
      action: options.action,
      environment: {
        timestamp: new Date().toISOString(),
        ip: 'unknown'
      }
    };

    // Initialize decision engine
    const engine = new DecisionEngine();

    // Evaluate decision
    const decision = await engine.evaluate(context);

    spinner.stop();

    if (options.json) {
      console.log(
        JSON.stringify({
          allowed: decision.allowed,
          principal: context.principal.id,
          resource: context.resource.id,
          action: context.action,
          explanation: decision.explanation,
          metadata: decision.metadata
        }, null, 2)
      );
    } else {
      const statusColor = decision.allowed ? chalk.green : chalk.red;
      const statusText = decision.allowed ? 'ALLOWED' : 'DENIED';

      console.log('\n' + chalk.bold('Authorization Decision'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Principal: ${chalk.cyan(context.principal.id)}`);
      console.log(`Resource:  ${chalk.cyan(context.resource.id)}`);
      console.log(`Action:    ${chalk.cyan(context.action)}`);
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Result:    ${statusColor.bold(statusText)}`);

      if (options.verbose || decision.explanation) {
        console.log(chalk.gray('─'.repeat(50)));
        if (decision.explanation) {
          console.log(`Explanation: ${decision.explanation}`);
        }
        if (decision.metadata) {
          console.log('\nMetadata:');
          console.log(JSON.stringify(decision.metadata, null, 2));
        }
      }
      console.log('');
    }

    // Exit with appropriate code
    process.exit(decision.allowed ? 0 : 2);
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
