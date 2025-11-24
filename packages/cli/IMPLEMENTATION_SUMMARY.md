# CLI Implementation Summary

This document provides an overview of the AuthZ Engine CLI implementation, including architecture, commands, and usage patterns.

## Package Overview

**Name:** @authz-engine/cli
**Version:** 0.1.0
**Description:** Command-line interface for policy management and testing
**Location:** `/packages/cli/`

## Project Structure

```
packages/cli/
├── src/                          # Source TypeScript files
│   ├── index.ts                  # Main CLI entry point
│   └── commands/                 # Command implementations
│       ├── check.ts              # Authorization check command
│       ├── policy.ts             # Policy management commands
│       ├── server.ts             # Server management commands
│       └── test.ts               # Test execution command
├── tests/                        # Test files
│   ├── commands.check.test.ts    # Check command tests
│   ├── commands.policy.test.ts   # Policy command tests
│   ├── commands.server.test.ts   # Server command tests
│   └── commands.test.test.ts     # Test command tests
├── examples/                     # Example files
│   ├── authorization.yaml        # Example test cases
│   ├── policy.yaml              # Example policy
│   └── fixtures.yaml            # Example test fixtures
├── dist/                        # Compiled JavaScript (generated)
├── package.json                 # Package configuration
├── tsconfig.json                # TypeScript configuration
├── vitest.config.ts             # Vitest configuration
├── .eslintrc.json              # ESLint configuration
├── README.md                    # User documentation
├── INSTALLATION.md              # Installation guide
└── IMPLEMENTATION_SUMMARY.md    # This file
```

## Core Components

### 1. Main Entry Point (src/index.ts)

- **Purpose:** Initialize and register all CLI commands
- **Features:**
  - Program initialization with version and description
  - Command registration for check, policy, server, and test
  - Global error handling for invalid commands
  - Help display for no-argument invocation

### 2. Check Command (src/commands/check.ts)

- **Purpose:** Evaluate authorization decisions
- **Functionality:**
  - Accepts principal, resource, and action parameters
  - Optional policy file specification
  - Evaluates decisions using DecisionEngine
  - Supports JSON and verbose output modes
  - Returns appropriate exit codes

**Key Features:**
- Context-based evaluation
- Explanation output
- Metadata inclusion
- Configurable output formatting

### 3. Policy Command (src/commands/policy.ts)

- **Purpose:** Manage and validate authorization policies
- **Subcommands:**

#### policy lint
- Validates policy syntax and semantics
- Detects missing required fields
- Checks effect values
- Validates rule structure
- Optional strict mode for additional checks

**Issues Detected:**
- Parse errors
- Missing policy name
- Missing rules
- Invalid rule effects
- Missing principal/action/resource declarations
- Version format issues
- Missing descriptions (strict mode)

#### policy validate
- Validates against policy schema
- Supports custom schema files
- Comprehensive validation reporting

#### policy test
- Runs test fixtures against policies
- Requires fixture file specification
- Test case execution and reporting

### 4. Server Command (src/commands/server.ts)

- **Purpose:** Manage authorization server
- **Subcommands:**

#### server status
- Checks current server status
- Displays host, port, and status information
- Shows version and uptime
- Optional JSON output

#### server health
- Performs health check via HTTP
- Tests server connectivity
- Reports HTTP status codes
- Handles timeouts gracefully

#### server reload
- Reloads server configuration
- Communicates with running server
- Provides success/failure reporting

### 5. Test Command (src/commands/test.ts)

- **Purpose:** Execute authorization tests from YAML/JSON files
- **Features:**
  - Supports YAML and JSON test file formats
  - Evaluates each test case through DecisionEngine
  - Tracks pass/fail status and duration
  - Comprehensive result reporting
  - Verbose mode with failure details

**Test Case Structure:**
```yaml
name: Test name
principal: principal:id
resource: resource:id
action: action_name
expected: boolean
description: Optional description
```

