# Software Design Document: Policy Testing Framework

**Version**: 1.0.0
**Package**: `@authz-engine/testing`
**Status**: Specification (Not Yet Implemented)
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

The Policy Testing Framework provides tools for validating authorization policies before deployment. It enables:
- Compile-time validation of policy syntax and semantics
- Unit testing of individual policy rules
- Integration testing of policy combinations
- CI/CD integration for automated policy validation

### 1.2 Cerbos Compatibility

This implements equivalents to Cerbos's `cerbos compile` and `cerbos run` commands with full test file format compatibility.

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Policy Testing Framework                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Compiler   │  │ Test Runner  │  │   Reporter   │          │
│  │   (Validate) │  │   (Execute)  │  │   (Output)   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌──────────────────────────────────────────────────────┐      │
│  │                    Test Engine                        │      │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │      │
│  │  │ Fixture │  │ Assert  │  │Decision │  │ Output  │ │      │
│  │  │ Loader  │  │ Engine  │  │Evaluator│  │Validator│ │      │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘ │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Test File Discovery

```
policies/
├── document.yaml              # Resource policy
├── document_test.yaml         # Tests for document policy
├── derived_roles.yaml         # Derived roles
├── derived_roles_test.yaml    # Tests for derived roles
└── testdata/
    ├── principals.yaml        # Shared principal fixtures
    ├── resources.yaml         # Shared resource fixtures
    └── auxData.yaml           # Shared auxiliary data
```

---

## 3. Test File Format

### 3.1 Test File Schema

```yaml
# document_test.yaml
name: "Document Policy Tests"
description: "Verify document access control rules"

# Optional: Import fixtures
principals:
  admin:
    id: "admin-001"
    roles: ["admin"]
    attr:
      department: "engineering"

  user:
    id: "user-001"
    roles: ["user"]
    attr:
      department: "engineering"

resources:
  ownedDocument:
    kind: "document"
    id: "doc-001"
    attr:
      owner: "user-001"
      department: "engineering"
      status: "draft"

  otherDocument:
    kind: "document"
    id: "doc-002"
    attr:
      owner: "other-user"
      department: "sales"
      status: "published"

auxData:
  validJwt:
    jwt:
      iss: "https://auth.example.com"
      sub: "user-001"
      aud: ["api"]

# Test cases
tests:
  - name: "Admin can delete any document"
    description: "Admins have full access regardless of ownership"
    input:
      principal: "admin"
      resource: "ownedDocument"
      action: "delete"
    expected:
      effect: "EFFECT_ALLOW"

  - name: "User can edit owned document"
    input:
      principal: "user"
      resource: "ownedDocument"
      action: "edit"
    expected:
      effect: "EFFECT_ALLOW"

  - name: "User cannot delete owned document"
    input:
      principal: "user"
      resource: "ownedDocument"
      action: "delete"
    expected:
      effect: "EFFECT_DENY"

  - name: "User cannot edit other's document"
    input:
      principal: "user"
      resource: "otherDocument"
      action: "edit"
    expected:
      effect: "EFFECT_DENY"

  - name: "Verify output on denial"
    input:
      principal: "user"
      resource: "otherDocument"
      action: "delete"
    expected:
      effect: "EFFECT_DENY"
      outputs:
        - expr: "reason"
          value: "insufficient_permissions"
```

### 3.2 TypeScript Interfaces

```typescript
interface PolicyTestFile {
  /** Test suite name */
  name: string;

  /** Test suite description */
  description?: string;

  /** Principal fixtures */
  principals?: Record<string, PrincipalFixture>;

  /** Resource fixtures */
  resources?: Record<string, ResourceFixture>;

  /** Auxiliary data fixtures */
  auxData?: Record<string, AuxDataFixture>;

  /** Options for test execution */
  options?: TestOptions;

  /** Test cases */
  tests: TestCase[];
}

interface PrincipalFixture {
  id: string;
  roles: string[];
  attr?: Record<string, unknown>;
  policyVersion?: string;
  scope?: string;
}

interface ResourceFixture {
  kind: string;
  id: string;
  attr?: Record<string, unknown>;
  policyVersion?: string;
  scope?: string;
}

interface AuxDataFixture {
  jwt?: {
    iss?: string;
    sub?: string;
    aud?: string | string[];
    [key: string]: unknown;
  };
}

interface TestCase {
  /** Test name (required) */
  name: string;

  /** Test description */
  description?: string;

  /** Skip this test */
  skip?: boolean;

  /** Skip reason */
  skipReason?: string;

  /** Test input */
  input: TestInput;

  /** Expected result */
  expected: ExpectedResult;
}

interface TestInput {
  /** Reference to principal fixture or inline principal */
  principal: string | PrincipalFixture;

  /** Reference to resource fixture or inline resource */
  resource: string | ResourceFixture;

  /** Action to test */
  action: string;

  /** Reference to auxData fixture or inline auxData */
  auxData?: string | AuxDataFixture;
}

interface ExpectedResult {
  /** Expected effect */
  effect: 'EFFECT_ALLOW' | 'EFFECT_DENY';

  /** Expected policy outputs */
  outputs?: ExpectedOutput[];

  /** Expected validation errors */
  validationErrors?: ExpectedValidationError[];
}

interface ExpectedOutput {
  /** Output expression key */
  expr: string;

  /** Expected value */
  value: unknown;
}

interface TestOptions {
  /** Continue on first failure */
  continueOnFailure?: boolean;

  /** Timeout per test in milliseconds */
  timeout?: number;

  /** Enable verbose output */
  verbose?: boolean;
}
```

