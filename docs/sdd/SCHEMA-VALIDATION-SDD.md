# Schema Validation - Software Design Document

**Module**: `@authz-engine/core`
**Version**: 1.0.0
**Status**: Draft
**Author**: AuthZ Engine Team
**Created**: 2024-11-23
**Last Updated**: 2024-11-23
**Reviewers**: TBD

---

## 1. Overview

### 1.1 Purpose

Schema validation ensures that principal and resource attributes conform to expected shapes. This provides:
- **Compile-time validation**: Catch policy errors before deployment
- **Runtime validation**: Validate incoming authorization requests against defined schemas
- **Type safety**: Enable IDE autocompletion and type checking for policy authors

### 1.2 Scope

**In Scope:**
- JSON Schema compatible schema definitions
- Principal and resource attribute validation
- Schema registry for centralized management
- Multiple validation modes (strict, warn, none)
- Integration with policy definitions
- Validation error reporting with actionable messages

**Out of Scope:**
- Schema migration tooling
- Schema versioning and deprecation workflows
- GraphQL schema integration
- Custom schema formats (non-JSON Schema)

### 1.3 Context

Schema validation sits between policy parsing and decision execution in the AuthZ Engine pipeline:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AuthZ Engine Pipeline                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────┐│
│  │ Policy   │───►│   Schema     │───►│  CEL         │───►│Decision││
│  │ Parser   │    │  Validator   │    │  Evaluator   │    │ Engine ││
│  └──────────┘    └──────────────┘    └──────────────┘    └────────┘│
│       │                 │                                           │
│       │          ┌──────┴───────┐                                   │
│       │          │   Schema     │                                   │
│       └─────────►│   Registry   │◄──────── Schema Files             │
│                  └──────────────┘                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.4 Key Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| JSON Schema draft-07 | Industry standard, excellent tooling support | Zod, Yup (TypeScript-only) |
| Schema registry pattern | Centralized management, reusable definitions | Inline schemas only |
| Three validation modes | Flexibility for development vs production | Binary on/off |
| Lazy validation | Performance optimization for high-throughput | Eager validation |

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-001 | Define schemas for principals using JSON Schema | Must Have | Pending |
| FR-002 | Define schemas for resources using JSON Schema | Must Have | Pending |
| FR-003 | Validate policies reference valid schemas at compile time | Must Have | Pending |
| FR-004 | Validate request attributes at runtime | Must Have | Pending |
| FR-005 | Support schema inheritance via $ref | Should Have | Pending |
| FR-006 | Provide human-readable validation error messages | Must Have | Pending |
| FR-007 | Cache compiled schemas for performance | Must Have | Pending |
| FR-008 | Support conditional schema validation per action | Should Have | Pending |
| FR-009 | Allow schema bypass for specific actions | Should Have | Pending |
| FR-010 | Validate response/output schemas (optional) | Could Have | Pending |

### 2.2 Non-Functional Requirements

| ID | Category | Requirement | Target |
|----|----------|-------------|--------|
| NFR-001 | Performance | Schema compilation time | < 50ms per schema |
| NFR-002 | Performance | Runtime validation time | < 1ms per request |
| NFR-003 | Performance | Schema cache hit rate | > 99% |
| NFR-004 | Memory | Schema registry memory footprint | < 10MB for 100 schemas |
| NFR-005 | Reliability | Schema parsing error rate | 0% for valid schemas |
| NFR-006 | Usability | Error message clarity score | Actionable in 90% cases |

---

## 3. Architecture

