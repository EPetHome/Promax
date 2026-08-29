import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '../components/icons.tsx'
import { installPromaxConsoleStyles } from '../styles.ts'
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
  openSession: (sessionId: string) => void
  clearSession: () => void
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
  if (team === undefined) return { title: '项目组会话', rows: [] }
  const projects = workspacesForTeam(team, workspaces)
  const workspace = projects.find(project => project.workspaceId === selected.workspaceId) ?? projects[0]
  return {
    title: workspace?.title ?? '项目组',
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
  onOpen,
}: {
  session: SessionSummary
  current: boolean
  revision?: TeamRevisionNumber
  onOpen: () => void
}) {
  return (
    <button type="button" className="promax-session-row" aria-current={current ? 'page' : undefined} onClick={onOpen}>
      <span className="promax-session-row-copy">
        <span className="promax-session-row-title">{session.blank ? '新草稿' : session.displayTitle}</span>
        {revision === undefined ? null : <small>{revisionLabel(revision)}</small>}
      </span>
      <span
        className={`promax-session-indicator${session.running ? ' promax-session-indicator--running' : ''}${session.completed ? ' promax-session-indicator--done' : ''}`}
        aria-label={session.running ? '执行中' : session.completed ? '已完成' : '空闲'}
      />
    </button>
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
        <header><div><span className="promax-eyebrow">草稿记录</span><h2 id="promax-first-draft-heading">Promax 会同步整理交底草稿</h2><p>默认开启。对话仍在草稿区进行；达到三轮后可把整理结果和原始对话一起交给产品智能体团队。</p></div></header>
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
    if (projectName === '') { setError('请填写项目组名称'); return }
    setError(null)
    void onCreate({ projectName, ...(parentPath === undefined ? {} : { parentPath }) }).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return createPortal(
    <div className="promax-team-create-backdrop">
      <section className="promax-team-create-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-create-project-heading">
        <header><div><span className="promax-eyebrow">产品智能体团队 / 项目组</span><h2 id="promax-create-project-heading">新建项目组</h2><p>只需要一个名称，Promax 会创建标准目录。</p></div><button type="button" className="promax-icon-button" aria-label="关闭新建项目组" disabled={busy} onClick={onCancel}><Icon name="close" size={15} /></button></header>
        <label className="promax-field"><span>项目组名称</span><input ref={inputRef} className="promax-input" value={name} placeholder="例如：云盘项目" disabled={busy} onChange={event => { setName(event.currentTarget.value) }} /></label>
        <div className="promax-create-workspace-note"><Icon name="folder" size={16} /><span><strong>{parentPath === undefined ? `~/Promax/${name.trim() || '项目组名称'}/` : `${parentPath}/${name.trim() || '项目组名称'}/`}</strong><small>包含 输入/草稿、输入/源文件、产出 和 .promax 管理目录。</small></span></div>
        <button type="button" className="promax-link-button" aria-expanded={advanced} onClick={() => { setAdvanced(value => !value) }}>高级：自定义目录</button>
        {advanced ? <div className="promax-custom-path"><span>{parentPath ?? '尚未选择，仍使用默认目录'}</span><button type="button" className="promax-button" disabled={busy} onClick={() => { void onPickDirectory().then(path => { if (path !== null) setParentPath(path) }) }}>选择目录</button></div> : null}
        {error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}
        <footer><button type="button" className="promax-button" disabled={busy} onClick={onCancel}>取消</button><button type="button" className="promax-button promax-button--primary" disabled={busy} onClick={submit}>{busy ? '正在创建…' : '创建项目组'}</button></footer>
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
  const team = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const general = generalWorkspaceOf(workspaceState.items)
  const draftRows = contextRows(
    { ...teamState, selected: { kind: 'general', ...(general === undefined ? {} : { workspaceId: general.workspaceId }) } },
    workspaceState.items,
    sessionState,
    workspaceState.archivedSessionIds,
  ).rows
  const projects = team === undefined ? [] : workspacesForTeam(team, workspaceState.items)

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

  const createProject = async (input: { projectName: string; parentPath?: string }): Promise<void> => {
    if (busy || team === undefined) return
    setBusy(true)
    setError(null)
    try {
      const workspace = await createProjectWorkspace(input)
      attachWorkspace(team.id, workspace.workspaceId)
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
          {draftRows.length === 0 ? <div className="promax-session-empty">还没有草稿</div> : draftRows.map(session => <SessionRow key={session.id} session={session} current={sessionState.current === session.id} onOpen={() => { selectGeneralWorkspace(general?.workspaceId); openSession(session.id) }} />)}
        </div>
      </section>
      <div className="promax-nav-divider" />
      {team === undefined ? null : <section className="promax-nav-section" aria-labelledby="promax-team-heading">
        <button type="button" className="promax-team-root" aria-current={teamState.selected.kind === 'team' ? 'page' : undefined} onClick={() => { selectTeamHome(team.id); clearSession() }}>
          <span className="promax-team-nav-monogram" aria-hidden="true">产</span><span><strong id="promax-team-heading">产品智能体团队</strong><small>配好的固定团队</small></span>
        </button>
        <div className="promax-project-tree">
          <h3>项目组</h3>
          {projects.length === 0 ? <div className="promax-session-empty">还没有项目组</div> : projects.map(project => {
            const rows = sessionsForProject(team, project, teamState, sessionState, workspaceState.archivedSessionIds)
            const selected = teamState.selected.kind === 'team' && teamState.selected.workspaceId === project.workspaceId
            return <div key={project.workspaceId} className="promax-project-node">
              <button type="button" className="promax-project-row" aria-current={selected ? 'page' : undefined} onClick={() => { selectTeamHome(team.id, project.workspaceId); clearSession() }}><Icon name="folder" size={14} /><span>{project.title}</span><small>{rows.length}</small></button>
              <div className="promax-project-sessions">{rows.map(session => { const revision = revisionForSession(teamState, team, session); return <SessionRow key={session.id} session={session} current={sessionState.current === session.id} {...revision === undefined ? {} : { revision }} onOpen={() => { selectTeamSession(team.id, session.id, project.workspaceId); openSession(session.id) }} /> })}</div>
            </div>
          })}
          <button type="button" className="promax-project-create" onClick={() => { setProjectCreateOpen(true) }}><Icon name="plus" size={13} />新建项目组</button>
        </div>
      </section>}
      {workspaceState.state === 'error' ? <div className="promax-session-error">工作区读取失败</div> : null}
      {error === null ? null : <div className="promax-session-error" role="alert">{error}</div>}
      {firstNoticeOpen ? <FirstDraftNotice onCancel={() => { setFirstNoticeOpen(false) }} onContinue={() => { markDraftNoticeSeen(); setFirstNoticeOpen(false); startNewDraft() }} /> : null}
      {projectCreateOpen ? <ProjectCreateDialog busy={busy} onCancel={() => { if (!busy) setProjectCreateOpen(false) }} onPickDirectory={pickProjectDirectory} onCreate={createProject} /> : null}
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

function stageNativeTeamPrompt(sessionId: string, text: string, targetMemberIds: readonly string[]): void {
  const prompt = routedTeamPrompt(text, targetMemberIds)
  if (prompt === '') return
  nativeTeamPromptHandoffs.set(sessionId, prompt)
  nativeTeamPromptVersion += 1
  for (const listener of nativeTeamPromptListeners) listener()
}

interface NativeConversationSnapshot {
  nodes: readonly unknown[]
  turnTimings: ReadonlyMap<number, { startTime: number; endTime?: number }>
  running: boolean
}

type NativeSessionHook = <Selected>(selector: (state: NativeConversationSnapshot) => Selected) => Selected

type ProgressState = 'pending' | 'running' | 'done' | 'blocked' | 'unverified'

interface ArtifactProgress {
  artifact: TeamArtifactDefinition
  label: string
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
  return /judge|判定/iu.test(`${member.memberId} ${member.displayName} ${member.objective}`)
}

function businessArtifacts(team: PromaxTeam): TeamArtifactDefinition[] {
  const businessOwners = new Set(team.members.filter(member => !isJudgeMember(member)).map(member => member.memberId))
  return team.artifacts.filter(artifact => businessOwners.has(artifact.producedBy))
}

function artifactLabel(artifact: TeamArtifactDefinition): string {
  return artifact.relativePath.split('/').at(-1)?.replaceAll('{task_key}', '任务') ?? artifact.relativePath
}

/** Conservative runtime projection: no check mark is emitted without matching session evidence. */
export function teamProgressOf(team: PromaxTeam, snapshot: NativeConversationSnapshot | undefined): TeamProgressView {
  const artifacts = businessArtifacts(team)
  if (snapshot === undefined || snapshot.nodes.length === 0) {
    return {
      understanding: 'pending', splitting: 'pending', delivery: 'pending', evidence: 'not-started',
      artifacts: artifacts.map(artifact => ({ artifact, label: artifactLabel(artifact), generation: 'pending', judgment: 'pending' })),
    }
  }
  const text = textFromNodes(snapshot.nodes)
  const hasAssistant = snapshot.nodes.some(node => typeof node === 'object' && node !== null && (node as Record<string, unknown>).kind === 'assistant')
  const businessRouted = team.members.some(member => !isJudgeMember(member) && text.includes(member.memberId))
  const judgeRouted = team.members.some(member => isJudgeMember(member) && text.includes(member.memberId))
  const receipt = /Judge判定\s*[：:]|稳定回执字段|修复轮次\s*[：:]/iu.test(text)
  const judgePassed = /Judge判定\s*[：:]\s*(?:通过|pass(?:ed)?)/iu.test(text)
  const judgeBlocked = /Judge判定\s*[：:]\s*(?:未通过|退回|失败|fail(?:ed)?|阻断)/iu.test(text)
  const generationReceipt = /产物\s*[：:]/u.test(text)
  const artifactRows = artifacts.map(artifact => {
    const basename = artifact.relativePath.split('/').at(-1) ?? artifact.relativePath
    const mentioned = text.includes(artifact.relativePath) || text.includes(basename)
    const generation: ProgressState = generationReceipt && mentioned
      ? 'done'
      : snapshot.running && mentioned ? 'running' : hasAssistant ? 'unverified' : 'pending'
    const judgment: ProgressState = generation === 'done' && judgePassed
      ? 'done'
      : generation === 'done' && judgeBlocked ? 'blocked' : snapshot.running && judgeRouted ? 'running' : hasAssistant ? 'unverified' : 'pending'
    return { artifact, label: artifactLabel(artifact), generation, judgment }
  })
  return {
    understanding: hasAssistant ? 'done' : snapshot.running ? 'running' : 'unverified',
    splitting: businessRouted ? 'done' : snapshot.running ? 'running' : 'unverified',
    delivery: judgePassed ? 'done' : judgeBlocked ? 'blocked' : snapshot.running && judgeRouted ? 'running' : receipt ? 'unverified' : 'pending',
    artifacts: artifactRows,
    evidence: receipt ? 'receipt' : snapshot.running ? 'running' : 'unverified',
  }
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
  const draftState = useDraftState()
  const team = teamForSession(state, sessionId)
  const menuOpen = useSyncExternalStore(menu.subscribe, () => menu.getSnapshot().open, () => false)
  const launcherName = useSyncExternalStore(launcher.subscribe, () => launcher.getSnapshot(), () => null)
  const handoffVersion = useSyncExternalStore(subscribeNativeTeamPrompts, nativeTeamPromptSnapshot, () => 0)
  const expanded = menuOpen && launcherName === 'promax-team-member'
  const wasExpanded = useRef(false)
  const [enableOpen, setEnableOpen] = useState(false)
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

  if (team === undefined) {
    const turns = draftUserTurnCount(sessionId)
    const tracking = draftState.enabled && draftSessionView(sessionId).tracking !== 'off'
    return <div className="promax-draft-composer-actions">
      {!tracking ? <span className="promax-tracking-warning"><strong>未记录交底</strong><button type="button" onClick={() => { if (turns > 0) setEnableOpen(true); else enableDraftTracking(sessionId, 'now') }}>开启</button></span> : null}
      {turns >= 3 ? <button type="button" className="promax-handoff-button" onClick={() => { window.dispatchEvent(new CustomEvent('promax:handoff-request', { detail: { sessionId } })) }}>交给团队 →</button> : null}
      {enableOpen ? <TrackingEnableDialog sessionId={sessionId} onClose={() => { setEnableOpen(false) }} /> : null}
    </div>
  }
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
    {open ? createPortal(<div className="promax-members-layer"><button type="button" className="promax-members-scrim" aria-label="关闭项目文件" onClick={close} /><aside className="promax-members-drawer promax-files-drawer" aria-label={`${workspace?.title ?? team.name}项目文件`}><header><div><span className="promax-eyebrow">项目组目录</span><h2>{workspace?.title ?? '尚未选择项目组'}</h2><p>{workspace?.path ?? '请先从常驻导航选择项目组'}</p></div><button ref={closeRef} type="button" className="promax-icon-button" aria-label="关闭项目文件抽屉" onClick={close}><Icon name="close" size={15} /></button></header><div className="promax-file-tree"><section><strong><Icon name="folder" size={14} />输入/</strong><span>草稿/ · 源文件/（团队只读）</span></section><section><strong><Icon name="folder" size={14} />产出/</strong><small>现役 r2 实际产物路径：deliverables/{'{task_key}'}/</small>{progress.artifacts.length === 0 ? <p>运行时团队定义尚未同步产物清单。</p> : <ul>{progress.artifacts.map(row => <li key={row.artifact.relativePath}><span><Icon name="artifact" size={13} /><span><strong>{row.label}</strong><small>{row.artifact.relativePath}</small></span></span><ProgressMark state={row.judgment} label={row.judgment === 'done' ? '已通过' : row.judgment === 'blocked' ? '未通过' : row.judgment === 'running' ? '判定中' : row.judgment === 'unverified' ? '未验证' : '未判定'} /></li>)}</ul>}</section></div>{error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}<footer className="promax-files-footer"><span>状态来自当前会话证据；没有 Judge 回执时不显示通过。</span><button type="button" className="promax-button" disabled={workspace === undefined} onClick={openProject}>打开项目目录</button></footer></aside></div>, document.body) : null}
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

function TeamSessionToolbar({ team, workspace, sessionId, session, clearSession, openWorkspacePath }: { team: PromaxTeam; workspace: WorkspaceView | undefined; sessionId: string | undefined; session: SessionSummary | undefined; clearSession: WorkspaceShellActions['clearSession']; openWorkspacePath: WorkspaceShellActions['openWorkspacePath'] }) {
  const snapshot = useTeamSessionProgress(sessionId)
  const progress = teamProgressOf(team, snapshot)
  const running = snapshot?.running ?? session?.running ?? false
  const goTeam = (): void => { selectTeamHome(team.id); clearSession() }
  const goProject = (): void => { selectTeamHome(team.id, workspace?.workspaceId); clearSession() }
  return <header className="promax-team-session-toolbar" aria-label="团队会话导航">
    <div className="promax-native-team-header">
      <nav className="promax-native-breadcrumb" aria-label="团队会话层级"><button type="button" onClick={goTeam}>{team.name}</button><span aria-hidden="true">/</span><button type="button" onClick={goProject}>{workspace?.title ?? '项目组'}</button></nav>
      <span className="promax-native-room-context" title={`${team.name} · ${team.activeRevision?.presetId ?? '未配置'}`}>
        <span className="promax-room-mark" aria-hidden="true">P</span><span className="promax-native-room-copy"><strong>{team.coordinator.displayName}</strong><small>统筹 · {team.members.filter(member => member.enabled).length} 名成员</small></span><span className={`promax-native-room-state${running ? ' promax-native-room-state--running' : ''}`}>{running ? '处理中' : '可用'}</span>
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

function TeamHome({ team, workspace, startSession, openSession, clearSession, openWorkspacePath }: { team: PromaxTeam; workspace: WorkspaceView | undefined; startSession: WorkspaceShellActions['startSession']; openSession: WorkspaceShellActions['openSession']; clearSession: WorkspaceShellActions['clearSession']; openWorkspacePath: WorkspaceShellActions['openWorkspacePath'] }) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = team.activeRevision
  const send = (): void => {
    if (workspace === undefined || revision === undefined || draft.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    void startSession(workspace.workspaceId, revision.presetId).then(sessionId => {
      bindTeamSession({ sessionId, teamId: team.id, revision: revision.revision, presetId: revision.presetId, workspaceId: workspace.workspaceId })
      stageNativeTeamPrompt(sessionId, draft.trim(), [])
      selectTeamSession(team.id, sessionId, workspace.workspaceId)
      openSession(sessionId)
    }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
  }
  return <main className="promax-team-home" aria-label={`${team.name}项目组界面`}>
    <section className="promax-team-home-main">
      <header className="promax-team-home-header">
        <div className="promax-team-identity">
          <span className="promax-team-identity-mark" aria-hidden="true">产</span>
          <div className="promax-team-identity-copy">
            <nav className="promax-team-breadcrumb" aria-label="团队层级">
              <button type="button" aria-label={`返回${team.name}`} onClick={() => { selectTeamHome(team.id); clearSession() }}>{team.name}</button>
              {workspace === undefined ? null : <><span aria-hidden="true">/</span><button type="button" aria-label={`当前项目组：${workspace.title}`} onClick={() => { selectTeamHome(team.id, workspace.workspaceId); clearSession() }}>{workspace.title}</button></>}
            </nav>
            <div className="promax-team-title-line"><h1>{workspace?.title ?? '选择项目组'}</h1><span className="promax-team-state promax-team-state--published">团队已配置</span></div>
            <p className="promax-team-mission">{team.description}</p>
            <p className="promax-team-meta">{team.coordinator.displayName}统筹 · {team.members.filter(member => member.enabled).length} 名成员</p>
          </div>
        </div>
        <div className="promax-team-home-actions"><TeamFilesButton team={team} workspace={workspace} progress={teamProgressOf(team, undefined)} openWorkspacePath={openWorkspacePath} /><TeamMembersButton team={team} /><button type="button" className="promax-button" disabled={workspace === undefined} onClick={() => { if (workspace !== undefined) void openWorkspacePath(workspace.path).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }) }}><Icon name="folder" size={15} />打开项目目录</button></div>
      </header>
      <div className="promax-team-interaction"><div className="promax-team-prompt-block"><div className="promax-room-intro"><span className="promax-room-sequence" aria-hidden="true">01</span><div><span className="promax-eyebrow">新任务</span><h2>{workspace === undefined ? '请新建或选择项目组' : `把目标交给 ${team.name}`}</h2><p>{workspace === undefined ? '使用常驻导航中的项目组树进入工作区。' : '团队配置固定；任务和产物都隔离在当前项目组。'}</p></div></div><textarea className="promax-team-prompt" value={draft} disabled={workspace === undefined || busy} placeholder="描述要交给产品团队的任务……" onChange={event => { setDraft(event.currentTarget.value) }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send() } }} /><div className="promax-team-prompt-actions"><span>{workspace?.path ?? '尚未选择项目组'}</span><button type="button" className="promax-button promax-button--primary" disabled={workspace === undefined || busy || draft.trim() === ''} onClick={send}>{busy ? '正在发送…' : '发送给团队'}</button></div></div></div>
      {error === null ? null : <div className="promax-team-page-error" role="alert">{error}</div>}
    </section>
  </main>
}

function TransferDialog({ sessionId, projects, team, actions, onClose }: { sessionId: string; projects: WorkspaceView[]; team: PromaxTeam; actions: Pick<WorkspaceShellActions, 'writeDraftHandoff' | 'startSession' | 'openSession'>; onClose: () => void }) {
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
    void actions.writeDraftHandoff({ workspaceId: workspace.workspaceId, projectPath: workspace.path, handoff: handoff.trim(), transcript: transcriptMarkdown(sessionId) }).then(() => actions.startSession(workspace.workspaceId, revision.presetId)).then(teamSessionId => {
      bindTeamSession({ sessionId: teamSessionId, teamId: team.id, revision: revision.revision, presetId: revision.presetId, workspaceId: workspace.workspaceId })
      stageNativeTeamPrompt(teamSessionId, handoff.trim(), [])
      selectTeamSession(team.id, teamSessionId, workspace.workspaceId)
      actions.openSession(teamSessionId)
      onClose()
    }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false) })
  }
  return createPortal(<div className="promax-team-create-backdrop"><section className="promax-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="promax-transfer-heading"><header><div><span className="promax-eyebrow">草稿 → 产品智能体团队</span><h2 id="promax-transfer-heading">交给团队</h2><p>选择项目组，检查四段交底；确认后会保存交底与原始对话，并启动新的团队会话。</p></div><button type="button" className="promax-icon-button" aria-label="关闭转交" disabled={busy} onClick={onClose}><Icon name="close" size={15} /></button></header>{onsite ? <div className="promax-inline-warning"><strong>交底记录未开启</strong><span>本次会从当前仍可见的对话现场提取，可能遗漏已被压缩的内容。</span></div> : null}{session.compacted ? <div className="promax-inline-warning"><strong>对话发生过压缩</strong><span>请先检查四段交底是否完整，再确认转交。</span></div> : null}<label className="promax-field"><span>目标项目组</span><select ref={selectRef} className="promax-input" value={workspaceId} disabled={busy} onChange={event => { setWorkspaceId(event.currentTarget.value) }}>{projects.map(project => <option key={project.workspaceId} value={project.workspaceId}>{project.title}</option>)}</select></label>{projects.length === 0 ? <div className="promax-inline-error">还没有项目组，请先通过常驻导航新建项目组。</div> : null}<label className="promax-field"><span>需求交底（可编辑）</span><textarea className="promax-textarea promax-transfer-editor" value={handoff} disabled={busy} onChange={event => { setHandoff(event.currentTarget.value) }} /></label>{error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}<footer><button type="button" className="promax-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="promax-button promax-button--primary" disabled={busy || workspace === undefined || handoff.trim() === ''} onClick={submit}>{busy ? '正在转交…' : '保存并交给团队'}</button></footer></section></div>, document.body)
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

export function PromaxTeamRail({ useWorkspaces, useSessions, startSession, openSession, clearSession, writeDraftHandoff, openWorkspacePath }: RuntimeProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaceState = useWorkspaces(state => state)
  const sessionState = useSessions(state => state)
  const [handoffSessionId, setHandoffSessionId] = useState<string | null>(null)
  const team = teamState.teams.find(item => item.id === PRODUCT_TEAM_ID)
  const projects = team === undefined ? [] : workspacesForTeam(team, workspaceState.items)
  const selectedWorkspace = teamState.selected.kind === 'team'
    ? projects.find(project => project.workspaceId === teamState.selected.workspaceId)
    : undefined
  const selectedTeamSessionId = teamState.selected.kind === 'team' && teamState.selected.view === 'session'
    ? teamState.selected.sessionId ?? sessionState.current
    : undefined
  const selectedTeamSession = selectedTeamSessionId === undefined ? undefined : sessionState.byId[selectedTeamSessionId]

  useEffect(() => {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: unknown }>).detail
      if (typeof detail?.sessionId === 'string') setHandoffSessionId(detail.sessionId)
    }
    window.addEventListener('promax:handoff-request', listener)
    return () => { window.removeEventListener('promax:handoff-request', listener) }
  }, [])

  return <div className="promax-shell-layer">
    {team !== undefined && teamState.selected.kind === 'team' && teamState.selected.view === 'home' ? <TeamHome team={team} workspace={selectedWorkspace} startSession={startSession} openSession={openSession} clearSession={clearSession} openWorkspacePath={openWorkspacePath} /> : null}
    {team !== undefined && teamState.selected.kind === 'team' && teamState.selected.view === 'session' ? <TeamSessionToolbar team={team} workspace={selectedWorkspace} sessionId={selectedTeamSessionId} session={selectedTeamSession} clearSession={clearSession} openWorkspacePath={openWorkspacePath} /> : null}
    {team !== undefined && teamState.selected.kind === 'team' ? <TeamProgressRail team={team} workspace={selectedWorkspace} sessionId={selectedTeamSessionId} openWorkspacePath={openWorkspacePath} /> : null}
    {teamState.selected.kind === 'general' && sessionState.current !== undefined ? <DraftOutlinePanel sessionId={sessionState.current} /> : null}
    {handoffSessionId !== null && team !== undefined ? <TransferDialog sessionId={handoffSessionId} projects={projects} team={team} actions={{ writeDraftHandoff, startSession, openSession }} onClose={() => { setHandoffSessionId(null) }} /> : null}
  </div>
}
