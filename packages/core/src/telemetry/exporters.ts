/**
 * OpenTelemetry Exporter Configuration
 *
 * Provides factory functions and configuration for different telemetry exporters.
 * Supports OTLP (gRPC and HTTP), Jaeger, and Console exporters.
 */

import type { SpanExporter } from '@opentelemetry/sdk-trace-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';

/**
 * Exporter configuration options
 */
export interface ExporterConfig {
  type: 'otlp-http' | 'otlp-grpc' | 'jaeger' | 'console';
  enabled?: boolean;
  batchSize?: number;
  batchTimeout?: number;
  maxQueueSize?: number;
  maxExportBatchSize?: number;
  otlpHttpEndpoint?: string;
  otlpGrpcEndpoint?: string;
  jaegerEndpoint?: string;
  jaegerPort?: number;
  jaegerServiceName?: string;
  debug?: boolean;
}

/**
 * Create an OTLP HTTP exporter
 */
export function createOtlpHttpExporter(config: ExporterConfig): SpanExporter {
  try {
    // Dynamic import to avoid hard dependency
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-http');

    return new OTLPTraceExporter({
      url: config.otlpHttpEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      headers: {
        'User-Agent': 'authz-engine/0.1.0',
      },
      concurrencyLimit: 10,
      timeoutMillis: 30000,
    });
  } catch (error) {
    console.warn('OTLP HTTP exporter not available:', error);
    return new ConsoleSpanExporter();
  }
}

/**
 * Create an OTLP gRPC exporter
 */
export function createOtlpGrpcExporter(config: ExporterConfig): SpanExporter {
  try {
    // Dynamic import to avoid hard dependency
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-grpc');

    return new OTLPTraceExporter({
      url: config.otlpGrpcEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
      metadata: {
        'user-agent': 'authz-engine/0.1.0',
      },
      timeoutMillis: 30000,
    });
  } catch (error) {
    console.warn('OTLP gRPC exporter not available:', error);
    return new ConsoleSpanExporter();
  }
}

/**
 * Create a Jaeger exporter
 */
export function createJaegerExporter(config: ExporterConfig): SpanExporter {
  try {
    // Dynamic import to avoid hard dependency
    const { JaegerExporter } = require('@opentelemetry/exporter-jaeger-http');

    return new JaegerExporter({
      endpoint: config.jaegerEndpoint || process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
      serviceName: config.jaegerServiceName || process.env.OTEL_SERVICE_NAME || 'authz-engine',
      maxPacketSize: 65000,
    });
  } catch (error) {
    console.warn('Jaeger exporter not available:', error);
    return new ConsoleSpanExporter();
  }
}

/**
 * Create a Console exporter (for development/debugging)
 */
export function createConsoleExporter(_config: ExporterConfig): SpanExporter {
  return new ConsoleSpanExporter();
}

/**
 * Factory function to create the appropriate exporter based on configuration
 */
export function createExporter(config: ExporterConfig): SpanExporter {
  if (config.enabled === false) {
    return new ConsoleSpanExporter();
  }

  switch (config.type) {
    case 'otlp-http':
      return createOtlpHttpExporter(config);
    case 'otlp-grpc':
      return createOtlpGrpcExporter(config);
    case 'jaeger':
      return createJaegerExporter(config);
    case 'console':
    default:
      return createConsoleExporter(config);
  }
}

/**
 * Get exporter configuration from environment variables
 */
export function getExporterConfigFromEnv(): ExporterConfig {
  const type = (process.env.OTEL_EXPORTER_TYPE || 'console') as ExporterConfig['type'];
  const enabled = process.env.OTEL_ENABLED !== 'false';
  const debug = process.env.OTEL_DEBUG === 'true';

  return {
    type,
    enabled,
    debug,
    batchSize: parseInt(process.env.OTEL_BATCH_SIZE || '512', 10),
    batchTimeout: parseInt(process.env.OTEL_BATCH_TIMEOUT || '5000', 10),
    maxQueueSize: parseInt(process.env.OTEL_MAX_QUEUE_SIZE || '2048', 10),
    otlpHttpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otlpGrpcEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    jaegerEndpoint: process.env.JAEGER_ENDPOINT,
    jaegerPort: parseInt(process.env.JAEGER_PORT || '14268', 10),
    jaegerServiceName: process.env.OTEL_SERVICE_NAME,
  };
}

/**
 * Trace provider configuration with best practices
 */
export interface TraceProviderConfig {
  serviceName: string;
  serviceVersion: string;
  environment?: string;
  exporter: ExporterConfig;
  sampleRate?: number;
  attributes?: Record<string, string>;
}

/**
 * Get trace provider configuration from environment
 */
export function getTraceProviderConfigFromEnv(): TraceProviderConfig {
  return {
    serviceName: process.env.OTEL_SERVICE_NAME || 'authz-engine',
    serviceVersion: process.env.OTEL_SERVICE_VERSION || '0.1.0',
    environment: process.env.ENVIRONMENT || process.env.NODE_ENV || 'development',
    exporter: getExporterConfigFromEnv(),
    sampleRate: parseFloat(process.env.OTEL_SAMPLE_RATE || '1.0'),
    attributes: {
      'service.name': process.env.OTEL_SERVICE_NAME || 'authz-engine',
      'service.version': process.env.OTEL_SERVICE_VERSION || '0.1.0',
      'deployment.environment': process.env.ENVIRONMENT || process.env.NODE_ENV || 'development',
      'telemetry.sdk.language': 'node',
      'telemetry.sdk.name': 'opentelemetry',
    },
  };
}

/**
 * Recommended exporter configurations for different environments
 */
export const RECOMMENDED_EXPORTERS = {
  development: {
    type: 'console' as const,
    debug: true,
  },
  staging: {
    type: 'otlp-http' as const,
    otlpHttpEndpoint: 'http://otel-collector:4318/v1/traces',
  },
  production: {
    type: 'otlp-grpc' as const,
    otlpGrpcEndpoint: 'http://otel-collector:4317',
  },
};
