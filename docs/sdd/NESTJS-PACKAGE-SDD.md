# Software Design Document: @authz-engine/nestjs

**Version**: 1.0.0
**Package**: `packages/nestjs`
**Status**: ✅ Fully Implemented (with undocumented features)
**Last Updated**: 2025-11-25

> **📌 Undocumented Feature: AuthzAgenticService**
>
> The implementation includes an **AuthzAgenticService** that provides:
> - Direct access to agentic features (GUARDIAN, ANALYST, ADVISOR, ENFORCER)
> - Programmatic anomaly detection
> - Pattern learning integration
> - Decision explanation generation
>
> This service is exported but not documented in this SDD. Additional agentic decorators
> beyond those listed may also exist in the implementation.

---

## 1. Overview

### 1.1 Purpose

The `@authz-engine/nestjs` package provides NestJS integration for the AuthZ Engine. It offers decorators, guards, and a service for seamless authorization in NestJS applications, including support for agentic features like anomaly detection and decision explanations.

### 1.2 Scope

This package includes:
- `AuthzModule` - NestJS dynamic module
- `AuthzGuard` - Guard for authorization checks
- `AuthzService` - Service for programmatic access
- Decorators for declarative authorization
- Agentic authorization decorators
- Parameter decorators for accessing authorization context

### 1.3 Package Structure

```
packages/nestjs/
├── src/
│   ├── index.ts              # Package exports
│   ├── authz.module.ts       # NestJS module
│   ├── authz.guard.ts        # Authorization guard
│   ├── authz.service.ts      # Authorization service
│   └── decorators.ts         # All decorators
├── tests/
└── package.json
```

---

## 2. Architecture

### 2.1 Component Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                      @authz-engine/nestjs                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                      AuthzModule                            │  │
│  │  - forRoot(options)                                        │  │
│  │  - forRootAsync(options)                                   │  │
│  │                                                             │  │
│  │  Provides:                                                  │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │  │
│  │  │AuthzService │  │ AuthzGuard  │  │   AUTHZ_CLIENT      │ │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                       Decorators                            │  │
│  │                                                             │  │
│  │  Standard:                    Agentic:                      │  │
│  │  ┌──────────────────┐        ┌────────────────────────┐    │  │
│  │  │ @Authorize       │        │ @AuthorizeWithExplanation│   │  │
│  │  │ @AuthorizeResource│       │ @AnomalyProtected       │    │  │
│  │  │ @RequireRole     │        │ @AuditAction            │    │  │
│  │  │ @Public          │        └────────────────────────┘    │  │
│  │  └──────────────────┘                                       │  │
│  │                                                             │  │
│  │  Parameter Decorators:                                      │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │ @AuthzExplanation  @AnomalyScore  @AuthzFactors     │  │  │
│  │  │ @AuthzConfidence                                     │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│                    ┌───────────────────┐                         │
│                    │ @authz-engine/sdk │                         │
│                    │    AuthzClient    │                         │
│                    └───────────────────┘                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Request Flow with Guard

```
HTTP Request
     │
     ▼
┌──────────────────┐
│   NestJS Router  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    AuthzGuard    │
│  canActivate()   │
│                  │
│  1. Get metadata │◄── @Authorize decorator
│  2. Extract user │◄── req.user
│  3. Build context│
│  4. Check authz  │──────────────────────┐
└────────┬─────────┘                      │
         │                                ▼
         │                      ┌──────────────────┐
         │                      │   AuthzService   │
         │                      │   .isAllowed()   │
         │                      │   or             │
         │                      │   .checkWithAgents()
         │                      └────────┬─────────┘
         │                               │
         ▼                               ▼
┌──────────────────┐           ┌──────────────────┐
│  Handler Method  │           │    AuthzClient   │
│  (if allowed)    │           │   (REST call)    │
└──────────────────┘           └──────────────────┘
```

---

## 3. Component Design

### 3.1 AuthzModule (`authz.module.ts`)

#### 3.1.1 Static Configuration

```typescript
@Module({})
export class AuthzModule {
  static forRoot(options: AuthzModuleOptions): DynamicModule {
    return {
      module: AuthzModule,
      global: options.global ?? true,
      providers: [
        { provide: AUTHZ_CLIENT, useFactory: () => createClient(options) },
        { provide: AUTHZ_OPTIONS, useValue: options },
        AuthzService,
        AuthzGuard,
      ],
      exports: [AuthzService, AuthzGuard, AUTHZ_CLIENT],
    };
  }
}
```

#### 3.1.2 Async Configuration

