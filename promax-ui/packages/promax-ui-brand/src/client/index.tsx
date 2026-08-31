import type { ComponentType } from 'react'
import { installPromaxGlobalTheme, PROMAX_THEME_TOKENS } from '../theme.ts'

interface SlotService {
  inject(name: string, setup: () => unknown): void
  register(options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>): unknown
}

interface ThemeService {
  overrideTokens(source: string, tokens: typeof PROMAX_THEME_TOKENS): () => void
}

interface ClientContext {
  slots: SlotService
  theme: ThemeService
  effect(setup: () => void | (() => void), label?: string): void
}

export const inject = ['slots', 'theme']

function PromaxMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M5 5.5h8.25a5.25 5.25 0 0 1 0 10.5H9v3H5V5.5Zm4 4v2.5h4.25a1.25 1.25 0 1 0 0-2.5H9Z" fill="currentColor" />
      <path d="m16.9 15.2 2.6 3.8h-4.2l-2.4-3.8h4Z" fill="currentColor" opacity=".56" />
    </svg>
  )
}

function PromaxName() {
  return <span style={{ color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 620 }}>Promax</span>
}

const PROMAX_FAVICON_ATTRIBUTE = 'data-promax-favicon'

function faviconLinks(): HTMLLinkElement[] {
  return Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel]'))
    .filter(link => link.rel.toLowerCase().includes('icon'))
}

function promaxFaviconHref(): string {
  const mode = document.documentElement.dataset.dsDarkTheme === 'true' ? 'dark' : 'light'
  const faviconColors = PROMAX_THEME_TOKENS['--dsw-alias-brand-primary']
  if (faviconColors === undefined) throw new Error('Promax favicon theme token is missing')
  const color = faviconColors[mode]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 5.5h8.25a5.25 5.25 0 0 1 0 10.5H9v3H5V5.5Zm4 4v2.5h4.25a1.25 1.25 0 1 0 0-2.5H9Z" fill="${color}"/><path d="m16.9 15.2 2.6 3.8h-4.2l-2.4-3.8h4Z" fill="${color}" fill-opacity=".56"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function apply(ctx: ClientContext): void {
  ctx.effect(installPromaxGlobalTheme, 'promax-ui-brand: global theme surface')
  ctx.effect(() => {
    const previousTitle = document.title
    const previousFaviconLinks = faviconLinks()
    const applyBrandHead = (): void => {
      const baseTitle = 'DSH Local Build'
      if (document.title === baseTitle) document.title = 'Promax'
      else if (document.title.endsWith(` — ${baseTitle}`)) {
        document.title = `${document.title.slice(0, -baseTitle.length)}Promax`
      }

      for (const link of faviconLinks()) {
        if (link.getAttribute(PROMAX_FAVICON_ATTRIBUTE) !== 'true') link.remove()
      }
      let favicon = document.head.querySelector<HTMLLinkElement>(`link[${PROMAX_FAVICON_ATTRIBUTE}="true"]`)
      if (favicon === null) {
        favicon = document.createElement('link')
        favicon.rel = 'icon'
        favicon.type = 'image/svg+xml'
        favicon.setAttribute('sizes', 'any')
        favicon.setAttribute(PROMAX_FAVICON_ATTRIBUTE, 'true')
        document.head.append(favicon)
      }
      const href = promaxFaviconHref()
      if (favicon.getAttribute('href') !== href) favicon.setAttribute('href', href)
    }
    const headObserver = new MutationObserver(applyBrandHead)
    const themeObserver = new MutationObserver(applyBrandHead)
    headObserver.observe(document.head, {
      attributes: true,
      attributeFilter: ['href', 'rel'],
      childList: true,
      subtree: true,
      characterData: true,
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    applyBrandHead()
    return () => {
      headObserver.disconnect()
      themeObserver.disconnect()
      document.head.querySelector<HTMLLinkElement>(`link[${PROMAX_FAVICON_ATTRIBUTE}="true"]`)?.remove()
      for (const link of previousFaviconLinks) document.head.append(link)
      document.title = previousTitle
    }
  }, 'promax-ui-brand: document title and favicon')
  ctx.effect(
    () => ctx.theme.overrideTokens('@promax/promax-ui-brand', PROMAX_THEME_TOKENS),
    'promax-ui-brand: theme tokens',
  )
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, PromaxMark as ComponentType<Record<string, unknown>>)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, PromaxName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, PromaxMark as ComponentType<Record<string, unknown>>)
      })))
}
