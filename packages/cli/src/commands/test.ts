import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { table } from 'table';
import { DecisionEngine, type CheckRequest } from '@authz-engine/core';

interface TestCase {
  name: string;
  principal: string;
  resource: string;
  action: string;
  expected: boolean;
  description?: string;
}

interface TestResult {
  name: string;
  passed: boolean;
  expected: boolean;
  actual: boolean;
  duration: number;
}


class TestRunner {
  private engine = new DecisionEngine();
  private results: TestResult[] = [];

  async runTests(testCases: TestCase[]): Promise<TestResult[]> {
    this.results = [];

    for (const testCase of testCases) {
      const start = Date.now();

      try {
        const request: CheckRequest = {
          principal: {
            id: testCase.principal,
            roles: [],
            attributes: {}
          },
          resource: {
            id: testCase.resource,
            kind: testCase.resource.split('/')[0],
            attributes: {}
          },
          actions: [testCase.action]
        };

        // Use check() method - DecisionEngine API
        const response = this.engine.check(request);
        const actionResult = response.results[testCase.action];
        const isAllowed = actionResult?.effect === 'allow';
        const duration = Date.now() - start;

        this.results.push({
          name: testCase.name,
          passed: isAllowed === testCase.expected,
          expected: testCase.expected,
          actual: isAllowed,
          duration
        });
      } catch (error) {
        const duration = Date.now() - start;
        this.results.push({
          name: testCase.name,
          passed: false,
          expected: testCase.expected,
          actual: false,
          duration
        });
      }
    }

    return this.results;
  }

  getResults(): TestResult[] {
    return this.results;
  }

  getSummary(): {
    total: number;
    passed: number;
    failed: number;
    duration: number;
  } {
    const total = this.results.length;
    const passed = this.results.filter(r => r.passed).length;
    const failed = total - passed;
    const duration = this.results.reduce((sum, r) => sum + r.duration, 0);

    return { total, passed, failed, duration };
  }
}

async function runTests(testFilePath: string, options: any): Promise<void> {
  const spinner = ora('Running tests...').start();

  try {
    if (!fs.existsSync(testFilePath)) {
      spinner.fail(`Test file not found: ${testFilePath}`);
      process.exit(1);
    }

    // Parse test file
    const content = fs.readFileSync(testFilePath, 'utf-8');
    let testCases: TestCase[] = [];

    const ext = path.extname(testFilePath).toLowerCase();
    try {
      if (ext === '.json') {
        testCases = JSON.parse(content);
      } else if (ext === '.yaml' || ext === '.yml') {
        const parsed = yaml.parse(content) as any;
        testCases = Array.isArray(parsed) ? parsed : (parsed.tests || []);
      } else {
        throw new Error('Unsupported test file format. Use .json or .yaml');
      }

      if (!Array.isArray(testCases)) {
        throw new Error('Test file must contain an array of test cases');
      }
    } catch (error) {
      spinner.fail('Failed to parse test file');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }

    if (testCases.length === 0) {
      spinner.warn('No test cases found');
      return;
    }

    // Run tests
    const runner = new TestRunner();
    const results = await runner.runTests(testCases);
    const summary = runner.getSummary();

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify({
        tests: results,
        summary
      }, null, 2));
    } else {
      // Display results in table format
      const data = [
        [
          chalk.bold('Test Name'),
          chalk.bold('Expected'),
          chalk.bold('Actual'),
          chalk.bold('Result'),
          chalk.bold('Duration')
        ],
        ...results.map(result => [
          result.name,
          result.expected ? chalk.green('allow') : chalk.red('deny'),
          result.actual ? chalk.green('allow') : chalk.red('deny'),
          result.passed ? chalk.green('✓ PASS') : chalk.red('✗ FAIL'),
          chalk.gray(`${result.duration}ms`)
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

      // Summary
      console.log(chalk.bold('Test Summary'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Total:    ${chalk.cyan(summary.total)}`);
      console.log(`Passed:   ${chalk.green(summary.passed)}`);
      console.log(`Failed:   ${summary.failed > 0 ? chalk.red(summary.failed) : chalk.green(summary.failed)}`);
      console.log(`Duration: ${chalk.gray(`${summary.duration}ms`)}`);
      console.log(chalk.gray('─'.repeat(50)) + '\n');

      // Detailed failures
      if (options.verbose && summary.failed > 0) {
        const failures = results.filter(r => !r.passed);
        console.log(chalk.red.bold('Failed Tests'));
        failures.forEach(failure => {
          console.log(`  ${chalk.red('✗')} ${failure.name}`);
          console.log(`    Expected: ${failure.expected ? 'allow' : 'deny'}`);
          console.log(`    Actual:   ${failure.actual ? 'allow' : 'deny'}`);
        });
        console.log('');
      }
    }

    // Exit with appropriate code
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (error) {
    spinner.fail('Error running tests');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export function testCommand(program: Command): void {
  program
    .command('test <file>')
    .description('Run authorization tests from a YAML or JSON file')
    .option('-j, --json', 'Output as JSON')
    .option('-v, --verbose', 'Verbose output')
    .option('-b, --bail', 'Stop on first failure')
    .action((file, options) => runTests(file, options));
}
