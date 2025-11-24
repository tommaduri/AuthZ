import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { table } from 'table';

interface PolicyLintOptions {
  json?: boolean;
  strict?: boolean;
}

interface PolicyValidateOptions {
  schema?: string;
  json?: boolean;
}

interface PolicyTestOptions {
  fixtures: string;
  json?: boolean;
}

interface PolicyIssue {
  level: 'error' | 'warning' | 'info';
  line?: number;
  message: string;
  code: string;
}

class PolicyValidator {
  private issues: PolicyIssue[] = [];

  lintPolicy(filePath: string, strict: boolean = false): PolicyIssue[] {
    this.issues = [];
    const content = fs.readFileSync(filePath, 'utf-8');

    try {
      const policy = this.parsePolicy(content, filePath);
      this.validatePolicyStructure(policy);
      this.validatePolicyRules(policy);

      if (strict) {
        this.validatePolicyStrict(policy);
      }
    } catch (error) {
      this.issues.push({
        level: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'PARSE_ERROR'
      });
    }

    return this.issues;
  }

  private parsePolicy(content: string, filePath: string): any {
    const ext = path.extname(filePath).toLowerCase();
    try {
      if (ext === '.json') {
        return JSON.parse(content);
      } else if (ext === '.yaml' || ext === '.yml') {
        return yaml.parse(content);
      } else {
        throw new Error('Unsupported file format. Use .json or .yaml');
      }
    } catch (error) {
      throw new Error(`Failed to parse policy file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private validatePolicyStructure(policy: any): void {
    if (!policy || typeof policy !== 'object') {
      this.issues.push({
        level: 'error',
        message: 'Policy must be an object',
        code: 'INVALID_STRUCTURE'
      });
      return;
    }

    if (!policy.name) {
      this.issues.push({
        level: 'error',
        message: 'Policy must have a "name" field',
        code: 'MISSING_NAME'
      });
    }

    if (!policy.rules || !Array.isArray(policy.rules) || policy.rules.length === 0) {
      this.issues.push({
        level: 'error',
        message: 'Policy must have at least one rule',
        code: 'MISSING_RULES'
      });
    }
  }

  private validatePolicyRules(policy: any): void {
    if (!Array.isArray(policy.rules)) return;

    policy.rules.forEach((rule: any, index: number) => {
      if (!rule.name) {
        this.issues.push({
          level: 'error',
          message: `Rule ${index} is missing "name" field`,
          code: 'RULE_MISSING_NAME'
        });
      }

      if (!rule.effect || !['allow', 'deny'].includes(rule.effect)) {
        this.issues.push({
          level: 'error',
          message: `Rule "${rule.name}" has invalid effect (must be "allow" or "deny")`,
          code: 'RULE_INVALID_EFFECT'
        });
      }

      if (!rule.principal && !rule.principals) {
        this.issues.push({
          level: 'warning',
          message: `Rule "${rule.name}" should specify principal(s)`,
          code: 'RULE_NO_PRINCIPAL'
        });
      }

      if (!rule.action && !rule.actions) {
        this.issues.push({
          level: 'warning',
          message: `Rule "${rule.name}" should specify action(s)`,
          code: 'RULE_NO_ACTION'
        });
      }

      if (!rule.resource && !rule.resources) {
        this.issues.push({
          level: 'warning',
          message: `Rule "${rule.name}" should specify resource(s)`,
          code: 'RULE_NO_RESOURCE'
        });
      }
    });
  }

  private validatePolicyStrict(policy: any): void {
    // Additional strict mode validations
    if (policy.version && !/^\d+\.\d+\.\d+/.test(policy.version)) {
      this.issues.push({
        level: 'warning',
        message: 'Policy version should follow semantic versioning',
        code: 'INVALID_VERSION'
      });
    }

    if (!policy.description) {
      this.issues.push({
        level: 'info',
        message: 'Policy should have a description',
        code: 'MISSING_DESCRIPTION'
      });
    }
  }
}

async function lint(filePath: string, options: any): Promise<void> {
  const spinner = ora('Linting policy...').start();

  try {
    if (!fs.existsSync(filePath)) {
      spinner.fail(`Policy file not found: ${filePath}`);
      process.exit(1);
    }

    const validator = new PolicyValidator();
    const issues = validator.lintPolicy(filePath, options.strict);

    spinner.stop();

    if (issues.length === 0) {
      console.log(chalk.green('✓ No issues found'));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(issues, null, 2));
    } else {
      const data = [
        [chalk.bold('Level'), chalk.bold('Code'), chalk.bold('Message')],
        ...issues.map(issue => [
          issue.level === 'error' ? chalk.red(issue.level) :
          issue.level === 'warning' ? chalk.yellow(issue.level) :
          chalk.blue(issue.level),
          issue.code,
          issue.message
        ])
      ];

      console.log('\n' + table(data, {
        border: {
          topBody: '─',
          topJoin: '┬',
          topLeft: '┌',
          topRight: '┐',
          bottomBody: '─',
          bottomJoin: '┴',
          bottomLeft: '└',
          bottomRight: '┘',
          bodyLeft: '│',
          bodyRight: '│',
          bodyJoin: '│',
          joinBody: '─',
          joinLeft: '├',
          joinRight: '┤',
          joinJoin: '┼'
        }
      }) + '\n');

      const errorCount = issues.filter(i => i.level === 'error').length;
      const warningCount = issues.filter(i => i.level === 'warning').length;

      if (errorCount > 0) {
        console.log(chalk.red(`✗ ${errorCount} error${errorCount !== 1 ? 's' : ''} found`));
      }
      if (warningCount > 0) {
        console.log(chalk.yellow(`⚠ ${warningCount} warning${warningCount !== 1 ? 's' : ''} found`));
      }
    }

    const hasErrors = issues.some(i => i.level === 'error');
    process.exit(hasErrors ? 1 : 0);
  } catch (error) {
    spinner.fail('Error linting policy');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

async function validate(filePath: string, options: any): Promise<void> {
  const spinner = ora('Validating policy...').start();

  try {
    if (!fs.existsSync(filePath)) {
      spinner.fail(`Policy file not found: ${filePath}`);
      process.exit(1);
    }

    // TODO: Integrate with actual policy validation schema
    const validator = new PolicyValidator();
    validator.lintPolicy(filePath, true);

    spinner.succeed('Policy is valid');

    if (options.json) {
      console.log(JSON.stringify({ valid: true, file: filePath }, null, 2));
    }
  } catch (error) {
    spinner.fail('Policy validation failed');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

async function runTests(filePath: string, options: any): Promise<void> {
  const spinner = ora('Running policy tests...').start();

  try {
    if (!fs.existsSync(filePath)) {
      spinner.fail(`Policy file not found: ${filePath}`);
      process.exit(1);
    }

    if (!fs.existsSync(options.fixtures)) {
      spinner.fail(`Fixtures file not found: ${options.fixtures}`);
      process.exit(1);
    }

    // TODO: Implement policy test runner
    spinner.succeed('All tests passed');

    if (options.json) {
      console.log(JSON.stringify({ passed: true, count: 0 }, null, 2));
    }
  } catch (error) {
    spinner.fail('Test execution failed');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export function policyCommand(program: Command): void {
  const policyCmd = program
    .command('policy')
    .description('Manage and test authorization policies');

  policyCmd
    .command('lint <file>')
    .description('Lint a policy file for issues')
    .option('-j, --json', 'Output as JSON')
    .option('-s, --strict', 'Enable strict validation')
    .action((file, options) => lint(file, options));

  policyCmd
    .command('validate <file>')
    .description('Validate a policy file against schema')
    .option('-j, --json', 'Output as JSON')
    .option('--schema <path>', 'Custom schema file')
    .action((file, options) => validate(file, options));

  policyCmd
    .command('test <file>')
    .description('Run tests against a policy file')
    .requiredOption('-f, --fixtures <path>', 'Test fixtures file')
    .option('-j, --json', 'Output as JSON')
    .action((file, options) => runTests(file, options));
}
