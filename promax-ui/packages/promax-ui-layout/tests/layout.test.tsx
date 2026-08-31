import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { LayoutController, apply } from '../src/client/index.tsx'

describe('Promax root layout', () => {
  it('declares exactly the four inherited child slots and provides ctx.layout', () => {
    let provided: unknown
    let registration: Record<string, unknown> | undefined
    const register = vi.fn((options: Record<string, unknown>, _component: ComponentType<Record<string, unknown>>) => {
      registration = options
      return () => {}
    })
    apply({
      effect: setup => { setup() },
      on: () => () => {},
      reflect: { provide: (_name, service) => { provided = service; return () => {} } },
      slots: { register },
      theme: {
        getTheme: () => ({ active: { colorScheme: 'light', tokens: { '--dsw-promax-canvas': '#f3f4f7' } } }),
      },
    })

    expect(provided).toBeInstanceOf(LayoutController)
    expect(registration).toMatchObject({
      name: 'root',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        conversation: { kind: 'single', scope: 'session-maybe' },
        details: { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    })
    expect(Object.keys(registration?.children as Record<string, unknown>)).toEqual(['sidebar', 'conversation', 'details', 'shell.overlay'])
  })

  it('forwards all three layout actions to the mounted shell', () => {
    const controller = new LayoutController()
    const actions = { toggleSidebar: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn() }
    const detach = controller.attach(actions)
    const { toggleSidebar, openDetails, closeDetails } = controller
    toggleSidebar()
    openDetails()
    closeDetails()
    expect(actions.toggleSidebar).toHaveBeenCalledOnce()
    expect(actions.openDetails).toHaveBeenCalledOnce()
    expect(actions.closeDetails).toHaveBeenCalledOnce()
    detach()
    expect(() => { controller.toggleSidebar() }).toThrow(/not mounted/u)
  })
})
