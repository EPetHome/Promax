import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '../components/icons.tsx'
import { installPromaxConsoleStyles } from '../styles.ts'
import { ConsoleLauncher } from './ConsoleLauncher.tsx'
import { friendlyTeamError, routedTeamPrompt } from './team-api.ts'
import {
  GENERAL_PRESET_ID,
  PRODUCT_TEAM_ID,
  PRODUCT_PRESET_ID,
  applyTeamProvisioningResult,
  attachWorkspace,
  bindTeamSession,
  bindingForSession,
  createTeam,
  markTeamProvisioning,
  revisionLabel,
  selectGeneralWorkspace,
  selectTeamHome,
  selectTeamSession,
  teamForSession,
  updateTeamDefinition,
  useTeamState,
  type PromaxTeam,
  type PromaxTeamState,
  type TeamConfigurationSource,
  type TeamProvisioningResult,
  type TeamRevisionNumber,
} from './team-state.ts'

export interface WorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}

export interface WorkspaceListState {
  items: readonly WorkspaceView[]
  archivedSessionIds: readonly string[]
  state: 'idle' | 'loading' | 'error'
  error: { message?: string } | null
}

export interface SessionSummary {
  id: string
  displayTitle: string
  cwd?: string
  agentPreset?: string
  running: boolean
  completed?: boolean
  blank: boolean
  updatedAt: number
}

export interface SessionListState {
  ids: string[]
  byId: Record<string, SessionSummary | undefined>
  current: string | undefined
  phase: string
}

export type SelectorHook<State> = <Selected>(selector: (state: State) => Selected) => Selected

export interface WorkspaceShellActions {
  startSession: (workspaceId: string, presetId: string) => Promise<string>
  sendPrompt: (sessionId: string, text: string) => Promise<void>
  sendTeamPrompt: (input: { sessionId: string; teamId: string; text: string; targetMemberIds: string[] }) => Promise<void>
  openSession: (sessionId: string) => void
  clearSession: () => void
  createTeamWorkspace: (input: { teamId: string; teamName: string; parentPath: string }) => Promise<WorkspaceView>
  openWorkspacePath: (path: string) => Promise<void>
  provisionTeam?: (input: TeamProvisioningRequest) => Promise<TeamProvisioningResult>
  publishTeamDraft?: (definition: Record<string, unknown>) => Promise<TeamProvisioningResult>
  teamRoutingAvailable: boolean
}

export interface TeamProvisioningRequest {
  teamId: string
  teamName: string
  teamDescription?: string
  workspaceRef?: string
  configurationSessionId?: string | null
  source: TeamConfigurationSource
  documents: Array<{ name: string; relativePath?: string; bytes: number; content: string }>
}

interface RuntimeProps extends WorkspaceShellActions {
  apiBaseUrl?: string
  useWorkspaces: SelectorHook<WorkspaceListState>
  useSessions: SelectorHook<SessionListState>
}

interface SidebarProps extends RuntimeProps {
  wide?: boolean
  expandSidebar?: () => void
}

interface ContextRows {
  title: string
  rows: SessionSummary[]
  team?: PromaxTeam
  workspace?: WorkspaceView
}

function isPathLeaf(path: string, leaf: string): boolean {
  return path.replace(/[/\\]+$/u, '').split(/[/\\]/u).pop()?.toLowerCase() === leaf
}

export function generalWorkspaceOf(workspaces: readonly WorkspaceView[]): WorkspaceView | undefined {
  return workspaces.find(workspace => workspace.title === '通用工作区' || isPathLeaf(workspace.path, 'general'))
}

function productWorkspaceOf(workspaces: readonly WorkspaceView[]): WorkspaceView | undefined {
  return workspaces.find(workspace => workspace.title === '产品' || isPathLeaf(workspace.path, 'product'))
}

export function workspacesForTeam(team: PromaxTeam, workspaces: readonly WorkspaceView[]): WorkspaceView[] {
  const ids = new Set(team.workspaceIds)
  if (team.id === PRODUCT_TEAM_ID) {
    const product = productWorkspaceOf(workspaces)
    if (product !== undefined) ids.add(product.workspaceId)
  }
  return workspaces.filter(workspace => ids.has(workspace.workspaceId))
}

function rowsFromIds(ids: readonly string[], sessions: SessionListState, archived: readonly string[]): SessionSummary[] {
  const hidden = new Set(archived)
  const seen = new Set<string>()
  const rows: SessionSummary[] = []
  for (const id of ids) {
    const session = sessions.byId[id]
    if (session === undefined || hidden.has(id) || seen.has(id)) continue
    seen.add(id)
    rows.push(session)
  }
  return rows.sort((left, right) => right.updatedAt - left.updatedAt)
}

export function sessionsForTeam(
  team: PromaxTeam,
  state: PromaxTeamState,
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState,
  archived: readonly string[],
): SessionSummary[] {
  const bound = state.sessionBindings.filter(binding => binding.teamId === team.id).map(binding => binding.sessionId)
  if (team.id !== PRODUCT_TEAM_ID) return rowsFromIds(bound, sessions, archived)
  const compatibility = workspacesForTeam(team, workspaces)
    .flatMap(workspace => workspace.sessionIds)
    .filter(sessionId => sessions.byId[sessionId]?.agentPreset === PRODUCT_PRESET_ID)
  return rowsFromIds([...bound, ...compatibility], sessions, archived)
}

