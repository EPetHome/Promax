import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '../components/icons.tsx'
import { installPromaxConsoleStyles } from '../styles.ts'
import { ConsoleLauncher } from './ConsoleLauncher.tsx'
import {
  dispatchExecutionMessage,
  dispatchPlanningMessage,
  latestDispatchPlanResult,
  type DispatchPlan,
} from './dispatch-planning.ts'
import { TASK_ATTACHMENT_ACCEPT, taskAttachmentSelectionError, uniqueTaskAttachmentName, type TaskAttachmentContext } from './task-attachments.ts'
import { taskRunProjectionOf, type TaskHistoryItem, type TaskRunFileSnapshot, type TaskRunProjection } from './task-run-projection.ts'
import { PromaxSettingsPanel, type PromaxSettingsService } from './PromaxSettings.tsx'
import {
  PRODUCT_TEAM_ID,
  bindTeamSession,
  bindingForSession,
  confirmTeamSessionDispatch,
  selectTeamHome,
  selectTeamSession,
  setTeamSessionRunState,
  startTeamSessionDispatch,
  teamForSession,
  useTeamState,
  type PromaxTeam,
  type PromaxTeamState,
  type TeamArtifactDefinition,
  type TeamMember,
  type TeamSessionBinding,
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
  parentId?: string
  origin?: 'subagent'
  running: boolean
  pendingInteraction?: unknown
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
  sendSessionMessage: (sessionId: string, text: string) => Promise<void>
  openSession: (sessionId: string) => void
  clearSession: () => void
  archiveSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  saveTaskAttachments: (input: {
    workspaceId: string
    projectPath: string
    sessionId: string
    demand: string
    files: Array<{ name: string; mediaType: string; contentBase64: string }>
  }) => Promise<{ paths: string[]; attachments: TaskAttachmentContext[]; manifestPath: string; taskKey: string; sessionName: string }>
  beginDispatchPlan: (input: { sessionId: string; taskKey: string; rosterMemberIds: string[] }) => Promise<{ planId: string; taskKey: string }>
  confirmDispatchPlan: (input: { workspaceId: string; projectPath: string; sessionId: string; planId: string; confirmedMemberIds: string[]; artifacts: Array<{ path: string; memberId: string }> }) => Promise<{ planId: string; taskKey: string; confirmedMemberIds: string[]; confirmedAt: string }>
  readTaskRunFiles: (input: { workspaceId: string; projectPath: string; sessionId: string; taskKey: string }) => Promise<TaskRunFileSnapshot>
  readTaskHistory: (input: { workspaceId: string; projectPath: string }) => Promise<TaskHistoryItem[]>
  openTaskFolder: (input: { workspaceId: string; projectPath: string; sessionId: string; taskKey: string }) => Promise<{ path: string }>
  stopTeamTask: (input: { workspaceId: string; projectPath: string; sessionId: string; taskKey: string; runEpoch: number }) => Promise<{ state: 'cancelled'; runEpoch: number }>
  teamRoutingAvailable: boolean
}

interface RuntimeProps extends WorkspaceShellActions {
  useWorkspaces: SelectorHook<WorkspaceListState>
  useSessions: SelectorHook<SessionListState>
}

interface SidebarProps extends RuntimeProps {
  wide?: boolean
  expandSidebar?: () => void
}

function isPathLeaf(path: string, leaf: string): boolean {
  return path.replace(/[/\\]+$/u, '').split(/[/\\]/u).pop()?.toLowerCase() === leaf
}

function productWorkspaceOf(workspaces: readonly WorkspaceView[]): WorkspaceView | undefined {
  return workspaces.find(workspace => workspace.title === '产品' || isPathLeaf(workspace.path, 'product'))
}

