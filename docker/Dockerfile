# Build stage
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
COPY packages/agents/package.json ./packages/agents/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/server ./packages/server
COPY packages/agents ./packages/agents

# Build
RUN pnpm --filter @authz-engine/core build
RUN pnpm --filter @authz-engine/agents build
RUN pnpm --filter @authz-engine/server build

# Production stage
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 authz && \
    adduser --system --uid 1001 authz

# Copy built artifacts
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/agents/package.json ./packages/agents/
COPY --from=builder /app/packages/agents/dist ./packages/agents/dist

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy policies
COPY policies ./policies

USER authz

ENV NODE_ENV=production
ENV REST_PORT=3592
ENV GRPC_PORT=3593
ENV POLICY_DIR=/app/policies

EXPOSE 3592 3593

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3592/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