```typescript
static forRootAsync(options: AuthzModuleAsyncOptions): DynamicModule {
  return {
    module: AuthzModule,
    global: options.global ?? true,
    imports: options.imports || [],
    providers: [
      {
        provide: AUTHZ_CLIENT,
        useFactory: async (...args) => {
          const config = await options.useFactory(...args);
          return createClient(config);
        },
        inject: options.inject || [],
      },
      { provide: AUTHZ_OPTIONS, useFactory: options.useFactory, inject: options.inject },
      AuthzService,
      AuthzGuard,
    ],
    exports: [AuthzService, AuthzGuard, AUTHZ_CLIENT],
  };
}
```

#### 3.1.3 Configuration Interfaces

```typescript
interface AuthzModuleOptions extends AuthzClientConfig {
  global?: boolean;  // Default: true
}

interface AuthzModuleAsyncOptions {
  global?: boolean;
  imports?: any[];
  useFactory: (...args: any[]) => Promise<AuthzClientConfig> | AuthzClientConfig;
  inject?: any[];
}
```

### 3.2 AuthzGuard (`authz.guard.ts`)

#### 3.2.1 Purpose

NestJS guard that enforces authorization using metadata from decorators.

#### 3.2.2 Supported Context Types

| Context | User Location | Resource Extraction |
|---------|---------------|---------------------|
| HTTP | `request.user` | Params, body |
| WebSocket | `client.user` | Client data |
| GraphQL | `context.user` | Args |

#### 3.2.3 canActivate Implementation

```typescript
@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authzService: AuthzService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Get metadata from decorator
    const metadata = this.reflector.get<AuthzMetadata>(
      AUTHZ_METADATA_KEY,
      context.getHandler(),
    );

    // 2. If no metadata, allow (no auth required)
    if (!metadata) return true;

    // 3. Extract user and resource from request context
    const { user, resourceData } = this.extractContext(context, metadata);

    // 4. Ensure user is authenticated
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }

    // 5. Build principal and resource
    const principal = this.authzService.createPrincipal(user);
    const resource = {
      kind: metadata.resource,
      id: resourceData?.id || '*',
      attributes: resourceData || {},
    };

    // 6. Check authorization (standard or agentic)
    if (this.needsAgenticCheck(metadata)) {
      return this.performAgenticCheck(principal, resource, metadata, context);
    }

    // 7. Standard check
    const allowed = await this.authzService.isAllowed(
      principal, resource, metadata.action
    );

    if (!allowed) {
      throw new ForbiddenException(
        `Not authorized to ${metadata.action} ${metadata.resource}`
      );
    }

    return true;
  }
}
```

### 3.3 AuthzService (`authz.service.ts`)

#### 3.3.1 Purpose

Injectable service for programmatic authorization checks.

#### 3.3.2 Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `isAllowed` | `(principal, resource, action) => Promise<boolean>` | Simple check |
| `check` | `(principal, resource, actions) => Promise<CheckResult>` | Multiple actions |
| `checkWithAgents` | `(principal, resource, action, options) => Promise<AgenticResult>` | With agents |
| `createPrincipal` | `(user: any) => Principal` | Build principal from user |

#### 3.3.3 Agentic Check Options

```typescript
interface AgenticCheckOptions {
  includeExplanation?: boolean;
  checkAnomalies?: boolean;
  auditAction?: boolean;
  context?: Record<string, unknown>;
}

interface AgenticResult {
  allowed: boolean;
  explanation?: string;
  anomalyScore?: number;
  factors?: AuthzFactor[];
  confidence?: number;
}
```

### 3.4 Decorators (`decorators.ts`)

#### 3.4.1 Standard Decorators

| Decorator | Purpose | Example |
|-----------|---------|---------|
| `@Authorize` | Full authorization check | `@Authorize({ resource: 'doc', action: 'read' })` |
| `@AuthorizeResource` | Resource-specific factory | `AuthorizeResource('doc')('read')` |
| `@RequireRole` | Simple role check | `@RequireRole('admin')` |
| `@Public` | Mark as public | `@Public()` |

#### 3.4.2 Pre-built Resource Decorators

```typescript
// Avatar Connex specific
export const AuthorizeAvatar = AuthorizeResource('avatar');
export const AuthorizeSubscription = AuthorizeResource('subscription');
export const AuthorizeChat = AuthorizeResource('chat');
export const AuthorizePayout = AuthorizeResource('payout');
export const AuthorizeNotification = AuthorizeResource('notification');
```

#### 3.4.3 Agentic Decorators