### 3.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Schema Validation System                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────┐         ┌─────────────────────────────────┐│
│  │   Schema Loader     │         │        Schema Registry          ││
│  │  ┌───────────────┐  │         │  ┌────────────────────────────┐ ││
│  │  │ YAML Parser   │  │────────►│  │  Principal Schemas         │ ││
│  │  ├───────────────┤  │         │  │  - user                    │ ││
│  │  │ JSON Parser   │  │         │  │  - service                 │ ││
│  │  ├───────────────┤  │         │  │  - api-key                 │ ││
│  │  │ $ref Resolver │  │         │  ├────────────────────────────┤ ││
│  │  └───────────────┘  │         │  │  Resource Schemas          │ ││
│  └─────────────────────┘         │  │  - document                │ ││
│                                  │  │  - subscription            │ ││
│  ┌─────────────────────┐         │  │  - avatar                  │ ││
│  │  Schema Compiler    │         │  └────────────────────────────┘ ││
│  │  ┌───────────────┐  │         └─────────────────────────────────┘│
│  │  │ AJV Instance  │  │                        │                   │
│  │  ├───────────────┤  │                        ▼                   │
│  │  │ Format Checks │  │         ┌─────────────────────────────────┐│
│  │  ├───────────────┤  │         │       Schema Validator          ││
│  │  │ Compiled Cache│  │────────►│  ┌────────────────────────────┐ ││
│  │  └───────────────┘  │         │  │ validatePrincipal()        │ ││
│  └─────────────────────┘         │  │ validateResource()         │ ││
│                                  │  │ validatePolicy()           │ ││
│  ┌─────────────────────┐         │  │ getValidationErrors()      │ ││
│  │ Validation Config   │────────►│  └────────────────────────────┘ ││
│  │  - mode: strict     │         └─────────────────────────────────┘│
│  │  - schemas: {...}   │                                            │
│  └─────────────────────┘                                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| Schema Loader | Parse YAML/JSON schema files, resolve $ref references |
| Schema Compiler | Compile JSON Schemas to efficient validators using AJV |
| Schema Registry | Store and retrieve compiled schemas by reference |
| Schema Validator | Execute validation against requests and policies |
| Validation Config | Configure validation behavior (mode, schema mappings) |

### 3.3 Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Validation Pipeline Flow                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. COMPILE-TIME VALIDATION                                          │
│                                                                      │
│     Policy File ──► Parse ──► Extract Schema Refs ──► Validate Refs │
│                                      │                      │        │
│                                      ▼                      ▼        │
│                               Schema Registry         Error Report   │
│                                                                      │
│  2. RUNTIME VALIDATION                                               │
│                                                                      │
│     CheckRequest ──► Extract Principal ──► Validate Principal       │
│          │                                       │                   │
│          ▼                                       ▼                   │
│     Extract Resource ──► Validate Resource ──► Continue/Reject      │
│                                                                      │
│  3. VALIDATION MODE HANDLING                                         │
│                                                                      │
│     ┌─────────┐     ┌─────────┐     ┌─────────┐                     │
│     │ strict  │     │  warn   │     │  none   │                     │
│     │ ─────── │     │ ─────── │     │ ─────── │                     │
│     │ Reject  │     │ Log +   │     │ Skip    │                     │
│     │ Request │     │ Continue│     │ All     │                     │
│     └─────────┘     └─────────┘     └─────────┘                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.4 Integration Points

| Integration | Protocol | Direction |
|-------------|----------|-----------|
| Policy Parser | Internal API | In |
| Decision Engine | Internal API | Out |
| File System | YAML/JSON files | In |
| Logging Service | Structured logs | Out |

---

## 4. Component Design

### 4.1 Schema Definition Format

Schema definitions follow the Cerbos-compatible YAML format:

```yaml
apiVersion: authz.engine/v1
kind: PrincipalSchema
metadata:
  name: user-schema
  description: Schema for user principals
spec:
  definitions:
    user:
      type: object
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
        roles:
          type: array
          items:
            type: string
          minItems: 1
        department:
          type: string
          enum: [engineering, sales, hr, finance, legal, executive]
        clearanceLevel:
          type: integer
          minimum: 1
          maximum: 10
        attributes:
          type: object
          additionalProperties: true
      required: [id, email, roles]
```

```yaml
apiVersion: authz.engine/v1
kind: ResourceSchema
metadata:
  name: document-schema
  description: Schema for document resources
spec:
  definitions:
    document:
      type: object
      properties:
        owner:
          type: string
          format: uuid
        department:
          type: string
          enum: [engineering, sales, hr, finance]
        confidentiality:
          type: string
          enum: [public, internal, confidential, restricted]
        tags:
          type: array
          items:
            type: string
          maxItems: 20
        createdAt:
          type: string
          format: date-time
        metadata:
          type: object
          additionalProperties: true
      required: [owner, department]
```

### 4.2 Policy Schema Integration

Policies reference schemas for validation enforcement:

```yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  version: "default"
  schemas:
    principalSchema:
      ref: authz.engine/v1/Principal#user
    resourceSchema:
      ref: authz.engine/v1/Resource#document
      ignoreWhen:
        actions: ["create", "list"]  # Skip validation for these actions
  rules:
    - name: owner-full-access
      actions: ["read", "write", "delete"]
      effect: EFFECT_ALLOW
      condition:
        match:
          expr: "R.attr.owner == P.id"
```

