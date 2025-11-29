/**
 * Health Monitor
 *
 * Monitors the health of all platform subsystems and collects metrics.
 * Provides health status reporting and historical snapshots.
 */

import type {
  PlatformConfig,
  PlatformHealth,
  SubsystemHealth,
  PlatformMetrics,
} from '../orchestrator/types.js';

type SubsystemName = 'swarm' | 'neural' | 'consensus' | 'memory' | 'agents';
type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
type HealthCheckFn = () => Promise<{ status: HealthStatus; details?: Record<string, unknown> }>;

interface HealthSnapshot {
  timestamp: Date;
  status: HealthStatus;
  metrics: PlatformMetrics;
  subsystems: Record<SubsystemName, SubsystemHealth>;
}

/**
 * Health Monitor for the platform
 */
export class HealthMonitor {
  private config: PlatformConfig;
  private startTime: Date | null = null;
  private running = false;

  // Subsystem health states
  private subsystemStatus: Record<SubsystemName, SubsystemHealth>;

  // Metrics tracking
  private requestLatencies: number[] = [];
  private totalRequests = 0;
  private totalErrors = 0;
  private activeAgents = 0;
  private consensusRounds = 0;
  private neuralPredictions = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  // Historical snapshots
  private snapshots: HealthSnapshot[] = [];
  private maxSnapshots = 100;

  // Custom health checks
  private healthChecks: Map<string, HealthCheckFn> = new Map();

  // Request rate tracking
  private requestTimestamps: number[] = [];
  private rateWindowMs = 60000; // 1 minute window

  constructor(config: PlatformConfig) {
    this.config = config;

    // Initialize subsystem status
    this.subsystemStatus = {
      swarm: this.createInitialSubsystemHealth('swarm'),
      neural: this.createInitialSubsystemHealth('neural'),
      consensus: this.createInitialSubsystemHealth('consensus'),
      memory: this.createInitialSubsystemHealth('memory'),
      agents: this.createInitialSubsystemHealth('agents'),
    };
  }

  /**
   * Start the health monitor
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.startTime = new Date();
    this.running = true;

    // Start periodic health checks if configured
    if (this.config.metrics.enabled) {
      this.startPeriodicChecks();
    }
  }

  /**
   * Stop the health monitor
   */
  async stop(): Promise<void> {
    this.running = false;
  }

