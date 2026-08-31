import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { apply } from '../src/client/index.tsx'

function applyBrand(): () => void {
  const cleanups: Array<() => void> = []
  apply({
    effect(setup) {
      const cleanup = setup()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    slots: {
      inject() {},
      register() { return undefined },
    },
    theme: {
      overrideTokens() { return () => {} },
    },
  })
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup()
  }
}

describe('Promax browser brand', () => {
  beforeEach(() => {
    document.head.innerHTML = '<link rel="icon" href="/dsh-favicon.svg">'
    document.documentElement.dataset.dsDarkTheme = 'false'
    document.title = 'DSH Local Build'
  })

  it('installs and removes the locked workbench background layers', () => {
    const cleanup = applyBrand()
    const style = document.querySelector<HTMLStyleElement>('style#promax-global-theme')

    expect(style?.textContent).toContain('background: var(--dsw-promax-body-background)')
    expect(style?.textContent).toContain('background-size: 12px 12px')
    expect(style?.textContent).toContain('.main-column::before')
    expect(style?.textContent).toContain('html { overflow: clip; color-scheme: light; }')
    expect(style?.textContent).toContain('overflow: clip;')
    expect(style?.textContent).toContain('position: fixed;')
    expect(style?.textContent).toContain('inset: 0;')

    cleanup()
    expect(document.querySelector('style#promax-global-theme')).toBeNull()
  })

  it('replaces the dsh favicon and rejects a later host favicon', async () => {
    const cleanup = applyBrand()

    expect(document.title).toBe('Promax')
    expect(document.head.querySelector('link[href="/dsh-favicon.svg"]')).toBeNull()
    const promaxFavicon = document.head.querySelector<HTMLLinkElement>('link[data-promax-favicon="true"]')
    expect(promaxFavicon).not.toBeNull()
    expect(promaxFavicon?.type).toBe('image/svg+xml')
    expect(promaxFavicon?.href).toContain('data:image/svg+xml')

    const lateDshFavicon = document.createElement('link')
    lateDshFavicon.rel = 'shortcut icon'
    lateDshFavicon.href = '/late-dsh-favicon.ico'
    document.head.append(lateDshFavicon)

    await waitFor(() => { expect(lateDshFavicon.isConnected).toBe(false) })
    expect(document.head.querySelectorAll('link[rel*="icon"]')).toHaveLength(1)

    cleanup()
    expect(document.title).toBe('DSH Local Build')
    expect(document.head.querySelector('link[href="/dsh-favicon.svg"]')).not.toBeNull()
  })

  it('keeps the locked Promax palette when the host switches mode', async () => {
    const cleanup = applyBrand()
    const lightHref = document.head.querySelector<HTMLLinkElement>('link[data-promax-favicon="true"]')?.href

    document.documentElement.dataset.dsDarkTheme = 'true'

    await waitFor(() => {
      expect(document.head.querySelector<HTMLLinkElement>('link[data-promax-favicon="true"]')?.href).toBe(lightHref)
    })
    cleanup()
  })
})
