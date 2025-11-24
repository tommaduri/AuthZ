import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as http from 'http';

interface ServerOptions {
  json?: boolean;
  host?: string;
  port?: number;
}

async function checkServerHealth(host: string = 'localhost', port: number = 3000): Promise<{
  healthy: boolean;
  status?: number;
  error?: string;
}> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/health`, (res) => {
      resolve({
        healthy: res.statusCode === 200,
        status: res.statusCode
      });
    });

    req.on('error', (err) => {
      resolve({
        healthy: false,
        error: err.message
      });
    });

    setTimeout(() => {
      req.destroy();
      resolve({
        healthy: false,
        error: 'Request timeout'
      });
    }, 5000);
  });
}

async function getServerStatus(host: string = 'localhost', port: number = 3000): Promise<any> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/status`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ status: 'unknown' });
        }
      });
    });

    req.on('error', () => {
      resolve({ status: 'offline' });
    });

    setTimeout(() => {
      req.destroy();
      resolve({ status: 'timeout' });
    }, 5000);
  });
}

async function status(options: ServerOptions): Promise<void> {
  const spinner = ora('Checking server status...').start();

  try {
    const host = options.host || 'localhost';
    const port = options.port || 3000;

    const serverStatus = await getServerStatus(host, port);

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify({
        host,
        port,
        ...serverStatus
      }, null, 2));
    } else {
      const statusColor = serverStatus.status === 'running' ? chalk.green : chalk.red;

      console.log('\n' + chalk.bold('Server Status'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Host:   ${chalk.cyan(host)}`);
      console.log(`Port:   ${chalk.cyan(port)}`);
      console.log(`Status: ${statusColor.bold(serverStatus.status || 'unknown')}`);

      if (serverStatus.version) {
        console.log(`Version: ${chalk.cyan(serverStatus.version)}`);
      }
      if (serverStatus.uptime) {
        console.log(`Uptime: ${chalk.cyan(serverStatus.uptime)}`);
      }

      console.log(chalk.gray('─'.repeat(50)) + '\n');
    }
  } catch (error) {
    spinner.fail('Error checking server status');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

async function health(options: ServerOptions): Promise<void> {
  const spinner = ora('Checking server health...').start();

  try {
    const host = options.host || 'localhost';
    const port = options.port || 3000;

    const healthStatus = await checkServerHealth(host, port);

    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify({
        host,
        port,
        healthy: healthStatus.healthy,
        status: healthStatus.status,
        error: healthStatus.error
      }, null, 2));
    } else {
      const color = healthStatus.healthy ? chalk.green : chalk.red;
      const text = healthStatus.healthy ? 'HEALTHY' : 'UNHEALTHY';

      console.log('\n' + chalk.bold('Server Health'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`Host:   ${chalk.cyan(host)}`);
      console.log(`Port:   ${chalk.cyan(port)}`);
      console.log(`Health: ${color.bold(text)}`);

      if (healthStatus.status) {
        console.log(`HTTP Status: ${chalk.cyan(healthStatus.status)}`);
      }
      if (healthStatus.error) {
        console.log(`Error: ${chalk.yellow(healthStatus.error)}`);
      }

      console.log(chalk.gray('─'.repeat(50)) + '\n');
    }

    process.exit(healthStatus.healthy ? 0 : 1);
  } catch (error) {
    spinner.fail('Error checking server health');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

async function reload(options: ServerOptions): Promise<void> {
  const spinner = ora('Reloading server...').start();

  try {
    const host = options.host || 'localhost';
    const port = options.port || 3592;
    const baseUrl = `http://${host}:${port}`;

    // Call the server's reload endpoint to refresh policies and configuration
    const response = await fetch(`${baseUrl}/api/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      // If reload endpoint doesn't exist, try SIGHUP-style reload via management API
      const mgmtResponse = await fetch(`${baseUrl}/_admin/reload`, {
        method: 'POST',
      }).catch(() => null);

      if (!mgmtResponse?.ok) {
        throw new Error(`Server reload failed: ${response.status} ${response.statusText}`);
      }
    }

    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    spinner.succeed('Server reloaded successfully');

    if (options.json) {
      console.log(JSON.stringify({ reloaded: true, ...data }, null, 2));
    } else {
      console.log(chalk.green('  Policies and configuration reloaded'));
    }
  } catch (error) {
    spinner.fail('Error reloading server');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export function serverCommand(program: Command): void {
  const serverCmd = program
    .command('server')
    .description('Manage the authorization server');

  serverCmd
    .command('status')
    .description('Check server status')
    .option('-h, --host <host>', 'Server host')
    .option('-p, --port <port>', 'Server port', Number)
    .option('-j, --json', 'Output as JSON')
    .action(status);

  serverCmd
    .command('health')
    .description('Check server health')
    .option('-h, --host <host>', 'Server host')
    .option('-p, --port <port>', 'Server port', Number)
    .option('-j, --json', 'Output as JSON')
    .action(health);

  serverCmd
    .command('reload')
    .description('Reload server configuration')
    .option('-h, --host <host>', 'Server host')
    .option('-p, --port <port>', 'Server port', Number)
    .option('-j, --json', 'Output as JSON')
    .action(reload);
}