export function contextRows(
  state: PromaxTeamState,
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState,
  archived: readonly string[],
): ContextRows {
  if (state.selected.kind === 'general') {
    const workspace = generalWorkspaceOf(workspaces)
    const teamBoundIds = new Set(state.sessionBindings.map(binding => binding.sessionId))
    const ids = workspace?.sessionIds.filter(sessionId => !teamBoundIds.has(sessionId)) ?? []
    return { title: '通用会话', rows: rowsFromIds(ids, sessions, archived), ...(workspace === undefined ? {} : { workspace }) }
  }
  const selected = state.selected
  const team = state.teams.find(candidate => candidate.id === selected.teamId)
  if (team === undefined) return { title: '团队会话', rows: [] }
  const teamWorkspaces = workspacesForTeam(team, workspaces)
  return {
    title: `${team.name}的会话`,
    rows: sessionsForTeam(team, state, workspaces, sessions, archived),
    team,
    ...(teamWorkspaces[0] === undefined ? {} : { workspace: teamWorkspaces[0] }),
  }
}

function revisionForSession(state: PromaxTeamState, team: PromaxTeam, session: SessionSummary): TeamRevisionNumber | undefined {
  const binding = bindingForSession(state, session.id)
  if (binding?.teamId === team.id) return binding.revision
  if (team.id === PRODUCT_TEAM_ID && session.agentPreset === PRODUCT_PRESET_ID) return 'compat'
  return undefined
}

export function EmptyHeroSeat() {
  return null
}

function SessionRow({
  session,
  current,
  revision,
  onOpen,
}: {
  session: SessionSummary
  current: boolean
  revision?: TeamRevisionNumber | undefined
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      className="promax-session-row"
      aria-current={current ? 'page' : undefined}
      onClick={onOpen}
    >
      <span className="promax-session-row-copy">
        <span className="promax-session-row-title">{session.blank ? '新会话' : session.displayTitle}</span>
        {revision === undefined ? null : <small>{revisionLabel(revision)}</small>}
      </span>
      <span
        className={`promax-session-indicator${session.running ? ' promax-session-indicator--running' : ''}${session.completed ? ' promax-session-indicator--done' : ''}`}
        aria-label={session.running ? '执行中' : session.completed ? '已完成' : '空闲'}
      />
    </button>
  )
}

export function PromaxSessionBrowser({
  wide = true,
  expandSidebar,
  useWorkspaces,
  useSessions,
  startSession,
  openSession,
}: SidebarProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaceState = useWorkspaces(state => state)
  const sessionState = useSessions(state => state)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!wide) {
    return (
      <button
        type="button"
        className="promax-context-rail-button"
        aria-label="展开当前上下文会话"
        title="当前上下文会话"
        onClick={expandSidebar}
      >
        <Icon name="team" size={19} />
      </button>
    )
  }

  const context = contextRows(teamState, workspaceState.items, sessionState, workspaceState.archivedSessionIds)
  const canStart = context.workspace !== undefined
    && (context.team === undefined || context.team.activeRevision !== undefined)

  const startCurrent = (): void => {
    if (!canStart || context.workspace === undefined || busy) return
    const team = context.team
    const presetId = team?.activeRevision?.presetId ?? GENERAL_PRESET_ID
    setBusy(true)
    setError(null)
    void startSession(context.workspace.workspaceId, presetId).then(sessionId => {
      if (team === undefined) {
        selectGeneralWorkspace(context.workspace?.workspaceId)
      } else if (team.activeRevision !== undefined) {
        const workspaceId = context.workspace?.workspaceId
        bindTeamSession({
          sessionId,
          teamId: team.id,
          revision: team.activeRevision.revision,
          presetId: team.activeRevision.presetId,
          ...(workspaceId === undefined ? {} : { workspaceId }),
        })
      }
    }).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setBusy(false) })
  }

  return (
    <nav className="promax-session-browser" aria-label="当前上下文会话">
      <div className="promax-session-browser-heading">
        <div>
          <span className="promax-eyebrow">当前入口</span>
          <strong>{context.title}</strong>
        </div>
        <Icon name={context.team === undefined ? 'home' : 'team'} size={17} />
      </div>
      <button type="button" className="promax-new-session" disabled={!canStart || busy} onClick={startCurrent}>
        <Icon name="plus" size={15} />
        {context.team === undefined ? '新建会话' : '新建团队会话'}
      </button>
      {context.team !== undefined && context.team.activeRevision === undefined ? (
        <div className="promax-session-note">请先在团队聊天页完成配置。</div>
      ) : null}
      <div className="promax-session-list">
        {workspaceState.state === 'loading' ? <div className="promax-session-empty">正在读取会话…</div> : null}
        {workspaceState.state === 'error' ? <div className="promax-session-error">工作区读取失败</div> : null}
        {workspaceState.state !== 'loading' && context.rows.length === 0 ? <div className="promax-session-empty">还没有会话</div> : null}
        {context.rows.map(session => (
          <SessionRow
            key={session.id}
            session={session}
            current={sessionState.current === session.id}
            {...context.team === undefined ? {} : { revision: revisionForSession(teamState, context.team, session) }}
            onOpen={() => {
              if (context.team === undefined) {
                selectGeneralWorkspace(context.workspace?.workspaceId)
              } else {
                selectTeamSession(context.team.id, session.id, context.workspace?.workspaceId)
              }
              openSession(session.id)
            }}
          />
        ))}
      </div>
      {error === null ? null : <div className="promax-session-error" role="alert">{error}</div>}
      <p className="promax-session-browser-foot">Promax 只显示当前入口归属的会话</p>
    </nav>
  )
}

