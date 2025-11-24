/**
 * Interactive REPL for Policy Testing
 *
 * Provides a command-line interface for interactively testing
 * and debugging authorization policies.
 *
 * @module @authz-engine/playground/repl
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { PolicySimulator } from './simulator.js';
import type {
  DecisionExplanation,
  WhatIfResult,
  GeneratedTestCase,
  RuleMatch,
} from './simulator.js';
import type { CheckRequest, CheckResponse, Effect } from '@authz-engine/core';

/**
 * REPL Configuration
 */
export interface ReplConfig {
  /** Welcome message */
  welcome?: string;
  /** Prompt string */
  prompt?: string;
  /** Enable colors */
  colors?: boolean;
}

/**
 * Interactive REPL for policy testing
 */
export class PolicyRepl {
  private readonly simulator: PolicySimulator;
  private readonly config: ReplConfig;
  private rl?: readline.Interface;
  private running = false;
  private currentPrincipal?: { id: string; roles: string[]; attributes: Record<string, unknown> };
  private currentResource?: { kind: string; id: string; attributes: Record<string, unknown> };

  constructor(config: ReplConfig = {}) {
    this.simulator = new PolicySimulator({ verbose: true });
    this.config = {
      welcome: config.welcome ?? this.getDefaultWelcome(),
      prompt: config.prompt ?? chalk.cyan('authz> '),
      colors: config.colors ?? true,
    };
  }

  /**
   * Start the REPL
   */
  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.running = true;
    console.log(this.config.welcome);

    while (this.running) {
      const input = await this.prompt();
      if (input === null) {
        break;
      }

      try {
        await this.processCommand(input.trim());
      } catch (error) {
        this.printError(error instanceof Error ? error.message : String(error));
      }
    }

