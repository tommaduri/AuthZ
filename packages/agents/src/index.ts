/**
 * @authz-engine/agents
 *
 * Agentic Authorization Framework
 *
 * Provides intelligent agents for:
 * - GUARDIAN: Anomaly detection & real-time protection
 * - ANALYST: Pattern learning & policy optimization
 * - ADVISOR: LLM-powered explanations & recommendations
 * - ENFORCER: Autonomous action execution
 */

// Types
export * from './types/index.js';

// Core infrastructure
export { BaseAgent } from './core/base-agent.js';
export { DecisionStore } from './core/decision-store.js';
export type { DecisionStoreConfig, QueryOptions, DecisionQuery } from './core/decision-store.js';
export { EventBus } from './core/event-bus.js';
export type { EventBusConfig, EventHandler, EventSubscription } from './core/event-bus.js';

// Agents
export { GuardianAgent } from './guardian/index.js';
export type { GuardianConfig } from './guardian/index.js';
export { AnalystAgent } from './analyst/index.js';
export type { AnalystConfig } from './analyst/index.js';
export { AdvisorAgent } from './advisor/index.js';
export type { AdvisorConfig } from './advisor/index.js';
export { EnforcerAgent } from './enforcer/index.js';
export type { EnforcerConfig } from './enforcer/index.js';

// Orchestrator
export { AgentOrchestrator } from './orchestrator/index.js';
export type { OrchestratorConfig, ProcessingResult } from './orchestrator/index.js';

// Convenience types
export type { AgentConfig, AgentType, AgentState } from './types/agent.types.js';