function TeamSettings({
  team,
  workspace,
  onOpenWorkspace,
  onClose,
}: {
  team: PromaxTeam
  workspace: WorkspaceView | undefined
  onOpenWorkspace: () => void
  onClose: () => void
}) {
  return (
    <section className="promax-team-editor" aria-label={`${team.name}团队设置`}>
      <div className="promax-team-section-heading">
        <button type="button" className="promax-button" onClick={onClose}>返回团队</button>
        <div><span className="promax-eyebrow">团队设置</span><h2>基本信息</h2><p>成员和能力在团队聊天中配置，不需要在设置里逐项维护。</p></div>
      </div>
      <div className="promax-simple-settings">
        <label className="promax-field">
          <span>团队名称</span>
          <input className="promax-input" value={team.name} onChange={event => {
            const name = event.currentTarget.value
            updateTeamDefinition(team.id, current => ({ ...current, name }))
          }} />
        </label>
        <label className="promax-field">
          <span>团队简介</span>
          <textarea className="promax-textarea promax-textarea--compact" value={team.description} placeholder="简单说明这个团队负责什么（选填）" onChange={event => {
            const description = event.currentTarget.value
            updateTeamDefinition(team.id, current => ({ ...current, description }))
          }} />
        </label>
        <div className="promax-settings-card">
          <div><strong>团队工作区</strong><p>文件范围由 Promax 自动分配，这里只提供打开入口。</p></div>
          <div className="promax-workspace-summary">
            <Icon name="folder" size={17} />
            <span><strong>{workspace?.title ?? '正在分配'}</strong><small title={workspace?.path}>{workspace?.path ?? '创建后由 Promax 自动生成'}</small></span>
            <button type="button" className="promax-button" disabled={workspace === undefined} onClick={onOpenWorkspace}>打开位置</button>
          </div>
        </div>
      </div>
    </section>
  )
}

interface SnapshotStore<State> {
  getSnapshot(): State
  subscribe(listener: () => void): () => void
}

interface NativeInputOccurrence {
  occurrenceId: number
  source: string
  ref: string
  offset: number
  length: number
  label: string
}

interface NativeInputState {
  draft: string
  draftRev: number
  phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  occurrences: readonly NativeInputOccurrence[]
}

const nativeTeamPromptHandoffs = new Map<string, string>()

function stageNativeTeamPrompt(sessionId: string, text: string, targetMemberIds: readonly string[]): void {
  const prompt = routedTeamPrompt(text, targetMemberIds)
  if (prompt !== '') nativeTeamPromptHandoffs.set(sessionId, prompt)
}

interface NativeConversationSnapshot {
  nodes: readonly unknown[]
  turnTimings: ReadonlyMap<number, { startTime: number; endTime?: number }>
  running: boolean
}

type NativeSessionHook = <Selected>(selector: (state: NativeConversationSnapshot) => Selected) => Selected

interface TeamMentionControlProps {
  sessionId: string
  input: NativeInputState
  inputActions: { setDraft(text: string): void; submit(): void }
  menu: SnapshotStore<{ open: boolean }>
  launcher: SnapshotStore<string | null>
  toggleTeamMention(draft: string, draftRev: number): void
}

/** Add stable team-member references to dsh's native composer without replacing it. */
export function PromaxTeamMentionControl({
  sessionId,
  input,
  inputActions,
  menu,
  launcher,
  toggleTeamMention,
}: TeamMentionControlProps) {
  const state = useTeamState()
  const team = teamForSession(state, sessionId)
  const menuOpen = useSyncExternalStore(menu.subscribe, () => menu.getSnapshot().open, () => false)
  const launcherName = useSyncExternalStore(launcher.subscribe, () => launcher.getSnapshot(), () => null)
  const expanded = menuOpen && launcherName === 'promax-team-member'
  const wasExpanded = useRef(false)
  const selected = input.occurrences.filter(occurrence => occurrence.source === 'promax-team-member')

  useEffect(() => {
    const handoff = nativeTeamPromptHandoffs.get(sessionId)
    if (handoff === undefined || input.phase !== 'plain' || input.draft !== '') return
    nativeTeamPromptHandoffs.delete(sessionId)
    inputActions.setDraft(handoff)
    queueMicrotask(() => { inputActions.submit() })
  }, [input.draft, input.phase, inputActions, sessionId])

  useEffect(() => {
    if (wasExpanded.current && !expanded) {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
      textarea?.focus({ preventScroll: true })
    }
    wasExpanded.current = expanded
  }, [expanded])

  if (team === undefined || team.activeRevision === undefined) return null

  const remove = (occurrence: NativeInputOccurrence): void => {
    const before = input.draft.slice(0, occurrence.offset)
    let after = input.draft.slice(occurrence.offset + occurrence.length)
    if (after.startsWith(' ')) after = after.slice(1)
    inputActions.setDraft(`${before}${after}`)
  }

  return (
    <div className="promax-native-mentions" aria-label="已指定团队成员">
      <button
        type="button"
        className="promax-native-mention-trigger"
        aria-label="指定团队成员"
        aria-expanded={expanded}
        disabled={input.phase !== 'plain' || team.members.length === 0}
        onPointerDown={event => { event.stopPropagation() }}
        onClick={() => { toggleTeamMention(input.draft, input.draftRev) }}
      >@</button>
      {selected.map(occurrence => (
        <button
          key={occurrence.occurrenceId}
          type="button"
          className="promax-native-mention-chip"
          aria-label={`移除 @${occurrence.label}`}
          onClick={() => { remove(occurrence) }}
        >@{occurrence.label}<Icon name="close" size={11} /></button>
      ))}
    </div>
  )
}

