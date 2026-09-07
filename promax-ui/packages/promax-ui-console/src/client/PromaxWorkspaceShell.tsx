import type { DeletePreview, DeleteTarget, RecycleEntry, recycleBinApi } from './recycle-bin.ts'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '../components/icons.tsx'
import { MemberAvatar, PromaxLogo } from '../components/BrandAssets.tsx'
import { installPromaxConsoleStyles } from '../styles.ts'
import { ConsoleLauncher } from './ConsoleLauncher.tsx'
import { showTaskOutputs } from './TaskOutputs.tsx'
import { ProjectFiles, type ProjectFileActions } from './ProjectFiles.tsx'
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
  selectProjectFiles,
  closeProjectFiles,
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

const MEMBER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  team_lead: '团队协调员',
  customer_research: '客户研究员',
  product_discovery: '竞品分析师',
  requirement_management: '需求管理员',
  solution_design: '方案设计师',
  requirement_review: '需求评审员',
  user_analysis: '数据分析师',
  quality_judge: '质量审核',
}

export function memberDisplayName(memberId: string, displayName = '团队成员'): string {
  return Object.hasOwn(MEMBER_DISPLAY_NAMES, memberId) ? MEMBER_DISPLAY_NAMES[memberId]! : displayName
}

/** Translate identifiers in model-written plan copy only at the rendering boundary. */
function memberDisplayText(text: string, team: PromaxTeam): string {
  return text.replace(/(?<![\w./])[a-z][a-z0-9_]*(?![\w./])/gu, id => {
    const member = team.members.find(candidate => candidate.memberId === id)
    return member === undefined ? memberDisplayName(id, id) : memberDisplayName(id, member.displayName)
  })
}

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