---

## 4. CLI Commands

### 4.1 Compile Command

```bash
# Validate all policies
npx authz-engine compile ./policies

# Validate specific policy
npx authz-engine compile ./policies/document.yaml

# Output format options
npx authz-engine compile ./policies --format json
npx authz-engine compile ./policies --format text
```

### 4.2 Test Command

```bash
# Run all tests
npx authz-engine test ./policies

# Run specific test file
npx authz-engine test ./policies/document_test.yaml

# Output format options
npx authz-engine test ./policies --format tap
npx authz-engine test ./policies --format json
npx authz-engine test ./policies --format junit

# Verbose mode
npx authz-engine test ./policies --verbose

# Stop on first failure
npx authz-engine test ./policies --bail
```

---

## 5. Component Design

### 5.1 PolicyCompiler

```typescript
interface CompileResult {
  valid: boolean;
  errors: CompileError[];
  warnings: CompileWarning[];
  policies: CompiledPolicy[];
}

interface CompileError {
  type: 'syntax' | 'semantic' | 'reference' | 'duplicate';
  file: string;
  line?: number;
  column?: number;
  message: string;
}

interface CompileWarning {
  type: 'deprecated' | 'unused' | 'shadowed';
  file: string;
  line?: number;
  message: string;
}

class PolicyCompiler {
  /**
   * Compile and validate policies
   */
  compile(paths: string[]): Promise<CompileResult>;

  /**
   * Validate policy syntax
   */
  private validateSyntax(content: string): SyntaxResult;

  /**
   * Validate policy semantics (references, types)
   */
  private validateSemantics(policy: Policy): SemanticResult;

  /**
   * Check for duplicate or conflicting rules
   */
  private checkDuplicates(policies: Policy[]): DuplicateResult;
}
```

### 5.2 TestRunner

```typescript
interface TestResult {
  name: string;
  file: string;
  passed: boolean;
  skipped: boolean;
  error?: string;
  duration: number;
  expected: ExpectedResult;
  actual?: ActualResult;
}

interface TestSuiteResult {
  name: string;
  file: string;
  tests: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

interface TestRunResult {
  suites: TestSuiteResult[];
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  totalDuration: number;
}

class TestRunner {
  constructor(private engine: DecisionEngine);

  /**
   * Run all tests in a directory
   */
  run(testDir: string, options?: RunOptions): Promise<TestRunResult>;

  /**
   * Run a single test file
   */
  runFile(testFile: string, options?: RunOptions): Promise<TestSuiteResult>;

  /**
   * Run a single test case
   */
  private runTest(
    test: TestCase,
    fixtures: Fixtures
  ): Promise<TestResult>;

  /**
   * Load fixtures from file or directory
   */
  private loadFixtures(testFile: string): Promise<Fixtures>;
}
```

### 5.3 TestReporter

```typescript
interface Reporter {
  onSuiteStart(suite: TestSuiteResult): void;
  onTestStart(test: TestResult): void;
  onTestEnd(test: TestResult): void;
  onSuiteEnd(suite: TestSuiteResult): void;
  onRunEnd(result: TestRunResult): void;
}

class TAPReporter implements Reporter {
  /**
   * Output in Test Anything Protocol format
   */
}

class JSONReporter implements Reporter {
  /**
   * Output as JSON
   */
}

class JUnitReporter implements Reporter {
  /**
   * Output as JUnit XML for CI integration
   */
}

class ConsoleReporter implements Reporter {
  /**
   * Pretty-printed console output
   */
}
```

---

## 6. Output Formats

### 6.1 TAP Output

```
TAP version 14
1..5
ok 1 - Admin can delete any document
ok 2 - User can edit owned document
ok 3 - User cannot delete owned document
not ok 4 - User cannot edit other's document
  ---
  message: Expected EFFECT_DENY but got EFFECT_ALLOW
  expected: EFFECT_DENY
  actual: EFFECT_ALLOW
  file: document_test.yaml
  ...
ok 5 - Verify output on denial (skipped)
```

### 6.2 JSON Output

