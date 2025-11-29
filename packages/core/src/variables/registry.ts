/**
 * @fileoverview ExportRegistry for managing exported variables and constants
 * Provides registration, retrieval, and duplicate detection
 */

import type { ExportVariables, ExportConstants } from './types';
import { DuplicateExportError } from './errors';

/**
 * Registry for exported variables and constants
 * Manages registration and retrieval of exports with duplicate detection
 */
export class ExportRegistry {
  private variables: Map<string, ExportVariables> = new Map();
  private constants: Map<string, ExportConstants> = new Map();

  /**
   * Register ExportVariables
   * @throws {DuplicateExportError} if export name already registered
   */
  registerVariables(exportVars: ExportVariables): void {
    if (this.has(exportVars.spec.name)) {
      throw new DuplicateExportError(exportVars.spec.name);
    }
    this.variables.set(exportVars.spec.name, exportVars);
  }

  /**
   * Register ExportConstants
   * @throws {DuplicateExportError} if export name already registered
   */
  registerConstants(exportConsts: ExportConstants): void {
    if (this.has(exportConsts.spec.name)) {
      throw new DuplicateExportError(exportConsts.spec.name);
    }
    this.constants.set(exportConsts.spec.name, exportConsts);
  }

  /**
   * Get export by name
   * @returns ExportVariables, ExportConstants, or undefined if not found
   */
  get(name: string): ExportVariables | ExportConstants | undefined {
    return this.variables.get(name) ?? this.constants.get(name);
  }

  /**
   * Check if export exists
   */
  has(name: string): boolean {
    return this.variables.has(name) || this.constants.has(name);
  }

  /**
   * Get all registered export names
   */
  getNames(): string[] {
    return [...this.variables.keys(), ...this.constants.keys()];
  }

  /**
   * Clear all registered exports
   */
  clear(): void {
    this.variables.clear();
    this.constants.clear();
  }
}
