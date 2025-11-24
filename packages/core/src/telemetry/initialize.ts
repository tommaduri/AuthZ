/**
 * OpenTelemetry initialization helper
 *
 * Provides convenient setup functions for initializing OpenTelemetry
 * in the authorization engine.
 */

import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { initializeTracer } from './index.js';
import { createExporter, getTraceProviderConfigFromEnv } from './exporters.js';

/**
 * Initialize OpenTelemetry for the authorization engine
 * This should be called once at application startup
 *
 * @example
 * ```typescript
 * import { initializeTelemetry } from '@authz-engine/core';
 *
 * // Call this before any other code runs
 * initializeTelemetry();
 * ```
 */
export function initializeTelemetry(): void {
  // Get configuration from environment
  const config = getTraceProviderConfigFromEnv();

  // Create resource with service information
  const resource = Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment || 'development',
      ...config.attributes,
    }),
  );

  // Create trace provider
  const tracerProvider = new NodeTracerProvider({
    resource,
  });

  // Create and add span processor with exporter
  const exporter = createExporter(config.exporter);
  const processor = new BatchSpanProcessor(exporter, {
    maxQueueSize: config.exporter.maxQueueSize || 2048,
    maxExportBatchSize: config.exporter.maxExportBatchSize || 512,
    scheduledDelayMillis: config.exporter.batchTimeout || 5000,
  });

  tracerProvider.addSpanProcessor(processor);

  // Register as global trace provider
  tracerProvider.register();

  // Initialize our tracer
  initializeTracer(tracerProvider.getTracer(config.serviceName, config.serviceVersion));

  if (config.exporter.debug) {
    console.log(`[OpenTelemetry] Initialized with ${config.exporter.type} exporter`);
    console.log(`[OpenTelemetry] Service: ${config.serviceName} v${config.serviceVersion}`);
    console.log(`[OpenTelemetry] Environment: ${config.environment}`);
  }
}

/**
 * Configuration helper for common scenarios
 */
export const TelemetryConfig = {
  /**
   * Development setup (logs to console)
   */
  development: () => {
    process.env.OTEL_EXPORTER_TYPE = 'console';
    process.env.OTEL_DEBUG = 'true';
    initializeTelemetry();
  },

  /**
   * Staging setup (sends to OTLP collector)
   */
  staging: (collectorUrl: string = 'http://localhost:4318/v1/traces') => {
    process.env.OTEL_EXPORTER_TYPE = 'otlp-http';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = collectorUrl;
    initializeTelemetry();
  },

  /**
   * Production setup (sends to OTLP gRPC collector)
   */
  production: (collectorUrl: string = 'http://localhost:4317') => {
    process.env.OTEL_EXPORTER_TYPE = 'otlp-grpc';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = collectorUrl;
    initializeTelemetry();
  },

  /**
   * Jaeger setup
   */
  jaeger: (jaegerEndpoint: string = 'http://localhost:14268/api/traces') => {
    process.env.OTEL_EXPORTER_TYPE = 'jaeger';
    process.env.JAEGER_ENDPOINT = jaegerEndpoint;
    initializeTelemetry();
  },
};
