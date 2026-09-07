import { useEffect, useLayoutEffect, useState, type ComponentType, type ReactNode } from 'react'

const STYLE_ID = 'promax-ui-layout-styles'

interface SlotService {
  register(options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>): () => void
}

interface ClientContext {
  effect(setup: () => void | (() => void), label?: string): void
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  reflect: { provide(name: string, service: unknown): () => void | Promise<void> }
  slots: SlotService
  theme: { getTheme(): ThemeSnapshot }
}

interface ThemeSnapshot {
  active: {
    colorScheme: 'light' | 'dark'
    tokens: Readonly<Record<string, string>>
  }
}

interface LayoutActions {
  toggleSidebar(): void
  openDetails(): void
  closeDetails(): void
}

interface RootProps extends Record<string, unknown> {
  layoutController: LayoutController
  renderSlot(name: 'sidebar' | 'conversation' | 'details' | 'shell.overlay', owner: Record<string, unknown>): ReactNode
}

export class LayoutController implements LayoutActions {
  #actions: LayoutActions | undefined

  attach(actions: LayoutActions): () => void {
    this.#actions = actions
    return () => {
      if (this.#actions === actions) this.#actions = undefined
    }
  }

  readonly toggleSidebar = (): void => { this.#require().toggleSidebar() }
  readonly openDetails = (): void => { this.#require().openDetails() }
  readonly closeDetails = (): void => { this.#require().closeDetails() }

  #require(): LayoutActions {
    if (this.#actions === undefined) throw new Error('promax layout: root shell is not mounted')
    return this.#actions
  }
}

export const PROMAX_LAYOUT_CSS = String.raw`
.promax-desktop-viewport { width: 100%; height: 100%; overflow: auto; }
.app-shell {
  --promax-left-track: var(--dsw-promax-sidebar-left);
  --promax-right-track: var(--dsw-promax-sidebar-right);
  --promax-composer-height: 106px;
  position: relative;
  display: grid;
  grid-template-columns: var(--promax-left-track) minmax(640px, 1fr) var(--promax-right-track);
  min-width: calc(var(--promax-left-track) + 640px + var(--promax-right-track));
  height: 100%;
  min-height: 560px;
  overflow: hidden;
  background: var(--dsw-promax-shell-background);
}
.app-shell.left-collapsed { --promax-left-track: 64px; }
.app-shell.right-collapsed { --promax-right-track: 44px; }
.promax-layout-sidebar, .promax-layout-details { position: relative; z-index: 2; min-width: 0; min-height: 0; overflow: hidden; }
.promax-layout-sidebar { border-right: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-sidebar-background); }
.promax-layout-details { border-left: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-panel); }
.main-column { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-promax-main-background); }
.promax-conversation-seat { position: absolute; inset: 0; min-width: 0; min-height: 0; }
.promax-shell-overlay { position: absolute; z-index: 20; inset: 0; display: grid; grid-template-columns: var(--promax-left-track) minmax(640px, 1fr) var(--promax-right-track); overflow: hidden; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .app-shell *, .app-shell *::before, .app-shell *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
}
`

function installStyles(): () => void {
  if (document.getElementById(STYLE_ID) === null) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = PROMAX_LAYOUT_CSS
    document.head.append(style)
  }
  return () => { document.getElementById(STYLE_ID)?.remove() }
}

class ThemePresenter {
  readonly #themeColor = document.createElement('meta')
  #appliedTokens: string[] = []

  constructor() {
    this.#themeColor.name = 'theme-color'
  }

  apply(snapshot: ThemeSnapshot): void {
    const { colorScheme, tokens } = snapshot.active
    document.documentElement.style.colorScheme = colorScheme
    if (colorScheme === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
    else document.body.removeAttribute('data-ds-dark-theme')
    for (const name of this.#appliedTokens) document.body.style.removeProperty(name)
    this.#appliedTokens = []
    for (const [name, value] of Object.entries(tokens)) {
      document.body.style.setProperty(name, value)
      this.#appliedTokens.push(name)
    }
    this.#themeColor.content = getComputedStyle(document.body).backgroundColor
    if (!this.#themeColor.isConnected) document.head.append(this.#themeColor)
  }

  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    document.body.removeAttribute('data-ds-dark-theme')
    for (const name of this.#appliedTokens) document.body.style.removeProperty(name)
    this.#appliedTokens = []
    this.#themeColor.remove()
  }
}

export function PromaxAppShell(props: RootProps) {
  const { layoutController, renderSlot } = props
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  useEffect(() => installStyles(), [])
  useLayoutEffect(() => layoutController.attach({
    toggleSidebar: () => { setLeftOpen(value => !value) },
    openDetails: () => { setRightOpen(true) },
    closeDetails: () => { setRightOpen(false) },
  }), [layoutController])

  return <div className="promax-desktop-viewport"><div className={`app-shell${leftOpen ? '' : ' left-collapsed'}${rightOpen ? '' : ' right-collapsed'}`}>
    <aside className="promax-layout-sidebar" aria-label="Promax 导航">
      {renderSlot('sidebar', { collapsed: !leftOpen, width: leftOpen ? 240 : 64 })}
    </aside>
    <main className="main-column">
      <div className="promax-conversation-seat">{renderSlot('conversation', {})}</div>
    </main>
    <aside className="promax-layout-details" aria-label="状态与结果">
      {renderSlot('details', { collapsed: !rightOpen })}
    </aside>
    <div className="promax-shell-overlay" data-shell-overlay>{renderSlot('shell.overlay', { detailsOpen: rightOpen })}</div>
  </div></div>
}

export const inject = ['slots', 'theme']

export function apply(ctx: ClientContext): void {
  const controller = new LayoutController()
  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('layout', controller)
    const disposeRoot = ctx.slots.register({
      name: 'root',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        conversation: { kind: 'single', scope: 'session-maybe' },
        details: { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      inject: () => ({ layoutController: controller }),
    }, PromaxAppShell as unknown as ComponentType<Record<string, unknown>>)
    return () => {
      disposeRoot()
      void disposeService()
    }
  }, 'promax: root shell + layout service')
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', snapshot => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'promax: theme presenter')
}
