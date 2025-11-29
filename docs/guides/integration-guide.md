# AuthZ Engine Integration Guide for Avatar Connex

*Last updated: 2025-11-23*

## Related SDDs

| Topic | SDD |
|-------|-----|
| SDK Usage | [SDK-PACKAGE-SDD](./sdd/SDK-PACKAGE-SDD.md) |
| NestJS Module | [NESTJS-PACKAGE-SDD](./sdd/NESTJS-PACKAGE-SDD.md) |
| Server Setup | [SERVER-PACKAGE-SDD](./sdd/SERVER-PACKAGE-SDD.md) |
| Policy Formats | [CERBOS-FEATURE-PARITY-SDD](./sdd/CERBOS-FEATURE-PARITY-SDD.md) |

**Status**: SDK and NestJS module implemented

## Quick Start

### 1. Install the NestJS Package

```bash
npm install @authz-engine/nestjs
```

### 2. Configure the Module

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthzModule } from '@authz-engine/nestjs';

@Module({
  imports: [
    ConfigModule.forRoot(),
    AuthzModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        serverUrl: config.get('AUTHZ_SERVER_URL') || 'http://authz-engine:3592',
        timeout: 5000,
        retry: {
          maxRetries: 3,
          backoffMs: 100,
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### 3. Use the Decorators

```typescript
// subscription.resolver.ts
import { Resolver, Mutation, Query, Args, Context } from '@nestjs/graphql';
import { Authorize, AuthorizeSubscription } from '@authz-engine/nestjs';

@Resolver()
export class SubscriptionResolver {
  // Method 1: Full decorator
  @Authorize({ resource: 'subscription', action: 'create' })
  @Mutation(() => SubscriptionResponse)
  async createSubscription(
    @Args('input') input: CreateSubscriptionInput,
    @Context() ctx: GraphQLContext,
  ) {
    // Authorization already checked!
    // ctx.user is guaranteed to be authorized
    return this.subscriptionService.create(input, ctx.user);
  }

  // Method 2: Resource-specific decorator
  @AuthorizeSubscription('view')
  @Query(() => [Subscription])
  async mySubscriptions(@Context() ctx: GraphQLContext) {
    return this.subscriptionService.findByUser(ctx.user.id);
  }

  // Method 3: With resource ID from args
  @Authorize({
    resource: 'subscription',
    action: 'cancel',
    resourceIdParam: 'subscriptionId'
  })
  @Mutation(() => SubscriptionResponse)
  async cancelSubscription(
    @Args('subscriptionId') subscriptionId: string,
    @Context() ctx: GraphQLContext,
  ) {
    return this.subscriptionService.cancel(subscriptionId);
  }
}
```

### 4. Use the Service Directly (Advanced)

```typescript
// avatar.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { AuthzService } from '@authz-engine/nestjs';

@Injectable()
export class AvatarService {
  constructor(private readonly authz: AuthzService) {}

  async updateAvatar(avatarId: string, user: User, updates: UpdateAvatarDto) {
    // Manual authorization check with custom attributes
    const allowed = await this.authz.isAllowed(
      this.authz.createPrincipal(user),
      {
        kind: 'avatar',
        id: avatarId,
        attributes: {
          ownerId: updates.ownerId,
          status: updates.status,
        },
      },
      'update',
    );

    if (!allowed) {
      throw new ForbiddenException('Not authorized to update this avatar');
    }

    return this.avatarRepository.update(avatarId, updates);
  }

  async batchCheckAvatarAccess(user: User, avatarIds: string[]) {
    // Batch check for efficiency
    const avatars = await this.avatarRepository.findByIds(avatarIds);

    const results = await this.authz.batchCheck(
      this.authz.createPrincipal(user),
      avatars.map(avatar => ({
        resource: this.authz.createResource('avatar', avatar),
        actions: ['view', 'edit'],
      })),
    );

    // Filter to only accessible avatars
    return avatars.filter(avatar =>
      results[`avatar:${avatar.id}`]?.allowed
    );
  }
}
```

## Migration from Current Auth Patterns

### Before (Current Pattern)

```typescript
// Current scattered auth in resolvers
@Mutation(() => SubscriptionResponse)
async createSubscription(
  @Args('input') input: CreateSubscriptionInput,
  @Context() ctx: GraphQLContext,
) {
  // ❌ Inconsistent: sometimes context.user, sometimes context.authUserId
  const user = ctx.user;
  if (!user) {
    throw new UnauthorizedException('Authentication required');
  }

  // ❌ Business logic mixed with authorization
  const influencer = await this.userService.findInfluencer(input.influencerId);
  if (!influencer) {
    throw new NotFoundException('Influencer not found');
  }

  // ❌ Hardcoded role checks
  if (user.userType !== UserType.FAN && user.userType !== UserType.USER) {
    throw new ForbiddenException('Only fans can create subscriptions');
  }

  return this.subscriptionService.create(input, user);
}
```

### After (With AuthZ Engine)

```typescript
// Clean separation of concerns
@Authorize({ resource: 'subscription', action: 'create' })
@Mutation(() => SubscriptionResponse)
async createSubscription(
  @Args('input') input: CreateSubscriptionInput,
  @Context() ctx: GraphQLContext,
) {
  // ✅ Authorization handled by decorator
  // ✅ ctx.user guaranteed to exist and be authorized
  return this.subscriptionService.create(input, ctx.user);
}
```

## Policy File Structure

Policies are YAML files in the `/policies` directory:

```
policies/
├── connex/
│   ├── avatar.yaml           # Avatar resource policies
│   ├── subscription.yaml     # Subscription policies
│   ├── chat.yaml             # Chat/messaging policies
│   ├── payout.yaml           # Payout policies
│   └── derived-roles.yaml    # Dynamic role computation
└── examples/
    └── ...
```

## Environment Variables

```bash
# AuthZ Engine Server
AUTHZ_SERVER_URL=http://authz-engine:3592

# For local development
AUTHZ_SERVER_URL=http://localhost:3592
```

## Docker Deployment

```yaml
# docker-compose.yaml (add to existing)
services:
  authz-engine:
    image: authz-engine:latest
    ports:
      - "3592:3592"
      - "3593:3593"
    volumes:
      - ./policies:/policies:ro
    environment:
      - POLICY_DIR=/policies
      - WATCH_POLICIES=true
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3592/health"]
      interval: 10s
      timeout: 5s
      retries: 3
```

## Testing

### Unit Tests with Mock

```typescript
import { Test } from '@nestjs/testing';
import { AuthzModule, AuthzService } from '@authz-engine/nestjs';

describe('SubscriptionResolver', () => {
  let authzService: AuthzService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        AuthzModule.forRoot({
          serverUrl: 'http://mock-authz:3592',
        }),
      ],
    }).compile();

    authzService = module.get(AuthzService);
  });

  it('should check authorization', async () => {
    // Mock the service
    jest.spyOn(authzService, 'isAllowed').mockResolvedValue(true);

    // Test your resolver
  });
});
```

### Integration Tests

```typescript
describe('AuthZ Integration', () => {
  it('should allow owner to edit avatar', async () => {
    const result = await authzService.isAllowed(
      { id: 'user-123', roles: ['influencer'], attributes: {} },
      { kind: 'avatar', id: 'avatar-1', attributes: { ownerId: 'user-123' } },
      'edit',
    );

    expect(result).toBe(true);
  });

  it('should deny non-owner from editing avatar', async () => {
    const result = await authzService.isAllowed(
      { id: 'user-456', roles: ['influencer'], attributes: {} },
      { kind: 'avatar', id: 'avatar-1', attributes: { ownerId: 'user-123' } },
      'edit',
    );

    expect(result).toBe(false);
  });
});
```

## Monitoring

The AuthZ Engine exposes metrics at `/health` and `/api/policies`:

```bash
# Health check
curl http://localhost:3592/health
# {"status":"healthy","version":"0.1.0","policies_loaded":4,"uptime_seconds":3600}

# Policy info
curl http://localhost:3592/api/policies
# {"resourcePolicies":3,"derivedRolesPolicies":1,"resources":["avatar","subscription","chat"]}
```

## Common Patterns

### 1. Owner-based Access

```yaml
# Policy
rules:
  - actions: [edit, delete]
    effect: allow
    roles: [user]
    condition:
      expression: resource.ownerId == principal.id
```

### 2. Subscription-based Access

```yaml
# Derived role
definitions:
  - name: subscriber
    parentRoles: [fan]
    condition:
      expression: principal.id in resource.subscriberIds
```

### 3. Admin Override

```yaml
# Always allow admins
rules:
  - actions: ["*"]
    effect: allow
    roles: [admin, super_admin]
```

### 4. Status-based Denial

```yaml
# Deny access to suspended resources
rules:
  - actions: [view, interact]
    effect: deny
    condition:
      expression: resource.status == "suspended"
```
