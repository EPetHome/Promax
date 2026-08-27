import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ConsoleLauncher } from '../src/client/ConsoleLauncher.tsx'

describe('ConsoleLauncher', () => {
  beforeEach(() => window.localStorage.clear())

  it('opens and closes the management console from the additive sidebar action', () => {
    render(<ConsoleLauncher wide apiBaseUrl="/promax-api" />)

    const trigger = screen.getByRole('button', { name: '管理控制台' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)

    expect(screen.getByRole('dialog', { name: 'Promax 管理控制台' })).toBeVisible()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: '关闭管理控制台' }))
    expect(screen.queryByRole('dialog', { name: 'Promax 管理控制台' })).not.toBeInTheDocument()
  })

  it('keeps the collapsed rail action accessible without rendering its label', () => {
    render(<ConsoleLauncher wide={false} />)

    const trigger = screen.getByRole('button', { name: '管理控制台' })
    expect(trigger).toHaveClass('promax-sidebar-action--rail')
    expect(trigger.querySelector('span')).toBeNull()
  })
})
