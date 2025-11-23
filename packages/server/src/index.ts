import { DecisionEngine } from '@authz-engine/core';
import { GrpcServer } from './grpc/server';
import { RestServer } from './rest/server';
import { PolicyLoader } from './policy/loader';
import { Logger } from './utils/logger';
import {
  AgentOrchestrator,
  type OrchestratorConfig,
} from '@authz-engine/agents';

/**
 * AuthZ Engine Server
 *
 * Main entry point that starts both gRPC and REST servers.
 * Integrates the AgentOrchestrator for agentic authorization features.
 */
async function main(): Promise<void> {
  const logger = new Logger('authz-engine', 'info');

  logger.info('Starting AuthZ Engine Server');

  // Configuration from environment
  const config = {
    policyDir: process.env.POLICY_DIR || './policies',
    restPort: parseInt(process.env.REST_PORT || '3592', 10),
    grpcPort: parseInt(process.env.GRPC_PORT || '3593', 10),
    watchPolicies: process.env.WATCH_POLICIES !== 'false',
    agenticEnabled: process.env.AGENTIC_ENABLED !== 'false',
    // Agent-specific config
    anomalyThreshold: parseFloat(process.env.ANOMALY_THRESHOLD || '0.7'),
    llmProvider: (process.env.LLM_PROVIDER || 'openai') as 'openai' | 'anthropic' | 'local',
    llmModel: process.env.LLM_MODEL || 'gpt-4',
    autoEnforceEnabled: process.env.AUTO_ENFORCE_ENABLED === 'true',
  };

  logger.info('Configuration', config);

  // Initialize decision engine
  const engine = new DecisionEngine();

  // Load policies
  const policyLoader = new PolicyLoader(engine, logger, config.policyDir);

  try {
    const stats = await policyLoader.loadAll();
    logger.info(`Policies loaded: ${stats.resourcePolicies} resource, ${stats.derivedRoles} derived roles`);
  } catch (error) {
    logger.error('Failed to load policies', error);
    logger.warn('Server starting without policies - check your POLICY_DIR');
  }

  // Watch for policy changes (hot reload)
  if (config.watchPolicies) {
    policyLoader.watch();
  }

  // Initialize AgentOrchestrator if enabled
  let orchestrator: AgentOrchestrator | undefined;
  if (config.agenticEnabled) {
    logger.info('Initializing AgentOrchestrator...');
    const orchestratorConfig: OrchestratorConfig = {
      agents: {
        enabled: true,
        logLevel: 'info',
        guardian: {
          anomalyThreshold: config.anomalyThreshold,
          baselinePeriodDays: 7,
          velocityWindowMinutes: 5,
          enableRealTimeDetection: true,
        },
        analyst: {
          minSampleSize: 100,
          confidenceThreshold: 0.8,
          learningEnabled: true,
          patternDiscoveryInterval: '0 */6 * * *', // Every 6 hours
        },
        advisor: {
          llmProvider: config.llmProvider,
          llmModel: config.llmModel,
          enableNaturalLanguage: true,
          maxExplanationLength: 500,
        },
        enforcer: {
          autoEnforceEnabled: config.autoEnforceEnabled,
          requireApprovalForSeverity: 'high',
          maxActionsPerHour: 100,
          rollbackWindowMinutes: 60,
        },
      },
      store: {
        type: 'memory', // Can be extended to 'sqlite' or 'postgres'
        retentionDays: 30,
      },
      eventBus: {
        type: 'memory', // Can be extended to 'redis'
        maxQueueSize: 10000,
      },
    };

    orchestrator = new AgentOrchestrator(orchestratorConfig);
    try {
      await orchestrator.initialize();
      logger.info('AgentOrchestrator initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize AgentOrchestrator', error);
      logger.warn('Server starting without agentic features');
      orchestrator = undefined;
    }
  } else {
    logger.info('Agentic features disabled (set AGENTIC_ENABLED=true to enable)');
  }

  // Start REST server
  const restServer = new RestServer(engine, logger, orchestrator);
  await restServer.start(config.restPort);

  // Start gRPC server
  const grpcServer = new GrpcServer(engine, logger, orchestrator);
  await grpcServer.start(config.grpcPort);

  logger.info('AuthZ Engine Server started');
  logger.info(`  REST API: http://localhost:${config.restPort}`);
  logger.info(`  gRPC:     localhost:${config.grpcPort}`);
  logger.info(`  Health:   http://localhost:${config.restPort}/health`);
  if (orchestrator) {
    logger.info(`  Agentic:  http://localhost:${config.restPort}/v1/agents/health`);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    await policyLoader.stopWatch();
    if (orchestrator) {
      logger.info('Shutting down AgentOrchestrator...');
      await orchestrator.shutdown();
    }
    await restServer.stop();
    await grpcServer.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Export for programmatic use
export { DecisionEngine } from '@authz-engine/core';
export { GrpcServer } from './grpc/server';
export { RestServer } from './rest/server';
export { PolicyLoader } from './policy/loader';
export { Logger } from './utils/logger';
export type { AgentOrchestrator, OrchestratorConfig } from '@authz-engine/agents';