### 4.3 Validation Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `strict` | Reject requests failing validation with 400 error | Production environments |
| `warn` | Log validation failures, continue processing | Migration/testing |
| `none` | Skip all schema validation | Development, legacy systems |

---

## 5. Interfaces

### 5.1 Type Definitions

```typescript
/**
 * Schema definition following Cerbos-compatible format
 */
interface SchemaDefinition {
  apiVersion: string;
  kind: 'PrincipalSchema' | 'ResourceSchema';
  metadata: {
    name: string;
    description?: string;
    labels?: Record<string, string>;
  };
  spec: {
    definitions: Record<string, JSONSchema>;
  };
}

/**
 * JSON Schema type (draft-07 compatible)
 */
interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: (string | number | boolean)[];
  format?: 'uuid' | 'email' | 'date-time' | 'uri' | 'hostname' | 'ipv4' | 'ipv6';
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  additionalProperties?: boolean | JSONSchema;
  $ref?: string;
  description?: string;
}

/**
 * Reference to a schema in the registry
 */
interface SchemaRef {
  ref: string;  // Format: "authz.engine/v1/Principal#user"
  ignoreWhen?: {
    actions?: string[];
  };
}

/**
 * Global validation configuration
 */
interface ValidationConfig {
  mode: 'strict' | 'warn' | 'none';
  schemas: {
    principals?: Record<string, SchemaRef>;
    resources?: Record<string, SchemaRef>;
  };
  options?: {
    allErrors?: boolean;        // Collect all errors vs fail-fast
    coerceTypes?: boolean;      // Attempt type coercion
    removeAdditional?: boolean; // Remove properties not in schema
  };
}

/**
 * Result of validation operation
 */
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  metadata?: {
    schemaRef: string;
    validationTimeMs: number;
    cachedSchema: boolean;
  };
}

/**
 * Detailed validation error
 */
interface ValidationError {
  path: string;           // JSONPath to invalid field: "/department"
  message: string;        // Human-readable: "must be one of: engineering, sales, hr, finance"
  schemaPath: string;     // Path in schema: "#/properties/department/enum"
  keyword: string;        // AJV keyword: "enum"
  params?: Record<string, unknown>;  // Additional context
  suggestion?: string;    // Suggested fix
}

/**
 * Validation warning (non-blocking)
 */
interface ValidationWarning {
  path: string;
  message: string;
  code: string;
  severity: 'low' | 'medium' | 'high';
}
```

### 5.2 Public API

```typescript
/**
 * Schema Registry - Manages schema storage and retrieval
 */
interface SchemaRegistry {
  /**
   * Register a schema definition
   * @param schema - Schema definition to register
   * @throws SchemaRegistrationError if schema is invalid
   */
  register(schema: SchemaDefinition): void;

  /**
   * Get a schema by reference
   * @param ref - Schema reference (e.g., "authz.engine/v1/Principal#user")
   * @returns Compiled schema or undefined
   */
  get(ref: string): CompiledSchema | undefined;

  /**
   * Check if schema exists
   * @param ref - Schema reference
   */
  has(ref: string): boolean;

  /**
   * List all registered schemas
   * @param kind - Filter by schema kind
   */
  list(kind?: 'PrincipalSchema' | 'ResourceSchema'): SchemaDefinition[];

  /**
   * Remove a schema from registry
   * @param ref - Schema reference to remove
   */
  unregister(ref: string): boolean;

  /**
   * Clear all schemas (useful for testing)
   */
  clear(): void;
}

/**
 * Schema Validator - Executes validation logic
 */
interface SchemaValidator {
  /**
   * Validate a principal against registered schema
   * @param principal - Principal to validate
   * @param schemaRef - Schema reference (optional if config specifies default)
   */
  validatePrincipal(
    principal: Principal,
    schemaRef?: string
  ): ValidationResult;

  /**
   * Validate a resource against registered schema
   * @param resource - Resource to validate
   * @param schemaRef - Schema reference (optional if config specifies default)
   */
  validateResource(
    resource: Resource,
    schemaRef?: string
  ): ValidationResult;

  /**
   * Validate a complete check request
   * @param request - Authorization check request
   */
  validateRequest(request: CheckRequest): ValidationResult;

  /**
   * Validate policy schema references at compile time
   * @param policy - Policy to validate
   */
  validatePolicy(policy: ResourcePolicy): ValidationResult;

  /**
   * Configure validation behavior
   * @param config - Validation configuration
   */
  configure(config: ValidationConfig): void;

  /**
   * Get current validation mode
   */
  getMode(): 'strict' | 'warn' | 'none';
}

/**
 * Schema Loader - Loads schemas from various sources
 */
interface SchemaLoader {
  /**
   * Load schemas from a directory
   * @param path - Directory path containing schema files
   * @param options - Loading options
   */
  loadFromDirectory(
    path: string,
    options?: { recursive?: boolean; watch?: boolean }
  ): Promise<SchemaDefinition[]>;

  /**
   * Load a single schema file
   * @param filePath - Path to schema file (YAML or JSON)
   */
  loadFromFile(filePath: string): Promise<SchemaDefinition>;

  /**
   * Load schema from string content
   * @param content - YAML or JSON string
   * @param format - Content format
   */
  loadFromString(
    content: string,
    format: 'yaml' | 'json'
  ): SchemaDefinition;
}
```

