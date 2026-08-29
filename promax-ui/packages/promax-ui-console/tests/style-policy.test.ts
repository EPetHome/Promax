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
    expect(source).toContain('body:has(.promax-native-room-context) [data-phase="active"]')
    expect(source).toContain('body:has(.promax-native-room-context) [data-composer-card]')
  })

  it('keeps the host brand shortcut visible while replacing only its duplicate new-session control', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-ui-console/src/styles.ts'), 'utf8')
    expect(source).toContain('button[class*="_newSession"][aria-label="New session"]')
    expect(source).not.toContain('.promax-session-browser) button[aria-label="New session"]')
  })

  it('anchors the team breadcrumb at the start of the session toolbar', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-ui-console/src/styles.ts'), 'utf8')
    expect(source).toContain('.promax-native-breadcrumb { display: flex; min-width: 0; align-items: center; gap: 5px; margin-inline-end: auto;')
    expect(source).not.toContain('.promax-native-team-header { display: flex; min-width: 0; align-items: center; justify-content: flex-end;')
  })

  it('keeps TeamHome in the shell center without a duplicate navigation column', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-ui-console/src/styles.ts'), 'utf8')
    expect(source).toContain('[data-shell-overlay]:has(.promax-team-home)')
    expect(source).toContain('grid-column: 2')
    expect(source).not.toContain('.promax-team-home { inset: 0;')
    expect(source).not.toContain('promax-team-home-sessions-head')
    expect(source).not.toContain('promax-team-home-sessions {')
  })

  it('keeps the Promax room palette in the brand token package', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-ui-brand/src/theme.ts'), 'utf8')
    expect(source).toContain("'--dsw-promax-accent'")
    expect(source).toContain("'--dsw-promax-canvas'")
    expect(source).toContain("'--dsw-promax-panel'")
  })
})
