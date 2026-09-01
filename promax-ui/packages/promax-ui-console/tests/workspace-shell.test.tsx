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
import { taskRunProjectionOf, type TaskRunFileSnapshot } from '../src/client/task-run-projection.ts'

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
    writeTaskPackage: vi.fn(async (input: Parameters<WorkspaceShellActions['writeTaskPackage']>[0]) => ({
      taskPackagePath: `.promax/tasks/${input.taskKey}/task-package.yml`,
      coveragePath: `.promax/tasks/${input.taskKey}/coverage.yml`,
      slotsPath: `.promax/tasks/${input.taskKey}/slots.yml`,
      inputManifestPath: `.promax/input/${input.taskKey}/manifest.yml`,
      tier: 'single' as const,
      coverageRevision: 1,
      artifactPaths: [`deliverables/${input.taskKey}/prd.md`],
      slots: [],
    })),
    readTaskRunFiles: vi.fn(async (input: Parameters<WorkspaceShellActions['readTaskRunFiles']>[0]) => ({
      taskKey: input.taskKey,
      parentSessionId: input.sessionId,
      cancellation: 'running' as const,
      runEpoch: 1,
      artifactStates: input.artifactPaths.map(path => ({ path, exists: false, nonEmpty: false })),
      judge: { path: `.promax/judge/${input.taskKey}/judge.md`, state: 'absent' as const, exists: false },
      observedAt: new Date().toISOString(),
    })),
    stopTeamTask: vi.fn(async input => ({ state: 'cancelled' as const, runEpoch: input.runEpoch })),
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

  it('keeps projects as collapsible groups and creates a blank current-revision session inside the project', async () => {
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
      - team revision：\`team-mtcjsbcz-04tpe2@r12\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r12\`
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
    fireEvent.click(within(projectRow.closest<HTMLElement>('.promax-project-node')!).getByRole('button', { name: /^产品方案Revision 12 已完成$/ }))
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

  it('confirms four handoff parts, writes only an internal task package, and starts a new blank execution session', async () => {
    sessionState.current = 'general-session'
    syncProductTeamRuntimeRoster(runtimeTeamRosterOf(`
      ## 已发布团队快照
      - team revision：\`team-mtcjsbcz-04tpe2@r12\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r12\`
      成员：
      - \`solution_design\`（产品需求方案智能体）：生成 PRD。
      - \`quality_judge\`（独立 Judge）：独立判定。
      ## 稳定消息路由
      文件责任：
      - \`deliverables/{task_key}/prd.md\`：solution_design
      - \`.promax/judge/{task_key}/judge.md\`：quality_judge
      信息契约：
      - \`solution_design\`：provides=\`goal,scope\`；requires=\`goal\`
      - \`quality_judge\`：provides=\`\`；requires=\`\`
      产物契约：
      - \`deliverables/{task_key}/prd.md\`：required=\`true\`
      - \`.promax/judge/{task_key}/judge.md\`：required=\`true\`
      稳定回执字段（按顺序）：\`状态\`、\`产物\`、\`Judge判定\`
    `))
    let coverageRevision = 0
    const writeTaskPackage = vi.fn(async (input: Parameters<WorkspaceShellActions['writeTaskPackage']>[0]) => ({
      taskPackagePath: `.promax/tasks/${input.taskKey}/task-package.yml`,
      coveragePath: `.promax/tasks/${input.taskKey}/coverage.yml`,
      slotsPath: `.promax/tasks/${input.taskKey}/slots.yml`,
      inputManifestPath: `.promax/input/${input.taskKey}/manifest.yml`,
      tier: 'single' as const,
      coverageRevision: ++coverageRevision,
      artifactPaths: [`deliverables/${input.taskKey}/prd.md`],
      slots: [{ slot_id: 'solution_design', member_id: 'solution_design', label: '产品需求方案智能体', status: 'pending' as const, provides: ['goal' as const], requires: ['goal' as const], satisfied_by: [], missing: [] }],
    }))
    const shellActions = actions({ writeTaskPackage, startSession: vi.fn(async () => 'handoff-team-session') })
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
    expect(screen.getByRole('heading', { name: '确认任务' })).toBeVisible()
    expect((screen.getByLabelText('系统理解的任务') as HTMLTextAreaElement).value).toContain('## 还没定的')
    expect(screen.getByRole('heading', { name: '2. 还缺什么' })).toBeVisible()
    expect(screen.getByText('尚未说明：')).toBeVisible()
    expect(screen.getByRole('heading', { name: '3. 推荐交付结果' })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: /产品需求文档（PRD）.*推荐理由/u })).toBeChecked()
    expect(screen.getByText('推荐理由：任务需要形成产品需求或完整产品方案')).toBeVisible()
    expect(screen.getByRole('heading', { name: '4. 执行计划' })).toBeVisible()
    expect(screen.getByText(/预计由 1 个专业角色协作/u)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '确认并开始' }))
    await waitFor(() => { expect(writeTaskPackage).toHaveBeenCalledTimes(1) })
    expect(writeTaskPackage).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'product',
      projectPath: '/tmp/Promax/产品',
      sessionId: 'handoff-team-session',
      confirmedHandoff: expect.stringContaining('## 已知缺口') as string,
      requestedArtifactPaths: ['deliverables/{task_key}/prd.md'],
      coverageInformationKeys: ['goal'],
    }))
    expect(shellActions.startSession).toHaveBeenCalledWith('product', PRODUCT_PRESET_ID)
    await waitFor(() => { expect(setDraft).toHaveBeenCalled() })
    const stagedPrompt = String(setDraft.mock.calls.at(-1)?.[0] ?? '')
    expect(stagedPrompt).toBe('请读取并执行内部任务包：.promax/tasks/需求想法/task-package.yml')
    expect(stagedPrompt).not.toContain('先确认范围')
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 Members')).toBeVisible()
    expect(screen.getByText('2 MEMBERS')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '修正系统理解' }))
    expect(screen.getByRole('heading', { name: '修正系统理解' })).toBeVisible()
    expect(screen.getByText('当前是第 1 版理解结果')).toBeVisible()
    fireEvent.click(screen.getByText('查看识别依据'))
    const evidenceLocation = screen.getByLabelText('覆盖证据位置')
    expect(within(evidenceLocation).getByText('SRC-001')).toBeVisible()
    expect(within(evidenceLocation).getByText('.promax/input/需求想法/sources/SRC-001/confirmed-handoff.md')).toBeVisible()
    expect(within(evidenceLocation).getByText(/第 1–\d+ 行/u)).toBeVisible()
    expect(screen.getByText('调整后的执行计划 · 1 项最终交付')).toBeVisible()
    fireEvent.click(screen.getByLabelText('目标用户'))
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }))
    await waitFor(() => { expect(writeTaskPackage).toHaveBeenCalledTimes(2) })
    expect(writeTaskPackage).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaceId: 'product',
      projectPath: '/tmp/Promax/产品',
      sessionId: 'handoff-team-session',
      taskKey: '需求想法',
      confirmedHandoff: expect.stringContaining('## 已知缺口') as string,
      handoffEdited: false,
      requestedArtifactPaths: ['deliverables/{task_key}/prd.md'],
      coverageInformationKeys: ['goal', 'target_user'],
      coverageWasOverridden: true,
    }))
    await waitFor(() => { expect(readTeamState().sessionBindings).toContainEqual(expect.objectContaining({
      sessionId: 'handoff-team-session',
      coverageRevision: 2,
      coverageInformationKeys: ['goal', 'target_user'],
    })) })
    expect(setDraft.mock.calls.at(-1)?.[0]).toBe('请读取并执行内部任务包：.promax/tasks/需求想法/task-package.yml')
    expect(submit).toHaveBeenCalledTimes(2)
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
      - team revision：\`team-mtcjsbcz-04tpe2@r12\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r12\`
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
        { kind: 'assistant', messageId: 'a1', turn: 1, blocks: [{ kind: 'tool-call', callId: 's1', name: 'solution_design', argsRaw: '{}' }] },
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
      '第 2 轮协调已响应',
      '第 3 轮协调已响应',
    ])
    expect(events[1]).toEqual(expect.objectContaining({ tone: 'active', copy: expect.stringContaining('权威任务文件') }))
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
      - team revision：\`team-mtcjsbcz-04tpe2@r12\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r12\`
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
    bindTeamSession({
      sessionId: 'product-session', teamId: PRODUCT_TEAM_ID, revision: PRODUCT_TEAM_REVISION, presetId: PRODUCT_PRESET_ID, workspaceId: 'product',
      sessionName: 'product-task', taskKey: 'product-task', tier: 'single', coverageRevision: 1,
      taskPackagePath: '.promax/tasks/product-task/task-package.yml', slots: [], confirmedHandoff: '任务',
      requestedArtifactPaths: ['deliverables/{task_key}/prd.md'], artifactPaths: ['deliverables/product-task/prd.md'],
      coverageInformationKeys: ['goal'], runState: 'running', runEpoch: 1,
    })
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
    const stopTeamTask = vi.fn(async () => ({ state: 'cancelled' as const, runEpoch: 1 }))
    render(<PromaxComposerBar
      sessionId="product-session"
      useInput={selector => selector(input)}
      useSession={selector => selector(nativeSnapshot)}
      useSessions={selector => selector(sessions)}
      inputActions={{ setDraft: vi.fn(), submit: vi.fn() }}
      stop={stop}
      stopTeamTask={stopTeamTask}
      useWorkspaces={useWorkspaces}
    />)

    const button = screen.getByRole('button', { name: '停止团队任务' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => {
      expect(stopTeamTask).toHaveBeenCalledWith({ workspaceId: 'product', projectPath: '/tmp/Promax/产品', sessionId: 'product-session', taskKey: 'product-task', runEpoch: 1 })
    })
    expect(stop).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '正在停止团队任务' })).toBeDisabled()
  })

  it('shows failed_to_stop truthfully and keeps an explicit retry action', async () => {
    bindTeamSession({
      sessionId: 'failed-stop-session', teamId: PRODUCT_TEAM_ID, revision: PRODUCT_TEAM_REVISION, presetId: PRODUCT_PRESET_ID, workspaceId: 'product',
      sessionName: 'failed-stop-task', taskKey: 'failed-stop-task', tier: 'single', coverageRevision: 1,
      taskPackagePath: '.promax/tasks/failed-stop-task/task-package.yml', slots: [], confirmedHandoff: '任务',
      requestedArtifactPaths: ['deliverables/{task_key}/prd.md'], artifactPaths: ['deliverables/failed-stop-task/prd.md'],
      coverageInformationKeys: ['goal'], runState: 'failed_to_stop', runEpoch: 1,
    })
    const input = { draft: '', draftRev: 0, phase: 'plain' as const }
    const nativeSnapshot = { nodes: [], turnTimings: new Map<number, { startTime: number; endTime?: number }>(), running: false }
    const sessions: SessionListState = {
      ids: ['failed-stop-session'],
      byId: {
        'failed-stop-session': { id: 'failed-stop-session', displayTitle: '停止失败任务', running: false, blank: false, updatedAt: 1 },
      },
      current: 'failed-stop-session',
      phase: 'ready',
    }
    const stopTeamTask = vi.fn(async () => { throw new Error('子 Agent 仍在运行') })
    render(<PromaxComposerBar
      sessionId="failed-stop-session"
      useInput={selector => selector(input)}
      useSession={selector => selector(nativeSnapshot)}
      useSessions={selector => selector(sessions)}
      inputActions={{ setDraft: vi.fn(), submit: vi.fn() }}
      stop={vi.fn()}
      stopTeamTask={stopTeamTask}
      useWorkspaces={useWorkspaces}
    />)

    expect(screen.getByPlaceholderText('停止失败：任务仍可能运行；请重试停止或转人工处理')).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('停止任务失败：任务仍可能运行')
    const retry = screen.getByRole('button', { name: '重试停止团队任务' })
    expect(retry).toBeEnabled()
    fireEvent.click(retry)
    await waitFor(() => {
      expect(stopTeamTask).toHaveBeenCalledWith({ workspaceId: 'product', projectPath: '/tmp/Promax/产品', sessionId: 'failed-stop-session', taskKey: 'failed-stop-task', runEpoch: 1 })
      expect(screen.getByRole('alert')).toHaveTextContent('停止任务失败：子 Agent 仍在运行')
    })
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

  it('projects current task only from binding, task-state, exact files and structured member lifecycle', () => {
    syncProductTeamRuntimeRoster(runtimeTeamRosterOf(`
      ## 已发布团队快照
      - team revision：\`team-mtcjsbcz-04tpe2@r12\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r12\`
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
    const taskKey = '阅读分享会报名流程'
    const artifactPaths = [
      `deliverables/${taskKey}/customer_research.md`,
      `deliverables/${taskKey}/requirement_management.md`,
      `deliverables/${taskKey}/business-diagram.md`,
      `deliverables/${taskKey}/requirement_review.md`,
    ]
    const binding = {
      sessionId: 'parent-new-task', teamId: PRODUCT_TEAM_ID, revision: PRODUCT_TEAM_REVISION, presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product', sessionName: taskKey, taskKey, tier: 'team' as const, coverageRevision: 1,
      taskPackagePath: `.promax/tasks/${taskKey}/task-package.yml`, slots: [], confirmedHandoff: '新任务',
      requestedArtifactPaths: artifactPaths, artifactPaths, coverageInformationKeys: ['goal' as const], runState: 'running' as const, runEpoch: 1,
    }
    const taskState = {
      employee_id: '10086', project: '产品', session_id: binding.sessionId, task_key: taskKey, tier: 'team' as const,
      coverage_revision: 1, updated_at: new Date().toISOString(),
      slots: [
        { slot_id: 'customer_research', member_id: 'customer_research', label: '客研', status: 'produced' as const, provides: ['pain_point' as const], requires: ['goal' as const], satisfied_by: [], missing: [] },
        { slot_id: 'requirement_management', member_id: 'requirement_management', label: '需求', status: 'pending' as const, provides: ['requirements_priority' as const], requires: ['goal' as const], satisfied_by: [], missing: [] },
      ],
    }
    const files: TaskRunFileSnapshot = {
      taskKey, parentSessionId: binding.sessionId, cancellation: 'running', runEpoch: 1,
      artifactStates: artifactPaths.map(path => ({ path, exists: path.endsWith('customer_research.md'), nonEmpty: path.endsWith('customer_research.md') })),
      judge: { path: `.promax/judge/${taskKey}/judge.md`, state: 'absent', exists: false }, observedAt: new Date().toISOString(),
    }
    const projection = taskRunProjectionOf({
      team, binding, taskState, files,
      snapshot: {
        // Historical prose deliberately mentions an old PRD and Judge; it is not a lifecycle source.
        nodes: [
          { kind: 'assistant', blocks: [{ kind: 'text', text: '读取上一任务 judge.md；旧 prd.md verdict pass' }] },
          { kind: 'tool-result', callId: 'customer-call', call: { name: 'customer_research', argsRaw: '{}' }, content: [{ type: 'text', text: 'started subagent child-customer' }], isError: false },
        ],
        running: true,
        runningCalls: [{ callId: 'requirement-call', name: 'requirement_management', argsRaw: '{}' }],
      },
      sessions: {
        ids: [binding.sessionId, 'child-customer'], current: binding.sessionId, phase: 'ready',
        byId: {
          [binding.sessionId]: { id: binding.sessionId, displayTitle: taskKey, running: true, blank: false, updatedAt: 1 },
          'child-customer': { id: 'child-customer', displayTitle: '客研', parentId: binding.sessionId, origin: 'subagent', running: false, completed: true, blank: false, updatedAt: 2 },
        },
      },
    })
    expect(Object.keys(projection.artifacts)).toEqual(artifactPaths)
    expect(Object.keys(projection.artifacts).some(path => path.endsWith('/prd.md'))).toBe(false)
    expect(projection.members.customer_research).toMatchObject({ state: 'done', childSessionIds: ['child-customer'], attempt: 1 })
    expect(projection.members.requirement_management?.state).toBe('running')
    expect(projection.members.quality_judge?.state).toBe('idle')
    expect(projection.judge.state).toBe('pending')
    const progress = teamProgressOf(team, projection)
    expect(progress.artifacts.find(row => row.label === 'customer_research.md')).toMatchObject({ generation: 'done', judgment: 'pending' })

    for (const [fileState, expected] of [['pass', 'done'], ['fail', 'blocked'], ['appealed', 'appealed'], ['human_required', 'human-required'], ['force_released', 'force-released']] as const) {
      const current = taskRunProjectionOf({ team, binding, taskState, files: { ...files, judge: { ...files.judge, state: fileState, exists: true } } })
      expect(teamProgressOf(team, current).delivery).toBe(expected)
      if (fileState === 'force_released') expect(current.members.quality_judge?.state).toBe('blocked')
    }
  })
})