### 5.3 Factory Functions

```typescript
/**
 * Create a configured schema validator instance
 */
function createSchemaValidator(config?: ValidationConfig): SchemaValidator;

/**
 * Create a schema registry instance
 */
function createSchemaRegistry(): SchemaRegistry;

/**
 * Create a schema loader instance
 */
function createSchemaLoader(registry: SchemaRegistry): SchemaLoader;
```

---

## 6. Data Models

### 6.1 Schema Storage

```typescript
/**
 * Internal compiled schema representation
 */
interface CompiledSchema {
  definition: SchemaDefinition;
  validator: AJV.ValidateFunction;
  compiledAt: Date;
  accessCount: number;
  lastAccessed: Date;
}

/**
 * Schema registry internal storage
 */
interface SchemaStore {
  principals: Map<string, CompiledSchema>;
  resources: Map<string, CompiledSchema>;
  metadata: {
    totalSchemas: number;
    cacheHits: number;
    cacheMisses: number;
    lastUpdated: Date;
  };
}
```

### 6.2 Validation Context

```typescript
/**
 * Context passed through validation pipeline
 */
interface ValidationContext {
  mode: ValidationConfig['mode'];
  currentAction?: string;
  policyRef?: string;
  skipActions?: string[];
  errors: ValidationError[];
  warnings: ValidationWarning[];
  startTime: number;
}
```

---

## 7. Error Handling

### 7.1 Error Types

| Error Code | Name | Description | Recovery |
|------------|------|-------------|----------|
| SCHEMA_001 | SchemaNotFoundError | Referenced schema not in registry | Register schema or fix reference |
| SCHEMA_002 | SchemaParseError | Invalid JSON Schema syntax | Fix schema definition |
| SCHEMA_003 | SchemaCompilationError | AJV failed to compile schema | Check schema for circular refs |
| SCHEMA_004 | ValidationFailedError | Request failed schema validation | Fix request attributes |
| SCHEMA_005 | InvalidRefFormatError | Schema reference format invalid | Use correct ref format |
| SCHEMA_006 | SchemaRegistryFullError | Registry at capacity | Increase limit or remove schemas |

### 7.2 Error Hierarchy

```typescript
class SchemaError extends AuthzError {
  code: string;
  schemaRef?: string;
  context: Record<string, unknown>;
}

class SchemaNotFoundError extends SchemaError {
  constructor(ref: string) {
    super(`Schema not found: ${ref}`);
    this.code = 'SCHEMA_001';
    this.schemaRef = ref;
  }
}

class SchemaParseError extends SchemaError {
  parseErrors: string[];
  constructor(message: string, errors: string[]) {
    super(message);
    this.code = 'SCHEMA_002';
    this.parseErrors = errors;
  }
}

class ValidationFailedError extends SchemaError {
  validationResult: ValidationResult;
  constructor(result: ValidationResult) {
    super('Schema validation failed');
    this.code = 'SCHEMA_004';
    this.validationResult = result;
  }
}
```

