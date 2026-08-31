import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('console color policy', () => {
  it('keeps literal colors out of the functional package', () => {
    const sourceFiles = [
      'packages/promax-ui-console/src/styles.ts',
      'packages/promax-ui-console/src/workbench-styles.ts',
      'packages/promax-ui-console/src/standalone.css',
      'packages/promax-ui-console/src/components/PromaxConsole.tsx',
      'packages/promax-ui-console/src/components/AgentStatusDock.tsx',
      'packages/promax-ui-console/src/client/index.tsx',
      'packages/promax-ui-console/src/client/ConsoleLauncher.tsx',
      'packages/promax-ui-console/src/client/PromaxWorkspaceShell.tsx',
      'packages/promax-ui-console/src/client/team-state.ts',
      'packages/promax-ui-layout/src/client/index.tsx',
    ]
    for (const path of sourceFiles) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(source, path).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\s*\(/iu)
    }
  })

  it('removes the inherited hero workspace and preset row without changing dsh source', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-ui-console/src/styles.ts'), 'utf8')
    expect(source).toContain('[class*="_composerHero"] [class*="_heroWorkspaceRow"] { display: none; }')
    expect(source).toContain('body:has(.app-shell) [class*="_composerHero"] [class*="_headline"]:has(> [class*="_fishHitbox"]) { grid-template-columns: auto auto; }')
    expect(source).toContain('body:has(.app-shell) [class*="_composerHero"] [class*="_headline"]:has(> [class*="_fishHitbox"]) > [class*="_fishHitbox"] { display: none; }')
    expect(source).toContain('body:has(.app-shell) [class*="_composerHero"] [class*="_headline"]:has(> [class*="_fishHitbox"]) > [class*="_headlineText"] { grid-column: 1; }')
    expect(source).toContain('body:has(.app-shell) [class*="_composerHero"] [class*="_headline"]:has(> [class*="_fishHitbox"]) > [class*="_previewBadge"] { grid-column: 2; }')
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
    expect(source).toContain("'--dsw-promax-ink': fixed('#17191f')")
    expect(source).toContain("'--dsw-promax-canvas': fixed('#f3f4f7')")
    expect(source).toContain("'--dsw-promax-blue': fixed('#356df3')")
    expect(source).toContain("'--dsw-promax-draft-banner-background': fixed('#ffed8a')")
    expect(source).toContain("'--dsw-promax-draft-banner-text': fixed('#594200')")
    expect(source).toContain("'--dsw-promax-sidebar-left': fixed('250px')")
    expect(source).toContain("'--dsw-promax-sidebar-right': fixed('270px')")
    expect(source).toContain('background-size: 12px 12px')
    expect(source).toContain('.main-column::before')
  })

  it('renders the draft boundary as a high-visibility yellow banner', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-ui-console/src/workbench-styles.ts'), 'utf8')
    expect(source).toContain('background: var(--dsw-promax-draft-banner-background)')
    expect(source).toContain('border-bottom: 1px solid var(--dsw-promax-draft-banner-border)')
    expect(source).toContain('color: var(--dsw-promax-draft-banner-text)')
  })
})