```json
{
  "suites": [
    {
      "name": "Document Policy Tests",
      "file": "document_test.yaml",
      "tests": [
        {
          "name": "Admin can delete any document",
          "passed": true,
          "duration": 5
        },
        {
          "name": "User cannot edit other's document",
          "passed": false,
          "error": "Expected EFFECT_DENY but got EFFECT_ALLOW",
          "expected": { "effect": "EFFECT_DENY" },
          "actual": { "effect": "EFFECT_ALLOW" },
          "duration": 3
        }
      ],
      "passed": 3,
      "failed": 1,
      "skipped": 1,
      "duration": 25
    }
  ],
  "totalPassed": 3,
  "totalFailed": 1,
  "totalSkipped": 1,
  "totalDuration": 25
}
```

### 6.3 JUnit XML Output

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="authz-engine" tests="5" failures="1" skipped="1" time="0.025">
  <testsuite name="Document Policy Tests" tests="5" failures="1" skipped="1" time="0.025">
    <testcase name="Admin can delete any document" time="0.005"/>
    <testcase name="User can edit owned document" time="0.004"/>
    <testcase name="User cannot delete owned document" time="0.004"/>
    <testcase name="User cannot edit other's document" time="0.003">
      <failure message="Expected EFFECT_DENY but got EFFECT_ALLOW">
        Expected: EFFECT_DENY
        Actual: EFFECT_ALLOW
        File: document_test.yaml
      </failure>
    </testcase>
    <testcase name="Verify output on denial" time="0.000">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>
```

---

## 7. CI/CD Integration

### 7.1 GitHub Actions

```yaml
name: Policy Tests
on: [push, pull_request]

jobs:
  test-policies:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Compile policies
        run: npx authz-engine compile ./policies

      - name: Run policy tests
        run: npx authz-engine test ./policies --format junit > test-results.xml

      - name: Publish test results
        uses: dorny/test-reporter@v1
        if: always()
        with:
          name: Policy Tests
          path: test-results.xml
          reporter: java-junit
```

### 7.2 Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Compile policies
npx authz-engine compile ./policies
if [ $? -ne 0 ]; then
  echo "Policy compilation failed"
  exit 1
fi

# Run policy tests
npx authz-engine test ./policies
if [ $? -ne 0 ]; then
  echo "Policy tests failed"
  exit 1
fi
```

---

## 8. Programmatic API

### 8.1 Node.js API

```typescript
import { PolicyCompiler, TestRunner, ConsoleReporter } from '@authz-engine/testing';

// Compile policies
const compiler = new PolicyCompiler();
const compileResult = await compiler.compile(['./policies']);

if (!compileResult.valid) {
  console.error('Compilation errors:', compileResult.errors);
  process.exit(1);
}

// Run tests
const runner = new TestRunner(engine);
const testResult = await runner.run('./policies', {
  reporter: new ConsoleReporter(),
  bail: false,
  verbose: true,
});

if (testResult.totalFailed > 0) {
  process.exit(1);
}
```

### 8.2 Jest Integration

```typescript
import { createPolicyTestRunner } from '@authz-engine/testing';

describe('Document Policies', () => {
  const runner = createPolicyTestRunner({
    policyDir: './policies',
    testDir: './policies',
  });

  it.each(runner.getTestCases('document_test.yaml'))(
    '$name',
    async (testCase) => {
      const result = await runner.run(testCase);
      expect(result.passed).toBe(true);
    }
  );
});
```

---

## 9. Error Handling

### 9.1 Compile Errors

| Error Type | Description | Example |
|------------|-------------|---------|
| `syntax` | YAML parsing error | Invalid indentation |
| `semantic` | Type or reference error | Unknown action referenced |
| `reference` | Missing policy/role | Derived role not found |
| `duplicate` | Conflicting rules | Same action with different effects |

### 9.2 Test Errors

| Error Type | Description |
|------------|-------------|
| `effect_mismatch` | Expected effect differs from actual |
| `output_mismatch` | Expected output value differs |
| `fixture_not_found` | Referenced fixture doesn't exist |
| `timeout` | Test execution exceeded timeout |

---

## 10. Performance Considerations

### 10.1 Targets

| Metric | Target |
|--------|--------|
| Compile time (100 policies) | < 1 second |
| Test execution (100 tests) | < 5 seconds |
| Memory usage | < 100MB |

### 10.2 Optimizations

- Policy compilation caching
- Parallel test execution
- Lazy fixture loading
- Incremental compilation (changed files only)

---

## 11. Related Documents

- [CERBOS-FEATURE-COVERAGE-MATRIX.md](../CERBOS-FEATURE-COVERAGE-MATRIX.md)
- [CERBOS-FEATURE-PARITY-SDD.md](./CERBOS-FEATURE-PARITY-SDD.md)
- [CORE-PACKAGE-SDD.md](./CORE-PACKAGE-SDD.md)

---

## 12. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-23 | Initial specification |