export function workspacesForTeam(team: PromaxTeam, workspaces: readonly WorkspaceView[]): WorkspaceView[] {
  const ids = new Set(team.workspaceIds)
  if (team.id === PRODUCT_TEAM_ID) {
    const compatibility = productWorkspaceOf(workspaces)
    if (compatibility !== undefined) ids.add(compatibility.workspaceId)
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
  return rowsFromIds(
    workspacesForTeam(team, workspaces).flatMap(workspace => [
      ...workspace.sessionIds,
      ...state.sessionBindings.filter(binding => binding.teamId === team.id && binding.workspaceId === workspace.workspaceId).map(binding => binding.sessionId),
    ]),
    sessions,
    archived,
  ).filter(session => bindingForSession(state, session.id)?.teamId === team.id || session.agentPreset === team.activeRevision?.presetId)
}

function workspaceForTeamSession(team: PromaxTeam, state: PromaxTeamState, workspaces: readonly WorkspaceView[], sessionId: string): WorkspaceView | undefined {
  const candidates = workspacesForTeam(team, workspaces)
  const boundWorkspaceId = bindingForSession(state, sessionId)?.workspaceId
  return candidates.find(workspace => workspace.workspaceId === boundWorkspaceId)
    ?? candidates.find(workspace => workspace.sessionIds.includes(sessionId))
}

interface TaskHistoryView extends TaskHistoryItem {
  workspaceId: string
  projectPath: string
}

interface TaskHistoryState {
  items: TaskHistoryView[]
  loading: boolean
  error?: string
}

export function isTaskReadTransportError(message: string): boolean {
  return /(?:failed to fetch|fetch failed|networkerror|network request failed|load failed|connection refused|econnrefused)/iu.test(message)
}

/** Keep a specific disk/schema failure visible when a later poll only reports that the service disappeared. */
export function retainedTaskReadError(current: string | undefined, incoming: string): string {
  if (current !== undefined && !isTaskReadTransportError(current) && isTaskReadTransportError(incoming)) return current
  return incoming
}

export const TASK_READ_FAILURE_STABILITY_THRESHOLD = 3
export const TASK_READ_TRANSPORT_FAILURE_THRESHOLD = TASK_READ_FAILURE_STABILITY_THRESHOLD
export const TASK_RUN_FAILURE_STABILITY_THRESHOLD = 3

export interface TaskRunSnapshotStability {
  signature?: string
  consecutiveReads: number
}

function transientJudgeFailureSignature(snapshot: TaskRunFileSnapshot): string | undefined {
  if (snapshot.repair?.state === 'repairing' || snapshot.repair?.state === 'judging' || snapshot.repair?.state === 'exhausted') return undefined
  if (snapshot.judge.state !== 'fail' && snapshot.judge.state !== 'unverified') return undefined
  return JSON.stringify([snapshot.judge.state, snapshot.judge.reason ?? ''])
}

/**
 * Judge reports are ordinary files and can be observed between the body write
 * and the final verdict write. Confirm FAIL or an unverified verdict across
 * three identical reads before publishing it; repair and non-failure states remain immediate.
 */
export function taskRunSnapshotDecision(
  current: TaskRunSnapshotStability,
  incoming: TaskRunFileSnapshot,
): { publish: boolean; next: TaskRunSnapshotStability } {
  const signature = transientJudgeFailureSignature(incoming)
  if (signature === undefined) return { publish: true, next: { consecutiveReads: 0 } }
  const consecutiveReads = current.signature === signature ? current.consecutiveReads + 1 : 1
  return {
    publish: consecutiveReads >= TASK_RUN_FAILURE_STABILITY_THRESHOLD,
    next: { signature, consecutiveReads },
  }
}

/**
 * A polling error is user-visible only after the same failure survives three
 * reads. One-frame transport, ENOENT, and partially-written schema errors stay
 * internal; a previously confirmed error remains until a replacement is stable.
 */
export function surfacedTaskReadError(
  current: string | undefined,
  incoming: string,
  consecutiveReadFailures: number,
): string | undefined {
  const retained = retainedTaskReadError(current, incoming)
  return consecutiveReadFailures >= TASK_READ_FAILURE_STABILITY_THRESHOLD ? retained : current
}

function useTaskHistory(workspaces: readonly WorkspaceView[], readTaskHistory: WorkspaceShellActions['readTaskHistory']): TaskHistoryState {
  const [items, setItems] = useState<TaskHistoryView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const failureStability = useRef<{ message?: string; consecutiveReads: number }>({ consecutiveReads: 0 })
  const workspaceKey = workspaces.map(workspace => `${workspace.workspaceId}:${workspace.path}`).join('|')
  useEffect(() => {
    let active = true
    failureStability.current = { consecutiveReads: 0 }
    if (workspaces.length === 0) {
      setItems([])
      setLoading(false)
      setError(undefined)
      return () => { active = false }
    }
    setLoading(true)
    const refresh = async (): Promise<void> => {
      try {
        const batches = await Promise.all(workspaces.map(async workspace => {
          const history = await readTaskHistory({ workspaceId: workspace.workspaceId, projectPath: workspace.path })
          return history.map(item => ({ ...item, workspaceId: workspace.workspaceId, projectPath: workspace.path }))
        }))
        if (!active) return
        setItems(batches.flat().sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)))
        failureStability.current = { consecutiveReads: 0 }
        setError(undefined)
      } catch (reason) {
        if (active) {
          const message = reason instanceof Error ? reason.message : String(reason)
          const consecutiveReads = failureStability.current.message === message ? failureStability.current.consecutiveReads + 1 : 1
          failureStability.current = { message, consecutiveReads }
          setError(current => surfacedTaskReadError(current, message, consecutiveReads))
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 1_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [readTaskHistory, workspaceKey])
  return { items, loading, ...(error === undefined ? {} : { error }) }
}

function minuteLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间无效'
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function EmptyHeroSeat() {
  return null
}

function SessionRow({
  session,
  asset,
  current,
  onOpen,
  onRequestDelete,
}: {
  session: SessionSummary
  asset: TaskHistoryView
  current: boolean
  onOpen: () => void
  onRequestDelete: (session: SessionSummary) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const menuItemRef = useRef<HTMLButtonElement>(null)
  const actionsRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const title = asset.taskKey
  const statusLabel = asset.status === 'running' ? '执行中' : asset.status === 'completed' ? '已完成' : '失败'

  useEffect(() => {
    if (!menuOpen) return
    menuItemRef.current?.focus()
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && !shellRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOpen(false)
      actionsRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  return (
    <div ref={shellRef} className={`promax-session-row-shell${menuOpen ? ' promax-session-row-shell--menu-open' : ''}`}>
      <button type="button" className="promax-session-row" aria-current={current ? 'page' : undefined} onClick={onOpen}>
        <span className="promax-session-row-copy">
          <span className="promax-session-row-title">{title}</span>
          <small>{minuteLabel(asset.createdAt)} · {statusLabel} · {asset.fileCount} 个文件</small>
        </span>
        <span
          className={`promax-session-indicator${asset.status === 'running' ? ' promax-session-indicator--running' : ''}${asset.status === 'completed' ? ' promax-session-indicator--done' : ''}${asset.status === 'failed' ? ' promax-session-indicator--failed' : ''}`}
          aria-label={statusLabel}
        />
      </button>
      <button ref={actionsRef} type="button" className="promax-session-actions" aria-label={`会话操作：${title}`} aria-haspopup="menu" aria-controls={menuId} aria-expanded={menuOpen} onClick={() => { setMenuOpen(value => !value) }}><Icon name="more" size={16} /></button>
      {menuOpen ? <div id={menuId} className="promax-session-menu" role="menu" aria-label={`${title}会话操作`}>
        <button ref={menuItemRef} type="button" className="promax-session-menu-delete" role="menuitem" onClick={() => { setMenuOpen(false); onRequestDelete(session) }}>隐藏记录</button>
      </div> : null}
    </div>
  )
}

function SessionDeleteDialog({ taskKey, busy, error, onCancel, onConfirm }: {
  taskKey: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const title = taskKey
  useDialogKeyboard(true, onCancel, cancelRef)
  return createPortal(
    <div className="promax-team-create-backdrop">
      <section className="promax-team-create-dialog promax-session-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-delete-session-heading" aria-describedby="promax-delete-session-description">
        <header><div><span className="promax-eyebrow">记录操作</span><h2 id="promax-delete-session-heading">隐藏这条记录？</h2><p id="promax-delete-session-description">“{title}”只会从左侧列表隐藏；磁盘里的 `deliverables/{title}/`、冻结输入和 Judge 报告都不会删除。</p></div><button type="button" className="promax-icon-button" aria-label="关闭隐藏记录确认" disabled={busy} onClick={onCancel}><Icon name="close" size={15} /></button></header>
        {error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}
        <footer><button ref={cancelRef} type="button" className="promax-button" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="promax-button promax-button--danger" disabled={busy} onClick={onConfirm}>{busy ? '正在隐藏…' : '确认隐藏'}</button></footer>
      </section>
    </div>,
    document.body,
  )
}

function useDialogKeyboard(open: boolean, onClose: () => void, focusRef: RefObject<HTMLElement | null>, returnFocusRef?: RefObject<HTMLElement | null>): void {
  const closeHandlerRef = useRef(onClose)
  useEffect(() => { closeHandlerRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    const returnFocus = returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    focusRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeHandlerRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = focusRef.current?.closest<HTMLElement>('[role="dialog"]')
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? [])]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousBodyOverflow
      returnFocus?.focus({ preventScroll: true })
    }
  }, [focusRef, open, returnFocusRef])
}

export function PromaxSessionBrowser({
  wide = true,
  expandSidebar,
  useWorkspaces,
  useSessions,
  openSession,
  clearSession,
  archiveSession,
  readTaskHistory,
}: SidebarProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaceState = useWorkspaces(state => state)
  const sessionState = useSessions(state => state)
  const [deleteTarget, setDeleteTarget] = useState<{ session: SessionSummary; taskKey: string } | null>(null)
  const [deletingSession, setDeletingSession] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null)
  const team = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const teamWorkspaces = team === undefined ? [] : workspacesForTeam(team, workspaceState.items)
  const homeWorkspace = productWorkspaceOf(teamWorkspaces) ?? teamWorkspaces[0]
  const sessions = team === undefined ? [] : sessionsForTeam(team, teamState, workspaceState.items, sessionState, workspaceState.archivedSessionIds)
  const sessionById = new Map(sessions.map(session => [session.id, session]))
  const history = useTaskHistory(teamWorkspaces, readTaskHistory)
  const rows = history.items.flatMap(asset => {
    const session = sessionById.get(asset.sessionId)
    return session === undefined ? [] : [{ session, asset }]
  })
  const homeSelected = teamState.selected.kind !== 'team' || teamState.selected.view === 'home'

  useEffect(() => {
    if (deleteNotice === null) return
    const timeout = window.setTimeout(() => { setDeleteNotice(null) }, 2400)
    return () => { window.clearTimeout(timeout) }
  }, [deleteNotice])

  if (!wide) {
    return <button type="button" className="promax-context-rail-button" aria-label="展开 Promax 导航" title="Promax 导航" onClick={expandSidebar}><Icon name="team" size={19} /></button>
  }

  const requestDeleteSession = (session: SessionSummary, taskKey: string): void => {
    setDeleteError(null)
    setDeleteTarget({ session, taskKey })
  }

  const confirmDeleteSession = async (): Promise<void> => {
    if (deleteTarget === null || deletingSession) return
    const sessionId = deleteTarget.session.id
    const title = deleteTarget.taskKey
    setDeletingSession(true)
    setDeleteError(null)
    try {
      await archiveSession(sessionId)
      if (sessionState.current === sessionId) {
        const binding = bindingForSession(teamState, sessionId)
        if (binding !== undefined) selectTeamHome(binding.teamId, binding.workspaceId)
        else if (team !== undefined) selectTeamHome(team.id, homeWorkspace?.workspaceId)
        clearSession()
      }
      setDeleteTarget(null)
      setDeleteNotice(`已隐藏“${title}”；磁盘文件未删除`)
    } catch (reason: unknown) {
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDeletingSession(false)
    }
  }

  return (
    <nav className="promax-session-browser" aria-label="Promax 工作入口">
      <button type="button" className="promax-new-session" aria-current={homeSelected ? 'page' : undefined} disabled={team === undefined || homeWorkspace === undefined} onClick={() => { if (team !== undefined) selectTeamHome(team.id, homeWorkspace?.workspaceId); clearSession() }}><Icon name="plus" size={15} />新需求</button>
      <section className="promax-nav-section" aria-labelledby="promax-request-list-heading">
        <h2 id="promax-request-list-heading">需求记录</h2>
        <div className="promax-session-list">
          {history.loading && rows.length === 0 ? <div className="promax-session-empty" role="status">正在读取磁盘记录…</div> : rows.length === 0 ? <div className="promax-session-empty">还没有产出记录</div> : rows.map(({ session, asset }) => {
            const workspace = teamWorkspaces.find(item => item.workspaceId === asset.workspaceId)
            return <SessionRow key={session.id} session={session} asset={asset} current={teamState.selected.kind === 'team' && teamState.selected.view === 'session' && (teamState.selected.sessionId ?? sessionState.current) === session.id} onOpen={() => { if (team !== undefined) selectTeamSession(team.id, session.id, workspace?.workspaceId); openSession(session.id) }} onRequestDelete={row => { requestDeleteSession(row, asset.taskKey) }} />
          })}
        </div>
      </section>
      {workspaceState.state === 'error' ? <div className="promax-session-error">工作区读取失败</div> : null}
      {history.error === undefined ? null : <div className="promax-session-error" role="alert">磁盘记录读取失败：{history.error}</div>}
      {deleteNotice === null ? null : <div className="promax-session-success" role="status">{deleteNotice}</div>}
      {deleteTarget === null ? null : <SessionDeleteDialog taskKey={deleteTarget.taskKey} busy={deletingSession} error={deleteError} onCancel={() => { if (!deletingSession) setDeleteTarget(null) }} onConfirm={() => { void confirmDeleteSession() }} />}
    </nav>
  )
}

interface NativeConversationSnapshot {
  nodes: readonly unknown[]
  turnTimings: ReadonlyMap<number, { startTime: number; endTime?: number }>
  running: boolean
  runningCalls?: ReadonlyArray<{ callId?: string; name?: string; argsRaw?: string }>
  pending?: readonly unknown[]
  queue?: readonly unknown[]
  removed?: boolean
  openState?: string
  lastAgentError?: string | null
}

type NativeSessionHook = <Selected>(selector: (state: NativeConversationSnapshot) => Selected) => Selected

type ProgressState = 'pending' | 'running' | 'done' | 'blocked' | 'appealed' | 'human-required' | 'force-released' | 'unverified'

interface ArtifactProgress {
  artifact: TeamArtifactDefinition
  label: string
  involved: boolean
  generation: ProgressState
  judgment: ProgressState
}

export interface TeamProgressView {
  understanding: ProgressState
  splitting: ProgressState
  delivery: ProgressState
  artifacts: ArtifactProgress[]
  evidence: 'not-started' | 'running' | 'receipt' | 'unverified'
  memberStates?: Record<string, 'idle' | 'running' | 'done' | 'blocked'>
  repair?: TaskRunProjection['repair']
}

const teamSessionProgress = new Map<string, NativeConversationSnapshot>()
const teamSessionProgressListeners = new Set<() => void>()
let teamSessionProgressVersion = 0

function publishTeamSessionProgress(sessionId: string, snapshot: NativeConversationSnapshot): void {
  teamSessionProgress.set(sessionId, snapshot)
  teamSessionProgressVersion += 1
  for (const listener of teamSessionProgressListeners) listener()
}

function forgetTeamSessionProgress(sessionId: string): void {
  if (!teamSessionProgress.delete(sessionId)) return
  teamSessionProgressVersion += 1
  for (const listener of teamSessionProgressListeners) listener()
}

function useTeamSessionProgress(sessionId: string | undefined): NativeConversationSnapshot | undefined {
  useSyncExternalStore(
    listener => { teamSessionProgressListeners.add(listener); return () => { teamSessionProgressListeners.delete(listener) } },
    () => teamSessionProgressVersion,
    () => 0,
  )
  return sessionId === undefined ? undefined : teamSessionProgress.get(sessionId)
}

function isJudgeMember(member: TeamMember): boolean {
  return member.memberId === 'quality_judge'
}

function artifactLabel(artifact: TeamArtifactDefinition): string {
  return artifact.relativePath.split('/').at(-1)?.replaceAll('{task_key}', '任务') ?? artifact.relativePath
}

function artifactPathForTask(artifact: TeamArtifactDefinition, taskKey: string | undefined): string | undefined {
  if (!artifact.relativePath.includes('{task_key}')) return artifact.relativePath
  return taskKey === undefined ? undefined : artifact.relativePath.replaceAll('{task_key}', taskKey)
}

/** Presentation adapter over the manifest-and-files projection. */
export function teamProgressOf(team: PromaxTeam, projection?: TaskRunProjection, confirmedMemberIds: readonly string[] = []): TeamProgressView {
  const judge: ProgressState = projection?.judge.state === 'pass' ? 'done'
    : projection?.judge.state === 'fail' ? 'blocked'
      : projection?.judge.state === 'appealed' ? 'appealed'
        : projection?.judge.state === 'human_required' ? 'human-required'
          : projection?.judge.state === 'force_released' ? 'force-released'
            : projection?.judge.state === 'unverified' ? 'unverified'
              : projection?.judge.state === 'running' ? 'running' : 'pending'
  const artifacts = projection === undefined ? [] : Object.entries(projection.artifacts).map(([path, state]) => {
    const artifact = team.artifacts.find(candidate => artifactPathForTask(candidate, projection.taskKey) === path)
    if (artifact === undefined) throw new Error(`TaskRunProjection 产物未在 TeamRevision 声明：${path}`)
    return {
      artifact,
      label: path.split('/').at(-1) ?? artifactLabel(artifact),
      involved: true,
      generation: state.state === 'pending' ? 'pending' as const : 'done' as const,
      judgment: state.state === 'judged'
        ? judge
        : state.state === 'produced' && judge !== 'pending'
          ? judge
          : 'pending' as const,
    }
  })
  const knownMemberIds = new Set(team.members.map(member => member.memberId))
  const memberStates = projection === undefined
    ? Object.fromEntries(confirmedMemberIds.filter(memberId => knownMemberIds.has(memberId)).map(memberId => [memberId, 'idle' as const]))
    : Object.fromEntries(Object.entries(projection.members).map(([memberId, member]) => [memberId, member.state]))
  return {
    understanding: projection === undefined ? 'pending' : 'done',
    splitting: projection === undefined ? 'pending' : 'done',
    delivery: judge,
    artifacts,
    evidence: projection === undefined
      ? 'not-started'
      : projection.phase === 'completed' || projection.phase === 'blocked'
        ? 'receipt'
        : projection.phase === 'running' || projection.phase === 'repairing' || projection.phase === 'judging' || projection.phase === 'stopping'
          ? 'running'
          : 'unverified',
    memberStates,
    ...(projection?.repair === undefined ? {} : { repair: projection.repair }),
  }
}

export type MemberExecutionState = 'idle' | 'running' | 'done' | 'blocked'

export function memberExecutionStateOf(member: TeamMember, progress: TeamProgressView): MemberExecutionState {
  const projected = progress.memberStates?.[member.memberId]
  if (projected !== undefined) return projected
  if (isJudgeMember(member)) {
    if (progress.delivery === 'done') return 'done'
    if (progress.delivery === 'blocked' || progress.delivery === 'appealed' || progress.delivery === 'human-required' || progress.delivery === 'force-released') return 'blocked'
    if (progress.delivery === 'running') return 'running'
    return 'idle'
  }
  const owned = progress.artifacts.filter(row => row.artifact.producedBy === member.memberId && row.involved)
  if (owned.some(row => row.judgment === 'blocked' || row.judgment === 'appealed' || row.judgment === 'human-required')) return 'blocked'
  if (owned.some(row => row.generation === 'running' || row.judgment === 'running')) return 'running'
  if (owned.length > 0 && owned.every(row => row.generation === 'done')) return 'done'
  return 'idle'
}

export type TeamAvailabilityTone = 'idle' | 'active' | 'warning' | 'error'

export interface TeamAvailabilityView {
  label: string
  tone: TeamAvailabilityTone
}

export interface TeamSubagentStopTarget {
  sessionId: string
  parentSessionId: string
}

export interface TeamSessionTreeView {
  descendantCount: number
  pendingDescendantCount: number
  runningDescendants: readonly TeamSubagentStopTarget[]
}

const EMPTY_TEAM_SESSION_TREE: TeamSessionTreeView = {
  descendantCount: 0,
  pendingDescendantCount: 0,
  runningDescendants: [],
}

function belongsToTeamSession(rootSessionId: string, candidate: SessionSummary, sessions: SessionListState): boolean {
  const seen = new Set<string>()
  let current: SessionSummary | undefined = candidate
  while (current?.origin === 'subagent' && current.parentId !== undefined && !seen.has(current.id)) {
    if (current.parentId === rootSessionId) return true
    seen.add(current.id)
    current = sessions.byId[current.parentId]
  }
  return false
}

/** Aggregates the uninterrupted dsh subagent lineage under one Promax team session. */
export function teamSessionTreeOf(rootSessionId: string | undefined, sessions: SessionListState | undefined): TeamSessionTreeView {
  if (rootSessionId === undefined || sessions === undefined) return EMPTY_TEAM_SESSION_TREE
  let descendantCount = 0
  let pendingDescendantCount = 0
  const runningDescendants: TeamSubagentStopTarget[] = []
  for (const summary of Object.values(sessions.byId)) {
    if (summary === undefined || summary.id === rootSessionId || !belongsToTeamSession(rootSessionId, summary, sessions)) continue
    descendantCount += 1
    if (summary.pendingInteraction !== undefined) pendingDescendantCount += 1
    if (summary.running && summary.parentId !== undefined) {
      runningDescendants.push({ sessionId: summary.id, parentSessionId: summary.parentId })
    }
  }
  return { descendantCount, pendingDescendantCount, runningDescendants }
}

/** Aggregates observable parent and descendant health; "待命" is a whole-tree claim. */
export function teamAvailabilityOf(snapshot: NativeConversationSnapshot | undefined, session: SessionSummary | undefined, tree: TeamSessionTreeView = EMPTY_TEAM_SESSION_TREE): TeamAvailabilityView {
  if (snapshot?.removed === true) return { label: '会话已断开', tone: 'error' }
  if (snapshot?.openState === 'error' || snapshot?.lastAgentError != null) return { label: '团队异常', tone: 'error' }
  if ((snapshot?.pending?.length ?? 0) > 0 || tree.pendingDescendantCount > 0) return { label: '等待确认', tone: 'warning' }
  if ((snapshot?.runningCalls?.length ?? 0) > 0 || snapshot?.running === true || session?.running === true || tree.runningDescendants.length > 0) {
    return { label: '团队运行中', tone: 'active' }
  }
  if (snapshot?.openState === 'loading' || snapshot?.openState === 'cold') return { label: '状态同步中', tone: 'active' }
  if ((snapshot?.queue?.length ?? 0) > 0) return { label: '任务已排队', tone: 'warning' }
  if (snapshot?.openState === 'open') return { label: '团队待命', tone: 'idle' }
  if (session !== undefined) return { label: '状态同步中', tone: 'active' }
  return { label: '尚未启动', tone: 'warning' }
}

export type TimelineEventTone = 'idle' | 'active' | 'done' | 'blocked'

export interface TimelineEventView {
  key: string
  title: string
  copy: string
  time: string
  tone: TimelineEventTone
}

function timelineTime(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return '--:--'
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp))
}

function nodeRecord(node: unknown): Record<string, unknown> | undefined {
  return typeof node === 'object' && node !== null ? node as Record<string, unknown> : undefined
}

function assistantTimelineEvent(team: PromaxTeam, node: Record<string, unknown>, snapshot: NativeConversationSnapshot): TimelineEventView {
  const turn = typeof node.turn === 'number' ? node.turn : undefined
  const blocks = Array.isArray(node.blocks) ? node.blocks.map(nodeRecord).filter((block): block is Record<string, unknown> => block !== undefined) : []
  const calledNames = new Set(blocks.filter(block => block.kind === 'tool-call' && typeof block.name === 'string').map(block => String(block.name)))
  const routed = team.members.filter(member => calledNames.has(member.memberId))
  const timing = turn === undefined ? undefined : snapshot.turnTimings.get(turn)
  const time = timelineTime(timing?.endTime ?? timing?.startTime)
  const suffix = turn === undefined ? '' : `第 ${turn} 轮`
  if (routed.length > 0) {
    return {
      key: `route-${String(turn ?? node.messageId ?? time)}`,
      title: `任务已路由给 ${routed.length} 名成员`,
      copy: routed.map(member => member.displayName).join('、'),
      time,
      tone: 'active',
    }
  }
  return {
    key: `assistant-${String(turn ?? node.messageId ?? time)}`,
    title: `${suffix || '当前轮'}协调已响应`,
    copy: '当前轮已有主智能体回复；任务状态由结构化生命周期和权威任务文件另行投影。',
    time,
    tone: 'active',
  }
}

/** Compact, code-maintained side-channel summary; the native conversation remains the complete trace. */
export function timelineEventsOf(team: PromaxTeam, snapshot: NativeConversationSnapshot | undefined): TimelineEventView[] {
  if (snapshot === undefined || snapshot.nodes.length === 0) {
    return [{
      key: 'not-started',
      title: '尚未开始',
      copy: '提交任务后，这里只汇总当前会话中可验证的关键事件。',
      time: '--:--',
      tone: 'idle',
    }]
  }
  const timings = [...snapshot.turnTimings.entries()].sort(([left], [right]) => left - right)
  const firstTiming = timings[0]
  const events: TimelineEventView[] = [{
    key: `submitted-${String(firstTiming?.[0] ?? 'observed')}`,
    title: '任务已进入团队会话',
    copy: firstTiming === undefined ? '已观察到当前会话轨迹。' : `第 ${firstTiming[0]} 轮任务开始执行。`,
    time: timelineTime(firstTiming?.[1].startTime),
    tone: 'done',
  }]
  const seenTurns = new Set<number | string>()
  for (const node of snapshot.nodes) {
    const record = nodeRecord(node)
    if (record?.kind !== 'assistant') continue
    const identity = typeof record.turn === 'number' ? record.turn : String(record.messageId ?? events.length)
    if (seenTurns.has(identity)) continue
    seenTurns.add(identity)
    events.push(assistantTimelineEvent(team, record, snapshot))
  }
  if (snapshot.running) {
    const current = timings.at(-1)
    const callCount = snapshot.runningCalls?.length ?? 0
    events.push({
      key: `running-${String(current?.[0] ?? 'current')}`,
      title: '团队正在执行',
      copy: callCount > 0 ? `当前有 ${callCount} 个工具调用正在运行。` : '当前会话仍在推理或组织下一步行动。',
      time: timelineTime(current?.[1].startTime),
      tone: 'active',
    })
  }
  return events.slice(-3)
}

interface TeamSessionHeaderProps {
  sessionId: string
  useSession: NativeSessionHook
}

/** Observes native turns; visible team navigation is hosted by shell.overlay so blank sessions have it too. */
export function PromaxTeamSessionHeader({ sessionId, useSession }: TeamSessionHeaderProps) {
  const state = useTeamState()
  const team = teamForSession(state, sessionId)
  const snapshot = useSession(value => value)

  useEffect(() => {
    if (team !== undefined) publishTeamSessionProgress(sessionId, snapshot)
  }, [sessionId, snapshot, snapshot.lastAgentError, snapshot.nodes, snapshot.running, snapshot.runningCalls, team])
  useEffect(() => () => { forgetTeamSessionProgress(sessionId) }, [sessionId])

  return null
}

interface ProcessActionProps {
  sessionId: string
  messageId: string
  useSession: NativeSessionHook
}

export function PromaxProcessAction({ sessionId, messageId, useSession }: ProcessActionProps) {
  const team = teamForSession(useTeamState(), sessionId)
  const snapshot = useSession(value => value)
  if (team === undefined) return null
  const assistant = snapshot.nodes.find(node => typeof node === 'object' && node !== null && (node as Record<string, unknown>).kind === 'assistant' && String((node as Record<string, unknown>).messageId ?? '') === String(messageId)) as Record<string, unknown> | undefined
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
  return <details className="promax-process-detail"><summary>处理过程</summary><div className="promax-process-panel"><strong>第 {turn} 轮 · {failed ? '失败' : '完成'}</strong><ol><li>任务提交：已接收</li><li>团队协调：已执行</li>{toolCalls > 0 ? <li>成员/工具调用：{toolCalls} 项</li> : null}<li>结果汇总：{failed ? '未完成' : '已完成'}</li></ol><p>{duration === undefined ? '详细时间线可在 Trajectory 查看。' : `耗时 ${(duration / 1000).toFixed(1)} 秒；详细时间线可在 Trajectory 查看。`}</p></div></details>
}

function contentBase64(file: File): Promise<string> {
  return file.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    return window.btoa(binary)
  })
}

