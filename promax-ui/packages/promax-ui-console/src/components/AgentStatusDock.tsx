import { useMemo } from 'react'

interface RunningToolCall {
  name: string
}

interface ConversationStatusNode {
  kind: string
  turn?: number
}

export interface AgentStatusSnapshot {
  running: boolean
  runningCalls: readonly RunningToolCall[]
  pending: readonly unknown[]
  queue: readonly unknown[]
  removed: boolean
  openState: string
  lastAgentError: string | null
  nodes: readonly ConversationStatusNode[]
  turnEnds: ReadonlyMap<number, number>
}

export interface AgentStatusDockProps {
  session: AgentStatusSnapshot
}

interface AgentStatusPresentation {
  label: string
  detail: string
  tone: 'idle' | 'active' | 'warning' | 'error'
}

export function AgentStatusDock({ session }: AgentStatusDockProps) {
  const status = useMemo(() => deriveAgentStatus(session), [session])
  const facts = [
    session.runningCalls.length > 0 ? `工具 ${session.runningCalls.length}` : undefined,
    session.pending.length > 0 ? `待确认 ${session.pending.length}` : undefined,
    session.queue.length > 0 ? `队列 ${session.queue.length}` : undefined,
  ].filter((value): value is string => value !== undefined)

  return (
    <section
      className={`promax-agent-status promax-agent-status--${status.tone}`}
      aria-atomic="true"
      aria-label="Agent 当前状态"
      role="status"
    >
      <div className="promax-agent-status-summary">
        <span className="promax-agent-status-dot" aria-hidden="true" />
        <strong>{status.label}</strong>
        <span className="promax-agent-status-detail">{status.detail}</span>
      </div>
      <div className="promax-agent-status-facts" aria-label="运行状态明细">
        {facts.length === 0
          ? <span>{status.tone === 'error' ? '本轮未完成' : status.tone === 'active' ? '执行中' : '尚未开始执行'}</span>
          : facts.map(fact => <span className="promax-agent-status-fact" key={fact}>{fact}</span>)}
        <span className="promax-agent-status-trajectory">轨迹页可查看过程</span>
      </div>
    </section>
  )
}

export function deriveAgentStatus(session: AgentStatusSnapshot): AgentStatusPresentation {
  if (session.removed) {
    return { label: '会话已断开', detail: '当前会话不可继续发送', tone: 'error' }
  }
  if (session.openState === 'error' || session.lastAgentError !== null) {
    return { label: 'Agent 执行异常', detail: '查看对话中的错误信息后重试', tone: 'error' }
  }
  if (session.pending.length > 0) {
    return { label: '等待你的确认', detail: 'Agent 已暂停在需要人工决定的位置', tone: 'warning' }
  }
  const runningTool = session.runningCalls[0]
  if (runningTool !== undefined) {
    const suffix = session.runningCalls.length > 1
      ? `${runningTool.name} 等 ${session.runningCalls.length} 个工具`
      : runningTool.name
    return { label: 'Agent 正在执行', detail: `正在使用 ${suffix}`, tone: 'active' }
  }
  if (session.running) {
    return { label: 'Agent 正在处理', detail: '正在推理或组织下一步行动', tone: 'active' }
  }
  if (session.openState === 'loading') {
    return { label: '正在恢复会话', detail: '正在载入历史状态', tone: 'active' }
  }
  if (session.queue.length > 0) {
    return { label: '任务已排队', detail: `还有 ${session.queue.length} 条消息等待处理`, tone: 'warning' }
  }
  if (latestCompletedTurnFailed(session)) {
    return { label: 'Agent 执行异常', detail: '最近一轮未完成，请查看对话中的错误信息', tone: 'error' }
  }
  return { label: '等待任务', detail: '当前没有正在执行的任务', tone: 'idle' }
}

function latestCompletedTurnFailed(session: AgentStatusSnapshot): boolean {
  let latestTurn: number | undefined
  let latestEndSeq = -1
  for (const [turn, endSeq] of session.turnEnds) {
    if (endSeq <= latestEndSeq) continue
    latestTurn = turn
    latestEndSeq = endSeq
  }
  if (latestTurn === undefined) return false
  return session.nodes.some(node => node.kind === 'turn-error' && node.turn === latestTurn)
}
