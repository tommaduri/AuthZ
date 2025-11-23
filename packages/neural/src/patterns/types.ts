/**
 * Pattern Types for Neural Engine
 *
 * Defines interfaces for pattern recognition, anomaly detection,
 * and behavioral analysis in authorization contexts.
 */

// =============================================================================
// Core Pattern Types
// =============================================================================

export type PatternType = 'anomaly' | 'temporal' | 'behavioral' | 'access' | 'privilege_escalation';

export type AnomalyCategory =
  | 'unusual_access'
  | 'time_violation'
  | 'behavioral_deviation'
  | 'privilege_escalation'
  | 'rate_anomaly'
  | 'geographic_anomaly'
  | 'resource_anomaly';

export interface Pattern {
  /** Unique pattern identifier */
  id: string;
  /** Type of pattern detected */
  type: PatternType;
  /** Confidence score (0-1) */
  confidence: number;
  /** Feature vector used for detection */
  features: number[];
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /** Timestamp of pattern detection */
  detectedAt: Date;
}

export interface AccessPattern extends Pattern {
  type: 'access';
  /** Resource kinds accessed */
  resourceKinds: string[];
  /** Actions performed */
  actions: string[];
  /** Principal information */
  principalId: string;
  /** Frequency of access */
  frequency: number;
}

export interface TemporalPattern extends Pattern {
  type: 'temporal';
  /** Time of access */
  accessTime: Date;
  /** Expected time window */
  expectedWindow: TimeWindow;
  /** Deviation from expected (in hours) */
  deviation: number;
  /** Day of week (0-6) */
  dayOfWeek: number;
}

export interface BehavioralPattern extends Pattern {
  type: 'behavioral';
  /** Baseline behavior profile */
  baseline: BehaviorProfile;
  /** Current observed behavior */
  observed: BehaviorProfile;
  /** Deviation score (0-1) */
  deviationScore: number;
}

export interface PrivilegeEscalationPattern extends Pattern {
  type: 'privilege_escalation';
  /** Original roles */
  originalRoles: string[];
  /** Attempted roles */
  attemptedRoles: string[];
  /** Sensitive resources accessed */
  sensitiveResources: string[];
  /** Risk score (0-1) */
  riskScore: number;
}

// =============================================================================
// Anomaly Detection Types
// =============================================================================

export interface AnomalyResult {
  /** Anomaly score (0-1, higher = more anomalous) */
  score: number;
  /** Whether this is considered anomalous */
  isAnomaly: boolean;
  /** Confidence in the detection */
  confidence: number;
  /** Category of anomaly */
  category: AnomalyCategory;
  /** Contributing factors */
  factors: AnomalyFactor[];
  /** Recommended actions */
  recommendations: string[];
}

export interface AnomalyFactor {
  /** Name of the factor */
  name: string;
  /** Contribution to anomaly score (0-1) */
  contribution: number;
  /** Description of why this is anomalous */
  description: string;
  /** Expected value */
  expected: unknown;
  /** Observed value */
  observed: unknown;
}

// =============================================================================
// Behavioral Profile Types
// =============================================================================

export interface BehaviorProfile {
  /** Principal identifier */
  principalId: string;
  /** Typical access times */
  accessTimes: TimeDistribution;
  /** Frequently accessed resources */
  frequentResources: ResourceFrequency[];
  /** Typical actions performed */
  typicalActions: ActionFrequency[];
  /** Access velocity (requests per hour) */
  accessVelocity: VelocityProfile;
  /** Last updated timestamp */
  lastUpdated: Date;
  /** Number of observations */
  observationCount: number;
}

export interface TimeDistribution {
  /** Hour distribution (0-23) */
  hourlyDistribution: number[];
  /** Day of week distribution (0-6) */
  dailyDistribution: number[];
  /** Peak hours */
  peakHours: number[];
  /** Off-peak hours */
  offPeakHours: number[];
}

export interface TimeWindow {
  /** Start hour (0-23) */
  startHour: number;
  /** End hour (0-23) */
  endHour: number;
  /** Days of week (0-6) */
  daysOfWeek: number[];
}

export interface ResourceFrequency {
  /** Resource kind */
  resourceKind: string;
  /** Access count */
  count: number;
  /** Percentage of total accesses */
  percentage: number;
}

