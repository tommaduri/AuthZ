# Swarm Authorization Coordination

## Overview

This document describes the authorization agent coordination system implemented in the AuthZ Engine swarm. The system orchestrates distributed policy enforcement through multiple specialized agent types working in concert to make authorization decisions.

## Architecture

### Four Authorization Agent Types

The swarm coordinates authorization decisions across four distinct agent types:

#### 1. GUARDIAN Agents
- **Role**: Threat detection and security checks
- **Responsibilities**:
  - Detect potential security threats
  - Validate security policies
  - Check for suspicious patterns
  - Perform initial threat assessment
- **Default Count**: 2 agents
- **Max Concurrent Tasks**: 10
- **Warmup Time**: 500ms

#### 2. ANALYST Agents
- **Role**: Risk assessment and pattern analysis
- **Responsibilities**:
  - Assess risk levels
  - Analyze access patterns
  - Evaluate contextual information
  - Calculate risk scores
- **Default Count**: 1 agent
- **Max Concurrent Tasks**: 5
- **Warmup Time**: 1000ms

#### 3. ADVISOR Agents
- **Role**: Recommendations and compliance verification
- **Responsibilities**:
  - Provide recommendations
  - Verify compliance requirements
  - Suggest alternative actions
  - Vote in consensus mechanisms
- **Default Count**: 2 agents
- **Max Concurrent Tasks**: 8
- **Warmup Time**: 200ms

#### 4. ENFORCER Agents
- **Role**: Final enforcement and rate limiting
- **Responsibilities**:
  - Make final authorization decisions
  - Enforce rate limiting
  - Block or allow access
  - Log decisions
- **Default Count**: 2 agents
- **Max Concurrent Tasks**: 15
- **Warmup Time**: 100ms

## Core Features

### 1. Agent Registration

Register authorization agents after swarm initialization:

```typescript
const coordinator = new SwarmCoordinator(config);
await coordinator.initialize();

// Register agents with custom distribution
const agents = await coordinator.registerAuthzAgents(
  2,  // Guardian count
  1,  // Analyst count
  2,  // Advisor count
  2   // Enforcer count
);
```

**Key Methods:**
- `registerAuthzAgents(guardianCount, analystCount, advisorCount, enforcerCount)`
  - Registers authorization agents
  - Automatically warms up agents
  - Integrates with topology and load balancer
  - Emits `authz_agents_registered` event

### 2. Authorization Pipeline Coordination

Orchestrate distributed authorization decisions:

```typescript
const request: AuthorizationPipelineRequest = {
  requestId: 'authz-req-123',
  subject: {
    id: 'user-456',
    type: 'user',
    attributes: { role: 'admin' }
  },
  resource: {
    id: 'document-789',
    type: 'document',
    attributes: { classification: 'confidential' }
  },
  action: 'read',
  requireConsensus: true
};

const result = await coordinator.coordinateAuthzPipeline(request);

// Result includes:
// - decision: 'allow' | 'deny' | 'indeterminate'
// - confidence: number (0-1)
// - agentDecisions: decisions from each agent type
// - consensus: consensus voting results (if requested)
// - processingTimeMs: total processing time
```

**Pipeline Stages:**

1. **Guardian Stage** (Threat Detection)
   - Threat analysis
   - Security policy checks
   - Pattern validation

2. **Analyst Stage** (Risk Assessment)
   - Risk level calculation
   - Contextual analysis
   - Pattern detection

3. **Consensus Stage** (Optional)
   - Advisory voting
   - Quorum validation
   - Confidence calculation

4. **Enforcer Stage** (Final Decision)
   - Decision execution
   - Rate limiting
   - Audit logging

### 3. Distributed Consensus

Run Byzantine fault-tolerant consensus across advisors:

```typescript
const result = await coordinator.runDistributedConsensus(
  'proposal-id',
  [true, true, false],  // Initial votes
  3  // Quorum size (optional)
);

// Returns consensus result with:
// - reached: boolean (quorum achieved)
// - decision: boolean (voting decision)
// - approvals: number of approve votes
// - rejections: number of reject votes
// - avgConfidence: average confidence level
// - durationMs: consensus time
```

