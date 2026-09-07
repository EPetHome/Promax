export interface ThemeModes {
  light: string
  dark: string
}

export type ThemeTokens = Record<string, ThemeModes>

function fixed(value: string): ThemeModes {
  return { light: value, dark: value }
}

export const PROMAX_THEME_TOKENS: ThemeTokens = {
  // Promax workbench primitives. The visual baseline defines one locked light
  // palette, so both host modes intentionally resolve to the same values.
  '--dsw-promax-ink': fixed('#20242e'),
  '--dsw-promax-ink-2': fixed('#414754'),
  '--dsw-promax-ink-3': fixed('#697180'),
  '--dsw-promax-ink-4': fixed('#798291'),
  '--dsw-promax-canvas': fixed('#ffffff'),
  '--dsw-promax-panel': fixed('#fbfcfd'),
  '--dsw-promax-surface': fixed('#ffffff'),
  '--dsw-promax-surface-glass': fixed('rgba(255, 255, 255, 0.84)'),
  '--dsw-promax-line': fixed('#e6e8ee'),
  '--dsw-promax-line-strong': fixed('#dce0e8'),
  '--dsw-promax-blue': fixed('#356df3'),
  '--dsw-promax-blue-hover': fixed('#2859d7'),
  '--dsw-promax-blue-soft': fixed('#eaf0ff'),
  '--dsw-promax-blue-soft-2': fixed('#f4f7ff'),
  '--dsw-promax-green': fixed('#187454'),
  '--dsw-promax-green-soft': fixed('#e6f6ee'),
  '--dsw-promax-amber': fixed('#956312'),
  '--dsw-promax-amber-soft': fixed('#fff4df'),
  '--dsw-promax-draft-banner-background': fixed('#ffed8a'),
  '--dsw-promax-draft-banner-border': fixed('#dfad28'),
  '--dsw-promax-draft-banner-text': fixed('#594200'),
  '--dsw-promax-draft-banner-icon-background': fixed('rgba(255, 255, 255, 0.62)'),
  '--dsw-promax-red': fixed('#ad3838'),
  '--dsw-promax-pink': fixed('#ffdfe8'),
  '--dsw-promax-purple': fixed('#e8e1ff'),
  '--dsw-promax-sky': fixed('#dcecff'),
  '--dsw-promax-shadow-sm': fixed('0 4px 16px rgba(37, 45, 73, 0.055)'),
  '--dsw-promax-shadow-md': fixed('0 18px 56px rgba(37, 45, 73, 0.09)'),
  '--dsw-promax-radius-sm': fixed('6px'),
  '--dsw-promax-radius-md': fixed('8px'),
  '--dsw-promax-radius-lg': fixed('10px'),
  '--dsw-promax-sidebar-left': fixed('240px'),
  '--dsw-promax-sidebar-right': fixed('304px'),

  // Composite background values stay in the token package so functional UI
  // packages never need to repeat palette literals.
  '--dsw-promax-body-background': fixed('#f5f6f8'),
  '--dsw-promax-dot-pattern': fixed('none'),
  '--dsw-promax-dot-mask': fixed('none'),
  '--dsw-promax-main-background': fixed('radial-gradient(circle at 92% 4%, rgba(220, 236, 255, 0.68), transparent 25rem), radial-gradient(circle at 8% 96%, rgba(255, 223, 232, 0.32), transparent 23rem), #fbfbfc'),
  '--dsw-promax-main-ring-border': fixed('rgba(53, 109, 243, 0.10)'),
  '--dsw-promax-main-ring-shadow': fixed('none'),

  // Workbench component tokens. Literal colors stay centralized here; the
  // layout and console packages consume only semantic variables.
  '--dsw-promax-shell-border': fixed('#e6e8ee'),
  '--dsw-promax-shell-background': fixed('#ffffff'),
  '--dsw-promax-shell-shadow': fixed('none'),
  '--dsw-promax-sidebar-background': fixed('rgba(246, 247, 249, 0.90)'),
  '--dsw-promax-header-background': fixed('rgba(255, 255, 255, 0.50)'),
  '--dsw-promax-topbar-background': fixed('rgba(255, 255, 255, 0.74)'),
  '--dsw-promax-tabs-background': fixed('rgba(255, 255, 255, 0.56)'),
  '--dsw-promax-composer-wrap-background': fixed('rgba(251, 251, 252, 0.88)'),
  '--dsw-promax-card-background': fixed('rgba(255, 255, 255, 0.88)'),
  '--dsw-promax-card-background-strong': fixed('rgba(255, 255, 255, 0.96)'),
  '--dsw-promax-card-background-soft': fixed('rgba(248, 249, 251, 0.86)'),
  '--dsw-promax-focus': fixed('rgba(53, 109, 243, 0.38)'),
  '--dsw-promax-text-icon': fixed('#525966'),
  '--dsw-promax-text-sidebar': fixed('#5f6674'),
  '--dsw-promax-text-section': fixed('#697180'),
  '--dsw-promax-text-conversation': fixed('#555c69'),
  '--dsw-promax-text-conversation-meta': fixed('#697180'),
  '--dsw-promax-text-footer': fixed('#606774'),
  '--dsw-promax-text-kicker': fixed('#697180'),
  '--dsw-promax-text-green': fixed('#287d57'),
  '--dsw-promax-text-toolbar': fixed('#4f5663'),
  '--dsw-promax-text-workspace-kicker': fixed('#697180'),
  '--dsw-promax-text-agent-role': fixed('#697180'),
  '--dsw-promax-text-agent-task': fixed('#5d6572'),
  '--dsw-promax-text-agent-footer': fixed('#717987'),
  '--dsw-promax-text-file': fixed('#6e7582'),
  '--dsw-promax-text-file-meta': fixed('#697180'),
  '--dsw-promax-text-ready': fixed('#277d57'),
  '--dsw-promax-text-muted-strong': fixed('#747c8a'),
  '--dsw-promax-text-placeholder': fixed('#9ba2ae'),
  '--dsw-promax-text-member-role': fixed('#697180'),
  '--dsw-promax-primary-text': fixed('#2f5fd7'),
  '--dsw-promax-primary-border': fixed('rgba(53, 109, 243, 0.16)'),
  '--dsw-promax-primary-border-hover': fixed('rgba(53, 109, 243, 0.28)'),
  '--dsw-promax-primary-background': fixed('linear-gradient(135deg, rgba(234, 240, 255, 0.96), rgba(244, 247, 255, 0.92))'),
  '--dsw-promax-primary-background-hover': fixed('#e6edff'),
  '--dsw-promax-active-background': fixed('rgba(255, 255, 255, 0.96)'),
  '--dsw-promax-active-shadow': fixed('0 8px 24px rgba(41, 49, 78, 0.07), inset 0 0 0 1px rgba(23, 25, 31, 0.04)'),
  '--dsw-promax-hover-background': fixed('rgba(255, 255, 255, 0.72)'),
  '--dsw-promax-count-background': fixed('rgba(23, 25, 31, 0.05)'),
  '--dsw-promax-team-availability-border': fixed('rgba(37, 155, 104, 0.14)'),
  '--dsw-promax-team-availability-background': fixed('rgba(230, 246, 238, 0.88)'),
  '--dsw-promax-green-glow': fixed('0 0 0 4px rgba(37, 155, 104, 0.10)'),
  '--dsw-promax-blue-glow': fixed('0 0 0 4px rgba(53, 109, 243, 0.08)'),
  '--dsw-promax-progress-track': fixed('#e9ebf1'),
  '--dsw-promax-progress-fill': fixed('linear-gradient(90deg, #356df3, #7f8ff4)'),
  '--dsw-promax-progress-shadow': fixed('0 0 14px rgba(53, 109, 243, 0.24)'),
  '--dsw-promax-task-glow': fixed('radial-gradient(circle, rgba(220, 236, 255, 0.65), transparent 68%)'),
  '--dsw-promax-task-shadow': fixed('0 14px 42px rgba(37, 45, 73, 0.065)'),
  '--dsw-promax-agent-card-shadow': fixed('0 7px 22px rgba(37, 45, 73, 0.04)'),
  '--dsw-promax-agent-card-hover-shadow': fixed('0 11px 28px rgba(37, 45, 73, 0.07)'),
  '--dsw-promax-running-border': fixed('rgba(53, 109, 243, 0.24)'),
  '--dsw-promax-running-background': fixed('linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 249, 255, 0.92))'),
  '--dsw-promax-done-border': fixed('rgba(37, 155, 104, 0.21)'),
  '--dsw-promax-done-background': fixed('linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(247, 253, 249, 0.92))'),
  '--dsw-promax-ready-border': fixed('rgba(37, 155, 104, 0.18)'),
  '--dsw-promax-ready-background': fixed('#fbfffc'),
  '--dsw-promax-avatar-1-text': fixed('#536079'),
  '--dsw-promax-avatar-1-background': fixed('#eef1f7'),
  '--dsw-promax-avatar-2-text': fixed('#785b79'),
  '--dsw-promax-avatar-2-background': fixed('#f3eaf3'),
  '--dsw-promax-avatar-3-text': fixed('#447365'),
  '--dsw-promax-avatar-3-background': fixed('#e8f3ef'),
  '--dsw-promax-team-note-background': fixed('radial-gradient(circle at 100% 0%, rgba(220, 236, 255, 0.75), transparent 75%), rgba(255, 255, 255, 0.75)'),
  '--dsw-promax-mobile-drawer-shadow': fixed('20px 0 60px rgba(26, 31, 49, 0.18)'),
  '--dsw-promax-mobile-scrim': fixed('rgba(20, 24, 35, 0.24)'),
  '--dsw-promax-send-shadow': fixed('0 8px 20px rgba(53, 109, 243, 0.24)'),
  '--dsw-promax-composer-shadow': fixed('0 12px 34px rgba(37, 45, 73, 0.075)'),
  '--dsw-promax-toast-border': fixed('rgba(255, 255, 255, 0.96)'),
  '--dsw-promax-toast-text': fixed('#343945'),
  '--dsw-promax-toast-background': fixed('rgba(255, 255, 255, 0.92)'),
  '--dsw-promax-toast-shadow': fixed('0 18px 50px rgba(36, 43, 69, 0.18), inset 0 0 0 1px rgba(23, 25, 31, 0.05)'),

  // dsh aliases and the existing Promax console semantics now resolve to the
  // same workbench palette.
  '--dsw-alias-bg-base': fixed('#ffffff'),
  '--dsw-alias-bg-layer-1': fixed('#f7f8fa'),
  '--dsw-alias-bg-layer-2': fixed('#f3f4f7'),
  '--dsw-alias-bg-overlay': fixed('#ffffff'),
  '--dsw-alias-border-l1': fixed('rgba(23, 25, 31, 0.09)'),
  '--dsw-alias-border-l2': fixed('rgba(23, 25, 31, 0.15)'),
  '--dsw-alias-brand-primary': fixed('#17191f'),
  '--dsw-alias-label-primary': fixed('#20242e'),
  '--dsw-alias-label-secondary': fixed('#697180'),
  '--dsw-alias-markdown-inline-code': fixed('#eef0f4'),
  '--dsw-alias-state-error-primary': fixed('#d34c5e'),
  '--dsw-alias-state-success-primary': fixed('#259b68'),
  '--dsw-alias-state-warn-primary': fixed('#b97b24'),
  '--dsw-specific-sidebar-fill': fixed('#f7f8fa'),
  '--dsw-promax-on-accent': fixed('#ffffff'),
  '--dsw-promax-accent': fixed('#356df3'),
  '--dsw-promax-accent-strong': fixed('#2859d7'),
  '--dsw-promax-accent-soft': fixed('#eaf0ff'),
  '--dsw-promax-panel-strong': fixed('#ffffff'),
  '--dsw-promax-rail': fixed('#f5f6f8'),
  '--dsw-promax-grid-line': fixed('rgba(23, 25, 31, 0.09)'),
  '--dsw-promax-backdrop': fixed('rgba(23, 25, 31, 0.38)'),
  '--dsw-promax-shadow': fixed('rgba(37, 45, 73, 0.09)'),
  '--dsw-promax-status-never-bg': fixed('#ffdfe8'),
  '--dsw-promax-status-stale-bg': fixed('#fff4df'),
  '--dsw-promax-status-ok-bg': fixed('#e6f6ee'),
  '--dsw-promax-track-hook': fixed('#259b68'),
  '--dsw-promax-track-hook-bg': fixed('#e6f6ee'),
  '--dsw-promax-track-llm': fixed('#356df3'),
  '--dsw-promax-track-llm-bg': fixed('#eaf0ff'),
}