| Decorator | Purpose | Features |
|-----------|---------|----------|
| `@AuthorizeWithExplanation` | Auth + explanation | Enables ADVISOR agent |
| `@AnomalyProtected` | Anomaly detection | Enables GUARDIAN agent |
| `@AuditAction` | Audit logging | Enables ANALYST learning |

#### 3.4.4 Parameter Decorators

| Decorator | Returns | Use Case |
|-----------|---------|----------|
| `@AuthzExplanation()` | `string` | Get decision explanation |
| `@AnomalyScore()` | `number` | Get anomaly score (0-1) |
| `@AuthzFactors()` | `AuthzFactor[]` | Get decision factors |
| `@AuthzConfidence()` | `number` | Get confidence score |

### 3.5 Metadata Interfaces

```typescript
// Standard authorization
interface AuthzMetadata {
  resource: string;
  action: string;
  resourceIdParam?: string;      // Default: 'id'
  resourceFromBody?: boolean;
}

// Agentic authorization
interface AgenticAuthzMetadata extends AuthzMetadata {
  includeExplanation?: boolean;
  checkAnomalies?: boolean;
  auditAction?: boolean;
  context?: Record<string, unknown>;
}

// Anomaly protection options
interface AnomalyProtectionOptions {
  maxAnomalyScore?: number;      // Default: 0.8
  logHighAnomaly?: boolean;      // Default: true
  onAnomaly?: 'block' | 'warn' | 'log';  // Default: 'block'
}

// Audit action options
interface AuditActionOptions {
  actionName?: string;
  includeBody?: boolean;
  includeResponse?: boolean;
  metadata?: Record<string, unknown>;
}
```

---

## 4. Interfaces

### 4.1 Public API

```typescript
// From index.ts
export {
  // Module
  AuthzModule,
  AuthzModuleOptions,
  AuthzModuleAsyncOptions,
  AUTHZ_CLIENT,
  AUTHZ_OPTIONS,

  // Guard
  AuthzGuard,

  // Service
  AuthzService,
  AgenticCheckOptions,

  // Standard Decorators
  Authorize,
  AuthorizeResource,
  RequireRole,
  Public,

  // Pre-built Resource Decorators
  AuthorizeAvatar,
  AuthorizeSubscription,
  AuthorizeChat,
  AuthorizePayout,
  AuthorizeNotification,

  // Agentic Decorators
  AuthorizeWithExplanation,
  AnomalyProtected,
  AuditAction,

  // Parameter Decorators
  AuthzExplanation,
  AnomalyScore,
  AuthzFactors,
  AuthzConfidence,

  // Types
  AuthzMetadata,
  AgenticAuthzMetadata,
  AnomalyProtectionOptions,
  AuditActionOptions,
  AuthzFactor,

  // Metadata Keys
  AUTHZ_METADATA_KEY,
  AUTHZ_EXPLANATION_KEY,
  ANOMALY_PROTECTED_KEY,
  AUDIT_ACTION_KEY,
  ROLES_METADATA_KEY,
  IS_PUBLIC_KEY,
};
```

---

## 5. Usage Examples

### 5.1 Module Setup

```typescript
// app.module.ts
import { AuthzModule } from '@authz-engine/nestjs';

@Module({
  imports: [
    AuthzModule.forRoot({
      serverUrl: 'http://authz-engine:3592',
    }),
  ],
})
export class AppModule {}
```

### 5.2 Async Configuration

```typescript
// Using ConfigService
AuthzModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    serverUrl: config.get('AUTHZ_SERVER_URL'),
    timeout: config.get('AUTHZ_TIMEOUT', 5000),
  }),
}),
```

### 5.3 Standard Authorization

```typescript
@Controller('subscriptions')
export class SubscriptionController {
  @Authorize({ resource: 'subscription', action: 'create' })
  @Post()
  async create(@Body() dto: CreateSubscriptionDto) {
    // Only executes if authorized
  }

  @Authorize({
    resource: 'subscription',
    action: 'delete',
    resourceIdParam: 'id',
  })
  @Delete(':id')
  async delete(@Param('id') id: string) {
    // Checks authorization for specific subscription
  }
}
```

### 5.4 Agentic Authorization

