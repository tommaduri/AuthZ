/**
 * Tests for Agentic Decorators
 *
 * Tests the new agentic pipeline decorators:
 * - @AgenticCheck
 * - @RequireAnalysis
 * - @WithRecommendations
 * - @RateLimited
 * - @ThreatProtected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import {
  AgenticCheck,
  RequireAnalysis,
  WithRecommendations,
  RateLimited,
  ThreatProtected,
  AGENTIC_CHECK_KEY,
  REQUIRE_ANALYSIS_KEY,
  WITH_RECOMMENDATIONS_KEY,
  RATE_LIMITED_KEY,
  THREAT_PROTECTED_KEY,
  AUTHZ_METADATA_KEY,
} from '../src/decorators';

// Mock NestJS decorators
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  return {
    ...actual,
    SetMetadata: (key: string, value: any) => {
      return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
        if (propertyKey) {
          Reflect.defineMetadata(key, value, target, propertyKey);
        } else {
          Reflect.defineMetadata(key, value, target);
        }
        return descriptor || target;
      };
    },
    applyDecorators: (...decorators: any[]) => {
      return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
        for (const decorator of decorators) {
          if (typeof decorator === 'function') {
            decorator(target, propertyKey, descriptor);
          }
        }
        return descriptor || target;
      };
    },
    UseGuards: () => {
      return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
        return descriptor || target;
      };
    },
    createParamDecorator: (factory: Function) => {
      return (data?: any) => {
        return (target: any, propertyKey: string, parameterIndex: number) => {
          // Store the factory for testing
          const existingParams = Reflect.getMetadata('custom:params', target, propertyKey) || [];
          existingParams.push({ index: parameterIndex, factory, data });
          Reflect.defineMetadata('custom:params', existingParams, target, propertyKey);
        };
      };
    },
    ExecutionContext: class {},
  };
});

describe('Agentic Pipeline Decorators', () => {
  describe('@AgenticCheck', () => {
    it('should set agentic check metadata with defaults', () => {
      class TestController {
        @AgenticCheck({ resource: 'payment', action: 'create' })
        createPayment() {}
      }

      const metadata = Reflect.getMetadata(AGENTIC_CHECK_KEY, TestController.prototype, 'createPayment');

      expect(metadata).toBeDefined();
      expect(metadata.enabled).toBe(true);
      expect(metadata.resource).toBe('payment');
      expect(metadata.action).toBe('create');
      expect(metadata.includeAnalysis).toBe(true);
      expect(metadata.includeRecommendations).toBe(false);
      expect(metadata.enableThreatDetection).toBe(true);
      expect(metadata.enableRateLimiting).toBe(false);
      expect(metadata.priority).toBe('medium');
    });

    it('should set agentic check metadata with custom options', () => {
      class TestController {
        @AgenticCheck({
          resource: 'admin',
          action: 'delete',
          includeAnalysis: true,
          includeRecommendations: true,
          enableThreatDetection: true,
          enableRateLimiting: true,
          priority: 'critical',
          context: { department: 'finance' },
        })
        deleteAdmin() {}
      }

      const metadata = Reflect.getMetadata(AGENTIC_CHECK_KEY, TestController.prototype, 'deleteAdmin');

      expect(metadata.includeAnalysis).toBe(true);
      expect(metadata.includeRecommendations).toBe(true);
      expect(metadata.enableThreatDetection).toBe(true);
      expect(metadata.enableRateLimiting).toBe(true);
      expect(metadata.priority).toBe('critical');
      expect(metadata.context).toEqual({ department: 'finance' });
    });

    it('should also set authz metadata for standard guard', () => {
      class TestController {
        @AgenticCheck({ resource: 'document', action: 'read' })
        readDocument() {}
      }

      const authzMetadata = Reflect.getMetadata(AUTHZ_METADATA_KEY, TestController.prototype, 'readDocument');

      expect(authzMetadata).toBeDefined();
      expect(authzMetadata.resource).toBe('document');
      expect(authzMetadata.action).toBe('read');
    });
  });

  describe('@RequireAnalysis', () => {
    it('should set analysis metadata with defaults', () => {
      class TestController {
        @RequireAnalysis()
        analyzeData() {}
      }

      const metadata = Reflect.getMetadata(REQUIRE_ANALYSIS_KEY, TestController.prototype, 'analyzeData');

      expect(metadata).toBeDefined();
      expect(metadata.enabled).toBe(true);
      expect(metadata.minConfidence).toBe(0.7);
      expect(metadata.includePatterns).toBe(true);
      expect(metadata.includeHistory).toBe(true);
    });

    it('should set analysis metadata with custom options', () => {
      class TestController {
        @RequireAnalysis({
          minConfidence: 0.9,
          includePatterns: false,
          includeHistory: false,
          context: { type: 'financial' },
        })
        highConfidenceAction() {}
      }

      const metadata = Reflect.getMetadata(REQUIRE_ANALYSIS_KEY, TestController.prototype, 'highConfidenceAction');

      expect(metadata.minConfidence).toBe(0.9);
      expect(metadata.includePatterns).toBe(false);
      expect(metadata.includeHistory).toBe(false);
      expect(metadata.context).toEqual({ type: 'financial' });
    });
  });

  describe('@WithRecommendations', () => {
    it('should set recommendations metadata with defaults', () => {
      class TestController {
        @WithRecommendations()
        getRecommendations() {}
      }

      const metadata = Reflect.getMetadata(WITH_RECOMMENDATIONS_KEY, TestController.prototype, 'getRecommendations');

      expect(metadata).toBeDefined();
      expect(metadata.enabled).toBe(true);
      expect(metadata.includePolicySuggestions).toBe(false);
      expect(metadata.includePathToAllow).toBe(true);
      expect(metadata.maxRecommendations).toBe(5);
      expect(metadata.enableNaturalLanguage).toBe(true);
    });

    it('should set recommendations metadata with custom options', () => {
      class TestController {
        @WithRecommendations({
          includePolicySuggestions: true,
          includePathToAllow: false,
          maxRecommendations: 10,
          enableNaturalLanguage: false,
        })
        customRecommendations() {}
      }

      const metadata = Reflect.getMetadata(WITH_RECOMMENDATIONS_KEY, TestController.prototype, 'customRecommendations');

      expect(metadata.includePolicySuggestions).toBe(true);
      expect(metadata.includePathToAllow).toBe(false);
      expect(metadata.maxRecommendations).toBe(10);
      expect(metadata.enableNaturalLanguage).toBe(false);
    });
  });

  describe('@RateLimited', () => {
    it('should set rate limit metadata with required options', () => {
      class TestController {
        @RateLimited({ maxRequests: 100, windowSeconds: 60 })
        rateLimitedEndpoint() {}
      }

      const metadata = Reflect.getMetadata(RATE_LIMITED_KEY, TestController.prototype, 'rateLimitedEndpoint');

      expect(metadata).toBeDefined();
      expect(metadata.enabled).toBe(true);
      expect(metadata.maxRequests).toBe(100);
      expect(metadata.windowSeconds).toBe(60);
      expect(metadata.keyBy).toBe('principal');
      expect(metadata.onLimitExceeded).toBe('block');
      expect(metadata.skipForRoles).toEqual([]);
    });

    it('should set rate limit metadata with all options', () => {
      class TestController {
        @RateLimited({
          maxRequests: 1000,
          windowSeconds: 3600,
          keyBy: 'ip',
          onLimitExceeded: 'throttle',
          skipForRoles: ['admin', 'moderator'],
        })
        apiEndpoint() {}
      }

      const metadata = Reflect.getMetadata(RATE_LIMITED_KEY, TestController.prototype, 'apiEndpoint');

      expect(metadata.maxRequests).toBe(1000);
      expect(metadata.windowSeconds).toBe(3600);
      expect(metadata.keyBy).toBe('ip');
      expect(metadata.onLimitExceeded).toBe('throttle');
      expect(metadata.skipForRoles).toEqual(['admin', 'moderator']);
    });
  });

  describe('@ThreatProtected', () => {
    it('should set threat protection metadata with defaults', () => {
      class TestController {
        @ThreatProtected()
        secureEndpoint() {}
      }

      const metadata = Reflect.getMetadata(THREAT_PROTECTED_KEY, TestController.prototype, 'secureEndpoint');

      expect(metadata).toBeDefined();
      expect(metadata.enabled).toBe(true);
      expect(metadata.anomalyThreshold).toBe(0.8);
      expect(metadata.threatTypes).toEqual([
        'permission_escalation',
        'velocity_spike',
        'unusual_resource_access',
      ]);
      expect(metadata.onThreatDetected).toBe('block');
    });

    it('should set threat protection metadata with custom options', () => {
      class TestController {
        @ThreatProtected({
          anomalyThreshold: 0.6,
          threatTypes: ['unusual_access_time', 'geographic_anomaly'],
          onThreatDetected: 'require_mfa',
          requireVerificationAbove: 0.5,
        })
        highSecurityEndpoint() {}
      }

      const metadata = Reflect.getMetadata(THREAT_PROTECTED_KEY, TestController.prototype, 'highSecurityEndpoint');

      expect(metadata.anomalyThreshold).toBe(0.6);
      expect(metadata.threatTypes).toEqual(['unusual_access_time', 'geographic_anomaly']);
      expect(metadata.onThreatDetected).toBe('require_mfa');
      expect(metadata.requireVerificationAbove).toBe(0.5);
    });
  });

  describe('Combined Decorators', () => {
    it('should allow combining multiple agentic decorators', () => {
      class TestController {
        @ThreatProtected({ anomalyThreshold: 0.7 })
        @RateLimited({ maxRequests: 50, windowSeconds: 60 })
        @RequireAnalysis({ minConfidence: 0.8 })
        @WithRecommendations()
        combinedEndpoint() {}
      }

      const threatMetadata = Reflect.getMetadata(THREAT_PROTECTED_KEY, TestController.prototype, 'combinedEndpoint');
      const rateLimitMetadata = Reflect.getMetadata(RATE_LIMITED_KEY, TestController.prototype, 'combinedEndpoint');
      const analysisMetadata = Reflect.getMetadata(REQUIRE_ANALYSIS_KEY, TestController.prototype, 'combinedEndpoint');
      const recommendationsMetadata = Reflect.getMetadata(WITH_RECOMMENDATIONS_KEY, TestController.prototype, 'combinedEndpoint');

      expect(threatMetadata?.enabled).toBe(true);
      expect(rateLimitMetadata?.enabled).toBe(true);
      expect(analysisMetadata?.enabled).toBe(true);
      expect(recommendationsMetadata?.enabled).toBe(true);
    });
  });
});
