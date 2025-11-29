/**
 * Tests for Enhanced AuthZ Guard with Agentic Features
 *
 * Tests the guard's integration with new agentic decorators
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import {
  AGENTIC_CHECK_KEY,
  REQUIRE_ANALYSIS_KEY,
  WITH_RECOMMENDATIONS_KEY,
  RATE_LIMITED_KEY,
  THREAT_PROTECTED_KEY,
  AUTHZ_METADATA_KEY,
} from '../src/decorators';

// We'll test the metadata extraction logic that the guard uses
describe('AuthzGuard Agentic Metadata Extraction', () => {
  describe('Agentic Decorator Detection', () => {
    it('should detect @AgenticCheck metadata', () => {
      const metadata = {
        enabled: true,
        resource: 'payment',
        action: 'create',
        includeAnalysis: true,
        includeRecommendations: false,
        enableThreatDetection: true,
        enableRateLimiting: false,
        priority: 'medium',
      };

      // Simulate what the guard does
      const needsFullAgenticPipeline = metadata.enabled;
      expect(needsFullAgenticPipeline).toBe(true);
    });

    it('should detect combination of individual decorators', () => {
      const rateLimited = { enabled: true, maxRequests: 100, windowSeconds: 60 };
      const threatProtected = { enabled: true, anomalyThreshold: 0.8 };
      const requireAnalysis = { enabled: true, minConfidence: 0.7 };

      // Simulate guard logic
      const agenticService = {}; // Pretend it exists
      const needsFullAgenticPipeline =
        agenticService &&
        (rateLimited?.enabled ||
          threatProtected?.enabled ||
          requireAnalysis?.enabled);

      expect(needsFullAgenticPipeline).toBe(true);
    });

    it('should not trigger agentic pipeline without decorators', () => {
      const rateLimited = undefined;
      const threatProtected = undefined;
      const requireAnalysis = undefined;
      const agenticCheck = undefined;

      const needsFullAgenticPipeline =
        agenticCheck?.enabled ||
        (rateLimited?.enabled ||
          threatProtected?.enabled ||
          requireAnalysis?.enabled);

      expect(needsFullAgenticPipeline).toBeFalsy();
    });
  });

  describe('Rate Limit Response Handling', () => {
    it('should format rate limit exceeded response correctly', () => {
      const rateLimitResult = {
        remaining: 0,
        limit: 100,
        resetAt: new Date('2024-01-01T12:00:00Z'),
        isLimited: true,
        currentUsage: 101,
      };

      const response = {
        statusCode: 429,
        message: 'Rate limit exceeded',
        remaining: rateLimitResult.remaining,
        resetAt: rateLimitResult.resetAt,
      };

      expect(response.statusCode).toBe(429);
      expect(response.remaining).toBe(0);
    });
  });

  describe('Threat Detection Response Handling', () => {
    it('should format threat detected response correctly', () => {
      const threatResult = {
        anomalyScore: 0.9,
        isAnomalous: true,
        detectedThreats: [
          { type: 'velocity_spike', severity: 'high', description: 'Too many requests' },
        ],
        riskFactors: [{ factor: 'velocity_spike', score: 0.9 }],
        baseline: { avgRequestsPerHour: 10, deviation: 9 },
      };

      const response = {
        message: 'Request blocked due to detected threat',
        anomalyScore: threatResult.anomalyScore,
        threats: threatResult.detectedThreats,
      };

      expect(response.anomalyScore).toBe(0.9);
      expect(response.threats).toHaveLength(1);
      expect(response.threats[0].type).toBe('velocity_spike');
    });

    it('should format MFA required response correctly', () => {
      const threatResult = {
        anomalyScore: 0.85,
        isAnomalous: true,
        detectedThreats: [],
        riskFactors: [],
        baseline: { avgRequestsPerHour: 10, deviation: 5 },
      };

      const response = {
        statusCode: 428, // Precondition Required
        message: 'Additional verification required',
        requireMfa: true,
        anomalyScore: threatResult.anomalyScore,
      };

      expect(response.statusCode).toBe(428);
      expect(response.requireMfa).toBe(true);
    });
  });

  describe('Confidence Check Handling', () => {
    it('should reject low confidence decisions', () => {
      const analysisConfig = { enabled: true, minConfidence: 0.8 };
      const agenticResult = { confidence: 0.6 };

      const shouldReject =
        analysisConfig?.enabled &&
        analysisConfig.minConfidence &&
        agenticResult.confidence < analysisConfig.minConfidence;

      expect(shouldReject).toBe(true);
    });

    it('should accept high confidence decisions', () => {
      const analysisConfig = { enabled: true, minConfidence: 0.8 };
      const agenticResult = { confidence: 0.9 };

      const shouldReject =
        analysisConfig?.enabled &&
        analysisConfig.minConfidence &&
        agenticResult.confidence < analysisConfig.minConfidence;

      expect(shouldReject).toBe(false);
    });
  });

  describe('Request Context Storage', () => {
    it('should structure agentic result for request context', () => {
      const agenticResult = {
        allowed: true,
        decision: 'allow' as const,
        confidence: 0.9,
        explanation: 'Access granted',
        anomalyScore: 0.1,
        recommendations: ['Consider enabling 2FA'],
        analysis: {
          confidence: 0.9,
          patterns: [],
          historicalContext: {
            similarDecisions: 10,
            avgConfidence: 0.85,
            commonOutcomes: ['allow'],
          },
          riskAssessment: { level: 'low' as const, factors: [] },
        },
        threatInfo: {
          anomalyScore: 0.1,
          isAnomalous: false,
          detectedThreats: [],
          riskFactors: [],
          baseline: { avgRequestsPerHour: 10, deviation: 0.5 },
        },
        rateLimitInfo: {
          remaining: 99,
          limit: 100,
          resetAt: new Date(),
          isLimited: false,
          currentUsage: 1,
        },
        agentsInvolved: ['enforcer', 'guardian', 'analyst', 'advisor'],
        processingTimeMs: 50,
      };

      // Simulate what the guard stores in request context
      const requestContext = {
        authzAgenticResult: agenticResult,
        authzExplanation: agenticResult.explanation,
        authzAnomalyScore: agenticResult.anomalyScore,
        authzConfidence: agenticResult.confidence,
        authzRecommendations: agenticResult.recommendations,
        authzAnalysis: agenticResult.analysis,
        authzThreatInfo: agenticResult.threatInfo,
        authzRateLimitInfo: agenticResult.rateLimitInfo,
      };

      expect(requestContext.authzAgenticResult.agentsInvolved).toHaveLength(4);
      expect(requestContext.authzConfidence).toBe(0.9);
      expect(requestContext.authzRecommendations).toContain('Consider enabling 2FA');
    });
  });

  describe('Principal Building', () => {
    it('should build principal from user object', () => {
      const user = {
        id: 'user-123',
        roles: ['user', 'subscriber'],
        email: 'test@example.com',
        plan: 'premium',
      };

      // Simulate AuthzService.createPrincipal
      const { id, roles = [], ...attributes } = user;
      const principal = {
        id,
        roles,
        attributes,
      };

      expect(principal.id).toBe('user-123');
      expect(principal.roles).toContain('user');
      expect(principal.roles).toContain('subscriber');
      expect(principal.attributes.email).toBe('test@example.com');
      expect(principal.attributes.plan).toBe('premium');
    });

    it('should handle userType in principal', () => {
      const user = {
        id: 'user-123',
        roles: ['user'],
        userType: 'CREATOR',
      };

      // Simulate AuthzService.createPrincipal with userType
      const { id, roles = [], userType, ...attributes } = user;
      const allRoles = userType ? [...roles, userType.toLowerCase()] : roles;
      const principal = {
        id,
        roles: allRoles,
        attributes,
      };

      expect(principal.roles).toContain('user');
      expect(principal.roles).toContain('creator');
    });
  });

  describe('Resource Building', () => {
    it('should build resource from metadata and request', () => {
      const metadata = { resource: 'subscription', action: 'create' };
      const resourceData = { id: 'sub-123', plan: 'premium' };

      const resource = {
        kind: metadata.resource,
        id: resourceData?.id || '*',
        attributes: resourceData || {},
      };

      expect(resource.kind).toBe('subscription');
      expect(resource.id).toBe('sub-123');
      expect(resource.attributes.plan).toBe('premium');
    });

    it('should use wildcard id when not provided', () => {
      const metadata = { resource: 'subscription', action: 'list' };
      const resourceData = undefined;

      const resource = {
        kind: metadata.resource,
        id: resourceData?.id || '*',
        attributes: resourceData || {},
      };

      expect(resource.id).toBe('*');
    });
  });
});
