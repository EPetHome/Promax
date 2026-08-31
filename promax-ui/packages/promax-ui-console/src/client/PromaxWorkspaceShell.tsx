import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '../components/icons.tsx'
import { installPromaxConsoleStyles } from '../styles.ts'
import { ConsoleLauncher } from './ConsoleLauncher.tsx'
import {
  draftSessionView,
  draftUserTurnCount,
  enableDraftTracking,
  handoffMarkdown,
  latestDraftSessionId,
  markDraftNoticeSeen,
  observeDraftConversation,
  readDraftState,
  setDraftTrackingEnabled,
  startDraftSession,
  transcriptMarkdown,
  useDraftState,
  type DraftSectionId,
} from './draft-state.ts'
import { routedTeamPrompt } from './team-api.ts'
import {
  GENERAL_PRESET_ID,
  PRODUCT_TEAM_ID,
  attachWorkspace,
  bindTeamSession,
  bindingForSession,
  revisionLabel,
  sessionScopeNameFromPrompt,
  selectGeneralWorkspace,
  selectTeamHome,
  selectTeamSession,
  teamForSession,
  useTeamState,
  type PromaxTeam,
  type PromaxTeamState,
  type TeamArtifactDefinition,
  type TeamMember,
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
  openSession: (sessionId: string) => void
  clearSession: () => void
  archiveSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  prepareSessionScope: (input: { workspaceId: string; projectPath: string; sessionId: string; sessionName: string }) => Promise<{ sessionName: string; taskKey: string; relativePath: string }>
  createProjectWorkspace: (input: { projectName: string; parentPath?: string }) => Promise<WorkspaceView>
  pickProjectDirectory: () => Promise<string | null>
  writeDraftHandoff: (input: {
    workspaceId: string
    projectPath: string
    handoff: string
    transcript: string
  }) => Promise<{ handoffPath: string; transcriptPath: string }>
  openWorkspacePath: (path: string) => Promise<void>
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
  return workspaces.find(workspace => workspace.title === '草稿' || workspace.title === '通用工作区' || isPathLeaf(workspace.path, 'general'))
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

function sessionsForProject(
  team: PromaxTeam,
  workspace: WorkspaceView,
  state: PromaxTeamState,
  sessions: SessionListState,
  archived: readonly string[],
): SessionSummary[] {
  const bound = state.sessionBindings
    .filter(binding => binding.teamId === team.id && binding.workspaceId === workspace.workspaceId)
    .map(binding => binding.sessionId)
  return rowsFromIds([...workspace.sessionIds, ...bound], sessions, archived)
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
  )
}

export function contextRows(
  state: PromaxTeamState,
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState,
  archived: readonly string[],
): ContextRows {
  if (state.selected.kind === 'general') {
    const workspace = generalWorkspaceOf(workspaces)
    const bound = new Set(state.sessionBindings.map(binding => binding.sessionId))
    return {
      title: '草稿',
      rows: rowsFromIds(workspace?.sessionIds.filter(id => !bound.has(id)) ?? [], sessions, archived),
      ...(workspace === undefined ? {} : { workspace }),
    }
  }
  const selected = state.selected
  const team = state.teams.find(candidate => candidate.id === selected.teamId)
  if (team === undefined) return { title: '项目会话', rows: [] }
  const projects = workspacesForTeam(team, workspaces)
  const workspace = projects.find(project => project.workspaceId === selected.workspaceId) ?? projects[0]
  return {
    title: workspace?.title ?? '项目',
    rows: workspace === undefined ? [] : sessionsForProject(team, workspace, state, sessions, archived),
    team,
    ...(workspace === undefined ? {} : { workspace }),
  }
}

function revisionForSession(state: PromaxTeamState, team: PromaxTeam, session: SessionSummary): TeamRevisionNumber | undefined {
  const binding = bindingForSession(state, session.id)
  if (binding?.teamId === team.id) return binding.revision
  const revision = team.activeRevision
  return revision !== undefined && session.agentPreset === revision.presetId ? revision.revision : undefined
}

export function EmptyHeroSeat() {
  return null
}

function SessionRow({
  session,
  current,
  revision,
  blankLabel = '新草稿',
  onOpen,
  onRequestDelete,
}: {
  session: SessionSummary
  current: boolean
  revision?: TeamRevisionNumber
  blankLabel?: string
  onOpen: () => void
  onRequestDelete: (session: SessionSummary) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const menuItemRef = useRef<HTMLButtonElement>(null)
  const actionsRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const title = session.blank ? blankLabel : session.displayTitle

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
          {revision === undefined ? null : <small>{revisionLabel(revision)}</small>}
        </span>
        <span
          className={`promax-session-indicator${session.running ? ' promax-session-indicator--running' : ''}${session.completed ? ' promax-session-indicator--done' : ''}`}
          aria-label={session.running ? '执行中' : session.completed ? '已完成' : '空闲'}
        />
      </button>
      <button ref={actionsRef} type="button" className="promax-session-actions" aria-label={`会话操作：${title}`} aria-haspopup="menu" aria-controls={menuId} aria-expanded={menuOpen} onClick={() => { setMenuOpen(value => !value) }}><Icon name="more" size={16} /></button>
      {menuOpen ? <div id={menuId} className="promax-session-menu" role="menu" aria-label={`${title}会话操作`}>
        <button ref={menuItemRef} type="button" className="promax-session-menu-delete" role="menuitem" onClick={() => { setMenuOpen(false); onRequestDelete(session) }}>删除会话</button>
      </div> : null}
    </div>
  )
}

function SessionDeleteDialog({ session, busy, error, onCancel, onConfirm }: {
  session: SessionSummary
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const title = session.blank ? '新会话' : session.displayTitle
  useDialogKeyboard(true, onCancel, cancelRef)
  return createPortal(
    <div className="promax-team-create-backdrop">
      <section className="promax-team-create-dialog promax-session-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-delete-session-heading" aria-describedby="promax-delete-session-description">
        <header><div><span className="promax-eyebrow">会话操作</span><h2 id="promax-delete-session-heading">删除会话？</h2><p id="promax-delete-session-description">“{title}”将从列表中移除。会话记录仍保留在本机归档中，项目文件不会删除。</p></div><button type="button" className="promax-icon-button" aria-label="关闭删除会话确认" disabled={busy} onClick={onCancel}><Icon name="close" size={15} /></button></header>
        {error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}
        <footer><button ref={cancelRef} type="button" className="promax-button" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="promax-button promax-button--danger" disabled={busy} onClick={onConfirm}>{busy ? '正在删除…' : '删除会话'}</button></footer>
      </section>
    </div>,
    document.body,
  )
}

function useDialogKeyboard(open: boolean, onClose: () => void, focusRef: RefObject<HTMLElement | null>): void {
  const closeHandlerRef = useRef(onClose)
  useEffect(() => { closeHandlerRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!open) return
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
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
      returnFocus?.focus({ preventScroll: true })
    }
  }, [focusRef, open])
}

function FirstDraftNotice({ onContinue, onCancel }: { onContinue: () => void; onCancel: () => void }) {
  const continueRef = useRef<HTMLButtonElement>(null)
  useDialogKeyboard(true, onCancel, continueRef)
  return createPortal(
    <div className="promax-team-create-backdrop">
      <section className="promax-team-create-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-first-draft-heading">
        <header><div><span className="promax-eyebrow">草稿记录</span><h2 id="promax-first-draft-heading">Promax 会同步整理交底草稿</h2><p>默认开启。对话仍在草稿区进行；发送至少一条内容后，就能把整理结果和原始对话一起交给产品智能体团队。</p></div></header>
        <div className="promax-notice-card"><strong>会记录什么</strong><p>只记录当前草稿会话中的需求信息，不会把草稿自动发给团队。你可以在设置里随时关闭。</p></div>
        <footer><button type="button" className="promax-button" onClick={onCancel}>取消</button><button ref={continueRef} type="button" className="promax-button promax-button--primary" onClick={onContinue}>知道了，开始草稿</button></footer>
      </section>
    </div>,
    document.body,
  )
}

interface ProjectCreateDialogProps {
  busy: boolean
  onCancel: () => void
  onPickDirectory: () => Promise<string | null>
  onCreate: (input: { projectName: string; parentPath?: string }) => Promise<void>
}

