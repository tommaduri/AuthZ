# AuthZ CLI - Quick Reference

Quick command reference for the Aegis Authorization Engine CLI.

## Installation

```bash
# From root
npm install && npm run build

# Global install
cd packages/cli && npm install -g .

# Using npx
npx @authz-engine/cli --help
```

## Authorization Checks

### Basic Check
```bash
authz check -p user:alice -r document:123 -a read
```

### With Explanation
```bash
authz check \
  --principal user:alice \
  --resource document:123 \
  --action read \
  --verbose
```

### JSON Output
```bash
authz check -p user:bob -r doc:456 -a write --json | jq .
```

### Exit Codes
- `0` = Allowed
- `2` = Denied
- `1` = Error

## Policy Management

### Lint Policy
```bash
# Basic linting
authz policy lint policies/auth.json

# Strict validation
authz policy lint policies/auth.yaml --strict

# JSON output
authz policy lint policies/auth.json --json
```

### Validate Policy
```bash
authz policy validate policies/auth.json
authz policy validate policies/auth.json --schema custom-schema.json
```

### Test Policy
```bash
authz policy test policies/auth.json --fixtures tests/fixtures.yaml
authz policy test policies/auth.json --fixtures tests/fixtures.yaml --json
```

## Test Execution

### Run Tests
```bash
# Basic
authz test tests/authorization.yaml

# Verbose (show failures)
authz test tests/authorization.yaml --verbose

# JSON output
authz test tests/authorization.json --json

# Stop on first failure
authz test tests/authorization.yaml --bail
```

### Test File Format (YAML)
```yaml
- name: Test Name
  principal: user:id
  resource: resource:id
  action: action_name
  expected: true
  description: Optional description
```

### Test File Format (JSON)
```json
[
  {
    "name": "Test Name",
    "principal": "user:id",
    "resource": "resource:id",
    "action": "action_name",
    "expected": true,
    "description": "Optional"
  }
]
```

## Server Management

### Check Status
```bash
authz server status
authz server status --host localhost --port 3001
authz server status --json
```

### Health Check
```bash
authz server health
authz server health --host api.example.com --port 8080
authz server health --json
```

### Reload Server
```bash
authz server reload
authz server reload --host localhost --port 3001
```

## Common Patterns

### Test Authorization Chain
```bash
# Test multiple operations
authz check -p user:alice -r doc:1 -a read -v
authz check -p user:alice -r doc:1 -a write -v
authz check -p user:alice -r doc:1 -a delete -v
```

### CI/CD Integration
```bash
#!/bin/bash
set -e

# Lint policies
authz policy lint policies/auth.yaml --strict

# Run tests
authz test tests/authorization.yaml

# Check server
authz server health
```

### Generate Reports
```bash
# Test results as JSON
authz test tests/authorization.yaml --json > results.json

# Policy issues as JSON
authz policy lint policies/auth.json --json > issues.json

# Server status snapshot
authz server status --json > status.json
```

## Environment Variables

```bash
# Override server connection
export AUTHZ_SERVER_HOST=api.example.com
export AUTHZ_SERVER_PORT=8080

# Run commands with custom server
authz server health
```

## Troubleshooting

### Command Not Found
```bash
# Check installation
which authz

# Reinstall globally
npm install -g @authz-engine/cli

# Or use npx
npx @authz-engine/cli --help
```

### Permission Denied
```bash
# Fix permissions
sudo npm install -g @authz-engine/cli

# Or use npm prefix
npm install --prefix ~/.npm -g @authz-engine/cli
export PATH=~/.npm/bin:$PATH
```

### Connection Issues
```bash
# Test connectivity
authz server health --verbose

# Use custom host
authz server health --host 127.0.0.1 --port 3000
```

### File Not Found
```bash
# Check file exists
ls -la policies/auth.json

# Use absolute path
authz policy lint /full/path/to/policies/auth.json

# Or relative from CWD
authz policy lint ./policies/auth.json
```

