export interface ThemeModes {
  light: string
  dark: string
}

export type ThemeTokens = Record<string, ThemeModes>

export const PROMAX_THEME_TOKENS: ThemeTokens = {
  '--dsw-alias-bg-base': { light: '#ffffff', dark: '#171717' },
  '--dsw-alias-bg-layer-1': { light: '#f7f7f8', dark: '#1f1f1f' },
  '--dsw-alias-bg-layer-2': { light: '#f1f1f2', dark: '#282828' },
  '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#242424' },
  '--dsw-alias-border-l1': { light: '#e6e6e8', dark: '#343434' },
  '--dsw-alias-border-l2': { light: '#d3d3d6', dark: '#4a4a4a' },
  '--dsw-alias-brand-primary': { light: '#19191b', dark: '#f4f4f5' },
  '--dsw-alias-label-primary': { light: '#202124', dark: '#f2f2f3' },
  '--dsw-alias-label-secondary': { light: '#69696f', dark: '#aaaab0' },
  '--dsw-alias-state-error-primary': { light: '#b42318', dark: '#ff7b72' },
  '--dsw-alias-state-success-primary': { light: '#18794e', dark: '#56d39b' },
  '--dsw-alias-state-warn-primary': { light: '#9a5b00', dark: '#f4b860' },
  '--dsw-specific-sidebar-fill': { light: '#f4f4f5', dark: '#1c1c1d' },
  '--dsw-promax-on-accent': { light: '#ffffff', dark: '#171717' },
  '--dsw-promax-backdrop': { light: 'rgba(17, 17, 18, 0.38)', dark: 'rgba(0, 0, 0, 0.62)' },
  '--dsw-promax-shadow': { light: 'rgba(17, 17, 18, 0.16)', dark: 'rgba(0, 0, 0, 0.48)' },
  '--dsw-promax-status-never-bg': { light: '#fff0ee', dark: '#3a211f' },
  '--dsw-promax-status-stale-bg': { light: '#fff6e5', dark: '#392d1d' },
  '--dsw-promax-status-ok-bg': { light: '#eaf7f0', dark: '#193329' },
  '--dsw-promax-track-hook': { light: '#157a73', dark: '#5ed5c9' },
  '--dsw-promax-track-hook-bg': { light: '#e8f6f4', dark: '#183532' },
  '--dsw-promax-track-llm': { light: '#a85d00', dark: '#f2b45f' },
  '--dsw-promax-track-llm-bg': { light: '#fff3df', dark: '#3a2b19' },
}

export function applyStandaloneTheme(root: HTMLElement = document.documentElement): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = (): void => {
    const mode: keyof ThemeModes = media.matches ? 'dark' : 'light'
    root.dataset.dsDarkTheme = media.matches ? 'true' : 'false'
    for (const [name, value] of Object.entries(PROMAX_THEME_TOKENS)) {
      root.style.setProperty(name, value[mode])
    }
  }
  apply()
  media.addEventListener('change', apply)
  return () => { media.removeEventListener('change', apply) }
}
