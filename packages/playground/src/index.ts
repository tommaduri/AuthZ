#!/usr/bin/env node
/**
 * AuthZ Engine Policy Playground
 *
 * Interactive environment for testing and debugging authorization policies.
 *
 * @module @authz-engine/playground
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { PolicySimulator } from './simulator.js';
import { PolicyRepl } from './repl.js';
import { PlaygroundWebServer } from './web-server.js';

// Re-export components
export { PolicySimulator } from './simulator.js';
export { PolicyRepl } from './repl.js';
export { PlaygroundWebServer } from './web-server.js';
export type {
  SimulatorConfig,
  RuleMatch,
  DecisionExplanation,
  WhatIfResult,
  GeneratedTestCase,
} from './simulator.js';
export type { ReplConfig } from './repl.js';
export type { WebServerConfig } from './web-server.js';

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('authz-playground')
    .description('Interactive policy playground for AuthZ Engine')
    .version('0.1.0');

  // REPL command (default)
  program
    .command('repl', { isDefault: true })
    .description('Start interactive REPL mode')
    .option('-p, --prompt <prompt>', 'Custom prompt string')
    .option('--no-colors', 'Disable colored output')
    .action(async (options) => {
      const repl = new PolicyRepl({
        prompt: options.prompt,
        colors: options.colors,
      });
      await repl.start();
    });

  // Server command
  program
    .command('serve')
    .description('Start web server for HTTP API access')
    .option('-p, --port <port>', 'Port to listen on', '3001')
    .option('-h, --host <host>', 'Host to bind to', 'localhost')
    .option('--no-cors', 'Disable CORS')
    .action(async (options) => {
      const server = new PlaygroundWebServer({
        port: parseInt(options.port, 10),
        host: options.host,
        cors: options.cors,
      });

      // Handle shutdown gracefully
      const shutdown = async () => {
        console.log('\nShutting down...');
        await server.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      await server.start();
    });

  // Simulate command
  program
    .command('simulate')
    .description('Run a single simulation from command line')
    .requiredOption('-f, --policy-file <file>', 'Policy file to load')
    .requiredOption('--principal-id <id>', 'Principal ID')
    .requiredOption('--principal-roles <roles>', 'Principal roles (comma-separated)')
    .requiredOption('--resource-kind <kind>', 'Resource kind')
    .requiredOption('--resource-id <id>', 'Resource ID')
    .requiredOption('--actions <actions>', 'Actions to check (comma-separated)')
    .option('--principal-attrs <json>', 'Principal attributes (JSON)')
    .option('--resource-attrs <json>', 'Resource attributes (JSON)')
    .option('--explain', 'Show detailed explanation')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const fs = await import('fs');
        const policyContent = fs.readFileSync(options.policyFile, 'utf-8');

        const simulator = new PolicySimulator();
        simulator.loadPolicies(policyContent);

        const request = {
          principal: {
            id: options.principalId,
            roles: options.principalRoles.split(',').map((r: string) => r.trim()),
            attributes: options.principalAttrs ? JSON.parse(options.principalAttrs) : {},
          },
          resource: {
            kind: options.resourceKind,
            id: options.resourceId,
            attributes: options.resourceAttrs ? JSON.parse(options.resourceAttrs) : {},
          },
          actions: options.actions.split(',').map((a: string) => a.trim()),
        };

        const response = simulator.simulate(request);

        if (options.json) {
          if (options.explain) {
            const explanation = simulator.explain();
            console.log(JSON.stringify({ response, explanation }, null, 2));
          } else {
            console.log(JSON.stringify(response, null, 2));
          }
        } else {
          // Pretty print
          console.log(chalk.bold.cyan('\nAuthorization Results:'));
          for (const [action, result] of Object.entries(response.results)) {
            const icon = result.effect === 'allow' ? chalk.green('ALLOW') : chalk.red('DENY');
            console.log(`  ${action}: ${icon} (${result.policy})`);
          }

          if (options.explain) {
            const explanation = simulator.explain();
            console.log(chalk.bold.cyan('\nExplanation:'));
            for (const line of explanation.trace) {
              console.log(`  ${line}`);
            }
          }
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    });

  // Generate tests command
  program
    .command('generate-tests')
    .description('Generate test cases from policies')
    .requiredOption('-f, --policy-file <file>', 'Policy file to analyze')
    .option('-o, --output <file>', 'Output file (default: stdout)')
    .option('--format <format>', 'Output format: json, vitest, jest', 'json')
    .action(async (options) => {
      try {
        const fs = await import('fs');
        const policyContent = fs.readFileSync(options.policyFile, 'utf-8');

        const simulator = new PolicySimulator();
        simulator.loadPolicies(policyContent);

        const tests = simulator.generateTestCases();

        let output: string;

        switch (options.format) {
          case 'vitest':
          case 'jest':
            output = generateTestFile(tests, options.format);
            break;
          case 'json':
          default:
            output = JSON.stringify(tests, null, 2);
            break;
        }

        if (options.output) {
          fs.writeFileSync(options.output, output);
          console.log(chalk.green(`Generated ${tests.length} test cases to ${options.output}`));
        } else {
          console.log(output);
        }
      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }
    });

  await program.parseAsync(process.argv);
}

/**
 * Generate test file content from test cases
 */
function generateTestFile(
  tests: Array<{
    name: string;
    description: string;
    request: {
      principal: { id: string; roles: string[]; attributes: Record<string, unknown> };
      resource: { kind: string; id: string; attributes: Record<string, unknown> };
      actions: string[];
    };
    expectedResults: Record<string, string>;
  }>,
  framework: 'vitest' | 'jest'
): string {
  const imports = framework === 'vitest'
    ? `import { describe, it, expect, beforeAll } from 'vitest';`
    : ``;

  const lines = [
    imports,
    `import { PolicySimulator } from '@authz-engine/playground';`,
    ``,
    `describe('Generated Policy Tests', () => {`,
    `  let simulator: PolicySimulator;`,
    ``,
    `  beforeAll(() => {`,
    `    simulator = new PolicySimulator();`,
    `    // Load your policy here`,
    `    // simulator.loadPolicies(policyYaml);`,
    `  });`,
    ``,
  ];

  for (const test of tests) {
    lines.push(`  it('${test.name}', () => {`);
    lines.push(`    // ${test.description}`);
    lines.push(`    const request = ${JSON.stringify(test.request, null, 6).replace(/\n/g, '\n    ')};`);
    lines.push(``);
    lines.push(`    const response = simulator.simulate(request);`);
    lines.push(``);

    for (const [action, effect] of Object.entries(test.expectedResults)) {
      lines.push(`    expect(response.results['${action}'].effect).toBe('${effect}');`);
    }

    lines.push(`  });`);
    lines.push(``);
  }

  lines.push(`});`);

  return lines.join('\n');
}

// Run main if this is the entry point
main().catch((error) => {
  console.error(chalk.red(`Fatal error: ${error.message}`));
  process.exit(1);
});
