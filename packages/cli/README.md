# @authz-engine/cli

Command-line interface for the Aegis Authorization Engine. Provides tools for policy management, testing, and server control.

## Installation

Install from npm:

```bash
npm install -g @authz-engine/cli
```

Or use with npx:

```bash
npx @authz-engine/cli --help
```

## Quick Start

### Check Authorization

Check if a principal can perform an action on a resource:

```bash
authz check \
  --principal user:alice \
  --resource document:123 \
  --action read
```

With verbose output and JSON formatting:

```bash
authz check \
  --principal user:alice \
  --resource document:123 \
  --action read \
  --verbose \
  --json
```

### Validate Policies

Lint a policy file for issues:

```bash
authz policy lint policies/auth.json
authz policy lint policies/auth.yaml --strict
```

Validate against schema:

```bash
authz policy validate policies/auth.json
```

Run tests against a policy:

```bash
authz policy test policies/auth.json --fixtures tests/fixtures.yaml
```

### Run Tests

Execute authorization tests from a YAML or JSON file:

```bash
authz test tests/authorization.yaml
authz test tests/authorization.json --verbose
```

### Server Management

Check server status:

```bash
authz server status
authz server status --host localhost --port 3001
```

Check server health:

```bash
authz server health
authz server health --json
```

Reload server configuration:

```bash
authz server reload
```

## Commands

### authz check

Check if an authorization decision is allowed.

**Usage:**
```
authz check [options]
```

**Options:**
- `-p, --principal <id>` - Principal identifier (required)
- `-r, --resource <id>` - Resource identifier (required)
- `-a, --action <action>` - Action to perform (required)
- `--policy <file>` - Policy file to evaluate (optional)
- `-j, --json` - Output as JSON
- `-v, --verbose` - Verbose output with explanation

**Examples:**
```bash
# Basic authorization check
authz check --principal user:alice --resource document:123 --action read

# With policy file
authz check \
  --principal user:bob \
  --resource resource:xyz \
  --action delete \
  --policy policies/default.json

# JSON output
authz check \
  --principal user:charlie \
  --resource document:456 \
  --action write \
  --json | jq .
```

### authz policy lint

Lint a policy file for syntax and semantic issues.

**Usage:**
```
authz policy lint <file> [options]
```

**Options:**
- `-j, --json` - Output as JSON
- `-s, --strict` - Enable strict validation (requires descriptions, etc.)

**Examples:**
```bash
# Basic linting
authz policy lint policies/auth.json

# Strict mode
authz policy lint policies/auth.yaml --strict

# JSON output
authz policy lint policies/auth.json --json
```

### authz policy validate

Validate a policy file against the schema.

**Usage:**
```
authz policy validate <file> [options]
```

**Options:**
- `--schema <path>` - Custom schema file
- `-j, --json` - Output as JSON

**Examples:**
```bash
# Basic validation
authz policy validate policies/auth.json

# With custom schema
authz policy validate policies/auth.json --schema schemas/custom.json
```

### authz policy test

Run tests against a policy file.

**Usage:**
```
authz policy test <file> -f <fixtures> [options]
```

**Options:**
- `-f, --fixtures <path>` - Test fixtures file (required)
- `-j, --json` - Output as JSON

**Examples:**
```bash
# Run policy tests
authz policy test policies/auth.json --fixtures tests/fixtures.yaml

# JSON output
authz policy test policies/auth.json --fixtures tests/fixtures.json --json
```

### authz test

Run authorization tests from YAML or JSON test files.

**Usage:**
```
authz test <file> [options]
```

**Options:**
- `-j, --json` - Output as JSON
- `-v, --verbose` - Verbose output with details on failures
- `-b, --bail` - Stop on first failure

**Examples:**
```bash
# Run tests
authz test tests/authorization.yaml

# With verbose output
authz test tests/authorization.yaml --verbose

# JSON output
authz test tests/authorization.json --json
```

### authz server status

Check the authorization server status.

**Usage:**
```
authz server status [options]
```

**Options:**
- `-h, --host <host>` - Server host (default: localhost)
- `-p, --port <port>` - Server port (default: 3000)
- `-j, --json` - Output as JSON

**Examples:**
```bash
# Check local server
authz server status

# Check remote server
authz server status --host api.example.com --port 8080

# JSON output
authz server status --json
```

### authz server health

Check the authorization server health.

**Usage:**
```
authz server health [options]
```

**Options:**
- `-h, --host <host>` - Server host (default: localhost)
- `-p, --port <port>` - Server port (default: 3000)
- `-j, --json` - Output as JSON

**Examples:**
```bash
# Check server health
authz server health

# JSON output
authz server health --json
```

### authz server reload

Reload server configuration.

**Usage:**
```
authz server reload [options]
```

**Options:**
- `-h, --host <host>` - Server host (default: localhost)
- `-p, --port <port>` - Server port (default: 3000)
- `-j, --json` - Output as JSON

## Test File Format

### YAML Format

```yaml
- name: Allow document read
  principal: user:alice
  resource: document:123
  action: read
  expected: true
  description: Alice should be able to read documents

- name: Deny document delete
  principal: user:bob
  resource: document:123
  action: delete
  expected: false
  description: Bob should not be able to delete documents
```

### JSON Format

```json
[
  {
    "name": "Allow document read",
    "principal": "user:alice",
    "resource": "document:123",
    "action": "read",
    "expected": true,
    "description": "Alice should be able to read documents"
  },
  {
    "name": "Deny document delete",
    "principal": "user:bob",
    "resource": "document:123",
    "action": "delete",
    "expected": false,
    "description": "Bob should not be able to delete documents"
  }
]
```

## Exit Codes

- `0` - Success (all checks passed or resources are accessible)
- `1` - Failure (errors found or access denied)
- `2` - Authorization denied (for `authz check` command)

## Configuration

### Environment Variables

- `AUTHZ_SERVER_HOST` - Override default server host (default: localhost)
- `AUTHZ_SERVER_PORT` - Override default server port (default: 3000)

### Config File

Create an `.authz.json` or `.authz.yaml` in your project root:

```json
{
  "server": {
    "host": "localhost",
    "port": 3000
  },
  "policy": {
    "strict": true
  }
}
```

## Advanced Usage

### Policy Linting with Fixes

The CLI provides detailed linting information with error codes for automated processing:

```bash
authz policy lint policies/auth.json --json | jq '.[] | select(.level == "error")'
```

### Continuous Testing

Run tests continuously as files change:

```bash
# Using nodemon
nodemon --exec "authz test tests/authorization.yaml" --watch policies --watch tests
```

### Integration with CI/CD

```bash
#!/bin/bash
set -e

# Lint all policies
for policy in policies/*.yaml; do
  authz policy lint "$policy" --strict || exit 1
done

# Run authorization tests
authz test tests/authorization.yaml || exit 1

# Check server health
authz server health || exit 1
```

## Troubleshooting

### Server Connection Issues

If the CLI cannot connect to the server:

```bash
# Check connectivity
authz server health --verbose

# Specify custom host/port
authz server status --host 127.0.0.1 --port 3001
```

### Policy Validation Errors

Get more details about validation issues:

```bash
authz policy lint policies/auth.json --json | jq '.'
```

### Test Failures

Run tests with verbose output to see details:

```bash
authz test tests/authorization.yaml --verbose
```

## License

MIT
