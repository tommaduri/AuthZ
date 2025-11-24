/**
 * Quota Management Types for AuthZ Engine
 *
 * Defines types for quota policies, usage tracking, and quota enforcement.
 */

// =============================================================================
// Quota Period Types
// =============================================================================

/**
 * Time periods for quota enforcement
 */
export enum QuotaPeriod {
  /** Hourly quota - resets every hour */
  HOURLY = 'hourly',
  /** Daily quota - resets at midnight UTC */
  DAILY = 'daily',
  /** Weekly quota - resets on Monday midnight UTC */
  WEEKLY = 'weekly',
  /** Monthly quota - resets on 1st of month midnight UTC */
  MONTHLY = 'monthly',
  /** Rolling period - based on sliding window */
  ROLLING = 'rolling',
}

/**
 * Quota enforcement behavior when limit is reached
 */
export type QuotaEnforcementMode = 'hard' | 'soft' | 'notify';

// =============================================================================
// Quota Policy Types
// =============================================================================

/**
 * Defines limits for a specific resource type
 */
export interface QuotaResourceLimit {
  /** Resource kind this limit applies to */
  resourceKind: string;
  /** Maximum allowed amount per period */
  limit: number;
  /** Cost per operation (default: 1) */
  costPerOperation?: number;
  /** Optional: specific actions this limit applies to */
  actions?: string[];
  /** Whether this limit is enforced (default: true) */
  enforced?: boolean;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A complete quota policy definition
 */
export interface QuotaPolicy {
  /** Unique policy identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the policy */
  description?: string;
  /** Time period for this quota */
  period: QuotaPeriod;
  /** For rolling period: window duration in milliseconds */
  rollingWindowMs?: number;
  /** Resource-specific limits */
  limits: QuotaResourceLimit[];
  /** Global limit across all resources (optional) */
  globalLimit?: number;
  /** Enforcement mode */
  enforcement: QuotaEnforcementMode;
  /** Priority (higher = evaluated first) */
  priority?: number;
  /** Labels for filtering */
  labels?: Record<string, string>;
  /** Optional: specific principals this policy applies to */
  principals?: string[];
  /** Optional: roles this policy applies to */
  roles?: string[];
  /** Whether this policy is active */
  enabled: boolean;
  /** Grace period percentage (allows temporary overage) */
  gracePeriodPercent?: number;
  /** Notification threshold percentage (0-100) */
  notifyThresholdPercent?: number;
}

/**
 * Simplified quota configuration for common use cases
 */
export interface SimpleQuotaConfig {
  /** Principal or principal pattern */
  principal?: string;
  /** Resource kind */
  resourceKind?: string;
  /** Limit amount */
  limit: number;
  /** Period */
  period: QuotaPeriod;
}

// =============================================================================
// Quota Usage Types
// =============================================================================

/**
 * Current usage for a specific quota
 */
export interface QuotaUsage {
  /** Policy ID this usage is tracked against */
  policyId: string;
  /** Principal ID */
  principalId: string;
  /** Resource kind (if resource-specific) */
  resourceKind?: string;
  /** Current usage amount */
  used: number;
  /** Maximum allowed */
  limit: number;
  /** Remaining quota */
  remaining: number;
  /** Usage as percentage (0-100) */
  percentUsed: number;
  /** When this period started */
  periodStart: number;
  /** When this period ends */
  periodEnd: number;
  /** Whether limit has been exceeded */
  exceeded: boolean;
  /** Whether currently in grace period */
  inGracePeriod: boolean;
  /** Timestamp of last update */
  lastUpdated: number;
}

/**
 * Aggregated quota status for a principal
 */
export interface QuotaStatus {
  /** Principal ID */
  principalId: string;
  /** All quota usages for this principal */
  quotas: QuotaUsage[];
  /** Overall status */
  status: 'ok' | 'warning' | 'exceeded';
  /** Warning messages if any */
  warnings: string[];
  /** Timestamp of status check */
  timestamp: number;
}

// =============================================================================
// Quota Check Types
// =============================================================================

/**
 * Context for quota checking
 */
export interface QuotaCheckContext {
  /** Principal ID */
  principalId: string;
  /** Principal roles (for role-based quotas) */
  roles?: string[];
  /** Resource kind being accessed */
  resourceKind: string;
  /** Resource ID (optional) */
  resourceId?: string;
  /** Action being performed */
  action?: string;
  /** Cost of this operation (default: 1) */
  cost?: number;
  /** Custom attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Result of a quota check
 */
export interface QuotaCheckResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Reason if denied */
  reason?: string;
  /** Policy that caused denial (if any) */
  denyingPolicy?: string;
  /** All quota usages evaluated */
  quotas: QuotaUsage[];
  /** Whether any quota is in warning state */
  hasWarnings: boolean;
  /** Warning messages */
  warnings: string[];
  /** Time until quota resets (ms) */
  resetInMs?: number;
}

/**
 * Result of consuming quota
 */
export interface QuotaConsumeResult {
  /** Whether consumption was successful */
  success: boolean;
  /** Amount consumed */
  consumed: number;
  /** New remaining amount */
  remaining: number;
  /** Updated usage record */
  usage: QuotaUsage;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// Quota Events
// =============================================================================

/**
 * Event when quota threshold is reached
 */
export interface QuotaThresholdEvent {
  type: 'warning' | 'exceeded' | 'grace';
  timestamp: number;
  principalId: string;
  policyId: string;
  resourceKind?: string;
  currentUsage: number;
  limit: number;
  percentUsed: number;
  periodEnd: number;
}

/**
 * Event when quota is reset
 */
export interface QuotaResetEvent {
  timestamp: number;
  principalId: string;
  policyId: string;
  previousUsage: number;
  newPeriodStart: number;
  newPeriodEnd: number;
}

/**
 * Event when quota is consumed
 */
export interface QuotaConsumeEvent {
  timestamp: number;
  principalId: string;
  policyId: string;
  resourceKind: string;
  action?: string;
  cost: number;
  previousUsage: number;
  newUsage: number;
  remaining: number;
}

// =============================================================================
// Quota Storage Types
// =============================================================================

/**
 * Stored quota usage record
 */
export interface StoredQuotaUsage {
  policyId: string;
  principalId: string;
  resourceKind?: string;
  used: number;
  periodStart: number;
  periodEnd: number;
  lastUpdated: number;
  history?: Array<{
    timestamp: number;
    amount: number;
    action?: string;
  }>;
}

/**
 * Quota storage interface
 */
export interface QuotaStorage {
  /** Get usage for a specific key */
  getUsage(key: string): Promise<StoredQuotaUsage | null>;
  /** Set usage for a key */
  setUsage(key: string, usage: StoredQuotaUsage): Promise<void>;
  /** Increment usage atomically */
  incrementUsage(key: string, amount: number): Promise<number>;
  /** Delete usage record */
  deleteUsage(key: string): Promise<void>;
  /** Get all usage for a principal */
  getUsageByPrincipal(principalId: string): Promise<StoredQuotaUsage[]>;
  /** Clear expired records */
  cleanup(): Promise<number>;
}

// =============================================================================
// Quota Manager Configuration
// =============================================================================

/**
 * Quota manager configuration
 */
export interface QuotaManagerConfig {
  /** Enable/disable quota enforcement globally */
  enabled: boolean;
  /** Policies to enforce */
  policies: QuotaPolicy[];
  /** Default period for policies without explicit period */
  defaultPeriod: QuotaPeriod;
  /** Default enforcement mode */
  defaultEnforcement: QuotaEnforcementMode;
  /** Storage configuration */
  storage?: {
    type: 'memory' | 'redis';
    redis?: {
      host: string;
      port: number;
      keyPrefix?: string;
    };
  };
  /** Global notification threshold (0-100) */
  globalNotifyThreshold?: number;
  /** Enable usage history tracking */
  trackHistory?: boolean;
  /** Maximum history entries per quota */
  maxHistoryEntries?: number;
}