type SubmissionStage = 'idle' | 'creating' | 'preparing' | 'planning'

const SUBMISSION_STEPS: Array<{ stage: Exclude<SubmissionStage, 'idle'>; label: string }> = [
  { stage: 'creating', label: '创建需求记录' },
  { stage: 'preparing', label: '上传并解析附件' },
  { stage: 'planning', label: '根据正文生成派单建议' },
]

function SubmissionProgress({ stage, hasFiles }: { stage: Exclude<SubmissionStage, 'idle'>; hasFiles: boolean }) {
  const effectiveSteps = hasFiles ? SUBMISSION_STEPS : SUBMISSION_STEPS.filter(step => step.stage !== 'preparing')
  const currentIndex = effectiveSteps.findIndex(step => step.stage === stage)
  return <section className="promax-submission-progress" aria-live="polite" aria-label="需求处理进度">
    <strong>{stage === 'creating' ? '正在创建需求记录' : stage === 'preparing' ? '正在上传并读取文件内容' : '文件已就绪，正在规划团队'}</strong>
    <ol>{effectiveSteps.map((step, index) => <li key={step.stage} className={index < currentIndex ? 'is-done' : index === currentIndex ? 'is-active' : ''}><span aria-hidden="true" />{step.label}</li>)}</ol>
    <p>当前需求和附件会保留在页面上，请勿重复提交。</p>
  </section>
}

export function taskMessageWithAttachments(text: string, paths: readonly string[]): string {
  const wanted = text.trim()
  if (paths.length === 0) return wanted
  return `${wanted}\n\n附件路径（相对当前工作目录）：\n${paths.map(path => `- ${path}`).join('\n')}`
}

function TeamHome({ team, workspace, history, startSession, sendSessionMessage, openSession, renameSession, saveTaskAttachments, beginDispatchPlan, openTaskFolder }: Pick<WorkspaceShellActions, 'startSession' | 'sendSessionMessage' | 'openSession' | 'renameSession' | 'saveTaskAttachments' | 'beginDispatchPlan' | 'openTaskFolder'> & { team: PromaxTeam; workspace: WorkspaceView | undefined; history: TaskHistoryState }) {
  const [draft, setDraft] = useState('')
  const [files, setFiles] = useState<Array<{ file: File; uploadName: string }>>([])
  const [busy, setBusy] = useState(false)
  const [submissionStage, setSubmissionStage] = useState<SubmissionStage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const revision = team.activeRevision
  const addFiles = (incoming: FileList | readonly File[] | null): void => {
    if (incoming === null) return
    const selected = Array.from(incoming)
    const issue = taskAttachmentSelectionError([...files.map(item => ({ name: item.uploadName, size: item.file.size })), ...selected])
    setAttachmentError(issue)
    if (issue === null) {
      const used = new Set(files.map(item => item.uploadName))
      setFiles([...files, ...selected.map(file => ({ file, uploadName: uniqueTaskAttachmentName(file.name, used) }))])
    }
  }
  const send = (): void => {
    if (workspace === undefined || revision === undefined || team.members.length === 0 || (draft.trim() === '' && files.length === 0) || busy || attachmentError !== null) return
    setBusy(true)
    setSubmissionStage('creating')
    setError(null)
    void startSession(workspace.workspaceId, revision.presetId).then(async sessionId => {
      setSubmissionStage(files.length === 0 ? 'planning' : 'preparing')
      const saved = await saveTaskAttachments({
        workspaceId: workspace.workspaceId,
        projectPath: workspace.path,
        sessionId,
        demand: draft,
        files: await Promise.all(files.map(async ({ file, uploadName }) => ({ name: uploadName, mediaType: file.type || 'application/octet-stream', contentBase64: await contentBase64(file) }))),
      })
      const sessionName = saved.sessionName
      const effectiveDemand = draft.trim() === '' ? saved.taskKey : draft.trim()
      await renameSession(sessionId, sessionName)
      setSubmissionStage('planning')
      const opened = await beginDispatchPlan({ sessionId, taskKey: saved.taskKey, rosterMemberIds: team.members.map(member => member.memberId) })
      await sendSessionMessage(sessionId, dispatchPlanningMessage({
        demand: effectiveDemand,
        attachmentPaths: saved.paths,
        attachmentContexts: saved.attachments,
        team,
        planId: opened.planId,
        taskKey: opened.taskKey,
      }))
      bindTeamSession({
        sessionId,
        teamId: team.id,
        revision: revision.revision,
        presetId: revision.presetId,
        workspaceId: workspace.workspaceId,
        sessionName,
        taskKey: opened.taskKey,
        dispatchPlanId: opened.planId,
        dispatchState: 'planning',
        dispatchDemand: effectiveDemand,
        dispatchAttachmentPaths: saved.paths,
        dispatchAttachmentContexts: saved.attachments,
      })
      selectTeamSession(team.id, sessionId, workspace.workspaceId)
      openSession(sessionId)
    }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false); setSubmissionStage('idle') })
  }
  return <main className="promax-team-home" aria-label="新需求">
    <section className="promax-team-home-main">
      <div className="promax-team-interaction"><div className="promax-team-prompt-block" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={event => { event.preventDefault(); event.stopPropagation(); addFiles(event.dataTransfer.files) }}><div className="promax-room-intro"><span className="promax-room-sequence" aria-hidden="true">01</span><div><span className="promax-eyebrow">PROMAX</span><h2>{workspace === undefined ? '工作目录不可用' : '需要团队完成什么？'}</h2><p>{workspace === undefined ? '请检查产品工作目录是否已经安装。' : '直接描述需求，或只上传一份文件；团队会自己决定调用谁、交付什么。'}</p></div></div><textarea aria-label="需求输入" autoFocus className="promax-team-prompt" value={draft} disabled={workspace === undefined || busy} placeholder="输入需求，或直接添加文件……" onChange={event => { setDraft(event.currentTarget.value) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} /><input ref={fileRef} className="promax-file-input" type="file" accept={TASK_ATTACHMENT_ACCEPT} multiple tabIndex={-1} aria-hidden="true" onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = '' }} />{files.length === 0 ? null : <div className="promax-composer-attachment-count promax-upload-file-list" aria-label="待发送附件">{files.map((item, index) => <button aria-label={`${item.uploadName} ×`} key={`${item.uploadName}:${String(item.file.size)}:${String(item.file.lastModified)}:${String(index)}`} type="button" className="promax-upload-file" disabled={busy} onClick={() => { setFiles(current => current.filter((_item, itemIndex) => itemIndex !== index)); setAttachmentError(null) }}><Icon name="paperclip" size={14} /><span><strong>{item.uploadName}</strong><small>{busy && submissionStage === 'preparing' ? '正在解析内容' : '待上传'} · {(item.file.size / 1024).toFixed(item.file.size >= 1024 ? 0 : 1)} KB</small></span><span aria-hidden="true">×</span></button>)}</div>}{busy && submissionStage !== 'idle' ? <SubmissionProgress stage={submissionStage} hasFiles={files.length > 0} /> : null}<div className="promax-team-prompt-actions"><button type="button" className="promax-button" disabled={workspace === undefined || busy} onClick={() => { fileRef.current?.click() }}><Icon name="paperclip" size={15} />添加文件</button><button type="button" className="promax-button promax-button--primary" disabled={workspace === undefined || revision === undefined || team.members.length === 0 || busy || (draft.trim() === '' && files.length === 0) || attachmentError !== null} onClick={send}>{busy ? submissionStage === 'preparing' ? '正在解析…' : submissionStage === 'planning' ? '正在规划…' : '正在创建…' : '开始'}</button></div></div></div>
      {attachmentError === null ? null : <div className="promax-team-page-error" role="alert">{attachmentError}</div>}
      {error === null ? null : <div className="promax-team-page-error" role="alert">{error}</div>}
    </section>
    <aside className="promax-team-home-recent" aria-label="最近产出">
      <header className="promax-team-home-recent-header"><span>PROMAX</span><h2>最近产出</h2></header>
      {history.error === undefined
        ? history.loading && history.items.length === 0
          ? <div className="team-note" role="status">正在读取磁盘记录…</div>
          : <RecentOutputContent {...history.items[0] === undefined ? {} : { item: history.items[0] }} openTaskFolder={openTaskFolder} />
        : <div className="team-note" role="alert">磁盘记录读取失败：{history.error}</div>}
    </aside>
  </main>
}