export interface ActionFrequency {
  /** Action name */
  action: string;
  /** Count */
  count: number;
  /** Percentage */
  percentage: number;
}

export interface VelocityProfile {
  /** Average requests per hour */
  averagePerHour: number;
  /** Maximum observed */
  maxPerHour: number;
  /** Standard deviation */
  stdDev: number;
  /** 95th percentile */
  p95: number;
}

// =============================================================================
// Feature Engineering Types
// =============================================================================

export interface FeatureVector {
  /** Feature values */
  values: number[];
  /** Feature names for interpretability */
  names: string[];
  /** Normalization parameters */
  normalization?: NormalizationParams;
}

export interface NormalizationParams {
  /** Mean values for each feature */
  means: number[];
  /** Standard deviations for each feature */
  stdDevs: number[];
  /** Min values for min-max scaling */
  mins?: number[];
  /** Max values for min-max scaling */
  maxs?: number[];
}

export interface FeatureExtractorConfig {
  /** Include temporal features */
  includeTemporal: boolean;
  /** Include behavioral features */
  includeBehavioral: boolean;
  /** Include resource features */
  includeResource: boolean;
  /** Include velocity features */
  includeVelocity: boolean;
  /** Custom feature extractors */
  customExtractors?: FeatureExtractor[];
}

export interface FeatureExtractor {
  /** Name of the extractor */
  name: string;
  /** Extraction function */
  extract: (input: FeatureInput) => number[];
}

export interface FeatureInput {
  /** Principal making the request */
  principal: {
    id: string;
    roles: string[];
    attributes: Record<string, unknown>;
  };
  /** Resource being accessed */
  resource: {
    kind: string;
    id: string;
    attributes: Record<string, unknown>;
  };
  /** Actions requested */
  actions: string[];
  /** Request timestamp */
  timestamp: Date;
  /** Historical context */
  history?: DecisionRecord[];
}

// =============================================================================
// Decision Record (for training)
// =============================================================================

export interface DecisionRecord {
  /** Request ID */
  requestId: string;
  /** Principal */
  principal: {
    id: string;
    roles: string[];
    attributes: Record<string, unknown>;
  };
  /** Resource */
  resource: {
    kind: string;
    id: string;
    attributes: Record<string, unknown>;
  };
  /** Actions */
  actions: string[];
  /** Results */
  results: Record<string, { effect: 'allow' | 'deny'; policy: string }>;
  /** Timestamp */
  timestamp: Date;
  /** Was this flagged as anomalous */
  flaggedAnomaly?: boolean;
  /** Risk score if computed */
  riskScore?: number;
}

// =============================================================================
// Pattern Recognizer Configuration
// =============================================================================

export interface PatternRecognizerConfig {
  /** Anomaly detection threshold (0-1) */
  anomalyThreshold: number;
  /** Minimum observations before detection */
  minObservations: number;
  /** Time window for temporal analysis (hours) */
  temporalWindowHours: number;
  /** Enable behavioral profiling */
  enableBehavioralProfiling: boolean;
  /** Enable privilege escalation detection */
  enablePrivilegeEscalation: boolean;
  /** Custom pattern detectors */
  customDetectors?: PatternDetector[];
}

export interface PatternDetector {
  /** Detector name */
  name: string;
  /** Pattern type it detects */
  patternType: PatternType;
  /** Detection function */
  detect: (input: FeatureInput, profile?: BehaviorProfile) => Promise<Pattern | null>;
}

// =============================================================================
// Prediction Types
// =============================================================================

export interface PredictionResult {
  /** Detected pattern */
  pattern: Pattern;
  /** Prediction confidence (0-1) */
  confidence: number;
  /** Anomaly score (0-1) */
  anomalyScore: number;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Recommended actions */
  recommendations: string[];
  /** Model used for prediction */
  modelId: string;
  /** Inference latency in ms */
  latencyMs: number;
}

export interface RiskAssessment {
  /** Overall risk score (0-1) */
  overallRisk: number;
  /** Risk level classification */
  level: 'low' | 'medium' | 'high' | 'critical';
  /** Individual risk factors */
  factors: RiskFactor[];
  /** Should require additional verification */
  requiresVerification: boolean;
  /** Should be blocked */
  shouldBlock: boolean;
}

export interface RiskFactor {
  /** Factor name */
  name: string;
  /** Risk contribution (0-1) */
  contribution: number;
  /** Description */
  description: string;
}
