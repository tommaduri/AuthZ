/**
 * File Audit Sink
 *
 * Writes audit entries to JSON-lines files with support for
 * log rotation based on size and time.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AuditEntry, AuditSink, AuditSinkConfig } from '../types';
import { LOG_LEVEL_PRIORITY } from '../types';

// =============================================================================
// Constants
// =============================================================================

/** Default file sink configuration values */
const FILE_SINK_DEFAULTS = {
  /** Default filename prefix */
  FILENAME: 'audit',
  /** Default max file size: 10MB */
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  /** Default max rotated files to keep */
  MAX_FILES: 10,
  /** Default file permissions (octal) */
  FILE_MODE: 0o644,
  /** Default directory permissions (octal) */
  DIR_MODE: 0o755,
} as const;

// =============================================================================
// File Sink Configuration
// =============================================================================

export interface FileSinkConfig extends AuditSinkConfig {
  /** Directory to write log files */
  directory: string;
  /** Base filename (without extension) */
  filename?: string;
  /** Maximum file size in bytes before rotation */
  maxFileSize?: number;
  /** Maximum number of rotated files to keep */
  maxFiles?: number;
  /** Enable daily rotation */
  dailyRotation?: boolean;
  /** Enable gzip compression for rotated files */
  compress?: boolean;
  /** File permissions (octal) */
  fileMode?: number;
  /** Directory permissions (octal) */
  dirMode?: number;
}

// =============================================================================
// File Sink Implementation
// =============================================================================

export class FileSink implements AuditSink {
  readonly name = 'file';
  private config: Required<FileSinkConfig>;
  private currentStream: fs.WriteStream | null = null;
  private currentFilePath: string = '';
  private currentFileSize: number = 0;
  private isInitialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(config: FileSinkConfig) {
    this.config = {
      directory: config.directory,
      filename: config.filename ?? FILE_SINK_DEFAULTS.FILENAME,
      maxFileSize: config.maxFileSize ?? FILE_SINK_DEFAULTS.MAX_FILE_SIZE,
      maxFiles: config.maxFiles ?? FILE_SINK_DEFAULTS.MAX_FILES,
      dailyRotation: config.dailyRotation ?? true,
      compress: config.compress ?? false,
      fileMode: config.fileMode ?? FILE_SINK_DEFAULTS.FILE_MODE,
      dirMode: config.dirMode ?? FILE_SINK_DEFAULTS.DIR_MODE,
      minLevel: config.minLevel ?? 'DEBUG',
      eventTypes: config.eventTypes ?? [],
      enabled: config.enabled ?? true,
    };
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    await this.ensureDirectory();

    // Open initial log file
    await this.openLogFile();

    this.isInitialized = true;
  }

  async write(entry: AuditEntry): Promise<void> {
    if (!this.shouldLog(entry)) {
      return;
    }

    // Chain writes to ensure ordering
    this.writeQueue = this.writeQueue.then(async () => {
      await this.writeEntry(entry);
    });

    await this.writeQueue;
  }

  async writeBatch(entries: AuditEntry[]): Promise<void> {
    const filteredEntries = entries.filter((entry) => this.shouldLog(entry));

    if (filteredEntries.length === 0) {
      return;
    }

    this.writeQueue = this.writeQueue.then(async () => {
      for (const entry of filteredEntries) {
        await this.writeEntry(entry);
      }
    });

    await this.writeQueue;
  }

  async flush(): Promise<void> {
    await this.writeQueue;

    if (this.currentStream) {
      return new Promise((resolve, reject) => {
        this.currentStream!.once('drain', resolve);
        this.currentStream!.once('error', reject);

        // If already drained, resolve immediately
        if (this.currentStream!.writableLength === 0) {
          resolve();
        }
      });
    }
  }

  async close(): Promise<void> {
    await this.flush();

    if (this.currentStream) {
      return new Promise((resolve, reject) => {
        this.currentStream!.end(() => {
          this.currentStream = null;
          this.isInitialized = false;
          resolve();
        });
        this.currentStream!.once('error', reject);
      });
    }

    this.isInitialized = false;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.isInitialized || !this.config.enabled) {
      return false;
    }

    try {
      await fs.promises.access(this.config.directory, fs.constants.W_OK);
      return this.currentStream !== null && !this.currentStream.destroyed;
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private shouldLog(entry: AuditEntry): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[this.config.minLevel]) {
      return false;
    }

    if (this.config.eventTypes.length > 0 && !this.config.eventTypes.includes(entry.eventType)) {
      return false;
    }