type DispatchReviewBinding = TeamSessionBinding & Required<Pick<TeamSessionBinding,
  'workspaceId' | 'sessionName' | 'taskKey' | 'dispatchPlanId' | 'dispatchState' | 'dispatchDemand' | 'dispatchAttachmentPaths'
>>

function dispatchReviewBinding(binding: TeamSessionBinding | undefined): binding is DispatchReviewBinding {
  return binding?.workspaceId !== undefined
    && binding.sessionName !== undefined
    && binding.taskKey !== undefined
    && binding.dispatchPlanId !== undefined
    && binding.dispatchState !== undefined
    && binding.dispatchDemand !== undefined
    && binding.dispatchAttachmentPaths !== undefined
}

function memberDeliverables(plan: DispatchPlan, memberId: string): string {
  const files = plan.members.find(member => member.memberId === memberId)?.deliverables ?? []
  return files.map(path => path.split('/').at(-1) ?? path).join('、')
}

const DISPATCH_CLARIFICATION_OPTIONS = [
  '提炼内容摘要',
  '评审方案质量',
  '查找风险与缺口',
  '提出改进建议',
  '基于文档重新设计',
] as const

function demandWithClarification(demand: string, clarification: string): string {
  return `${demand.trim()}\n\n用户补充的分析目标：${clarification.trim()}`
}

function DispatchAssessment({ children }: { children: string }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = Array.from(children).length > 320
  return <div className="promax-dispatch-assessment-wrap">
    <p className={`promax-dispatch-assessment${collapsible && !expanded ? ' is-collapsed' : ''}`}>{children}</p>
    {collapsible ? <button className="promax-link-button" type="button" aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>{expanded ? '收起判断' : '展开完整判断'}</button> : null}
  </div>
}

function attachmentStatusText(context: TaskAttachmentContext | undefined): string {
  if (context === undefined) return '已上传，旧记录未保存解析指标'
  const facts = [
    context.pageCount === undefined ? undefined : `${String(context.pageCount)} 页`,
    `已提取 ${context.textCharacters.toLocaleString('zh-CN')} 字`,
    context.truncated ? '已取有限摘录用于规划' : '正文已交给规划模型',
  ].filter((value): value is string => value !== undefined)
  return facts.join(' · ')
}

function DispatchInputSummary({ binding, planning }: { binding: DispatchReviewBinding; planning: boolean }) {
  return <section className="promax-dispatch-input" aria-labelledby="promax-dispatch-input-heading">
    <div className="promax-dispatch-input-heading"><div><span className="promax-eyebrow">本次输入</span><h2 id="promax-dispatch-input-heading">需求与附件都在这里</h2></div>{planning ? <span className="promax-live-badge" role="status"><span aria-hidden="true" />正在规划</span> : null}</div>
    <p className="promax-dispatch-demand">{binding.dispatchDemand}</p>
    {binding.dispatchAttachmentPaths.length === 0 ? <p className="promax-dispatch-no-files">本次没有附件</p> : <div className="promax-dispatch-attachments" aria-label="本次附件">{binding.dispatchAttachmentPaths.map(path => {
      const context = binding.dispatchAttachmentContexts?.find(item => item.path === path)
      const name = context?.name ?? path.split('/').at(-1) ?? path
      return <article key={path}><Icon name="paperclip" size={15} /><span><strong>{name}</strong><small>{attachmentStatusText(context)}</small></span><span className={context === undefined ? 'is-unknown' : 'is-ready'}>{context === undefined ? '已上传' : '可供智能体阅读'}</span></article>
    })}</div>}
  </section>
}

function DispatchPlanningProgress({ reparsing = false }: { reparsing?: boolean }) {
  return <section className="promax-dispatch-progress" aria-live="polite">
    <div><span className="promax-dispatch-progress-pulse" aria-hidden="true" /><span><strong>{reparsing ? '正在根据补充目标重新规划' : '正在生成派单建议'}</strong><small>页面内容会保留，新结果返回后自动更新。</small></span></div>
    <ol><li className="is-done">需求已接收</li><li className="is-done">输入已预处理</li><li className="is-active">正在判断成员</li><li>等待你确认</li></ol>
  </section>
}