### 7.3 Error Response Format

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Request validation failed",
  "details": {
    "errors": [
      {
        "path": "/resource/attr/department",
        "message": "must be one of: engineering, sales, hr, finance",
        "schemaPath": "#/properties/department/enum",
        "keyword": "enum",
        "params": {
          "allowedValues": ["engineering", "sales", "hr", "finance"]
        },
        "suggestion": "Change department value to one of the allowed values"
      }
    ],
    "schemaRef": "authz.engine/v1/Resource#document",
    "validationTimeMs": 0.42
  }
}
```

### 7.4 Error Logging

| Level | What Gets Logged |
|-------|------------------|
| ERROR | Validation failures in strict mode |
| WARN | Validation failures in warn mode, schema compilation issues |
| INFO | Schema registration, configuration changes |
| DEBUG | Validation execution details, cache operations |

---

## 8. Security Considerations

### 8.1 Input Validation

- All schema definitions validated before registration
- Schema size limits enforced (default: 100KB per schema)
- Maximum schema depth enforced (default: 10 levels)
- Regular expression patterns validated for ReDoS vulnerabilities

### 8.2 Schema Injection Prevention

```typescript
// NEVER allow schemas from untrusted sources without sanitization
const sanitizeSchema = (schema: unknown): SchemaDefinition => {
  // Remove $comment fields that could contain injection
  // Validate $ref points only to registered schemas
  // Strip executable code patterns
};
```

### 8.3 Resource Protection

- Schema compilation isolated from main thread for large schemas
- Memory limits on AJV instance
- Timeout on validation operations (default: 100ms)

---

## 9. Performance Requirements

### 9.1 Latency Targets

| Operation | Target | Threshold |
|-----------|--------|-----------|
| Schema compilation | < 50ms | 100ms |
| Single validation | < 1ms | 5ms |
| Batch validation (100 items) | < 50ms | 100ms |
| Schema lookup (cached) | < 0.1ms | 0.5ms |

### 9.2 Throughput Targets

| Metric | Target |
|--------|--------|
| Validations per second | > 50,000 |
| Concurrent schema registrations | > 100 |
| Schema cache capacity | 1,000 schemas |

### 9.3 Optimization Strategies

```typescript
// 1. Pre-compile schemas at startup
const compiledSchemas = new Map<string, ValidateFunction>();

// 2. Lazy compilation with caching
function getOrCompileSchema(ref: string): ValidateFunction {
  if (!compiledSchemas.has(ref)) {
    const schema = registry.get(ref);
    compiledSchemas.set(ref, ajv.compile(schema));
  }
  return compiledSchemas.get(ref)!;
}

// 3. Partial validation for known-good paths
function validateWithSkipList(
  data: unknown,
  schema: JSONSchema,
  skipPaths: string[]
): ValidationResult {
  // Skip validation for paths in skipPaths
}

// 4. Schema warmup during server startup
async function warmupSchemas(refs: string[]): Promise<void> {
  await Promise.all(refs.map(ref => getOrCompileSchema(ref)));
}
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Component | Coverage Target | Test File |
|-----------|-----------------|-----------|
| SchemaRegistry | 95% | `schema-registry.test.ts` |
| SchemaValidator | 95% | `schema-validator.test.ts` |
| SchemaLoader | 90% | `schema-loader.test.ts` |
| Error Classes | 100% | `schema-errors.test.ts` |

### 10.2 Integration Tests

| Scenario | Components Involved | Test File |
|----------|---------------------|-----------|
| Policy with schemas | Parser + Registry + Validator | `policy-schema.integration.test.ts` |
| Request validation | Validator + DecisionEngine | `request-validation.integration.test.ts` |
| Schema hot reload | Loader + Registry + Watcher | `schema-reload.integration.test.ts` |

### 10.3 Test Fixtures

```typescript
// test/fixtures/schemas/valid-principal.yaml
const validPrincipalSchema: SchemaDefinition = {
  apiVersion: 'authz.engine/v1',
  kind: 'PrincipalSchema',
  metadata: { name: 'test-user' },
  spec: {
    definitions: {
      user: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
        },
        required: ['id'],
      },
    },
  },
};

// test/fixtures/requests/invalid-request.json
const invalidRequest = {
  principal: { id: 'not-a-uuid', email: 'invalid-email' },
  resource: { kind: 'document', attr: { department: 'invalid' } },
};
```

### 10.4 Performance Tests

| Test | Target | Current |
|------|--------|---------|
| Schema compilation (simple) | < 10ms | TBD |
| Schema compilation (complex) | < 50ms | TBD |
| Validation throughput | > 50k/s | TBD |
| Memory per 100 schemas | < 10MB | TBD |

---

## 11. Dependencies

