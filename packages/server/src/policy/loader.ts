import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import chokidar from 'chokidar';
import { parse as parseYaml } from 'yaml';
import { DecisionEngine, PolicyParser, ValidatedResourcePolicy, ValidatedDerivedRolesPolicy } from '@authz-engine/core';
import { Logger } from '../utils/logger';

/**
 * Policy Loader
 *
 * Loads policies from the filesystem and optionally watches for changes.
 */
export class PolicyLoader {
  private engine: DecisionEngine;
  private parser: PolicyParser;
  private logger: Logger;
  private watcher?: chokidar.FSWatcher;
  private policyDir: string;

  constructor(engine: DecisionEngine, logger: Logger, policyDir: string) {
    this.engine = engine;
    this.parser = new PolicyParser();
    this.logger = logger;
    this.policyDir = policyDir;
  }

  /**
   * Load all policies from the configured directory
   */
  async loadAll(): Promise<{ resourcePolicies: number; derivedRoles: number }> {
    const resourcePolicies: ValidatedResourcePolicy[] = [];
    const derivedRolesPolicies: ValidatedDerivedRolesPolicy[] = [];

    // Find all YAML and JSON files
    const files = await glob('**/*.{yaml,yml,json}', {
      cwd: this.policyDir,
      absolute: true,
    });

    this.logger.info(`Found ${files.length} policy files in ${this.policyDir}`);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const parsed = file.endsWith('.json')
          ? JSON.parse(content)
          : parseYaml(content);

        if (!this.parser.isPolicy(parsed)) {
          this.logger.debug(`Skipping non-policy file: ${file}`);
          continue;
        }

        const policy = this.parser.parse(parsed);

        if (policy.kind === 'ResourcePolicy') {
          resourcePolicies.push(policy as ValidatedResourcePolicy);
          this.logger.debug(`Loaded resource policy: ${policy.metadata.name}`);
        } else if (policy.kind === 'DerivedRoles') {
          derivedRolesPolicies.push(policy as ValidatedDerivedRolesPolicy);
          this.logger.debug(`Loaded derived roles: ${policy.metadata.name}`);
        }
      } catch (error) {
        this.logger.error(`Failed to load policy from ${file}`, error);
      }
    }

    // Clear existing and load new
    this.engine.clearPolicies();
    this.engine.loadResourcePolicies(resourcePolicies);
    this.engine.loadDerivedRolesPolicies(derivedRolesPolicies);

    this.logger.info(`Loaded ${resourcePolicies.length} resource policies, ${derivedRolesPolicies.length} derived roles`);

    return {
      resourcePolicies: resourcePolicies.length,
      derivedRoles: derivedRolesPolicies.length,
    };
  }

  /**
   * Watch for policy changes and reload
   */
  watch(): void {
    if (this.watcher) {
      return; // Already watching
    }

    this.watcher = chokidar.watch(this.policyDir, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher
      .on('add', (filePath) => this.handleFileChange('add', filePath))
      .on('change', (filePath) => this.handleFileChange('change', filePath))
      .on('unlink', (filePath) => this.handleFileChange('unlink', filePath));

    this.logger.info(`Watching for policy changes in ${this.policyDir}`);
  }

  /**
   * Stop watching for changes
   */
  async stopWatch(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = undefined;
      this.logger.info('Stopped watching for policy changes');
    }
  }

  /**
   * Handle file change events
   */
  private async handleFileChange(event: string, filePath: string): Promise<void> {
    // Only process policy files
    if (!filePath.match(/\.(yaml|yml|json)$/)) {
      return;
    }

    this.logger.info(`Policy ${event}: ${path.basename(filePath)}`);

    // Reload all policies (simple but effective)
    // For production, could implement incremental updates
    try {
      await this.loadAll();
      this.logger.info('Policies reloaded successfully');
    } catch (error) {
      this.logger.error('Failed to reload policies', error);
    }
  }

  /**
   * Validate a policy file without loading
   */
  validateFile(filePath: string): { valid: boolean; errors?: string[] } {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = filePath.endsWith('.json')
        ? JSON.parse(content)
        : parseYaml(content);

      this.parser.parse(parsed);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }
}