function DispatchMemberDialog({ plan, team, selectedMemberIds, busy, returnFocusRef, onToggle, onClose, onExecute }: {
  plan: DispatchPlan
  team: PromaxTeam
  selectedMemberIds: readonly string[]
  busy: boolean
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onToggle: (memberId: string, selected: boolean) => void
  onClose: () => void
  onExecute: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useDialogKeyboard(true, onClose, closeRef, returnFocusRef)
  return createPortal(
    <div className="promax-member-picker-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="promax-member-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-member-picker-heading" aria-describedby="promax-member-picker-description">
        <header><div><span className="promax-eyebrow">调整派单</span><h2 id="promax-member-picker-heading">选择本次参与的员工</h2><p id="promax-member-picker-description">勾选需要参与本次任务的员工。确认前不会启动任何人。</p></div><button ref={closeRef} type="button" className="promax-icon-button" aria-label="关闭员工选择" disabled={busy} onClick={onClose}><Icon name="close" size={16} /></button></header>
        <div className="promax-member-picker-count" role="status" aria-atomic="true">已选择 {selectedMemberIds.length} 名员工</div>
        <div className="promax-member-picker-list">{plan.members.map(member => { const definition = team.members.find(item => item.memberId === member.memberId)!; const checked = selectedMemberIds.includes(member.memberId); const fixed = isJudgeMember(definition); return <label className="promax-dispatch-choice" key={member.memberId}><input type="checkbox" checked={checked} disabled={busy || fixed} onChange={event => { onToggle(member.memberId, event.currentTarget.checked) }} /><span><strong>{definition.displayName}{fixed ? ' · 固定参与' : ''}</strong><small>{definition.objective}</small><small className="promax-member-picker-output">将产出 {memberDeliverables(plan, member.memberId)}</small></span></label> })}</div>
        <footer><button className="promax-button" type="button" disabled={busy} onClick={onClose}>返回</button><button className="promax-button promax-button--primary" type="button" disabled={busy || selectedMemberIds.length === 0} onClick={onExecute}>{busy ? '正在开始…' : `按这个名单跑（${selectedMemberIds.length}）`}</button></footer>
      </section>
    </div>,
    document.body,
  )
}

function DispatchPlanReview({ binding, team, workspace, snapshot, confirmDispatchPlan, sendSessionMessage }: {
  binding: DispatchReviewBinding
  team: PromaxTeam
  workspace: WorkspaceView
  snapshot: NativeConversationSnapshot | undefined
  confirmDispatchPlan: WorkspaceShellActions['confirmDispatchPlan']
  sendSessionMessage: WorkspaceShellActions['sendSessionMessage']
}) {
  const resolution = useMemo(() => latestDispatchPlanResult(snapshot?.nodes ?? [], team, binding.dispatchPlanId, binding.taskKey), [binding.dispatchPlanId, binding.taskKey, snapshot?.nodes, team])
  const plan = resolution.plan
  const [editing, setEditing] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [clarification, setClarification] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingPlanning, setPendingPlanning] = useState<{ nodeCount: number; lastAgentError: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const editTriggerRef = useRef<HTMLButtonElement>(null)
  const confirmed = binding.dispatchState === 'confirmed'

  useEffect(() => {
    if (binding.confirmedMemberIds !== undefined) setSelectedMemberIds(binding.confirmedMemberIds)
    else if (plan !== undefined) setSelectedMemberIds(plan.members.filter(member => member.selected || member.memberId === 'quality_judge').map(member => member.memberId))
  }, [binding.confirmedMemberIds, plan])

  useEffect(() => {
    if (pendingPlanning === null || snapshot?.running) return
    if ((snapshot?.nodes.length ?? 0) > pendingPlanning.nodeCount || (snapshot?.lastAgentError ?? null) !== pendingPlanning.lastAgentError) setPendingPlanning(null)
  }, [pendingPlanning, snapshot?.lastAgentError, snapshot?.nodes.length, snapshot?.running])

  const planning = pendingPlanning !== null || snapshot?.running === true

  const retryPlanning = (clarifiedGoal?: string): void => {
    if (busy || planning) return
    const nextDemand = clarifiedGoal === undefined
      ? binding.dispatchDemand
      : demandWithClarification(binding.dispatchDemand, clarifiedGoal)
    setBusy(true)
    setPendingPlanning({ nodeCount: snapshot?.nodes.length ?? 0, lastAgentError: snapshot?.lastAgentError ?? null })
    setError(null)
    void sendSessionMessage(binding.sessionId, dispatchPlanningMessage({
      demand: nextDemand,
      attachmentPaths: binding.dispatchAttachmentPaths,
      ...(binding.dispatchAttachmentContexts === undefined ? {} : { attachmentContexts: binding.dispatchAttachmentContexts }),
      team,
      planId: binding.dispatchPlanId,
      taskKey: binding.taskKey,
    })).catch(reason => { setPendingPlanning(null); setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
  }

  const execute = (memberIds: readonly string[]): void => {
    if (plan === undefined || !memberIds.some(memberId => memberId !== 'quality_judge') || busy || planning) return
    const selected = new Set([...memberIds, 'quality_judge'])
    const ordered = plan.members.filter(member => selected.has(member.memberId)).map(member => member.memberId)
    const artifacts = plan.members.filter(member => selected.has(member.memberId)).flatMap(member => member.deliverables.map(path => ({ path, memberId: member.memberId })))
    setBusy(true)
    setError(null)
    void (async () => {
      if (!confirmed) {
        const frozen = await confirmDispatchPlan({ workspaceId: binding.workspaceId, projectPath: workspace.path, sessionId: binding.sessionId, planId: binding.dispatchPlanId, confirmedMemberIds: ordered, artifacts })
        if (frozen.planId !== binding.dispatchPlanId || frozen.taskKey !== binding.taskKey || frozen.confirmedMemberIds.join('\0') !== ordered.join('\0')) {
          throw new Error('运行时返回的已确认名单与页面选择不一致')
        }
        confirmTeamSessionDispatch(binding.sessionId, ordered)
      }
      await sendSessionMessage(binding.sessionId, dispatchExecutionMessage({
        demand: binding.dispatchDemand,
        attachmentPaths: binding.dispatchAttachmentPaths,
        plan,
        selectedMemberIds: ordered,
        taskKey: binding.taskKey,
      }))
      startTeamSessionDispatch(binding.sessionId)
    })().catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
  }

  if (plan === undefined) {
    const waiting = snapshot === undefined || planning
    return <div className="promax-dispatch-page">
      <section className="promax-dispatch-card" aria-live="polite">
        <div className="promax-room-intro"><span className="promax-room-sequence" aria-hidden="true">02</span><div><span className="promax-eyebrow">PROMAX</span><h1>{waiting ? '正在判断这次怎么干' : '这次计划没有生成成功'}</h1><p>{waiting ? '主智能体只在分析输入；运行时已锁住全部工具和业务成员。' : '模型没有返回可确认的完整结构化计划，业务执行仍未开始。'}</p></div></div>
        <DispatchInputSummary binding={binding} planning={waiting} />
        {waiting ? <DispatchPlanningProgress /> : <button className="promax-button promax-button--primary" type="button" disabled={busy || planning} onClick={() => { retryPlanning() }}>重新判断</button>}
        {snapshot?.lastAgentError == null && error === null && resolution.error === undefined ? null : <div className="promax-team-page-error" role="alert">{error ?? snapshot?.lastAgentError ?? resolution.error}</div>}
      </section>
    </div>
  }

  const called = plan.members.filter(member => member.selected)
  const calledBusiness = called.filter(member => member.memberId !== 'quality_judge')
  const skipped = plan.members.filter(member => !member.selected)
  const allMemberIds = plan.members.map(member => member.memberId)

  if (calledBusiness.length === 0 && !confirmed) {
    return <div className="promax-dispatch-page">
      <section className="promax-dispatch-card" aria-labelledby="promax-dispatch-heading">
        <div className="promax-room-intro"><span className="promax-room-sequence" aria-hidden="true">02</span><div><span className="promax-eyebrow">PROMAX</span><h1 id="promax-dispatch-heading">还需要你补充分析目标</h1><DispatchAssessment>{plan.assessment}</DispatchAssessment></div></div>
        <DispatchInputSummary binding={binding} planning={planning} />
        {planning ? <DispatchPlanningProgress reparsing /> : null}
        <section className="promax-dispatch-clarification" aria-labelledby="promax-clarification-heading">
          <span className="promax-dispatch-clarification-state">暂未派单</span>
          <div><h2 id="promax-clarification-heading">你希望怎么分析这份文档？</h2><p>选择一个方向，或直接写下你希望得到的结果。补充后会沿用当前文档重新规划。</p></div>
          <fieldset className="promax-dispatch-clarification-options"><legend>快捷选择</legend><div>{DISPATCH_CLARIFICATION_OPTIONS.map(option => <button key={option} type="button" aria-pressed={clarification === option} disabled={busy || planning} onClick={() => { setClarification(option) }}>{option}</button>)}</div></fieldset>
          <label className="promax-dispatch-clarification-input"><span>补充分析目标</span><textarea aria-label="补充分析目标" value={clarification} disabled={busy || planning} placeholder="例如：重点检查这份方案的风险、遗漏和落地可行性" onChange={event => { setClarification(event.currentTarget.value) }} /></label>
          <div className="promax-dispatch-actions"><button className="promax-button promax-button--primary" type="button" disabled={busy || planning || clarification.trim() === ''} onClick={() => { retryPlanning(clarification) }}>{planning ? '正在重新规划…' : '补充后重新规划'}</button><button ref={editTriggerRef} className="promax-button" type="button" aria-expanded={editing} disabled={busy || planning} onClick={() => { setEditing(value => !value) }}>{editing ? '收起员工名单' : '手动选择员工'}</button></div>
        </section>
        {editing ? <DispatchMemberDialog plan={plan} team={team} selectedMemberIds={selectedMemberIds} busy={busy} returnFocusRef={editTriggerRef} onToggle={(memberId, selected) => { if (memberId !== 'quality_judge') setSelectedMemberIds(current => selected ? [...current, memberId] : current.filter(id => id !== memberId)) }} onClose={() => { setEditing(false) }} onExecute={() => { setEditing(false); execute(selectedMemberIds) }} /> : null}
        <details className="promax-dispatch-skipped"><summary>为什么暂时没有选人</summary><div className="promax-dispatch-list">{skipped.map(member => { const definition = team.members.find(item => item.memberId === member.memberId)!; return <article className="promax-dispatch-row" key={member.memberId}><span className="promax-dispatch-member">{definition.displayName}</span><span>{member.reason}</span></article> })}</div></details>
        {error === null && resolution.error === undefined ? null : <div className="promax-team-page-error" role="alert">{error ?? `新计划未采用：${resolution.error}`}</div>}
        <p className="promax-dispatch-footnote">补充分析目标或手动选人之前，不会启动任何员工，也不会重复上传文档。</p>
      </section>
    </div>
  }

  return <div className="promax-dispatch-page">
    <section className="promax-dispatch-card" aria-labelledby="promax-dispatch-heading">
      <div className="promax-room-intro"><span className="promax-room-sequence" aria-hidden="true">02</span><div><span className="promax-eyebrow">PROMAX</span><h1 id="promax-dispatch-heading">这次打算怎么干</h1><DispatchAssessment>{plan.assessment}</DispatchAssessment></div></div>
      <DispatchInputSummary binding={binding} planning={planning} />
      {planning ? <DispatchPlanningProgress reparsing /> : null}
      <div className="promax-dispatch-section"><h2>打算叫 {called.length} 个人</h2><div className="promax-dispatch-list">{called.map(member => { const definition = team.members.find(item => item.memberId === member.memberId)!; return <article className="promax-dispatch-row is-called" key={member.memberId}><span className="promax-dispatch-member">{definition.displayName}</span><span>{member.reason}</span><span className="promax-dispatch-files" aria-label="计划产物">→ {memberDeliverables(plan, member.memberId)}</span></article> })}</div></div>
      <div className="promax-dispatch-section"><h2>不叫</h2><div className="promax-dispatch-list">{skipped.map(member => { const definition = team.members.find(item => item.memberId === member.memberId)!; return <article className="promax-dispatch-row" key={member.memberId}><span className="promax-dispatch-member">{definition.displayName}</span><span>{member.reason}</span></article> })}</div></div>
      {editing ? <DispatchMemberDialog plan={plan} team={team} selectedMemberIds={selectedMemberIds} busy={busy || confirmed} returnFocusRef={editTriggerRef} onToggle={(memberId, selected) => { if (memberId !== 'quality_judge') setSelectedMemberIds(current => selected ? [...current, memberId] : current.filter(id => id !== memberId)) }} onClose={() => { setEditing(false) }} onExecute={() => { setEditing(false); execute(selectedMemberIds) }} /> : null}
      {confirmed ? <div className="promax-dispatch-confirmed" role="status">名单已锁定：{selectedMemberIds.map(memberId => team.members.find(member => member.memberId === memberId)?.displayName ?? memberId).join('、')}。{error === null ? '正在发送执行请求…' : '执行请求尚未发出，可按原名单重试。'}</div> : null}
      {error === null && resolution.error === undefined ? null : <div className="promax-team-page-error" role="alert">{error ?? `新计划未采用：${resolution.error}`}</div>}
      <div className="promax-dispatch-actions">
        <button className="promax-button promax-button--primary" type="button" disabled={busy || planning || calledBusiness.length === 0 || confirmed} onClick={() => { execute(called.map(member => member.memberId)) }}>{busy && !confirmed ? '正在开始…' : '就这样跑'}</button>
        <button ref={editTriggerRef} className="promax-button" type="button" aria-expanded={editing} disabled={busy || planning || confirmed} onClick={() => { setEditing(value => !value) }}>我要改</button>
        <button className="promax-button" type="button" disabled={busy || planning || confirmed} onClick={() => { execute(allMemberIds) }}>全部都叫</button>
        {confirmed && error !== null ? <button className="promax-button promax-button--primary" type="button" disabled={busy} onClick={() => { execute(binding.confirmedMemberIds ?? selectedMemberIds) }}>{busy ? '正在重试…' : '按锁定名单重试'}</button> : null}
      </div>
      <p className="promax-dispatch-footnote">确认前不会启动业务成员，也不会生成业务产物。确认后名单不可变更。</p>
    </section>
  </div>
}

type TaskReadyTeamSessionBinding = TeamSessionBinding & Required<Pick<TeamSessionBinding,
  'workspaceId' | 'taskKey'
>>

function taskReadyBinding(binding: TeamSessionBinding | undefined): binding is TaskReadyTeamSessionBinding {
  return binding?.workspaceId !== undefined
    && binding.taskKey !== undefined
}
interface PromaxLayoutActions {
  toggleSidebar(): void
  openDetails(): void
  closeDetails(): void
}

interface PromaxShellRuntimeProps extends RuntimeProps {
  layout: PromaxLayoutActions
  settings?: PromaxSettingsService
  detailsOpen?: boolean
  apiBaseUrl?: string
}

function PreferencesDialog({ onClose, settings }: { onClose: () => void; settings?: PromaxSettingsService }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useDialogKeyboard(true, onClose, closeRef)
  return createPortal(
    <div className="promax-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="promax-preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-preferences-heading">
        <header><div><span className="promax-eyebrow">PROMAX</span><h2 id="promax-preferences-heading">设置</h2></div><button ref={closeRef} type="button" className="promax-icon-button" aria-label="关闭设置" onClick={onClose}><Icon name="close" size={15} /></button></header>
        {settings === undefined ? <div className="promax-inline-error" role="alert">Promax 设置服务不可用</div> : <PromaxSettingsPanel service={settings} preferences={<p>当前没有可配置的偏好。</p>} />}
      </section>
    </div>,
    document.body,
  )
}

/** Full Promax navigation column; it shadows dsh's sidebar without declaring any child slots. */
export function PromaxLeftSidebar(props: PromaxShellRuntimeProps & { collapsed?: boolean }) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  useEffect(() => {
    const open = (): void => { setPreferencesOpen(true) }
    window.addEventListener('promax:open-preferences', open)
    return () => { window.removeEventListener('promax:open-preferences', open) }
  }, [])
  return <div className="left-sidebar" id="promax-navigation-panel">
    <div className="brand-row">
      <span className="brand-mark" aria-hidden="true">P</span>
      <div><div className="brand-name">Promax</div><div className="brand-label">AGENT WORKSPACE</div></div>
      <button className="promax-workbench-icon-button collapse-button" type="button" aria-label="收起 Promax 导航" aria-controls="promax-navigation-panel" aria-expanded="true" title="收起导航" onClick={props.layout.toggleSidebar}><Icon name="panelRight" size={18} /></button>
    </div>
    <div className="left-scroll"><PromaxSessionBrowser {...props} wide /></div>
    <footer className="sidebar-footer">
      <ConsoleLauncher {...(props.apiBaseUrl === undefined ? {} : { apiBaseUrl: props.apiBaseUrl })} />
      <button className="footer-item" type="button" onClick={() => { setPreferencesOpen(true) }}><Icon name="settings" size={15} />设置</button>
    </footer>
    {preferencesOpen ? <PreferencesDialog {...(props.settings === undefined ? {} : { settings: props.settings })} onClose={() => { setPreferencesOpen(false) }} /> : null}
  </div>
}

interface ComposerState {
  draft: string
  draftRev: number
  phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  imageIds?: readonly string[]
}

interface PromaxComposerProps extends Partial<PromaxShellRuntimeProps> {
  sessionId?: string
  useSession?: <Selected>(selector: (state: NativeConversationSnapshot | undefined) => Selected) => Selected
  useInput: <Selected>(selector: (state: ComposerState | undefined) => Selected) => Selected
  inputActions?: { setDraft(text: string): void; submit(): void }
  stop?: () => void | Promise<void>
  disabled?: boolean
  blocked?: { reason: string }
  onRequestWorkspace?: () => void
  placeholder?: string
  accessory?: ReactNode
  overlay?: ReactNode
  leftItems?: ReactNode
  rightItems?: ReactNode
  footer?: ReactNode
  toggleCommand?: (draft: string, draftRev: number) => void
}

type ComposerHostView = 'workbench' | 'trace' | 'deliverables'

interface ComposerHostSnapshot {
  element: HTMLDivElement
  view: ComposerHostView
}

let composerHostSnapshot: ComposerHostSnapshot | null = null
const composerHostSubscribers = new Set<() => void>()

function publishComposerHost(snapshot: ComposerHostSnapshot | null): void {
  composerHostSnapshot = snapshot
  for (const subscriber of composerHostSubscribers) subscriber()
}

function subscribeComposerHost(subscriber: () => void): () => void {
  composerHostSubscribers.add(subscriber)
  return () => { composerHostSubscribers.delete(subscriber) }
}

function useComposerHost(): ComposerHostSnapshot | null {
  return useSyncExternalStore(subscribeComposerHost, () => composerHostSnapshot, () => null)
}

/** Layout-owned seat for the retained dsh input machine. */
export function PromaxComposerHost({ view }: { view: ComposerHostView }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (element === null) return
    const snapshot = { element, view }
    publishComposerHost(snapshot)
    const shell = element.closest<HTMLElement>('.app-shell')
    const publishHeight = (): void => {
      const height = element.getBoundingClientRect().height
      if (height > 0) shell?.style.setProperty('--promax-composer-height', `${height}px`)
    }
    publishHeight()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publishHeight)
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      if (composerHostSnapshot === snapshot) publishComposerHost(null)
      shell?.style.removeProperty('--promax-composer-height')
    }
  }, [element, view])

  return <div ref={setElement} className="promax-composer-host" data-promax-composer-host data-promax-composer-view={view} />
}

function forwardPickedImages(files: FileList | null): void {
  if (files === null || files.length === 0 || typeof DataTransfer === 'undefined') return
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
}

const SUPPORTED_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
const SUPPORTED_IMAGE_HELP = '支持 PNG、JPG、WebP、GIF 图片'

