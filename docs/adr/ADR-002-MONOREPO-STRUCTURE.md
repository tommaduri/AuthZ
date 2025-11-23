# ADR-002: Monorepo Structure with pnpm/Turbo

**Status**: Accepted
**Date**: 2024-11-23
**Deciders**: AuthZ Engine Team
**Technical Story**: Project structure and build tooling

---

## Context

The AuthZ Engine consists of multiple packages that need to work together:
- `@authz-engine/core` - Policy engine core
- `@authz-engine/agents` - Agentic authorization
- `@authz-engine/server` - REST/gRPC server
- `@authz-engine/sdk` - TypeScript client SDK
- `@authz-engine/nestjs` - NestJS integration

We needed to decide on:
1. Monorepo vs multi-repo
2. Package manager
3. Build orchestration

## Decision

We chose a **monorepo structure** using:
- **pnpm** for package management (workspace protocol)
- **Turborepo** for build orchestration and caching
- **TypeScript project references** for incremental builds

### Directory Structure
```
authz-engine/
├── packages/
│   ├── core/           # @authz-engine/core
│   ├── agents/         # @authz-engine/agents
│   ├── server/         # @authz-engine/server
│   ├── sdk-typescript/ # @authz-engine/sdk
│   └── nestjs/         # @authz-engine/nestjs
├── docs/               # Documentation
├── pnpm-workspace.yaml # Workspace config
├── turbo.json          # Turbo config
└── tsconfig.base.json  # Shared TS config
```

### Package Dependencies
```
core (0 deps)
  ↓
agents (depends on core)
sdk (depends on core)
  ↓
server (depends on core, agents)
nestjs (depends on sdk)
```

### Configuration Files

**pnpm-workspace.yaml**:
```yaml
packages:
  - 'packages/*'
```

**turbo.json**:
```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    }
  }
}
```

## Consequences

### Positive
- **Atomic Changes**: Related changes across packages in single commit
- **Shared Configuration**: Common tsconfig, eslint, prettier
- **Dependency Management**: `workspace:*` ensures consistent versions
- **Build Caching**: Turborepo caches unchanged packages
- **Simplified CI/CD**: Single pipeline for all packages

### Negative
- **Larger Clone Size**: All packages cloned even if only one needed
- **pnpm Learning Curve**: Different from npm/yarn
- **Lock File Conflicts**: Merge conflicts in pnpm-lock.yaml

### Neutral
- Publishing requires coordination (all packages versioned together)
- IDE indexing covers entire monorepo

## Alternatives Considered

| Alternative | Pros | Cons | Why Not Chosen |
|-------------|------|------|----------------|
| **Multi-repo** | Independent versioning | Cross-repo changes painful, version sync issues | Packages are tightly coupled |
| **npm workspaces** | More familiar | Slower, no build caching | pnpm faster, better disk usage |
| **yarn workspaces** | Mature, plug'n'play | Slower than pnpm | pnpm more efficient |
| **Nx** | More features | Heavier, steeper learning curve | Turbo simpler for our needs |
| **Lerna** | Well-known | Deprecated patterns, slower | Turborepo is the modern choice |

## Implementation Notes

### Workspace Protocol
Internal dependencies use `workspace:*`:
```json
{
  "dependencies": {
    "@authz-engine/core": "workspace:*"
  }
}
```

### Build Order
Turborepo automatically determines build order from dependencies:
1. `@authz-engine/core`
2. `@authz-engine/agents`, `@authz-engine/sdk` (parallel)
3. `@authz-engine/server`, `@authz-engine/nestjs` (parallel)

### TypeScript Configuration
Each package extends base config:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### Commands
```bash
# Install all dependencies
pnpm install

# Build all packages (with caching)
pnpm run build

# Build specific package
pnpm --filter @authz-engine/core run build

# Run tests
pnpm run test
```

## Related ADRs
- None

## References
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
