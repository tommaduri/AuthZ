import pino from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger wrapper for AuthZ Engine
 */
export class Logger {
  private pino: pino.Logger;

  constructor(name: string = 'authz-engine', level: LogLevel = 'info') {
    this.pino = pino({
      name,
      level,
      transport: process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    });
  }

  debug(message: string, data?: unknown): void {
    if (data) {
      this.pino.debug(data, message);
    } else {
      this.pino.debug(message);
    }
  }

  info(message: string, data?: unknown): void {
    if (data) {
      this.pino.info(data, message);
    } else {
      this.pino.info(message);
    }
  }

  warn(message: string, data?: unknown): void {
    if (data) {
      this.pino.warn(data, message);
    } else {
      this.pino.warn(message);
    }
  }

  error(message: string, error?: unknown): void {
    if (error instanceof Error) {
      this.pino.error({ err: error }, message);
    } else if (error) {
      this.pino.error(error, message);
    } else {
      this.pino.error(message);
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    const child = new Logger();
    child.pino = this.pino.child(bindings);
    return child;
  }
}

// Default logger instance
export const logger = new Logger();