/** Promax composer chrome over the retained dsh input machine. */
export function PromaxComposerBar(props: PromaxComposerProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const input = props.useInput(state => state)
  const nativeRunning = props.useSession?.(state => state?.running === true) ?? false
  const sessionState = props.useSessions?.(state => state)
  const workspaceState = props.useWorkspaces?.(state => state)
  const teamState = useTeamState()
  const [localDraft, setLocalDraft] = useState('')
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachmentHelpId = useId()
  const host = useComposerHost()
  const [commandPending, setCommandPending] = useState(false)
  const draft = input?.draft ?? localDraft
  const currentTeam = props.sessionId === undefined ? undefined : teamForSession(teamState, props.sessionId)
  const currentBinding = props.sessionId === undefined ? undefined : bindingForSession(teamState, props.sessionId)
  const selectedWorkspace = currentBinding?.workspaceId === undefined ? undefined : workspaceState?.items.find(workspace => workspace.workspaceId === currentBinding.workspaceId)
  const teamTree = teamSessionTreeOf(currentTeam === undefined ? undefined : props.sessionId, sessionState)
  const stopsTeam = currentTeam !== undefined && teamTree.runningDescendants.length > 0
  const stopInProgress = currentBinding?.runState === 'stop_requested' || currentBinding?.runState === 'draining'
  const primaryStops = nativeRunning || stopsTeam || stopInProgress
  const teamStopReady = currentTeam !== undefined && taskReadyBinding(currentBinding) && selectedWorkspace !== undefined && props.stopTeamTask !== undefined
  const canStop = teamStopReady || props.stop !== undefined
  const taskExecutionLocked = currentTeam !== undefined && currentBinding?.runState !== undefined && currentBinding.runState !== 'running'
  const dispatchLocked = currentBinding?.dispatchState === 'planning' || currentBinding?.dispatchState === 'confirmed'
  const locked = props.disabled === true || props.blocked !== undefined || taskExecutionLocked || dispatchLocked || stopping || input?.phase === 'adjudicating' || input?.phase === 'submitting'
  const placeholder = currentBinding?.runState === 'stop_requested' ? '已请求停止；正在中止当前步骤，之后不会再启动新成员'
    : currentBinding?.runState === 'draining' ? '正在中止当前步骤并等待运行树真实静止'
    : currentBinding?.runState === 'cancelled' ? '本任务已停止；请新建会话开始新的 run'
    : props.blocked?.reason ?? props.placeholder ?? '继续描述需求…'

  useEffect(() => {
    if (!primaryStops) setStopping(false)
  }, [primaryStops])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = '42px'
    textarea.style.height = `${Math.min(100, Math.max(42, textarea.scrollHeight))}px`
  }, [draft])

  useEffect(() => {
    if (!commandPending || input === undefined || !input.draft.endsWith('/')) return
    setCommandPending(false)
    props.toggleCommand?.(input.draft, input.draftRev)
  }, [commandPending, input, props])

  const write = (value: string): void => {
    if (props.inputActions === undefined) setLocalDraft(value)
    else props.inputActions.setDraft(value)
    if (value.endsWith('/')) setCommandPending(true)
  }
  const submit = (): void => {
    const text = draft.trim()
    if (text === '' || locked) return
    if (props.inputActions !== undefined) props.inputActions.submit()
    else props.onRequestWorkspace?.()
  }
  const stopTask = (): void => {
    if (!primaryStops || !canStop || stopping) return
    setStopping(true)
    setStopError(null)
    void (async () => {
      try {
        if (currentTeam !== undefined && taskReadyBinding(currentBinding) && selectedWorkspace !== undefined && props.stopTeamTask !== undefined) {
          const requestedAt = new Date().toISOString()
          setTeamSessionRunState(currentBinding.sessionId, 'stop_requested', requestedAt)
          const result = await props.stopTeamTask({
            workspaceId: selectedWorkspace.workspaceId,
            projectPath: selectedWorkspace.path,
            sessionId: currentBinding.sessionId,
            taskKey: currentBinding.taskKey,
            runEpoch: currentBinding.runEpoch ?? 1,
          })
          setTeamSessionRunState(currentBinding.sessionId, result.state, new Date().toISOString())
        } else {
          await props.stop?.()
        }
      } catch (error: unknown) {
        setStopError(`停止请求处理异常：${error instanceof Error ? error.message : String(error)}。界面继续以磁盘运行状态为准。`)
        setStopping(false)
      }
    })()
  }

  const composer = <div className="composer-wrap" data-promax-composer>
    <div className="composer">
      {props.overlay}
      {props.accessory}
      <input ref={fileRef} className="promax-file-input" type="file" accept={SUPPORTED_IMAGE_ACCEPT} multiple tabIndex={-1} aria-hidden="true" onChange={event => { forwardPickedImages(event.currentTarget.files); event.currentTarget.value = '' }} />
      <span className="promax-composer-attachment-control">
        <button className="composer-tool" type="button" aria-label={`添加图片（${SUPPORTED_IMAGE_HELP}）`} aria-describedby={attachmentHelpId} title={SUPPORTED_IMAGE_HELP} disabled={locked || props.sessionId === undefined} onClick={() => { fileRef.current?.click() }}><Icon name="paperclip" size={18} /></button>
        <span id={attachmentHelpId} className="promax-composer-format-tooltip" role="tooltip">{SUPPORTED_IMAGE_HELP}</span>
      </span>
      <div className="promax-composer-left-items">{props.leftItems}</div>
      <label className="promax-sr-only" htmlFor="promax-task-input">描述任务</label>
      <textarea ref={textareaRef} id="promax-task-input" rows={1} value={draft} disabled={locked || (props.inputActions === undefined && props.onRequestWorkspace === undefined)} readOnly={props.inputActions === undefined} placeholder={placeholder} onClick={props.inputActions === undefined ? props.onRequestWorkspace : undefined} onChange={event => { write(event.currentTarget.value) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} />
      {props.rightItems}
      <button className="send-button" type="button" aria-label={primaryStops ? stopping || stopInProgress ? '已请求停止，正在中止当前步骤' : currentTeam === undefined ? '停止当前执行' : '停止团队任务' : '发送任务'} title={primaryStops ? stopping || stopInProgress ? '已请求停止，正在中止当前步骤' : currentTeam === undefined ? '停止当前执行' : '停止团队任务' : '发送任务'} disabled={primaryStops ? stopping || stopInProgress || !canStop : draft.trim() === '' || locked || props.inputActions === undefined} onClick={primaryStops ? stopTask : submit}><Icon name={primaryStops ? 'stop' : 'send'} size={20} /></button>
    </div>
    {input?.imageIds !== undefined && input.imageIds.length > 0 ? <div className="promax-composer-attachment-count">已附 {input.imageIds.length} 张图片</div> : null}
    {stopError === null ? null : <div className="promax-inline-error" role="alert">{stopError}</div>}
    {host?.view === 'trace' ? props.footer : null}
  </div>
  return host === null ? composer : createPortal(composer, host.element)
}

type DeliverableState = 'pending' | 'generated' | 'ready'

function deliverableStateOf(row: ArtifactProgress): DeliverableState {
  if (row.judgment === 'done' || row.judgment === 'force-released') return 'ready'
  if (row.generation === 'done') return 'generated'
  return 'pending'
}

/** Counts only manifest-registered deliverables and exact disk receipts. */
export function deliverableSummary(rows: readonly ArtifactProgress[]): { ready: number; involved: number } {
  const states = rows.map(deliverableStateOf)
  return {
    ready: states.filter(state => state === 'ready').length,
    involved: rows.length,
  }
}

function progressLabel(state: ProgressState, stage: 'generation' | 'judgment'): string {
  if (state === 'done') return stage === 'generation' ? '已生成' : '已通过'
  if (state === 'blocked') return stage === 'generation' ? '生成失败' : '未通过'
  if (state === 'appealed') return '已申诉 · 等待人工处理'
  if (state === 'human-required') return '需要人工处理'
  if (state === 'force-released') return '人工强制放行 · 非 Judge 通过'
  if (state === 'running') return stage === 'generation' ? '生成中' : '判定中'
  if (state === 'unverified') return '未通过'
  return stage === 'generation' ? '尚未生成' : '未判定'
}

function fileMeta(state: DeliverableState, judgment: ProgressState): string {
  if (judgment === 'force-released') return '人工强制放行 · 非 Judge 通过'
  if (judgment === 'blocked' || judgment === 'unverified') return '已生成 · Judge 未通过'
  if (judgment === 'appealed') return '已生成 · 已申诉'
  if (judgment === 'human-required') return '已生成 · 需要人工处理'
  if (judgment === 'running') return '已生成 · 判定中'
  if (state === 'ready') return '已完成 · Judge 通过'
  if (state === 'generated') return '已生成 · 待判定'
  return '尚未生成 · 未判定'
}

function TeamStatusContent({ team, progress }: { team: PromaxTeam; progress: TeamProgressView }) {
  const presenceLabel = (state: MemberExecutionState): string => state === 'done'
    ? '已完成'
    : state === 'blocked' ? '已阻断' : state === 'running' ? '运行中' : '未生成'
  return <>
    {progress.repair === undefined ? null : <div className="team-note" role="status" aria-atomic="true"><strong>{progress.repair.state === 'repairing' ? `第 ${String(progress.repair.round)}/${String(progress.repair.maxRounds)} 轮返修中` : progress.repair.state === 'judging' ? `第 ${String(progress.repair.round)}/${String(progress.repair.maxRounds)} 轮复判中` : progress.repair.state === 'passed' ? `第 ${String(progress.repair.round)}/${String(progress.repair.maxRounds)} 轮返修后通过` : '多次返修后仍未通过'}</strong><br />{progress.repair.state === 'exhausted' ? progress.repair.reasons.join('；') : '返修只重写业务产物，冻结输入保持不变。'}</div>}
    <section className="right-section" aria-labelledby="promax-current-members">
      <h2 className="sidebar-section-title" id="promax-current-members">当前成员</h2>
      <div className="member-list">
        {team.members.filter(member => member.enabled && progress.memberStates?.[member.memberId] !== undefined).map(member => { const state = memberExecutionStateOf(member, progress); const label = presenceLabel(state); return <div className="member-item" key={member.memberId}>
          <span className="member-avatar">{member.displayName.slice(0, 2)}</span>
          <span className="member-copy"><span className="member-name">{member.displayName}</span><span className="member-role">Worker · {member.objective || member.memberId}</span></span>
          <span className={`presence presence--${state}`} aria-label={label} title={label} />
        </div> })}
      </div>
    </section>
    <section className="right-section sidebar-section" aria-labelledby="promax-business-artifacts">
      <h2 className="sidebar-section-title" id="promax-business-artifacts">业务产物</h2>
      <div className="promax-artifact-tree">
        {progress.artifacts.map(row => <div className="promax-artifact-row" key={row.artifact.relativePath}>
          <div className="file-name">{row.label}</div><div className="file-meta">{team.members.find(member => member.memberId === row.artifact.producedBy)?.displayName ?? row.artifact.producedBy}</div>
          <div className="promax-artifact-stages"><span data-state={row.generation}><i />生成 · {progressLabel(row.generation, 'generation')}</span><span data-state={row.judgment}><i />判定 · {progressLabel(row.judgment, 'judgment')}</span></div>
        </div>)}
      </div>
    </section>
    <div className="team-note">主智能体负责理解、拆分和调度；独立 Judge 依据磁盘产物给出最终判定。</div>
  </>
}