```typescript
@Controller('payments')
export class PaymentController {
  // With explanation
  @AuthorizeWithExplanation({
    resource: 'payment',
    action: 'create',
  })
  @Post()
  async createPayment(
    @Body() dto: CreatePaymentDto,
    @AuthzExplanation() explanation: string,
    @AnomalyScore() anomalyScore: number,
  ) {
    // Access explanation and anomaly score
    console.log(`Authorized with explanation: ${explanation}`);
    console.log(`Anomaly score: ${anomalyScore}`);
  }

  // With anomaly protection
  @AnomalyProtected({ maxAnomalyScore: 0.7, onAnomaly: 'block' })
  @Authorize({ resource: 'transfer', action: 'create' })
  @Post('transfer')
  async transfer(@Body() dto: TransferDto) {
    // Blocked if anomaly score > 0.7
  }

  // With audit logging
  @AuditAction({ actionName: 'high_value_transfer' })
  @Authorize({ resource: 'transfer', action: 'create' })
  @Post('large-transfer')
  async largeTransfer(@Body() dto: LargeTransferDto) {
    // Action logged for analyst learning
  }
}
```

### 5.5 GraphQL Usage

```typescript
@Resolver('Document')
export class DocumentResolver {
  @Authorize({ resource: 'document', action: 'read' })
  @Query()
  async document(@Args('id') id: string) {
    // Guards work with GraphQL resolvers
  }

  @AuthorizeWithExplanation({
    resource: 'document',
    action: 'delete',
    includeExplanation: true,
  })
  @Mutation()
  async deleteDocument(@Args('id') id: string) {
    // With agentic features
  }
}
```

---

## 6. Error Handling

### 6.1 Exception Types

| Scenario | Exception | Status Code |
|----------|-----------|-------------|
| No user | `UnauthorizedException` | 401 |
| Not allowed | `ForbiddenException` | 403 |
| Anomaly blocked | `ForbiddenException` | 403 |
| Service error | `InternalServerErrorException` | 500 |

### 6.2 Custom Error Messages

```typescript
// Standard denial
throw new ForbiddenException(
  `Not authorized to ${action} ${resource}`
);

// With explanation
throw new ForbiddenException(
  `Not authorized: ${explanation}`
);

// Anomaly block
throw new ForbiddenException(
  `Request blocked due to anomalous behavior (score: ${score.toFixed(2)})`
);
```

---

## 7. Testing

### 7.1 Unit Testing

```typescript
describe('AuthzGuard', () => {
  let guard: AuthzGuard;
  let mockAuthzService: jest.Mocked<AuthzService>;

  beforeEach(async () => {
    mockAuthzService = {
      isAllowed: jest.fn(),
      checkWithAgents: jest.fn(),
      createPrincipal: jest.fn(),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        AuthzGuard,
        { provide: AuthzService, useValue: mockAuthzService },
        { provide: Reflector, useValue: new Reflector() },
      ],
    }).compile();

    guard = module.get(AuthzGuard);
  });

  it('should allow when authorized', async () => {
    mockAuthzService.isAllowed.mockResolvedValue(true);
    // ... test implementation
  });
});
```

### 7.2 Integration Testing

```typescript
describe('Subscription (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [
        AuthzModule.forRoot({
          serverUrl: 'http://localhost:3592',
        }),
        SubscriptionModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('should deny unauthorized access', () => {
    return request(app.getHttpServer())
      .post('/subscriptions')
      .expect(403);
  });
});
```

---

## 8. Dependencies

### 8.1 Runtime Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `@authz-engine/sdk` | workspace:* | SDK client |
| `@nestjs/common` | ^10.0.0 | NestJS core |
| `@nestjs/core` | ^10.0.0 | NestJS core |

### 8.2 Peer Dependencies

| Dependency | Version |
|------------|---------|
| `@nestjs/common` | ^10.0.0 |
| `@nestjs/core` | ^10.0.0 |
| `reflect-metadata` | ^0.1.13 |

---

## 9. Performance Considerations

1. **Guard Caching**: Metadata reflection is cached by NestJS
2. **Connection Reuse**: SDK client reused across requests
3. **Async Guards**: Non-blocking authorization checks
4. **Early Return**: No auth check if no metadata

---

## 10. Security Considerations

1. **User Extraction**: Always validate `user.id` exists
2. **Default Deny**: If no policy matches, deny
3. **Fail Closed**: Errors result in denial
4. **Logging**: High anomaly scores logged
5. **Audit Trail**: Actions logged for analysis

---

## 11. Related Documents

- [SDK-PACKAGE-SDD.md](./SDK-PACKAGE-SDD.md)
- [AGENTS-PACKAGE-SDD.md](./AGENTS-PACKAGE-SDD.md)
- [ADR-005: Agentic Authorization](../adr/ADR-005-AGENTIC-AUTHORIZATION.md)

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-11-23 | Initial release with standard and agentic decorators |
