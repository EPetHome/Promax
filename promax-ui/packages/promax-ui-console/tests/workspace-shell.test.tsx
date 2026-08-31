import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PromaxProcessAction,
  PromaxComposerBar,
  PromaxComposerHost,
  PromaxLeftSidebar,
  PromaxSessionBrowser,
  PromaxTeamMentionControl,
  PromaxTeamRail,
  PromaxTeamSessionHeader,
  PromaxWorkspaceOverlay,
  deliverableSummary,
  memberExecutionStateOf,
  teamAvailabilityOf,
  teamProgressOf,
  teamSessionTreeOf,
  timelineEventsOf,
  sessionScopedTeamPrompt,
  type SessionListState,
  type WorkspaceListState,
  type WorkspaceShellActions,
} from '../src/client/PromaxWorkspaceShell.tsx'
import { resetDraftStateForTests } from '../src/client/draft-state.ts'
import { PRODUCT_PRESET_ID, PRODUCT_TEAM_ID, PRODUCT_TEAM_REVISION, bindTeamSession, readTeamState, resetTeamStateForTests, runtimeTeamRosterOf, selectTeamHome, selectTeamSession, syncProductTeamRuntimeRoster } from '../src/client/team-state.ts'
import { PROMAX_WORKBENCH_CSS } from '../src/workbench-styles.ts'

const workspaceState: WorkspaceListState = {
  items: [
    { workspaceId: 'general', title: '草稿', path: '/tmp/general', sessionIds: ['general-session'] },
    { workspaceId: 'product', title: '产品', path: '/tmp/Promax/产品', sessionIds: ['product-session'] },
    { workspaceId: 'internal', title: '内部测试', path: '/tmp/internal', sessionIds: ['internal-session'] },
  ],
  archivedSessionIds: [],
  state: 'idle',
  error: null,
}

const sessionState: SessionListState = {
  ids: ['general-session', 'product-session', 'internal-session'],
  byId: {
    'general-session': { id: 'general-session', displayTitle: '需求想法', agentPreset: 'general', running: false, blank: false, updatedAt: 3 },
    'product-session': { id: 'product-session', displayTitle: '产品方案', agentPreset: PRODUCT_PRESET_ID, running: false, completed: true, blank: false, updatedAt: 2 },
    'internal-session': { id: 'internal-session', displayTitle: 'smoke 残留', agentPreset: 'smoke', running: false, blank: false, updatedAt: 1 },
  },
  current: undefined,
  phase: 'ready',
}

function useWorkspaces<Selected>(selector: (state: WorkspaceListState) => Selected): Selected { return selector(workspaceState) }
function useSessions<Selected>(selector: (state: SessionListState) => Selected): Selected { return selector(sessionState) }

function actions(overrides: Partial<WorkspaceShellActions> = {}): WorkspaceShellActions {
  return {
    startSession: vi.fn(async () => 'new-session'),
    openSession: vi.fn(),
    clearSession: vi.fn(),
    archiveSession: vi.fn(async () => {}),
    renameSession: vi.fn(async () => {}),
    prepareSessionScope: vi.fn(async input => ({ sessionName: input.sessionName, taskKey: input.sessionName, relativePath: `deliverables/${input.sessionName}` })),
    createProjectWorkspace: vi.fn(async input => ({ workspaceId: 'project-new', title: input.projectName, path: `${input.parentPath ?? '/Users/test/Promax'}/${input.projectName}`, sessionIds: [] })),
    pickProjectDirectory: vi.fn(async () => '/tmp/custom'),
    writeDraftHandoff: vi.fn(async () => ({ handoffPath: '/tmp/handoff.md', transcriptPath: '/tmp/transcript.md' })),
    openWorkspacePath: vi.fn(async () => {}),
    teamRoutingAvailable: true,
    ...overrides,
  }
}

const closedMenuStore = { getSnapshot: () => ({ open: false }), subscribe: () => () => {} }
const closedLauncherStore = { getSnapshot: () => null, subscribe: () => () => {} }

function FirstPromptHarness({ shellActions, setDraft, submit, initialDraft = '' }: { shellActions: WorkspaceShellActions; setDraft: (text: string) => void; submit: () => void; initialDraft?: string }) {
  return <>
    <PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />
    <PromaxTeamMentionControl sessionId="new-session" input={{ draft: initialDraft, draftRev: 0, phase: 'plain', occurrences: [] }} inputActions={{ setDraft, submit }} menu={closedMenuStore} launcher={closedLauncherStore} toggleTeamMention={vi.fn()} />
  </>
}

