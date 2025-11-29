#!/usr/bin/env npx tsx
/**
 * Benchmark Runner Script
 *
 * Runs all performance benchmarks for the AuthZ Engine and generates a report.
 *
 * Usage:
 *   npx tsx scripts/run-benchmarks.ts [options]
 *   pnpm bench
 *   pnpm bench:report
 *
 * Options:
 *   --suite <name>    Run specific benchmark suite (cel, engine, pipeline, throughput)
 *   --iterations <n>  Number of iterations per benchmark (default: 100)
 *   --warmup <n>      Number of warmup iterations (default: 10)
 *   --output <file>   Output file for JSON report
 *   --verbose         Show detailed output
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// Configuration
// =============================================================================

interface BenchmarkConfig {
  name: string;
  package: string;
  file: string;
  description: string;
}

const BENCHMARKS: BenchmarkConfig[] = [
  {
    name: 'cel-evaluator',
    package: 'packages/core',
    file: 'benchmarks/cel-evaluator.bench.ts',
    description: 'CEL Expression Evaluator Performance',
  },
  {
    name: 'decision-engine',
    package: 'packages/core',
    file: 'benchmarks/decision-engine.bench.ts',
    description: 'Decision Engine Performance',
  },
  {
    name: 'agent-pipeline',
    package: 'packages/agents',
    file: 'benchmarks/agent-pipeline.bench.ts',
    description: 'Agent Pipeline Performance',
  },
  {
    name: 'throughput',
    package: 'packages/agents',
    file: 'benchmarks/throughput.bench.ts',
    description: 'Throughput and Latency Distribution',
  },
];

interface BenchmarkResult {
  suite: string;
  description: string;
  timestamp: string;
  duration: number;
  success: boolean;
  output?: string;
  error?: string;
}

interface BenchmarkReport {
  timestamp: string;
  environment: {
    node: string;
    platform: string;
    arch: string;
    cpus: number;
    memory: string;
  };
  results: BenchmarkResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    totalDuration: number;
  };
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs(): {
  suite?: string;
  iterations: number;
  warmup: number;
  output?: string;
  verbose: boolean;
} {
  const args = process.argv.slice(2);
  const config = {
    suite: undefined as string | undefined,
    iterations: 100,
    warmup: 10,
    output: undefined as string | undefined,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--suite':
        config.suite = args[++i];
        break;
      case '--iterations':
        config.iterations = parseInt(args[++i], 10);
        break;
      case '--warmup':
        config.warmup = parseInt(args[++i], 10);
        break;
      case '--output':
        config.output = args[++i];
        break;
      case '--verbose':
        config.verbose = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
AuthZ Engine Benchmark Runner

Usage:
  npx tsx scripts/run-benchmarks.ts [options]

Options:
  --suite <name>      Run specific benchmark suite
                      Options: cel, engine, pipeline, throughput, all
  --iterations <n>    Number of iterations per benchmark (default: 100)
  --warmup <n>        Number of warmup iterations (default: 10)
  --output <file>     Output file for JSON report
  --verbose           Show detailed output
  --help              Show this help message

Examples:
  npx tsx scripts/run-benchmarks.ts --suite cel --verbose
  npx tsx scripts/run-benchmarks.ts --output benchmark-results.json
  npx tsx scripts/run-benchmarks.ts --suite throughput --iterations 1000
`);
}

// =============================================================================
// Environment Information
// =============================================================================

function getEnvironmentInfo(): BenchmarkReport['environment'] {
  const os = require('os');
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    memory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
  };
}

// =============================================================================
// Benchmark Execution
// =============================================================================

async function runBenchmark(
  config: BenchmarkConfig,
  verbose: boolean,
): Promise<BenchmarkResult> {
  const startTime = Date.now();
  const cwd = path.resolve(process.cwd(), config.package);
  const benchFile = path.resolve(cwd, config.file);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running: ${config.description}`);
  console.log(`File: ${config.file}`);
  console.log(`${'='.repeat(60)}\n`);

  // Check if benchmark file exists
  if (!fs.existsSync(benchFile)) {
    return {
      suite: config.name,
      description: config.description,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      success: false,
      error: `Benchmark file not found: ${benchFile}`,
    };
  }

  try {
    // Run vitest bench
    const output = execSync(
      `npx vitest bench ${config.file} --run`,
      {
        cwd,
        encoding: 'utf-8',
        stdio: verbose ? 'inherit' : 'pipe',
        timeout: 300000, // 5 minute timeout
      }
    );

    return {
      suite: config.name,
      description: config.description,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      success: true,
      output: verbose ? undefined : output,
    };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      suite: config.name,
      description: config.description,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      success: false,
      error: err.stderr || err.message || 'Unknown error',
      output: err.stdout,
    };
  }
}

// =============================================================================
// Report Generation
// =============================================================================

function generateReport(results: BenchmarkResult[]): BenchmarkReport {
  const passed = results.filter(r => r.success).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  return {
    timestamp: new Date().toISOString(),
    environment: getEnvironmentInfo(),
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      totalDuration,
    },
  };
}

function printReport(report: BenchmarkReport): void {
  console.log('\n');
  console.log('='.repeat(60));
  console.log('BENCHMARK REPORT');
  console.log('='.repeat(60));
  console.log();
  console.log('Environment:');
  console.log(`  Node.js: ${report.environment.node}`);
  console.log(`  Platform: ${report.environment.platform} (${report.environment.arch})`);
  console.log(`  CPUs: ${report.environment.cpus}`);
  console.log(`  Memory: ${report.environment.memory}`);
  console.log();
  console.log('Results:');
  console.log('-'.repeat(60));

  for (const result of report.results) {
    const status = result.success ? 'PASS' : 'FAIL';
    const statusColor = result.success ? '\x1b[32m' : '\x1b[31m';
    console.log(
      `  ${statusColor}[${status}]\x1b[0m ${result.suite} (${result.duration}ms)`
    );
    if (!result.success && result.error) {
      console.log(`       Error: ${result.error.split('\n')[0]}`);
    }
  }

  console.log('-'.repeat(60));
  console.log();
  console.log('Summary:');
  console.log(`  Total: ${report.summary.total}`);
  console.log(`  Passed: ${report.summary.passed}`);
  console.log(`  Failed: ${report.summary.failed}`);
  console.log(`  Total Duration: ${(report.summary.totalDuration / 1000).toFixed(2)}s`);
  console.log();
}

function saveReport(report: BenchmarkReport, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`Report saved to: ${outputPath}`);
}

// =============================================================================
// Main Execution
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('\n');
  console.log('='.repeat(60));
  console.log('AuthZ Engine Performance Benchmarks');
  console.log('='.repeat(60));

  // Filter benchmarks based on suite argument
  let benchmarksToRun = BENCHMARKS;
  if (args.suite && args.suite !== 'all') {
    benchmarksToRun = BENCHMARKS.filter(b =>
      b.name.includes(args.suite!) ||
      args.suite!.includes(b.name.split('-')[0])
    );

    if (benchmarksToRun.length === 0) {
      console.error(`Unknown benchmark suite: ${args.suite}`);
      console.error(`Available suites: ${BENCHMARKS.map(b => b.name).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`\nRunning ${benchmarksToRun.length} benchmark suite(s)...`);

  // Run benchmarks sequentially
  const results: BenchmarkResult[] = [];
  for (const benchmark of benchmarksToRun) {
    const result = await runBenchmark(benchmark, args.verbose);
    results.push(result);
  }

  // Generate and print report
  const report = generateReport(results);
  printReport(report);

  // Save report if output specified
  if (args.output) {
    saveReport(report, args.output);
  }

  // Exit with error if any benchmarks failed
  if (report.summary.failed > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Benchmark runner error:', error);
  process.exit(1);
});