function ProjectCreateDialog({ busy, onCancel, onPickDirectory, onCreate }: ProjectCreateDialogProps) {
  const [name, setName] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [parentPath, setParentPath] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useDialogKeyboard(true, onCancel, inputRef)

  const submit = (): void => {
    const projectName = name.trim()
    if (projectName === '') { setError('请填写项目名称'); return }
    setError(null)
    void onCreate({ projectName, ...(parentPath === undefined ? {} : { parentPath }) }).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return createPortal(
    <div className="promax-team-create-backdrop">
      <section className="promax-team-create-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-create-project-heading">
        <header><div><span className="promax-eyebrow">产品智能体团队 / 项目</span><h2 id="promax-create-project-heading">新建项目</h2><p>只需要一个名称，Promax 会创建标准目录。</p></div><button type="button" className="promax-icon-button" aria-label="关闭新建项目" disabled={busy} onClick={onCancel}><Icon name="close" size={15} /></button></header>
        <label className="promax-field"><span>项目名称</span><input ref={inputRef} className="promax-input" value={name} placeholder="例如：云盘" disabled={busy} onChange={event => { setName(event.currentTarget.value) }} /></label>
        <div className="promax-create-workspace-note"><Icon name="folder" size={16} /><span><strong>{parentPath === undefined ? `~/Promax/${name.trim() || '项目名称'}/` : `${parentPath}/${name.trim() || '项目名称'}/`}</strong><small>包含 输入/草稿、输入/源文件、产出 和 .promax 管理目录。</small></span></div>
        <button type="button" className="promax-link-button" aria-expanded={advanced} onClick={() => { setAdvanced(value => !value) }}>高级：自定义目录</button>
        {advanced ? <div className="promax-custom-path"><span>{parentPath ?? '尚未选择，仍使用默认目录'}</span><button type="button" className="promax-button" disabled={busy} onClick={() => { void onPickDirectory().then(path => { if (path !== null) setParentPath(path) }) }}>选择目录</button></div> : null}
        {error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}
        <footer><button type="button" className="promax-button" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="promax-button promax-button--primary" disabled={busy} onClick={submit}>{busy ? '正在创建…' : '创建项目'}</button></footer>
      </section>
    </div>,
    document.body,
  )
}

export function PromaxSessionBrowser({
  wide = true,
  expandSidebar,
  useWorkspaces,
  useSessions,
  startSession,
  openSession,
  clearSession,
  archiveSession,
  createProjectWorkspace,
  pickProjectDirectory,
}: SidebarProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const draftState = useDraftState()
  const workspaceState = useWorkspaces(state => state)
  const sessionState = useSessions(state => state)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [firstNoticeOpen, setFirstNoticeOpen] = useState(false)
  const [projectCreateOpen, setProjectCreateOpen] = useState(false)
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<ReadonlySet<string>>(() => new Set())
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null)
  const [deletingSession, setDeletingSession] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null)
  const team = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const general = generalWorkspaceOf(workspaceState.items)
  const draftRows = contextRows(
    { ...teamState, selected: { kind: 'general', ...(general === undefined ? {} : { workspaceId: general.workspaceId }) } },
    workspaceState.items,
    sessionState,
    workspaceState.archivedSessionIds,
  ).rows
  const projects = team === undefined ? [] : workspacesForTeam(team, workspaceState.items)

  useEffect(() => {
    if (deleteNotice === null) return
    const timeout = window.setTimeout(() => { setDeleteNotice(null) }, 2400)
    return () => { window.clearTimeout(timeout) }
  }, [deleteNotice])

  if (!wide) {
    return <button type="button" className="promax-context-rail-button" aria-label="展开 Promax 导航" title="Promax 导航" onClick={expandSidebar}><Icon name="team" size={19} /></button>
  }

  const startNewDraft = (): void => {
    if (general === undefined || busy) return
    setBusy(true)
    setError(null)
    void startSession(general.workspaceId, GENERAL_PRESET_ID).then(sessionId => {
      startDraftSession(sessionId)
      selectGeneralWorkspace(general.workspaceId)
      openSession(sessionId)
    }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
  }

  const requestNewDraft = (): void => {
    if (!draftState.informed) setFirstNoticeOpen(true)
    else startNewDraft()
  }

  const requestDeleteSession = (session: SessionSummary): void => {
    setDeleteError(null)
    setDeleteTarget(session)
  }

  const confirmDeleteSession = async (): Promise<void> => {
    if (deleteTarget === null || deletingSession) return
    const sessionId = deleteTarget.id
    const title = deleteTarget.blank ? '新会话' : deleteTarget.displayTitle
    setDeletingSession(true)
    setDeleteError(null)
    try {
      await archiveSession(sessionId)
      if (sessionState.current === sessionId) {
        const binding = bindingForSession(teamState, sessionId)
        if (binding !== undefined) selectTeamHome(binding.teamId, binding.workspaceId)
        else if (teamState.selected.kind === 'team' && teamState.selected.view === 'session' && teamState.selected.sessionId === sessionId) selectTeamHome(teamState.selected.teamId, teamState.selected.workspaceId)
        else selectGeneralWorkspace(general?.workspaceId)
        clearSession()
      }
      setDeleteTarget(null)
      setDeleteNotice(`已删除会话“${title}”`)
    } catch (reason: unknown) {
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDeletingSession(false)
    }
  }

  const toggleProject = (workspaceId: string): void => {
    setCollapsedProjectIds(current => {
      const next = new Set(current)
      if (next.has(workspaceId)) next.delete(workspaceId)
      else next.add(workspaceId)
      return next
    })
  }

  const startNewProjectSession = async (workspace: WorkspaceView): Promise<void> => {
    const revision = team?.activeRevision
    if (busy || team === undefined || revision === undefined) return
    setBusy(true)
    setError(null)
    try {
      const sessionId = await startSession(workspace.workspaceId, revision.presetId)
      bindTeamSession({
        sessionId,
        teamId: team.id,
        revision: revision.revision,
        presetId: revision.presetId,
        workspaceId: workspace.workspaceId,
      })
      setCollapsedProjectIds(current => {
        if (!current.has(workspace.workspaceId)) return current
        const next = new Set(current)
        next.delete(workspace.workspaceId)
        return next
      })
      openSession(sessionId)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const createProject = async (input: { projectName: string; parentPath?: string }): Promise<void> => {
    if (busy || team === undefined) return
    setBusy(true)
    setError(null)
    try {
      const workspace = await createProjectWorkspace(input)
      attachWorkspace(team.id, workspace.workspaceId)
      setCollapsedProjectIds(current => {
        if (!current.has(workspace.workspaceId)) return current
        const next = new Set(current)
        next.delete(workspace.workspaceId)
        return next
      })
      clearSession()
      setProjectCreateOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <nav className="promax-session-browser" aria-label="Promax 工作入口">
      <button type="button" className="promax-new-session" disabled={general === undefined || busy} onClick={requestNewDraft}><Icon name="plus" size={15} />新建草稿</button>
      <section className="promax-nav-section" aria-labelledby="promax-draft-list-heading">
        <h2 id="promax-draft-list-heading">草稿</h2>
        <div className="promax-session-list">
          {draftRows.length === 0 ? <div className="promax-session-empty">还没有草稿</div> : draftRows.map(session => <SessionRow key={session.id} session={session} current={sessionState.current === session.id} onOpen={() => { selectGeneralWorkspace(general?.workspaceId); openSession(session.id) }} onRequestDelete={requestDeleteSession} />)}
        </div>
      </section>
      <div className="promax-nav-divider" />
      {team === undefined ? null : <section className="promax-nav-section" aria-labelledby="promax-team-heading">
        <div className="promax-team-root-row">
          <button type="button" className="promax-team-root" aria-current={teamState.selected.kind === 'team' ? 'page' : undefined} onClick={() => { selectTeamHome(team.id); clearSession() }}>
            <span className="promax-team-nav-monogram" aria-hidden="true">产</span><span><strong id="promax-team-heading">产品智能体团队</strong><small>配好的固定团队</small></span>
          </button>
          <button type="button" className="promax-project-create" aria-label="新建项目" title="新建项目" onClick={() => { setProjectCreateOpen(true) }}><Icon name="plus" size={14} /></button>
        </div>
        <div className="promax-project-tree">
          <div className="promax-project-tree-header">
            <h3>项目</h3>
          </div>
          {projects.length === 0 ? <div className="promax-session-empty">还没有项目</div> : projects.map(project => {
            const rows = sessionsForProject(team, project, teamState, sessionState, workspaceState.archivedSessionIds)
            const collapsed = collapsedProjectIds.has(project.workspaceId)
            const headingId = `promax-project-heading-${project.workspaceId}`
            const sessionsId = `promax-project-sessions-${project.workspaceId}`
            return <section key={project.workspaceId} className="promax-project-node" aria-labelledby={headingId}>
              <div className="promax-project-header">
                <h4 id={headingId} className="promax-project-heading"><button type="button" className="promax-project-row" aria-controls={sessionsId} aria-expanded={!collapsed} onClick={() => { toggleProject(project.workspaceId) }}><span className="promax-project-chevron" aria-hidden="true"><Icon name="chevronRight" size={13} /></span><Icon name="folder" size={14} /><span className="promax-project-title">{project.title}</span></button></h4>
                <button type="button" className="promax-project-new-session" aria-label={`在 ${project.title} 中新建会话`} title="新建会话" disabled={busy || team.activeRevision === undefined} onClick={() => { void startNewProjectSession(project) }}><Icon name="plus" size={14} /></button>
              </div>
              {collapsed ? null : <div id={sessionsId} className="promax-project-sessions" role="group" aria-label={`${project.title}会话`}>
                {rows.length === 0 ? <div className="promax-project-session-empty">还没有会话</div> : rows.map(session => { const revision = revisionForSession(teamState, team, session); return <SessionRow key={session.id} session={session} current={sessionState.current === session.id} blankLabel="新会话" {...revision === undefined ? {} : { revision }} onOpen={() => { selectTeamSession(team.id, session.id, project.workspaceId); openSession(session.id) }} onRequestDelete={requestDeleteSession} /> })}
              </div>}
            </section>
          })}
        </div>
      </section>}
      {workspaceState.state === 'error' ? <div className="promax-session-error">工作区读取失败</div> : null}
      {error === null ? null : <div className="promax-session-error" role="alert">{error}</div>}
      {deleteNotice === null ? null : <div className="promax-session-success" role="status">{deleteNotice}</div>}
      {firstNoticeOpen ? <FirstDraftNotice onCancel={() => { setFirstNoticeOpen(false) }} onContinue={() => { markDraftNoticeSeen(); setFirstNoticeOpen(false); startNewDraft() }} /> : null}
      {projectCreateOpen ? <ProjectCreateDialog busy={busy} onCancel={() => { if (!busy) setProjectCreateOpen(false) }} onPickDirectory={pickProjectDirectory} onCreate={createProject} /> : null}
      {deleteTarget === null ? null : <SessionDeleteDialog session={deleteTarget} busy={deletingSession} error={deleteError} onCancel={() => { if (!deletingSession) setDeleteTarget(null) }} onConfirm={() => { void confirmDeleteSession() }} />}
    </nav>
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
const nativeTeamPromptListeners = new Set<() => void>()
let nativeTeamPromptVersion = 0

function subscribeNativeTeamPrompts(listener: () => void): () => void {
  nativeTeamPromptListeners.add(listener)
  return () => { nativeTeamPromptListeners.delete(listener) }
}

function nativeTeamPromptSnapshot(): number {
  return nativeTeamPromptVersion
}

export function sessionScopedTeamPrompt(text: string, targetMemberIds: readonly string[], sessionName: string, taskKey: string): string {
  const routed = routedTeamPrompt(text, targetMemberIds)
  if (routed === '') return ''
  const scope = JSON.stringify({ session_name: sessionName, task_key: taskKey, deliverables_root: `deliverables/${taskKey}/`, judge_path: `.promax/judge/${taskKey}/judge.md` })
  return `<!-- PROMAX_SESSION_SCOPE ${scope} -->\n${routed}`
}

export function draftHandoffTeamPrompt(
  handoff: string,
  files: { handoffPath: string; transcriptPath: string },
): string {
  return [
    '请接手这份草稿交底，并基于已保存的输入文件启动团队任务。',
    '先读取并核对以下两个文件；需求交底是整理后的工作输入，原始对话用于追溯，不得把两者当作既有业务结论。',
    `- 需求交底：${files.handoffPath}`,
    `- 原始对话：${files.transcriptPath}`,
    '',
    '## 本次交底',
    handoff.trim(),
  ].join('\n')
}

function stageNativeTeamPrompt(sessionId: string, text: string, targetMemberIds: readonly string[], scope?: { sessionName: string; taskKey: string }): void {
  const prompt = scope === undefined
    ? routedTeamPrompt(text, targetMemberIds)
    : sessionScopedTeamPrompt(text, targetMemberIds, scope.sessionName, scope.taskKey)
  if (prompt === '') return
  nativeTeamPromptHandoffs.set(sessionId, prompt)
  nativeTeamPromptVersion += 1
  for (const listener of nativeTeamPromptListeners) listener()
}

async function prepareBoundTeamSession(
  actions: Pick<WorkspaceShellActions, 'prepareSessionScope' | 'renameSession'>,
  team: PromaxTeam,
  workspace: WorkspaceView,
  sessionId: string,
  requestedName: string,
): Promise<{ sessionName: string; taskKey: string }> {
  const scope = await actions.prepareSessionScope({
    workspaceId: workspace.workspaceId,
    projectPath: workspace.path,
    sessionId,
    sessionName: requestedName,
  })
  await actions.renameSession(sessionId, scope.sessionName)
  const revision = team.activeRevision
  if (revision === undefined) throw new Error('团队 Revision 不可用')
  bindTeamSession({
    sessionId,
    teamId: team.id,
    revision: revision.revision,
    presetId: revision.presetId,
    workspaceId: workspace.workspaceId,
    sessionName: scope.sessionName,
    taskKey: scope.taskKey,
  })
  return scope
}

interface NativeConversationSnapshot {
  nodes: readonly unknown[]
  turnTimings: ReadonlyMap<number, { startTime: number; endTime?: number }>
  running: boolean
  runningCalls?: ReadonlyArray<{ name?: string }>
  pending?: readonly unknown[]
  queue?: readonly unknown[]
  removed?: boolean
  openState?: string
  lastAgentError?: string | null
}

type NativeSessionHook = <Selected>(selector: (state: NativeConversationSnapshot) => Selected) => Selected

type ProgressState = 'pending' | 'running' | 'done' | 'blocked' | 'unverified'

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

function textFromNodes(nodes: readonly unknown[]): string {
  const rows: string[] = []
  const seen = new WeakSet<object>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8) return
    if (typeof value === 'string') { rows.push(value); return }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return }
    if (typeof value !== 'object' || value === null || seen.has(value)) return
    seen.add(value)
    for (const item of Object.values(value as Record<string, unknown>)) visit(item, depth + 1)
  }
  visit(nodes, 0)
  return rows.join('\n')
}

function isJudgeMember(member: TeamMember): boolean {
  return member.memberId === 'quality_judge'
}

function businessArtifacts(team: PromaxTeam): TeamArtifactDefinition[] {
  const businessOwners = new Set(team.members.filter(member => !isJudgeMember(member)).map(member => member.memberId))
  return team.artifacts.filter(artifact => businessOwners.has(artifact.producedBy))
}

function artifactLabel(artifact: TeamArtifactDefinition): string {
  return artifact.relativePath.split('/').at(-1)?.replaceAll('{task_key}', '任务') ?? artifact.relativePath
}

function taskKeyFromEvidence(text: string): string | undefined {
  const matches = [...text.matchAll(/(?:deliverables|\.promax\/judge)\/([^/\\\s`|{}]+)\//gu)]
  return matches.at(-1)?.[1]
}

function artifactPathForTask(artifact: TeamArtifactDefinition, taskKey: string | undefined): string | undefined {
  if (!artifact.relativePath.includes('{task_key}')) return artifact.relativePath
  return taskKey === undefined ? undefined : artifact.relativePath.replaceAll('{task_key}', taskKey)
}

function isOptionalArtifact(path: string): boolean {
  return /(?:^|[/\\])(?:business-diagram\.md|prototype\.html)$/iu.test(path)
}

/** Conservative runtime projection: no check mark is emitted without matching session evidence. */
export function teamProgressOf(team: PromaxTeam, snapshot: NativeConversationSnapshot | undefined): TeamProgressView {
  const artifacts = businessArtifacts(team)
  if (snapshot === undefined || snapshot.nodes.length === 0) {
    return {
      understanding: 'pending', splitting: 'pending', delivery: 'pending', evidence: 'not-started',
      artifacts: artifacts.map(artifact => ({
        artifact,
        label: artifactLabel(artifact),
        involved: !isOptionalArtifact(artifact.relativePath),
        generation: 'pending',
        judgment: 'pending',
      })),
    }
  }
  const text = textFromNodes(snapshot.nodes)
  const assistantNodes = snapshot.nodes.filter(node => typeof node === 'object' && node !== null && (node as Record<string, unknown>).kind === 'assistant')
  const assistantText = textFromNodes(assistantNodes)
  const hasAssistant = assistantNodes.length > 0
  const businessRouted = team.members.some(member => !isJudgeMember(member) && text.includes(member.memberId))
  const judgeRouted = team.members.some(member => isJudgeMember(member) && text.includes(member.memberId))
  const taskKey = taskKeyFromEvidence(assistantText) ?? taskKeyFromEvidence(text)
  const judgePathMentioned = team.artifacts
    .filter(artifact => team.members.some(member => isJudgeMember(member) && member.memberId === artifact.producedBy))
    .map(artifact => artifactPathForTask(artifact, taskKey))
    .some(path => path !== undefined && assistantText.includes(path))
  const judgePassed = judgePathMentioned && /(?:Judge判定|最终\s*verdict)\s*(?:[：:|]\s*)?(?:\*{1,2}|_{1,2})?(?:通过|pass(?:ed)?)(?:\*{1,2}|_{1,2})?(?=\s|$|[|，。（(])/iu.test(assistantText)
  const judgeBlocked = judgePathMentioned && /(?:Judge判定|最终\s*verdict)\s*(?:[：:|]\s*)?(?:\*{1,2}|_{1,2})?(?:未通过|退回|失败|fail(?:ed)?|阻断)(?:\*{1,2}|_{1,2})?(?=\s|$|[|，。（(])/iu.test(assistantText)
  const receipt = judgePathMentioned && (judgePassed || judgeBlocked || /修复轮次\s*(?:[：:|]\s*)?\d+/u.test(assistantText))
  const artifactRows = artifacts.map(artifact => {
    const artifactPath = artifactPathForTask(artifact, taskKey)
    const mentioned = artifactPath !== undefined && assistantText.includes(artifactPath)
    const generation: ProgressState = receipt && mentioned
      ? 'done'
      : snapshot.running && mentioned ? 'running' : hasAssistant ? 'unverified' : 'pending'
    const judgment: ProgressState = generation === 'done' && judgePassed
      ? 'done'
      : generation === 'done' && judgeBlocked ? 'blocked' : snapshot.running && judgeRouted && mentioned ? 'running' : hasAssistant ? 'unverified' : 'pending'
    return {
      artifact,
      label: artifactLabel(artifact),
      involved: !isOptionalArtifact(artifact.relativePath) || mentioned,
      generation,
      judgment,
    }
  })
  return {
    understanding: hasAssistant ? 'done' : snapshot.running ? 'running' : 'unverified',
    splitting: businessRouted ? 'done' : snapshot.running ? 'running' : 'unverified',
    delivery: judgePassed ? 'done' : judgeBlocked ? 'blocked' : snapshot.running && judgeRouted ? 'running' : receipt ? 'unverified' : 'pending',
    artifacts: artifactRows,
    evidence: receipt ? 'receipt' : snapshot.running ? 'running' : 'unverified',
  }
}

export type MemberExecutionState = 'idle' | 'running' | 'done' | 'blocked'

export function memberExecutionStateOf(member: TeamMember, progress: TeamProgressView): MemberExecutionState {
  if (isJudgeMember(member)) {
    if (progress.delivery === 'done') return 'done'
    if (progress.delivery === 'blocked') return 'blocked'
    if (progress.delivery === 'running') return 'running'
    return 'idle'
  }
  const owned = progress.artifacts.filter(row => row.artifact.producedBy === member.memberId && row.involved)
  if (owned.some(row => row.judgment === 'blocked')) return 'blocked'
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
  const text = textFromNodes([node])
  const taskKey = taskKeyFromEvidence(text)
  const paths = businessArtifacts(team)
    .map(artifact => artifactPathForTask(artifact, taskKey))
    .filter((path): path is string => path !== undefined && text.includes(path))
  const routed = team.members.filter(member => text.includes(member.memberId))
  const timing = turn === undefined ? undefined : snapshot.turnTimings.get(turn)
  const time = timelineTime(timing?.endTime ?? timing?.startTime)
  const suffix = turn === undefined ? '' : `第 ${turn} 轮`
  const judgePassed = /(?:Judge判定|最终\s*verdict)\s*(?:[：:|]\s*)?(?:\*{1,2}|_{1,2})?(?:通过|pass(?:ed)?)(?:\*{1,2}|_{1,2})?(?=\s|$|[|，。（(])/iu.test(text)
  const judgeBlocked = /(?:Judge判定|最终\s*verdict)\s*(?:[：:|]\s*)?(?:\*{1,2}|_{1,2})?(?:未通过|退回|失败|fail(?:ed)?|阻断)(?:\*{1,2}|_{1,2})?(?=\s|$|[|，。（(])/iu.test(text)
  if (judgePassed || judgeBlocked) {
    return {
      key: `judge-${String(turn ?? node.messageId ?? time)}`,
      title: `独立 Judge ${judgePassed ? '完成判定' : '阻断交付'}`,
      copy: `稳定回执记录为${judgePassed ? '通过' : '未通过'}；业务产物状态仍按生成、判定两段展示。`,
      time,
      tone: judgePassed ? 'done' : 'blocked',
    }
  }
  if (paths.length > 0) {
    const filenames = paths.map(path => path.split('/').at(-1) ?? path)
    return {
      key: `artifact-${String(turn ?? node.messageId ?? time)}`,
      title: `${suffix || '当前轮'}任务路径已出现`,
      copy: `运行时轨迹出现 ${filenames.join('、')} 的当前任务精确路径；不等同于已经生成或判定。`,
      time,
      tone: 'active',
    }
  }
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
    copy: '当前轮已有主智能体回复；尚未检测到稳定产物或 Judge 回执。',
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

interface TeamMentionControlProps {
  sessionId: string
  input: NativeInputState
  inputActions: { setDraft(text: string): void; submit(): void }
  menu: SnapshotStore<{ open: boolean }>
  launcher: SnapshotStore<string | null>
  toggleTeamMention(draft: string, draftRev: number): void
}

function TrackingEnableDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const backfillRef = useRef<HTMLButtonElement>(null)
  useDialogKeyboard(true, onClose, backfillRef)
  return createPortal(
    <div className="promax-team-create-backdrop">
      <section className="promax-team-create-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-enable-tracking-heading">
        <header><div><span className="promax-eyebrow">交底草稿</span><h2 id="promax-enable-tracking-heading">怎样处理前面的对话？</h2><p>当前草稿已经有内容。选择是否把之前的轮次补进交底。</p></div></header>
        <div className="promax-choice-list">
          <button ref={backfillRef} type="button" onClick={() => { enableDraftTracking(sessionId, 'backfill'); onClose() }}><strong>补整理</strong><span>回看当前仍可见的对话并补入交底，条目会标记为“⟲ 补整理”。</span></button>
          <button type="button" onClick={() => { enableDraftTracking(sessionId, 'now'); onClose() }}><strong>只从现在开始</strong><span>保留之前的对话原文，但只整理之后的新信息。</span></button>
        </div>
        <footer><button type="button" className="promax-button" onClick={onClose}>取消</button></footer>
      </section>
    </div>,
    document.body,
  )
}

/** Adds team member targeting or draft handoff controls without replacing dsh's native composer. */
export function PromaxConversationInputControl(props: TeamMentionControlProps) {
  const { sessionId, input, inputActions, menu, launcher, toggleTeamMention } = props
  const state = useTeamState()
  const team = teamForSession(state, sessionId)
  const menuOpen = useSyncExternalStore(menu.subscribe, () => menu.getSnapshot().open, () => false)
  const launcherName = useSyncExternalStore(launcher.subscribe, () => launcher.getSnapshot(), () => null)
  const handoffVersion = useSyncExternalStore(subscribeNativeTeamPrompts, nativeTeamPromptSnapshot, () => 0)
  const expanded = menuOpen && launcherName === 'promax-team-member'
  const wasExpanded = useRef(false)
  const selected = input.occurrences.filter(occurrence => occurrence.source === 'promax-team-member')

  useEffect(() => {
    const handoff = nativeTeamPromptHandoffs.get(sessionId)
    if (handoff === undefined || input.phase !== 'plain') return
    nativeTeamPromptHandoffs.delete(sessionId)
    if (input.draft !== '') return
    inputActions.setDraft(handoff)
    queueMicrotask(() => { inputActions.submit() })
  }, [handoffVersion, input.draft, input.phase, inputActions, sessionId])

  useEffect(() => {
    if (wasExpanded.current && !expanded) document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')?.focus({ preventScroll: true })
    wasExpanded.current = expanded
  }, [expanded])

  // Draft sessions intentionally have no team-member tools. Their persistent
  // status and transfer action live in the page-level banner instead.
  if (team === undefined) return null
  if (team.activeRevision === undefined) return null

  const remove = (occurrence: NativeInputOccurrence): void => {
    const before = input.draft.slice(0, occurrence.offset)
    let after = input.draft.slice(occurrence.offset + occurrence.length)
    if (after.startsWith(' ')) after = after.slice(1)
    inputActions.setDraft(`${before}${after}`)
  }

  return <div className="promax-native-mentions" aria-label="已指定团队成员">
    <button type="button" className="promax-native-mention-trigger" aria-label="指定团队成员" aria-expanded={expanded} disabled={input.phase !== 'plain' || team.members.length === 0} onPointerDown={event => { event.stopPropagation() }} onClick={() => { toggleTeamMention(input.draft, input.draftRev) }}>@</button>
    {selected.map(occurrence => <button key={occurrence.occurrenceId} type="button" className="promax-native-mention-chip" aria-label={`移除 @${occurrence.label}`} onClick={() => { remove(occurrence) }}>@{occurrence.label}<Icon name="close" size={11} /></button>)}
  </div>
}

export const PromaxTeamMentionControl = PromaxConversationInputControl

function DraftStatusBanner({ sessionId }: { sessionId: string }) {
  const draftState = useDraftState()
  const [enableOpen, setEnableOpen] = useState(false)
  const turns = draftUserTurnCount(sessionId)
  const tracking = draftState.enabled && draftSessionView(sessionId).tracking !== 'off'
  const canHandoff = turns > 0

  return <section className={`promax-draft-status-banner${tracking ? ' is-tracking' : ' is-warning'}`} aria-label="草稿运行边界">
    <span className="promax-draft-status-icon"><Icon name={tracking ? 'shield' : 'activity'} size={18} /></span>
    <div className="promax-draft-status-copy">
      <strong>{tracking ? '草稿模式 · 正在整理交底' : '当前草稿未记录交底'}</strong>
      <span>草稿不会调用产品团队成员，也不能直接 @；{canHandoff ? '已有内容，可以立即交给团队并进入新的 r7 团队会话。' : '先发送至少一条草稿内容，即可交给团队。'}</span>
    </div>
    <div className="promax-draft-status-actions">
      {!tracking ? <button type="button" className="promax-draft-status-button" onClick={() => { if (turns > 0) setEnableOpen(true); else enableDraftTracking(sessionId, 'now') }}>开启交底记录</button> : null}
      <button type="button" className="promax-draft-status-button is-primary" disabled={!canHandoff} title={canHandoff ? '选择项目并启动新的 r7 团队会话' : '先在当前草稿中发送至少一条内容'} onClick={() => { window.dispatchEvent(new CustomEvent('promax:handoff-request', { detail: { sessionId } })) }}>交给团队 <span aria-hidden="true">→</span></button>
    </div>
    {enableOpen ? <TrackingEnableDialog sessionId={sessionId} onClose={() => { setEnableOpen(false) }} /> : null}
  </section>
}

interface TeamSessionHeaderProps {
  sessionId: string
  useSession: NativeSessionHook
}

function ProgressMark({ state, label }: { state: ProgressState; label: string }) {
  const mark = state === 'done' ? '✓' : state === 'blocked' ? '⚠' : state === 'running' ? '↻' : state === 'unverified' ? '?' : '○'
  return <span className={`promax-progress-mark promax-progress-mark--${state}`}><span aria-hidden="true">{mark}</span>{label}</span>
}

function TeamMembersButton({ team }: { team: PromaxTeam }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const members = team.members.filter(member => member.enabled)
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
  const close = (): void => { setOpen(false); triggerRef.current?.focus() }
  return <>
    <button ref={triggerRef} type="button" className="promax-native-members-trigger" aria-expanded={open} onClick={() => { setOpen(true) }}><Icon name="users" size={14} />成员·{members.length}</button>
    {open ? createPortal(<div className="promax-members-layer"><button type="button" className="promax-members-scrim" aria-label="关闭团队成员" onClick={close} /><aside className="promax-members-drawer" aria-label={`${team.name}团队成员`}><header><div><span className="promax-eyebrow">Promax 团队</span><h2>团队成员</h2><p>{team.name} · 第 {currentPage + 1} / {pageCount} 页</p></div><button ref={closeRef} type="button" className="promax-icon-button" aria-label="关闭团队成员抽屉" onClick={close}><Icon name="close" size={15} /></button></header><div className="promax-members-list">{pageMembers.map(member => <article key={member.memberId} className="promax-member-row"><span className="promax-team-member-avatar"><Icon name="agent" size={16} /></span><div><strong>{member.displayName}</strong><small>{member.role === 'coordinator' ? 'Coordinator' : 'Worker'} · {member.memberId}</small><p>{member.objective || '已配置团队职责'}</p></div><em>已配置</em></article>)}</div>{pageCount > 1 ? <footer className="promax-pagination"><button type="button" className="promax-button" disabled={currentPage === 0} onClick={() => { setPage(value => Math.max(0, value - 1)) }}>上一页</button><span>{currentPage + 1} / {pageCount} · 共 {members.length} 名</span><button type="button" className="promax-button" disabled={currentPage >= pageCount - 1} onClick={() => { setPage(value => Math.min(pageCount - 1, value + 1)) }}>下一页</button></footer> : null}</aside></div>, document.body) : null}
  </>
}

function TeamFilesButton({ team, workspace, progress, openWorkspacePath }: { team: PromaxTeam; workspace: WorkspaceView | undefined; progress: TeamProgressView; openWorkspacePath: WorkspaceShellActions['openWorkspacePath'] }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
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
  const close = (): void => { setOpen(false); triggerRef.current?.focus() }
  const openProject = (): void => {
    if (workspace === undefined) return
    setError(null)
    void openWorkspacePath(workspace.path).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }
  return <>
    <button ref={triggerRef} type="button" className="promax-native-members-trigger" aria-expanded={open} disabled={workspace === undefined} onClick={() => { setOpen(true) }}><Icon name="folder" size={14} />文件</button>
    {open ? createPortal(<div className="promax-members-layer"><button type="button" className="promax-members-scrim" aria-label="关闭项目文件" onClick={close} /><aside className="promax-members-drawer promax-files-drawer" aria-label={`${workspace?.title ?? team.name}项目文件`}><header><div><span className="promax-eyebrow">项目目录</span><h2>{workspace?.title ?? '尚未选择项目'}</h2><p>{workspace?.path ?? '请先从常驻导航选择项目'}</p></div><button ref={closeRef} type="button" className="promax-icon-button" aria-label="关闭项目文件抽屉" onClick={close}><Icon name="close" size={15} /></button></header><div className="promax-file-tree"><section><strong><Icon name="folder" size={14} />输入/</strong><span>草稿/ · 源文件/（团队只读）</span></section><section><strong><Icon name="folder" size={14} />产出/</strong><small>现役 r2 实际产物路径：deliverables/{'{task_key}'}/</small>{progress.artifacts.length === 0 ? <p>运行时团队定义尚未同步产物清单。</p> : <ul>{progress.artifacts.map(row => <li key={row.artifact.relativePath}><span><Icon name="artifact" size={13} /><span><strong>{row.label}</strong><small>{row.artifact.relativePath}</small></span></span><ProgressMark state={row.judgment} label={row.judgment === 'done' ? '已通过' : row.judgment === 'blocked' ? '未通过' : row.judgment === 'running' ? '判定中' : row.judgment === 'unverified' ? '未验证' : '未判定'} /></li>)}</ul>}</section></div>{error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}<footer className="promax-files-footer"><span>状态来自当前会话证据；没有 Judge 回执时不显示通过。</span><button type="button" className="promax-button" disabled={workspace === undefined} onClick={openProject}>打开项目目录</button></footer></aside></div>, document.body) : null}
  </>
}

/** Observes native turns; visible team navigation is hosted by shell.overlay so blank sessions have it too. */
export function PromaxTeamSessionHeader({ sessionId, useSession }: TeamSessionHeaderProps) {
  const state = useTeamState()
  const team = teamForSession(state, sessionId)
  const snapshot = useSession(value => value)

  useEffect(() => {
    if (team === undefined) observeDraftConversation(sessionId, snapshot.nodes)
    else publishTeamSessionProgress(sessionId, snapshot)
  }, [sessionId, snapshot, snapshot.nodes, team])
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

const OUTLINE_SECTIONS: Array<[DraftSectionId, string]> = [['background', '背景'], ['goal', '要解决什么'], ['constraints', '已知约束'], ['open', '还没定的']]

function DraftOutlinePanel({ sessionId }: { sessionId: string }) {
  useDraftState()
  const [collapsed, setCollapsed] = useState(false)
  const session = draftSessionView(sessionId)
  return <aside className={`promax-draft-panel${collapsed ? ' promax-draft-panel--collapsed' : ''}`} aria-label="交底草稿">
    <header><div><span className="promax-eyebrow">自动整理</span><h2>交底草稿</h2></div><button type="button" className="promax-icon-button" aria-label={collapsed ? '展开交底草稿' : '收起交底草稿'} onClick={() => { setCollapsed(value => !value) }}><Icon name="panelRight" size={16} /></button></header>
    {collapsed ? null : <><p>随对话增量整理；交给团队前可编辑。</p>{session.compacted ? <div className="promax-inline-warning">对话发生过压缩，建议转交前检查交底内容。</div> : null}<div className="promax-draft-outline">{OUTLINE_SECTIONS.map(([id, label]) => { const rows = session.outline.filter(item => item.section === id); return <section key={id}><h3>{label}</h3>{rows.length === 0 ? <span>暂无</span> : <ul>{rows.map(item => <li key={item.id}>{item.backfilled ? <em>⟲ 补整理</em> : null}{item.text}</li>)}</ul>}</section> })}</div></>}
  </aside>
}

function TeamSessionToolbar({ team, workspace, sessionId, session, sessions, clearSession, openWorkspacePath }: { team: PromaxTeam; workspace: WorkspaceView | undefined; sessionId: string | undefined; session: SessionSummary | undefined; sessions: SessionListState; clearSession: WorkspaceShellActions['clearSession']; openWorkspacePath: WorkspaceShellActions['openWorkspacePath'] }) {
  const snapshot = useTeamSessionProgress(sessionId)
  const progress = teamProgressOf(team, snapshot)
  const tree = teamSessionTreeOf(sessionId, sessions)
  const availability = teamAvailabilityOf(snapshot, session, tree)
  const goTeam = (): void => { selectTeamHome(team.id); clearSession() }
  const goProject = (): void => { selectTeamHome(team.id, workspace?.workspaceId); clearSession() }
  return <header className="promax-team-session-toolbar" aria-label="团队会话导航">
    <div className="promax-native-team-header">
      <nav className="promax-native-breadcrumb" aria-label="团队会话层级"><button type="button" onClick={goTeam}>{team.name}</button><span aria-hidden="true">/</span><button type="button" onClick={goProject}>{workspace?.title ?? '项目'}</button></nav>
      <span className="promax-native-room-context" title={`${team.name} · ${team.activeRevision?.presetId ?? '未配置'}`}>
        <span className="promax-room-mark" aria-hidden="true">P</span><span className="promax-native-room-copy"><strong>{team.coordinator.displayName}</strong><small>统筹 · {team.members.filter(member => member.enabled).length} 名成员</small></span><span className={`promax-native-room-state${availability.tone === 'active' ? ' promax-native-room-state--running' : ''}`} role="status" aria-atomic="true">{availability.label}</span>
      </span>
      <TeamFilesButton team={team} workspace={workspace} progress={progress} openWorkspacePath={openWorkspacePath} />
      <TeamMembersButton team={team} />
    </div>
  </header>
}

function TeamProgressRail({ team, workspace, sessionId, openWorkspacePath }: { team: PromaxTeam; workspace: WorkspaceView | undefined; sessionId: string | undefined; openWorkspacePath: WorkspaceShellActions['openWorkspacePath'] }) {
  const snapshot = useTeamSessionProgress(sessionId)
  const progress = teamProgressOf(team, snapshot)
  const evidenceLabel = progress.evidence === 'not-started'
    ? '当前会话 0 turn：尚未开始'
    : progress.evidence === 'running' ? '运行中：等待稳定回执' : progress.evidence === 'receipt' ? '已读取当前会话稳定回执' : '未检测到稳定回执：不推测通过状态'
  const labelFor = (state: ProgressState, stage: 'generation' | 'judgment'): string => {
    if (state === 'done') return stage === 'generation' ? '已生成' : '已通过'
    if (state === 'blocked') return stage === 'generation' ? '生成失败' : '未通过'
    if (state === 'running') return stage === 'generation' ? '生成中' : '判定中'
    if (state === 'unverified') return '未验证'
    return stage === 'generation' ? '尚未生成' : '未判定'
  }
  return <aside className="promax-team-progress-rail" aria-label="团队进度">
    <header><div><span className="promax-eyebrow">状态与结果</span><h2>进度</h2></div><span className="promax-progress-revision">r{team.activeRevision?.revision ?? '—'}</span></header>
    <p className="promax-progress-evidence">{evidenceLabel}</p>
    <ol className="promax-progress-tree">
      <li className="promax-progress-step"><ProgressMark state={progress.understanding} label="理解需求" /></li>
      <li className="promax-progress-step"><ProgressMark state={progress.splitting} label="拆分任务" /></li>
      <li className="promax-progress-branches"><span>并行产出</span>{progress.artifacts.length === 0 ? <div className="promax-progress-empty">运行时团队定义尚未同步产物清单。</div> : <ul>{progress.artifacts.map(row => <li key={row.artifact.relativePath}><div className="promax-progress-artifact-title"><Icon name="artifact" size={14} /><span><strong>{row.label}</strong><small>{row.artifact.producedBy}</small></span></div><div className="promax-progress-artifact-stages"><ProgressMark state={row.generation} label={`生成·${labelFor(row.generation, 'generation')}`} /><ProgressMark state={row.judgment} label={`判定·${labelFor(row.judgment, 'judgment')}`} /></div><button type="button" className="promax-progress-open" disabled={row.generation !== 'done' || workspace === undefined} title={row.generation === 'done' ? '打开项目目录定位产物' : '产物尚未生成'} onClick={() => { if (workspace !== undefined) void openWorkspacePath(workspace.path) }}>打开</button></li>)}</ul>}</li>
      <li className="promax-progress-step promax-progress-step--delivery"><ProgressMark state={progress.delivery} label="终审交付" /></li>
    </ol>
  </aside>
}

function TeamHome({ team, workspace, startSession, openSession, clearSession, renameSession, prepareSessionScope, openWorkspacePath }: { team: PromaxTeam; workspace: WorkspaceView | undefined; startSession: WorkspaceShellActions['startSession']; openSession: WorkspaceShellActions['openSession']; clearSession: WorkspaceShellActions['clearSession']; renameSession: WorkspaceShellActions['renameSession']; prepareSessionScope: WorkspaceShellActions['prepareSessionScope']; openWorkspacePath: WorkspaceShellActions['openWorkspacePath'] }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = team.activeRevision
  const send = (): void => {
    if (workspace === undefined || revision === undefined || draft.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    void startSession(workspace.workspaceId, revision.presetId).then(async sessionId => {
      const scope = await prepareBoundTeamSession({ renameSession, prepareSessionScope }, team, workspace, sessionId, sessionScopeNameFromPrompt(draft))
      stageNativeTeamPrompt(sessionId, draft.trim(), [], scope)
      selectTeamSession(team.id, sessionId, workspace.workspaceId)
      openSession(sessionId)
    }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
  }
  return <main className="promax-team-home" aria-label={`${team.name}项目界面`}>
    <section className="promax-team-home-main">
      <header className="promax-team-home-header">
        <div className="promax-team-identity">
          <span className="promax-team-identity-mark" aria-hidden="true">产</span>
          <div className="promax-team-identity-copy">
            <nav className="promax-team-breadcrumb" aria-label="团队层级">
              <button type="button" aria-label={`返回${team.name}`} onClick={() => { selectTeamHome(team.id); clearSession() }}>{team.name}</button>
              {workspace === undefined ? null : <><span aria-hidden="true">/</span><button type="button" aria-label={`当前项目：${workspace.title}`} onClick={() => { selectTeamHome(team.id, workspace.workspaceId); clearSession() }}>{workspace.title}</button></>}
            </nav>
            <div className="promax-team-title-line"><h1>{workspace?.title ?? '选择项目'}</h1><span className="promax-team-state promax-team-state--published">团队已配置</span></div>
            <p className="promax-team-mission">{team.description}</p>
            <p className="promax-team-meta">{team.coordinator.displayName}统筹 · {team.members.filter(member => member.enabled).length} 名成员</p>
          </div>
        </div>
        <div className="promax-team-home-actions"><TeamFilesButton team={team} workspace={workspace} progress={teamProgressOf(team, undefined)} openWorkspacePath={openWorkspacePath} /><TeamMembersButton team={team} /><button type="button" className="promax-button" disabled={workspace === undefined} onClick={() => { if (workspace !== undefined) void openWorkspacePath(workspace.path).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }) }}><Icon name="folder" size={15} />打开项目目录</button></div>
      </header>
      <div className="promax-team-interaction"><div className="promax-team-prompt-block"><div className="promax-room-intro"><span className="promax-room-sequence" aria-hidden="true">01</span><div><span className="promax-eyebrow">新任务</span><h2>{workspace === undefined ? '请新建或选择项目' : `把目标交给 ${team.name}`}</h2><p>{workspace === undefined ? '使用常驻导航中的项目树进入工作区。' : '团队配置固定；任务和产物都隔离在当前项目。'}</p></div></div><textarea className="promax-team-prompt" value={draft} disabled={workspace === undefined || busy} placeholder="描述要交给产品团队的任务……" onChange={event => { setDraft(event.currentTarget.value) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} /><div className="promax-team-prompt-actions"><span>{workspace?.path ?? '尚未选择项目'}</span><button type="button" className="promax-button promax-button--primary" disabled={workspace === undefined || busy || draft.trim() === ''} onClick={send}>{busy ? '正在发送…' : '发送给团队'}</button></div></div></div>
      {error === null ? null : <div className="promax-team-page-error" role="alert">{error}</div>}
    </section>
  </main>
}

function TransferDialog({ sessionId, sourceSessionTitle, projects, team, actions, onClose }: { sessionId: string; sourceSessionTitle: string | undefined; projects: WorkspaceView[]; team: PromaxTeam; actions: Pick<WorkspaceShellActions, 'writeDraftHandoff' | 'startSession' | 'openSession' | 'renameSession' | 'prepareSessionScope'>; onClose: () => void }) {
  useDraftState()
  const session = draftSessionView(sessionId)
  const onsite = !readDraftState().enabled || session.tracking === 'off'
  const [workspaceId, setWorkspaceId] = useState(projects[0]?.workspaceId ?? '')
  const [handoff, setHandoff] = useState(() => handoffMarkdown(sessionId, onsite))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  useDialogKeyboard(true, onClose, selectRef)
  const workspace = projects.find(project => project.workspaceId === workspaceId)
  const submit = (): void => {
    const revision = team.activeRevision
    if (workspace === undefined || revision === undefined || handoff.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    void actions.writeDraftHandoff({ workspaceId: workspace.workspaceId, projectPath: workspace.path, handoff: handoff.trim(), transcript: transcriptMarkdown(sessionId) }).then(async saved => {
      const teamSessionId = await actions.startSession(workspace.workspaceId, revision.presetId)
      const requestedName = sourceSessionTitle === undefined || sourceSessionTitle.trim() === '' ? sessionScopeNameFromPrompt(handoff) : sessionScopeNameFromPrompt(sourceSessionTitle)
      const scope = await prepareBoundTeamSession(actions, team, workspace, teamSessionId, requestedName)
      stageNativeTeamPrompt(teamSessionId, draftHandoffTeamPrompt(handoff.trim(), saved), [], scope)
      selectTeamSession(team.id, teamSessionId, workspace.workspaceId)
      actions.openSession(teamSessionId)
      onClose()
    }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false) })
  }
  return createPortal(<div className="promax-team-create-backdrop"><section className="promax-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-transfer-heading"><header><div><span className="promax-eyebrow">草稿 → 产品智能体团队</span><h2 id="promax-transfer-heading">交给团队</h2><p>选择项目，检查四段交底；确认后会保存交底与原始对话，并启动新的团队会话。</p></div><button type="button" className="promax-icon-button" aria-label="关闭转交" disabled={busy} onClick={onClose}><Icon name="close" size={15} /></button></header>{onsite ? <div className="promax-inline-warning"><strong>交底记录未开启</strong><span>本次会从当前仍可见的对话现场提取，可能遗漏已被压缩的内容。</span></div> : null}{session.compacted ? <div className="promax-inline-warning"><strong>对话发生过压缩</strong><span>请先检查四段交底是否完整，再确认转交。</span></div> : null}<label className="promax-field"><span>目标项目</span><select ref={selectRef} className="promax-input" value={workspaceId} disabled={busy} onChange={event => { setWorkspaceId(event.currentTarget.value) }}>{projects.map(project => <option key={project.workspaceId} value={project.workspaceId}>{project.title}</option>)}</select></label>{projects.length === 0 ? <div className="promax-inline-error">还没有项目，请先通过常驻导航新建项目。</div> : null}<label className="promax-field"><span>需求交底（可编辑）</span><textarea className="promax-textarea promax-transfer-editor" value={handoff} disabled={busy} onChange={event => { setHandoff(event.currentTarget.value) }} /></label>{error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}<footer><button type="button" className="promax-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="promax-button promax-button--primary" disabled={busy || workspace === undefined || handoff.trim() === ''} onClick={submit}>{busy ? '正在转交…' : '保存并交给团队'}</button></footer></section></div>, document.body)
}

export function PromaxDraftSettings() {
  const state = useDraftState()
  const [enableSessionId, setEnableSessionId] = useState<string | null>(null)
  const change = (enabled: boolean): void => {
    if (!enabled) { setDraftTrackingEnabled(false); return }
    const sessionId = latestDraftSessionId()
    if (sessionId !== undefined && draftUserTurnCount(sessionId) > 0) { setEnableSessionId(sessionId); return }
    if (sessionId !== undefined) enableDraftTracking(sessionId, 'now')
    else setDraftTrackingEnabled(true)
  }
  return <><section className="promax-draft-settings"><div><strong>交底草稿</strong><p>草稿会话中默认增量整理需求；关闭后，输入框旁会持续显示“未记录交底”。</p></div><label className="promax-switch"><input type="checkbox" checked={state.enabled} onChange={event => { change(event.currentTarget.checked) }} /><span>{state.enabled ? '已开启' : '已关闭'}</span></label></section>{enableSessionId === null ? null : <TrackingEnableDialog sessionId={enableSessionId} onClose={() => { setEnableSessionId(null) }} />}</>
}

export function PromaxTeamRail({ useWorkspaces, useSessions, startSession, openSession, clearSession, renameSession, prepareSessionScope, openWorkspacePath }: RuntimeProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaceState = useWorkspaces(state => state)
  const sessionState = useSessions(state => state)
  const team = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const projects = team === undefined ? [] : workspacesForTeam(team, workspaceState.items)
  const selectedWorkspace = teamState.selected.kind === 'team'
    ? projects.find(project => project.workspaceId === teamState.selected.workspaceId)
    : undefined
  const selectedTeamSessionId = teamState.selected.kind === 'team' && teamState.selected.view === 'session'
    ? teamState.selected.sessionId ?? sessionState.current
    : undefined
  const selectedTeamSession = selectedTeamSessionId === undefined ? undefined : sessionState.byId[selectedTeamSessionId]

  return <div className="promax-shell-layer">
    {team !== undefined && teamState.selected.kind === 'team' && teamState.selected.view === 'home' ? <TeamHome team={team} workspace={selectedWorkspace} startSession={startSession} openSession={openSession} clearSession={clearSession} renameSession={renameSession} prepareSessionScope={prepareSessionScope} openWorkspacePath={openWorkspacePath} /> : null}
    {team !== undefined && teamState.selected.kind === 'team' && teamState.selected.view === 'session' ? <TeamSessionToolbar team={team} workspace={selectedWorkspace} sessionId={selectedTeamSessionId} session={selectedTeamSession} sessions={sessionState} clearSession={clearSession} openWorkspacePath={openWorkspacePath} /> : null}
    {team !== undefined && teamState.selected.kind === 'team' ? <TeamProgressRail team={team} workspace={selectedWorkspace} sessionId={selectedTeamSessionId} openWorkspacePath={openWorkspacePath} /> : null}
    {teamState.selected.kind === 'general' && sessionState.current !== undefined ? <DraftOutlinePanel sessionId={sessionState.current} /> : null}
  </div>
}

interface PromaxLayoutActions {
  toggleSidebar(): void
  openDetails(): void
  closeDetails(): void
}

interface PromaxShellRuntimeProps extends RuntimeProps {
  layout: PromaxLayoutActions
  detailsOpen?: boolean
  apiBaseUrl?: string
}

function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useDialogKeyboard(true, onClose, closeRef)
  return createPortal(
    <div className="promax-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="promax-preferences-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-preferences-heading">
        <header><div><span className="promax-eyebrow">PROMAX</span><h2 id="promax-preferences-heading">设置</h2></div><button ref={closeRef} type="button" className="promax-icon-button" aria-label="关闭设置" onClick={onClose}><Icon name="close" size={15} /></button></header>
        <PromaxDraftSettings />
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
    {preferencesOpen ? <PreferencesDialog onClose={() => { setPreferencesOpen(false) }} /> : null}
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
  stopTeamDescendants?: (targets: readonly TeamSubagentStopTarget[]) => Promise<void>
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

type ComposerHostView = 'draft' | 'workbench' | 'trace' | 'deliverables'

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

interface ComposerTeamMentionPickerProps {
  team: PromaxTeam
  selectedMemberIds: readonly string[]
  disabled: boolean
  onChange(memberIds: string[]): void
}

function ComposerTeamMentionPicker({ team, selectedMemberIds, disabled, onChange }: ComposerTeamMentionPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const members = [team.coordinator, ...team.members.filter(member => member.enabled)]

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const toggle = (memberId: string): void => {
    onChange(selectedMemberIds.includes(memberId)
      ? selectedMemberIds.filter(id => id !== memberId)
      : [...selectedMemberIds, memberId])
  }

  return <div ref={rootRef} className="promax-composer-mention-picker">
    <button className="composer-tool promax-composer-mention-trigger" type="button" aria-label="指定团队成员" aria-expanded={open} aria-haspopup="menu" disabled={disabled || members.length === 0} onClick={() => { setOpen(value => !value) }}>
      <span aria-hidden="true">@</span>{selectedMemberIds.length > 0 ? <span className="promax-composer-mention-count">{selectedMemberIds.length}</span> : null}
    </button>
    {open ? <div className="promax-composer-mention-menu" role="menu" aria-label={`${team.name}可指定成员`}>
      <header><strong>指定团队成员</strong><span>任务仍由主智能体统筹</span></header>
      <div>{members.map(member => {
        const selected = selectedMemberIds.includes(member.memberId)
        return <button type="button" role="menuitemcheckbox" aria-checked={selected} key={member.memberId} onClick={() => { toggle(member.memberId) }}>
          <span className="promax-composer-mention-avatar">{member.displayName.slice(0, 2)}</span>
          <span><strong>{member.displayName}</strong><small>{member.role === 'coordinator' ? '主智能体' : member.memberId}</small></span>
          <span className={`promax-composer-mention-check${selected ? ' is-selected' : ''}`} aria-hidden="true">{selected ? '✓' : ''}</span>
        </button>
      })}</div>
    </div> : null}
  </div>
}

/** Promax composer chrome over the retained dsh input machine. */
export function PromaxComposerBar(props: PromaxComposerProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const input = props.useInput(state => state)
  const nativeRunning = props.useSession?.(state => state?.running === true) ?? false
  const sessionState = props.useSessions?.(state => state)
  const workspaceState = props.useWorkspaces?.(state => state)
  const teamState = useTeamState()
  const [localDraft, setLocalDraft] = useState('')
  const [composerTargetMemberIds, setComposerTargetMemberIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachmentHelpId = useId()
  const host = useComposerHost()
  const [commandPending, setCommandPending] = useState(false)
  const draft = input?.draft ?? localDraft
  const selectedContext = teamState.selected
  const selectedTeam = selectedContext.kind === 'team'
    ? teamState.teams.find(team => team.id === selectedContext.teamId)
    : undefined
  const selectedWorkspaceId = selectedContext.kind === 'team' ? selectedContext.workspaceId : undefined
  const selectedWorkspace = selectedWorkspaceId === undefined ? undefined : workspaceState?.items.find(workspace => workspace.workspaceId === selectedWorkspaceId)
  const canStartTeam = props.sessionId === undefined && selectedTeam?.activeRevision !== undefined && selectedWorkspaceId !== undefined && props.startSession !== undefined && props.openSession !== undefined
  const currentTeam = props.sessionId === undefined ? undefined : teamForSession(teamState, props.sessionId)
  const currentBinding = props.sessionId === undefined ? undefined : bindingForSession(teamState, props.sessionId)
  const currentSession = props.sessionId === undefined ? undefined : sessionState?.byId[props.sessionId]
  const teamTree = teamSessionTreeOf(currentTeam === undefined ? undefined : props.sessionId, sessionState)
  const stopsTeam = currentTeam !== undefined && teamTree.runningDescendants.length > 0
  const primaryStops = nativeRunning || stopsTeam
  const canStop = props.stop !== undefined && (!stopsTeam || props.stopTeamDescendants !== undefined)
  const locked = (props.disabled === true && !canStartTeam) || props.blocked !== undefined || busy || stopping || input?.phase === 'adjudicating' || input?.phase === 'submitting'
  const mentionTeam = currentTeam?.activeRevision !== undefined ? currentTeam : canStartTeam ? selectedTeam : undefined
  const usesLocalMentionPicker = props.leftItems === undefined && mentionTeam !== undefined
  const targetMemberIds = usesLocalMentionPicker ? composerTargetMemberIds : []
  const draftMode = host?.view === 'draft' && currentTeam === undefined && !canStartTeam
  const placeholder = props.blocked?.reason ?? props.placeholder ?? (draftMode
    ? '继续描述想法；需要团队执行时请使用顶部“交给团队”'
    : mentionTeam === undefined ? '描述任务…' : '描述任务，或点击 @ 指定团队成员…')

  useEffect(() => { setComposerTargetMemberIds([]) }, [props.sessionId, selectedTeam?.id, selectedWorkspaceId])

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
    const needsInitialScope = props.sessionId !== undefined
      && currentTeam?.activeRevision !== undefined
      && currentBinding?.presetId === currentTeam.activeRevision.presetId
      && currentBinding.taskKey === undefined
      && currentSession?.blank === true
    if (needsInitialScope) {
      if (props.inputActions === undefined || props.renameSession === undefined || props.prepareSessionScope === undefined || selectedWorkspace === undefined || currentTeam === undefined) {
        setStopError('无法建立会话产出目录，任务未发送')
        return
      }
      setBusy(true)
      setStopError(null)
      void prepareBoundTeamSession(props as Pick<WorkspaceShellActions, 'renameSession' | 'prepareSessionScope'>, currentTeam, selectedWorkspace, props.sessionId!, sessionScopeNameFromPrompt(text)).then(scope => {
        props.inputActions!.setDraft(sessionScopedTeamPrompt(text, targetMemberIds, scope.sessionName, scope.taskKey))
        setComposerTargetMemberIds([])
        queueMicrotask(() => { props.inputActions?.submit() })
      }).catch(reason => { setStopError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
      return
    }
    if (!canStartTeam) {
      if (props.inputActions !== undefined && currentTeam !== undefined && targetMemberIds.length > 0) {
        props.inputActions.setDraft(routedTeamPrompt(text, targetMemberIds))
        setComposerTargetMemberIds([])
        queueMicrotask(() => { props.inputActions?.submit() })
      } else if (props.inputActions !== undefined) props.inputActions.submit()
      else props.onRequestWorkspace?.()
      return
    }
    if (selectedTeam?.activeRevision === undefined || selectedWorkspaceId === undefined || selectedWorkspace === undefined || props.startSession === undefined || props.openSession === undefined || props.renameSession === undefined || props.prepareSessionScope === undefined) return
    setBusy(true)
    setStopError(null)
    void props.startSession(selectedWorkspaceId, selectedTeam.activeRevision.presetId).then(async sessionId => {
      const scope = await prepareBoundTeamSession(props as Pick<WorkspaceShellActions, 'renameSession' | 'prepareSessionScope'>, selectedTeam, selectedWorkspace, sessionId, sessionScopeNameFromPrompt(text))
      stageNativeTeamPrompt(sessionId, text, targetMemberIds, scope)
      selectTeamSession(selectedTeam.id, sessionId, selectedWorkspaceId)
      props.openSession?.(sessionId)
      setLocalDraft('')
      setComposerTargetMemberIds([])
    }).catch(reason => { setStopError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
  }
  const stopTask = (): void => {
    if (!primaryStops || !canStop || stopping) return
    setStopping(true)
    setStopError(null)
    void (async () => {
      let failure: string | null = null
      try {
        await props.stop?.()
      } catch (error: unknown) {
        failure ??= error instanceof Error ? error.message : String(error)
      }
      if (stopsTeam && props.stopTeamDescendants !== undefined) {
        try {
          await props.stopTeamDescendants(teamTree.runningDescendants)
        } catch (error: unknown) {
          failure ??= error instanceof Error ? error.message : String(error)
        }
        try {
          await props.stop?.()
        } catch (error: unknown) {
          failure ??= error instanceof Error ? error.message : String(error)
        }
      }
      if (failure !== null) {
        setStopError(`停止任务失败：${failure}`)
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
      <div className="promax-composer-left-items">{props.leftItems ?? (mentionTeam === undefined ? null : <ComposerTeamMentionPicker team={mentionTeam} selectedMemberIds={composerTargetMemberIds} disabled={locked} onChange={setComposerTargetMemberIds} />)}</div>
      <label className="promax-sr-only" htmlFor="promax-task-input">描述任务</label>
      <textarea ref={textareaRef} id="promax-task-input" rows={1} value={draft} disabled={locked || (!canStartTeam && props.inputActions === undefined && props.onRequestWorkspace === undefined)} readOnly={props.inputActions === undefined && !canStartTeam} placeholder={placeholder} onClick={props.inputActions === undefined && !canStartTeam ? props.onRequestWorkspace : undefined} onChange={event => { write(event.currentTarget.value) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() } }} />
      {props.rightItems}
      <button className="send-button" type="button" aria-label={primaryStops ? stopping ? '正在停止团队任务' : currentTeam === undefined ? '停止当前执行' : '停止团队任务' : '发送任务'} title={primaryStops ? stopping ? '正在停止…' : currentTeam === undefined ? '停止当前执行' : '停止团队任务' : '发送任务'} disabled={primaryStops ? stopping || !canStop : draft.trim() === '' || locked || (props.inputActions === undefined && !canStartTeam)} onClick={primaryStops ? stopTask : submit}><Icon name={primaryStops ? 'stop' : 'send'} size={20} /></button>
    </div>
    {input?.imageIds !== undefined && input.imageIds.length > 0 ? <div className="promax-composer-attachment-count">已附 {input.imageIds.length} 张图片</div> : null}
    {stopError === null ? null : <div className="promax-inline-error" role="alert">{stopError}</div>}
    {host?.view === 'trace' ? props.footer : null}
  </div>
  return host === null ? composer : createPortal(composer, host.element)
}

type DeliverableState = 'optional-missing' | 'pending' | 'generated' | 'ready'

function deliverableStateOf(row: ArtifactProgress): DeliverableState {
  if (row.judgment === 'done') return 'ready'
  if (row.generation === 'done') return 'generated'
  if (!row.involved && isOptionalArtifact(row.artifact.relativePath)) return 'optional-missing'
  return 'pending'
}

/** M follows current-task evidence: six required paths plus optional paths once precisely observed. */
export function deliverableSummary(rows: readonly ArtifactProgress[]): { ready: number; involved: number; optionalMissing: number } {
  const states = rows.map(deliverableStateOf)
  return {
    ready: states.filter(state => state === 'ready').length,
    involved: rows.length === 0 ? 8 : rows.filter(row => row.involved).length,
    optionalMissing: states.filter(state => state === 'optional-missing').length,
  }
}

function progressLabel(state: ProgressState, stage: 'generation' | 'judgment'): string {
  if (state === 'done') return stage === 'generation' ? '已生成' : '已通过'
  if (state === 'blocked') return stage === 'generation' ? '生成失败' : '未通过'
  if (state === 'running') return stage === 'generation' ? '生成中' : '判定中'
  if (state === 'unverified') return '未验证'
  return stage === 'generation' ? '尚未生成' : '未判定'
}

function fileMeta(state: DeliverableState): string {
  if (state === 'ready') return '已完成 · 可验收'
  if (state === 'generated') return '已生成 · 待判定'
  if (state === 'optional-missing') return '可选 · 未产出'
  return '尚未生成 · 未判定'
}

function TeamStatusContent({ team, progress }: { team: PromaxTeam; progress: TeamProgressView }) {
  const coordinatorState: MemberExecutionState = progress.delivery === 'blocked'
    ? 'blocked'
    : progress.evidence === 'running' ? 'running' : progress.delivery === 'done' ? 'done' : 'idle'
  const presenceLabel = (state: MemberExecutionState): string => state === 'done'
    ? '已完成'
    : state === 'blocked' ? '已阻断' : state === 'running' ? '运行中' : '尚未开始'
  return <>
    <section className="right-section" aria-labelledby="promax-current-members">
      <h2 className="sidebar-section-title" id="promax-current-members">当前成员</h2>
      <div className="member-list">
        {[team.coordinator, ...team.members.filter(member => member.enabled)].map((member, index) => { const state = index === 0 ? coordinatorState : memberExecutionStateOf(member, progress); const label = presenceLabel(state); return <div className="member-item" key={member.memberId}>
          <span className="member-avatar">{index === 0 ? '主' : member.displayName.slice(0, 2)}</span>
          <span className="member-copy"><span className="member-name">{member.displayName}</span><span className="member-role">{index === 0 ? 'Coordinator · 统筹与验收' : `Worker · ${member.objective || member.memberId}`}</span></span>
          <span className={`presence presence--${state}`} aria-label={label} title={label} />
        </div> })}
      </div>
    </section>
    <section className="right-section sidebar-section" aria-labelledby="promax-business-artifacts">
      <h2 className="sidebar-section-title" id="promax-business-artifacts">业务产物</h2>
      <div className="promax-artifact-tree">
        {progress.artifacts.map(row => { const state = deliverableStateOf(row); return <div className={`promax-artifact-row${state === 'optional-missing' ? ' is-optional-missing' : ''}`} key={row.artifact.relativePath}>
          <div className="file-name">{row.label}</div><div className="file-meta">{team.members.find(member => member.memberId === row.artifact.producedBy)?.displayName ?? row.artifact.producedBy}</div>
          <div className="promax-artifact-stages"><span data-state={row.generation}><i />生成 · {state === 'optional-missing' ? '可选未产出' : progressLabel(row.generation, 'generation')}</span><span data-state={row.judgment}><i />判定 · {progressLabel(row.judgment, 'judgment')}</span></div>
        </div> })}
      </div>
    </section>
    <div className="team-note">团队是可协作的执行单元。主智能体负责理解、拆分、分配和终审，7 名成员负责专业交付与独立判定。</div>
  </>
}

export function PromaxDetailsSidebar(props: PromaxShellRuntimeProps & { sessionId: string }) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const team = teamForSession(useTeamState(), props.sessionId)
  const snapshot = useTeamSessionProgress(props.sessionId)
  if (team === undefined) return <div className="right-sidebar" id="promax-status-panel"><div className="right-header"><div><div className="right-kicker">PROMAX</div><div className="right-title">交底草稿</div></div><button className="promax-workbench-icon-button" type="button" aria-label="收起交底草稿" aria-controls="promax-status-panel" aria-expanded="true" title="收起交底草稿" onClick={props.layout.closeDetails}><Icon name="panelRight" size={17} /></button></div><div className="right-scroll"><DraftOutlinePanel sessionId={props.sessionId} /></div></div>
  const progress = teamProgressOf(team, snapshot)
  return <div className="right-sidebar" id="promax-status-panel"><div className="right-header"><div><div className="right-kicker">PROMAX</div><div className="right-title">状态与结果</div></div><button className="promax-workbench-icon-button" type="button" aria-label="收起状态栏" aria-controls="promax-status-panel" aria-expanded="true" title="收起状态栏" onClick={props.layout.closeDetails}><Icon name="panelRight" size={17} /></button></div><div className="right-scroll"><TeamStatusContent team={team} progress={progress} /></div></div>
}

function EmptyWorkspace({ title, copy }: { title: string; copy: string }) {
  return <div className="promax-workbench-empty"><span className="brand-mark" aria-hidden="true">P</span><h1>{title}</h1><p>{copy}</p></div>
}

function CompactTimeline({ events }: { events: readonly TimelineEventView[] }) {
  return <div className="timeline-list" role="list" aria-label="关键事件">
    {events.map(event => <article className={`timeline-item is-${event.tone}`} role="listitem" key={event.key}>
      <span className="timeline-dot" aria-hidden="true" />
      <div className="timeline-title">{event.title}</div>
      <div className="timeline-copy">{event.copy}</div>
      <span className="timeline-time">{event.time}</span>
    </article>)}
  </div>
}

function TeamOverviewDashboard({
  team,
  teamState,
  workspaces,
  sessionState,
  archivedSessionIds,
  onOpenProject,
}: {
  team: PromaxTeam
  teamState: PromaxTeamState
  workspaces: readonly WorkspaceView[]
  sessionState: SessionListState
  archivedSessionIds: readonly string[]
  onOpenProject: (workspace: WorkspaceView) => void
}) {
  const projects = workspacesForTeam(team, workspaces)
  const sessions = sessionsForTeam(team, teamState, workspaces, sessionState, archivedSessionIds)
  const enabledMembers = team.members.filter(member => member.enabled)
  const revision = team.activeRevision?.revision

  return <main className="promax-team-overview" aria-labelledby="promax-team-overview-title">
    <section className="promax-overview-hero">
      <div>
        <div className="promax-overview-kicker">TEAM OVERVIEW</div>
        <h1 id="promax-team-overview-title">团队总览</h1>
        <p>这里汇总团队配置、项目与会话。进入具体项目后再新建会话并与智能体团队协作。</p>
      </div>
      {revision === undefined ? null : <span className="promax-overview-revision">{revisionLabel(revision)}</span>}
    </section>

    <section className="promax-overview-stats" aria-label="团队关键数据">
      <article><span>项目</span><strong>{projects.length}</strong><small>独立工作目录</small></article>
      <article><span>会话</span><strong>{sessions.length}</strong><small>可见团队会话</small></article>
      <article><span>专业成员</span><strong>{enabledMembers.length}</strong><small>另有主智能体统筹</small></article>
      <article><span>业务产物</span><strong>{team.artifacts.length}</strong><small>固定交付契约</small></article>
    </section>

    <section className="promax-overview-section" aria-labelledby="promax-overview-projects">
      <header><div><h2 id="promax-overview-projects">项目</h2><p>项目是会话和交付物的归属目录。</p></div><span>{projects.length} 个项目</span></header>
      {projects.length === 0
        ? <div className="promax-overview-project-empty"><Icon name="folder" size={19} /><div><strong>还没有项目</strong><span>使用左侧“产品智能体团队”后的 + 新建项目。</span></div></div>
        : <div className="promax-overview-project-grid">{projects.map(project => {
          const rows = sessionsForProject(team, project, teamState, sessionState, archivedSessionIds)
          const latest = rows[0]
          return <button className="promax-overview-project-card" type="button" key={project.workspaceId} aria-label={`打开项目 ${project.title}`} onClick={() => { onOpenProject(project) }}>
            <span className="promax-overview-project-icon"><Icon name="folder" size={18} /></span>
            <span className="promax-overview-project-copy"><strong>{project.title}</strong><small>{rows.length} 个会话{latest === undefined ? ' · 尚未开始' : ` · 最近：${latest.blank ? '新会话' : latest.displayTitle}`}</small></span>
            <span className="promax-overview-project-open">进入项目 <Icon name="chevronRight" size={13} /></span>
          </button>
        })}</div>}
    </section>

    <section className="promax-overview-flow" aria-label="使用流程">
      <div><span>1</span><p><strong>新建项目</strong><small>建立独立工作目录</small></p></div>
      <i aria-hidden="true" />
      <div><span>2</span><p><strong>新建会话</strong><small>锁定当前团队 Revision</small></p></div>
      <i aria-hidden="true" />
      <div><span>3</span><p><strong>开始协作</strong><small>在会话里输入任务</small></p></div>
    </section>
  </main>
}

function WorkbenchContent({ team, workspace, session, taskKey, snapshot, progress, availability, onArtifactClick }: { team: PromaxTeam; workspace: WorkspaceView; session: SessionSummary | undefined; taskKey: string | undefined; snapshot: NativeConversationSnapshot | undefined; progress: TeamProgressView; availability: TeamAvailabilityView; onArtifactClick(row: ArtifactProgress, state: DeliverableState): void }) {
  const summary = deliverableSummary(progress.artifacts)
  const percent = summary.involved === 0 ? 0 : Math.round(summary.ready / summary.involved * 100)
  const running = progress.evidence === 'running'
  const timeline = timelineEventsOf(team, snapshot)
  return <div className="workspace-content">
    <div className="workspace-head"><div><div className="workspace-kicker">团队工作台 · {running ? '进行中' : summary.ready > 0 ? '待验收' : '尚未开始'}</div><h1 className="workspace-title">{session?.displayTitle || workspace.title}</h1><p className="workspace-description">主智能体协调，7 名成员按固定职责执行；8 项能力产物按生成、判定两段展示。</p></div><div className="workspace-meta"><span className="meta-chip"><span className="status-dot" />7 Members</span>{taskKey === undefined ? null : <span className="meta-chip"><Icon name="folder" size={14} />deliverables/{taskKey}/</span>}<span className={`meta-chip team-availability--${availability.tone}`} role="status" aria-atomic="true"><Icon name="activity" size={15} />{availability.label}</span></div></div>
    <article className="task-card"><div className="task-card-head"><div><div className="task-label">当前目标</div><div className="task-goal">{session?.displayTitle || `为「${workspace.title}」启动一项产品任务`}</div></div><div className="task-percent">{percent}%</div></div><div className="progress-track" role="progressbar" aria-label="产物判定进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div className="progress-value" style={{ width: `${percent}%` }} /></div><div className="task-card-footer"><span className="coordinator-avatar">主</span><span className="coordinator-copy">{running ? '主智能体正在协调成员并等待稳定回执。' : '主智能体会先理解目标，再拆分任务并完成终审。'}</span><button className="run-button" type="button" onClick={() => { document.querySelector<HTMLTextAreaElement>('[data-promax-composer] textarea')?.focus() }}><Icon name="activity" size={14} />{session === undefined ? '描述任务' : '继续执行'}</button></div></article>
    <div className="section-bar"><div className="section-name">关键事件</div><div className="section-meta">{timeline.length} EVENTS</div></div>
    <CompactTimeline events={timeline} />
    <div className="section-bar"><div className="section-name">团队成员</div><div className="section-meta">7 MEMBERS</div></div>
    <div className="agent-grid">{team.members.filter(member => member.enabled).map(member => { const state = memberExecutionStateOf(member, progress); return <article className={`agent-card is-${state}`} key={member.memberId}><div className="agent-card-top"><div className="agent-avatar">{member.displayName.slice(0, 2)}</div><div><div className="agent-name">{member.displayName}</div><div className="agent-role">{member.memberId}</div></div></div><div className="agent-task">{member.objective}</div><div className="agent-footer"><span className="agent-state-dot" /><span>{state === 'done' ? '已完成' : state === 'blocked' ? '已阻断' : state === 'running' ? '运行中' : '尚未开始'}</span></div></article> })}</div>
    <div className="section-bar"><div className="section-name">交付物</div><div className="section-meta">{summary.ready} / {summary.involved} 就绪{summary.optionalMissing > 0 ? ` · ${summary.optionalMissing} 项可选未产出` : ''}</div></div>
    <section className="deliverable-card" aria-label="业务产物"><div className="file-grid">{progress.artifacts.map(row => { const state = deliverableStateOf(row); return <button className={`file-item${state === 'ready' ? ' is-ready' : ''}${state === 'optional-missing' ? ' is-optional-missing' : ''}`} type="button" key={row.artifact.relativePath} onClick={() => { onArtifactClick(row, state) }}><Icon name="artifact" size={18} /><span className="file-copy"><span className="file-name">{row.label}</span><span className="file-meta">{fileMeta(state)}</span></span></button> })}</div></section>
  </div>
}

function DeliverablesContent({ workspace, taskKey, progress }: { workspace: WorkspaceView; taskKey: string | undefined; progress: TeamProgressView }) {
  const summary = deliverableSummary(progress.artifacts)
  const outputRoot = taskKey === undefined ? '发送首条任务后建立会话目录' : `deliverables/${taskKey}/`
  return <div className="workspace-content"><div className="workspace-head"><div><div className="workspace-kicker">DELIVERABLES</div><h1 className="workspace-title">任务交付物</h1><p className="workspace-description">每个会话使用独立产出目录：{outputRoot}；Judge 报告位于同名 `.promax/judge/` 目录，不计入 8 份业务产物。</p></div><div className="workspace-meta"><span className="meta-chip">{summary.ready} / {summary.involved} 就绪</span></div></div><div className="section-bar"><div className="section-name">本次会话</div><div className="section-meta">{taskKey ?? workspace.title}</div></div><div className="files-overview">{progress.artifacts.map(row => { const state = deliverableStateOf(row); return <article className={`big-file${state === 'optional-missing' ? ' is-optional-missing' : ''}`} key={row.artifact.relativePath}><div className="big-file-icon"><Icon name="artifact" size={20} /></div><div className="big-file-name">{row.label}</div><div className="big-file-meta">{artifactPathForTask(row.artifact, taskKey) ?? row.artifact.relativePath}</div><div className="big-file-status">{fileMeta(state)}</div></article> })}</div></div>
}

type WorkbenchTab = Exclude<ComposerHostView, 'draft'>

/** Frame-wide Promax chrome; it keeps dsh's conversation mounted under the task-trace tab. */
export function PromaxWorkspaceOverlay(props: PromaxShellRuntimeProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaceState = props.useWorkspaces(state => state)
  const sessionState = props.useSessions(state => state)
  const [tab, setTab] = useState<WorkbenchTab>('workbench')
  const [handoffSessionId, setHandoffSessionId] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<number | undefined>(undefined)
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedContext = teamState.selected
  const productTeam = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const productProjects = productTeam === undefined ? [] : workspacesForTeam(productTeam, workspaceState.items)
  const team = selectedContext.kind === 'team' ? teamState.teams.find(item => item.id === selectedContext.teamId) : undefined
  const workspace = team === undefined || selectedContext.kind !== 'team' ? undefined : workspacesForTeam(team, workspaceState.items).find(item => item.workspaceId === selectedContext.workspaceId)
  const sessionId = selectedContext.kind === 'team' && selectedContext.view === 'session' ? selectedContext.sessionId ?? sessionState.current : undefined
  const session = sessionId === undefined ? undefined : sessionState.byId[sessionId]
  const taskKey = sessionId === undefined ? undefined : bindingForSession(teamState, sessionId)?.taskKey
  const snapshot = useTeamSessionProgress(sessionId)
  const progress = useMemo(() => team === undefined ? undefined : teamProgressOf(team, snapshot), [snapshot, team])
  const tree = teamSessionTreeOf(sessionId, sessionState)
  const availability = teamAvailabilityOf(snapshot, session, tree)

  useEffect(() => { setTab('workbench') }, [teamState.selected.kind, selectedContext.kind === 'team' ? selectedContext.workspaceId : undefined])
  useEffect(() => () => { if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current) }, [])
  useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: unknown }>).detail
      if (typeof detail?.sessionId === 'string') setHandoffSessionId(detail.sessionId)
    }
    window.addEventListener('promax:handoff-request', listener)
    return () => { window.removeEventListener('promax:handoff-request', listener) }
  }, [])
  useEffect(() => {
    if (selectedContext.kind === 'team' && selectedContext.view === 'home' && sessionState.current !== undefined) props.clearSession()
  }, [props, selectedContext, sessionState.current])
  const activate = (next: WorkbenchTab): void => { setTab(next); if (scrollRef.current !== null) scrollRef.current.scrollTop = 0 }
  const notify = (message: string): void => {
    setToastMessage(message)
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => { setToastMessage(null) }, 2200)
  }

  if (team === undefined || progress === undefined) {
    const current = sessionState.current === undefined ? undefined : sessionState.byId[sessionState.current]
    const empty = current === undefined || current.blank === true
    return <><div className={`promax-draft-chrome${empty ? ' promax-draft-chrome--empty' : ''}`}><header className="topbar"><button className="promax-workbench-icon-button mobile-sidebar-button" type="button" aria-label="展开导航" aria-controls="promax-navigation-panel" aria-expanded="false" title="展开导航" onClick={props.layout.toggleSidebar}><Icon name="panelRight" size={18} /></button><div className="topbar-title-wrap"><div className="topbar-kicker">PROMAX / 草稿</div><div className="topbar-title">草稿</div></div><div className="topbar-actions"><button className="toolbar-button" type="button" onClick={() => { window.dispatchEvent(new Event('promax:open-preferences')) }}><Icon name="settings" size={15} /><span className="button-label">设置</span></button>{props.detailsOpen === false ? <button className="toolbar-button" type="button" aria-label="展开状态栏" aria-controls="promax-status-panel" aria-expanded="false" title="展开状态栏" onClick={props.layout.openDetails}><Icon name="panelRight" size={15} /><span className="button-label">状态栏</span></button> : null}</div></header>{current === undefined ? <div className="promax-opaque-empty"><EmptyWorkspace title="开始一份草稿" copy="从左侧新建草稿，先把想法聊清楚，再交给产品智能体团队。" /></div> : <DraftStatusBanner sessionId={current.id} />}<PromaxComposerHost view="draft" /></div>{handoffSessionId !== null && productTeam !== undefined ? <TransferDialog sessionId={handoffSessionId} sourceSessionTitle={sessionState.byId[handoffSessionId]?.displayTitle} projects={productProjects} team={productTeam} actions={{ writeDraftHandoff: props.writeDraftHandoff, startSession: props.startSession, openSession: props.openSession, renameSession: props.renameSession, prepareSessionScope: props.prepareSessionScope }} onClose={() => { setHandoffSessionId(null) }} /> : null}</>
  }

  return <>
    <section className={`promax-workbench-layer${tab === 'trace' ? ' promax-workbench-layer--trace' : ''}`} aria-label="产品智能体团队工作区">
      <header className="topbar"><button className="promax-workbench-icon-button mobile-sidebar-button" type="button" aria-label="展开导航" aria-controls="promax-navigation-panel" aria-expanded="false" title="展开导航" onClick={props.layout.toggleSidebar}><Icon name="panelRight" size={18} /></button><div className="topbar-title-wrap"><nav className="topbar-kicker topbar-breadcrumb" aria-label="团队路径"><span>团队 /</span><button type="button" onClick={() => { selectTeamHome(team.id) }}>产品智能体团队</button>{workspace === undefined ? null : <><span>/</span><button type="button" onClick={() => { selectTeamHome(team.id, workspace.workspaceId) }}>{workspace.title}</button></>}</nav><div className="topbar-title">{workspace?.title ?? '产品智能体团队'}</div></div><div className={`team-availability team-availability--${availability.tone}`} role="status" aria-atomic="true"><span className="status-dot" />{availability.label}</div><div className="topbar-actions">{workspace === undefined ? null : <button className="toolbar-button" type="button" onClick={() => { void props.openWorkspacePath(workspace.path) }}><Icon name="folder" size={15} /><span className="button-label">打开工作区</span></button>}<button className="toolbar-button" type="button" onClick={() => { window.dispatchEvent(new Event('promax:open-preferences')) }}><Icon name="settings" size={15} /><span className="button-label">团队设置</span></button>{props.detailsOpen === false ? <button className="toolbar-button" type="button" aria-label="展开状态栏" aria-controls="promax-status-panel" aria-expanded="false" title="展开状态栏" onClick={props.layout.openDetails}><Icon name="panelRight" size={15} /><span className="button-label">状态栏</span></button> : null}</div></header>
      {workspace === undefined
        ? <div className="promax-overview-nav"><Icon name="grid" size={15} /><strong>团队总览</strong><span>项目、会话与团队配置</span></div>
        : <div className="view-tabs" role="tablist" aria-label="产品智能体团队视图">{([['workbench', 'grid', '工作台'], ['trace', 'activity', '任务轨迹'], ['deliverables', 'artifact', '交付物']] as const).map(([id, icon, label]) => <button className="view-tab" type="button" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} key={id} onClick={() => { activate(id) }}><Icon name={icon} size={15} />{label}</button>)}</div>}
      <div ref={scrollRef} className="main-scroll">
        {workspace === undefined ? <TeamOverviewDashboard team={team} teamState={teamState} workspaces={workspaceState.items} sessionState={sessionState} archivedSessionIds={workspaceState.archivedSessionIds} onOpenProject={project => { selectTeamHome(team.id, project.workspaceId); props.clearSession() }} /> : tab === 'workbench' ? <WorkbenchContent team={team} workspace={workspace} session={session} taskKey={taskKey} snapshot={snapshot} progress={progress} availability={availability} onArtifactClick={(row, state) => {
          if (state !== 'ready') { notify(state === 'optional-missing' ? `${row.label} 未产出` : `${row.label} 仍在生成中`); return }
          void props.openWorkspacePath(workspace.path).then(() => { notify(`${row.label} 已打开`) })
        }} /> : tab === 'deliverables' ? <DeliverablesContent workspace={workspace} taskKey={taskKey} progress={progress} /> : sessionId === undefined ? <EmptyWorkspace title="还没有任务轨迹" copy="先在下方描述任务；启动团队会话后，这里显示 dsh 对话流、工具调用与审批面板。" /> : null}
      </div>
      {workspace === undefined ? null : <PromaxComposerHost view={tab} />}
    </section>
    {sessionId === undefined ? <aside className="promax-overlay-right-sidebar" id="promax-status-panel"><div className="right-header"><div><div className="right-kicker">PROMAX</div><div className="right-title">状态与结果</div></div><button className="promax-workbench-icon-button" type="button" aria-label="收起状态栏" aria-controls="promax-status-panel" aria-expanded="true" title="收起状态栏" onClick={props.layout.closeDetails}><Icon name="panelRight" size={17} /></button></div><div className="right-scroll"><TeamStatusContent team={team} progress={progress} /></div></aside> : null}
    {createPortal(<div className={`toast${toastMessage === null ? '' : ' show'}`} role="status" aria-live="polite" aria-atomic="true"><span className="toast-icon"><Icon name="check" size={16} /></span><span>{toastMessage ?? '操作已完成'}</span></div>, document.body)}
  </>
}