**Consensus Configuration:**
```typescript
consensus: {
  enabled: true,
  quorumSize: 3,           // Min votes for quorum
  timeoutMs: 5000,         // Vote collection timeout
  approvalThreshold: 0.6,  // Required approval ratio
  minConfidence: 0.5       // Min confidence threshold
}
```

## Agent Pool Features

### Agent Type Lookup

Retrieve agents by type with health checking:

```typescript
const pool = coordinator.agentPool;

// Get single healthy agent by type
const guardian = pool.getAgentByType('GUARDIAN');

// Get all agents of type
const enforcers = pool.getAgentsByType('ENFORCER');

// Get health status for agent type
const healthStatuses = pool.getHealthStatusByType('ANALYST');

// Get count of healthy agents
const healthyCount = pool.getHealthyAgentCountByType('ADVISOR');

// Get capacity information
const capacity = pool.getCapacityByType();
// Returns: { current, available, max } for each type
```

### Health Checking

Automatic health checks run at configured intervals:

```typescript
// Health check result includes:
{
  agentId: 'agent-123',
  healthy: true,
  latencyMs: 5,
  checkedAt: Date,
  error?: string,
  details?: {
    memoryUsage: 45000,
    cpuUsage: 25,
    activeConnections: 3,
    uptime: 3600000
  }
}
```

**Health-Based Selection:**
- Prefers healthy agents
- Filters out dead/draining agents
- Prioritizes idle over busy
- Selects lowest load agents

## Load Balancer Features

### Authorization Request Routing

Route requests to appropriate agent types:

```typescript
const task: Task = {
  id: 'authz-task',
  type: 'authorization',
  priority: 'high',
  payload: { /* request data */ },
  createdAt: new Date(),
  metadata: { userId: 'user-123', sessionId: 'session-456' }
};

// Route to specific agent type
const assignment = loadBalancer.routeAuthzRequest(task, 'GUARDIAN');

// Returns TaskAssignment:
// { taskId, agentId, assignedAt }
```

### Sticky Sessions

Maintain affinity for related requests:

```typescript
// Enable sticky sessions in config
{
  stickySession: true,
  // Sessions based on: sessionId, userId, or resourceId
  // Default TTL: 5 minutes
}
```

**Benefits:**
- Cached decision reuse
- Improved performance
- Consistent routing
- Better session continuity

### Health-Aware Routing

Route based on agent health scores:

```typescript
// Get agents by type with health awareness
const byType = loadBalancer.getAgentsByTypeForAuthz();
// Map<AgentType, SwarmAgent[]> sorted by load

// Get health score for agent
const score = loadBalancer.getHealthScore(agentId);
// Returns: AgentHealthScore with:
// - score: 0-1
// - healthCheckPassRate: percentage
// - avgLatencyMs: average latency
// - load: current load
// - recentFailures: failure count
// - successRate: success percentage

// Update health scores
loadBalancer.updateHealthScore(agentId);
```

**Health Score Calculation:**
- 40% Load (inverse)
- 40% Success Rate
- 20% Latency Score

### Session Cleanup

Remove expired sticky sessions:

```typescript
// Called periodically or manually
loadBalancer.cleanupExpiredSessions();
```

## Event System

The coordinator emits events for authorization operations:

```typescript
coordinator.on('swarmEvent', (event) => {
  switch (event.type) {
    case 'authz_agents_registered':
      // Authorization agents registered
      console.log('Agents registered:', event.data.count);
      break;
    case 'task_dispatched':
      // Task sent to agent
      console.log('Task dispatched:', event.data.taskId);
      break;
    case 'task_completed':
      // Task completed successfully
      console.log('Task completed:', event.data.taskId);
      break;
    case 'task_failed':
      // Task failed
      console.log('Task failed:', event.data.taskId);
      break;
  }
});
```

## Usage Examples

### Complete Authorization Flow