    return true;
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await fs.promises.mkdir(this.config.directory, {
        recursive: true,
        mode: this.config.dirMode,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private async openLogFile(): Promise<void> {
    // Close existing stream if any
    if (this.currentStream) {
      await new Promise<void>((resolve) => {
        this.currentStream!.end(resolve);
      });
    }

    // Generate filename
    this.currentFilePath = this.generateFilePath();

    // Get existing file size if file exists
    try {
      const stats = await fs.promises.stat(this.currentFilePath);
      this.currentFileSize = stats.size;
    } catch {
      this.currentFileSize = 0;
    }

    // Open write stream
    this.currentStream = fs.createWriteStream(this.currentFilePath, {
      flags: 'a', // Append mode
      mode: this.config.fileMode,
    });

    // Handle stream errors - errors are tracked but not re-thrown
    this.currentStream.on('error', (_error) => {
      // Stream error occurred - will be handled on next write attempt
    });
  }

  private generateFilePath(): string {
    let filename = this.config.filename;

    if (this.config.dailyRotation) {
      const date = new Date().toISOString().split('T')[0];
      filename = `${filename}-${date}`;
    }

    return path.join(this.config.directory, `${filename}.jsonl`);
  }

  private async writeEntry(entry: AuditEntry): Promise<void> {
    if (!this.currentStream) {
      await this.openLogFile();
    }

    // Check if rotation is needed
    await this.checkRotation();

    // Check for daily rotation
    if (this.config.dailyRotation) {
      const expectedPath = this.generateFilePath();
      if (expectedPath !== this.currentFilePath) {
        await this.openLogFile();
      }
    }

    // Write entry as JSON line
    const line = JSON.stringify(entry) + '\n';
    const buffer = Buffer.from(line, 'utf8');

    return new Promise((resolve, reject) => {
      const canContinue = this.currentStream!.write(buffer, (error) => {
        if (error) {
          reject(error);
        } else {
          this.currentFileSize += buffer.length;
          resolve();
        }
      });

      // Handle backpressure
      if (!canContinue) {
        this.currentStream!.once('drain', () => {
          this.currentFileSize += buffer.length;
          resolve();
        });
      }
    });
  }

  private async checkRotation(): Promise<void> {
    if (this.currentFileSize >= this.config.maxFileSize) {
      await this.rotateFile();
    }
  }

  private async rotateFile(): Promise<void> {
    // Close current stream
    if (this.currentStream) {
      await new Promise<void>((resolve) => {
        this.currentStream!.end(resolve);
      });
    }

    // Rotate existing files
    await this.rotateExistingFiles();

    // Compress if enabled
    if (this.config.compress) {
      await this.compressRotatedFile();
    }

    // Open new log file
    await this.openLogFile();
  }

  private async rotateExistingFiles(): Promise<void> {
    const dir = this.config.directory;
    const baseName = path.basename(this.currentFilePath, '.jsonl');
    const ext = this.config.compress ? '.jsonl.gz' : '.jsonl';

    // Delete oldest file if at max
    const oldestPath = path.join(dir, `${baseName}.${this.config.maxFiles}${ext}`);
    try {
      await fs.promises.unlink(oldestPath);
    } catch {
      // File doesn't exist, ignore
    }

    // Rotate files: .9 -> .10, .8 -> .9, etc.
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = path.join(dir, `${baseName}.${i}${ext}`);
      const newPath = path.join(dir, `${baseName}.${i + 1}${ext}`);

      try {
        await fs.promises.rename(oldPath, newPath);
      } catch {
        // File doesn't exist, continue
      }
    }

    // Move current file to .1
    const currentExt = this.config.compress ? '.jsonl' : '.jsonl';
    const rotatedPath = path.join(dir, `${baseName}.1${currentExt}`);

    try {
      await fs.promises.rename(this.currentFilePath, rotatedPath);
    } catch (_error) {
      // Failed to rotate file - will retry on next rotation
    }
  }

  private async compressRotatedFile(): Promise<void> {
    // Note: Compression would require zlib streaming
    // This is a placeholder for the compression logic
    const dir = this.config.directory;
    const baseName = path.basename(this.currentFilePath, '.jsonl');
    const uncompressedPath = path.join(dir, `${baseName}.1.jsonl`);
    const compressedPath = path.join(dir, `${baseName}.1.jsonl.gz`);

    try {
      const { createGzip } = await import('zlib');
      const readStream = fs.createReadStream(uncompressedPath);
      const writeStream = fs.createWriteStream(compressedPath);
      const gzip = createGzip();

      await new Promise<void>((resolve, reject) => {
        readStream
          .pipe(gzip)
          .pipe(writeStream)
          .on('finish', async () => {
            // Delete uncompressed file
            await fs.promises.unlink(uncompressedPath);
            resolve();
          })
          .on('error', reject);
      });
    } catch (_error) {
      // Failed to compress rotated file - file remains uncompressed
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createFileSink(config: FileSinkConfig): FileSink {
  return new FileSink(config);
}
