/**
 * Server Configuration Types
 *
 * Type definitions for YAML-based server configuration.
 */

export interface ServerConfig {
  server: {
    port: number;
    host: string;
  };
  tls: {
    enabled: boolean;
    cert?: string;
    key?: string;
    ca?: string;
  };
  storage: {
    driver: 'memory' | 'disk' | 'redis' | 'postgres';
    path?: string;
    connectionString?: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
  };
  metrics: {
    enabled: boolean;
    port: number;
  };
}

export const DEFAULT_CONFIG: ServerConfig = {
  server: { port: 3592, host: '0.0.0.0' },
  tls: { enabled: false },
  storage: { driver: 'memory' },
  logging: { level: 'info', format: 'json' },
  metrics: { enabled: true, port: 9090 },
};

export const VALID_STORAGE_DRIVERS = ['memory', 'disk', 'redis', 'postgres'] as const;
export const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export const VALID_LOG_FORMATS = ['json', 'text'] as const;
