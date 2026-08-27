import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { PromaxConsole } from '../components/PromaxConsole.tsx'
import { Icon } from '../components/icons.tsx'
import { installPromaxConsoleStyles } from '../styles.ts'

/** Additive occupant for dsh's existing sidebar.footer.action list slot. */
export function ConsoleLauncher(props: Record<string, unknown>) {
  const wide = props.wide !== false
  const apiBaseUrl = props.apiBaseUrl as string | undefined
  const [consoleOpen, setConsoleOpen] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => installPromaxConsoleStyles(), [])
  useEffect(() => {
    if (!consoleOpen) return
    closeButton.current?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setConsoleOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousOverflow
    }
  }, [consoleOpen])

  return (
    <>
      <button
        className={`promax-sidebar-action${wide ? '' : ' promax-sidebar-action--rail'}`}
        type="button"
        aria-label="管理控制台"
        aria-haspopup="dialog"
        aria-expanded={consoleOpen}
        title="管理控制台"
        onClick={() => { setConsoleOpen(true) }}
      >
        <Icon name="shield" />
        {wide ? <span>管理控制台</span> : null}
      </button>
      {consoleOpen ? createPortal(
        <div
          className="promax-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setConsoleOpen(false) }}
        >
          <section className="promax-dialog" role="dialog" aria-modal="true" aria-label="Promax 管理控制台">
            <button ref={closeButton} className="promax-icon-button promax-dialog-close" type="button" aria-label="关闭管理控制台" onClick={() => { setConsoleOpen(false) }}>
              <Icon name="close" />
            </button>
            <PromaxConsole {...(apiBaseUrl === undefined ? {} : { apiBaseUrl })} />
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
