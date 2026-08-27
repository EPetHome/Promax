import { useEffect, useRef, useState } from 'react'

import { Icon } from '../components/icons.tsx'
import { installPromaxConsoleStyles } from '../styles.ts'
import {
  GENERAL_PRESET_ID,
  PRODUCT_TEAM_ID,
  attachWorkspace,
  createTeam,
  selectGeneralWorkspace,
  selectTeam,
  templateFor,
  useTeamState,
  type PromaxTeam,
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
  openWorkspace: (workspaceId: string, presetId: string) => Promise<void>
  openSession: (sessionId: string) => void
  chooseAndAttachWorkspace: (teamId: string) => Promise<string | null>
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

function contextTitle(state: ReturnType<typeof useTeamState>, workspaces: readonly WorkspaceView[]): string {
  if (state.selected.kind === 'general') return '通用工作区'
  return state.teams.find(team => team.id === state.selected.teamId)?.name ?? '团队'
}

function selectedWorkspaces(state: ReturnType<typeof useTeamState>, workspaces: readonly WorkspaceView[]): WorkspaceView[] {
  if (state.selected.kind === 'general') {
    const general = generalWorkspaceOf(workspaces)
    return general === undefined ? [] : [general]
  }
  const team = state.teams.find(candidate => candidate.id === state.selected.teamId)
  return team === undefined ? [] : workspacesForTeam(team, workspaces)
}

function sessionsIn(workspaceRows: readonly WorkspaceView[], sessions: SessionListState, archived: readonly string[]): SessionSummary[] {
  const hidden = new Set(archived)
  const rows: SessionSummary[] = []
  for (const workspace of workspaceRows) {
    for (const sessionId of workspace.sessionIds) {
      const session = sessions.byId[sessionId]
      if (session !== undefined && !hidden.has(sessionId)) rows.push(session)
    }
  }
  return rows
}

function EmptyHeroSeat() {
  return null
}

export function PromaxSessionBrowser({
  wide = true,
  expandSidebar,
  useWorkspaces,
  useSessions,
  openSession,
}: SidebarProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaceState = useWorkspaces(state => state)
  const sessionState = useSessions(state => state)

  if (!wide) {
    return (
      <button
        type="button"
        className="promax-context-rail-button"
        aria-label="展开团队与会话"
        title="团队与会话"
        onClick={expandSidebar}
      >
        <Icon name="team" size={19} />
      </button>
    )
  }

  const activeWorkspaces = selectedWorkspaces(teamState, workspaceState.items)
  const rows = sessionsIn(activeWorkspaces, sessionState, workspaceState.archivedSessionIds)
  const selectedWorkspace = activeWorkspaces.find(workspace => workspace.workspaceId === teamState.selected.workspaceId)
    ?? activeWorkspaces[0]

  return (
    <nav className="promax-session-browser" aria-label="当前上下文会话">
      <div className="promax-session-browser-heading">
        <div>
          <span className="promax-eyebrow">当前空间</span>
          <strong>{contextTitle(teamState, workspaceState.items)}</strong>
        </div>
        <Icon name={teamState.selected.kind === 'general' ? 'home' : 'team'} size={17} />
      </div>
      {selectedWorkspace !== undefined ? (
        <div className="promax-session-workspace">
          <Icon name="folder" size={15} />
          <span>{selectedWorkspace.title}</span>
        </div>
      ) : null}
      <div className="promax-session-list">
        {workspaceState.state === 'loading' ? <div className="promax-session-empty">正在读取会话…</div> : null}
        {workspaceState.state === 'error' ? <div className="promax-session-error">工作区读取失败</div> : null}
        {workspaceState.state !== 'loading' && rows.length === 0 ? (
          <div className="promax-session-empty">还没有会话</div>
        ) : null}
        {rows.map(session => (
          <button
            key={session.id}
            type="button"
            className="promax-session-row"
            aria-current={sessionState.current === session.id ? 'page' : undefined}
            onClick={() => { openSession(session.id) }}
          >
            <span className="promax-session-row-title">{session.blank ? '新会话' : session.displayTitle}</span>
            <span
              className={`promax-session-indicator${session.running ? ' promax-session-indicator--running' : ''}${session.completed ? ' promax-session-indicator--done' : ''}`}
              aria-label={session.running ? '执行中' : session.completed ? '已完成' : '空闲'}
            />
          </button>
        ))}
      </div>
      <p className="promax-session-browser-foot">其他历史空间已从 Promax 导航隐藏</p>
    </nav>
  )
}

interface TeamPageProps extends RuntimeProps {
  team: PromaxTeam
  workspaces: readonly WorkspaceView[]
  railOpen: boolean
  onClose: () => void
  onAttach: () => void
  busy: boolean
}

function PromaxTeamPage({
  team,
  workspaces,
  railOpen,
  onClose,
  onAttach,
  busy,
  useSessions,
  openWorkspace,
}: TeamPageProps) {
  const sessions = useSessions(state => state)
  const template = templateFor(team)
  const sessionCount = workspaces.reduce((total, workspace) => total + workspace.sessionIds.length, 0)

  return (
    <main className={`promax-team-page${railOpen ? '' : ' promax-team-page--rail-collapsed'}`} aria-label={`${team.name}团队界面`}>
      <header className="promax-team-page-header">
        <div>
          <div className="promax-team-breadcrumb">团队 / {team.name}</div>
          <h1>{team.name}</h1>
          <p>{team.description}</p>
        </div>
        <button type="button" className="promax-button" onClick={onClose}>
          <Icon name="chevronLeft" size={16} />
          返回会话
        </button>
      </header>

      <div className="promax-team-page-body">
        <section className="promax-team-summary" aria-label="团队概况">
          <article><span>工作区</span><strong>{workspaces.length}</strong></article>
          <article><span>Agent 成员</span><strong>{template.members.length}</strong></article>
          <article><span>会话</span><strong>{sessionCount}</strong></article>
        </section>

        <section className="promax-team-section" aria-labelledby="promax-team-workspaces-heading">
          <div className="promax-team-section-heading">
            <div>
              <h2 id="promax-team-workspaces-heading">工作区</h2>
              <p>每个工作区拥有独立目录与会话记录。</p>
            </div>
            <button type="button" className="promax-button" disabled={busy} onClick={onAttach}>
              <Icon name="plus" size={15} />
              添加工作区
            </button>
          </div>
          <div className="promax-team-workspace-grid">
            {workspaces.length === 0 ? (
              <div className="promax-team-empty">尚未划分工作区。添加一个本地目录后即可开始。</div>
            ) : workspaces.map(workspace => {
              const active = workspace.sessionIds.includes(sessions.current ?? '')
              return (
                <article key={workspace.workspaceId} className="promax-team-workspace-card">
                  <div className="promax-team-workspace-icon"><Icon name="folder" size={18} /></div>
                  <div className="promax-team-workspace-copy">
                    <strong>{workspace.title}</strong>
                    <span>{workspace.path}</span>
                  </div>
                  <button
                    type="button"
                    className="promax-button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => { void openWorkspace(workspace.workspaceId, template.presetId) }}
                  >
                    {active ? '当前会话' : '进入工作区'}
                  </button>
                </article>
              )
            })}
          </div>
        </section>

        <section className="promax-team-section" aria-labelledby="promax-team-members-heading">
          <div className="promax-team-section-heading">
            <div>
              <h2 id="promax-team-members-heading">Agent 成员</h2>
              <p>成员来自固定团队模板，界面不从提示词猜测角色。</p>
            </div>
          </div>
          <div className="promax-team-member-grid">
            {template.members.map(member => (
              <article key={member.id} className="promax-team-member-card">
                <div className="promax-team-member-avatar"><Icon name="agent" size={18} /></div>
                <div>
                  <strong>{member.name}</strong>
                  <p>{member.role}</p>
                  <code>{member.id}</code>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

export function PromaxTeamRail({
  useWorkspaces,
  useSessions,
  openWorkspace,
  openSession,
  chooseAndAttachWorkspace,
}: RuntimeProps) {
  useEffect(() => installPromaxConsoleStyles(), [])
  const teamState = useTeamState()
  const workspaces = useWorkspaces(state => state.items)
  const [railOpen, setRailOpen] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [teamPageId, setTeamPageId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const createInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (createOpen) createInput.current?.focus()
  }, [createOpen])

  const selectedTeam = teamState.selected.kind === 'team'
    ? teamState.teams.find(team => team.id === teamState.selected.teamId)
    : undefined
  const pageTeam = teamState.teams.find(team => team.id === teamPageId)
  const pageWorkspaces = pageTeam === undefined ? [] : workspacesForTeam(pageTeam, workspaces)
  const general = generalWorkspaceOf(workspaces)

  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const openGeneral = (): void => {
    selectGeneralWorkspace(general?.workspaceId)
    setTeamPageId(null)
    if (general !== undefined) {
      void run(async () => { await openWorkspace(general.workspaceId, GENERAL_PRESET_ID) })
    }
  }

  const openTeamWorkspace = (team: PromaxTeam, workspace: WorkspaceView): void => {
    selectTeam(team.id, workspace.workspaceId)
    setTeamPageId(null)
    void run(async () => { await openWorkspace(workspace.workspaceId, templateFor(team).presetId) })
  }

  const attachToTeam = (team: PromaxTeam): void => {
    void run(async () => {
      const workspaceId = await chooseAndAttachWorkspace(team.id)
      if (workspaceId === null) return
      attachWorkspace(team.id, workspaceId)
    })
  }

  const saveTeam = (): void => {
    try {
      const team = createTeam(teamName)
      setTeamName('')
      setCreateOpen(false)
      setTeamPageId(team.id)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <>
      {pageTeam !== undefined ? (
        <PromaxTeamPage
          team={pageTeam}
          workspaces={pageWorkspaces}
          railOpen={railOpen}
          onClose={() => { setTeamPageId(null) }}
          onAttach={() => { attachToTeam(pageTeam) }}
          busy={busy}
          useWorkspaces={useWorkspaces}
          useSessions={useSessions}
          openWorkspace={openWorkspace}
          openSession={openSession}
          chooseAndAttachWorkspace={chooseAndAttachWorkspace}
        />
      ) : null}

      <aside className={`promax-team-rail${railOpen ? ' promax-team-rail--open' : ' promax-team-rail--collapsed'}`} aria-label="团队导航">
        {railOpen ? (
          <div className="promax-team-rail-content">
            <header className="promax-team-rail-header">
              <div>
                <span className="promax-eyebrow">Promax</span>
                <h2>团队</h2>
              </div>
              <div className="promax-team-rail-actions">
                <button
                  type="button"
                  className="promax-icon-button"
                  aria-label="创建团队"
                  aria-expanded={createOpen}
                  onClick={() => { setCreateOpen(value => !value) }}
                >
                  <Icon name="plus" size={16} />
                </button>
                <button type="button" className="promax-icon-button" aria-label="收起团队导航" onClick={() => { setRailOpen(false) }}>
                  <Icon name="panelRight" size={17} />
                </button>
              </div>
            </header>

            {createOpen ? (
              <form className="promax-team-create" onSubmit={(event) => { event.preventDefault(); saveTeam() }}>
                <label htmlFor="promax-team-name">团队名称</label>
                <input
                  ref={createInput}
                  id="promax-team-name"
                  className="promax-input"
                  value={teamName}
                  placeholder="例如：增长团队"
                  onChange={event => { setTeamName(event.currentTarget.value) }}
                />
                <div>
                  <button type="button" className="promax-button" onClick={() => { setCreateOpen(false); setTeamName('') }}>取消</button>
                  <button type="submit" className="promax-button promax-button--primary">创建</button>
                </div>
              </form>
            ) : null}

            <nav className="promax-team-nav" aria-label="空间与团队">
              <button
                type="button"
                className="promax-team-nav-row"
                aria-current={teamState.selected.kind === 'general' ? 'page' : undefined}
                onClick={openGeneral}
              >
                <span className="promax-team-nav-icon"><Icon name="home" size={17} /></span>
                <span><strong>通用工作区</strong><small>日常问答与文件任务</small></span>
              </button>

              <div className="promax-team-nav-label">Agent 团队</div>
              {teamState.teams.map(team => {
                const teamWorkspaces = workspacesForTeam(team, workspaces)
                const selected = selectedTeam?.id === team.id
                return (
                  <section key={team.id} className="promax-team-group">
                    <button
                      type="button"
                      className="promax-team-nav-row"
                      aria-current={selected ? 'page' : undefined}
                      onClick={() => {
                        selectTeam(team.id, teamWorkspaces[0]?.workspaceId)
                        setTeamPageId(team.id)
                      }}
                    >
                      <span className="promax-team-nav-icon"><Icon name="team" size={17} /></span>
                      <span><strong>{team.name}</strong><small>{teamWorkspaces.length} 个工作区</small></span>
                      <Icon name="chevronRight" size={14} />
                    </button>
                    {selected ? (
                      <div className="promax-team-workspace-list">
                        <button type="button" onClick={() => { setTeamPageId(team.id) }}>
                          <Icon name="grid" size={14} />
                          团队主页
                        </button>
                        {teamWorkspaces.map(workspace => (
                          <button
                            key={workspace.workspaceId}
                            type="button"
                            aria-current={teamState.selected.workspaceId === workspace.workspaceId ? 'page' : undefined}
                            onClick={() => { openTeamWorkspace(team, workspace) }}
                          >
                            <Icon name="folder" size={14} />
                            <span>{workspace.title}</span>
                          </button>
                        ))}
                        <button type="button" disabled={busy} onClick={() => { attachToTeam(team) }}>
                          <Icon name="plus" size={14} />
                          添加工作区
                        </button>
                      </div>
                    ) : null}
                  </section>
                )
              })}
            </nav>

            {error !== null ? <div className="promax-team-rail-error" role="alert">{error}</div> : null}
            <footer className="promax-team-rail-foot">
              <span>{busy ? '正在处理…' : '团队决定 Agent，工作区决定文件边界'}</span>
            </footer>
          </div>
        ) : (
          <button
            type="button"
            className="promax-team-rail-toggle"
            aria-label="展开团队导航"
            onClick={() => { setRailOpen(true) }}
          >
            <Icon name="team" size={19} />
            <span>团队</span>
          </button>
        )}
      </aside>
    </>
  )
}

export { EmptyHeroSeat }
