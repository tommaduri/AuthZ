/**
 * YAML Configuration Tests - TDD Red Phase
 *
 * Comprehensive failing tests for YAML-based server configuration.
 * These tests will FAIL initially until the ConfigManager implementation is complete.
 *
 * Tests cover:
 * - Loading configuration from YAML files
 * - Environment variable substitution (${VAR} and ${VAR:-default})
 * - Configuration validation (types, required fields, valid enums)
 * - Default value application
 * - Hot-reload on SIGHUP signal
 * - CLI argument overrides
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs module for file operations
vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();
  return {
    ...original,
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

/**
 * Import the actual ConfigManager implementation.
 */
import {
  ConfigManager,
  ConfigValidationError,
  ConfigLoadError,
  ServerConfig,
} from '../../src/config/index.js';

// =============================================================================
// TEST SUITE: YAML Configuration
// =============================================================================

describe('YAML Configuration', () => {
  let configManager: ConfigManager;
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Store original environment
    originalEnv = { ...process.env };

    // Create temp directory for test files
    tempDir = path.join(os.tmpdir(), `authz-config-test-${Date.now()}`);
    (fs.mkdirSync as Mock).mockImplementation(() => undefined);
    (fs.existsSync as Mock).mockReturnValue(false);
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Cleanup
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Config Loading Tests
  // ===========================================================================

  describe('config loading', () => {
    it('should load configuration from YAML file', async () => {
      const yamlContent = `
server:
  port: 3592
  host: "0.0.0.0"

tls:
  enabled: false

storage:
  driver: "memory"

logging:
  level: "info"
  format: "json"

metrics:
  enabled: true
  port: 9090
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.server.port).toBe(3592);
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.tls.enabled).toBe(false);
      expect(config.storage.driver).toBe('memory');
      expect(config.logging.level).toBe('info');
      expect(config.logging.format).toBe('json');
      expect(config.metrics.enabled).toBe(true);
      expect(config.metrics.port).toBe(9090);
    });

    it('should use default config when no file provided', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      configManager = new ConfigManager();

      const config = await configManager.load();

      // Should return default configuration
      expect(config.server.port).toBe(3592);
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.storage.driver).toBe('memory');
      expect(config.logging.level).toBe('info');
      expect(config.metrics.enabled).toBe(true);
    });

    it('should throw ConfigLoadError on invalid YAML syntax', async () => {
      const invalidYaml = `
server:
  port: 3592
  host: "0.0.0.0"
  - invalid yaml structure
  [broken: true
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(invalidYaml);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigLoadError);
    });

    it('should throw ConfigLoadError when file does not exist', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);
      (fs.readFileSync as Mock).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      configManager = new ConfigManager({
        configPath: '/nonexistent/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigLoadError);
    });

    it('should support both .yaml and .yml extensions', async () => {
      const yamlContent = `
server:
  port: 8080
  host: "localhost"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      // Test .yml extension
      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yml',
      });

      const config = await configManager.load();
      expect(config.server.port).toBe(8080);
    });

    it('should load config from multiple search paths', async () => {
      const yamlContent = `
server:
  port: 4000
  host: "127.0.0.1"
`;
      // First path doesn't exist, second does
      (fs.existsSync as Mock)
        .mockReturnValueOnce(false)  // /etc/authz/config.yaml
        .mockReturnValueOnce(false)  // ~/.authz/config.yaml
        .mockReturnValueOnce(true);  // ./config.yaml

      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager();

      const config = await configManager.load();
      expect(config.server.port).toBe(4000);
    });

    it('should merge configs from multiple files in order', async () => {
      const baseConfig = `
server:
  port: 3592
  host: "0.0.0.0"
storage:
  driver: "memory"
`;
      const overrideConfig = `
server:
  port: 8080
`;
      // Mock existsSync to return true for base config and override file
      (fs.existsSync as Mock).mockImplementation((p: string) => {
        return p === '/etc/authz/config.yaml' || p === '/etc/authz/config.local.yaml';
      });
      (fs.readFileSync as Mock).mockImplementation((p: string) => {
        if (p === '/etc/authz/config.yaml') return baseConfig;
        if (p === '/etc/authz/config.local.yaml') return overrideConfig;
        throw new Error('File not found');
      });

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      // Port should be overridden, but host preserved
      expect(config.server.port).toBe(8080);
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.storage.driver).toBe('memory');
    });
  });

  // ===========================================================================
  // Environment Variable Substitution Tests
  // ===========================================================================

  describe('environment variables', () => {
    it('should substitute ${VAR} with environment value', async () => {
      process.env.AUTHZ_PORT = '9000';
      process.env.AUTHZ_HOST = 'custom.host.com';

      const yamlContent = `
server:
  port: \${AUTHZ_PORT}
  host: "\${AUTHZ_HOST}"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.server.port).toBe(9000);
      expect(config.server.host).toBe('custom.host.com');
    });

    it('should use default when env var not set: ${VAR:-default}', async () => {
      // Ensure AUTHZ_OPTIONAL is not set
      delete process.env.AUTHZ_OPTIONAL;

      const yamlContent = `
server:
  port: \${AUTHZ_PORT:-3592}
  host: "\${AUTHZ_HOST:-localhost}"
storage:
  driver: "\${STORAGE_DRIVER:-memory}"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.server.port).toBe(3592);
      expect(config.server.host).toBe('localhost');
      expect(config.storage.driver).toBe('memory');
    });

    it('should throw on missing required env var without default', async () => {
      // Ensure required var is not set
      delete process.env.REQUIRED_VAR;

      const yamlContent = `
server:
  port: \${REQUIRED_PORT}
  host: "localhost"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(
        /environment variable.*REQUIRED_PORT.*not set/i
      );
    });

    it('should handle nested environment variable substitution', async () => {
      process.env.TLS_CERT_PATH = '/certs';
      process.env.TLS_CERT_FILE = 'server.pem';
      process.env.TLS_KEY_FILE = 'server.key';

      const yamlContent = `
tls:
  enabled: true
  cert: "\${TLS_CERT_PATH}/\${TLS_CERT_FILE}"
  key: "\${TLS_CERT_PATH}/\${TLS_KEY_FILE}"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.tls.cert).toBe('/certs/server.pem');
    });

    it('should support env prefix for scoped variables', async () => {
      process.env.MYAPP_SERVER_PORT = '7000';
      process.env.MYAPP_SERVER_HOST = 'myapp.local';

      const yamlContent = `
server:
  port: \${SERVER_PORT}
  host: "\${SERVER_HOST}"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
        envPrefix: 'MYAPP_',
      });

      const config = await configManager.load();

      expect(config.server.port).toBe(7000);
      expect(config.server.host).toBe('myapp.local');
    });

    it('should convert env var types correctly', async () => {
      process.env.NUM_VALUE = '42';
      process.env.BOOL_VALUE = 'true';
      process.env.BOOL_FALSE = 'false';

      const yamlContent = `
server:
  port: \${NUM_VALUE}
metrics:
  enabled: \${BOOL_VALUE}
  port: 9090
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.server.port).toBe(42);
      expect(typeof config.server.port).toBe('number');
      expect(config.metrics.enabled).toBe(true);
      expect(typeof config.metrics.enabled).toBe('boolean');
    });

    it('should handle empty string as env var value', async () => {
      process.env.EMPTY_VAR = '';

      const yamlContent = `
server:
  port: 3592
  host: "\${EMPTY_VAR:-default_host}"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      // Empty string should use default
      expect(config.server.host).toBe('default_host');
    });
  });

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe('validation', () => {
    it('should validate port is number', async () => {
      const yamlContent = `
server:
  port: "not-a-number"
  host: "localhost"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);

      try {
        await configManager.load();
      } catch (error) {
        if (error instanceof ConfigValidationError) {
          expect(error.field).toBe('server.port');
          expect(error.expectedType).toBe('number');
        }
      }
    });

    it('should validate port is in valid range (1-65535)', async () => {
      const yamlContent = `
server:
  port: 70000
  host: "localhost"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);
    });

    it('should validate storage driver is valid enum', async () => {
      const yamlContent = `
storage:
  driver: "invalid-driver"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);

      try {
        await configManager.load();
      } catch (error) {
        if (error instanceof ConfigValidationError) {
          expect(error.field).toBe('storage.driver');
          expect(error.message).toContain('memory');
          expect(error.message).toContain('disk');
          expect(error.message).toContain('redis');
          expect(error.message).toContain('postgres');
        }
      }
    });

    it('should validate logging level is valid enum', async () => {
      const yamlContent = `
logging:
  level: "verbose"
  format: "json"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);
    });

    it('should validate logging format is valid enum', async () => {
      const yamlContent = `
logging:
  level: "info"
  format: "xml"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);
    });

    it('should reject unknown configuration keys (strict mode)', async () => {
      const yamlContent = `
server:
  port: 3592
  host: "localhost"
  unknownOption: true
unknownSection:
  foo: "bar"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);
    });

    it('should validate TLS cert and key paths exist when TLS enabled', async () => {
      const yamlContent = `
tls:
  enabled: true
  cert: "/nonexistent/cert.pem"
  key: "/nonexistent/key.pem"
`;
      (fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p === '/nonexistent/cert.pem' || p === '/nonexistent/key.pem') {
          return false;
        }
        return true;
      });
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);
    });

    it('should require cert and key when TLS is enabled', async () => {
      const yamlContent = `
tls:
  enabled: true
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);
    });

    it('should validate storage path exists when driver is disk', async () => {
      const yamlContent = `
storage:
  driver: "disk"
  path: "/nonexistent/storage/path"
`;
      (fs.existsSync as Mock).mockImplementation((p: string) => {
        if (p === '/nonexistent/storage/path') {
          return false;
        }
        return true;
      });
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);
    });

    it('should validate metrics port is different from server port', async () => {
      const yamlContent = `
server:
  port: 3592
metrics:
  enabled: true
  port: 3592
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);
    });

    it('should provide helpful error messages with path to invalid field', async () => {
      const yamlContent = `
server:
  port: "abc"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      try {
        await configManager.load();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        const validationError = error as ConfigValidationError;
        expect(validationError.message).toContain('server.port');
        expect(validationError.field).toBe('server.port');
        expect(validationError.value).toBe('abc');
      }
    });
  });

  // ===========================================================================
  // Default Values Tests
  // ===========================================================================

  describe('defaults', () => {
    it('should apply default port 3592', async () => {
      const yamlContent = `
server:
  host: "localhost"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.server.port).toBe(3592);
    });

    it('should apply default host 0.0.0.0', async () => {
      const yamlContent = `
server:
  port: 8080
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.server.host).toBe('0.0.0.0');
    });

    it('should apply default storage driver memory', async () => {
      const yamlContent = `
server:
  port: 3592
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.storage.driver).toBe('memory');
    });

    it('should apply default log level info', async () => {
      const yamlContent = `
server:
  port: 3592
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.logging.level).toBe('info');
    });

    it('should apply default log format json', async () => {
      const yamlContent = `
server:
  port: 3592
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.logging.format).toBe('json');
    });

    it('should apply default TLS disabled', async () => {
      const yamlContent = `
server:
  port: 3592
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.tls.enabled).toBe(false);
    });

    it('should apply default metrics enabled with port 9090', async () => {
      const yamlContent = `
server:
  port: 3592
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.metrics.enabled).toBe(true);
      expect(config.metrics.port).toBe(9090);
    });

    it('should provide complete default config when file is empty', async () => {
      const yamlContent = ``;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config).toMatchObject({
        server: {
          port: 3592,
          host: '0.0.0.0',
        },
        tls: {
          enabled: false,
        },
        storage: {
          driver: 'memory',
        },
        logging: {
          level: 'info',
          format: 'json',
        },
        metrics: {
          enabled: true,
          port: 9090,
        },
      });
    });
  });

  // ===========================================================================
  // Hot-Reload Tests
  // ===========================================================================

  describe('hot-reload', () => {
    it('should reload config on SIGHUP', async () => {
      const initialYaml = `
server:
  port: 3592
  host: "localhost"
`;
      const updatedYaml = `
server:
  port: 8080
  host: "0.0.0.0"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock)
        .mockReturnValueOnce(initialYaml)
        .mockReturnValueOnce(updatedYaml);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      // Load initial config
      let config = await configManager.load();
      expect(config.server.port).toBe(3592);

      // Enable hot reload
      configManager.enableHotReload();

      // Simulate SIGHUP
      process.emit('SIGHUP' as any);

      // Wait for reload
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get updated config
      config = configManager.get();
      expect(config.server.port).toBe(8080);
      expect(config.server.host).toBe('0.0.0.0');
    });

    it('should validate new config before applying', async () => {
      const initialYaml = `
server:
  port: 3592
  host: "localhost"
`;
      const invalidYaml = `
server:
  port: "not-a-number"
  host: "localhost"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock)
        .mockReturnValueOnce(initialYaml)
        .mockReturnValueOnce(invalidYaml);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      // Load initial config
      await configManager.load();
      configManager.enableHotReload();

      // Track reload events
      const reloadEvents: string[] = [];
      configManager.onReload(() => reloadEvents.push('reloaded'));

      // Simulate SIGHUP with invalid config
      process.emit('SIGHUP' as any);

      // Wait for reload attempt
      await new Promise(resolve => setTimeout(resolve, 100));

      // Config should remain unchanged
      const config = configManager.get();
      expect(config.server.port).toBe(3592);
      expect(reloadEvents).not.toContain('reloaded');
    });

    it('should rollback on invalid new config', async () => {
      const initialYaml = `
server:
  port: 3592
  host: "localhost"
storage:
  driver: "memory"
`;
      const invalidYaml = `
server:
  port: 3592
storage:
  driver: "invalid-driver"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock)
        .mockReturnValueOnce(initialYaml)
        .mockReturnValueOnce(invalidYaml);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      // Load initial config
      await configManager.load();
      configManager.enableHotReload();

      // Simulate SIGHUP with invalid config
      process.emit('SIGHUP' as any);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should rollback to initial config
      const config = configManager.get();
      expect(config.storage.driver).toBe('memory');
    });

    it('should call reload handlers on successful reload', async () => {
      const initialYaml = `
server:
  port: 3592
`;
      const updatedYaml = `
server:
  port: 8080
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock)
        .mockReturnValueOnce(initialYaml)
        .mockReturnValueOnce(updatedYaml);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await configManager.load();
      configManager.enableHotReload();

      const reloadHandler = vi.fn();
      configManager.onReload(reloadHandler);

      // Trigger reload
      await configManager.reload();

      expect(reloadHandler).toHaveBeenCalledTimes(1);
    });

    it('should allow manual reload via reload() method', async () => {
      const initialYaml = `
server:
  port: 3592
`;
      const updatedYaml = `
server:
  port: 9000
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock)
        .mockReturnValueOnce(initialYaml)
        .mockReturnValueOnce(updatedYaml);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await configManager.load();

      const newConfig = await configManager.reload();

      expect(newConfig.server.port).toBe(9000);
      expect(configManager.get().server.port).toBe(9000);
    });

    it('should unsubscribe reload handler when returned function is called', async () => {
      const yamlContent = `
server:
  port: 3592
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await configManager.load();
      configManager.enableHotReload();

      const handler = vi.fn();
      const unsubscribe = configManager.onReload(handler);

      // Unsubscribe
      unsubscribe();

      // Trigger reload
      await configManager.reload();

      // Handler should not be called
      expect(handler).not.toHaveBeenCalled();
    });

    it('should disable hot reload when disableHotReload is called', async () => {
      const initialYaml = `
server:
  port: 3592
`;
      const updatedYaml = `
server:
  port: 8080
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock)
        .mockReturnValueOnce(initialYaml)
        .mockReturnValueOnce(updatedYaml);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await configManager.load();
      configManager.enableHotReload();
      configManager.disableHotReload();

      // Simulate SIGHUP
      process.emit('SIGHUP' as any);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Config should remain unchanged
      expect(configManager.get().server.port).toBe(3592);
    });
  });

  // ===========================================================================
  // CLI Override Tests
  // ===========================================================================

  describe('CLI overrides', () => {
    it('should override config with --port flag', async () => {
      const yamlContent = `
server:
  port: 3592
  host: "localhost"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
        cliArgs: {
          port: 9999,
        },
      });

      const config = await configManager.load();

      expect(config.server.port).toBe(9999);
      expect(config.server.host).toBe('localhost'); // Not overridden
    });

    it('should override config with --config flag', async () => {
      const defaultYaml = `
server:
  port: 3592
`;
      const customYaml = `
server:
  port: 7777
  host: "custom.host"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation((path: string) => {
        if (path === '/custom/config.yaml') {
          return customYaml;
        }
        return defaultYaml;
      });

      configManager = new ConfigManager({
        cliArgs: {
          config: '/custom/config.yaml',
        },
      });

      const config = await configManager.load();

      expect(config.server.port).toBe(7777);
      expect(config.server.host).toBe('custom.host');
    });

    it('should override config with --host flag', async () => {
      const yamlContent = `
server:
  port: 3592
  host: "localhost"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
        cliArgs: {
          host: '192.168.1.100',
        },
      });

      const config = await configManager.load();

      expect(config.server.host).toBe('192.168.1.100');
    });

    it('should override config with --log-level flag', async () => {
      const yamlContent = `
logging:
  level: "info"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
        cliArgs: {
          'log-level': 'debug',
        },
      });

      const config = await configManager.load();

      expect(config.logging.level).toBe('debug');
    });

    it('should override config with --storage-driver flag', async () => {
      const yamlContent = `
storage:
  driver: "memory"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
        cliArgs: {
          'storage-driver': 'redis',
        },
      });

      const config = await configManager.load();

      expect(config.storage.driver).toBe('redis');
    });

    it('should prioritize CLI args over env vars over file config', async () => {
      process.env.AUTHZ_PORT = '8000'; // env var

      const yamlContent = `
server:
  port: 3592
  host: "localhost"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
        cliArgs: {
          port: 9999, // CLI arg takes highest priority
        },
      });

      const config = await configManager.load();

      expect(config.server.port).toBe(9999); // CLI wins
    });

    it('should support boolean CLI flags', async () => {
      const yamlContent = `
tls:
  enabled: false
  cert: "/path/to/cert.pem"
  key: "/path/to/key.pem"
metrics:
  enabled: true
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
        cliArgs: {
          'tls-enabled': true,
          'metrics-enabled': false,
        },
      });

      const config = await configManager.load();

      expect(config.tls.enabled).toBe(true);
      expect(config.metrics.enabled).toBe(false);
    });

    it('should validate CLI argument values', async () => {
      const yamlContent = `
server:
  port: 3592
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
        cliArgs: {
          'storage-driver': 'invalid-driver',
        },
      });

      await expect(configManager.load()).rejects.toThrow(ConfigValidationError);
    });
  });

  // ===========================================================================
  // Edge Cases and Error Handling
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle concurrent reload requests', async () => {
      const yamlContent = `
server:
  port: 3592
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      await configManager.load();

      // Trigger multiple concurrent reloads
      const reloadPromises = [
        configManager.reload(),
        configManager.reload(),
        configManager.reload(),
      ];

      // All should complete without error
      await expect(Promise.all(reloadPromises)).resolves.toBeDefined();
    });

    it('should handle unicode characters in config values', async () => {
      const yamlContent = `
server:
  port: 3592
  host: "\u203C-unicode-\u2764"
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      expect(config.server.host).toContain('unicode');
    });

    it('should handle very large config files', async () => {
      // Generate a large YAML with many comments and sections
      let largeYaml = `
server:
  port: 3592
  host: "localhost"
`;
      for (let i = 0; i < 1000; i++) {
        largeYaml += `# Comment line ${i}\n`;
      }

      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(largeYaml);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const startTime = Date.now();
      const config = await configManager.load();
      const loadTime = Date.now() - startTime;

      expect(config.server.port).toBe(3592);
      expect(loadTime).toBeLessThan(1000); // Should load in under 1 second
    });

    it('should handle null and undefined values gracefully', async () => {
      const yamlContent = `
server:
  port: 3592
  host: null
tls:
  enabled: false
  cert: ~
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      // Should use defaults for null values
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.tls.cert).toBeUndefined();
    });

    it('should preserve config immutability', async () => {
      const yamlContent = `
server:
  port: 3592
`;
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(yamlContent);

      configManager = new ConfigManager({
        configPath: '/etc/authz/config.yaml',
      });

      const config = await configManager.load();

      // Attempting to modify should not affect stored config
      (config as any).server.port = 9999;

      const freshConfig = configManager.get();
      expect(freshConfig.server.port).toBe(3592);
    });
  });
});
