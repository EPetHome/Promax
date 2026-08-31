import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

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
.app-shell {
  --promax-left-track: var(--dsw-promax-sidebar-left);
  --promax-right-track: var(--dsw-promax-sidebar-right);
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: var(--promax-left-track) minmax(0, 1fr) var(--promax-right-track);
  height: calc(100% - 28px);
  min-height: 620px;
  margin: 14px;
  overflow: hidden;
  border: 1px solid var(--dsw-promax-shell-border);
  border-radius: 28px;
  background: var(--dsw-promax-shell-background);
  box-shadow: var(--dsw-promax-shell-shadow);
  backdrop-filter: blur(18px) saturate(120%);
}
.app-shell.left-collapsed { --promax-left-track: 0px; }
.app-shell.right-collapsed { --promax-right-track: 0px; }
.promax-layout-sidebar,
.promax-layout-details { position: relative; z-index: 2; min-width: 0; min-height: 0; overflow: hidden; }
.promax-layout-sidebar { border-right: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-sidebar-background); }
.promax-layout-details { border-left: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-sidebar-background); }
.left-collapsed > .promax-layout-sidebar,
.right-collapsed > .promax-layout-details { visibility: hidden; pointer-events: none; }
.main-column {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-promax-main-background);
}
.promax-conversation-seat { position: absolute; inset: 0; min-width: 0; min-height: 0; }
.promax-shell-overlay {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  grid-template-columns: var(--promax-left-track) minmax(0, 1fr) var(--promax-right-track);
  overflow: hidden;
  pointer-events: none;
}
.promax-mobile-scrim { display: none; }
@media (max-width: 1180px) {
  .app-shell { --promax-right-track: 0px; grid-template-columns: var(--promax-left-track) minmax(0, 1fr); }
  .promax-layout-details { display: none; }
  .promax-shell-overlay { grid-template-columns: var(--promax-left-track) minmax(0, 1fr); }
}
@media (max-width: 820px) {
  .app-shell { height: 100%; min-height: 0; margin: 0; grid-template-columns: minmax(0, 1fr); border: 0; border-radius: 0; }
  .promax-layout-sidebar {
    position: fixed;
    z-index: 70;
    inset-block: 0;
    inset-inline-start: 0;
    width: min(290px, 86vw);
    visibility: hidden;
    box-shadow: var(--dsw-promax-mobile-drawer-shadow);
    transform: translateX(-105%);
    transition: transform 220ms cubic-bezier(.2,.8,.2,1), visibility 0s linear 220ms;
  }
  .mobile-sidebar-open > .promax-layout-sidebar { visibility: visible; pointer-events: auto; transform: translateX(0); transition: transform 220ms cubic-bezier(.2,.8,.2,1), visibility 0s; }
  .promax-mobile-scrim {
    position: fixed;
    z-index: 65;
    inset: 0;
    display: block;
    visibility: hidden;
    border: 0;
    background: var(--dsw-promax-mobile-scrim);
    opacity: 0;
    pointer-events: none;
    backdrop-filter: blur(2px);
    transition: opacity 180ms ease, visibility 0s linear 180ms;
  }
  .mobile-sidebar-open > .promax-mobile-scrim { visibility: visible; opacity: 1; pointer-events: auto; transition: opacity 180ms ease, visibility 0s; }
  .promax-shell-overlay { grid-template-columns: minmax(0, 1fr); }
}
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
  const shellRef = useRef<HTMLDivElement>(null)
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 820)
  const [rightOpen, setRightOpen] = useState(true)
  const [mobile, setMobile] = useState(() => window.innerWidth <= 820)
  const mobileRef = useRef(mobile)

  useEffect(() => installStyles(), [])
  useEffect(() => {
    const shell = shellRef.current
    if (shell === null) return
    const observer = new ResizeObserver(() => {
      const next = window.innerWidth <= 820
      if (next !== mobileRef.current) {
        mobileRef.current = next
        setLeftOpen(!next)
      }
      setMobile(next)
    })
    observer.observe(shell)
    return () => { observer.disconnect() }
  }, [])
  useLayoutEffect(() => layoutController.attach({
    toggleSidebar: () => { setLeftOpen(value => !value) },
    openDetails: () => { setRightOpen(true) },
    closeDetails: () => { setRightOpen(false) },
  }), [layoutController])

  return <div ref={shellRef} className={`app-shell${leftOpen ? '' : ' left-collapsed'}${rightOpen ? '' : ' right-collapsed'}${mobile && leftOpen ? ' mobile-sidebar-open' : ''}`}>
    <aside className="promax-layout-sidebar" aria-label="Promax 导航">
      {renderSlot('sidebar', { collapsed: !leftOpen, width: leftOpen ? 250 : 0 })}
    </aside>
    <main className="main-column">
      <div className="promax-conversation-seat">{renderSlot('conversation', {})}</div>
    </main>
    <aside className="promax-layout-details" aria-label="状态与结果">
      {renderSlot('details', {})}
    </aside>
    <div className="promax-shell-overlay" data-shell-overlay>{renderSlot('shell.overlay', { detailsOpen: rightOpen })}</div>
    <button className="promax-mobile-scrim" type="button" aria-label="关闭导航" onClick={() => { setLeftOpen(false) }} />
  </div>
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