interface TeamSessionHeaderProps {
  sessionId: string
  useSession: NativeSessionHook
}

/** Team context and a paged stable-member drawer added to the native session header. */
export function PromaxTeamSessionHeader({ sessionId, useSession }: TeamSessionHeaderProps) {
  const state = useTeamState()
  const team = teamForSession(state, sessionId)
  const running = useSession(snapshot => snapshot.running)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const members = team === undefined ? [] : [team.coordinator, ...team.members.filter(member => member.enabled)]
  const pageCount = Math.max(1, Math.ceil(members.length / 6))
  const currentPage = Math.min(page, pageCount - 1)
  const pageMembers = members.slice(currentPage * 6, currentPage * 6 + 6)

  useEffect(() => { if (open) closeRef.current?.focus() }, [open])
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  if (team === undefined) return null

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <>
      <span className="promax-native-team-label" title={`${team.name} · ${team.activeRevision?.presetId ?? '未配置'}`}>
        <Icon name="team" size={13} />{team.name}{running ? <i>处理中</i> : null}
      </span>
      <button ref={triggerRef} type="button" className="promax-native-members-trigger" aria-expanded={open} onClick={() => { setOpen(true) }}>
        团队成员 · {members.length}
      </button>
      {open ? createPortal(
        <div className="promax-members-layer">
          <button type="button" className="promax-members-scrim" aria-label="关闭团队成员" onClick={close} />
          <aside className="promax-members-drawer" aria-label={`${team.name}团队成员`}>
            <header><div><span className="promax-eyebrow">Promax 团队</span><h2>团队成员</h2><p>{team.name} · 第 {currentPage + 1} / {pageCount} 页</p></div><button ref={closeRef} type="button" className="promax-icon-button" aria-label="关闭团队成员抽屉" onClick={close}><Icon name="close" size={15} /></button></header>
            <div className="promax-members-list">
              {pageMembers.map(member => <article key={member.memberId} className="promax-member-row"><span className="promax-team-member-avatar"><Icon name="agent" size={16} /></span><div><strong>{member.displayName}</strong><small>{member.role === 'coordinator' ? 'Coordinator' : 'Worker'} · {member.memberId}</small><p>{member.objective || '已配置团队职责'}</p></div><em>已配置</em></article>)}
            </div>
            {pageCount > 1 ? <footer className="promax-pagination"><button type="button" className="promax-button" disabled={currentPage === 0} onClick={() => { setPage(value => Math.max(0, value - 1)) }}>上一页</button><span>{currentPage + 1} / {pageCount} · 共 {members.length} 名</span><button type="button" className="promax-button" disabled={currentPage >= pageCount - 1} onClick={() => { setPage(value => Math.min(pageCount - 1, value + 1)) }}>下一页</button></footer> : null}
          </aside>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

interface ProcessActionProps {
  sessionId: string
  messageId: string
  useSession: NativeSessionHook
}

/** Safe per-response process summary; detailed evidence remains in native Trajectory. */
export function PromaxProcessAction({ sessionId, messageId, useSession }: ProcessActionProps) {
  const state = useTeamState()
  const team = teamForSession(state, sessionId)
  const snapshot = useSession(value => value)
  if (team === undefined) return null
  const assistant = snapshot.nodes.find(node => {
    if (typeof node !== 'object' || node === null) return false
    const row = node as Record<string, unknown>
    return row.kind === 'assistant' && String(row.messageId ?? '') === String(messageId)
  }) as Record<string, unknown> | undefined
  if (assistant === undefined || typeof assistant.turn !== 'number') return null
  const turn = assistant.turn
  const timing = snapshot.turnTimings.get(turn)
  const duration = timing?.endTime === undefined ? undefined : Math.max(0, timing.endTime - timing.startTime)
  const toolCalls = snapshot.nodes.reduce<number>((count, node) => {
    if (typeof node !== 'object' || node === null) return count
    const row = node as Record<string, unknown>
    if (row.kind !== 'assistant' || row.turn !== turn || !Array.isArray(row.blocks)) return count
    return count + row.blocks.filter(block => typeof block === 'object' && block !== null && (block as Record<string, unknown>).kind === 'tool-call').length
  }, 0)
  const failed = snapshot.nodes.some(node => typeof node === 'object' && node !== null && (node as Record<string, unknown>).kind === 'turn-error' && (node as Record<string, unknown>).turn === turn)
  return (
    <details className="promax-process-detail">
      <summary>处理过程</summary>
      <div className="promax-process-panel">
        <strong>第 {turn} 轮 · {failed ? '失败' : '完成'}</strong>
        <ol><li>任务提交：已接收</li><li>团队协调：已执行</li>{toolCalls > 0 ? <li>成员/工具调用：{toolCalls} 项</li> : null}<li>结果汇总：{failed ? '未完成' : '已完成'}</li></ol>
        <p>{duration === undefined ? '详细时间线可在 Trajectory 查看。' : `耗时 ${(duration / 1000).toFixed(1)} 秒；详细时间线可在 Trajectory 查看。`}</p>
      </div>
    </details>
  )
}

interface TeamHomeProps extends RuntimeProps {
  team: PromaxTeam
  railOpen: boolean
}

function PromaxTeamHome({
  team,
  railOpen,
  useWorkspaces,
  useSessions,
  startSession,
  openSession,
  openWorkspacePath,
  provisionTeam,
  publishTeamDraft,
  teamRoutingAvailable,
}: TeamHomeProps) {
  const teamState = useTeamState()
  const workspaceState = useWorkspaces(state => state)
  const sessionState = useSessions(state => state)
  const workspaces = workspacesForTeam(team, workspaceState.items)
  const sessions = sessionsForTeam(team, teamState, workspaceState.items, sessionState, workspaceState.archivedSessionIds)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [targetMemberIds, setTargetMemberIds] = useState<string[]>([])
  const [mentionsOpen, setMentionsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [packageSummary, setPackageSummary] = useState<string | null>(null)
  const packageInputId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const inFlightRef = useRef(false)
  const configured = team.activeRevision !== undefined && team.provisioning.state === 'ready'
  const canStart = configured && workspaces[0] !== undefined
  const canConfigure = !configured && workspaces[0] !== undefined && provisionTeam !== undefined

  const closeMentions = (): void => {
    setMentionsOpen(false)
    textareaRef.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (!mentionsOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && composerRef.current?.contains(event.target)) return
      closeMentions()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMentions()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [mentionsOpen])

  const startTeamSession = (prompt?: string, targets: string[] = []): void => {
    const revision = team.activeRevision
    const workspace = workspaces[0]
    if (revision === undefined || workspace === undefined || busy || inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    setError(null)
    void startSession(workspace.workspaceId, revision.presetId).then(sessionId => {
      bindTeamSession({
        sessionId,
        teamId: team.id,
        revision: revision.revision,
        presetId: revision.presetId,
        workspaceId: workspace.workspaceId,
      })
      if (prompt !== undefined && prompt.trim() !== '') stageNativeTeamPrompt(sessionId, prompt.trim(), targets)
      selectTeamSession(team.id, sessionId, workspace.workspaceId)
      openSession(sessionId)
      setDraft('')
      setTargetMemberIds([])
    }).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      inFlightRef.current = false
      setBusy(false)
    })
  }

  const configureTeam = (source: TeamConfigurationSource, documents: TeamProvisioningRequest['documents']): void => {
    const workspace = workspaces[0]
    if (workspace === undefined || provisionTeam === undefined || busy || inFlightRef.current) return
    inFlightRef.current = true
    setBusy(true)
    setError(null)
    updateTeamDefinition(team.id, current => ({ ...current, configurationSource: source }))
    markTeamProvisioning(
      team.id,
      'configuring',
      source.kind === 'documents' ? '正在读取 Agents 包并装配团队…' : '正在理解你的需求并装配团队…',
    )
    void provisionTeam({
      teamId: team.id,
      teamName: team.name,
      ...(team.description.trim() === '' ? {} : { teamDescription: team.description.trim() }),
      workspaceRef: workspace.workspaceId,
      configurationSessionId: team.configurationSessionId ?? null,
      source,
      documents,
    }).then(async result => {
      if (result.state !== 'review') return result
      if (result.pendingDefinition === undefined || publishTeamDraft === undefined) {
        throw new Error('当前团队服务还不能自动启用这套配置')
      }
      markTeamProvisioning(team.id, 'configuring', '配置已生成，正在启用团队…')
      return publishTeamDraft(result.pendingDefinition)
    }).then(result => {
      applyTeamProvisioningResult(team.id, result)
      setDraft('')
      setPackageSummary(null)
    }).catch(reason => {
      const message = friendlyTeamError(reason)
      markTeamProvisioning(team.id, 'blocked', message)
      setError(message)
    }).finally(() => {
      inFlightRef.current = false
      setBusy(false)
    })
  }

  const uploadAgentPackage = (files: FileList | null): void => {
    const selected = Array.from(files ?? [])
    const supported = selected.filter(file => ['AGENTS.md', 'SOUL.md', 'SKILL.md'].includes(file.name))
    if (supported.length === 0) {
      setError('没有在所选 Agents 包中找到 AGENTS.md、SOUL.md 或 SKILL.md')
      return
    }
    const oversized = supported.find(file => file.size > 262_144)
    if (oversized !== undefined) {
      setError(`${oversized.name} 超过 256 KiB，请精简后重试`)
      return
    }
    const packageName = supported[0]?.webkitRelativePath?.split('/')[0] || 'Agents 包'
    setPackageSummary(`${packageName} · ${supported.length} 份配置文件`)
    setError(null)
    void Promise.all(supported.map(async file => ({
      name: file.name,
      relativePath: file.webkitRelativePath || file.name,
      bytes: file.size,
      content: await file.text(),
    }))).then(documents => {
      configureTeam(
        { kind: 'documents', files: documents.map(document => ({ name: document.name, bytes: document.bytes })) },
        documents,
      )
    }).catch(reason => { setError(friendlyTeamError(reason)) })
  }

  const sendCurrent = (): void => {
    if (busy || inFlightRef.current || draft.trim() === '') return
    if (!configured) {
      if (!canConfigure) return
      configureTeam({ kind: 'prompt', prompt: draft.trim() }, [])
      return
    }
    if (!canStart) return
    if (targetMemberIds.length > 0 && !teamRoutingAvailable) {
      setError('成员定向路由尚未接入 Agent Harness；已保留 @ 选择，但不会伪装成普通文本发送。')
      return
    }
    startTeamSession(draft, targetMemberIds)
  }

  const openWorkspace = (): void => {
    const workspace = workspaces[0]
    if (workspace === undefined) return
    void openWorkspacePath(workspace.path).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }

  return (
    <main className={`promax-team-home${railOpen ? '' : ' promax-team-home--rail-collapsed'}`} aria-label={`${team.name}团队专用界面`}>
      <aside className="promax-team-home-sessions" aria-label={`${team.name}的会话`}>
        <div className="promax-team-home-sessions-head">
          <div><span className="promax-eyebrow">团队会话</span><strong>{team.name}</strong></div>
          <span className="promax-count-badge">{sessions.length}</span>
        </div>
        <button type="button" className="promax-new-session" disabled={!canStart || busy} onClick={() => { startTeamSession() }}>
          <Icon name="plus" size={15} />新建团队会话
        </button>
        <div className="promax-session-list">
          {sessions.length === 0 ? <div className="promax-session-empty">还没有团队会话</div> : null}
          {sessions.map(session => (
            <SessionRow
              key={session.id}
              session={session}
              current={sessionState.current === session.id}
              revision={revisionForSession(teamState, team, session)}
              onOpen={() => {
                selectTeamSession(team.id, session.id, workspaces[0]?.workspaceId)
                openSession(session.id)
              }}
            />
          ))}
        </div>
      </aside>

      <section className="promax-team-home-main">
        <header className="promax-team-home-header">
          <div>
            <div className="promax-team-breadcrumb">团队 / {team.name}</div>
            <div className="promax-team-title-line">
              <h1>{team.name}</h1>
              <span className={`promax-team-state promax-team-state--${configured ? 'published' : 'draft'}`}>{configured ? '可用' : team.provisioning.state === 'configuring' ? '配置中' : '未配置'}</span>
            </div>
            <p>{configured ? `${team.coordinator.displayName}统筹 · ${team.members.filter(member => member.enabled).length} 名团队成员` : '尚未装配团队成员'} · 团队首页</p>
          </div>
          <div className="promax-team-home-actions">
            <button type="button" className="promax-button" disabled={workspaces[0] === undefined} onClick={openWorkspace}>
              <Icon name="folder" size={15} />打开团队工作区
            </button>
            <button type="button" className="promax-button" onClick={() => { setSettingsOpen(value => !value) }}>
              <Icon name="grid" size={15} />团队设置
            </button>
          </div>
        </header>

        {settingsOpen ? (
          <TeamSettings
            team={team}
            workspace={workspaces[0]}
            onOpenWorkspace={openWorkspace}
            onClose={() => { setSettingsOpen(false) }}
          />
        ) : (
          <div className="promax-team-interaction">
            <div className="promax-team-prompt-block">
              <div>
                <span className="promax-eyebrow">{configured ? '团队工作台' : '配置团队'}</span>
                <h2>{configured ? `把目标交给 ${team.name}` : `告诉 Promax 你需要什么团队`}</h2>
                <p>{configured ? '不指定成员时交给协调者；使用 @ 可定向一名或多名成员，最终仍由协调者结算。' : '直接和配置 Agent 对话，或者上传包含 AGENTS、SOUL、SKILL 的 Agents 包。'}</p>
              </div>
              <div className="promax-team-conversation-empty"><Icon name="team" size={22} /><strong>{configured ? '准备创建新的团队会话' : team.provisioning.state === 'configuring' ? '正在装配团队' : '还没有配置团队成员'}</strong><span>{configured ? '发送后进入完整团队会话，可查看 Chat、Trajectory、工具调用和交互问题。' : team.provisioning.state === 'configuring' ? team.provisioning.message : '例如：组建一个负责竞品调研、事实核验和结论汇总的团队。'}</span></div>
              {targetMemberIds.length === 0 ? null : <div className="promax-mention-targets" aria-label="已指定成员">{targetMemberIds.map(memberId => {
                const member = team.members.find(item => item.memberId === memberId)
                return member === undefined ? null : <button key={memberId} type="button" onClick={() => { setTargetMemberIds(ids => ids.filter(id => id !== memberId)) }}>@{member.displayName}<Icon name="close" size={12} /></button>
              })}</div>}
              <div ref={composerRef} className="promax-team-composer">
              <textarea
                ref={textareaRef}
                className="promax-team-prompt"
                value={draft}
                disabled={busy || (configured ? !canStart : !canConfigure)}
                placeholder={configured ? '描述任务；输入 @ 或点下方按钮指定团队成员……' : '描述你希望这个团队负责什么，Agent 会自动装配成员与能力……'}
                onChange={event => { const value = event.currentTarget.value; setDraft(value); if (value.endsWith('@')) setMentionsOpen(true) }}
                onKeyDown={event => {
                  if (event.key !== 'Enter' || event.shiftKey) return
                  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                  event.preventDefault()
                  sendCurrent()
                }}
              />
              {configured ? <button type="button" className="promax-mention-button" aria-label="指定团队成员" aria-expanded={mentionsOpen} disabled={!canStart || busy || team.members.length === 0} onClick={() => { if (mentionsOpen) closeMentions(); else setMentionsOpen(true) }}>@</button> : (
                <>
                  <input
                    id={packageInputId}
                    className="promax-visually-hidden"
                    type="file"
                    multiple
                    accept=".md,text/markdown"
                    aria-label="上传 Agents 包"
                    disabled={!canConfigure || busy}
                    {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                    onChange={event => { uploadAgentPackage(event.currentTarget.files); event.currentTarget.value = '' }}
                  />
                  <label className={`promax-package-button${!canConfigure || busy ? ' promax-button--disabled' : ''}`} htmlFor={packageInputId}><Icon name="artifact" size={14} />上传 Agents 包</label>
                </>
              )}
              {mentionsOpen ? <div className="promax-mention-menu" role="listbox" aria-label="选择团队成员">
                <div><strong>指定团队成员</strong><span>{teamRoutingAvailable ? '可多选；协调者负责最终汇总' : '界面已就绪，Agent 定向路由待接入'}</span></div>
                {team.members.filter(member => member.enabled).map(member => {
                  const selected = targetMemberIds.includes(member.memberId)
                  return <button key={member.memberId} type="button" role="option" aria-selected={selected} onClick={() => { setTargetMemberIds(ids => selected ? ids.filter(id => id !== member.memberId) : [...ids, member.memberId]); setDraft(value => value.endsWith('@') ? value.slice(0, -1).trimEnd() : value); closeMentions() }}><span className="promax-team-member-avatar"><Icon name="agent" size={15} /></span><span><strong>{member.displayName}</strong><small>{member.objective}</small></span>{selected ? <Icon name="shield" size={15} /> : null}</button>
                })}
              </div> : null}
              </div>
              <div className="promax-team-prompt-actions">
                <span>{configured ? (targetMemberIds.length === 0 ? `由${team.coordinator.displayName}接收` : `定向 ${targetMemberIds.length} 名成员`) : packageSummary ?? '工作区已自动分配；无需设置文件范围'}</span>
                <button
                  type="button"
                  className="promax-button promax-button--primary"
                  disabled={busy || draft.trim() === '' || (configured ? !canStart : !canConfigure)}
                  onClick={sendCurrent}
                >{busy ? (configured ? '正在发送…' : '正在配置…') : configured ? '发送给团队' : '配置团队'}</button>
              </div>
            </div>
          </div>
        )}
        {error === null ? null : <div className="promax-team-page-error" role="alert">{error}</div>}
      </section>
    </main>
  )
}

interface TeamBasicsInput {
  name: string
  description: string
}

function TeamCreateDialog({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean
  onCancel: () => void
  onCreate: (input: TeamBasicsInput) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') { setError('请填写团队名称'); return }
    setError(null)
    void onCreate({ name: trimmed, description: description.trim() }).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <div className="promax-team-create-backdrop" role="presentation">
      <section className="promax-team-create-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-create-team-heading">
        <header><div><span className="promax-eyebrow">Promax 动态团队</span><h2 id="promax-create-team-heading">创建团队</h2><p>先设置基本信息，进入团队后再通过聊天或 Agents 包完成装配。</p></div><button type="button" className="promax-icon-button" aria-label="关闭创建团队" disabled={busy} onClick={onCancel}><Icon name="close" size={15} /></button></header>
        <label className="promax-field"><span>团队名称</span><input ref={inputRef} className="promax-input" value={name} placeholder="例如：增长策略团队" disabled={busy} onChange={event => { setName(event.currentTarget.value) }} /></label>
        <label className="promax-field promax-create-description"><span>团队简介 <small>选填</small></span><textarea className="promax-textarea promax-textarea--compact" value={description} placeholder="简单说明这个团队负责什么" disabled={busy} onChange={event => { setDescription(event.currentTarget.value) }} /></label>
        <div className="promax-create-workspace-note"><Icon name="folder" size={16} /><span><strong>团队工作区将自动创建</strong><small>创建后可直接打开对应位置，不需要手工选择文件范围。</small></span></div>
        {error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}
        <footer><button type="button" className="promax-button" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="promax-button promax-button--primary" disabled={busy} onClick={submit}>{busy ? '正在创建团队…' : '创建并进入'}</button></footer>
      </section>
    </div>
  )
}

function parentPath(path: string): string {
  const normalized = path.replace(/[/\\]+$/u, '')
  const slash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return slash <= 0 ? normalized : normalized.slice(0, slash)
}

export function PromaxTeamRail({
  useWorkspaces,
  useSessions,
  startSession,
  sendPrompt,
  sendTeamPrompt,
  openSession,
  clearSession,
  createTeamWorkspace,
  openWorkspacePath,
  provisionTeam,
  publishTeamDraft,
  teamRoutingAvailable,
  apiBaseUrl,
}: RuntimeProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaceState = useWorkspaces(state => state)
  const sessionState = useSessions(state => state)
  const [railOpen, setRailOpen] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teamPage, setTeamPage] = useState(0)

  const general = generalWorkspaceOf(workspaceState.items)
  const generalCount = contextRows(
    { ...teamState, selected: { kind: 'general', ...(general === undefined ? {} : { workspaceId: general.workspaceId }) } },
    workspaceState.items,
    sessionState,
    workspaceState.archivedSessionIds,
  ).rows.length
  const selectedContext = teamState.selected
  const selectedTeam = selectedContext.kind === 'team'
    ? teamState.teams.find(team => team.id === selectedContext.teamId)
    : undefined
  const teamInterfaceOpen = selectedTeam !== undefined
  const teamHomeOpen = selectedTeam !== undefined && selectedContext.kind === 'team' && selectedContext.view === 'home'
  const teamPageCount = Math.max(1, Math.ceil(teamState.teams.length / 8))
  const currentTeamPage = Math.min(teamPage, teamPageCount - 1)
  const teamRows = teamState.teams.slice(currentTeamPage * 8, currentTeamPage * 8 + 8)

  useEffect(() => {
    setTeamPage(page => Math.min(page, teamPageCount - 1))
  }, [teamPageCount])

  useEffect(() => {
    if (selectedTeam === undefined) return
    const selectedIndex = teamState.teams.findIndex(team => team.id === selectedTeam.id)
    if (selectedIndex >= 0) setTeamPage(Math.floor(selectedIndex / 8))
  }, [selectedTeam?.id, teamState.teams.length])

  const openGeneral = (): void => {
    selectGeneralWorkspace(general?.workspaceId)
    clearSession()
  }

  const createTeamFlow = async (input: TeamBasicsInput): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    let team: PromaxTeam | undefined
    try {
      team = createTeam(input)
      clearSession()
      const anchor = general ?? workspaceState.items[0]
      if (anchor === undefined) throw new Error('没有可用于创建团队工作区的本地目录')
      const workspace = await createTeamWorkspace({ teamId: team.id, teamName: team.name, parentPath: parentPath(anchor.path) })
      attachWorkspace(team.id, workspace.workspaceId)
      markTeamProvisioning(team.id, 'draft', '直接描述需要什么团队，或上传 Agents 包。')
      setCreateOpen(false)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      if (team !== undefined) markTeamProvisioning(team.id, 'blocked', '团队工作区创建失败，请重试')
      setError(message)
      throw reason
    } finally {
      setBusy(false)
    }
  }

  const runtimeProps: RuntimeProps = {
    useWorkspaces,
    useSessions,
    startSession,
    sendPrompt,
    sendTeamPrompt,
    openSession,
    clearSession,
    createTeamWorkspace,
    openWorkspacePath,
    ...(publishTeamDraft === undefined ? {} : { publishTeamDraft }),
    teamRoutingAvailable,
    ...(provisionTeam === undefined ? {} : { provisionTeam }),
  }

  return (
    <div className="promax-shell-layer">
      {teamHomeOpen ? <PromaxTeamHome {...runtimeProps} team={selectedTeam} railOpen={railOpen} /> : null}
      {createOpen ? <TeamCreateDialog busy={busy} onCancel={() => { if (!busy) setCreateOpen(false) }} onCreate={createTeamFlow} /> : null}

      <aside className={`promax-team-rail${railOpen ? ' promax-team-rail--open' : ' promax-team-rail--collapsed'}`} aria-label="团队导航">
        {railOpen ? (
          <div className="promax-team-rail-content">
            <header className="promax-team-rail-header">
              <div><span className="promax-eyebrow">Promax</span><h2>团队</h2></div>
              <div className="promax-team-rail-actions">
                <button
                  type="button"
                  className="promax-icon-button"
                  aria-label="创建团队"
                  aria-expanded={createOpen}
                  onClick={() => { setCreateOpen(true) }}
                ><Icon name="plus" size={16} /></button>
                <button type="button" className="promax-icon-button" aria-label="收起团队导航" onClick={() => { setRailOpen(false) }}>
                  <Icon name="panelRight" size={17} />
                </button>
              </div>
            </header>

            <nav className="promax-team-nav" aria-label="通用入口与 Agent 团队">
              <button
                type="button"
                className="promax-team-nav-row"
                aria-current={teamState.selected.kind === 'general' ? 'page' : undefined}
                onClick={openGeneral}
              >
                <span className="promax-team-nav-icon"><Icon name="home" size={17} /></span>
                <span><strong>通用工作区</strong><small>{generalCount} 个会话</small></span>
              </button>

              <div className="promax-team-nav-label">Agent 团队</div>
              <div className="promax-team-nav-pages">
              {teamRows.map(team => {
                const selected = selectedTeam?.id === team.id
                const count = sessionsForTeam(team, teamState, workspaceState.items, sessionState, workspaceState.archivedSessionIds).length
                return (
                  <button
                    key={team.id}
                    type="button"
                    className="promax-team-nav-row"
                    aria-current={selected ? 'page' : undefined}
                    onClick={() => {
                      const workspace = workspacesForTeam(team, workspaceState.items)[0]
                      selectTeamHome(team.id, workspace?.workspaceId)
                      clearSession()
                    }}
                  >
                    <span className="promax-team-nav-icon"><Icon name="team" size={17} /></span>
                    <span><strong>{team.name}</strong><small>{count} 个会话</small></span>
                    <span className={`promax-team-nav-status promax-team-nav-status--${team.provisioning.state === 'ready' ? 'published' : 'draft'}`}>{team.provisioning.state === 'ready' ? '可用' : team.provisioning.state === 'configuring' ? '配置中' : '未配置'}</span>
                  </button>
                )
              })}
              </div>
              {teamPageCount > 1 ? <div className="promax-team-pagination" aria-label="团队列表分页">
                <button type="button" className="promax-button" disabled={currentTeamPage === 0} onClick={() => { setTeamPage(page => Math.max(0, page - 1)) }}>上一页</button>
                <span>{currentTeamPage + 1} / {teamPageCount} · 共 {teamState.teams.length} 个</span>
                <button type="button" className="promax-button" disabled={currentTeamPage >= teamPageCount - 1} onClick={() => { setTeamPage(page => Math.min(teamPageCount - 1, page + 1)) }}>下一页</button>
              </div> : null}
            </nav>

            {error === null ? null : <div className="promax-team-rail-error" role="alert">{error}</div>}
            <footer className="promax-team-rail-foot">
              {teamInterfaceOpen ? <ConsoleLauncher {...(apiBaseUrl === undefined ? {} : { apiBaseUrl })} /> : null}
              <span>{busy ? '正在切换…' : '团队是工作入口，不是文件夹'}</span>
            </footer>
          </div>
        ) : (
          <button type="button" className="promax-team-rail-toggle" aria-label="展开团队导航" onClick={() => { setRailOpen(true) }}>
            <Icon name="team" size={19} /><span>团队</span>
          </button>
        )}
      </aside>
    </div>
  )
}