export function PromaxDetailsSidebar(props: PromaxShellRuntimeProps & { sessionId?: string }) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const sessionState = props.useSessions(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const productTeam = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const productWorkspaces = productTeam === undefined ? [] : workspacesForTeam(productTeam, workspaceState.items)
  const history = useTaskHistory(productWorkspaces, props.readTaskHistory)
  const selectedSessionId = teamState.selected.kind === 'team' && teamState.selected.view === 'session' ? teamState.selected.sessionId : undefined
  const sessionId = selectedSessionId ?? props.sessionId ?? sessionState.current
  const team = sessionId === undefined ? undefined : teamForSession(teamState, sessionId)
  const binding = sessionId === undefined ? undefined : bindingForSession(teamState, sessionId)
  const workspace = team === undefined || sessionId === undefined ? undefined : workspaceForTeamSession(team, teamState, workspaceState.items, sessionId)
  const [files, setFiles] = useState<TaskRunFileSnapshot | undefined>(undefined)
  const [readError, setReadError] = useState<string | undefined>(undefined)
  const [readScope, setReadScope] = useState<string | undefined>(undefined)
  const readFailureStability = useRef<{ message?: string; consecutiveReads: number }>({ consecutiveReads: 0 })
  const snapshotStability = useRef<TaskRunSnapshotStability>({ consecutiveReads: 0 })
  const currentReadScope = !taskReadyBinding(binding) || workspace === undefined ? undefined : JSON.stringify([workspace.workspaceId, workspace.path, binding.sessionId, binding.taskKey])
  const currentFiles = readScope === currentReadScope ? files : undefined
  const currentReadError = readScope === currentReadScope ? readError : undefined
  useEffect(() => {
    setReadScope(currentReadScope)
    setFiles(undefined)
    setReadError(undefined)
    readFailureStability.current = { consecutiveReads: 0 }
    snapshotStability.current = { consecutiveReads: 0 }
    if (!taskReadyBinding(binding) || workspace === undefined || (binding.dispatchState !== 'confirmed' && binding.dispatchState !== 'running')) return
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const next = await props.readTaskRunFiles({ workspaceId: workspace.workspaceId, projectPath: workspace.path, sessionId: binding.sessionId, taskKey: binding.taskKey })
        if (active) {
          readFailureStability.current = { consecutiveReads: 0 }
          setReadError(undefined)
          const decision = taskRunSnapshotDecision(snapshotStability.current, next)
          snapshotStability.current = decision.next
          if (decision.publish) setFiles(next)
        }
      } catch (reason) {
        if (active) {
          const message = reason instanceof Error ? reason.message : String(reason)
          const consecutiveReads = readFailureStability.current.message === message ? readFailureStability.current.consecutiveReads + 1 : 1
          readFailureStability.current = { message, consecutiveReads }
          setReadError(current => surfacedTaskReadError(current, message, consecutiveReads))
        }
      }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 1_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [binding?.dispatchState, binding?.sessionId, binding?.taskKey, currentReadScope, props.readTaskRunFiles, workspace?.path, workspace?.workspaceId])
  const projectionResult = useMemo<{ projection?: TaskRunProjection; error?: string }>(() => {
    if (team === undefined || binding === undefined || currentFiles === undefined) return {}
    try { return { projection: taskRunProjectionOf({ team, binding, files: currentFiles }) } } catch (reason) { return { error: reason instanceof Error ? reason.message : String(reason) } }
  }, [binding, currentFiles, team])
  if (team === undefined) return <div className="right-sidebar" id="promax-status-panel"><div className="right-header"><div><div className="right-kicker">PROMAX</div><div className="right-title">最近产出</div></div><button className="promax-workbench-icon-button" type="button" aria-label="收起状态栏" aria-controls="promax-status-panel" aria-expanded="true" title="收起状态栏" onClick={props.layout.closeDetails}><Icon name="panelRight" size={17} /></button></div><div className="right-scroll">{history.error === undefined ? history.loading && history.items.length === 0 ? <div className="team-note" role="status">正在读取磁盘记录…</div> : <RecentOutputContent {...history.items[0] === undefined ? {} : { item: history.items[0] }} openTaskFolder={props.openTaskFolder} /> : <div className="team-note" role="alert">磁盘记录读取失败：{history.error}</div>}</div></div>
  const statusMessage = currentReadError ?? projectionResult.error
  if (binding?.dispatchState === 'planning') return <div className="right-sidebar" id="promax-status-panel"><div className="right-header"><div><div className="right-kicker">PROMAX</div><div className="right-title">状态与结果</div></div><button className="promax-workbench-icon-button" type="button" aria-label="收起状态栏" aria-controls="promax-status-panel" aria-expanded="true" title="收起状态栏" onClick={props.layout.closeDetails}><Icon name="panelRight" size={17} /></button></div><div className="right-scroll"><div className="team-note">等待确认调度名单；业务执行尚未开始。</div></div></div>
  const progress = teamProgressOf(team, projectionResult.projection, binding?.confirmedMemberIds)
  return <div className="right-sidebar" id="promax-status-panel"><div className="right-header"><div><div className="right-kicker">PROMAX</div><div className="right-title">状态与结果</div></div><button className="promax-workbench-icon-button" type="button" aria-label="收起状态栏" aria-controls="promax-status-panel" aria-expanded="true" title="收起状态栏" onClick={props.layout.closeDetails}><Icon name="panelRight" size={17} /></button></div><div className="right-scroll">{statusMessage === undefined ? projectionResult.projection === undefined ? <div className="team-note" role="status">正在读取 manifest 与磁盘文件状态…</div> : null : <TaskProjectionNotice message={statusMessage} compact />}<TeamStatusContent team={team} progress={progress} /></div></div>
}

function EmptyWorkspace({ title, copy }: { title: string; copy: string }) {
  return <div className="promax-workbench-empty"><span className="brand-mark" aria-hidden="true">P</span><h1>{title}</h1><p>{copy}</p></div>
}

function taskOutputDirectory(projectPath: string, taskKey: string): string {
  return `${projectPath.replace(/\/+$/u, '')}/deliverables/${taskKey}`
}

function OutputLocation({ projectPath, taskKey }: { projectPath: string; taskKey: string }) {
  const path = taskOutputDirectory(projectPath, taskKey)
  return <span className="meta-chip" aria-label={`产出目录：${path}`} title={path}><Icon name="folder" size={14} />产出目录：{path}</span>
}

function TaskProjectionNotice({ message, compact = false }: { message: string; compact?: boolean }) {
  const transportFailure = isTaskReadTransportError(message)
  return <section className={`promax-task-status-notice${compact ? ' promax-task-status-notice--compact' : ''}`} role="alert" aria-live="assertive">
      <span className="promax-task-status-icon" aria-hidden="true">!</span>
      <div><h2>{transportFailure ? '状态刷新暂时失败' : '任务文件校验未通过'}</h2>
      <p>{transportFailure
        ? '当前无法连接本机 Promax 服务。磁盘文件不会因此被删除；服务恢复后页面会自动重新读取。'
        : '磁盘任务文件没有通过结构或完整性校验。下方保留最近可用的工作台结构，不会猜测进度或误报完成。'}</p>
      <div className="promax-task-status-detail">{message}</div></div>
  </section>
}

function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function judgeDisplayOf(state: TaskRunFileSnapshot['judge']['state']): { label: string; tone: 'pass' | 'fail' | 'pending' } {
  if (state === 'pass') return { label: '✓ 判定通过', tone: 'pass' }
  if (state === 'absent') return { label: '判定中', tone: 'pending' }
  if (state === 'force_released') return { label: '✕ Judge 未通过 · 人工放行', tone: 'fail' }
  return { label: '✕ 判定不通过', tone: 'fail' }
}

