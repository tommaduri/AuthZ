# CLI Installation Guide

This guide covers installing and setting up the AuthZ Engine CLI.

## Prerequisites

- Node.js 20.0.0 or higher
- npm 10.0.0 or higher

## Installation Steps

### 1. From Root Directory

If you're in the monorepo root, run:

```bash
# Install all dependencies
npm install

# Build all packages including CLI
npm run build

# Or build just the CLI
npm run build --filter @authz-engine/cli
```

### 2. From CLI Package Directory

Navigate to the CLI package and install:

```bash
cd packages/cli

# Install dependencies for this package
npm install

# Build the CLI
npm run build
```

### 3. Global Installation (After Build)

To install the CLI globally for system-wide access:

```bash
cd packages/cli
npm install -g .
```

Or use npm link:

```bash
cd packages/cli
npm link
```

### 4. Using with npx

Once built and published to npm:

```bash
npx @authz-engine/cli --help
```

## Verify Installation

After installation, verify the CLI works:

```bash
# Check version
authz --version

# Show help
authz --help

# List available commands
authz
```

## Development Mode

For development with auto-recompilation:

```bash
cd packages/cli

# Watch mode
npm run dev

# In another terminal, use the CLI
npx ts-node src/index.ts --help
```

## Building from Source

### Prerequisites

- TypeScript compiler installed (included in devDependencies)
- All project dependencies installed

### Build Steps

```bash
# From CLI package directory
cd packages/cli

# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Output goes to: dist/
```

### Build Options

```bash
# Development build (with source maps)
npm run build

# Clean build
npm run clean && npm run build

# Type checking only
npm run typecheck

# With ESLint
npm run lint
```

## Troubleshooting

### Missing Dependencies

If you see errors about missing modules:

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Build Errors

If TypeScript compilation fails:

```bash
# Check for TypeScript issues
npm run typecheck

# View full error output
npm run build 2>&1 | less
```

### Permission Errors

If you get permission errors when installing globally:

```bash
# Use npm's official approach
npm install --global --prefix ~/.npm @authz-engine/cli

# Add to PATH in ~/.bashrc or ~/.zshrc
export PATH=~/.npm/bin:$PATH
```

### Module Not Found

If modules aren't found after installation:

```bash
# Clear npm cache
npm cache clean --force

# Reinstall
npm install
```

## Next Steps

After installation, check out the [README.md](./README.md) for command usage examples.

## Getting Help

For issues or questions:

1. Check the [README.md](./README.md) for command reference
2. Use `authz <command> --help` for command-specific help
3. Check the [examples/](./examples/) directory for sample files
4. Review the project's issue tracker

## Uninstallation

To remove the CLI:

```bash
# Global installation
npm uninstall -g @authz-engine/cli

# Or if installed with npm link
npm unlink @authz-engine/cli

# Local installation
npm uninstall @authz-engine/cli
```