### 11.1 External Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `ajv` | ^8.12.0 | JSON Schema validation |
| `ajv-formats` | ^2.1.1 | Format validation (email, uuid, etc.) |
| `yaml` | ^2.3.0 | YAML parsing |
| `chokidar` | ^3.5.3 | File watching for hot reload |

### 11.2 Internal Dependencies

| Package | Purpose |
|---------|---------|
| `@authz-engine/core/types` | Policy and request types |
| `@authz-engine/core/errors` | Base error classes |
| `@authz-engine/core/logger` | Structured logging |

---

## 12. Deployment

### 12.1 Configuration

```yaml
# authz-engine.config.yaml
validation:
  mode: strict  # strict | warn | none
  schemas:
    directory: ./schemas
    watch: true
    warmup: true
  options:
    allErrors: true
    coerceTypes: false
    timeout: 100  # ms
    maxSchemaSize: 102400  # bytes
    maxSchemaDepth: 10
```

### 12.2 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTHZ_VALIDATION_MODE` | Validation mode | `strict` |
| `AUTHZ_SCHEMA_DIR` | Schema directory path | `./schemas` |
| `AUTHZ_SCHEMA_WATCH` | Enable hot reload | `true` |
| `AUTHZ_VALIDATION_TIMEOUT` | Validation timeout (ms) | `100` |

### 12.3 Health Checks

```typescript
// Schema validation health check
interface SchemaHealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  schemaCount: number;
  cacheHitRate: number;
  averageValidationTimeMs: number;
  lastSchemaUpdate: Date;
  errors?: string[];
}
```

---

## 13. Appendices

### 13.1 Schema Reference Format

```
authz.engine/v1/{Kind}#{definition}

Examples:
- authz.engine/v1/Principal#user
- authz.engine/v1/Principal#service
- authz.engine/v1/Resource#document
- authz.engine/v1/Resource#subscription
```

### 13.2 Complete Example

```yaml
# schemas/principal-schemas.yaml
apiVersion: authz.engine/v1
kind: PrincipalSchema
metadata:
  name: connex-principals
spec:
  definitions:
    user:
      type: object
      properties:
        id:
          type: string
          format: uuid
        email:
          type: string
          format: email
        roles:
          type: array
          items:
            type: string
            enum: [admin, user, viewer, editor]
        organization:
          type: string
        department:
          type: string
          enum: [engineering, sales, hr, finance, legal]
        clearanceLevel:
          type: integer
          minimum: 1
          maximum: 10
      required: [id, email, roles]

    service:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
        scopes:
          type: array
          items:
            type: string
        trustedOrigin:
          type: string
          format: uri
      required: [id, name, scopes]

---
# schemas/resource-schemas.yaml
apiVersion: authz.engine/v1
kind: ResourceSchema
metadata:
  name: connex-resources
spec:
  definitions:
    document:
      type: object
      properties:
        owner:
          type: string
          format: uuid
        department:
          type: string
          enum: [engineering, sales, hr, finance]
        confidentiality:
          type: string
          enum: [public, internal, confidential, restricted]
        tags:
          type: array
          items:
            type: string
          maxItems: 20
      required: [owner, department]

    subscription:
      type: object
      properties:
        userId:
          type: string
          format: uuid
        planId:
          type: string
        status:
          type: string
          enum: [active, cancelled, expired, trial]
        billingCycle:
          type: string
          enum: [monthly, annual]
      required: [userId, planId, status]

---
# policies/document-policy.yaml
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: document-policy
spec:
  resource: document
  schemas:
    principalSchema:
      ref: authz.engine/v1/Principal#user
    resourceSchema:
      ref: authz.engine/v1/Resource#document
      ignoreWhen:
        actions: ["create"]
  rules:
    - name: owner-access
      actions: ["read", "write", "delete"]
      effect: EFFECT_ALLOW
      condition:
        match:
          expr: "R.attr.owner == P.id"
    - name: department-read
      actions: ["read"]
      effect: EFFECT_ALLOW
      roles: ["user"]
      condition:
        match:
          expr: "P.attr.department == R.attr.department"
```

### 13.3 Migration Guide

For existing policies without schemas:

1. Set validation mode to `warn` initially
2. Monitor logs for validation failures
3. Create schemas based on actual attribute patterns
4. Register schemas and update policies with references
5. Switch to `strict` mode once all policies have valid schemas

---

*Document generated following AuthZ Engine SDD Framework v1.0.0*
