# =============================================================================
# AuthZ Engine - Production Docker Image (TypeScript)
# Multi-stage build with security best practices
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
COPY packages/agents/package.json ./packages/agents/
COPY packages/sdk-typescript/package.json ./packages/sdk-typescript/
COPY packages/nestjs/package.json ./packages/nestjs/
COPY packages/memory/package.json ./packages/memory/
COPY packages/consensus/package.json ./packages/consensus/
COPY packages/platform/package.json ./packages/platform/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/*/node_modules ./packages/

# Copy source files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY packages ./packages

# Build all packages in correct order
RUN pnpm run build

# Prune dev dependencies
RUN pnpm prune --prod

# -----------------------------------------------------------------------------
# Stage 3: Production Runtime
# -----------------------------------------------------------------------------
FROM node:20-slim AS runner

# Install tini for proper signal handling and security updates
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    wget \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user with specific UID/GID for security
RUN groupadd --system --gid 1001 authz \
    && useradd --system --uid 1001 --gid authz --shell /sbin/nologin authz

WORKDIR /app

# Copy pnpm for runtime
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy built artifacts and production dependencies
COPY --from=builder --chown=authz:authz /app/package.json ./
COPY --from=builder --chown=authz:authz /app/pnpm-lock.yaml ./
COPY --from=builder --chown=authz:authz /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=authz:authz /app/node_modules ./node_modules

# Copy package.json and dist for each package
COPY --from=builder --chown=authz:authz /app/packages/core/package.json ./packages/core/
COPY --from=builder --chown=authz:authz /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=authz:authz /app/packages/server/package.json ./packages/server/
COPY --from=builder --chown=authz:authz /app/packages/server/dist ./packages/server/dist
COPY --from=builder --chown=authz:authz /app/packages/agents/package.json ./packages/agents/
COPY --from=builder --chown=authz:authz /app/packages/agents/dist ./packages/agents/dist
COPY --from=builder --chown=authz:authz /app/packages/sdk-typescript/package.json ./packages/sdk-typescript/
COPY --from=builder --chown=authz:authz /app/packages/sdk-typescript/dist ./packages/sdk-typescript/dist
COPY --from=builder --chown=authz:authz /app/packages/nestjs/package.json ./packages/nestjs/
COPY --from=builder --chown=authz:authz /app/packages/nestjs/dist ./packages/nestjs/dist
COPY --from=builder --chown=authz:authz /app/packages/memory/package.json ./packages/memory/
COPY --from=builder --chown=authz:authz /app/packages/consensus/package.json ./packages/consensus/
COPY --from=builder --chown=authz:authz /app/packages/platform/package.json ./packages/platform/

# Create directories for policies and logs
RUN mkdir -p /app/policies /app/logs \
    && chown -R authz:authz /app/policies /app/logs

# Copy default policies (can be overridden via volume mount)
COPY --chown=authz:authz policies ./policies

# Switch to non-root user
USER authz

# Environment configuration
ENV NODE_ENV=production \
    REST_PORT=3592 \
    GRPC_PORT=3593 \
    POLICY_DIR=/app/policies \
    WATCH_POLICIES=true \
    AGENTIC_ENABLED=true \
    LOG_LEVEL=info \
    LOG_FORMAT=json

# Expose ports
EXPOSE 3592 3593

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3592/health || exit 1

# Labels for container metadata
LABEL org.opencontainers.image.title="AuthZ Engine" \
      org.opencontainers.image.description="Enterprise Policy-as-Code Authorization Engine" \
      org.opencontainers.image.vendor="AuthZ Engine" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.source="https://github.com/authz-engine/authz-engine"

# Use tini as init system for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start the server
CMD ["node", "packages/server/dist/index.js"]