export const PROMAX_GLOBAL_THEME_CSS = String.raw`
html,
body {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: clip;
}
html { overflow: clip; color-scheme: light; }
body {
  margin: 0;
  color: var(--dsw-promax-ink);
  background: var(--dsw-promax-body-background);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; }
body { font-size: 14px; }

`

const GLOBAL_STYLE_ID = 'promax-global-theme'
let globalStyleConsumers = 0

export function installPromaxGlobalTheme(): () => void {
  globalStyleConsumers += 1
  if (document.getElementById(GLOBAL_STYLE_ID) === null) {
    const style = document.createElement('style')
    style.id = GLOBAL_STYLE_ID
    style.textContent = PROMAX_GLOBAL_THEME_CSS
    document.head.append(style)
  }
  return () => {
    globalStyleConsumers = Math.max(0, globalStyleConsumers - 1)
    if (globalStyleConsumers === 0) document.getElementById(GLOBAL_STYLE_ID)?.remove()
  }
}

export function applyStandaloneTheme(root: HTMLElement = document.documentElement): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const removeGlobalTheme = installPromaxGlobalTheme()
  const apply = (): void => {
    const mode: keyof ThemeModes = media.matches ? 'dark' : 'light'
    root.dataset.dsDarkTheme = media.matches ? 'true' : 'false'
    for (const [name, value] of Object.entries(PROMAX_THEME_TOKENS)) {
      root.style.setProperty(name, value[mode])
    }
  }
  apply()
  media.addEventListener('change', apply)
  return () => {
    media.removeEventListener('change', apply)
    removeGlobalTheme()
  }
}