export interface WorkspaceShellActions extends ProjectFileActions {
  createProject: (projectName: string) => Promise<WorkspaceView>
  startSession: (workspaceId: string, presetId: string) => Promise<string>
  sendSessionMessage: (sessionId: string, text: string) => Promise<void>
  openSession: (sessionId: string) => void
  clearSession: () => void
  recycleBin: typeof recycleBinApi
  renameSession: (sessionId: string, title: string) => Promise<void>
  saveTaskAttachments: (input: {
    workspaceId: string
    projectPath: string
    sessionId: string
    demand: string
    files: Array<{ name: string; mediaType: string; contentBase64: string }>
  }) => Promise<{ paths: string[]; attachments: TaskAttachmentContext[]; manifestPath: string; taskKey: string; sessionName: string }>
  beginDispatchPlan: (input: { sessionId: string; taskKey: string; rosterMemberIds: string[] }) => Promise<{ planId: string; taskKey: string }>
  confirmDispatchPlan: (input: { workspaceId: string; projectPath: string; sessionId: string; planId: string; plan: DispatchPlan; confirmedMemberIds: string[]; artifacts: Array<{ path: string; memberId: string }> }) => Promise<{ planId: string; taskKey: string; confirmedMemberIds: string[]; confirmedAt: string }>
  readTaskRunFiles: (input: { workspaceId: string; projectPath: string; sessionId: string; taskKey: string }) => Promise<TaskRunFileSnapshot>
  readTaskHistory: (input: { workspaceId: string; projectPath: string }) => Promise<TaskHistoryItem[]>
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

function projectConfiguration(): { root?: string; defaultWorkspaceId?: string } {
  const content = document.querySelector('meta[name="promax-projects"]')?.getAttribute('content')
  return content ? JSON.parse(decodeURIComponent(content)) as { root: string; defaultWorkspaceId: string } : {}
}

export function workspacesForTeam(team: PromaxTeam, workspaces: readonly WorkspaceView[]): WorkspaceView[] {
  if (team.id === PRODUCT_TEAM_ID) {
    const configuration = projectConfiguration()
    return workspaces.filter(workspace => workspace.workspaceId === configuration.defaultWorkspaceId
      || workspace.path.replace(/[/\\]+$/u, '').split(/[/\\]/u).slice(0, -1).join('/') === configuration.root)
  }
  return workspaces.filter(workspace => team.workspaceIds.includes(workspace.workspaceId))
}

function selectedProject(state: PromaxTeamState, projects: readonly WorkspaceView[]): WorkspaceView | undefined {
  const selected = state.selected
  const workspaceId = selected.workspaceId ?? (selected.kind === 'team' && selected.sessionId !== undefined ? bindingForSession(state, selected.sessionId)?.workspaceId : undefined)
  return projects.find(project => project.workspaceId === workspaceId)
    ?? projects.find(project => project.workspaceId === projectConfiguration().defaultWorkspaceId)
    ?? projects[0]
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
  const [readScope, setReadScope] = useState(workspaceKey)
  useEffect(() => {
    let active = true
    setReadScope(workspaceKey)
    setItems([])
    setError(undefined)
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
  return readScope === workspaceKey ? { items, loading, ...(error === undefined ? {} : { error }) } : { items: [], loading: true }
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
  const title = asset.taskKey
  const statusLabel = asset.status === 'running' ? '执行中' : asset.status === 'completed' ? '已完成' : '失败'

  return (
    <div className="promax-session-row-shell">
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
      <RowActions label={`会话操作：${title}`} action="删除会话" onDelete={() => { onRequestDelete(session) }} />
    </div>
  )
}

function RowActions({ label, action, onDelete }: { label: string; action: string; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const menuItemRef = useRef<HTMLButtonElement>(null)
  const actionsRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

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

  return <div ref={shellRef} className="promax-row-actions">
    <button ref={actionsRef} type="button" className="promax-session-actions" aria-label={label} aria-haspopup="menu" aria-controls={menuId} aria-expanded={menuOpen} onClick={() => { setMenuOpen(value => !value) }}><Icon name="more" size={16} /></button>
    {menuOpen ? <div id={menuId} className="promax-session-menu" role="menu" aria-label={label}>
      <button ref={menuItemRef} type="button" className="promax-session-menu-delete" role="menuitem" onClick={() => { setMenuOpen(false); onDelete() }}>{action}</button>
    </div> : null}
  </div>
}

function DeleteDialog({ target, recycleBin, onCancel, onDeleted }: {
  target: DeleteTarget
  recycleBin: typeof recycleBinApi
  onCancel: () => void
  onDeleted: (id: string, preview: DeletePreview) => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [preview, setPreview] = useState<DeletePreview>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const close = (): void => { if (!busy) onCancel() }
  useDialogKeyboard(true, close, cancelRef)
  useEffect(() => {
    let active = true
    void recycleBin.preview(target).then(value => { if (active) setPreview(value) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [recycleBin, target])
  return createPortal(<div className="promax-team-create-backdrop">
    <section className="promax-team-create-dialog promax-session-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-delete-heading" aria-describedby="promax-delete-description">
      <header><div><h2 id="promax-delete-heading">删除{target.kind === 'project' ? '项目' : '会话'}？</h2>
        <p id="promax-delete-description">{preview === undefined ? error === undefined ? '正在核对删除范围…' : '未能确认删除范围。' : `“${preview.title}”包含 ${preview.sessionCount} 个会话、${preview.fileCount} 个文件。`}</p></div>
        <button type="button" className="promax-icon-button" aria-label="关闭删除确认" disabled={busy} onClick={close}><Icon name="close" size={15} /></button></header>
      <p className="promax-delete-scope">{target.kind === 'project' ? '项目内全部会话、附件、产出和 Judge 记录将移入回收站。' : '会话及其专属附件、产出和 Judge 记录将移入回收站，共享源文件保留。'}可在回收站恢复。</p>
      {error === undefined ? null : <div className="promax-inline-error" role="alert">{error}</div>}
      <footer><button ref={cancelRef} type="button" className="promax-button" disabled={busy} onClick={close}>取消</button><button type="button" className="promax-button promax-button--danger" disabled={busy || preview === undefined || error !== undefined} onClick={() => {
        if (preview === undefined) return
        setBusy(true)
        void recycleBin.remove(preview).then(result => { onDeleted(result.id, preview) }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
      }}>{busy ? '正在删除…' : '移入回收站'}</button></footer>
    </section>
  </div>, document.body)
}

function RecycleBinDialog({ recycleBin, onClose }: { recycleBin: typeof recycleBinApi; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [items, setItems] = useState<RecycleEntry[]>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [purging, setPurging] = useState<RecycleEntry>()
  useEffect(() => { closeRef.current?.focus() }, [purging])
  const close = (): void => { if (!busy) { if (purging !== undefined) setPurging(undefined); else onClose() } }
  useDialogKeyboard(true, close, closeRef)
  useEffect(() => {
    let active = true
    void recycleBin.list().then(value => { if (active) setItems(value.items) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [recycleBin])
  const restore = (item: RecycleEntry): void => {
    setBusy(true); setError(undefined)
    void recycleBin.restore(item.id).then(() => { recycleBin.refresh() }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
  }
  return createPortal(<div className="promax-team-create-backdrop">
    <section className="promax-team-create-dialog promax-recycle-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-recycle-heading">
      <header><h2 id="promax-recycle-heading">{purging === undefined ? '回收站' : '永久删除？'}</h2><button ref={closeRef} type="button" className="promax-icon-button" aria-label="关闭回收站" disabled={busy} onClick={close}><Icon name="close" size={15} /></button></header>
      {error === undefined ? null : <div className="promax-inline-error" role="alert">{error}</div>}
      {purging === undefined ? <>
        <p className="promax-delete-scope">删除的项目和会话会保留在这里，直到你恢复或永久删除。</p>
        {items === undefined ? <p role="status">正在读取…</p> : items.length === 0 ? <p>回收站为空</p> : <ul className="promax-recycle-list">{items.map(item => <li key={item.id}>
          <div><strong>{item.title}</strong><small>{item.kind === 'project' ? '项目' : `会话 · ${item.projectTitle}`} · {item.sessionCount} 个会话 · {item.fileCount} 个文件</small><small>{minuteLabel(item.deletedAt)}</small></div>
          <div className="promax-recycle-actions"><button type="button" className="promax-button" disabled={busy} onClick={() => { restore(item) }}>恢复</button><button type="button" className="promax-button promax-button--danger" disabled={busy} onClick={() => { setError(undefined); setPurging(item) }}>永久删除</button></div>
        </li>)}</ul>}
      </> : <>
        <p className="promax-delete-scope">“{purging.title}”包含 {purging.sessionCount} 个会话、{purging.fileCount} 个文件，永久删除后无法恢复。</p>
        <footer><button type="button" className="promax-button" disabled={busy} onClick={() => { setPurging(undefined) }}>取消</button><button type="button" className="promax-button promax-button--danger" disabled={busy} onClick={() => {
          setBusy(true); setError(undefined)
          void recycleBin.purge(purging.id).then(() => { setItems(current => current?.filter(item => item.id !== purging.id)); setPurging(undefined) }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
        }}>{busy ? '正在永久删除…' : '确认永久删除'}</button></footer>
      </>}
    </section>
  </div>, document.body)
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
  recycleBin,
  readTaskHistory,
  createProject,
}: SidebarProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaceState = useWorkspaces(state => state)
  const sessionState = useSessions(state => state)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleteNotice, setDeleteNotice] = useState<{ id: string; title: string } | null>(() => {
    const saved = sessionStorage.getItem('promax:deleted')
    try { return saved === null ? null : JSON.parse(saved) as { id: string; title: string } } catch { return null }
  })
  useEffect(() => { sessionStorage.removeItem('promax:deleted') }, [])
  const [noticeError, setNoticeError] = useState<string>()
  const [restoring, setRestoring] = useState(false)
  const team = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const teamWorkspaces = team === undefined ? [] : workspacesForTeam(team, workspaceState.items)
  const homeWorkspace = selectedProject(teamState, teamWorkspaces)
  const sessions = team === undefined ? [] : sessionsForTeam(team, teamState, workspaceState.items, sessionState, workspaceState.archivedSessionIds)
  const homeSelected = teamState.selected.kind !== 'team' || teamState.selected.view === 'home'

  useEffect(() => {
    if (deleteNotice === null) return
    const timeout = window.setTimeout(() => { setDeleteNotice(null) }, 12000)
    return () => { window.clearTimeout(timeout) }
  }, [deleteNotice])

  if (!wide) {
    return <button type="button" className="promax-context-rail-button" aria-label="展开 Promax 导航" title="Promax 导航" onClick={expandSidebar}><Icon name="team" size={19} /></button>
  }

  const deleted = (id: string, preview: DeletePreview): void => {
    if (preview.kind === 'project' && homeWorkspace?.workspaceId === preview.workspaceId) {
      const next = teamWorkspaces.find(workspace => workspace.workspaceId !== preview.workspaceId)
      if (team !== undefined) selectTeamHome(team.id, next?.workspaceId)
      clearSession()
    } else if (preview.kind === 'session' && (sessionState.current === preview.sessionId || (teamState.selected.kind === 'team' && teamState.selected.sessionId === preview.sessionId))) {
      if (team !== undefined) selectTeamHome(team.id, preview.workspaceId)
      clearSession()
    }
    setDeleteTarget(null)
    const notice = { id, title: preview.title }
    setDeleteNotice(notice)
    sessionStorage.setItem('promax:deleted', JSON.stringify(notice))
    recycleBin.refresh()
  }

  return (
    <nav className="promax-session-browser" aria-label="Promax 工作入口">
      <button type="button" className="promax-new-session" aria-current={homeSelected && !(teamState.selected.kind === 'team' && teamState.selected.filePath !== undefined) ? 'page' : undefined} disabled={team === undefined || homeWorkspace === undefined} onClick={() => { if (team !== undefined) selectTeamHome(team.id, homeWorkspace?.workspaceId); clearSession() }}><Icon name="plus" size={15} />新需求</button>
      <section className="promax-nav-section" aria-labelledby="promax-request-list-heading">
        <ProjectCreator createProject={createProject} onSelect={workspaceId => { if (team !== undefined) selectTeamHome(team.id, workspaceId); clearSession() }} />
        {teamWorkspaces.length === 0 ? <div className="promax-session-empty">{workspaceState.state === 'loading' ? '正在读取项目…' : '还没有项目'}</div> : teamWorkspaces.map(workspace => <ProjectRequests
          key={workspace.workspaceId}
          workspace={workspace}
          current={homeWorkspace?.workspaceId === workspace.workspaceId}
          currentSessionId={teamState.selected.kind === 'team' && teamState.selected.view === 'session' ? teamState.selected.sessionId ?? sessionState.current : undefined}
          sessions={sessions.filter(session => team !== undefined && workspaceForTeamSession(team, teamState, teamWorkspaces, session.id)?.workspaceId === workspace.workspaceId)}
          readTaskHistory={readTaskHistory}
          onSelect={() => { if (team !== undefined) selectTeamHome(team.id, workspace.workspaceId); clearSession() }}
          onOpen={session => { if (team !== undefined) selectTeamSession(team.id, session.id, workspace.workspaceId); openSession(session.id) }}
          onRequestDelete={session => { setDeleteTarget({ kind: 'session', workspaceId: workspace.workspaceId, sessionId: session.id }) }}
          onDeleteProject={() => { setDeleteTarget({ kind: 'project', workspaceId: workspace.workspaceId }) }}
        />)}
      </section>
      {workspaceState.state === 'error' ? <div className="promax-session-error">工作区读取失败</div> : null}
      {deleteNotice === null ? null : <div className="promax-session-success" role="status">已将“{deleteNotice.title}”移入回收站 <button type="button" disabled={restoring} onClick={() => {
        setRestoring(true)
        void recycleBin.restore(deleteNotice.id).then(() => { setDeleteNotice(null); recycleBin.refresh() }).catch(reason => { setNoticeError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setRestoring(false) })
      }}>{restoring ? '正在恢复…' : '撤销'}</button></div>}
      {noticeError === undefined ? null : <div role="alert" className="promax-inline-error">{noticeError}</div>}
      {deleteTarget === null ? null : <DeleteDialog target={deleteTarget} recycleBin={recycleBin} onCancel={() => { setDeleteTarget(null) }} onDeleted={deleted} />}
    </nav>
  )
}

function ProjectRequests({ workspace, current, currentSessionId, sessions, readTaskHistory, onSelect, onOpen, onRequestDelete, onDeleteProject }: {
  workspace: WorkspaceView
  current: boolean
  currentSessionId: string | undefined
  sessions: readonly SessionSummary[]
  readTaskHistory: WorkspaceShellActions['readTaskHistory']
  onSelect: () => void
  onOpen: (session: SessionSummary) => void
  onRequestDelete: (session: SessionSummary, taskKey: string) => void
  onDeleteProject: () => void
}) {
  const [expanded, setExpanded] = useState(current)
  const recordsId = useId()
  const history = useTaskHistory(expanded ? [workspace] : [], readTaskHistory)
  const sessionById = new Map(sessions.map(session => [session.id, session]))
  const rows = history.items.flatMap(asset => {
    const session = sessionById.get(asset.sessionId)
    return session === undefined ? [] : [{ session, asset }]
  })
  useEffect(() => { if (current) setExpanded(true) }, [current])
  return <section className="promax-project-node" aria-label={`${workspace.title}项目`}>
    <div className="promax-project-header">
      <button type="button" className="promax-project-row" aria-expanded={expanded} aria-controls={recordsId} aria-current={current ? 'location' : undefined} title={workspace.title} onClick={() => {
        setExpanded(current ? !expanded : true)
        if (!current) onSelect()
      }}><span className="promax-project-chevron"><Icon name="chevronRight" size={13} /></span><Icon name="folder" size={17} /><span className="promax-project-title">{workspace.title}</span></button>
      <button type="button" className="promax-project-new-session" aria-label={`在${workspace.title}中新建需求`} title="新需求" onClick={() => { setExpanded(true); onSelect() }}><Icon name="plus" size={15} /></button>
      <RowActions label={`项目操作：${workspace.title}`} action="删除项目" onDelete={onDeleteProject} />
    </div>
    <div id={recordsId} className="promax-project-sessions" hidden={!expanded}>
      {!expanded ? null : <>
        <div className="promax-project-folder"><button type="button" onClick={() => { selectProjectFiles(workspace.workspaceId) }}><Icon name="folder" size={14} />项目文件</button></div>
        {history.error === undefined ? null : <div className="promax-session-error" role="alert">磁盘记录读取失败：{history.error}</div>}
        {history.loading && rows.length === 0 ? <div className="promax-session-empty" role="status">正在读取磁盘记录…</div> : rows.length === 0 && history.error === undefined ? <div className="promax-session-empty">还没有产出记录</div> : rows.map(({ session, asset }) => <SessionRow key={session.id} session={session} asset={asset} current={currentSessionId === session.id} onOpen={() => { onOpen(session) }} onRequestDelete={row => { onRequestDelete(row, asset.taskKey) }} />)}
      </>}
    </div>
  </section>
}

function ProjectCreator({ createProject, onSelect }: {
  createProject: WorkspaceShellActions['createProject']
  onSelect: (workspaceId: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const createButton = useRef<HTMLButtonElement>(null)
  return <div className="promax-project-switcher">
    <div className="promax-project-tree-header"><h2 id="promax-request-list-heading">项目</h2><button ref={createButton} className="promax-project-create" type="button" aria-label="新建项目" title="新建项目" aria-expanded={creating} disabled={busy} onClick={() => { setCreating(value => !value); setError(undefined) }}><Icon name="plus" size={15} /></button></div>
    {creating ? <form onSubmit={event => {
      event.preventDefault()
      if (busy || name.trim() === '') return
      setBusy(true)
      setError(undefined)
      void createProject(name.trim()).then(project => { onSelect(project.workspaceId); setCreating(false); setName(''); createButton.current?.focus() }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
    }}>
      <label>项目名称<input aria-label="项目名称" autoFocus required maxLength={80} value={name} disabled={busy} onChange={event => { setName(event.currentTarget.value) }} /></label>
      <div><button className="promax-button promax-button--primary" type="submit" disabled={busy || name.trim() === ''}>{busy ? '正在创建…' : '创建项目'}</button><button className="promax-button" type="button" disabled={busy} onClick={() => { setCreating(false); createButton.current?.focus() }}>取消</button></div>
      {error === undefined ? null : <p role="alert">{error}</p>}
    </form> : null}
  </div>
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

export function taskAvailabilityOf(projection: TaskRunProjection | undefined, error?: string): TeamAvailabilityView {
  if (error !== undefined) return { label: '状态读取失败', tone: 'error' }
  if (projection === undefined) return { label: '状态同步中', tone: 'active' }
  if (projection.phase === 'completed') return { label: '任务完成', tone: 'idle' }
  if (projection.phase === 'blocked') return { label: '任务受阻', tone: 'error' }
  if (projection.phase === 'cancelled') return { label: '任务已停止', tone: 'warning' }
  if (projection.phase === 'stopping') return { label: '已请求停止 · 正在中止当前步骤', tone: 'warning' }
  if (projection.phase === 'repairing' && projection.repair !== undefined) return { label: `第 ${projection.repair.round}/${projection.repair.maxRounds} 轮返修中`, tone: 'warning' }
  if (projection.phase === 'judging') return { label: projection.repair?.state === 'judging' ? `第 ${projection.repair.round}/${projection.repair.maxRounds} 轮复判中` : '独立审核中', tone: 'active' }
  return { label: '任务运行中', tone: 'active' }
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
      copy: routed.map(member => memberDisplayName(member.memberId, member.displayName)).join('、'),
      time,
      tone: 'active',
    }
  }
  return {
    key: `assistant-${String(turn ?? node.messageId ?? time)}`,
    title: `${suffix || '当前轮'}协调已响应`,
    copy: `当前轮已有${memberDisplayName('team_lead')}回复；任务状态由结构化生命周期和权威任务文件另行投影。`,
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

function TeamHome({ team, workspace, startSession, sendSessionMessage, openSession, renameSession, saveTaskAttachments, beginDispatchPlan }: Pick<WorkspaceShellActions, 'startSession' | 'sendSessionMessage' | 'openSession' | 'renameSession' | 'saveTaskAttachments' | 'beginDispatchPlan'> & { team: PromaxTeam; workspace: WorkspaceView | undefined }) {
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
      <header className="topbar"><div className="topbar-title-wrap"><span className="topbar-project">{workspace?.title ?? '当前项目'}</span><span className="topbar-divider">/</span><span className="topbar-title">新需求</span></div><button className="toolbar-button" type="button" onClick={() => { window.dispatchEvent(new Event('promax:open-preferences')) }}><Icon name="settings" size={15} />团队设置</button></header>
      <div className="promax-team-interaction" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }} onDrop={event => { event.preventDefault(); event.stopPropagation(); addFiles(event.dataTransfer.files) }}><div className="promax-room-intro"><div><h2>{workspace === undefined ? '工作目录不可用' : '这次，需要团队完成什么？'}</h2><p>{workspace === undefined ? '请检查产品工作目录是否已经安装。' : '描述目标或添加材料，团队会提出成员分工与交付计划。'}</p></div></div><div className="promax-team-prompt-block"><textarea aria-label="需求输入" autoFocus className="promax-team-prompt" value={draft} disabled={workspace === undefined || busy} placeholder="输入需求，或直接添加文件……" onChange={event => { setDraft(event.currentTarget.value) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} /><input ref={fileRef} className="promax-file-input" type="file" accept={TASK_ATTACHMENT_ACCEPT} multiple tabIndex={-1} aria-hidden="true" onChange={event => { addFiles(event.currentTarget.files); event.currentTarget.value = '' }} />{files.length === 0 ? null : <div className="promax-composer-attachment-count promax-upload-file-list" aria-label="待发送附件">{files.map((item, index) => <button aria-label={`${item.uploadName} ×`} key={`${item.uploadName}:${String(item.file.size)}:${String(item.file.lastModified)}:${String(index)}`} type="button" className="promax-upload-file" disabled={busy} onClick={() => { setFiles(current => current.filter((_item, itemIndex) => itemIndex !== index)); setAttachmentError(null) }}><Icon name="paperclip" size={14} /><span><strong>{item.uploadName}</strong><small>{busy && submissionStage === 'preparing' ? '正在解析内容' : '待上传'} · {(item.file.size / 1024).toFixed(item.file.size >= 1024 ? 0 : 1)} KB</small></span><span aria-hidden="true">×</span></button>)}</div>}{busy && submissionStage !== 'idle' ? <SubmissionProgress stage={submissionStage} hasFiles={files.length > 0} /> : null}<div className="promax-team-prompt-actions"><button type="button" className="promax-button" disabled={workspace === undefined || busy} onClick={() => { fileRef.current?.click() }}><Icon name="paperclip" size={15} />添加文件</button><button type="button" className="promax-button promax-button--primary" disabled={workspace === undefined || revision === undefined || team.members.length === 0 || busy || (draft.trim() === '' && files.length === 0) || attachmentError !== null} onClick={send}>{busy ? submissionStage === 'preparing' ? '正在解析…' : submissionStage === 'planning' ? '正在规划…' : '正在创建…' : '生成计划'}</button></div></div></div>
      {attachmentError === null ? null : <div className="promax-team-page-error" role="alert">{attachmentError}</div>}
      {error === null ? null : <div className="promax-team-page-error" role="alert">{error}</div>}
    </section>

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
        <div className="promax-member-picker-list">{plan.members.map(member => { const definition = team.members.find(item => item.memberId === member.memberId)!; const checked = selectedMemberIds.includes(member.memberId); const fixed = isJudgeMember(definition); return <label className="promax-dispatch-choice" key={member.memberId}><input type="checkbox" checked={checked} disabled={busy || fixed} onChange={event => { onToggle(member.memberId, event.currentTarget.checked) }} /><span><strong>{memberDisplayName(definition.memberId, definition.displayName)}{fixed ? ' · 固定参与' : ''}</strong><small>{definition.objective}</small><small className="promax-member-picker-output">将产出 {memberDeliverables(plan, member.memberId)}</small></span></label> })}</div>
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
  const autoCancelKey = `promax:dispatch-auto-cancelled:${binding.sessionId}:${binding.dispatchPlanId}`
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(() => {
    try { return window.sessionStorage.getItem(autoCancelKey) === '1' ? null : 20 } catch { return 20 }
  })
  const countdownRef = useRef<number>()
  const executingRef = useRef(false)
  const autoExecuteRef = useRef<() => void>(() => {})
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

  const cancelCountdown = (): void => {
    window.clearInterval(countdownRef.current)
    setRemainingSeconds(null)
    // Keep an explicit cancellation when this tab revisits or reloads the plan.
    try { window.sessionStorage.setItem(autoCancelKey, '1') } catch { /* The mounted page still remains cancelled. */ }
  }

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
    if (plan === undefined || !memberIds.some(memberId => memberId !== 'quality_judge') || busy || planning || executingRef.current) return
    cancelCountdown()
    executingRef.current = true
    const selected = new Set([...memberIds, 'quality_judge'])
    const ordered = plan.members.filter(member => selected.has(member.memberId)).map(member => member.memberId)
    const artifacts = plan.members.filter(member => selected.has(member.memberId)).flatMap(member => member.deliverables.map(path => ({ path, memberId: member.memberId })))
    setBusy(true)
    setError(null)
    void (async () => {
      if (!confirmed) {
        const frozen = await confirmDispatchPlan({ workspaceId: binding.workspaceId, projectPath: workspace.path, sessionId: binding.sessionId, planId: binding.dispatchPlanId, plan, confirmedMemberIds: ordered, artifacts })
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
    })().catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { executingRef.current = false; setBusy(false) })
  }

  const autoStart = remainingSeconds !== null && plan !== undefined
    && plan.members.some(member => member.selected && member.memberId !== 'quality_judge')
    && !planning && !busy && !confirmed && !editing
    && error === null && resolution.error === undefined && snapshot?.lastAgentError == null

  useLayoutEffect(() => {
    autoExecuteRef.current = () => { execute(plan?.members.filter(member => member.selected).map(member => member.memberId) ?? []) }
  })

  useEffect(() => {
    if (!autoStart) return
    const deadline = Date.now() + 20_000
    setRemainingSeconds(20)
    countdownRef.current = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000))
      if (remaining === 0) {
        window.clearInterval(countdownRef.current)
        autoExecuteRef.current()
      } else setRemainingSeconds(remaining)
    }, 1_000)
    return () => { window.clearInterval(countdownRef.current) }
  }, [autoStart])

  if (plan === undefined) {
    const waiting = snapshot === undefined || planning
    return <div className="promax-dispatch-page">
      <section className="promax-dispatch-card" aria-live="polite">
        <div className="promax-room-intro"><span className="promax-room-sequence" aria-hidden="true">02</span><div><span className="promax-eyebrow">PROMAX</span><h1>{waiting ? '正在判断这次怎么干' : '这次计划没有生成成功'}</h1><p>{waiting ? `${memberDisplayName('team_lead')}只在分析输入；运行时已锁住全部工具和业务成员。` : '模型没有返回可确认的完整结构化计划，业务执行仍未开始。'}</p></div></div>
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
    const hasAttachments = binding.dispatchAttachmentPaths.length > 0
    const goalLabel = hasAttachments ? '补充分析目标' : '补充任务目标'
    return <div className="promax-dispatch-page">
      <section className="promax-dispatch-card" aria-labelledby="promax-dispatch-heading">
        <div className="promax-room-intro"><span className="promax-room-sequence" aria-hidden="true">02</span><div><span className="promax-eyebrow">PROMAX</span><h1 id="promax-dispatch-heading">还需要你{goalLabel}</h1><DispatchAssessment>{memberDisplayText(plan.assessment, team)}</DispatchAssessment></div></div>
        <DispatchInputSummary binding={binding} planning={planning} />
        {planning ? <DispatchPlanningProgress reparsing /> : null}
        <section className="promax-dispatch-clarification" aria-labelledby="promax-clarification-heading">
          <span className="promax-dispatch-clarification-state">暂未派单</span>
          <div><h2 id="promax-clarification-heading">{hasAttachments ? '你希望怎么分析这份文档？' : '你想让团队帮你做什么？'}</h2><p>{hasAttachments ? '选择一个方向，或直接写下你希望得到的结果。补充后会沿用当前文档重新规划。' : '可以补充产品目标、待解决的问题或希望得到的结果。明确后再安排员工。'}</p></div>
          {hasAttachments ? <fieldset className="promax-dispatch-clarification-options"><legend>快捷选择</legend><div>{DISPATCH_CLARIFICATION_OPTIONS.map(option => <button key={option} type="button" aria-pressed={clarification === option} disabled={busy || planning} onClick={() => { setClarification(option) }}>{option}</button>)}</div></fieldset> : null}
          <label className="promax-dispatch-clarification-input"><span>{goalLabel}</span><textarea aria-label={goalLabel} value={clarification} disabled={busy || planning} placeholder={hasAttachments ? '例如：重点检查这份方案的风险、遗漏和落地可行性' : '例如：评审登录流程的需求，列出风险和验收建议'} onChange={event => { setClarification(event.currentTarget.value) }} /></label>
          <div className="promax-dispatch-actions"><button className="promax-button promax-button--primary" type="button" disabled={busy || planning || clarification.trim() === ''} onClick={() => { retryPlanning(clarification) }}>{planning ? '正在重新规划…' : '补充后重新规划'}</button><button ref={editTriggerRef} className="promax-button" type="button" aria-expanded={editing} disabled={busy || planning} onClick={() => { setEditing(value => !value) }}>{editing ? '收起员工名单' : '手动选择员工'}</button></div>
        </section>
        {editing ? <DispatchMemberDialog plan={plan} team={team} selectedMemberIds={selectedMemberIds} busy={busy} returnFocusRef={editTriggerRef} onToggle={(memberId, selected) => { if (memberId !== 'quality_judge') setSelectedMemberIds(current => selected ? [...current, memberId] : current.filter(id => id !== memberId)) }} onClose={() => { setEditing(false) }} onExecute={() => { setEditing(false); execute(selectedMemberIds) }} /> : null}
        <details className="promax-dispatch-skipped"><summary>为什么暂时没有选人</summary><div className="promax-dispatch-list">{skipped.map(member => { const definition = team.members.find(item => item.memberId === member.memberId)!; return <article className="promax-dispatch-row" key={member.memberId}><span className="promax-dispatch-member">{memberDisplayName(definition.memberId, definition.displayName)}</span><span>{memberDisplayText(member.reason, team)}</span></article> })}</div></details>
        {error === null && resolution.error === undefined ? null : <div className="promax-team-page-error" role="alert">{error ?? `新计划未采用：${resolution.error}`}</div>}
        <p className="promax-dispatch-footnote">{goalLabel}或手动选人之前，不会启动任何员工{hasAttachments ? '，也不会重复上传文档。' : '。'}</p>
      </section>
    </div>
  }

  return <div className="promax-dispatch-page">
    <section className="promax-dispatch-card" aria-labelledby="promax-dispatch-heading">
      <div className="promax-room-intro"><span className="promax-room-sequence" aria-hidden="true">02</span><div><span className="promax-eyebrow">PROMAX</span><h1 id="promax-dispatch-heading">这次打算怎么干</h1><DispatchAssessment>{memberDisplayText(plan.assessment, team)}</DispatchAssessment></div></div>
      <div className="promax-dispatch-actions">
        {autoStart ? <span className="meta-chip" role="status" aria-atomic="true">{remainingSeconds} 秒后自动开始</span> : remainingSeconds === null && !busy && !confirmed ? <span className="meta-chip" role="status">自动开始已取消，等待你确认</span> : null}
        <button ref={editTriggerRef} className="promax-button" type="button" aria-expanded={editing} disabled={busy || planning || confirmed} onClick={() => { cancelCountdown(); setEditing(true) }}>我要改</button>
        <button className="promax-button promax-button--primary" type="button" disabled={busy || planning || calledBusiness.length === 0 || confirmed} onClick={() => { execute(called.map(member => member.memberId)) }}>{busy && !confirmed ? '正在开始…' : '立即开始'}</button>
        <button className="promax-button" type="button" disabled={busy || planning || confirmed} onClick={() => { execute(allMemberIds) }}>全部都叫</button>
        {confirmed && error !== null ? <button className="promax-button promax-button--primary" type="button" disabled={busy} onClick={() => { execute(binding.confirmedMemberIds ?? selectedMemberIds) }}>{busy ? '正在重试…' : '按锁定名单重试'}</button> : null}
      </div>
      {planning ? <DispatchPlanningProgress reparsing /> : null}
      <div className="promax-dispatch-section"><h2>打算叫 {called.length} 个人</h2><div className="promax-dispatch-list">{called.map(member => { const definition = team.members.find(item => item.memberId === member.memberId)!; return <article className="promax-dispatch-row is-called" key={member.memberId}><span className="promax-dispatch-member">{memberDisplayName(definition.memberId, definition.displayName)}</span><span>{memberDisplayText(member.reason, team)}</span><span className="promax-dispatch-files" aria-label="计划产物">→ {memberDeliverables(plan, member.memberId)}</span></article> })}</div></div>
      <div className="promax-dispatch-section"><h2>不叫</h2><div className="promax-dispatch-list">{skipped.map(member => { const definition = team.members.find(item => item.memberId === member.memberId)!; return <article className="promax-dispatch-row" key={member.memberId}><span className="promax-dispatch-member">{memberDisplayName(definition.memberId, definition.displayName)}</span><span>{memberDisplayText(member.reason, team)}</span></article> })}</div></div>
      <DispatchInputSummary binding={binding} planning={planning} />
      {editing ? <DispatchMemberDialog plan={plan} team={team} selectedMemberIds={selectedMemberIds} busy={busy || confirmed} returnFocusRef={editTriggerRef} onToggle={(memberId, selected) => { if (memberId !== 'quality_judge') setSelectedMemberIds(current => selected ? [...current, memberId] : current.filter(id => id !== memberId)) }} onClose={() => { setEditing(false) }} onExecute={() => { setEditing(false); execute(selectedMemberIds) }} /> : null}
      {confirmed ? <div className="promax-dispatch-confirmed" role="status">名单已锁定：{selectedMemberIds.map(memberId => memberDisplayName(memberId, team.members.find(member => member.memberId === memberId)?.displayName)).join('、')}。{error === null ? '正在发送执行请求…' : '执行请求尚未发出，可按原名单重试。'}</div> : null}
      {error === null && resolution.error === undefined ? null : <div className="promax-team-page-error" role="alert">{error ?? `新计划未采用：${resolution.error}`}</div>}
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
  collapsed?: boolean
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
  const [recycleOpen, setRecycleOpen] = useState(false)
  useEffect(() => {
    const open = (): void => { setPreferencesOpen(true) }
    window.addEventListener('promax:open-preferences', open)
    return () => { window.removeEventListener('promax:open-preferences', open) }
  }, [])
  return <div className="left-sidebar" id="promax-navigation-panel">
    {props.collapsed ? <div className="promax-collapsed-navigation"><PromaxLogo className="brand-mark" /><button className="promax-workbench-icon-button" type="button" aria-label="展开 Promax 导航" aria-expanded="false" onClick={props.layout.toggleSidebar}><Icon name="panelRight" size={18} /></button></div> : null}
    <div className="brand-row">
      <PromaxLogo className="brand-mark" />
      <div className="brand-name">Promax</div>
      <button className="promax-workbench-icon-button collapse-button" type="button" aria-label="收起 Promax 导航" aria-controls="promax-navigation-panel" aria-expanded="true" title="收起导航" onClick={props.layout.toggleSidebar}><Icon name="panelRight" size={18} /></button>
    </div>
    <div className="left-scroll"><PromaxSessionBrowser {...props} wide /></div>
    <footer className="sidebar-footer">
      <button className="footer-item" type="button" onClick={() => { setRecycleOpen(true) }}><Icon name="folder" size={15} />回收站</button>
      <ConsoleLauncher {...(props.apiBaseUrl === undefined ? {} : { apiBaseUrl: props.apiBaseUrl })} />
      <button className="footer-item" type="button" onClick={() => { setPreferencesOpen(true) }}><Icon name="settings" size={15} />设置</button>
    </footer>
    {recycleOpen ? <RecycleBinDialog recycleBin={props.recycleBin} onClose={() => { setRecycleOpen(false) }} /> : null}
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
    return () => { if (composerHostSnapshot === snapshot) publishComposerHost(null) }
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
    <div className="promax-composer-caption">{taskExecutionLocked ? '任务已结束，可新建需求继续工作' : 'Enter 发送 · Shift + Enter 换行'}</div>
    {host?.view === 'trace' && props.footer !== undefined ? <details className="promax-run-statistics"><summary>运行统计</summary><div>{props.footer}</div></details> : null}
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

function TeamStatusContent({ team, progress, projection, files, statusMessage }: { team: PromaxTeam; progress: TeamProgressView; projection?: TaskRunProjection; files?: TaskRunFileSnapshot; statusMessage?: string }) {
  const availability = taskAvailabilityOf(projection, statusMessage)
  const known = projection !== undefined && statusMessage === undefined
  const members = team.members.filter(member => progress.memberStates?.[member.memberId] !== undefined)
  const generated = progress.artifacts.filter(row => row.generation === 'done').length
  return <>
    <section className="right-section"><h2 className="sidebar-section-title">任务状态</h2><div className={`promax-detail-status team-availability--${availability.tone}`} role="status" aria-atomic="true"><span className="status-dot" />{availability.label}</div><p className="promax-detail-copy">{!known ? '正在获取最新结果，审核结论尚未确认。' : projection.phase === 'completed' ? '业务文件与独立审核结果已就绪。' : '查看当前成员分工与交付检查。'}</p>
      <dl className="promax-detail-facts"><dt>业务产物</dt><dd>{known ? `${generated} / ${progress.artifacts.length} 已生成` : '—'}</dd><dt>独立审核</dt><dd>{known ? progressLabel(progress.delivery, 'judgment') : '待同步'}</dd><dt>最后同步</dt><dd>{files === undefined ? '—' : `${minuteLabel(files.observedAt)}${statusMessage === undefined ? '' : ' · 上次'}`}</dd></dl>
    </section>
    <section className="right-section"><h2 className="sidebar-section-title">执行信息</h2><dl className="promax-detail-facts"><dt>协调者</dt><dd>团队协调员</dd><dt>业务成员</dt><dd>{members.filter(member => !isJudgeMember(member)).map(member => memberDisplayName(member.memberId, member.displayName)).join('、') || '待同步'}</dd><dt>审核成员</dt><dd>{members.some(isJudgeMember) ? '质量审核' : '待同步'}</dd><dt>创建时间</dt><dd>{files === undefined ? '—' : minuteLabel(files.createdAt)}</dd></dl></section>
    <section className="right-section"><h2 className="sidebar-section-title">交付检查</h2><div className="promax-delivery-checks"><span><Icon name={known && generated > 0 && generated === progress.artifacts.length ? 'check' : 'more'} size={15} />业务文件{known ? `${generated} / ${progress.artifacts.length}` : '待同步'}</span><span><Icon name={known && progress.delivery === 'done' ? 'check' : 'shield'} size={15} />{known ? progressLabel(progress.delivery, 'judgment') : '独立审核待同步'}</span><span><Icon name={known && projection.phase === 'completed' ? 'check' : 'more'} size={15} />{known && projection.phase === 'completed' ? '最终交付已确认' : '最终交付待确认'}</span></div></section>
    {progress.repair === undefined ? null : <div className="team-note" role="status">第 {progress.repair.round}/{progress.repair.maxRounds} 轮{progress.repair.state === 'exhausted' ? '返修已用尽' : '返修'}{progress.repair.reasons.length === 0 ? null : <p>{progress.repair.reasons.join('；')}</p>}</div>}
  </>
}

export function PromaxDetailsSidebar(props: PromaxShellRuntimeProps & { sessionId?: string }) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const sessionState = props.useSessions(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const productTeam = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const productWorkspaces = productTeam === undefined ? [] : workspacesForTeam(productTeam, workspaceState.items)
  const currentProject = selectedProject(teamState, productWorkspaces)
  const history = useTaskHistory(currentProject === undefined ? [] : [currentProject], props.readTaskHistory)
  const selectedSessionId = teamState.selected.kind === 'team' && teamState.selected.view === 'session' ? teamState.selected.sessionId : undefined
  const sessionId = teamState.selected.kind === 'team' && teamState.selected.view === 'home' ? undefined : selectedSessionId ?? props.sessionId ?? sessionState.current
  const team = sessionId === undefined ? undefined : teamForSession(teamState, sessionId)
  const binding = sessionId === undefined ? undefined : bindingForSession(teamState, sessionId)
  const taskPath = binding?.taskKey === undefined ? history.items.find(item => item.sessionId === sessionId)?.deliverablePath : `deliverables/${binding.taskKey}`
  const workspace = team === undefined || sessionId === undefined ? undefined : workspaceForTeamSession(team, teamState, workspaceState.items, sessionId)
  const [files, setFiles] = useState<TaskRunFileSnapshot | undefined>(undefined)
  const [readError, setReadError] = useState<string | undefined>(undefined)
  const [readScope, setReadScope] = useState<string | undefined>(undefined)
  const [readAttempt, setReadAttempt] = useState(0)
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
  }, [binding?.dispatchState, binding?.sessionId, binding?.taskKey, currentReadScope, props.readTaskRunFiles, workspace?.path, workspace?.workspaceId, readAttempt])
  const projectionResult = useMemo<{ projection?: TaskRunProjection; error?: string }>(() => {
    if (team === undefined || binding === undefined || currentFiles === undefined) return {}
    try { return { projection: taskRunProjectionOf({ team, binding, files: currentFiles }) } } catch (reason) { return { error: reason instanceof Error ? reason.message : String(reason) } }
  }, [binding, currentFiles, team])
  if (props.collapsed) return <div className="promax-collapsed-details"><button className="promax-workbench-icon-button" type="button" aria-label="展开状态栏" aria-expanded="false" onClick={props.layout.openDetails}><Icon name="panelRight" size={17} /></button><span>任务详情</span></div>
  if (team === undefined) return <div className="right-sidebar" id="promax-status-panel"><div className="right-header"><div><div className="right-title">最近产出</div></div><button className="promax-workbench-icon-button" type="button" aria-label="收起状态栏" aria-controls="promax-status-panel" aria-expanded="true" title="收起状态栏" onClick={props.layout.closeDetails}><Icon name="panelRight" size={17} /></button></div><div className="right-scroll">{history.error === undefined ? history.loading && history.items.length === 0 ? <div className="team-note" role="status">正在读取磁盘记录…</div> : <RecentOutputContent {...history.items[0] === undefined ? {} : { item: history.items[0] }} /> : <div className="team-note" role="alert">磁盘记录读取失败：{history.error}</div>}</div></div>
  const statusMessage = currentReadError ?? projectionResult.error
  if (binding?.dispatchState === 'planning') return <div className="right-sidebar" id="promax-status-panel"><div className="right-header"><div><div className="right-title">任务详情</div></div><button className="promax-workbench-icon-button" type="button" aria-label="收起状态栏" aria-controls="promax-status-panel" aria-expanded="true" title="收起状态栏" onClick={props.layout.closeDetails}><Icon name="panelRight" size={17} /></button></div><TaskOutputsSummary workspace={workspace} taskPath={taskPath} binding={binding} files={undefined} error={undefined} onRetry={() => { setReadAttempt(value => value + 1) }} /><div className="right-scroll"><div className="team-note">等待确认调度名单；业务执行尚未开始。</div></div></div>
  const progress = teamProgressOf(team, projectionResult.projection, binding?.confirmedMemberIds)
  return <div className="right-sidebar" id="promax-status-panel"><div className="right-header"><div><div className="right-title">任务详情</div></div><button className="promax-workbench-icon-button" type="button" aria-label="收起状态栏" aria-controls="promax-status-panel" aria-expanded="true" title="收起状态栏" onClick={props.layout.closeDetails}><Icon name="panelRight" size={17} /></button></div><TaskOutputsSummary workspace={workspace} taskPath={taskPath} binding={binding} files={currentFiles} error={currentReadError} onRetry={() => { setReadAttempt(value => value + 1) }} /><div className="right-scroll">{statusMessage === undefined ? projectionResult.projection === undefined ? <div className="team-note" role="status">正在同步文件与审核状态…</div> : null : <TaskProjectionNotice message={statusMessage} compact />}<TeamStatusContent team={team} progress={progress} {...projectionResult.projection === undefined ? {} : { projection: projectionResult.projection }} {...currentFiles === undefined ? {} : { files: currentFiles }} {...statusMessage === undefined ? {} : { statusMessage }} /></div></div>
}

function TaskOutputsSummary({ workspace, taskPath, binding, files, error, onRetry }: {
  workspace: WorkspaceView | undefined
  taskPath: string | undefined
  binding: TeamSessionBinding | undefined
  files: TaskRunFileSnapshot | undefined
  error: string | undefined
  onRetry(): void
}) {
  const ready = workspace !== undefined && taskReadyBinding(binding)
  return <section className="promax-output-summary" aria-label="本次产物">
    <header><h2>本次产物</h2><span>{files === undefined ? '—' : `${files.deliverableFiles.length} 个`}</span></header>
    <div className="promax-output-summary-list">
      {error !== undefined ? <div className="promax-output-empty" role="alert">产物读取失败<button className="promax-file-link" type="button" onClick={onRetry}>重试</button></div>
        : files === undefined ? <div className="promax-output-empty" role="status">{binding?.dispatchState === 'planning' ? '确认计划并执行后，产物会显示在这里。' : ready ? '正在读取产物…' : '尚未生成产物'}</div>
          : files.deliverableFiles.length === 0 ? <div className="promax-output-empty">尚未生成产物</div>
            : files.deliverableFiles.map(file => <button className="promax-output-shortcut" aria-label={`查看产物 ${file.relativePath}`} key={file.path} type="button" title={file.relativePath} onClick={() => { showTaskOutputs(files.parentSessionId, file.relativePath) }}><Icon name="artifact" size={17} /><span>{file.relativePath}</span><small>查看 ›</small></button>)}
    </div>
    <footer><button type="button" className="toolbar-button" disabled={workspace === undefined} onClick={() => { if (workspace !== undefined) selectProjectFiles(workspace.workspaceId, taskPath ?? '') }}><Icon name="folder" size={15} />{taskPath === undefined ? '查看项目文件' : '在项目中定位'}</button></footer>
  </section>
}

function EmptyWorkspace({ title, copy }: { title: string; copy: string }) {
  return <div className="promax-workbench-empty"><Icon name="artifact" size={24} /><h1>{title}</h1><p>{copy}</p></div>
}

function WorkspaceTitle({ project, title }: { project: string; title: string }) {
  return <details className="topbar-title-wrap"><summary><span className="topbar-project">{project}</span><span className="topbar-divider">/</span><span className="topbar-title">{title}</span></summary><div className="promax-full-title"><strong>{title}</strong><span>{project}</span></div></details>
}

function TaskProjectionNotice({ message, compact = false }: { message: string; compact?: boolean }) {
  const transportFailure = isTaskReadTransportError(message)
  return <section className={`promax-task-status-notice${compact ? ' promax-task-status-notice--compact' : ''}`} role="alert" aria-live="assertive">
      <span className="promax-task-status-icon" aria-hidden="true">!</span>
      <div><h2>{transportFailure ? '状态刷新暂时失败' : '任务文件校验未通过'}</h2>
      <p>{transportFailure
        ? '当前无法连接本机 Promax 服务。磁盘文件不会因此被删除；服务恢复后页面会自动重新读取。'
        : '当前任务记录尚未通过校验。保留上次同步内容，服务恢复后会自动重试。'}</p>
      <details className="promax-task-status-detail"><summary>查看详细原因</summary>{message}</details></div>
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

function DiskFileList({ files, judge, onPreview }: { files: TaskRunFileSnapshot['deliverableFiles']; judge: TaskRunFileSnapshot['judge']; onPreview?: (relativePath: string) => void }) {
  const judgeDisplay = judgeDisplayOf(judge.state)
  return <>
    <div className="promax-result-files" aria-label="磁盘业务产物">
      {files.length === 0 ? <div className="promax-result-empty">产出目录里还没有业务文件。</div> : files.map(file => <article className="promax-result-file" key={file.path}>
        <span className="promax-result-file-icon"><Icon name="artifact" size={19} /></span>
        <span className="promax-result-file-copy">{onPreview === undefined ? <strong>{file.relativePath}</strong> : <button type="button" className="promax-file-link" aria-label={`查看产物 ${file.relativePath}`} title={file.relativePath} onClick={() => { onPreview(file.relativePath) }}><strong>{file.relativePath}</strong><span>查看 ›</span></button>}<small>{fileSizeLabel(file.bytes)}</small></span>
        <span className={`promax-result-judge promax-result-judge--${judgeDisplay.tone}`}>{judgeDisplay.label}</span>
      </article>)}
    </div>
    {judgeDisplay.tone !== 'fail' ? null : <div className="promax-judge-reason" role="alert"><strong>Judge 原因</strong><p>{judge.reason ?? 'Judge 报告没有给出可识别的失败原因。'}</p></div>}
  </>
}

function RecentOutputContent({ item }: { item?: TaskHistoryView }) {
  if (item === undefined) return <div className="promax-recent-empty"><Icon name="folder" size={22} /><strong>还没有历史产出</strong><p>任务完成并写入磁盘后，最近一次产出会显示在这里。</p></div>
  return <section className="promax-recent-output" aria-labelledby="promax-recent-output-title">
    <div className="promax-recent-output-heading"><span>最近一次的产出</span><h2 id="promax-recent-output-title">{item.taskKey}</h2><time dateTime={item.createdAt}>{minuteLabel(item.createdAt)}</time></div>
    <DiskFileList files={item.deliverableFiles} judge={item.judge} />
    <button className="toolbar-button" type="button" onClick={() => { selectProjectFiles(item.workspaceId, item.deliverablePath) }}><Icon name="folder" size={15} />在项目中定位</button>
  </section>
}

function WorkbenchContent({ team, progress, availability, files, statusMessage, syncing = false, onShowFiles }: { team: PromaxTeam; progress: TeamProgressView; availability: TeamAvailabilityView; files?: TaskRunFileSnapshot; statusMessage?: string; syncing?: boolean; onShowFiles(): void }) {
  const summary = deliverableSummary(progress.artifacts)
  const known = files !== undefined && !syncing && statusMessage === undefined
  const memberViews = team.members.filter(member => member.enabled && progress.memberStates?.[member.memberId] !== undefined).map(member => ({ member, state: memberExecutionStateOf(member, progress) }))
  const allGenerated = progress.artifacts.length > 0 && progress.artifacts.every(row => row.generation === 'done')
  const finished = known && availability.label === '任务完成'
  const description = statusMessage !== undefined ? '最新状态暂时无法确认，恢复后会自动同步。'
    : !known ? '正在同步文件与审核结果。读取完成后会在这里更新。'
    : finished ? '业务产物与独立审核已完成，可以查看交付文件。'
      : progress.delivery === 'blocked' ? '审核尚未通过，请查看审核原因与后续处理状态。'
        : allGenerated ? '业务文件已生成，正在等待独立审核结论。' : '团队正在按本次分工完成业务产物。'
  return <div className="workspace-content">
    <div className="workspace-head"><div><div className="workspace-kicker">执行概览</div><h1 className="workspace-title">{availability.label}</h1><p className="workspace-description">{description}</p></div></div>
    {statusMessage === undefined ? null : <TaskProjectionNotice message={statusMessage} />}
    <ol className="promax-task-phases" aria-label="任务阶段">{[['理解需求', known && progress.understanding === 'done'], ['生成方案', known && allGenerated], ['独立审核', known && progress.delivery === 'done'], ['完成交付', finished]].map(([label, done], index) => <li key={String(label)} className={done ? 'is-done' : ''}><span>{done ? <Icon name="check" size={13} /> : index + 1}</span>{label}</li>)}</ol>
    <div className="section-bar"><h2 className="section-name">当前工作</h2><span className="section-meta">{memberViews.length === 0 ? '成员待同步' : `${memberViews.length} 位成员参与`}</span></div>
    <article className="task-card"><span className="coordinator-avatar"><Icon name={allGenerated ? 'shield' : 'team'} size={20} /></span><div className="task-work-copy"><div className="task-label">{allGenerated ? '质量审核 · 独立检查' : '团队协调员 · 任务调度'}</div><div className="task-goal">{finished ? '交付与审核均已完成' : known ? allGenerated ? '核对业务产物与需求要求' : '按本次分工生成交付文件' : '等待最新任务状态'}</div><p className="coordinator-copy">{description}</p></div></article>
    <div className="section-bar"><h2 className="section-name">成员分工</h2><span className="section-meta">按本次任务组织</span></div>
    <div className="agent-grid">{memberViews.map(({ member, state }) => <article className={`agent-card is-${known ? state : 'idle'}`} key={member.memberId}><div className="agent-card-top"><MemberAvatar className="agent-avatar" memberId={member.memberId} displayName={memberDisplayName(member.memberId, member.displayName)} /><div className="agent-name">{memberDisplayName(member.memberId, member.displayName)}</div></div><div className="agent-task">{member.objective}</div><div className="agent-footer"><span className="agent-state-dot" /><span>{!known ? '待同步' : state === 'done' ? '已完成' : state === 'blocked' ? '已阻断' : state === 'running' ? '运行中' : '待生成'}</span></div></article>)}</div>
    <div className="section-bar"><h2 className="section-name">本次交付</h2><span className="section-meta">{known ? `${summary.ready} / ${summary.involved} 就绪` : '数量待同步'}</span><button className="toolbar-button promax-section-action" type="button" onClick={onShowFiles}>查看全部<Icon name="chevronRight" size={14} /></button></div>
    <section className="deliverable-card" aria-label="业务产物"><div className="file-grid">{progress.artifacts.length === 0 ? <p className="promax-result-empty">{known ? '本次尚无业务文件。' : '正在读取交付文件…'}</p> : progress.artifacts.map(row => <article className="file-item" key={row.artifact.relativePath}><Icon name="artifact" size={20} /><span className="file-copy">{known && row.generation === 'done' && files.deliverableFiles.some(file => file.path === row.artifact.relativePath) ? <button type="button" className="file-name promax-file-link" onClick={() => { showTaskOutputs(files.parentSessionId, files.deliverableFiles.find(file => file.path === row.artifact.relativePath)!.relativePath) }}>{row.label}<span>查看 ›</span></button> : <span className="file-name">{row.label}</span>}<span className="file-meta">{known ? fileMeta(deliverableStateOf(row), row.judgment) : '上次同步结果 · 当前状态待确认'}</span></span></article>)}</div></section>
    {!known || files.judge.state === 'pass' || files.judge.state === 'absent' ? null : <div className="promax-judge-reason" role="alert"><strong>审核说明</strong><p>{files.judge.reason ?? '当前审核尚未通过。'}</p></div>}
  </div>
}

type WorkbenchTab = ComposerHostView

/** Frame-wide Promax chrome; it keeps dsh's conversation mounted under the task-trace tab. */
export function PromaxWorkspaceOverlay(props: PromaxShellRuntimeProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaceState = props.useWorkspaces(state => state)
  const sessionState = props.useSessions(state => state)
  const [activeTab, setTab] = useState<WorkbenchTab>('workbench')
  const [taskRunFiles, setTaskRunFiles] = useState<TaskRunFileSnapshot | undefined>(undefined)
  const [taskRunReadError, setTaskRunReadError] = useState<string | undefined>(undefined)
  const [taskRunReadScope, setTaskRunReadScope] = useState<string | undefined>(undefined)
  const readFailureStability = useRef<{ message?: string; consecutiveReads: number }>({ consecutiveReads: 0 })
  const snapshotStability = useRef<TaskRunSnapshotStability>({ consecutiveReads: 0 })
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedContext = teamState.selected
  const filePath = selectedContext.kind === 'team' ? selectedContext.filePath : undefined
  const fileRequest = selectedContext.kind === 'team' ? selectedContext.fileRequest ?? 0 : 0
  const tab = filePath === undefined ? activeTab : 'deliverables'
  const selectedSession = selectedContext.kind === 'team' && selectedContext.view === 'session'
  const productTeam = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const team = selectedSession ? teamState.teams.find(item => item.id === selectedContext.teamId) : productTeam
  const productWorkspaces = productTeam === undefined ? [] : workspacesForTeam(productTeam, workspaceState.items)
  const defaultWorkspace = selectedProject(teamState, productWorkspaces)
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
  const availability = taskBinding?.dispatchState === 'running'
    ? taskAvailabilityOf(projection, projectionError)
    : teamAvailabilityOf(snapshot, session, tree)

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
    const show = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId: string; relativePath?: string }>).detail
      if (detail?.sessionId !== sessionId || workspace === undefined || taskBinding?.taskKey === undefined) return
      selectProjectFiles(workspace.workspaceId, `deliverables/${taskBinding.taskKey}${detail.relativePath === undefined ? '' : `/${detail.relativePath}`}`)
      if (scrollRef.current !== null) scrollRef.current.scrollTop = 0
    }
    window.addEventListener('promax:show-outputs', show)
    return () => { window.removeEventListener('promax:show-outputs', show) }
  }, [sessionId, workspace, taskBinding?.taskKey])
  useEffect(() => {
    if (!selectedSession && sessionState.current !== undefined) props.clearSession()
    if (selectedSession && sessionId !== undefined && sessionState.phase === 'ready' && sessionState.current === undefined) props.openSession(sessionId)
  }, [props.clearSession, props.openSession, selectedSession, sessionId, sessionState.current, sessionState.phase])
  const activate = (next: WorkbenchTab): void => { closeProjectFiles(); setTab(next); if (scrollRef.current !== null) scrollRef.current.scrollTop = 0 }

  if (!selectedSession) {
    if (productTeam === undefined) return <EmptyWorkspace title="产品团队不可用" copy="没有找到产品智能体团队配置。" />
    if (filePath !== undefined && defaultWorkspace !== undefined) return <><section className="promax-workbench-layer" aria-label="项目文件工作区"><header className="topbar"><WorkspaceTitle project={defaultWorkspace.title} title="项目文件" /><button type="button" className="toolbar-button" onClick={() => { closeProjectFiles() }}>返回新需求</button></header><div className="main-scroll promax-project-files-scroll"><ProjectFiles key={`${defaultWorkspace.workspaceId}:${fileRequest}`} workspaceId={defaultWorkspace.workspaceId} title={defaultWorkspace.title} targetPath={filePath} {...props} /></div></section><aside className="promax-home-details" aria-label="最近产出"><PromaxDetailsSidebar {...props} collapsed={props.detailsOpen === false} /></aside></>
    return <><TeamHome
      key={defaultWorkspace?.workspaceId}
      team={productTeam}
      workspace={defaultWorkspace}
      startSession={props.startSession}
      sendSessionMessage={props.sendSessionMessage}
      openSession={props.openSession}
      renameSession={props.renameSession}
      saveTaskAttachments={props.saveTaskAttachments}
      beginDispatchPlan={props.beginDispatchPlan}
    /><aside className="promax-home-details" aria-label="最近产出"><PromaxDetailsSidebar {...props} collapsed={props.detailsOpen === false} /></aside></>
  }

  if (team === undefined || progress === undefined) {
    return <EmptyWorkspace title="需求记录不可用" copy="没有找到这个需求记录对应的团队配置。" />
  }

  const dispatchReview = dispatchReviewBinding(taskBinding) && taskBinding.dispatchState !== 'running'
  return <>
    <section className={`promax-workbench-layer${tab === 'trace' ? ' promax-workbench-layer--trace' : ''}`} aria-label="产品智能体团队工作区">
      <header className="topbar"><WorkspaceTitle project={viewingDescendant ? '子 Agent 上下文' : workspace?.title ?? '当前项目'} title={visibleSession?.displayTitle ?? '需求'} /><div className="topbar-actions"><button className="toolbar-button" type="button" onClick={() => { window.dispatchEvent(new Event('promax:open-preferences')) }}><Icon name="settings" size={15} /><span className="button-label">团队设置</span></button></div></header>
      <div className="view-tabs" role="tablist" aria-label="产品智能体团队视图">{([['workbench', 'grid', '工作台'], ['trace', 'activity', '任务轨迹'], ['deliverables', 'folder', '项目文件']] as const).filter(([id]) => !dispatchReview || id !== 'trace').map(([id, icon, label]) => <button className="view-tab" type="button" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} key={id} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const buttons = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')); const index = buttons.indexOf(event.currentTarget); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus(); buttons[next]?.click() }} onClick={() => { activate(id) }}><Icon name={icon} size={15} />{label}</button>)}</div>
      <div ref={scrollRef} className={`main-scroll${tab === 'deliverables' ? ' promax-project-files-scroll' : ''}`}>
        {tab === 'deliverables' && workspace !== undefined
          ? <ProjectFiles key={`${workspace.workspaceId}:${fileRequest}`} workspaceId={workspace.workspaceId} title={workspace.title} targetPath={filePath ?? ''} {...taskBinding?.taskKey === undefined ? {} : { currentTaskPath: `deliverables/${taskBinding.taskKey}` }} {...props} />
          : dispatchReview
          ? workspace === undefined
            ? <EmptyWorkspace title="工作目录不可用" copy="没有找到这个需求记录对应的工作目录。" />
            : <DispatchPlanReview key={taskBinding.sessionId} binding={taskBinding} team={team} workspace={workspace} snapshot={snapshot} confirmDispatchPlan={props.confirmDispatchPlan} sendSessionMessage={props.sendSessionMessage} />
          : workspace === undefined
            ? <EmptyWorkspace title="工作目录不可用" copy="没有找到这个需求记录对应的工作目录。" />
            : tab === 'trace'
              ? null
            : tab === 'workbench'
              ? <WorkbenchContent team={team} progress={progress} availability={availability} {...currentTaskRunFiles === undefined ? {} : { files: currentTaskRunFiles }} {...projectionError === undefined ? {} : { statusMessage: projectionError }} syncing={taskBinding?.dispatchState === 'running' && projection === undefined && projectionError === undefined} onShowFiles={() => { selectProjectFiles(workspace.workspaceId, taskBinding?.taskKey === undefined ? '' : `deliverables/${taskBinding.taskKey}`) }} />
              : null}
      </div>
      {workspace === undefined || dispatchReview || tab === 'deliverables' ? null : <PromaxComposerHost view={tab} />}
    </section>
  </>
}
