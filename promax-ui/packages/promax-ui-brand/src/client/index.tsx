import type { ComponentType } from 'react'
import { PROMAX_THEME_TOKENS } from '../theme.ts'

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

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const previousTitle = document.title
    const applyTitle = (): void => {
      const baseTitle = 'DSH Local Build'
      if (document.title === baseTitle) document.title = 'Promax'
      else if (document.title.endsWith(` — ${baseTitle}`)) {
        document.title = `${document.title.slice(0, -baseTitle.length)}Promax`
      }
    }
    const observer = new MutationObserver(applyTitle)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    applyTitle()
    return () => {
      observer.disconnect()
      document.title = previousTitle
    }
  }, 'promax-ui-brand: document title')
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
