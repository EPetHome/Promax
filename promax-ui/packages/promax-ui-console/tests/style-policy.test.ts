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
      'packages/promax-ui-console/src/client/PromaxWorkspaceShell.tsx',
      'packages/promax-ui-console/src/client/team-state.ts',
    ]
    for (const path of sourceFiles) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(source, path).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\s*\(/iu)
    }
  })

  it('removes the inherited hero workspace and preset row without changing dsh source', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-ui-console/src/styles.ts'), 'utf8')
    expect(source).toContain('[class*="_composerHero"] [class*="_heroWorkspaceRow"] { display: none; }')
    expect(source).toContain(':has(> [data-shell-overlay] .promax-team-rail--open)')
  })
})