  /**
   * Get current health status
   */
  async getHealth(): Promise<PlatformHealth> {
    const now = new Date();

    // Update last check timestamps
    for (const subsystem of Object.values(this.subsystemStatus)) {
      subsystem.lastCheck = now;
    }

    const overallStatus = this.determineOverallHealth();
    // Map 'unknown' to 'unhealthy' for the platform health status
    const platformStatus: 'healthy' | 'degraded' | 'unhealthy' =
      overallStatus === 'unknown' ? 'unhealthy' : overallStatus;

    return {
      status: platformStatus,
      timestamp: now,
      uptime: this.getUptime(),
      subsystems: { ...this.subsystemStatus },
      metrics: this.getMetrics(),
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): PlatformMetrics {
    return {
      requestsProcessed: this.totalRequests,
      requestsPerSecond: this.calculateRequestsPerSecond(),
      avgLatencyMs: this.calculateAverageLatency(),
      p95LatencyMs: this.calculatePercentileLatency(0.95),
      p99LatencyMs: this.calculatePercentileLatency(0.99),
      errorRate: this.calculateErrorRate(),
      activeAgents: this.activeAgents,
      consensusRounds: this.consensusRounds,
      neuralPredictions: this.neuralPredictions,
      cacheHitRate: this.calculateCacheHitRate(),
    };
  }

  /**
   * Record a processed request
   */
  recordRequest(latencyMs: number): void {
    this.totalRequests++;
    this.requestLatencies.push(latencyMs);
    this.requestTimestamps.push(Date.now());

    // Limit stored latencies to prevent memory growth
    if (this.requestLatencies.length > 10000) {
      this.requestLatencies = this.requestLatencies.slice(-5000);
    }

    // Clean old timestamps
    this.cleanOldTimestamps();
  }

  /**
   * Record an error
   */
  recordError(): void {
    this.totalErrors++;
  }

  /**
   * Record a consensus round
   */
  recordConsensusRound(): void {
    this.consensusRounds++;
  }

  /**
   * Record a neural prediction
   */
  recordNeuralPrediction(): void {
    this.neuralPredictions++;
  }

  /**
   * Record a cache access
   */
  recordCacheAccess(hit: boolean): void {
    if (hit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
  }

  /**
   * Update active agent count
   */
  updateActiveAgents(count: number): void {
    this.activeAgents = count;
  }

  /**
   * Update subsystem status
   */
  updateSubsystemStatus(
    name: SubsystemName,
    status: HealthStatus,
    details?: Record<string, unknown>
  ): void {
    this.subsystemStatus[name] = {
      ...this.subsystemStatus[name],
      status,
      lastCheck: new Date(),
      details,
    };

    // Clear errors if healthy
    if (status === 'healthy') {
      this.subsystemStatus[name].errors = undefined;
    }
  }

  /**
   * Register a subsystem error
   */
  registerSubsystemError(name: SubsystemName, error: string): void {
    const subsystem = this.subsystemStatus[name];
    if (!subsystem.errors) {
      subsystem.errors = [];
    }
    subsystem.errors.push(error);

    // Update status based on error count
    if (subsystem.errors.length >= 3) {
      subsystem.status = 'unhealthy';
    } else if (subsystem.errors.length >= 1) {
      subsystem.status = 'degraded';
    }
  }

  /**
   * Register a custom health check
   */
  registerHealthCheck(name: string, check: HealthCheckFn): void {
    this.healthChecks.set(name, check);
  }

  /**
   * Unregister a health check
   */
  unregisterHealthCheck(name: string): void {
    this.healthChecks.delete(name);
  }

  /**
   * Run all registered health checks
   */
  async runHealthChecks(): Promise<void> {
    for (const [_name, check] of this.healthChecks) {
      try {
        const _result = await check();
        // Store result (could map to subsystems)
      } catch {
        // Health check failed - silently ignore
      }
    }
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.consensusRounds = 0;
    this.neuralPredictions = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.requestLatencies = [];
    this.requestTimestamps = [];
  }

  /**
   * Create a health snapshot
   */
  createSnapshot(): HealthSnapshot {
    const snapshot: HealthSnapshot = {
      timestamp: new Date(),
      status: this.determineOverallHealth(),
      metrics: this.getMetrics(),
      subsystems: { ...this.subsystemStatus },
    };

    this.snapshots.push(snapshot);

    // Limit snapshot history
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }

    return snapshot;
  }

  /**
   * Get historical snapshots
   */
  getSnapshots(options: { limit?: number; offset?: number } = {}): HealthSnapshot[] {
    const { limit = 10, offset = 0 } = options;
    return this.snapshots.slice(offset, offset + limit);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private createInitialSubsystemHealth(name: string): SubsystemHealth {
    return {
      name,
      status: 'unknown',
      lastCheck: new Date(),
    };
  }

  private getUptime(): number {
    if (!this.startTime) {
      return 0;
    }
    return Date.now() - this.startTime.getTime();
  }

  private determineOverallHealth(): HealthStatus {
    const statuses = Object.values(this.subsystemStatus).map(s => s.status);

    // Any unhealthy critical subsystem = unhealthy
    const criticalSubsystems: SubsystemName[] = ['swarm', 'agents'];
    for (const name of criticalSubsystems) {
      if (this.subsystemStatus[name].status === 'unhealthy') {
        return 'unhealthy';
      }
    }

    // Any unhealthy = degraded
    if (statuses.includes('unhealthy')) {
      return 'degraded';
    }

    // Any degraded = degraded
    if (statuses.includes('degraded')) {
      return 'degraded';
    }

    // High error rate = degraded or unhealthy
    const errorRate = this.calculateErrorRate();
    if (errorRate > 0.5) {
      return 'unhealthy';
    }
    if (errorRate > 0.1) {
      return 'degraded';
    }

    // All healthy
    if (statuses.every(s => s === 'healthy')) {
      return 'healthy';
    }

    return 'healthy';
  }

  private calculateAverageLatency(): number {
    if (this.requestLatencies.length === 0) {
      return 0;
    }
    const sum = this.requestLatencies.reduce((a, b) => a + b, 0);
    return sum / this.requestLatencies.length;
  }

  private calculatePercentileLatency(percentile: number): number {
    if (this.requestLatencies.length === 0) {
      return 0;
    }

    const sorted = [...this.requestLatencies].sort((a, b) => a - b);
    const index = Math.ceil(percentile * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private calculateErrorRate(): number {
    const total = this.totalRequests + this.totalErrors;
    if (total === 0) {
      return 0;
    }
    return this.totalErrors / total;
  }

  private calculateRequestsPerSecond(): number {
    this.cleanOldTimestamps();

    if (this.requestTimestamps.length === 0) {
      return 0;
    }

    const windowSeconds = this.rateWindowMs / 1000;
    return this.requestTimestamps.length / windowSeconds;
  }

  private calculateCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    if (total === 0) {
      return 0;
    }
    return this.cacheHits / total;
  }

  private cleanOldTimestamps(): void {
    const cutoff = Date.now() - this.rateWindowMs;
    this.requestTimestamps = this.requestTimestamps.filter(t => t >= cutoff);
  }

  private startPeriodicChecks(): void {
    // Would start interval-based health checks
    // For now, health is updated on-demand
  }
}
