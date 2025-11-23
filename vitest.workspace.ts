import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'core',
      root: './packages/core',
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'server',
      root: './packages/server',
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'sdk',
      root: './packages/sdk-typescript',
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'nestjs',
      root: './packages/nestjs',
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'agents',
      root: './packages/agents',
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'swarm',
      root: './packages/swarm',
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  },
]);
