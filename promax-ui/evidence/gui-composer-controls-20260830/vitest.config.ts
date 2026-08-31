import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [{
      find: /^@deepseek-ai\/([^/]+)$/u,
      replacement: '/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/node_modules/.pnpm/node_modules/@deepseek-ai/$1',
    }],
  },
  test: {
    include: ['evidence/gui-composer-controls-20260830/fixture.e2e.ts'],
    testTimeout: 960_000,
    hookTimeout: 180_000,
    pool: 'forks',
    maxWorkers: 1,
  },
})
