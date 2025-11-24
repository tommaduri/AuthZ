# AuthZ Engine CLI - Documentation Index

Complete documentation index for the AuthZ Engine Command-Line Interface.

## Quick Navigation

### For Users

1. **[README.md](./README.md)** - Start here!
   - Installation instructions
   - Quick start guide
   - Complete command reference
   - Usage examples
   - Troubleshooting guide

2. **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Cheat sheet
   - Common commands
   - Quick syntax reference
   - Tips and tricks
   - Examples

3. **[INSTALLATION.md](./INSTALLATION.md)** - Setup guide
   - Prerequisites
   - Installation steps
   - Development mode
   - Build instructions

### For Developers

1. **[IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)** - Architecture
   - Project structure
   - Component overview
   - Architecture decisions
   - Technical details
   - Dependencies

2. **[tests/](./tests/)** - Test files
   - Unit tests for each command
   - Test patterns
   - Coverage examples

3. **[examples/](./examples/)** - Example files
   - Sample policies
   - Test cases
   - Fixtures

### Project Documentation

- **[../../IMPLEMENTATION_REPORT.md](../../IMPLEMENTATION_REPORT.md)** - Complete implementation report
  - Deliverables checklist
  - Code metrics
  - Feature summary
  - Quality assurance

---

## Documentation Files

### User Documentation

| File | Lines | Purpose |
|------|-------|---------|
| [README.md](./README.md) | 450+ | User guide and command reference |
| [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) | 300+ | Quick command syntax reference |
| [INSTALLATION.md](./INSTALLATION.md) | 150+ | Installation and setup guide |

### Technical Documentation

| File | Lines | Purpose |
|------|-------|---------|
| [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) | 400+ | Technical architecture and details |
| [INDEX.md](./INDEX.md) | This file | Navigation guide |

### Project Documentation

| File | Purpose |
|------|---------|
| [../../IMPLEMENTATION_REPORT.md](../../IMPLEMENTATION_REPORT.md) | Complete implementation report |

---

## Source Code

### Main Entry Point

- **[src/index.ts](./src/index.ts)** (38 lines)
  - CLI initialization
  - Command registration
  - Error handling

### Commands

| Command | File | Lines | Purpose |
|---------|------|-------|---------|
| check | [src/commands/check.ts](./src/commands/check.ts) | 122 | Authorization decision checking |
| policy lint | [src/commands/policy.ts](./src/commands/policy.ts) | 315 | Policy validation and linting |
| policy validate | [src/commands/policy.ts](./src/commands/policy.ts) | | Schema validation |
| policy test | [src/commands/policy.ts](./src/commands/policy.ts) | | Policy testing |
| server status | [src/commands/server.ts](./src/commands/server.ts) | 201 | Server status checking |
| server health | [src/commands/server.ts](./src/commands/server.ts) | | Server health checking |
| server reload | [src/commands/server.ts](./src/commands/server.ts) | | Server reload |
| test | [src/commands/test.ts](./src/commands/test.ts) | 234 | Test execution |

---

## Test Files

| Test File | Coverage |
|-----------|----------|
| [tests/commands.check.test.ts](./tests/commands.check.test.ts) | Check command functionality |
| [tests/commands.policy.test.ts](./tests/commands.policy.test.ts) | Policy validation |
| [tests/commands.server.test.ts](./tests/commands.server.test.ts) | Server operations |
| [tests/commands.test.test.ts](./tests/commands.test.test.ts) | Test execution |

---

## Example Files

| Example | Purpose |
|---------|---------|
| [examples/authorization.yaml](./examples/authorization.yaml) | 8 authorization test cases |
| [examples/policy.yaml](./examples/policy.yaml) | Complete policy example |
| [examples/fixtures.yaml](./examples/fixtures.yaml) | Test fixtures |

---

## Configuration Files

| File | Purpose |
|------|---------|
| [package.json](./package.json) | NPM package configuration |
| [tsconfig.json](./tsconfig.json) | TypeScript compilation settings |
| [vitest.config.ts](./vitest.config.ts) | Test runner configuration |
| [.eslintrc.json](./.eslintrc.json) | Linting rules |

---

## How to Use This Documentation

### I want to...

#### Install and use the CLI