```typescript
import { SwarmCoordinator } from '@authz/swarm';

// 1. Create and initialize coordinator
const coordinator = new SwarmCoordinator(config);
await coordinator.initialize();

// 2. Register authorization agents
await coordinator.registerAuthzAgents(2, 1, 2, 2);

// 3. Process authorization request
const request = {
  requestId: 'req-123',
  subject: { id: 'user-123', type: 'user' },
  resource: { id: 'doc-456', type: 'document' },
  action: 'read',
  requireConsensus: true
};

const result = await coordinator.coordinateAuthzPipeline(request);

// 4. Handle decision
if (result.decision === 'allow') {
  // Grant access
  console.log('Access allowed with confidence:', result.confidence);
} else if (result.decision === 'deny') {
  // Deny access
  console.log('Access denied');
} else {
  // Require additional checks
  console.log('Decision indeterminate, confidence:', result.confidence);
}

// 5. Shutdown when done
await coordinator.shutdown();
```

### Custom Agent Distribution

```typescript
// Create coordinator with specific config
const config: SwarmConfig = {
  id: 'auth-swarm',
  topology: { type: 'mesh' },
  loadBalancer: { strategy: 'adaptive', stickySession: true },
  agentPool: {
    minAgents: 4,
    maxAgents: 20,
    defaultAgentType: 'COORDINATOR',
    healthCheckIntervalMs: 5000,
    healthCheckTimeoutMs: 3000,
    unhealthyThresholdMs: 30000
  },
  consensus: {
    enabled: true,
    quorumSize: 3,
    timeoutMs: 5000,
    approvalThreshold: 0.6,
    minConfidence: 0.5
  }
};

const coordinator = new SwarmCoordinator(config);
await coordinator.initialize();

// Register custom distribution
const agents = await coordinator.registerAuthzAgents(
  3,  // More guardians for strict security
  2,  // More analysts for complex decisions
  3,  // More advisors for voting
  4   // More enforcers for high throughput
);
```

### Monitoring Authorization Operations

```typescript
coordinator.on('swarmEvent', (event) => {
  if (event.type === 'task_completed') {
    const metrics = coordinator.getMetrics();
    console.log('Completed:', metrics.tasksCompleted);
    console.log('Failed:', metrics.tasksFailed);
    console.log('Avg Latency:', metrics.avgTaskLatencyMs, 'ms');
  }
});

// Periodic health checks
setInterval(() => {
  const instance = coordinator.getInstance();
  console.log('Swarm Status:');
  console.log('- Total Agents:', instance.agents.size);
  console.log('- Metrics:', instance.metrics);
}, 30000);
```

## Performance Considerations

### Load Balancing
- Adaptive strategy optimizes based on real-time metrics
- Sticky sessions reduce reprocessing
- Health-aware routing avoids failing agents

### Scaling
- Auto-scale based on utilization
- Type-specific scaling rules
- Warm up before active use
- Cool down before removal

### Resource Management
- Controlled work stealing
- Task queue management
- Memory-efficient agent pooling
- Periodic session cleanup

## Testing

Comprehensive test suites cover:

1. **Coordinator Authorization** (`coordinator.authz.test.ts`)
   - Agent registration
   - Pipeline execution
   - Consensus mechanisms
   - Event handling

2. **Agent Pool Authorization** (`agent-pool.authz.test.ts`)
   - Type-based lookup
   - Health checking
   - Type distribution
   - Scaling rules

3. **Load Balancer Authorization** (`load-balancer.authz.test.ts`)
   - Request routing
   - Sticky sessions
   - Health scoring
   - Session management

## File Locations

- **Coordinator**: `/packages/swarm/src/coordinator/SwarmCoordinator.ts`
- **Agent Pool**: `/packages/swarm/src/agent-pool/AgentPool.ts`
- **Load Balancer**: `/packages/swarm/src/load-balancer/LoadBalancer.ts`
- **Tests**: `/packages/swarm/tests/`
  - `coordinator.authz.test.ts`
  - `agent-pool.authz.test.ts`
  - `load-balancer.authz.test.ts`

## Future Enhancements

- Machine learning-based decision optimization
- Multi-region agent coordination
- Advanced consensus algorithms (Raft, PBFT)
- Predictive pre-caching of decisions
- Real-time performance tuning
