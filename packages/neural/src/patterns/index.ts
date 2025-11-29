/**
 * Patterns module exports
 */

export { PatternRecognizer } from './PatternRecognizer.js';

export type {
  // Core pattern types
  PatternType,
  AnomalyCategory,
  Pattern,
  AccessPattern,
  TemporalPattern,
  BehavioralPattern,
  PrivilegeEscalationPattern,

  // Anomaly detection types
  AnomalyResult,
  AnomalyFactor,

  // Behavioral profile types
  BehaviorProfile,
  TimeDistribution,
  TimeWindow,
  ResourceFrequency,
  ActionFrequency,
  VelocityProfile,

  // Feature engineering types
  FeatureVector,
  NormalizationParams,
  FeatureExtractorConfig,
  FeatureExtractor,
  FeatureInput,

  // Decision record type
  DecisionRecord,

  // Configuration types
  PatternRecognizerConfig,
  PatternDetector,

  // Prediction types
  PredictionResult,
  RiskAssessment,
  RiskFactor,
} from './types.js';