**Results Include:**
- Test name
- Expected vs actual results
- Pass/fail status
- Execution duration
- Summary statistics

## Dependencies

### Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@authz-engine/core` | workspace:* | Core policy engine integration |
| `@authz-engine/server` | workspace:* | Server integration |
| `commander` | ^11.1.0 | CLI argument parsing |
| `chalk` | ^5.3.0 | Terminal color output |
| `ora` | ^8.0.1 | Loading spinner animations |
| `yaml` | ^2.3.4 | YAML file parsing |
| `table` | ^6.8.1 | Terminal table formatting |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@types/node` | ^20.10.0 | Node.js type definitions |
| `typescript` | ^5.3.0 | TypeScript compiler |
| `tsx` | ^4.6.0 | TypeScript execution |
| `vitest` | ^1.0.0 | Test framework |

## Build Configuration

### TypeScript Compilation

**Configuration:** `tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Features:**
- Extends base configuration
- Generates declaration files
- Includes source maps for debugging
- ES2022 target with ESNext modules

### Test Configuration

**Configuration:** `vitest.config.ts`

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html']
    }
  }
});
```

## Command Reference

### authz check

Evaluate authorization decisions.

```bash
authz check \
  --principal <id> \
  --resource <id> \
  --action <action> \
  [--policy <file>] \
  [--json] \
  [--verbose]
```

**Options:**
- `-p, --principal` (required) - Principal identifier
- `-r, --resource` (required) - Resource identifier
- `-a, --action` (required) - Action to perform
- `--policy` (optional) - Policy file path
- `-j, --json` - JSON output format
- `-v, --verbose` - Verbose output with explanations

**Exit Codes:**
- 0: Success (allowed)
- 1: Error
- 2: Access denied

### authz policy

Manage authorization policies.

#### authz policy lint

```bash
authz policy lint <file> [--json] [--strict]
```

#### authz policy validate

```bash
authz policy validate <file> [--json] [--schema <path>]
```

#### authz policy test

```bash
authz policy test <file> --fixtures <path> [--json]
```

### authz server

Manage authorization server.

#### authz server status

```bash
authz server status [--host <host>] [--port <port>] [--json]
```

#### authz server health

```bash
authz server health [--host <host>] [--port <port>] [--json]
```

#### authz server reload

```bash
authz server reload [--host <host>] [--port <port>] [--json]
```

### authz test

Execute authorization tests.

```bash
authz test <file> [--json] [--verbose] [--bail]
```

**Options:**
- `-j, --json` - JSON output
- `-v, --verbose` - Verbose output
- `-b, --bail` - Stop on first failure

## Test Files

### Authorization Tests (examples/authorization.yaml)

Example test cases for authorization decisions:

```yaml
- name: Admin can read documents
  principal: user:alice
  resource: document:123
  action: read
  expected: true

- name: Regular user cannot delete
  principal: user:bob
  resource: document:123
  action: delete
  expected: false
```

### Policy Example (examples/policy.yaml)

Example authorization policy with multiple rules:

```yaml
name: Document Access Policy
version: 1.0.0
rules:
  - name: Allow admin operations
    effect: allow
    principal: user:alice
    action: [read, write, delete]
    resource: document:*
```

### Test Fixtures (examples/fixtures.yaml)

Sample fixtures for policy testing:

```yaml
fixtures:
  - name: Admin user
    principal: user:alice
    roles: [admin]
    attributes:
      department: engineering
```

## Testing

### Unit Tests

Located in `tests/` directory with comprehensive coverage:

- **commands.check.test.ts** - Check command evaluation tests
- **commands.policy.test.ts** - Policy validation tests
- **commands.server.test.ts** - Server communication tests
- **commands.test.test.ts** - Test execution tests

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

## Installation

### From Root Directory

```bash
# Install all dependencies
npm install

# Build all packages
npm run build

