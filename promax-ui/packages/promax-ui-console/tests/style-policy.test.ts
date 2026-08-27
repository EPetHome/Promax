import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('console color policy', () => {
  it('keeps literal colors out of the functional package', () => {
    const sourceFiles = [
      'packages/promax-ui-console/src/styles.ts',
      'packages/promax-ui-console/src/standalone.css',
      'packages/promax-ui-console/src/components/PromaxConsole.tsx',
      'packages/promax-ui-console/src/components/AgentStatusDock.tsx',
      'packages/promax-ui-console/src/client/index.tsx',
      'packages/promax-ui-console/src/client/ConsoleLauncher.tsx',
    ]
    for (const path of sourceFiles) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(source, path).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\s*\(/iu)
    }
  })
})