    this.rl.close();
  }

  /**
   * Stop the REPL
   */
  stop(): void {
    this.running = false;
    if (this.rl) {
      this.rl.close();
    }
  }

  private prompt(): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.rl || !this.running) {
        resolve(null);
        return;
      }

      this.rl.question(this.config.prompt!, (answer) => {
        resolve(answer);
      });
    });
  }

  private async processCommand(input: string): Promise<void> {
    if (!input) {
      return;
    }

    const [command, ...args] = this.parseInput(input);
    const cmd = command.toLowerCase();

    switch (cmd) {
      case 'help':
      case '?':
        this.showHelp();
        break;

      case 'load':
        await this.handleLoad(args);
        break;

      case 'principal':
      case 'p':
        this.handlePrincipal(args);
        break;

      case 'resource':
      case 'r':
        this.handleResource(args);
        break;

      case 'check':
      case 'c':
        this.handleCheck(args);
        break;

      case 'explain':
      case 'e':
        this.handleExplain();
        break;

      case 'whatif':
      case 'w':
        this.handleWhatIf(args);
        break;

      case 'rules':
        this.handleRules();
        break;

      case 'tests':
      case 't':
        this.handleTests();
        break;

      case 'stats':
        this.handleStats();
        break;

      case 'clear':
        this.handleClear();
        break;

      case 'context':
        this.handleContext();
        break;

      case 'exit':
      case 'quit':
      case 'q':
        this.running = false;
        console.log(chalk.yellow('Goodbye!'));
        break;

      default:
        this.printError(`Unknown command: ${command}. Type 'help' for available commands.`);
    }
  }

  private parseInput(input: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuotes) {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  private showHelp(): void {
    const help = `
${chalk.bold.cyan('Available Commands:')}

${chalk.yellow('Policy Management:')}
  ${chalk.green('load <file|yaml>')}     Load policy from file or inline YAML
  ${chalk.green('clear')}                Clear all loaded policies and context
  ${chalk.green('stats')}                Show statistics about loaded policies

${chalk.yellow('Context Setup:')}
  ${chalk.green('principal <id> <roles>')}  Set current principal (e.g., principal user1 admin,user)
  ${chalk.green('resource <kind> <id>')}    Set current resource (e.g., resource document doc123)
  ${chalk.green('context')}                 Show current context

${chalk.yellow('Authorization Testing:')}
  ${chalk.green('check <actions>')}      Check authorization (e.g., check read,write)
  ${chalk.green('explain')}              Explain the last decision in detail
  ${chalk.green('whatif <changes>')}     Test what-if scenarios

${chalk.yellow('Policy Analysis:')}
  ${chalk.green('rules')}                Find all rules matching current context
  ${chalk.green('tests')}                Auto-generate test cases

${chalk.yellow('Other:')}
  ${chalk.green('help')}                 Show this help message
  ${chalk.green('exit')}                 Exit the REPL

${chalk.dim('Shortcuts: p=principal, r=resource, c=check, e=explain, w=whatif, t=tests, q=quit')}
`;
    console.log(help);
  }

  private async handleLoad(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.printError('Usage: load <file|yaml>');
      return;
    }

    const input = args.join(' ');

    // Check if it's YAML content or a file path
    if (input.includes(':') && (input.includes('\n') || input.startsWith('apiVersion'))) {
      // Inline YAML
      try {
        const results = this.simulator.loadPolicies(input);
        for (const result of results) {
          this.printSuccess(
            `Loaded ${result.type}: ${result.name}` +
            (result.resource ? ` (resource: ${result.resource})` : '')
          );
        }
      } catch (error) {
        this.printError(`Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // File path
      try {
        const fs = await import('fs');
        const content = fs.readFileSync(input, 'utf-8');
        const results = this.simulator.loadPolicies(content);
        for (const result of results) {
          this.printSuccess(
            `Loaded ${result.type}: ${result.name}` +
            (result.resource ? ` (resource: ${result.resource})` : '')
          );
        }
      } catch (error) {
        this.printError(`Failed to load file: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private handlePrincipal(args: string[]): void {
    if (args.length < 2) {
      this.printError('Usage: principal <id> <roles> [attr:value...]');
      this.printInfo('Example: principal user123 admin,user department:engineering');
      return;
    }

    const [id, rolesStr, ...attrArgs] = args;
    const roles = rolesStr.split(',').map((r) => r.trim());
    const attributes: Record<string, unknown> = {};

    for (const attr of attrArgs) {
      const [key, value] = attr.split(':');
      if (key && value) {
        // Try to parse as JSON, otherwise use as string
        try {
          attributes[key] = JSON.parse(value);
        } catch {
          attributes[key] = value;
        }
      }
    }

    this.currentPrincipal = { id, roles, attributes };
    this.printSuccess(`Principal set: ${id} [${roles.join(', ')}]`);

    if (Object.keys(attributes).length > 0) {
      this.printInfo(`Attributes: ${JSON.stringify(attributes)}`);
    }
  }

  private handleResource(args: string[]): void {
    if (args.length < 2) {
      this.printError('Usage: resource <kind> <id> [attr:value...]');
      this.printInfo('Example: resource document doc123 owner:user123');
      return;
    }

    const [kind, id, ...attrArgs] = args;
    const attributes: Record<string, unknown> = {};

    for (const attr of attrArgs) {
      const [key, value] = attr.split(':');
      if (key && value) {
        try {
          attributes[key] = JSON.parse(value);
        } catch {
          attributes[key] = value;
        }
      }
    }

    this.currentResource = { kind, id, attributes };
    this.printSuccess(`Resource set: ${kind}:${id}`);

    if (Object.keys(attributes).length > 0) {
      this.printInfo(`Attributes: ${JSON.stringify(attributes)}`);
    }
  }

  private handleCheck(args: string[]): void {
    if (!this.currentPrincipal) {
      this.printError('No principal set. Use: principal <id> <roles>');
      return;
    }

    if (!this.currentResource) {
      this.printError('No resource set. Use: resource <kind> <id>');
      return;
    }

    if (args.length === 0) {
      this.printError('Usage: check <actions>');
      this.printInfo('Example: check read,write,delete');
      return;
    }

    const actions = args[0].split(',').map((a) => a.trim());

    const request: CheckRequest = {
      principal: this.currentPrincipal,
      resource: this.currentResource,
      actions,
    };

    const response = this.simulator.simulate(request);
    this.printResponse(response);
  }

  private handleExplain(): void {
    try {
      const explanation = this.simulator.explain();
      this.printExplanation(explanation);
    } catch (error) {
      this.printError(error instanceof Error ? error.message : String(error));
    }
  }

  private handleWhatIf(args: string[]): void {
    if (args.length === 0) {
      this.printError('Usage: whatif <changes>');
      this.printInfo('Examples:');
      this.printInfo('  whatif roles:admin,superuser');
      this.printInfo('  whatif attr.department:finance');
      this.printInfo('  whatif resource.owner:user123');
      return;
    }

    try {
      const changes: {
        principal?: { roles?: string[]; attributes?: Record<string, unknown> };
        resource?: { attributes?: Record<string, unknown> };
      } = {};

      for (const arg of args) {
        const [path, value] = arg.split(':');
        const parts = path.split('.');

        if (parts[0] === 'roles') {
          changes.principal = changes.principal ?? {};
          changes.principal.roles = value.split(',').map((r) => r.trim());
        } else if (parts[0] === 'attr' || parts[0] === 'principal') {
          const attrKey = parts[1] ?? parts[0];
          changes.principal = changes.principal ?? {};
          changes.principal.attributes = changes.principal.attributes ?? {};
          try {
            changes.principal.attributes[attrKey] = JSON.parse(value);
          } catch {
            changes.principal.attributes[attrKey] = value;
          }
        } else if (parts[0] === 'resource') {
          const attrKey = parts[1];
          if (attrKey) {
            changes.resource = changes.resource ?? {};
            changes.resource.attributes = changes.resource.attributes ?? {};
            try {
              changes.resource.attributes[attrKey] = JSON.parse(value);
            } catch {
              changes.resource.attributes[attrKey] = value;
            }
          }
        }
      }

      const result = this.simulator.whatIf(changes);
      this.printWhatIfResult(result);
    } catch (error) {
      this.printError(error instanceof Error ? error.message : String(error));
    }
  }

  private handleRules(): void {
    try {
      const rules = this.simulator.findMatchingRules();
      this.printRules(rules);
    } catch (error) {
      this.printError(error instanceof Error ? error.message : String(error));
    }
  }

  private handleTests(): void {
    const tests = this.simulator.generateTestCases();
    this.printTestCases(tests);
  }

  private handleStats(): void {
    const stats = this.simulator.getStats();

    console.log(`
${chalk.bold.cyan('Policy Statistics:')}
  Resource Policies:      ${chalk.yellow(stats.resourcePolicies)}
  Derived Roles Policies: ${chalk.yellow(stats.derivedRolesPolicies)}
  Total Rules:            ${chalk.yellow(stats.totalRules)}
  Resources:              ${chalk.yellow(stats.resources.join(', ') || 'none')}
  Derived Roles:          ${chalk.yellow(stats.derivedRoles.join(', ') || 'none')}
`);
  }

  private handleClear(): void {
    this.simulator.clearPolicies();
    this.currentPrincipal = undefined;
    this.currentResource = undefined;
    this.printSuccess('All policies and context cleared');
  }

  private handleContext(): void {
    console.log(`
${chalk.bold.cyan('Current Context:')}
`);

    if (this.currentPrincipal) {
      console.log(`${chalk.yellow('Principal:')}`);
      console.log(`  ID:         ${chalk.white(this.currentPrincipal.id)}`);
      console.log(`  Roles:      ${chalk.white(this.currentPrincipal.roles.join(', '))}`);
      if (Object.keys(this.currentPrincipal.attributes).length > 0) {
        console.log(`  Attributes: ${chalk.white(JSON.stringify(this.currentPrincipal.attributes))}`);
      }
    } else {
      console.log(`${chalk.dim('No principal set')}`);
    }

    console.log();

    if (this.currentResource) {
      console.log(`${chalk.yellow('Resource:')}`);
      console.log(`  Kind:       ${chalk.white(this.currentResource.kind)}`);
      console.log(`  ID:         ${chalk.white(this.currentResource.id)}`);
      if (Object.keys(this.currentResource.attributes).length > 0) {
        console.log(`  Attributes: ${chalk.white(JSON.stringify(this.currentResource.attributes))}`);
      }
    } else {
      console.log(`${chalk.dim('No resource set')}`);
    }

    console.log();
  }

  // Printing helpers

  private printResponse(response: CheckResponse): void {
    console.log(`
${chalk.bold.cyan('Authorization Results:')}
`);

    for (const [action, result] of Object.entries(response.results)) {
      const effectColor = result.effect === 'allow' ? chalk.green : chalk.red;
      const icon = result.effect === 'allow' ? '✓' : '✗';

      console.log(`  ${effectColor(icon)} ${chalk.white(action)}: ${effectColor(result.effect.toUpperCase())}`);
      console.log(`    ${chalk.dim(`Policy: ${result.policy}`)}`);

      if (result.meta?.matchedRule) {
        console.log(`    ${chalk.dim(`Rule: ${result.meta.matchedRule}`)}`);
      }
    }

    if (response.meta) {
      console.log(`
${chalk.dim(`Evaluation time: ${response.meta.evaluationDurationMs}ms`)}`);
    }
  }

  private printExplanation(explanation: DecisionExplanation): void {
    console.log(`
${chalk.bold.cyan('Decision Explanation:')}
`);

    console.log(chalk.yellow('Trace:'));
    for (const line of explanation.trace) {
      if (line.startsWith('MATCH:')) {
        console.log(`  ${chalk.green(line)}`);
      } else if (line.startsWith('NO MATCH:')) {
        console.log(`  ${chalk.dim(line)}`);
      } else if (line.startsWith('Final decision')) {
        const color = line.includes('allow') ? chalk.green : chalk.red;
        console.log(`  ${color(line)}`);
      } else {
        console.log(`  ${chalk.white(line)}`);
      }
    }

    if (explanation.derivedRoles.length > 0) {
      console.log(`
${chalk.yellow('Derived Roles:')} ${chalk.white(explanation.derivedRoles.join(', '))}`);
    }

    if (explanation.suggestions.length > 0) {
      console.log(`
${chalk.yellow('Suggestions:')}`);
      for (const suggestion of explanation.suggestions) {
        console.log(`  ${chalk.cyan('•')} ${suggestion}`);
      }
    }
  }

  private printWhatIfResult(result: WhatIfResult): void {
    console.log(`
${chalk.bold.cyan('What-If Analysis:')}
`);

    if (result.changed) {
      console.log(chalk.yellow('Decision would CHANGE:'));
      for (const change of result.changes) {
        console.log(`  ${chalk.cyan('•')} ${change}`);
      }
    } else {
      console.log(chalk.green('Decision would NOT change'));
    }

    console.log(`
${chalk.dim('Original:')}`);
    for (const [action, r] of Object.entries(result.original.results)) {
      const color = r.effect === 'allow' ? chalk.green : chalk.red;
      console.log(`  ${action}: ${color(r.effect)}`);
    }

    console.log(`
${chalk.dim('Modified:')}`);
    for (const [action, r] of Object.entries(result.modified.results)) {
      const color = r.effect === 'allow' ? chalk.green : chalk.red;
      console.log(`  ${action}: ${color(r.effect)}`);
    }
  }

  private printRules(rules: RuleMatch[]): void {
    console.log(`
${chalk.bold.cyan('Matching Rules Analysis:')}
`);

    if (rules.length === 0) {
      console.log(chalk.dim('No rules found for current context'));
      return;
    }

    for (const rule of rules) {
      const icon = rule.matched ? chalk.green('✓') : chalk.red('✗');
      const effectColor = rule.effect === 'allow' ? chalk.green : chalk.red;

      console.log(`${icon} ${chalk.white(rule.policyName)}/${chalk.yellow(rule.ruleName)}`);
      console.log(`  Effect:    ${effectColor(rule.effect)}`);
      console.log(`  Actions:   ${chalk.white(rule.actions.join(', '))}`);

      if (rule.roles) {
        console.log(`  Roles:     ${chalk.white(rule.roles.join(', '))}`);
      }

      if (rule.condition) {
        console.log(`  Condition: ${chalk.dim(rule.condition)}`);
      }

      console.log(`  ${rule.matched ? chalk.green(rule.reason) : chalk.dim(rule.reason)}`);
      console.log();
    }
  }

  private printTestCases(tests: GeneratedTestCase[]): void {
    console.log(`
${chalk.bold.cyan('Generated Test Cases:')} (${tests.length} total)
`);

    for (const test of tests) {
      console.log(`${chalk.yellow(test.name)}`);
      console.log(`  ${chalk.dim(test.description)}`);
      console.log(`  Principal: ${test.request.principal.id} [${test.request.principal.roles.join(', ')}]`);
      console.log(`  Resource:  ${test.request.resource.kind}:${test.request.resource.id}`);
      console.log(`  Actions:   ${test.request.actions.join(', ')}`);
      console.log(`  Expected:  ${Object.entries(test.expectedResults)
        .map(([a, e]) => `${a}=${e}`)
        .join(', ')}`);
      console.log(`  Tags:      ${chalk.dim(test.tags.join(', '))}`);
      console.log();
    }
  }

  private printSuccess(message: string): void {
    console.log(chalk.green(`✓ ${message}`));
  }

  private printError(message: string): void {
    console.log(chalk.red(`✗ ${message}`));
  }

  private printInfo(message: string): void {
    console.log(chalk.dim(`  ${message}`));
  }

  private getDefaultWelcome(): string {
    return `
${chalk.bold.cyan('╔════════════════════════════════════════════════════════════╗')}
${chalk.bold.cyan('║')}        ${chalk.bold.white('AuthZ Engine Policy Playground')}                     ${chalk.bold.cyan('║')}
${chalk.bold.cyan('║')}        ${chalk.dim('Interactive Policy Testing Environment')}             ${chalk.bold.cyan('║')}
${chalk.bold.cyan('╚════════════════════════════════════════════════════════════╝')}

${chalk.dim('Type "help" for available commands or "exit" to quit.')}
`;
  }
}

export { PolicyRepl as default };