# Build just CLI
npm run build --filter @authz-engine/cli
```

### Global Installation

```bash
cd packages/cli
npm install -g .
```

See [INSTALLATION.md](./INSTALLATION.md) for detailed instructions.

## Usage Examples

### Check Authorization

```bash
# Simple authorization check
authz check \
  --principal user:alice \
  --resource document:123 \
  --action read

# With JSON output
authz check \
  --principal user:alice \
  --resource document:123 \
  --action read \
  --json | jq .

# With verbose explanation
authz check \
  --principal user:alice \
  --resource document:123 \
  --action read \
  --verbose
```

### Lint Policy

```bash
# Basic linting
authz policy lint policies/auth.json

# Strict mode
authz policy lint policies/auth.yaml --strict

# JSON output
authz policy lint policies/auth.json --json
```

### Run Tests

```bash
# Execute tests
authz test tests/authorization.yaml

# Verbose output
authz test tests/authorization.yaml --verbose

# JSON output
authz test tests/authorization.json --json
```

### Check Server

```bash
# Server status
authz server status

# Server health
authz server health

# Specific host/port
authz server status --host api.example.com --port 8080
```

## Error Handling

### Check Command Errors

- Invalid principal/resource format
- Missing required parameters
- Policy file not found
- Invalid policy JSON

### Policy Command Errors

- File not found
- Parse errors (JSON/YAML)
- Validation failures
- Schema mismatches

### Server Command Errors

- Connection refused
- Request timeout
- Invalid host/port
- HTTP errors

### Test Command Errors

- Test file not found
- Invalid test format
- Parse errors
- Evaluation exceptions

## Performance Considerations

### Check Command
- Minimal overhead (< 50ms for local evaluation)
- Leverages DecisionEngine caching
- Fast policy loading from files

### Policy Linting
- Linear time complexity relative to rule count
- Efficient field validation
- Regex-based version checking

### Test Execution
- Parallel test evaluation potential
- Duration tracking per test
- Summary statistics aggregation

## Future Enhancements

Potential improvements for future versions:

1. **Batch Operations**
   - Multiple authorization checks in one command
   - Bulk policy testing

2. **Output Formatting**
   - CSV export for test results
   - HTML report generation
   - JUnit XML output

3. **Interactive Mode**
   - REPL for policy testing
   - Interactive policy creation wizard

4. **Advanced Features**
   - Policy diffing
   - Policy versioning
   - Audit logging
   - Performance profiling

5. **Integration**
   - GitHub Actions integration
   - CI/CD pipeline hooks
   - Webhook support for server events

## File Sizes

```
Source Files:
- src/index.ts: ~330 lines
- src/commands/check.ts: ~95 lines
- src/commands/policy.ts: ~330 lines
- src/commands/server.ts: ~190 lines
- src/commands/test.ts: ~240 lines

Test Files:
- commands.check.test.ts: ~65 lines
- commands.policy.test.ts: ~65 lines
- commands.server.test.ts: ~65 lines
- commands.test.test.ts: ~65 lines

Documentation:
- README.md: ~450 lines
- INSTALLATION.md: ~150 lines
```

## Maintenance Notes

### Key Considerations

1. **Dependency Management**
   - Keep Commander, chalk, and ora updated
   - Monitor @authz-engine/* workspace dependencies

2. **Type Safety**
   - Strict TypeScript configuration
   - Full type coverage for all commands
   - Comprehensive error type handling

3. **Code Quality**
   - ESLint configuration enforced
   - Test coverage goals: 80%+
   - Consistent formatting with Prettier

4. **Documentation**
   - Keep README.md in sync with features
   - Update INSTALLATION.md for new dependencies
   - Add examples for new commands

## Related Files

### Core Package
- `/packages/core/` - Policy engine implementation
- `/packages/core/src/` - Core logic

### Server Package
- `/packages/server/` - Server implementation
- `/packages/server/src/` - Server logic

### Monorepo Configuration
- `turbo.json` - Build pipeline
- `tsconfig.base.json` - TypeScript base config
- `.eslintrc.json` - Linting rules