## Examples

### Example Authorization Check
```bash
$ authz check --principal user:alice --resource document:123 --action read

Authorization Decision
──────────────────────────────────────────────
Principal: user:alice
Resource:  document:123
Action:    read
──────────────────────────────────────────────
Result:    ALLOWED
```

### Example Test Results
```bash
$ authz test tests/authorization.yaml

Test Name              Expected  Actual  Result      Duration
─────────────────────────────────────────────────────────────
Allow document read    allow     allow   ✓ PASS      12ms
Deny document delete   deny      deny    ✓ PASS      15ms
Regular user write     deny      allow   ✗ FAIL      10ms

Test Summary
──────────────────────────────────────────────
Total:    3
Passed:   2
Failed:   1
Duration: 37ms
```

### Example Policy Linting
```bash
$ authz policy lint policies/auth.json

Level     Code                Message
─────────────────────────────────────────────
warning   RULE_NO_PRINCIPAL   Rule "admin" should specify principal(s)
warning   MISSING_DESCRIPTION Policy should have a description

⚠ 1 warning found
```

## All Commands

```
authz check                          - Check authorization decision
authz policy lint <file>            - Lint policy file
authz policy validate <file>        - Validate policy
authz policy test <file>            - Test policy with fixtures
authz server status                 - Check server status
authz server health                 - Check server health
authz server reload                 - Reload server
authz test <file>                   - Run authorization tests
authz --help                        - Show help
authz --version                     - Show version
```

## Key Options

| Option | Short | Type | Description |
|--------|-------|------|-------------|
| `--principal` | `-p` | string | Principal ID |
| `--resource` | `-r` | string | Resource ID |
| `--action` | `-a` | string | Action name |
| `--policy` | - | string | Policy file path |
| `--fixtures` | `-f` | string | Fixtures file path |
| `--json` | `-j` | flag | JSON output |
| `--verbose` | `-v` | flag | Verbose output |
| `--host` | `-h` | string | Server host |
| `--port` | `-p` | number | Server port |
| `--strict` | `-s` | flag | Strict validation |
| `--bail` | `-b` | flag | Stop on failure |

## Getting Help

```bash
# General help
authz --help
authz -h

# Command help
authz check --help
authz policy --help
authz server --help
authz test --help

# Subcommand help
authz policy lint --help
authz policy validate --help
authz policy test --help
authz server status --help
authz server health --help
authz server reload --help
```

## Version & Info

```bash
# Show version
authz --version
authz -v

# Show help
authz --help
authz -h
```

## Tips & Tricks

### Pipe Output
```bash
# Parse JSON results with jq
authz check -p user:alice -r doc:1 -a read --json | jq '.allowed'

# Save results to file
authz test tests/authorization.yaml --json > results.json

# Format output
authz check -p user:bob -r doc:2 -a delete --json | jq '.explanation'
```

### Shell Aliases
```bash
# In ~/.bashrc or ~/.zshrc
alias authz-test="authz test"
alias authz-check="authz check"
alias authz-lint="authz policy lint"
alias authz-health="authz server health"

# Usage
authz-test tests/authorization.yaml
authz-check -p user:alice -r doc:1 -a read
authz-lint policies/auth.json
authz-health
```

### Continuous Testing
```bash
# Watch for changes (using nodemon)
nodemon --exec "authz test tests/authorization.yaml" \
  --watch policies \
  --watch tests \
  --ext yaml,json
```

### Batch Authorization Checks
```bash
# Check multiple operations
for action in read write delete; do
  echo "Testing $action..."
  authz check -p user:alice -r doc:1 -a $action
done
```

## Related Documentation

- **[README.md](./README.md)** - Comprehensive user guide
- **[INSTALLATION.md](./INSTALLATION.md)** - Installation instructions
- **[IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)** - Technical details
