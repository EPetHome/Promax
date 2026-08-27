import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  AgentStatusDock,
  type AgentStatusSnapshot,
  deriveAgentStatus,
} from '../src/components/AgentStatusDock.tsx'

const idle: AgentStatusSnapshot = {
  running: false,
  runningCalls: [],
  pending: [],
  queue: [],
  removed: false,
  openState: 'open',
  lastAgentError: null,
  nodes: [],
  turnEnds: new Map(),
}

describe('AgentStatusDock', () => {
  it('prioritizes a pending human decision over running work', () => {
    const status = deriveAgentStatus({
      ...idle,
      running: true,
      runningCalls: [{ name: 'exec' }],
      pending: [{}],
    })

    expect(status.label).toBe('等待你的确认')
    expect(status.tone).toBe('warning')
  })

  it('summarizes the active tool and exposes contextual counts', () => {
    render(<AgentStatusDock session={{
      ...idle,
      running: true,
      runningCalls: [{ name: 'exec' }, { name: 'read' }],
      queue: [{}],
    }} />)

    expect(screen.getByRole('status', { name: 'Agent 当前状态' })).toHaveTextContent('Agent 正在执行')
    expect(screen.getByText('正在使用 exec 等 2 个工具')).toBeVisible()
    expect(screen.getByText('工具 2')).toBeVisible()
    expect(screen.getByText('队列 1')).toBeVisible()
  })

  it('renders a clear idle state without inventing progress', () => {
    render(<AgentStatusDock session={idle} />)

    expect(screen.getByRole('status', { name: 'Agent 当前状态' })).toHaveTextContent('等待任务')
    expect(screen.getByText('当前没有正在执行的任务')).toBeVisible()
    expect(screen.getByText('尚未开始执行')).toBeVisible()
  })

  it('keeps the latest terminal turn failure visible after the run settles', () => {
    render(<AgentStatusDock session={{
      ...idle,
      nodes: [{ kind: 'turn-error', turn: 1 }],
      turnEnds: new Map([[1, 17]]),
    }} />)

    const status = screen.getByRole('status', { name: 'Agent 当前状态' })
    expect(status).toHaveTextContent('Agent 执行异常')
    expect(status).toHaveTextContent('最近一轮未完成')
    expect(status).toHaveTextContent('本轮未完成')
    expect(status).not.toHaveTextContent('尚未开始执行')
  })

  it('does not keep an older turn failure sticky after a later turn succeeds', () => {
    const status = deriveAgentStatus({
      ...idle,
      nodes: [{ kind: 'turn-error', turn: 1 }],
      turnEnds: new Map([[1, 17], [2, 29]]),
    })

    expect(status.label).toBe('等待任务')
    expect(status.tone).toBe('idle')
  })

  it('shows an active retry ahead of the previous terminal failure', () => {
    const status = deriveAgentStatus({
      ...idle,
      running: true,
      nodes: [{ kind: 'turn-error', turn: 1 }],
      turnEnds: new Map([[1, 17]]),
    })

    expect(status.label).toBe('Agent 正在处理')
    expect(status.tone).toBe('active')
  })
})
