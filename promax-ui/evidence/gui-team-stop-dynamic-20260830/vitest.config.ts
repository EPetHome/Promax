import tsconfigPaths from '/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/node_modules/.pnpm/vite-tsconfig-paths@6.1.1_typescript@6.0.3_vite@8.0.16_@types+node@22.20.0_esbuild@0.28_8d997267979df7745971c64fa8763ffa/node_modules/vite-tsconfig-paths/dist/index.js'
import { defineConfig } from 'vitest/config'
import {
  standardDecoratorPlugin,
  vitestExecArgv,
} from '/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/vitest.shared.ts'

export default defineConfig({
  root: '/Users/Admin/Desktop/Promax/promax-ui',
  plugins: [
    tsconfigPaths({
      projects: ['/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/tsconfig.base.json'],
    }),
    standardDecoratorPlugin(),
  ],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: ['/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/scripts/test-invariants.ts'],
    include: ['evidence/gui-team-stop-dynamic-20260830/dynamic-stop.e2e.ts'],
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 360_000,
    hookTimeout: 180_000,
  },
})
