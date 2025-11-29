# Agentic Authorization Engine - Integration Guide

*Last updated: 2025-11-23*

## Agent Reference

| Agent | Purpose | SDD Section |
|-------|---------|-------------|
| GUARDIAN | Anomaly detection, risk scoring | [AGENTS-PACKAGE-SDD#guardian](./sdd/AGENTS-PACKAGE-SDD.md) |
| ANALYST | Pattern learning, optimization | [AGENTS-PACKAGE-SDD#analyst](./sdd/AGENTS-PACKAGE-SDD.md) |
| ADVISOR | LLM explanations | [AGENTS-PACKAGE-SDD#advisor](./sdd/AGENTS-PACKAGE-SDD.md) |
| ENFORCER | Rate limiting, blocking | [AGENTS-PACKAGE-SDD#enforcer](./sdd/AGENTS-PACKAGE-SDD.md) |

**Status**: All 4 agents implemented

## Configuration Reference

See [AGENTS-PACKAGE-SDD](./sdd/AGENTS-PACKAGE-SDD.md) for complete configuration options.

## Overview

The Agentic Authorization Engine extends traditional policy-based authorization with four intelligent agents:

| Agent | Purpose | Key Capabilities |
|-------|---------|------------------|
| **GUARDIAN** | Anomaly Detection | Real-time threat detection, velocity tracking, baseline comparison |
| **ANALYST** | Pattern Learning | Access pattern discovery, policy optimization suggestions |
| **ADVISOR** | LLM Explanations | Natural language decision explanations, policy debugging |
| **ENFORCER** | Action Execution | Rate limiting, blocking, MFA enforcement, session revocation |

## Quick Start

### 1. Install Dependencies

```bash
npm install @authz-engine/core @authz-engine/agents @authz-engine/nestjs
```

### 2. Configure the Orchestrator

```typescript
import { AgentOrchestrator } from '@authz-engine/agents';

const orchestrator = new AgentOrchestrator({
  agents: {
    enabled: true,
    logLevel: 'info',
    guardian: {
      anomalyThreshold: 0.7,
      baselinePeriodDays: 30,
      velocityWindowMinutes: 5,
      enableRealTimeDetection: true,
    },
    analyst: {
      minSampleSize: 50,
      confidenceThreshold: 0.8,
      learningEnabled: true,
    },
    advisor: {
      llmProvider: 'openai',
      llmModel: 'gpt-4-turbo-preview',
      enableNaturalLanguage: true,
      maxExplanationLength: 500,
    },
    enforcer: {
      autoEnforceEnabled: false, // Start with manual approval
      requireApprovalForSeverity: 'high',
      maxActionsPerHour: 100,
      rollbackWindowMinutes: 60,
    },
  },
  store: {
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: 5432,
      database: 'authz_engine',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    },
    enableVectorSearch: true,
    embeddingDimension: 1536,
    retentionDays: 90,
  },
  eventBus: {
    mode: 'redis', // 'memory' for single-process, 'kafka' for distributed
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: 6379,
    },
  },
});

await orchestrator.initialize();
```

### 3. Process Requests with Agents

```typescript
import { DecisionEngine } from '@authz-engine/core';

const engine = new DecisionEngine();
const orchestrator = new AgentOrchestrator(config);

async function checkAuthorization(request: CheckRequest) {
  // 1. Core policy evaluation
  const response = engine.check(request);

  // 2. Agentic processing
  const result = await orchestrator.processRequest(request, response, {
    includeExplanation: true,
    policyContext: {
      matchedRules: response.meta?.matchedRules || [],
      derivedRoles: response.meta?.derivedRoles || [],
    },
  });

  // 3. Return enriched response
  return {
    allowed: response.results[request.actions[0]]?.allowed,
    anomalyScore: result.anomalyScore,
    explanation: result.explanation?.naturalLanguage,
    enforcement: result.enforcement,
  };
}
```

## NestJS Integration

### Module Setup

```typescript
// authz.module.ts
import { Module } from '@nestjs/common';
import { AgenticAuthzModule } from '@authz-engine/nestjs';

@Module({
  imports: [
    AgenticAuthzModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        serverUrl: config.get('AUTHZ_SERVER_URL'),
        agenticFeatures: {
          enabled: true,
          includeExplanations: true,
          anomalyThreshold: 0.7,
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### Using Decorators with Agentic Features

```typescript
import { Authorize, WithExplanation } from '@authz-engine/nestjs';

@Resolver()
export class SubscriptionResolver {
  // Basic authorization with anomaly detection
  @Authorize({ resource: 'subscription', action: 'create' })
  @Mutation(() => Subscription)
  async createSubscription(
    @Args('input') input: CreateSubscriptionInput,
    @Context() ctx: GraphQLContext,
  ) {
    return this.subscriptionService.create(input, ctx.user);
  }

  // Include natural language explanation in response
  @Authorize({ resource: 'subscription', action: 'cancel' })
  @WithExplanation()
  @Mutation(() => SubscriptionCancelResponse)
  async cancelSubscription(
    @Args('id') id: string,
    @Context() ctx: GraphQLContext,
  ): Promise<SubscriptionCancelResponse> {
    const result = await this.subscriptionService.cancel(id, ctx.user);
    return {
      success: true,
      explanation: ctx.authzExplanation, // Natural language explanation
    };
  }
}
```

## Agent-Specific Features

### GUARDIAN: Anomaly Detection

```typescript
// Check anomaly score for a request
const result = await orchestrator.processRequest(request, response);

if (result.anomalyScore > 0.7) {
  console.log('High anomaly detected:', result.anomaly);
  // Alert security team, require additional verification, etc.
}

// Get recent anomalies for a user
const anomalies = orchestrator.getAnomalies('user-123');
```

### ANALYST: Pattern Discovery

```typescript
// Trigger pattern discovery
const patterns = await orchestrator.discoverPatterns();

for (const pattern of patterns) {
  console.log(`Discovered: ${pattern.description}`);
  console.log(`Confidence: ${pattern.confidence}`);
  console.log(`Suggested policy:\n${pattern.suggestedPolicyRule}`);
}

// Get all discovered patterns
const allPatterns = orchestrator.getPatterns();
```

### ADVISOR: LLM Explanations

```typescript
// Ask a question about policies
const answer = await orchestrator.askQuestion(
  'Why was user-123 denied access to the payout resource?'
);

// Debug a policy
const diagnosis = await orchestrator.debugPolicy(
  'Subscribers cannot view premium content',
  policyYaml
);

// Get explanation for specific decision
const result = await orchestrator.processRequest(request, response, {
  includeExplanation: true,
});
console.log(result.explanation?.naturalLanguage);
```

### ENFORCER: Action Execution

```typescript
// Get pending actions requiring approval
const pending = orchestrator.getPendingActions();

// Approve an action
await orchestrator.approveAction('action-123', 'admin@example.com');

// Manually trigger enforcement
await orchestrator.triggerEnforcement(
  'rate_limit',
  'suspicious-user-456',
  'Unusual bulk data access pattern'
);

// Check if user is currently rate-limited/blocked
// (This happens automatically in processRequest)
```

## Avatar Connex Integration Examples

### Subscription Authorization with Anomaly Detection

```typescript
// subscription.resolver.ts
@Resolver()
export class SubscriptionResolver {
  constructor(
    private authz: AgenticAuthzService,
    private subscriptions: SubscriptionService,
  ) {}

  @Mutation(() => Subscription)
  async createSubscription(
    @Args('input') input: CreateSubscriptionInput,
    @Context() ctx: GraphQLContext,
  ) {
    // Check authorization with agentic processing
    const authResult = await this.authz.check({
      principal: {
        id: ctx.user.id,
        roles: [ctx.user.userType],
        attributes: {
          tier: ctx.user.subscriptionTier,
          verified: ctx.user.isVerified,
        },
      },
      resource: {
        kind: 'subscription',
        id: 'new',
        attributes: {
          influencerId: input.influencerId,
          tier: input.tier,
        },
      },
      actions: ['create'],
    });

    // Handle high anomaly scores
    if (authResult.anomalyScore > 0.8) {
      // Require additional verification
      throw new UnauthorizedException(
        'Additional verification required. Please complete 2FA.'
      );
    }

    if (!authResult.allowed) {
      throw new ForbiddenException(
        authResult.explanation || 'Not authorized to create subscription'
      );
    }

    return this.subscriptions.create(input, ctx.user);
  }
}
```

### Payout Authorization with Enforcement

```typescript
// payout.resolver.ts
@Resolver()
export class PayoutResolver {
  @Mutation(() => PayoutResponse)
  async requestPayout(
    @Args('input') input: PayoutRequestInput,
    @Context() ctx: GraphQLContext,
  ) {
    const authResult = await this.authz.check({
      principal: {
        id: ctx.user.id,
        roles: [ctx.user.userType],
        attributes: {
          verifiedIdentity: ctx.user.idVerified,
          accountAge: ctx.user.accountAgeDays,
        },
      },
      resource: {
        kind: 'payout',
        id: 'new',
        attributes: {
          amount: input.amount,
          currency: input.currency,
        },
      },
      actions: ['create'],
    });

    // Check for enforcement actions
    if (authResult.enforcement?.action) {
      // User is rate-limited or blocked
      throw new TooManyRequestsException(
        `Payout requests temporarily limited: ${authResult.enforcement.reason}`
      );
    }

    // High-value payouts trigger additional scrutiny
    if (input.amount > 10000 && authResult.anomalyScore > 0.5) {
      // Queue for manual review instead of instant processing
      return this.payouts.queueForReview(input, ctx.user, authResult.explanation);
    }

    return this.payouts.process(input, ctx.user);
  }
}
```

## Monitoring & Operations

### Health Endpoint

```typescript
// health.controller.ts
@Controller('health')
export class HealthController {
  constructor(private orchestrator: AgentOrchestrator) {}

  @Get('agents')
  async getAgentHealth() {
    return this.orchestrator.getHealth();
  }
}
```

Response:
```json
{
  "status": "healthy",
  "agents": {
    "guardian": {
      "agentId": "guardian-1234567890",
      "state": "ready",
      "lastActivity": "2024-01-15T10:30:00Z",
      "metrics": {
        "processedCount": 15234,
        "errorCount": 2,
        "avgProcessingTimeMs": 3.5,
        "customMetrics": {
          "anomalies_detected": 47
        }
      }
    },
    "analyst": { ... },
    "advisor": { ... },
    "enforcer": { ... }
  },
  "infrastructure": {
    "store": "connected",
    "eventBus": "connected"
  }
}
```

### Metrics & Alerts

The orchestrator emits events you can subscribe to:

```typescript
orchestrator.eventBus.subscribe('anomaly_detected', async (event) => {
  // Send to monitoring system
  await metrics.increment('authz.anomalies', { severity: event.payload.severity });

  // Alert on critical anomalies
  if (event.payload.severity === 'critical') {
    await alerting.send({
      channel: '#security-alerts',
      message: `Critical anomaly: ${event.payload.description}`,
    });
  }
});

orchestrator.eventBus.subscribe('action_triggered', async (event) => {
  await audit.log({
    type: 'enforcement_action',
    action: event.payload,
  });
});
```

## Best Practices

### 1. Start Conservative

```typescript
// Begin with manual approval for all enforcement actions
enforcer: {
  autoEnforceEnabled: false,
  requireApprovalForSeverity: 'low', // All actions need approval
}
```

### 2. Tune Thresholds Based on Data

```typescript
// After collecting baseline data (30+ days), adjust thresholds
guardian: {
  anomalyThreshold: 0.75, // Adjust based on false positive rate
  baselinePeriodDays: 30,
}
```

### 3. Use Explanations for User-Facing Denials

```typescript
if (!authResult.allowed) {
  throw new ForbiddenException({
    message: 'Access denied',
    explanation: authResult.explanation?.naturalLanguage,
    pathToAllow: authResult.explanation?.pathToAllow,
  });
}
```

### 4. Review Discovered Patterns Regularly

```typescript
// Weekly job to review new patterns
const patterns = orchestrator.getPatterns().filter(p => !p.isApproved);
for (const pattern of patterns) {
  await notifySecurityTeam(pattern);
}
```

### 5. Enable Gradual Auto-Enforcement

```typescript
// After confidence builds, enable auto-enforcement for low severity
enforcer: {
  autoEnforceEnabled: true,
  requireApprovalForSeverity: 'high', // Only high+ needs approval
}
```

## Environment Variables

```bash
# Database (for decision storage)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=authz_engine
DB_USER=authz
DB_PASSWORD=secret

# Redis (for event bus)
REDIS_HOST=localhost
REDIS_PORT=6379

# LLM (for ADVISOR agent)
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=sk-ant-...

# Enforcement webhooks
ENFORCEMENT_WEBHOOK_URL=https://your-system.com/webhooks/authz
ALERT_EMAIL=security@yourcompany.com
```

## Next Steps

1. **Deploy the AuthZ Engine server** (see docker-compose.yaml)
2. **Configure policies** for your resources
3. **Integrate with your service** using the NestJS module
4. **Monitor the dashboard** for patterns and anomalies
5. **Review and approve** discovered patterns and enforcement actions
6. **Gradually enable** auto-enforcement as confidence builds
