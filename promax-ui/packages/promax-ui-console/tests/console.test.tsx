import type {
  ConsoleArtifactsResponse,
  ConsoleOverviewResponse,
  ConsoleTelemetryResponse,
  ConsoleUsersResponse,
  LoginResponse,
  MeResponse,
} from '@promax/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PromaxConsole } from '../src/components/PromaxConsole.tsx'
import { BrowserTokenStore } from '../src/data/token-store.ts'
import { contractFixture, jsonResponse } from './fixtures.ts'

const fixtures = {
  overview: contractFixture<ConsoleOverviewResponse>('console.overview.response.json'),
  users: contractFixture<ConsoleUsersResponse>('console.users.response.json'),
  artifacts: contractFixture<ConsoleArtifactsResponse>('console.artifacts.response.json'),
  telemetry: contractFixture<ConsoleTelemetryResponse>('console.telemetry.response.json'),
}

describe('PromaxConsole', () => {
  beforeEach(() => {
    window.localStorage.clear()
    new BrowserTokenStore().write({
      tokens: contractFixture<LoginResponse>('auth.login.response.json'),
      user: contractFixture<MeResponse>('me.response.json'),
    })
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/console/overview') return jsonResponse(fixtures.overview)
      if (path === '/api/v1/console/users') return jsonResponse(fixtures.users)
      if (path === '/api/v1/console/artifacts') return jsonResponse(fixtures.artifacts)
      if (path === '/api/v1/console/telemetry') return jsonResponse(fixtures.telemetry)
      throw new Error(`Unexpected URL: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('formats coverage as a percentage and puts never before stale', async () => {
    const { container } = render(<PromaxConsole standalone />)

    expect(await screen.findByText('66.7%')).toBeVisible()
    expect(screen.getByText('2 人需要关注')).toBeVisible()
    const attentionStatuses = [...container.querySelectorAll('.promax-attention-item .promax-status')]
      .map(element => element.textContent)
    expect(attentionStatuses).toEqual(['从未上报', '已超期'])
  })

  it('associates artifact filters with their form controls', async () => {
    render(<PromaxConsole standalone />)
    await screen.findByText('上报覆盖率')

    fireEvent.click(screen.getByRole('button', { name: '产出物' }))

    expect(await screen.findByRole('textbox', { name: '工号' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: '项目' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '类型' })).toBeVisible()
  })

  it('renders hook and llm usage in separate columns without a combined total', async () => {
    render(<PromaxConsole standalone />)
    await screen.findByText('上报覆盖率')

    fireEvent.click(screen.getByRole('button', { name: '用量' }))

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'hook 轨用量' })).toBeVisible()
      expect(screen.getByRole('region', { name: 'llm 轨用量' })).toBeVisible()
    })
    expect(screen.queryByText(/总用量|两轨合计/u)).not.toBeInTheDocument()
    expect(screen.getAllByText('本轨合计')).toHaveLength(2)
  })
})