function TaskFolderButton({ workspaceId, projectPath, sessionId, taskKey, openTaskFolder, toolbar = false }: {
  workspaceId: string
  projectPath: string
  sessionId: string
  taskKey: string
  openTaskFolder: WorkspaceShellActions['openTaskFolder']
  toolbar?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const open = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setMessage(undefined)
    try {
      const result = await openTaskFolder({ workspaceId, projectPath, sessionId, taskKey })
      setMessage(`已在系统文件管理器打开：${result.path}`)
    } catch (reason) {
      setMessage(`打开失败：${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setBusy(false)
    }
  }
  return <div className={`promax-open-folder-action${toolbar ? ' promax-open-folder-action--toolbar' : ''}`}>
    <button className={toolbar ? 'toolbar-button' : 'promax-button promax-button--primary'} type="button" disabled={busy} aria-label={toolbar ? busy ? '正在打开产物文件夹' : '打开产物文件夹' : undefined} title={toolbar ? '打开产物文件夹' : undefined} onClick={() => { void open() }}><Icon name="folder" size={15} /><span className={toolbar ? 'button-label' : undefined}>{busy ? '正在打开…' : toolbar ? '产物文件夹' : '打开文件夹'}</span></button>
    {message === undefined ? null : <small role="status">{message}</small>}
  </div>
}

function DiskFileList({ files, judge }: { files: TaskRunFileSnapshot['deliverableFiles']; judge: TaskRunFileSnapshot['judge'] }) {
  const judgeDisplay = judgeDisplayOf(judge.state)
  return <>
    <div className="promax-result-files" aria-label="磁盘业务产物">
      {files.length === 0 ? <div className="promax-result-empty">产出目录里还没有业务文件。</div> : files.map(file => <article className="promax-result-file" key={file.path}>
        <span className="promax-result-file-icon"><Icon name="artifact" size={19} /></span>
        <span className="promax-result-file-copy"><strong>{file.relativePath}</strong><small>{fileSizeLabel(file.bytes)}</small></span>
        <span className={`promax-result-judge promax-result-judge--${judgeDisplay.tone}`}>{judgeDisplay.label}</span>
      </article>)}
    </div>
    {judgeDisplay.tone !== 'fail' ? null : <div className="promax-judge-reason" role="alert"><strong>Judge 原因</strong><p>{judge.reason ?? 'Judge 报告没有给出可识别的失败原因。'}</p></div>}
  </>
}

function TaskResultContent({ workspace, files, openTaskFolder, statusMessage }: {
  workspace: WorkspaceView
  files: TaskRunFileSnapshot
  openTaskFolder: WorkspaceShellActions['openTaskFolder']
  statusMessage?: string
}) {
  return <div className="workspace-content promax-task-result">
    <div className="workspace-head"><div><div className="workspace-kicker">任务结果 · {minuteLabel(files.createdAt)}</div><h1 className="workspace-title">跑完了。{files.deliverableFiles.length} 个文件。</h1><p className="workspace-description">以下列表直接来自磁盘 `deliverables/{files.taskKey}/`；Judge 报告只作为判定状态显示。</p></div><div className="workspace-meta"><OutputLocation projectPath={workspace.path} taskKey={files.taskKey} /></div></div>
    {statusMessage === undefined ? null : <TaskProjectionNotice message={statusMessage} />}
    <DiskFileList files={files.deliverableFiles} judge={files.judge} />
    <TaskFolderButton workspaceId={workspace.workspaceId} projectPath={workspace.path} sessionId={files.parentSessionId} taskKey={files.taskKey} openTaskFolder={openTaskFolder} />
  </div>
}

function RecentOutputContent({ item, openTaskFolder }: { item?: TaskHistoryView; openTaskFolder: WorkspaceShellActions['openTaskFolder'] }) {
  if (item === undefined) return <div className="promax-recent-empty"><Icon name="folder" size={22} /><strong>还没有历史产出</strong><p>任务完成并写入磁盘后，最近一次产出会显示在这里。</p></div>
  return <section className="promax-recent-output" aria-labelledby="promax-recent-output-title">
    <div className="promax-recent-output-heading"><span>最近一次的产出</span><h2 id="promax-recent-output-title">{item.taskKey}</h2><time dateTime={item.createdAt}>{minuteLabel(item.createdAt)}</time></div>
    <DiskFileList files={item.deliverableFiles} judge={item.judge} />
    <TaskFolderButton workspaceId={item.workspaceId} projectPath={item.projectPath} sessionId={item.sessionId} taskKey={item.taskKey} openTaskFolder={openTaskFolder} />
  </section>
}

function WorkbenchContent({ team, workspace, session, taskKey, progress, availability, files, showJudgeFailure = false, statusMessage, syncing = false }: { team: PromaxTeam; workspace: WorkspaceView; session: SessionSummary | undefined; taskKey: string | undefined; progress: TeamProgressView; availability: TeamAvailabilityView; files?: TaskRunFileSnapshot; showJudgeFailure?: boolean; statusMessage?: string; syncing?: boolean }) {
  const summary = deliverableSummary(progress.artifacts)
  const memberViews = team.members
    .filter(member => member.enabled && progress.memberStates?.[member.memberId] !== undefined)
    .map(member => ({ member, state: memberExecutionStateOf(member, progress) }))
  const enabledMemberCount = memberViews.length
  const businessArtifactCount = progress.artifacts.length
  const percent = summary.involved === 0 ? 0 : Math.round(summary.ready / summary.involved * 100)
  const running = progress.evidence === 'running'
  const runningMemberCount = memberViews.filter(member => member.state === 'running').length
  return <div className="workspace-content">
    <div className="workspace-head"><div><div className="workspace-kicker">团队工作台 · {running ? '进行中' : summary.involved > 0 && summary.ready === summary.involved ? '已完成' : summary.ready > 0 ? '待验收' : '尚未完成'}</div><h1 className="workspace-title">{session?.displayTitle || workspace.title}</h1><p className="workspace-description">本次 manifest 登记 {enabledMemberCount} 名成员与 {businessArtifactCount} 项业务产物；状态只读取对应磁盘文件。</p></div><div className="workspace-meta">{taskKey === undefined ? null : <OutputLocation projectPath={workspace.path} taskKey={taskKey} />}<span className="meta-chip"><span className="status-dot" />{enabledMemberCount} Members</span><span className={`meta-chip team-availability--${availability.tone}`} role="status" aria-atomic="true"><Icon name="activity" size={15} />{availability.label}</span></div></div>
    {statusMessage === undefined ? null : <TaskProjectionNotice message={statusMessage} />}
    {syncing ? <div className="promax-task-sync-note" role="status">正在读取 manifest 与磁盘文件状态；工作台结构保持可见。</div> : null}
    {!showJudgeFailure || files === undefined ? null : <div className="promax-judge-reason" role="alert"><strong>Judge 原因</strong><p>{files.judge.reason ?? 'Judge 报告没有给出可识别的失败原因。'}</p></div>}
    <article className="task-card"><div className="task-card-head"><div><div className="task-label">当前目标</div><div className="task-goal">{session?.displayTitle || `为「${workspace.title}」启动一项产品任务`}</div></div><div className="task-percent">{percent}%</div></div><div className="progress-track" role="progressbar" aria-label="产物交付进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div className="progress-value" style={{ width: `${percent}%` }} /></div><div className="task-card-footer"><span className="coordinator-avatar">主</span><span className="coordinator-copy">{running ? '正在等待 manifest 登记的业务文件与独立 Judge 报告落盘。' : summary.involved > 0 && summary.ready === summary.involved ? '磁盘上的业务文件和独立 Judge 报告均已齐备。' : '尚未观察到完整的磁盘交付凭据。'}</span></div></article>
    <div className="section-bar"><div className="section-name">团队成员</div><div className="section-meta" role="status" aria-atomic="true">{runningMemberCount > 0 ? `${runningMemberCount} 人运行中` : `${enabledMemberCount} MEMBERS`}</div></div>
    <div className="agent-grid">{memberViews.map(({ member, state }) => <article className={`agent-card is-${state}`} key={member.memberId}><div className="agent-card-top"><div className="agent-avatar">{member.displayName.slice(0, 2)}</div><div><div className="agent-name">{member.displayName}</div><div className="agent-role">{member.memberId}</div></div></div><div className="agent-task">{member.objective}</div><div className="agent-footer"><span className="agent-state-dot" /><span>{state === 'done' ? '已完成' : state === 'blocked' ? '已阻断' : state === 'running' ? '运行中' : '未生成'}</span></div></article>)}</div>
    <div className="section-bar"><div className="section-name">交付物</div><div className="section-meta">{summary.ready} / {summary.involved} 就绪</div></div>
    <section className="deliverable-card" aria-label="业务产物"><div className="file-grid">{progress.artifacts.map(row => { const state = deliverableStateOf(row); return <article className={`file-item${state === 'ready' ? ' is-ready' : ''}`} key={row.artifact.relativePath}><Icon name="artifact" size={18} /><span className="file-copy"><span className="file-name">{row.label}</span><span className="file-meta">{fileMeta(state, row.judgment)}</span></span></article> })}</div></section>
  </div>
}

type WorkbenchTab = ComposerHostView

/** Frame-wide Promax chrome; it keeps dsh's conversation mounted under the task-trace tab. */
export function PromaxWorkspaceOverlay(props: PromaxShellRuntimeProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaceState = props.useWorkspaces(state => state)
  const sessionState = props.useSessions(state => state)
  const [tab, setTab] = useState<WorkbenchTab>('workbench')
  const [taskRunFiles, setTaskRunFiles] = useState<TaskRunFileSnapshot | undefined>(undefined)
  const [taskRunReadError, setTaskRunReadError] = useState<string | undefined>(undefined)
  const [taskRunReadScope, setTaskRunReadScope] = useState<string | undefined>(undefined)
  const readFailureStability = useRef<{ message?: string; consecutiveReads: number }>({ consecutiveReads: 0 })
  const snapshotStability = useRef<TaskRunSnapshotStability>({ consecutiveReads: 0 })
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedContext = teamState.selected
  const selectedSession = selectedContext.kind === 'team' && selectedContext.view === 'session'
  const productTeam = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const team = selectedSession ? teamState.teams.find(item => item.id === selectedContext.teamId) : productTeam
  const productWorkspaces = productTeam === undefined ? [] : workspacesForTeam(productTeam, workspaceState.items)
  const history = useTaskHistory(productWorkspaces, props.readTaskHistory)
  const defaultWorkspace = productWorkspaceOf(productWorkspaces) ?? productWorkspaces[0]
  const sessionId = selectedSession ? selectedContext.sessionId ?? sessionState.current : undefined
  const session = sessionId === undefined ? undefined : sessionState.byId[sessionId]
  const nativeSession = sessionState.current === undefined ? undefined : sessionState.byId[sessionState.current]
  const viewingDescendant = sessionId !== undefined
    && nativeSession !== undefined
    && nativeSession.id !== sessionId
    && belongsToTeamSession(sessionId, nativeSession, sessionState)
  const visibleSession = viewingDescendant ? nativeSession : session
  const workspace = selectedSession && team !== undefined && sessionId !== undefined
    ? workspaceForTeamSession(team, teamState, workspaceState.items, sessionId)
    : defaultWorkspace
  const taskBinding = sessionId === undefined ? undefined : bindingForSession(teamState, sessionId)
  const taskKey = taskBinding?.taskKey
  const currentTaskRunReadScope = !taskReadyBinding(taskBinding) || workspace === undefined ? undefined : JSON.stringify([workspace.workspaceId, workspace.path, taskBinding.sessionId, taskBinding.taskKey])
  const currentTaskRunFiles = taskRunReadScope === currentTaskRunReadScope ? taskRunFiles : undefined
  const currentTaskRunReadError = taskRunReadScope === currentTaskRunReadScope ? taskRunReadError : undefined
  const snapshot = useTeamSessionProgress(sessionId)
  const projectionResult = useMemo<{ projection?: TaskRunProjection; error?: string }>(() => {
    if (team === undefined || !taskReadyBinding(taskBinding)) return {}
    if (currentTaskRunFiles === undefined) return currentTaskRunReadError === undefined ? {} : { error: currentTaskRunReadError }
    try {
      const projection = taskRunProjectionOf({
        team,
        binding: taskBinding,
        files: currentTaskRunFiles,
      })
      return { projection, ...(currentTaskRunReadError === undefined ? {} : { error: currentTaskRunReadError }) }
    } catch (reason: unknown) {
      return { error: reason instanceof Error ? reason.message : String(reason) }
    }
  }, [currentTaskRunFiles, currentTaskRunReadError, taskBinding, team])
  const projection = projectionResult.projection
  const projectionError = projectionResult.error
  const progress = useMemo(() => team === undefined ? undefined : teamProgressOf(team, projection, taskBinding?.confirmedMemberIds), [projection, taskBinding?.confirmedMemberIds, team])
  const tree = teamSessionTreeOf(sessionId, sessionState)
  const availability = taskBinding?.dispatchState !== 'running'
    ? teamAvailabilityOf(snapshot, session, tree)
    : projectionError !== undefined
      ? { label: '状态读取失败', tone: 'error' as const }
    : projection === undefined
      ? { label: projectionError === undefined ? '状态同步中' : '状态读取失败', tone: projectionError === undefined ? 'active' as const : 'error' as const }
      : projection.phase === 'completed'
        ? { label: '任务完成', tone: 'idle' as const }
        : projection.phase === 'blocked'
          ? { label: '任务受阻', tone: 'error' as const }
          : projection.phase === 'cancelled'
            ? { label: '任务已停止', tone: 'warning' as const }
            : projection.phase === 'stopping'
              ? { label: '已请求停止 · 正在中止当前步骤', tone: 'warning' as const }
              : projection.phase === 'repairing' && projection.repair !== undefined
                ? { label: `第 ${String(projection.repair.round)}/${String(projection.repair.maxRounds)} 轮返修中`, tone: 'warning' as const }
              : projection.phase === 'judging'
                ? { label: projection.repair?.state === 'judging' ? `第 ${String(projection.repair.round)}/${String(projection.repair.maxRounds)} 轮复判中` : 'Judge 判定中', tone: 'active' as const }
                : { label: '任务运行中', tone: 'active' as const }

  useEffect(() => {
    if (currentTaskRunFiles !== undefined && taskBinding !== undefined && taskBinding.runState !== currentTaskRunFiles.cancellation) {
      setTeamSessionRunState(taskBinding.sessionId, currentTaskRunFiles.cancellation, currentTaskRunFiles.observedAt)
    }
  }, [currentTaskRunFiles, taskBinding])
  useEffect(() => {
    setTaskRunReadScope(currentTaskRunReadScope)
    setTaskRunFiles(undefined)
    setTaskRunReadError(undefined)
    readFailureStability.current = { consecutiveReads: 0 }
    snapshotStability.current = { consecutiveReads: 0 }
    if (!taskReadyBinding(taskBinding) || workspace === undefined) return
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const files = await props.readTaskRunFiles({
          workspaceId: workspace.workspaceId,
          projectPath: workspace.path,
          sessionId: taskBinding.sessionId,
          taskKey: taskBinding.taskKey,
        })
        if (!active) return
        if (files.parentSessionId === taskBinding.sessionId && files.taskKey === taskBinding.taskKey) {
          readFailureStability.current = { consecutiveReads: 0 }
          setTaskRunReadError(undefined)
          const decision = taskRunSnapshotDecision(snapshotStability.current, files)
          snapshotStability.current = decision.next
          if (decision.publish) setTaskRunFiles(files)
        }
      } catch (reason) {
        if (active) {
          const message = reason instanceof Error ? reason.message : String(reason)
          const consecutiveReads = readFailureStability.current.message === message ? readFailureStability.current.consecutiveReads + 1 : 1
          readFailureStability.current = { message, consecutiveReads }
          setTaskRunReadError(current => surfacedTaskReadError(current, message, consecutiveReads))
        }
      }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 1_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [currentTaskRunReadScope, props.readTaskRunFiles, taskBinding?.sessionId, taskBinding?.taskKey, workspace])

  useEffect(() => { setTab(viewingDescendant ? 'trace' : 'workbench') }, [sessionId, viewingDescendant, visibleSession?.id])
  useEffect(() => {
    if (!selectedSession && sessionState.current !== undefined) props.clearSession()
  }, [props.clearSession, selectedSession, sessionState.current])
  const activate = (next: WorkbenchTab): void => { setTab(next); if (scrollRef.current !== null) scrollRef.current.scrollTop = 0 }

  if (!selectedSession) {
    if (productTeam === undefined) return <EmptyWorkspace title="产品团队不可用" copy="没有找到产品智能体团队配置。" />
    return <TeamHome
      team={productTeam}
      workspace={defaultWorkspace}
      startSession={props.startSession}
      sendSessionMessage={props.sendSessionMessage}
      openSession={props.openSession}
      renameSession={props.renameSession}
      saveTaskAttachments={props.saveTaskAttachments}
      beginDispatchPlan={props.beginDispatchPlan}
      openTaskFolder={props.openTaskFolder}
      history={history}
    />
  }

  if (team === undefined || progress === undefined) {
    return <EmptyWorkspace title="需求记录不可用" copy="没有找到这个需求记录对应的团队配置。" />
  }

  const dispatchReview = dispatchReviewBinding(taskBinding) && taskBinding.dispatchState !== 'running'
  return <>
    <section className={`promax-workbench-layer${tab === 'trace' ? ' promax-workbench-layer--trace' : ''}`} aria-label="产品智能体团队工作区">
      <header className="topbar"><button className="promax-workbench-icon-button mobile-sidebar-button" type="button" aria-label="展开导航" aria-controls="promax-navigation-panel" aria-expanded="false" title="展开导航" onClick={props.layout.toggleSidebar}><Icon name="panelRight" size={18} /></button><div className="topbar-title-wrap"><div className="topbar-kicker">{viewingDescendant ? '子 Agent 上下文' : '需求记录'}</div><div className="topbar-title">{visibleSession?.displayTitle ?? '需求'}</div></div><div className={`team-availability team-availability--${availability.tone}`} role="status" aria-atomic="true"><span className="status-dot" />{availability.label}</div><div className="topbar-actions">{workspace === undefined || !taskReadyBinding(taskBinding) ? null : <TaskFolderButton toolbar workspaceId={workspace.workspaceId} projectPath={workspace.path} sessionId={taskBinding.sessionId} taskKey={taskBinding.taskKey} openTaskFolder={props.openTaskFolder} />}<button className="toolbar-button" type="button" onClick={() => { window.dispatchEvent(new Event('promax:open-preferences')) }}><Icon name="settings" size={15} /><span className="button-label">团队设置</span></button>{props.detailsOpen === false ? <button className="toolbar-button" type="button" aria-label="展开状态栏" aria-controls="promax-status-panel" aria-expanded="false" title="展开状态栏" onClick={props.layout.openDetails}><Icon name="panelRight" size={15} /><span className="button-label">状态栏</span></button> : null}</div></header>
      {dispatchReview ? null : <div className="view-tabs" role="tablist" aria-label="产品智能体团队视图">{([['workbench', 'grid', '工作台'], ['trace', 'activity', '任务轨迹'], ['deliverables', 'artifact', '交付物']] as const).map(([id, icon, label]) => <button className="view-tab" type="button" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} key={id} onClick={() => { activate(id) }}><Icon name={icon} size={15} />{label}</button>)}</div>}
      <div ref={scrollRef} className="main-scroll">
        {dispatchReview
          ? workspace === undefined
            ? <EmptyWorkspace title="工作目录不可用" copy="没有找到这个需求记录对应的工作目录。" />
            : <DispatchPlanReview key={taskBinding.sessionId} binding={taskBinding} team={team} workspace={workspace} snapshot={snapshot} confirmDispatchPlan={props.confirmDispatchPlan} sendSessionMessage={props.sendSessionMessage} />
          : workspace === undefined
            ? <EmptyWorkspace title="工作目录不可用" copy="没有找到这个需求记录对应的工作目录。" />
            : tab === 'trace'
              ? null
            : tab === 'workbench'
              ? <WorkbenchContent team={team} workspace={workspace} session={session} taskKey={taskKey} progress={progress} availability={availability} {...currentTaskRunFiles === undefined ? {} : { files: currentTaskRunFiles }} showJudgeFailure={projection?.phase === 'blocked'} {...projectionError === undefined ? {} : { statusMessage: projectionError }} syncing={taskBinding?.dispatchState === 'running' && projection === undefined && projectionError === undefined} />
              : tab === 'deliverables'
                ? currentTaskRunFiles === undefined
                  ? projectionError === undefined
                    ? <EmptyWorkspace title="正在读取磁盘产出" copy="读取完成前不显示文件列表。" />
                    : <div className="workspace-content"><TaskProjectionNotice message={projectionError} /></div>
                  : <TaskResultContent workspace={workspace} files={currentTaskRunFiles} openTaskFolder={props.openTaskFolder} {...projectionError === undefined ? {} : { statusMessage: projectionError }} />
                : null}
      </div>
      {workspace === undefined || dispatchReview ? null : <PromaxComposerHost view={tab} />}
    </section>
  </>
}