describe('Promax draft, fixed team, and project shell', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetTeamStateForTests()
    resetDraftStateForTests()
    sessionState.current = undefined
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('exposes only drafts and the fixed product team/project hierarchy', () => {
    render(<PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} />)
    expect(screen.getByRole('button', { name: '新建草稿' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '草稿' })).toBeVisible()
    expect(screen.getByText('需求想法')).toBeVisible()
    expect(screen.getByText('产品智能体团队')).toBeVisible()
    expect(screen.getByRole('heading', { name: '项目' })).toBeVisible()
    const teamRow = screen.getByText('产品智能体团队').closest<HTMLElement>('.promax-team-root-row')!
    expect(within(teamRow).getByRole('button', { name: '新建项目' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '项目' }).parentElement).not.toContainElement(screen.getByRole('button', { name: '新建项目' }))
    expect(screen.getByRole('heading', { name: '产品', level: 4 })).toBeVisible()
    expect(screen.getByRole('button', { name: '产品' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '在 产品 中新建会话' })).toBeVisible()
    expect(screen.queryByText('1 个会话')).not.toBeInTheDocument()
    expect(screen.getByText('产品方案')).toBeVisible()
    expect(screen.queryByText('smoke 残留')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建团队' })).not.toBeInTheDocument()
    expect(screen.queryByText('团队设置')).not.toBeInTheDocument()
  })

  it('uses the team root as an overview and only exposes the composer after entering a project', () => {
    selectTeamHome(PRODUCT_TEAM_ID)
    const shellActions = actions()
    const layout = { toggleSidebar: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn() }
    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)

    expect(screen.getByRole('heading', { name: '团队总览', level: 1 })).toBeVisible()
    expect(screen.getByLabelText('团队关键数据')).toBeVisible()
    expect(screen.getByRole('button', { name: '打开项目 产品' })).toBeVisible()
    expect(screen.queryByRole('tablist', { name: '产品智能体团队视图' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-promax-composer-host]')).toBeNull()
    expect(screen.queryByRole('button', { name: '打开工作区' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开项目 产品' }))
    expect(screen.getByRole('heading', { name: '产品', level: 1 })).toBeVisible()
    expect(screen.getByRole('tablist', { name: '产品智能体团队视图' })).toBeVisible()
    expect(document.querySelector('[data-promax-composer-host]')).not.toBeNull()
  })

  it('shows the one-time tracking notice before the first draft', async () => {
    const shellActions = actions()
    render(<PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />)
    fireEvent.click(screen.getByRole('button', { name: '新建草稿' }))
    expect(screen.getByRole('heading', { name: 'Promax 会同步整理交底草稿' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '知道了，开始草稿' }))
    await waitFor(() => { expect(shellActions.startSession).toHaveBeenCalledWith('general', 'general') })
  })

  it('creates a named project with the default path unless an advanced parent is selected', async () => {
    const createProjectWorkspace = vi.fn(async (input: { projectName: string; parentPath?: string }) => ({ workspaceId: 'cloud', title: input.projectName, path: `${input.parentPath ?? '/Users/test/Promax'}/${input.projectName}`, sessionIds: [] }))
    const shellActions = actions({ createProjectWorkspace })
    render(<PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />)
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }))
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '云盘项目' } })
    expect(screen.getByText('~/Promax/云盘项目/')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
    await waitFor(() => { expect(createProjectWorkspace).toHaveBeenCalledWith({ projectName: '云盘项目' }) })
  })

  it('keeps projects as collapsible groups and creates a blank r7 session inside the project', async () => {
    const shellActions = actions()
    render(<PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />)
    const projectHeading = screen.getByRole('heading', { name: '产品', level: 4 })
    const project = projectHeading.closest<HTMLElement>('.promax-project-node')!
    const projectRow = within(project).getByRole('button', { name: '产品' })

    expect(projectRow).toHaveAttribute('aria-expanded', 'true')
    expect(projectRow).not.toHaveAttribute('aria-current')
    expect(within(project).getByText('产品方案')).toBeVisible()
    fireEvent.click(projectRow)
    expect(projectRow).toHaveAttribute('aria-expanded', 'false')
    expect(within(project).queryByText('产品方案')).not.toBeInTheDocument()
    expect(shellActions.clearSession).not.toHaveBeenCalled()
    expect(shellActions.openSession).not.toHaveBeenCalled()

    fireEvent.click(projectRow)
    fireEvent.click(within(project).getByRole('button', { name: '在 产品 中新建会话' }))
    await waitFor(() => { expect(shellActions.startSession).toHaveBeenCalledWith('product', PRODUCT_PRESET_ID) })
    expect(shellActions.openSession).toHaveBeenCalledWith('new-session')
    expect(readTeamState().sessionBindings).toContainEqual(expect.objectContaining({
      sessionId: 'new-session',
      teamId: PRODUCT_TEAM_ID,
      presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product',
    }))
  })

  it('deletes a session through its ellipsis menu after confirmation', async () => {
    const archiveSession = vi.fn(async () => {})
    const shellActions = actions({ archiveSession })
    sessionState.current = 'product-session'
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    render(<PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />)

    fireEvent.click(screen.getByRole('button', { name: '会话操作：产品方案' }))
    expect(screen.getByRole('menu', { name: '产品方案会话操作' })).toBeVisible()
    expect(shellActions.openSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: '删除会话' }))

    const dialog = screen.getByRole('dialog', { name: '删除会话？' })
    expect(within(dialog).getByText(/会话记录仍保留在本机归档中/)).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: '删除会话' }))

    await waitFor(() => { expect(archiveSession).toHaveBeenCalledWith('product-session') })
    expect(shellActions.clearSession).toHaveBeenCalledTimes(1)
    expect(readTeamState().selected).toEqual(expect.objectContaining({ kind: 'team', view: 'home', workspaceId: 'product' }))
    expect(screen.getByRole('status')).toHaveTextContent('已删除会话“产品方案”')
  })

  it('opens a dedicated project-team home without exposing team editing', () => {
    selectTeamHome(PRODUCT_TEAM_ID, 'product')
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} />)
    expect(screen.getByRole('main', { name: '产品智能体团队项目界面' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '产品', level: 1 })).toBeVisible()
    expect(screen.getByText('团队已配置')).toBeVisible()
    expect(screen.queryByText('团队设置')).not.toBeInTheDocument()
    expect(screen.queryByText('模板导入')).not.toBeInTheDocument()
  })

  it('renders the runtime-defined result tree with honest empty states and opens both top drawers', () => {
    syncProductTeamRuntimeRoster(runtimeTeamRosterOf(`
      ## 已发布团队快照
      - team revision：\`team-mtcjsbcz-04tpe2@r7\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r7\`
      成员：
      - \`solution_design\`（产品需求方案智能体）：生成并验证 PRD。
      - \`quality_judge\`（独立 Judge）：独立判定最终产物。
      ## 稳定消息路由
      文件责任：
      - \`deliverables/{task_key}/prd.md\`：solution_design
      - \`.promax/judge/{task_key}/judge.md\`：quality_judge
      稳定回执字段（按顺序）：\`状态\`、\`产物\`、\`Judge判定\`
    `))
    selectTeamHome(PRODUCT_TEAM_ID, 'product')
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} />)

    expect(screen.getByRole('complementary', { name: '团队进度' })).toBeVisible()
    expect(screen.getByText('当前会话 0 turn：尚未开始')).toBeVisible()
    expect(screen.getByText('生成·尚未生成')).toBeVisible()
    expect(screen.getByText('判定·未判定')).toBeVisible()
    expect(screen.getByRole('button', { name: '成员·2' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    expect(screen.getByRole('complementary', { name: '产品项目文件' })).toBeVisible()
    expect(screen.getByText('deliverables/{task_key}/prd.md')).toBeVisible()
    expect(screen.getByText('未判定')).toBeVisible()
  })

  it('makes both native team-session breadcrumb levels actionable', () => {
    bindTeamSession({ sessionId: 'product-session', teamId: PRODUCT_TEAM_ID, revision: PRODUCT_TEAM_REVISION, presetId: PRODUCT_PRESET_ID, workspaceId: 'product' })
    const clearSession = vi.fn()
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions({ clearSession })} />)

    const breadcrumb = screen.getByRole('navigation', { name: '团队会话层级' })
    fireEvent.click(within(breadcrumb).getByRole('button', { name: '产品' }))
    expect(clearSession).toHaveBeenCalledTimes(1)
    act(() => { selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product') })
    const reopenedBreadcrumb = screen.getByRole('navigation', { name: '团队会话层级' })
    fireEvent.click(within(reopenedBreadcrumb).getByRole('button', { name: '产品智能体团队' }))
    expect(clearSession).toHaveBeenCalledTimes(2)
  })

  it('keeps project names as disclosures and uses sessions for project entry', async () => {
    const shellActions = actions()
    render(<>
      <PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />
      <PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />
    </>)
    const navigation = screen.getByRole('navigation', { name: 'Promax 工作入口' })

    fireEvent.click(screen.getByText('产品智能体团队').closest('button')!)
    expect(screen.getByRole('heading', { name: '选择项目' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Promax 工作入口' })).toBe(navigation)

    const projectRow = screen.getByRole('button', { name: '产品' })
    fireEvent.click(projectRow)
    expect(projectRow).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('heading', { name: '选择项目' })).toBeVisible()
    expect(shellActions.clearSession).toHaveBeenCalledTimes(1)

    fireEvent.click(projectRow)
    fireEvent.click(within(projectRow.closest<HTMLElement>('.promax-project-node')!).getByRole('button', { name: /^产品方案Revision 7 已完成$/ }))
    expect(screen.getByRole('navigation', { name: '团队会话层级' })).toBeVisible()
    fireEvent.click(within(screen.getByRole('navigation', { name: '团队会话层级' })).getByRole('button', { name: '产品' }))
    expect(screen.getByRole('heading', { name: '产品', level: 1 })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '返回产品智能体团队' }))
    expect(screen.getByRole('heading', { name: '选择项目' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Promax 工作入口' })).toBe(navigation)

    fireEvent.click(screen.getByRole('button', { name: '新建草稿' }))
    fireEvent.click(screen.getByRole('button', { name: '知道了，开始草稿' }))
    await waitFor(() => { expect(shellActions.startSession).toHaveBeenCalledWith('general', 'general') })
    expect(screen.getByRole('navigation', { name: 'Promax 工作入口' })).toBe(navigation)
  })

  it('wakes an already-mounted native composer after staging the first team prompt', async () => {
    selectTeamHome(PRODUCT_TEAM_ID, 'product')
    const shellActions = actions()
    const setDraft = vi.fn()
    const submit = vi.fn()
    render(<FirstPromptHarness shellActions={shellActions} setDraft={setDraft} submit={submit} />)
    fireEvent.change(screen.getByPlaceholderText(/描述要交给产品团队的任务/u), { target: { value: '生成产品方案' } })
    fireEvent.click(screen.getByRole('button', { name: '发送给团队' }))
    await waitFor(() => { expect(setDraft).toHaveBeenCalledWith(sessionScopedTeamPrompt('生成产品方案', [], '生成产品方案', '生成产品方案')) })
    expect(shellActions.prepareSessionScope).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'new-session', sessionName: '生成产品方案' }))
    expect(shellActions.renameSession).toHaveBeenCalledWith('new-session', '生成产品方案')
    expect(submit).toHaveBeenCalledTimes(1)
    expect(shellActions.openSession).toHaveBeenCalledTimes(1)
    expect(shellActions.openSession).toHaveBeenCalledWith('new-session')
  })

  it('drops a staged prompt instead of submitting it later when the native composer is already non-empty', async () => {
    selectTeamHome(PRODUCT_TEAM_ID, 'product')
    const shellActions = actions()
    const setDraft = vi.fn()
    const submit = vi.fn()
    render(<FirstPromptHarness shellActions={shellActions} setDraft={setDraft} submit={submit} initialDraft="用户已有输入" />)
    fireEvent.change(screen.getByPlaceholderText(/描述要交给产品团队的任务/u), { target: { value: '不应延迟提交' } })
    fireEvent.click(screen.getByRole('button', { name: '发送给团队' }))
    await waitFor(() => { expect(shellActions.openSession).toHaveBeenCalledWith('new-session') })
    expect(setDraft).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('always exposes the draft handoff action before content exists', () => {
    sessionState.current = 'general-session'
    render(<PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} layout={{ toggleSidebar: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn() }} detailsOpen />)
    expect(screen.getByLabelText('草稿运行边界')).toHaveTextContent('先发送至少一条草稿内容，即可交给团队')
    expect(screen.getByRole('button', { name: '交给团队' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '交给团队' })).toHaveAttribute('title', '先在当前草稿中发送至少一条内容')
  })

  it('offers transfer after one draft message, passes saved input paths, and starts a new team session', async () => {
    sessionState.current = 'general-session'
    const writeDraftHandoff = vi.fn(async () => ({ handoffPath: '/tmp/需求交底.md', transcriptPath: '/tmp/原始对话.md' }))
    const shellActions = actions({ writeDraftHandoff, startSession: vi.fn(async () => 'handoff-team-session') })
    const setDraft = vi.fn()
    const submit = vi.fn()
    const nativeSnapshot = {
      nodes: [
        { kind: 'user', seq: 1, content: [{ type: 'text', text: '做一个云盘方案' }] },
        { kind: 'assistant', messageId: 'a1', turn: 1, blocks: [{ kind: 'text', text: '先确认范围' }] },
      ],
      turnTimings: new Map<number, { startTime: number; endTime?: number }>(),
      running: false,
    }
    const useSession = <Selected,>(selector: (state: typeof nativeSnapshot) => Selected): Selected => selector(nativeSnapshot)
    render(<>
      <PromaxTeamSessionHeader sessionId="general-session" useSession={useSession} />
      <PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={{ toggleSidebar: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn() }} detailsOpen />
      <PromaxTeamMentionControl sessionId="handoff-team-session" input={{ draft: '', draftRev: 0, phase: 'plain', occurrences: [] }} inputActions={{ setDraft, submit }} menu={closedMenuStore} launcher={closedLauncherStore} toggleTeamMention={vi.fn()} />
    </>)
    await waitFor(() => { expect(screen.getByRole('button', { name: /交给团队/u })).toBeVisible() })
    expect(screen.getByLabelText('草稿运行边界')).toHaveTextContent('草稿不会调用产品团队成员，也不能直接 @')
    expect(screen.queryByRole('button', { name: '指定团队成员' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /交给团队/u }))
    expect(screen.getByRole('heading', { name: '交给团队' })).toBeVisible()
    expect((screen.getByLabelText('需求交底（可编辑）') as HTMLTextAreaElement).value).toContain('## 还没定的')
    fireEvent.click(screen.getByRole('button', { name: '保存并交给团队' }))
    await waitFor(() => { expect(writeDraftHandoff).toHaveBeenCalledTimes(1) })
    expect(writeDraftHandoff).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'product',
      projectPath: '/tmp/Promax/产品',
      handoff: expect.stringContaining('## 要解决什么') as string,
      transcript: expect.stringContaining('先确认范围') as string,
    }))
    expect(shellActions.startSession).toHaveBeenCalledWith('product', PRODUCT_PRESET_ID)
    await waitFor(() => { expect(setDraft).toHaveBeenCalled() })
    const stagedPrompt = String(setDraft.mock.calls.at(-1)?.[0] ?? '')
    expect(stagedPrompt).toContain('需求交底：/tmp/需求交底.md')
    expect(stagedPrompt).toContain('原始对话：/tmp/原始对话.md')
    expect(stagedPrompt).toContain('## 本次交底')
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('keeps the stable team header and safe per-turn process summary', () => {
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const nativeSnapshot = {
      nodes: [{ kind: 'assistant', messageId: 'message-1', turn: 3, blocks: [{ kind: 'tool-call' }, { kind: 'text', text: '完成' }] }],
      turnTimings: new Map([[3, { startTime: 1_000, endTime: 3_500 }]]),
      running: false,
    }
    const useSession = <Selected,>(selector: (state: typeof nativeSnapshot) => Selected): Selected => selector(nativeSnapshot)
    render(<><PromaxTeamSessionHeader sessionId="product-session" useSession={useSession} /><PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} /><PromaxProcessAction sessionId="product-session" messageId="message-1" useSession={useSession} /></>)
    expect(screen.getByText('产品智能体团队')).toBeVisible()
    fireEvent.click(screen.getByText('处理过程'))
    expect(screen.getByText('成员/工具调用：1 项')).toBeVisible()
    expect(screen.getByText(/耗时 2.5 秒/u)).toBeVisible()
  })

  it('counts six required artifacts and adds optional artifacts only when involved', () => {
    const artifact = (relativePath: string) => ({
      artifact: { relativePath, producedBy: 'solution_design', required: !/(?:business-diagram\.md|prototype\.html)$/u.test(relativePath) },
      label: relativePath,
      involved: !/(?:business-diagram\.md|prototype\.html)$/u.test(relativePath),
      generation: 'pending' as const,
      judgment: 'pending' as const,
    })
    const rows = [
      artifact('deliverables/task/prd.md'),
      artifact('deliverables/task/business-diagram.md'),
      artifact('deliverables/task/prototype.html'),
      ...Array.from({ length: 5 }, (_, index) => artifact(`deliverables/task/required-${index}.md`)),
    ]
    expect(deliverableSummary(rows)).toEqual({ ready: 0, involved: 6, optionalMissing: 2 })
    rows[1]!.involved = true
    expect(deliverableSummary(rows)).toEqual({ ready: 0, involved: 7, optionalMissing: 1 })
  })

  it('derives the team availability pill from the native session snapshot', () => {
    const session = { id: 'product-session', displayTitle: '产品方案', running: false, blank: false, updatedAt: 1 }
    const base = { nodes: [], turnTimings: new Map<number, { startTime: number; endTime?: number }>(), running: false, openState: 'open' }
    expect(teamAvailabilityOf(base, session)).toEqual({ label: '团队待命', tone: 'idle' })
    expect(teamAvailabilityOf({ ...base, pending: [{}] }, session)).toEqual({ label: '等待确认', tone: 'warning' })
    expect(teamAvailabilityOf({ ...base, runningCalls: [{ name: 'write' }] }, session)).toEqual({ label: '团队运行中', tone: 'active' })
    expect(teamAvailabilityOf({ ...base, lastAgentError: 'failed' }, session)).toEqual({ label: '团队异常', tone: 'error' })
    expect(teamAvailabilityOf(undefined, undefined)).toEqual({ label: '尚未启动', tone: 'warning' })
  })

  it('treats a running nested subagent as team activity even when the parent is idle', () => {
    const sessions: SessionListState = {
      ids: ['product-session', 'worker-1', 'worker-2'],
      byId: {
        'product-session': { id: 'product-session', displayTitle: '产品方案', running: false, blank: false, updatedAt: 1 },
        'worker-1': { id: 'worker-1', displayTitle: '客研', parentId: 'product-session', origin: 'subagent', running: false, blank: false, updatedAt: 2 },
        'worker-2': { id: 'worker-2', displayTitle: '资料核对', parentId: 'worker-1', origin: 'subagent', running: true, blank: false, updatedAt: 3 },
      },
      current: 'product-session',
      phase: 'ready',
    }
    const tree = teamSessionTreeOf('product-session', sessions)
    expect(tree).toEqual({
      descendantCount: 2,
      pendingDescendantCount: 0,
      runningDescendants: [{ sessionId: 'worker-2', parentSessionId: 'worker-1' }],
    })
    const parent = sessions.byId['product-session']
    const snapshot = { nodes: [], turnTimings: new Map<number, { startTime: number; endTime?: number }>(), running: false, openState: 'open' }
    expect(teamAvailabilityOf(snapshot, parent, tree)).toEqual({ label: '团队运行中', tone: 'active' })
  })

  it('summarizes only runtime-backed key events and keeps the list compact', () => {
    syncProductTeamRuntimeRoster(runtimeTeamRosterOf(`
      ## 已发布团队快照
      - team revision：\`team-mtcjsbcz-04tpe2@r7\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r7\`
      成员：
      - \`solution_design\`（产品需求方案智能体）：生成产品方案。
      - \`quality_judge\`（独立 Judge）：独立判定。
      ## 稳定消息路由
      文件责任：
      - \`deliverables/{task_key}/prd.md\`：solution_design
      - \`.promax/judge/{task_key}/judge.md\`：quality_judge
      稳定回执字段（按顺序）：\`状态\`、\`产物\`、\`Judge判定\`
    `))
    const team = readTeamState().teams[0]!
    const events = timelineEventsOf(team, {
      nodes: [
        { kind: 'user', seq: 1, content: [{ type: 'text', text: '生成 PRD' }] },
        { kind: 'assistant', messageId: 'a1', turn: 1, blocks: [{ kind: 'text', text: '已路由 solution_design' }] },
        { kind: 'assistant', messageId: 'a2', turn: 2, blocks: [{ kind: 'text', text: '产物 deliverables/task-1/prd.md' }] },
        { kind: 'assistant', messageId: 'a3', turn: 3, blocks: [{ kind: 'text', text: '产物 .promax/judge/task-1/judge.md\nJudge判定：pass' }] },
      ],
      turnTimings: new Map([
        [1, { startTime: 1_000, endTime: 2_000 }],
        [2, { startTime: 3_000, endTime: 4_000 }],
        [3, { startTime: 5_000, endTime: 6_000 }],
      ]),
      running: false,
    })
    expect(events).toHaveLength(3)
    expect(events.map(event => event.title)).toEqual([
      '任务已路由给 1 名成员',
      '第 2 轮任务路径已出现',
      '独立 Judge 完成判定',
    ])
    expect(events[1]).toEqual(expect.objectContaining({ tone: 'active', copy: expect.stringContaining('不等同于已经生成或判定') }))
    expect(timelineEventsOf(team, undefined)).toEqual([expect.objectContaining({ title: '尚未开始', tone: 'idle' })])
  })

  it('keeps panel toggles discoverable and exposes their reversible state', () => {
    const toggleSidebar = vi.fn()
    const openDetails = vi.fn()
    const closeDetails = vi.fn()
    const shellActions = actions()
    const layout = { toggleSidebar, openDetails, closeDetails }
    const { unmount } = render(<PromaxLeftSidebar useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} />)
    const collapseNavigation = screen.getByRole('button', { name: '收起 Promax 导航' })
    expect(collapseNavigation).toHaveAttribute('aria-controls', 'promax-navigation-panel')
    expect(collapseNavigation).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapseNavigation)
    expect(toggleSidebar).toHaveBeenCalledOnce()
    unmount()

    render(<div className="app-shell left-collapsed"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen={false} /></div>)
    const expandNavigation = screen.getByRole('button', { name: '展开导航' })
    expect(expandNavigation).toHaveAttribute('aria-controls', 'promax-navigation-panel')
    expect(expandNavigation).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expandNavigation)
    expect(toggleSidebar).toHaveBeenCalledTimes(2)
    const expandStatus = screen.getByRole('button', { name: '展开状态栏' })
    expect(expandStatus).toHaveAttribute('aria-controls', 'promax-status-panel')
    expect(expandStatus).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(expandStatus)
    expect(openDetails).toHaveBeenCalledOnce()
  })

  it('ports the retained composer into the layout seat and shows dsh telemetry only in task trace', async () => {
    const input = { draft: '', draftRev: 0, phase: 'plain' as const }
    const useInput = <Selected,>(selector: (state: typeof input) => Selected): Selected => selector(input)
    const renderComposer = (view: 'workbench' | 'trace' | 'deliverables') => <div className="app-shell">
      <PromaxComposerHost view={view} />
      <div data-native-composer-seat><PromaxComposerBar sessionId="product-session" useInput={useInput} inputActions={{ setDraft: vi.fn(), submit: vi.fn() }} footer={<div>dsh telemetry footer</div>} /></div>
    </div>
    const { rerender } = render(renderComposer('workbench'))
    await waitFor(() => { expect(document.querySelector('[data-promax-composer-host] [data-promax-composer]')).not.toBeNull() })
    expect(document.querySelector('[data-native-composer-seat] [data-promax-composer]')).toBeNull()
    expect(screen.queryByText('dsh telemetry footer')).not.toBeInTheDocument()

    rerender(renderComposer('trace'))
    await waitFor(() => { expect(screen.getByText('dsh telemetry footer')).toBeVisible() })
    expect(document.querySelector('[data-promax-composer-host] [data-promax-composer]')).not.toBeNull()

    rerender(renderComposer('deliverables'))
    await waitFor(() => { expect(screen.queryByText('dsh telemetry footer')).not.toBeInTheDocument() })
  })

  it('advertises the exact supported image formats and renders one member trigger', () => {
    const input = { draft: '', draftRev: 0, phase: 'plain' as const }
    const useInput = <Selected,>(selector: (state: typeof input) => Selected): Selected => selector(input)
    render(<PromaxComposerBar
      sessionId="product-session"
      useInput={useInput}
      inputActions={{ setDraft: vi.fn(), submit: vi.fn() }}
      leftItems={<button type="button" aria-label="指定团队成员">@</button>}
    />)

    const picker = document.querySelector<HTMLInputElement>('.promax-file-input')
    expect(picker).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif')
    const attachment = screen.getByRole('button', { name: '添加图片（支持 PNG、JPG、WebP、GIF 图片）' })
    expect(attachment).toHaveAttribute('title', '支持 PNG、JPG、WebP、GIF 图片')
    expect(screen.getByRole('tooltip')).toHaveTextContent('支持 PNG、JPG、WebP、GIF 图片')
    expect(screen.getAllByRole('button', { name: '指定团队成员' })).toHaveLength(1)
  })

  it('opens a real member picker before the first team session and routes the selected stable member', async () => {
    syncProductTeamRuntimeRoster(runtimeTeamRosterOf(`
      ## 已发布团队快照
      - team revision：\`team-mtcjsbcz-04tpe2@r7\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r7\`
      成员：
      - \`solution_design\`（产品需求方案智能体）：生成并验证 PRD。
      - \`quality_judge\`（独立 Judge）：独立判定最终产物。
      ## 稳定消息路由
      文件责任：
      - \`deliverables/{task_key}/prd.md\`：solution_design
      - \`.promax/judge/{task_key}/judge.md\`：quality_judge
      稳定回执字段（按顺序）：\`状态\`、\`产物\`、\`Judge判定\`
    `))
    selectTeamHome(PRODUCT_TEAM_ID, 'product')
    const shellActions = actions({ startSession: vi.fn(async () => 'mention-session') })
    const setDraft = vi.fn()
    const submit = vi.fn()
    const useInput = <Selected,>(selector: (state: undefined) => Selected): Selected => selector(undefined)
    render(<>
      <PromaxComposerBar useInput={useInput} useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />
      <PromaxTeamMentionControl sessionId="mention-session" input={{ draft: '', draftRev: 0, phase: 'plain', occurrences: [] }} inputActions={{ setDraft, submit }} menu={closedMenuStore} launcher={closedLauncherStore} toggleTeamMention={vi.fn()} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: '指定团队成员' }))
    const member = screen.getByRole('menuitemcheckbox', { name: /产品需求方案智能体/u })
    expect(member).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(member)
    expect(member).toHaveAttribute('aria-checked', 'true')
    fireEvent.change(screen.getByPlaceholderText(/点击 @ 指定团队成员/u), { target: { value: '生成产品方案' } })
    fireEvent.click(screen.getByRole('button', { name: '发送任务' }))

    await waitFor(() => {
      expect(setDraft).toHaveBeenCalledWith(sessionScopedTeamPrompt('生成产品方案', ['solution_design'], '生成产品方案', '生成产品方案'))
    })
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('switches the primary composer action to one-click parent and descendant stop', async () => {
    bindTeamSession({ sessionId: 'product-session', teamId: PRODUCT_TEAM_ID, revision: PRODUCT_TEAM_REVISION, presetId: PRODUCT_PRESET_ID, workspaceId: 'product' })
    const input = { draft: '', draftRev: 0, phase: 'plain' as const }
    const nativeSnapshot = { nodes: [], turnTimings: new Map<number, { startTime: number; endTime?: number }>(), running: false }
    const sessions: SessionListState = {
      ids: ['product-session', 'worker-1'],
      byId: {
        'product-session': { id: 'product-session', displayTitle: '产品方案', running: false, blank: false, updatedAt: 1 },
        'worker-1': { id: 'worker-1', displayTitle: '客研', parentId: 'product-session', origin: 'subagent', running: true, blank: false, updatedAt: 2 },
      },
      current: 'product-session',
      phase: 'ready',
    }
    const stop = vi.fn()
    const stopTeamDescendants = vi.fn(async () => {})
    render(<PromaxComposerBar
      sessionId="product-session"
      useInput={selector => selector(input)}
      useSession={selector => selector(nativeSnapshot)}
      useSessions={selector => selector(sessions)}
      inputActions={{ setDraft: vi.fn(), submit: vi.fn() }}
      stop={stop}
      stopTeamDescendants={stopTeamDescendants}
    />)

    const button = screen.getByRole('button', { name: '停止团队任务' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => {
      expect(stopTeamDescendants).toHaveBeenCalledWith([{ sessionId: 'worker-1', parentSessionId: 'product-session' }])
    expect(stop).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByRole('button', { name: '正在停止团队任务' })).toBeDisabled()
  })

  it('keeps the composer in normal layout flow without a guessed scroll clearance', () => {
    expect(PROMAX_WORKBENCH_CSS).toContain('.promax-composer-host')
    expect(PROMAX_WORKBENCH_CSS).not.toContain('position: fixed !important')
    expect(PROMAX_WORKBENCH_CSS).not.toContain('margin-bottom: 96px')
    expect(PROMAX_WORKBENCH_CSS).toMatch(/\.composer-wrap \{ position: relative;/u)
    expect(PROMAX_WORKBENCH_CSS).toContain('.promax-draft-chrome .promax-composer-host { margin-top: auto; }')
  })

  it('keeps independent member presence inside the fixed right rail', () => {
    expect(PROMAX_WORKBENCH_CSS).toMatch(/\.member-list \{[^}]*min-width: 0;/u)
    expect(PROMAX_WORKBENCH_CSS).toMatch(/\.member-item \{[^}]*min-width: 0;/u)
    expect(PROMAX_WORKBENCH_CSS).toMatch(/\.member-copy \{[^}]*flex: 1;/u)
  })

  it('projects only exact current-task artifact paths and accepts the stable flattened Judge receipt', () => {
    syncProductTeamRuntimeRoster(runtimeTeamRosterOf(`
      ## 已发布团队快照
      - team revision：\`team-mtcjsbcz-04tpe2@r7\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r7\`
      成员：
      - \`customer_research\`（客研管理智能体）：只基于协调者明确列出的客户研究材料，生成可追溯、可判定且不外推样本边界的客户研究报告。
      - \`product_discovery\`（产品探索智能体）：生成探索产物。
      - \`requirement_management\`（需求管理智能体）：生成需求管理产物。
      - \`solution_design\`（产品需求方案智能体）：生成并验证 PRD、业务流程图和原型。
      - \`requirement_review\`（需求评审智能体）：生成评审产物。
      - \`user_analysis\`（用户分析智能体）：生成用户分析产物。
      - \`quality_judge\`（独立 Judge）：独立判定最终产物。
      ## 稳定消息路由
      文件责任：
      - \`deliverables/{task_key}/prd.md\`：solution_design
      - \`deliverables/{task_key}/business-diagram.md\`：solution_design
      - \`deliverables/{task_key}/prototype.html\`：solution_design
      - \`deliverables/{task_key}/customer_research.md\`：customer_research
      - \`deliverables/{task_key}/product_discovery.md\`：product_discovery
      - \`deliverables/{task_key}/requirement_management.md\`：requirement_management
      - \`deliverables/{task_key}/requirement_review.md\`：requirement_review
      - \`deliverables/{task_key}/user_analysis.md\`：user_analysis
      - \`.promax/judge/{task_key}/judge.md\`：quality_judge
      稳定回执字段（按顺序）：\`状态\`、\`产物\`、\`Judge判定\`
    `))
    const team = readTeamState().teams[0]!
    const progress = teamProgressOf(team, {
      nodes: [{
        kind: 'assistant',
        blocks: [{ kind: 'text', text: `
          团队定义包含 prd.md、business-diagram.md、prototype.html、customer_research.md 等文件名。
          状态 完成
          产物 deliverables/cp3-gui-r3-20260830/prd.md
          | 产物 | \`deliverables/cp3-gui-r3-20260830/prd.md\`；\`.promax/judge/cp3-gui-r3-20260830/judge.md\` |
          | Judge判定 | **pass**（round 1，通用 5/5 + 领域 3/3） |
        ` }],
      }],
      turnTimings: new Map(),
      running: false,
    })
    const byPath = new Map(progress.artifacts.map(row => [row.artifact.relativePath, row]))
    expect(progress.artifacts).toHaveLength(8)
    expect(byPath.get('deliverables/{task_key}/prd.md')).toMatchObject({ generation: 'done', judgment: 'done' })
    expect(byPath.get('deliverables/{task_key}/business-diagram.md')).toMatchObject({ generation: 'unverified', judgment: 'unverified' })
    expect(byPath.get('deliverables/{task_key}/prototype.html')).toMatchObject({ generation: 'unverified', judgment: 'unverified' })
    expect(byPath.get('deliverables/{task_key}/customer_research.md')).toMatchObject({ generation: 'unverified', judgment: 'unverified' })
    expect(progress.delivery).toBe('done')
    expect(progress.evidence).toBe('receipt')
    expect(deliverableSummary(progress.artifacts)).toEqual({ ready: 1, involved: 6, optionalMissing: 2 })
    expect(memberExecutionStateOf(team.members.find(member => member.memberId === 'solution_design')!, progress)).toBe('done')
    expect(memberExecutionStateOf(team.members.find(member => member.memberId === 'quality_judge')!, progress)).toBe('done')

    const judging = teamProgressOf(team, {
      nodes: [{ kind: 'assistant', blocks: [{ kind: 'text', text: 'quality_judge 正在检查 deliverables/task-2/prd.md' }] }],
      turnTimings: new Map(),
      running: true,
    })
    const judgingByPath = new Map(judging.artifacts.map(row => [row.artifact.relativePath, row]))
    expect(judgingByPath.get('deliverables/{task_key}/prd.md')?.judgment).toBe('running')
    expect(judgingByPath.get('deliverables/{task_key}/customer_research.md')?.judgment).toBe('unverified')
    expect(memberExecutionStateOf(team.members.find(member => member.memberId === 'solution_design')!, judging)).toBe('running')
    expect(memberExecutionStateOf(team.members.find(member => member.memberId === 'customer_research')!, judging)).toBe('idle')
    expect(memberExecutionStateOf(team.members.find(member => member.memberId === 'quality_judge')!, judging)).toBe('running')
  })
})
