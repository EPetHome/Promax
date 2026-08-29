import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PromaxProcessAction,
  PromaxSessionBrowser,
  PromaxTeamMentionControl,
  PromaxTeamRail,
  PromaxTeamSessionHeader,
  type SessionListState,
  type WorkspaceListState,
  type WorkspaceShellActions,
} from '../src/client/PromaxWorkspaceShell.tsx'
import { resetDraftStateForTests } from '../src/client/draft-state.ts'
import { PRODUCT_PRESET_ID, PRODUCT_TEAM_ID, bindTeamSession, resetTeamStateForTests, runtimeTeamRosterOf, selectTeamHome, selectTeamSession, syncProductTeamRuntimeRoster } from '../src/client/team-state.ts'

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
    expect(screen.getByRole('heading', { name: '项目组' })).toBeVisible()
    expect(screen.getByText('产品方案')).toBeVisible()
    expect(screen.queryByText('smoke 残留')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建团队' })).not.toBeInTheDocument()
    expect(screen.queryByText('团队设置')).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: '新建项目组' }))
    fireEvent.change(screen.getByLabelText('项目组名称'), { target: { value: '云盘项目' } })
    expect(screen.getByText('~/Promax/云盘项目/')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '创建项目组' }))
    await waitFor(() => { expect(createProjectWorkspace).toHaveBeenCalledWith({ projectName: '云盘项目' }) })
  })

  it('opens a dedicated project-team home without exposing team editing', () => {
    selectTeamHome(PRODUCT_TEAM_ID, 'product')
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} />)
    expect(screen.getByRole('main', { name: '产品智能体团队项目组界面' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '产品' })).toBeVisible()
    expect(screen.getByText('团队已配置')).toBeVisible()
    expect(screen.queryByText('团队设置')).not.toBeInTheDocument()
    expect(screen.queryByText('模板导入')).not.toBeInTheDocument()
  })

  it('renders the r2-defined result tree with honest empty states and opens both top drawers', () => {
    syncProductTeamRuntimeRoster(runtimeTeamRosterOf(`
      ## 已发布团队快照
      - team revision：\`team-mtcjsbcz-04tpe2@r2\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r2\`
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
    bindTeamSession({ sessionId: 'product-session', teamId: PRODUCT_TEAM_ID, revision: 2, presetId: PRODUCT_PRESET_ID, workspaceId: 'product' })
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

  it('keeps the navigation node mounted and provides clickable team/project exits', async () => {
    const shellActions = actions()
    render(<>
      <PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />
      <PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />
    </>)
    const navigation = screen.getByRole('navigation', { name: 'Promax 工作入口' })

    fireEvent.click(screen.getByText('产品智能体团队').closest('button')!)
    expect(screen.getByRole('heading', { name: '选择项目组' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Promax 工作入口' })).toBe(navigation)

    fireEvent.click(screen.getByText('产品', { selector: '.promax-project-row > span' }).closest('button')!)
    expect(screen.getByRole('button', { name: '返回产品智能体团队' })).toBeVisible()
    expect(screen.getByRole('button', { name: '当前项目组：产品' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '当前项目组：产品' }))
    expect(screen.getByRole('heading', { name: '产品' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '返回产品智能体团队' }))
    expect(screen.getByRole('heading', { name: '选择项目组' })).toBeVisible()
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
    await waitFor(() => { expect(setDraft).toHaveBeenCalledWith('生成产品方案') })
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

  it('offers transfer after three draft rounds, saves both files, and starts a new team session', async () => {
    sessionState.current = 'general-session'
    const writeDraftHandoff = vi.fn(async () => ({ handoffPath: '/tmp/需求交底.md', transcriptPath: '/tmp/原始对话.md' }))
    const shellActions = actions({ writeDraftHandoff })
    const nativeSnapshot = {
      nodes: [
        { kind: 'user', seq: 1, content: [{ type: 'text', text: '做一个云盘方案' }] },
        { kind: 'assistant', messageId: 'a1', turn: 1, blocks: [{ kind: 'text', text: '先确认范围' }] },
        { kind: 'user', seq: 2, content: [{ type: 'text', text: '面向企业管理员' }] },
        { kind: 'user', seq: 3, content: [{ type: 'text', text: '一期不做外链' }] },
      ],
      turnTimings: new Map<number, { startTime: number; endTime?: number }>(),
      running: false,
    }
    const useSession = <Selected,>(selector: (state: typeof nativeSnapshot) => Selected): Selected => selector(nativeSnapshot)
    render(<>
      <PromaxTeamSessionHeader sessionId="general-session" useSession={useSession} />
      <PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />
      <PromaxTeamMentionControl sessionId="general-session" input={{ draft: '', draftRev: 0, phase: 'plain', occurrences: [] }} inputActions={{ setDraft: vi.fn(), submit: vi.fn() }} menu={closedMenuStore} launcher={closedLauncherStore} toggleTeamMention={vi.fn()} />
    </>)
    await waitFor(() => { expect(screen.getByRole('button', { name: '交给团队 →' })).toBeVisible() })
    fireEvent.click(screen.getByRole('button', { name: '交给团队 →' }))
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
})
