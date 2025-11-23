# ADR-004: Memory-first Development Mode

**Status**: Accepted
**Date**: 2024-11-23
**Deciders**: AuthZ Engine Team
**Technical Story**: Simplify local development and testing

---

## Context

The AuthZ Engine's agents package requires:
- **DecisionStore**: For persisting authorization decisions
- **EventBus**: For agent coordination events

Production deployments use PostgreSQL and Redis/Kafka, but requiring these for development creates friction:
- Developers need Docker or local installations
- Tests become slower and more complex
- CI/CD pipelines need database services

## Decision

We implemented a **memory-first development mode** where both DecisionStore and EventBus default to in-memory implementations when no external services are configured.

### DecisionStoreConfig
```typescript
export interface DecisionStoreConfig {
  /** Store type - 'memory' for in-memory, 'postgres' for database */
  type?: 'memory' | 'postgres';

  /** PostgreSQL connection (required for type: 'postgres') */
  database?: PoolConfig;

  /** Enable vector search (postgres only) */
  enableVectorSearch?: boolean;

  /** Vector embedding dimension */
  embeddingDimension?: number;

  /** Retention period */
  retentionDays: number;
}
```

### EventBusConfig
```typescript
export interface EventBusConfig {
  /** Event bus mode */
  type?: 'memory' | 'redis' | 'kafka';
  mode?: 'memory' | 'redis' | 'kafka';  // Alias

  /** Max queue size for memory mode */
  maxQueueSize?: number;

  /** Redis configuration */
  redis?: { host: string; port: number; password?: string };

  /** Kafka configuration */
  kafka?: { brokers: string[]; clientId: string; groupId: string };
}
```

### Mode Detection
```typescript
// DecisionStore
private isMemoryMode(): boolean {
  return this.config.type === 'memory' || !this.config.database;
}

// EventBus
private getMode(): 'memory' | 'redis' | 'kafka' {
  return this.config.mode || this.config.type || 'memory';
}
```

## Consequences

### Positive
- **Zero Setup**: `npm run dev` works without Docker
- **Fast Tests**: In-memory storage is orders of magnitude faster
- **Simpler CI**: No database services in CI pipelines
- **Gradual Migration**: Can start with memory, add databases later
- **Type Compatibility**: Same interfaces for all modes

### Negative
- **Data Loss on Restart**: Memory mode loses all data
- **No Scalability**: Memory mode is single-process only
- **Different Behavior**: Memory mode doesn't exercise database queries
- **Testing Gap**: Some bugs only appear with real databases

### Neutral
- Clear warning logs when running in memory mode
- Same API surface regardless of mode

## Usage Examples

### Development (Memory Mode)
```typescript
const orchestratorConfig: OrchestratorConfig = {
  agents: { enabled: true, logLevel: 'debug' },
  store: {
    type: 'memory',
    retentionDays: 30,
  },
  eventBus: {
    type: 'memory',
    maxQueueSize: 10000,
  },
};
```

### Production (PostgreSQL + Redis)
```typescript
const orchestratorConfig: OrchestratorConfig = {
  agents: { enabled: true, logLevel: 'info' },
  store: {
    type: 'postgres',
    database: {
      host: process.env.PG_HOST,
      port: 5432,
      database: 'authz',
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
    },
    enableVectorSearch: true,
    embeddingDimension: 1536,
    retentionDays: 90,
  },
  eventBus: {
    type: 'redis',
    redis: {
      host: process.env.REDIS_HOST,
      port: 6379,
      password: process.env.REDIS_PASSWORD,
    },
  },
};
```

## In-Memory Implementation Details

### DecisionStore Memory Mode
```typescript
private memoryStore: {
  decisions: Map<string, DecisionRecord>;
  anomalies: Map<string, Anomaly>;
  patterns: Map<string, LearnedPattern>;
  actions: Map<string, EnforcerAction>;
} = {
  decisions: new Map(),
  anomalies: new Map(),
  patterns: new Map(),
  actions: new Map(),
};

async storeDecision(decision: DecisionRecord): Promise<void> {
  if (this.isMemoryMode()) {
    this.memoryStore.decisions.set(decision.id, decision);
    return;
  }
  // ... PostgreSQL implementation
}
```

### EventBus Memory Mode
```typescript
// Uses EventEmitter from eventemitter3
private emitter: EventEmitter;

async publish(event: AgentEvent): Promise<void> {
  if (this.getMode() === 'memory') {
    this.emitter.emit(channel, event);
    this.emitter.emit('*', event);
    return;
  }
  // ... Redis/Kafka implementation
}
```

## Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| **Always require DB** | Production-like dev | High friction, slow tests | Developer experience suffers |
| **SQLite for dev** | Persistent, SQL compat | Still requires file, different dialect | Adds complexity |
| **Testcontainers** | Real DB in tests | Slow startup, Docker required | Not all devs have Docker |
| **Separate test impl** | Clean separation | Duplicate code, different APIs | Maintenance burden |

## Testing Considerations

### Unit Tests
Always use memory mode for fast, isolated tests:
```typescript
beforeEach(() => {
  store = new DecisionStore({ type: 'memory', retentionDays: 30 });
});
```

### Integration Tests
Use memory mode by default, with option for database tests:
```typescript
describe('DecisionStore', () => {
  const useRealDb = process.env.TEST_WITH_DB === 'true';

  beforeEach(async () => {
    store = new DecisionStore(useRealDb ? dbConfig : memoryConfig);
    await store.initialize();
  });
});
```

## Related ADRs
- ADR-002: Monorepo Structure (affects development workflow)

## References
- [eventemitter3](https://github.com/primus/eventemitter3) - Fast EventEmitter
- [node-postgres](https://node-postgres.com/) - PostgreSQL client