1. Start with [INSTALLATION.md](./INSTALLATION.md)
2. Read [README.md](./README.md) for command details
3. Bookmark [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for quick lookup

#### Understand the architecture

1. Read [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
2. Review [src/](./src/) for implementation details
3. Check [tests/](./tests/) for usage patterns

#### Modify or extend the CLI

1. Review [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) architecture section
2. Look at [src/commands/](./src/commands/) for command structure
3. Check [tests/](./tests/) for testing patterns
4. Add new commands following existing patterns

#### See example usage

1. Check [examples/](./examples/) for sample files
2. Read [README.md](./README.md) usage section
3. Review [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for patterns

#### Get help

1. Use `authz --help` for CLI help
2. Use `authz <command> --help` for command-specific help
3. Check [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for syntax
4. Read [README.md](./README.md) troubleshooting section

---

## Command Reference

### Authorization

```bash
authz check -p <principal> -r <resource> -a <action> [options]
```
→ See [README.md#check](./README.md#check) or [QUICK_REFERENCE.md#authorization-checks](./QUICK_REFERENCE.md#authorization-checks)

### Policy Management

```bash
authz policy lint <file> [options]
authz policy validate <file> [options]
authz policy test <file> --fixtures <fixtures> [options]
```
→ See [README.md#policy](./README.md#policy) or [QUICK_REFERENCE.md#policy-management](./QUICK_REFERENCE.md#policy-management)

### Server Control

```bash
authz server status [options]
authz server health [options]
authz server reload [options]
```
→ See [README.md#server](./README.md#server) or [QUICK_REFERENCE.md#server-management](./QUICK_REFERENCE.md#server-management)

### Testing

```bash
authz test <file> [options]
```
→ See [README.md#test](./README.md#test) or [QUICK_REFERENCE.md#test-execution](./QUICK_REFERENCE.md#test-execution)

---

## File Organization

### By Purpose

#### Users
- [README.md](./README.md) - Complete guide
- [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - Quick reference
- [INSTALLATION.md](./INSTALLATION.md) - Setup
- [examples/](./examples/) - Examples

#### Developers
- [src/](./src/) - Implementation
- [tests/](./tests/) - Test suite
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - Architecture
- [package.json](./package.json) - Configuration

#### Project
- [../../IMPLEMENTATION_REPORT.md](../../IMPLEMENTATION_REPORT.md) - Report

### By Type

#### Documentation
- [README.md](./README.md)
- [INSTALLATION.md](./INSTALLATION.md)
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
- [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
- [INDEX.md](./INDEX.md)

#### Source Code
- [src/index.ts](./src/index.ts)
- [src/commands/*.ts](./src/commands/)

#### Tests
- [tests/*.test.ts](./tests/)

#### Examples
- [examples/*.yaml](./examples/)

#### Configuration
- [package.json](./package.json)
- [tsconfig.json](./tsconfig.json)
- [vitest.config.ts](./vitest.config.ts)
- [.eslintrc.json](./.eslintrc.json)

---

## Getting Started

### First Time Users

1. Install: `npm install -g @authz-engine/cli`
2. Read: [README.md](./README.md)
3. Practice: Use [examples/](./examples/)
4. Reference: [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)

### Developers

1. Clone/navigate to `/packages/cli/`
2. Read: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
3. Install: `npm install`
4. Build: `npm run build`
5. Test: `npm test`

### Contributors

1. Fork/branch the repository
2. Read: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
3. Review: [src/commands/](./src/commands/)
4. Check: [tests/](./tests/) for patterns
5. Add tests before implementing
6. Run: `npm test`
7. Build: `npm run build`

---

## API Documentation

### CLI Commands (see [README.md](./README.md#commands))

- `authz check` - Authorization decision checking
- `authz policy lint` - Policy linting
- `authz policy validate` - Policy validation
- `authz policy test` - Policy testing
- `authz server status` - Server status
- `authz server health` - Server health check
- `authz server reload` - Server reload
- `authz test` - Test execution

### Programmatic API (see [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md))

Each command module exports a function for CLI registration:
- `checkCommand(program)`
- `policyCommand(program)`
- `serverCommand(program)`
- `testCommand(program)`

---

## Common Tasks

### See command help

```bash
authz --help
authz <command> --help
```

### Check authorization

```bash
authz check -p user:alice -r doc:123 -a read --verbose
```

### Lint policy

```bash
authz policy lint policies/auth.json --strict
```

### Run tests

```bash
authz test tests/authorization.yaml --verbose
```

### Check server health

```bash
authz server health
```

For more examples, see [QUICK_REFERENCE.md](./QUICK_REFERENCE.md).

---

## Support and Troubleshooting

### Getting Help

1. **CLI Help:** `authz <command> --help`
2. **Quick Reference:** [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
3. **Complete Guide:** [README.md](./README.md)
4. **Troubleshooting:** [README.md#troubleshooting](./README.md#troubleshooting)

### Common Issues

See [README.md#troubleshooting](./README.md#troubleshooting) or [INSTALLATION.md#troubleshooting](./INSTALLATION.md#troubleshooting)

### Report Issues

Check the GitHub repository issues section or contact the maintainers.

---

## Version Information

**Package:** @authz-engine/cli
**Version:** 0.1.0
**Status:** Production Ready
**Last Updated:** November 23, 2025

---

## Related Packages

- [@authz-engine/core](../core/) - Core policy engine
- [@authz-engine/server](../server/) - Authorization server
- [@authz-engine/agents](../agents/) - Agent framework
- [@authz-engine/neural](../neural/) - Neural network components

---

## Quick Links

| Purpose | Link |
|---------|------|
| User Guide | [README.md](./README.md) |
| Quick Reference | [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) |
| Installation | [INSTALLATION.md](./INSTALLATION.md) |
| Architecture | [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) |
| Examples | [examples/](./examples/) |
| Tests | [tests/](./tests/) |
| Implementation Report | [../../IMPLEMENTATION_REPORT.md](../../IMPLEMENTATION_REPORT.md) |

---

## Document Status

All documentation is current and complete. Last verified: November 23, 2025

**Completeness:** 100% ✓
**Accuracy:** Verified ✓
**Examples:** Functional ✓
