import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PromaxComposerBar,
  PromaxComposerHost,
  PromaxDetailsSidebar,
  PromaxSessionBrowser,
  PromaxTeamSessionHeader,
  PromaxWorkspaceOverlay,
  TASK_RUN_FAILURE_STABILITY_THRESHOLD,
  isTaskReadTransportError,
  retainedTaskReadError,
  surfacedTaskReadError,
  taskRunSnapshotDecision,
  taskMessageWithAttachments,
  type SessionListState,
  type WorkspaceListState,
  type WorkspaceShellActions,
} from '../src/client/PromaxWorkspaceShell.tsx'
import {
  PRODUCT_PRESET_ID,
  PRODUCT_TEAM_ID,
  bindTeamSession,
  bindingForSession,
  readTeamState,
  resetTeamStateForTests,
  selectTeamSession,
  syncProductTeamRuntimeRoster,
} from '../src/client/team-state.ts'

const members = [
  ['customer_research', '客研管理智能体', '完成客户研究。'],
  ['product_discovery', '产品探索智能体', '完成产品探索。'],
  ['requirement_management', '需求管理智能体', '完成需求管理。'],
  ['solution_design', '产品需求方案智能体', '生成产品需求方案。'],
  ['requirement_review', '需求评审智能体', '完成需求评审。'],
  ['user_analysis', '用户分析智能体', '完成用户分析。'],
  ['quality_judge', '独立 Judge', '独立判定产出质量。'],
] as const

const artifacts = [
  ['customer_research', 'deliverables/{task_key}/customer_research.md'],
  ['product_discovery', 'deliverables/{task_key}/product_discovery.md'],
  ['requirement_management', 'deliverables/{task_key}/requirement_management.md'],
  ['solution_design', 'deliverables/{task_key}/prd.md'],
  ['solution_design', 'deliverables/{task_key}/business-diagram.md'],
  ['solution_design', 'deliverables/{task_key}/prototype.html'],
  ['requirement_review', 'deliverables/{task_key}/requirement_review.md'],
  ['user_analysis', 'deliverables/{task_key}/user_analysis.md'],
  ['quality_judge', '.promax/judge/{task_key}/judge.md'],
] as const

const workspaceState: WorkspaceListState = {
  items: [
    { workspaceId: 'general', title: '通用', path: '/tmp/general', sessionIds: ['general-session'] },
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
    'general-session': { id: 'general-session', displayTitle: '通用记录', agentPreset: 'general', running: false, blank: false, updatedAt: 3 },
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
    sendSessionMessage: vi.fn(async () => {}),
    openSession: vi.fn(),
    clearSession: vi.fn(),
    archiveSession: vi.fn(async () => {}),
    renameSession: vi.fn(async () => {}),
    saveTaskAttachments: vi.fn(async input => {
      const taskKey = input.demand.trim() || '附件主题'
      return { paths: [], attachments: [], manifestPath: `.promax/input/${taskKey}/manifest.yml`, taskKey, sessionName: taskKey }
    }),
    beginDispatchPlan: vi.fn(async input => ({ planId: 'dispatch-plan-1', taskKey: input.taskKey })),
    confirmDispatchPlan: vi.fn(async input => ({ ...input, taskKey: '登录流程', confirmedAt: '2026-09-03T12:00:00.000Z' })),
    readTaskRunFiles: vi.fn(async input => ({
      taskKey: input.taskKey,
      parentSessionId: input.sessionId,
      createdAt: '2026-09-03T12:00:00.000Z',
      cancellation: 'running' as const,
      runEpoch: 1,
      manifestPath: `.promax/tasks/${input.taskKey}/task-package.yml`,
      inputManifestPath: `.promax/input/${input.taskKey}/manifest.yml`,
      confirmedMemberIds: ['solution_design', 'quality_judge'],
      artifactStates: [{ path: `deliverables/${input.taskKey}/prd.md`, memberId: 'solution_design', exists: false, nonEmpty: false }],
      deliverablePath: `deliverables/${input.taskKey}`,
      deliverableFiles: [],
      judge: { path: `.promax/judge/${input.taskKey}/judge.md`, memberId: 'quality_judge' as const, state: 'absent' as const, exists: false, nonEmpty: false },
      observedAt: new Date().toISOString(),
    })),
    readTaskHistory: vi.fn(async () => [{
      sessionId: 'product-session',
      taskKey: '产品方案',
      createdAt: '2026-09-03T12:00:00.000Z',
      status: 'completed' as const,
      fileCount: 0,
      deliverablePath: 'deliverables/产品方案',
      deliverableFiles: [],
      judge: { path: '.promax/judge/产品方案/judge.md', memberId: 'quality_judge' as const, state: 'pass' as const, exists: true, nonEmpty: true },
      observedAt: '2026-09-03T12:03:00.000Z',
    }]),
    openTaskFolder: vi.fn(async input => ({ path: `${input.projectPath}/deliverables/${input.taskKey}` })),
    stopTeamTask: vi.fn(async input => ({ state: 'cancelled' as const, runEpoch: input.runEpoch })),
    teamRoutingAvailable: true,
    ...overrides,
  }
}

const layout = { toggleSidebar: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn() }

describe('Promax direct-demand shell', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetTeamStateForTests()
    syncProductTeamRuntimeRoster({
      presetId: PRODUCT_PRESET_ID,
      revision: 1,
      members: members.map(([memberId, displayName, objective]) => ({ memberId, displayName, objective, role: 'worker', enabled: true, provides: [], requires: [] })),
      artifacts: artifacts.map(([producedBy, relativePath]) => ({ relativePath, producedBy, required: true })),
    })
    sessionState.current = undefined
    sessionState.ids = ['general-session', 'product-session', 'internal-session']
    delete sessionState.byId['child-session']
    delete sessionState.byId['product-session-2']
  })

  it('shows one flat demand list and hides unrelated workspaces', async () => {
    render(<PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} />)

    expect(screen.getByRole('button', { name: '新需求' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '需求记录' })).toBeVisible()
    expect(await screen.findByText('产品方案')).toBeVisible()
    expect(screen.getByText(/已完成 · 0 个文件/u)).toBeVisible()
    expect(screen.queryByText('通用记录')).not.toBeInTheDocument()
    expect(screen.queryByText('smoke 残留')).not.toBeInTheDocument()
    expect(screen.queryByText('新建草稿')).not.toBeInTheDocument()
    expect(screen.queryByText('团队总览')).not.toBeInTheDocument()
    expect(screen.queryByText('项目')).not.toBeInTheDocument()
  })

  it('opens an existing demand directly from the flat list', async () => {
    const shellActions = actions()
    render(<PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />)

    fireEvent.click(await screen.findByText('产品方案'))
    expect(shellActions.openSession).toHaveBeenCalledWith('product-session')
  })

  it('requires confirmation before hiding a record and leaves disk files untouched', async () => {
    const shellActions = actions()
    render(<PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />)

    await screen.findByText('产品方案')
    fireEvent.click(screen.getByRole('button', { name: '会话操作：产品方案' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '隐藏记录' }))
    expect(screen.getByRole('heading', { name: '隐藏这条记录？' })).toBeVisible()
    expect(screen.getByText(/磁盘里的 `deliverables\/产品方案\/`、冻结输入和 Judge 报告都不会删除/u)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '确认隐藏' }))

    await waitFor(() => { expect(shellActions.archiveSession).toHaveBeenCalledWith('product-session') })
    expect(await screen.findByText('已隐藏“产品方案”；磁盘文件未删除')).toBeVisible()
  })

  it('renders the root as a single demand input with one start action and the latest disk output', async () => {
    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} layout={layout} detailsOpen /></div>)

    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: '需求输入' })).toBeVisible()
    expect(screen.getAllByRole('button', { name: '开始' })).toHaveLength(1)
    expect(screen.queryByText(/工作目录：/u)).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '产品方案' })).toBeVisible()
    expect(screen.getByText('最近一次的产出')).toBeVisible()
    expect(screen.queryByText('新建草稿')).not.toBeInTheDocument()
    expect(screen.queryByText('交底')).not.toBeInTheDocument()
    expect(screen.queryByText('选择产物')).not.toBeInTheDocument()
  })

  it('uses the right blank area for the latest disk output', async () => {
    render(<PromaxDetailsSidebar useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} layout={layout} />)

    expect(await screen.findByRole('heading', { name: '产品方案' })).toBeVisible()
    expect(screen.getByText('最近一次的产出')).toBeVisible()
    expect(screen.getByText('产出目录里还没有业务文件。')).toBeVisible()
    expect(screen.queryByText(/推荐/u)).not.toBeInTheDocument()
  })

  it('starts a model-only planning turn instead of executing the raw demand', async () => {
    const shellActions = actions()
    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)

    fireEvent.change(screen.getByRole('textbox', { name: '需求输入' }), { target: { value: '为移动端设计登录流程' } })
    fireEvent.click(screen.getByRole('button', { name: '开始' }))

    await waitFor(() => {
      expect(shellActions.startSession).toHaveBeenCalledWith('product', PRODUCT_PRESET_ID)
      expect(shellActions.renameSession).toHaveBeenCalledWith('new-session', '为移动端设计登录流程')
      expect(shellActions.beginDispatchPlan).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'new-session', taskKey: '为移动端设计登录流程' }))
      expect(shellActions.sendSessionMessage).toHaveBeenCalledWith('new-session', expect.stringContaining('这是一次调度计划请求，不是执行请求'))
      expect(shellActions.sendSessionMessage).toHaveBeenCalledWith('new-session', expect.stringContaining('为移动端设计登录流程'))
      expect(shellActions.openSession).toHaveBeenCalledWith('new-session')
    })
    expect(bindingForSession(readTeamState(), 'new-session')).toMatchObject({
      sessionId: 'new-session',
      teamId: PRODUCT_TEAM_ID,
      presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product',
      dispatchState: 'planning',
      dispatchPlanId: 'dispatch-plan-1',
    })
  })

  it('adds saved attachment paths to the first user message without changing the demand', () => {
    expect(taskMessageWithAttachments('  分析这份访谈  ', ['输入/源文件/session-1/访谈.txt'])).toBe(
      '分析这份访谈\n\n附件路径（相对当前工作目录）：\n- 输入/源文件/session-1/访谈.txt',
    )
  })

  it('uploads files picked on the demand page and includes the returned paths in the first message', async () => {
    const shellActions = actions({
      saveTaskAttachments: vi.fn(async () => ({
        paths: ['输入/源文件/new-session/brief.txt'],
        attachments: [{ path: '输入/源文件/new-session/brief.txt', name: 'brief.txt', mediaType: 'text/plain', bytes: 10, readablePath: '输入/源文件/new-session/brief.txt', textCharacters: 10, excerpt: 'brief body', truncated: false }],
        manifestPath: '.promax/input/分析这份资料/manifest.yml',
        taskKey: '分析这份资料',
        sessionName: '分析这份资料',
      })),
    })
    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)
    const file = new File(['brief body'], 'brief.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('brief body').buffer })
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    expect(fileInput).toHaveAttribute('accept', '.md,.txt,.csv,.json,.yml,.yaml,.docx,.pdf,.xlsx')

    fireEvent.change(fileInput!, { target: { files: [file] } })
    fireEvent.change(screen.getByRole('textbox', { name: '需求输入' }), { target: { value: '分析这份资料' } })
    fireEvent.click(screen.getByRole('button', { name: '开始' }))

    await waitFor(() => {
      expect(shellActions.saveTaskAttachments).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: 'product',
        sessionId: 'new-session',
        demand: '分析这份资料',
        files: [expect.objectContaining({ name: 'brief.txt', mediaType: 'text/plain' })],
      }))
      expect(shellActions.sendSessionMessage).toHaveBeenCalledWith(
        'new-session',
        expect.stringMatching(/输入\/源文件\/new-session\/brief\.txt[\s\S]*brief body/u),
      )
    })
  })

  it('uses the content-derived task key as the exact demand for a pure-file submission', async () => {
    const shellActions = actions({
      saveTaskAttachments: vi.fn(async () => ({
        paths: ['输入/源文件/new-session/brief.md'],
        attachments: [{ path: '输入/源文件/new-session/brief.md', name: 'brief.md', mediaType: 'text/markdown', bytes: 20, readablePath: '.promax/input/会员续费提醒关闭入口/sources/SRC-001/brief.md', textCharacters: 20, excerpt: '会员续费提醒关闭入口', truncated: false }],
        manifestPath: '.promax/input/会员续费提醒关闭入口/manifest.yml',
        taskKey: '会员续费提醒关闭入口',
        sessionName: '会员续费提醒关闭入口',
      })),
    })
    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)
    const file = new File(['会员续费提醒关闭入口'], 'brief.md', { type: 'text/markdown' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('会员续费提醒关闭入口').buffer })
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!

    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '开始' }))

    await waitFor(() => {
      expect(shellActions.renameSession).toHaveBeenCalledWith('new-session', '会员续费提醒关闭入口')
      expect(shellActions.sendSessionMessage).toHaveBeenCalledWith('new-session', expect.stringContaining('"demand": "会员续费提醒关闭入口"'))
    })
  })

  it('shows the same collision suffix that will be sent to disk', async () => {
    const shellActions = actions({
      saveTaskAttachments: vi.fn(async () => ({ paths: ['输入/源文件/new-session/brief.txt', '输入/源文件/new-session/brief（2）.txt'], attachments: [], manifestPath: '.promax/input/分析两个文件/manifest.yml', taskKey: '分析两个文件', sessionName: '分析两个文件' })),
    })
    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)
    const first = new File(['first'], 'brief.txt', { type: 'text/plain' })
    const second = new File(['second'], 'brief.txt', { type: 'text/plain' })
    Object.defineProperty(first, 'arrayBuffer', { value: async () => new TextEncoder().encode('first').buffer })
    Object.defineProperty(second, 'arrayBuffer', { value: async () => new TextEncoder().encode('second').buffer })
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!

    fireEvent.change(fileInput, { target: { files: [first, second] } })
    expect(screen.getByRole('button', { name: 'brief.txt ×' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'brief（2）.txt ×' })).toBeVisible()
    fireEvent.change(screen.getByRole('textbox', { name: '需求输入' }), { target: { value: '分析两个文件' } })
    fireEvent.click(screen.getByRole('button', { name: '开始' }))

    await waitFor(() => {
      expect(shellActions.saveTaskAttachments).toHaveBeenCalledWith(expect.objectContaining({
        files: [expect.objectContaining({ name: 'brief.txt' }), expect.objectContaining({ name: 'brief（2）.txt' })],
      }))
    })
  })

  it('rejects unsupported files immediately without calling the attachment API', () => {
    const shellActions = actions()
    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(screen.getByRole('textbox', { name: '需求输入' }), { target: { value: '分析附件' } })
    fireEvent.change(fileInput, { target: { files: [new File(['binary'], 'setup.exe')] } })

    expect(screen.getByRole('alert')).toHaveTextContent('不支持文件“setup.exe”。支持的格式：')
    expect(screen.getByRole('button', { name: '开始' })).toBeDisabled()
    expect(shellActions.saveTaskAttachments).not.toHaveBeenCalled()
  })

  it('rejects an over-limit selection by raw bytes before any attachment request', () => {
    const shellActions = actions()
    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const oversized = new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'oversized.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByRole('textbox', { name: '需求输入' }), { target: { value: '分析附件' } })
    fireEvent.change(fileInput, { target: { files: [oversized] } })

    expect(screen.getByRole('alert')).toHaveTextContent('附件总大小不能超过 20 MiB，请移除部分文件后重试')
    expect(screen.getByRole('button', { name: '开始' })).toBeDisabled()
    expect(shellActions.saveTaskAttachments).not.toHaveBeenCalled()
  })

  it('shows the model plan, keeps Judge fixed, and seals the exact confirmed artifacts', async () => {
    const shellActions = actions({
      confirmDispatchPlan: vi.fn(async input => ({ ...input, taskKey: '登录流程', confirmedAt: '2026-09-03T12:00:00.000Z' })),
    })
    bindTeamSession({
      sessionId: 'product-session',
      teamId: PRODUCT_TEAM_ID,
      revision: 1,
      presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product',
      sessionName: '登录流程',
      taskKey: '登录流程',
      dispatchPlanId: 'dispatch-plan-1',
      dispatchState: 'planning',
      dispatchDemand: '为移动端设计登录流程',
      dispatchAttachmentPaths: [],
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const planRows = members.map(([memberId], index) => ({
      member_id: memberId,
      selected: memberId === 'solution_design' || memberId === 'quality_judge',
      reason: memberId === 'solution_design' ? '需要把登录流程整理成可执行的产品需求。' : memberId === 'quality_judge' ? '需要独立检查 PRD 是否满足本次目标。' : `本次输入没有提供需要 ${memberId} 处理的材料。`,
      deliverables: memberId === 'solution_design'
        ? ['deliverables/登录流程/prd.md']
        : artifacts.filter(([owner]) => owner === memberId).map(([, path]) => path.replaceAll('{task_key}', '登录流程')),
      order: index,
    }))
    const snapshot = {
      nodes: [{
        kind: 'assistant', turn: 1, messageId: 'plan-message', blocks: [{ kind: 'text', text: `PROMAX_DISPATCH_PLAN_V1_START\n${JSON.stringify({ protocol: 'promax.dispatch-plan/v1', plan_id: 'dispatch-plan-1', assessment: '我看这是一份移动端产品功能需求。', members: planRows })}\nPROMAX_DISPATCH_PLAN_V1_END` }],
      }],
      turnTimings: new Map([[1, { startTime: 1, endTime: 2 }]]),
      running: false,
    }
    render(<div className="app-shell">
      <PromaxTeamSessionHeader sessionId="product-session" useSession={selector => selector(snapshot)} />
      <PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen />
    </div>)

    expect(await screen.findByRole('heading', { name: '这次打算怎么干' })).toBeVisible()
    expect(screen.getByText('我看这是一份移动端产品功能需求。')).toBeVisible()
    expect(screen.getByRole('heading', { name: '打算叫 2 个人' })).toBeVisible()
    expect(shellActions.confirmDispatchPlan).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '打开产物文件夹' }))
    await waitFor(() => { expect(shellActions.openTaskFolder).toHaveBeenCalledWith({ workspaceId: 'product', projectPath: '/tmp/Promax/产品', sessionId: 'product-session', taskKey: '登录流程' }) })

    fireEvent.click(screen.getByRole('button', { name: '我要改' }))
    expect(screen.getByRole('dialog', { name: '选择本次参与的员工' })).toBeVisible()
    expect(screen.getByRole('button', { name: '关闭员工选择' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    const judge = screen.getByRole('checkbox', { name: /独立 Judge/u })
    expect(judge).toBeChecked()
    expect(judge).toBeDisabled()
    fireEvent.click(judge)
    fireEvent.click(screen.getByRole('button', { name: '按这个名单跑（2）' }))

    await waitFor(() => {
      expect(shellActions.confirmDispatchPlan).toHaveBeenCalledWith({
        workspaceId: 'product',
        projectPath: '/tmp/Promax/产品',
        sessionId: 'product-session',
        planId: 'dispatch-plan-1',
        confirmedMemberIds: ['solution_design', 'quality_judge'],
        artifacts: [
          { path: 'deliverables/登录流程/prd.md', memberId: 'solution_design' },
          { path: '.promax/judge/登录流程/judge.md', memberId: 'quality_judge' },
        ],
      })
      expect(shellActions.sendSessionMessage).toHaveBeenCalledWith('product-session', expect.stringMatching(/"confirmed_member_ids": \[[\s\S]*"solution_design",[\s\S]*"quality_judge"/u))
    })
    const execution = vi.mocked(shellActions.sendSessionMessage).mock.calls.at(-1)?.[1] ?? ''
    expect(execution).toContain('"quality_judge"')
  })

  it('turns a zero-member plan into a clarification flow with a manual-selection fallback', async () => {
    const shellActions = actions({
      confirmDispatchPlan: vi.fn(async input => ({ ...input, taskKey: '分析文档', confirmedAt: '2026-09-03T12:00:00.000Z' })),
    })
    bindTeamSession({
      sessionId: 'product-session',
      teamId: PRODUCT_TEAM_ID,
      revision: 1,
      presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product',
      sessionName: '分析文档',
      taskKey: '分析文档',
      dispatchPlanId: 'dispatch-plan-empty',
      dispatchState: 'planning',
      dispatchDemand: '分析这份文档',
      dispatchAttachmentPaths: ['输入/源文件/product-session/方案.pdf'],
      dispatchAttachmentContexts: [{
        path: '输入/源文件/product-session/方案.pdf',
        name: '方案.pdf',
        mediaType: 'application/pdf',
        bytes: 1_016_484,
        readablePath: '.promax/planning-input/product-session/SRC-001/agent-readable.md',
        textCharacters: 4_238,
        excerpt: '方案正文摘录',
        truncated: false,
        converter: 'pdf-parse 2.4.5',
        pageCount: 5,
      }],
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const planRows = members.map(([memberId]) => ({
      member_id: memberId,
      selected: false,
      reason: `当前没有明确要求 ${memberId} 负责哪一种分析结果。`,
      deliverables: [],
    }))
    const snapshot = {
      nodes: [{
        kind: 'assistant', turn: 1, messageId: 'empty-plan-message', blocks: [{ kind: 'text', text: `PROMAX_DISPATCH_PLAN_V1_START\n${JSON.stringify({ protocol: 'promax.dispatch-plan/v1', plan_id: 'dispatch-plan-empty', assessment: '附件是一份已有方案，但当前没有说明希望得到哪一种分析结果。', members: planRows })}\nPROMAX_DISPATCH_PLAN_V1_END` }],
      }],
      turnTimings: new Map([[1, { startTime: 1, endTime: 2 }]]),
      running: false,
    }
    render(<div className="app-shell">
      <PromaxTeamSessionHeader sessionId="product-session" useSession={selector => selector(snapshot)} />
      <PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen />
    </div>)

    expect(await screen.findByRole('heading', { name: '还需要你补充分析目标' })).toBeVisible()
    expect(screen.getByText('暂未派单')).toBeVisible()
    expect(screen.getByText('方案.pdf')).toBeVisible()
    expect(screen.getByText(/5 页 · 已提取 4,238 字/u)).toBeVisible()
    expect(screen.getByText('可供智能体阅读')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '打算叫 0 个人' })).not.toBeInTheDocument()
    const replan = screen.getByRole('button', { name: '补充后重新规划' })
    expect(replan).toBeDisabled()

    const manualSelection = screen.getByRole('button', { name: '手动选择员工' })
    fireEvent.click(manualSelection)
    expect(screen.getByRole('dialog', { name: '选择本次参与的员工' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '选择本次参与的员工' })).not.toBeInTheDocument()
    expect(manualSelection).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: '评审方案质量' }))
    expect(screen.getByRole('textbox', { name: '补充分析目标' })).toHaveValue('评审方案质量')
    expect(replan).toBeEnabled()
    fireEvent.click(replan)

    await waitFor(() => {
      expect(shellActions.sendSessionMessage).toHaveBeenCalledWith(
        'product-session',
        expect.stringMatching(/分析这份文档[\s\S]*用户补充的分析目标：评审方案质量[\s\S]*方案\.pdf/u),
      )
    })
    expect(shellActions.confirmDispatchPlan).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '正在重新规划…' })).toBeDisabled()
    expect(screen.getByText('正在根据补充目标重新规划')).toBeVisible()
    expect(manualSelection).toBeDisabled()
  })

  it('does not infer member progress from transcript tool calls when the file is missing', async () => {
    bindTeamSession({
      sessionId: 'product-session',
      teamId: PRODUCT_TEAM_ID,
      revision: 1,
      presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product',
      sessionName: '续费提醒',
      taskKey: '续费提醒',
      dispatchPlanId: 'dispatch-plan-live',
      dispatchState: 'running',
      dispatchDemand: '设计会员续费提醒功能',
      dispatchAttachmentPaths: [],
      confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const snapshot = {
      nodes: [],
      turnTimings: new Map([[2, { startTime: 1 }]]),
      running: true,
      runningCalls: [{ callId: 'member-call-1', name: 'solution_design', argsRaw: '{}' }],
    }

    render(<div className="app-shell">
      <PromaxTeamSessionHeader sessionId="product-session" useSession={selector => selector(snapshot)} />
      <PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} layout={layout} detailsOpen />
    </div>)

    const solutionCard = (await screen.findByText('solution_design')).closest('article')
    expect(solutionCard).not.toBeNull()
    expect(within(solutionCard!).getByText('未生成')).toBeVisible()
    expect(screen.queryByText('customer_research')).not.toBeInTheDocument()
    expect(screen.getByText('0 / 1 就绪')).toBeVisible()
  })

  it('does not flash the previous task snapshot as an error while switching sessions', async () => {
    sessionState.ids.push('product-session-2')
    sessionState.byId['product-session-2'] = { id: 'product-session-2', displayTitle: '第二个产品方案', agentPreset: PRODUCT_PRESET_ID, running: false, completed: true, blank: false, updatedAt: 4 }
    for (const [sessionId, taskKey] of [['product-session', '任务 A'], ['product-session-2', '任务 B']] as const) {
      bindTeamSession({
        sessionId, teamId: PRODUCT_TEAM_ID, revision: 1, presetId: PRODUCT_PRESET_ID,
        workspaceId: 'product', sessionName: taskKey, taskKey, dispatchPlanId: `dispatch-${taskKey}`,
        dispatchState: 'running', dispatchDemand: taskKey, dispatchAttachmentPaths: [], confirmedMemberIds: ['solution_design', 'quality_judge'],
      })
    }
    const shellActions = actions({
      readTaskRunFiles: vi.fn(async input => ({
        taskKey: input.taskKey, parentSessionId: input.sessionId, createdAt: '2026-09-03T12:00:00.000Z', cancellation: 'completed' as const, runEpoch: 1,
        manifestPath: `.promax/tasks/${input.taskKey}/task-package.yml`, inputManifestPath: `.promax/input/${input.taskKey}/manifest.yml`,
        confirmedMemberIds: ['solution_design', 'quality_judge'],
        artifactStates: [{ path: `deliverables/${input.taskKey}/prd.md`, memberId: 'solution_design', exists: true, nonEmpty: true }],
        deliverablePath: `deliverables/${input.taskKey}`,
        deliverableFiles: [{ name: 'prd.md', relativePath: 'prd.md', path: `deliverables/${input.taskKey}/prd.md`, bytes: 1024, modifiedAt: '2026-09-03T12:05:00.000Z' }],
        judge: { path: `.promax/judge/${input.taskKey}/judge.md`, memberId: 'quality_judge' as const, state: 'pass' as const, exists: true, nonEmpty: true },
        observedAt: new Date().toISOString(),
      })),
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)
    await screen.findByText('1 / 1 就绪')

    const flashes: string[] = []
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.textContent?.includes('任务文件快照与当前 task/session 不一致') === true) flashes.push(node.textContent)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    act(() => { selectTeamSession(PRODUCT_TEAM_ID, 'product-session-2', 'product') })
    await screen.findAllByText('第二个产品方案')
    await waitFor(() => { expect(shellActions.readTaskRunFiles).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'product-session-2', taskKey: '任务 B' })) })
    observer.disconnect()

    expect(flashes).toEqual([])
    expect(screen.queryByText('任务文件快照与当前 task/session 不一致')).not.toBeInTheDocument()
  })

  it('marks a member and task complete only after the manifest files and Judge report exist', async () => {
    bindTeamSession({
      sessionId: 'product-session',
      teamId: PRODUCT_TEAM_ID,
      revision: 1,
      presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product',
      sessionName: '续费提醒',
      taskKey: '续费提醒',
      dispatchPlanId: 'dispatch-plan-settled',
      dispatchState: 'running',
      dispatchDemand: '设计会员续费提醒功能',
      dispatchAttachmentPaths: [],
      confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const shellActions = actions({
      readTaskRunFiles: vi.fn(async input => ({
        taskKey: input.taskKey,
        parentSessionId: input.sessionId,
        createdAt: '2026-09-03T12:00:00.000Z',
        cancellation: 'running' as const,
        runEpoch: 1,
        manifestPath: `.promax/tasks/${input.taskKey}/task-package.yml`,
        inputManifestPath: `.promax/input/${input.taskKey}/manifest.yml`,
        confirmedMemberIds: ['solution_design', 'quality_judge'],
        artifactStates: [{ path: `deliverables/${input.taskKey}/prd.md`, memberId: 'solution_design', exists: true, nonEmpty: true }],
        deliverablePath: `deliverables/${input.taskKey}`,
        deliverableFiles: [{ name: 'prd.md', relativePath: 'prd.md', path: `deliverables/${input.taskKey}/prd.md`, bytes: 16, modifiedAt: '2026-09-03T12:02:00.000Z' }],
        judge: { path: `.promax/judge/${input.taskKey}/judge.md`, memberId: 'quality_judge' as const, state: 'pass' as const, exists: true, nonEmpty: true },
        observedAt: new Date().toISOString(),
      })),
    })

    render(<div className="app-shell">
      <PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen />
    </div>)

    expect(await screen.findByText('团队成员')).toBeVisible()
    expect(screen.getByText('solution_design')).toBeVisible()
    expect(screen.getByText('1 / 1 就绪')).toBeVisible()
    expect(screen.getByLabelText('产出目录：/tmp/Promax/产品/deliverables/续费提醒')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '跑完了。1 个文件。' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '交付物' }))
    expect(await screen.findByRole('heading', { name: '跑完了。1 个文件。' })).toBeVisible()
    expect(screen.getByText('prd.md')).toBeVisible()
    expect(screen.getByText('✓ 判定通过')).toBeVisible()
    expect(screen.queryByText('judge.md')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /打开文件夹/u }))
    await waitFor(() => { expect(shellActions.openTaskFolder).toHaveBeenCalledWith({ workspaceId: 'product', projectPath: '/tmp/Promax/产品', sessionId: 'product-session', taskKey: '续费提醒' }) })
    expect(await screen.findByText('已在系统文件管理器打开：/tmp/Promax/产品/deliverables/续费提醒')).toBeVisible()
  })

  it('keeps a specific disk validation failure when a later poll only loses the service', async () => {
    expect(isTaskReadTransportError('Failed to fetch')).toBe(true)
    expect(isTaskReadTransportError('EvidenceInputManifest.spec.sources[1]包含未知字段 origin_url')).toBe(false)
    expect(retainedTaskReadError('EvidenceInputManifest.spec.sources[1]包含未知字段 origin_url', 'Failed to fetch')).toBe(
      'EvidenceInputManifest.spec.sources[1]包含未知字段 origin_url',
    )
    expect(surfacedTaskReadError(undefined, 'Failed to fetch', 1)).toBeUndefined()
    expect(surfacedTaskReadError(undefined, 'Failed to fetch', 2)).toBeUndefined()
    expect(surfacedTaskReadError(undefined, 'Failed to fetch', 3)).toBe('Failed to fetch')
    expect(surfacedTaskReadError(undefined, 'manifest 字段损坏', 1)).toBeUndefined()
    expect(surfacedTaskReadError(undefined, 'manifest 字段损坏', 2)).toBeUndefined()
    expect(surfacedTaskReadError(undefined, 'manifest 字段损坏', 3)).toBe('manifest 字段损坏')
    expect(surfacedTaskReadError('manifest 字段损坏', 'Failed to fetch', 1)).toBe('manifest 字段损坏')

    bindTeamSession({
      sessionId: 'product-session', teamId: PRODUCT_TEAM_ID, revision: 1, presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product', sessionName: '损坏清单', taskKey: '损坏清单', dispatchPlanId: 'dispatch-invalid-manifest',
      dispatchState: 'running', dispatchDemand: '调研', dispatchAttachmentPaths: [], confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const exactError = 'EvidenceInputManifest.spec.sources[1]包含未知字段 origin_url'
    const shellActions = actions({ readTaskRunFiles: vi.fn(async () => { throw new Error(exactError) }) })

    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)

    expect(await screen.findByRole('heading', { name: '任务文件校验未通过' }, { timeout: 3_500 })).toBeVisible()
    expect(screen.getByText(exactError)).toBeVisible()
    expect(screen.getByLabelText('产出目录：/tmp/Promax/产品/deliverables/损坏清单')).toBeVisible()
    expect(screen.getByText('当前目标')).toBeVisible()
    expect(screen.getByText('团队成员')).toBeVisible()
    expect(screen.getAllByText('交付物').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('solution_design')).toBeVisible()
    expect(screen.queryByText(/manifest 与当前团队版本不一致/u)).not.toBeInTheDocument()
  })

  it('does not publish a one-poll incomplete Judge report as a red failure', async () => {
    const baseline = await actions().readTaskRunFiles({
      workspaceId: 'product',
      projectPath: '/tmp/Promax/产品',
      sessionId: 'product-session',
      taskKey: '写入中的 Judge',
    })
    const unverified = {
      ...baseline,
      judge: {
        ...baseline.judge,
        state: 'unverified' as const,
        exists: true,
        nonEmpty: true,
        reason: 'Judge 报告没有可识别的最终通过结论。',
      },
    }
    let stability = { consecutiveReads: 0 }
    for (let index = 1; index < TASK_RUN_FAILURE_STABILITY_THRESHOLD; index += 1) {
      const decision = taskRunSnapshotDecision(stability, unverified)
      expect(decision.publish).toBe(false)
      stability = decision.next
    }
    const confirmed = taskRunSnapshotDecision(stability, unverified)
    expect(confirmed.publish).toBe(true)

    expect(taskRunSnapshotDecision({ consecutiveReads: 0 }, {
      ...unverified,
      judge: { ...unverified.judge, state: 'fail' as const, reason: '明确缺陷。' },
    }).publish).toBe(false)

    const completed = taskRunSnapshotDecision(confirmed.next, {
      ...unverified,
      judge: {
        path: unverified.judge.path,
        memberId: unverified.judge.memberId,
        state: 'pass' as const,
        exists: true,
        nonEmpty: true,
      },
    })
    expect(completed).toEqual({ publish: true, next: { consecutiveReads: 0 } })
  })

  it('keeps the right status panels visible when disk status cannot be read', async () => {
    bindTeamSession({
      sessionId: 'product-session', teamId: PRODUCT_TEAM_ID, revision: 1, presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product', sessionName: '状态异常', taskKey: '状态异常', dispatchPlanId: 'dispatch-sidebar-error',
      dispatchState: 'running', dispatchDemand: '调研', dispatchAttachmentPaths: [], confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const exactError = 'manifest 暂时无法读取'

    render(<PromaxDetailsSidebar useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions({ readTaskRunFiles: vi.fn(async () => { throw new Error(exactError) }) })} layout={layout} />)

    expect(await screen.findByRole('heading', { name: '任务文件校验未通过' }, { timeout: 3_500 })).toBeVisible()
    expect(screen.getByText(exactError)).toBeVisible()
    expect(screen.getByRole('heading', { name: '当前成员' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '业务产物' })).toBeVisible()
    expect(screen.getByText('产品需求方案智能体')).toBeVisible()
    expect(screen.getByText('独立 Judge')).toBeVisible()
  })

  it('reveals the native child-agent context when the current session is a descendant', async () => {
    bindTeamSession({
      sessionId: 'product-session', teamId: PRODUCT_TEAM_ID, revision: 1, presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product', sessionName: '宝妈调研', taskKey: '宝妈调研', dispatchPlanId: 'dispatch-child-trace',
      dispatchState: 'running', dispatchDemand: '调研宝妈用品', dispatchAttachmentPaths: [], confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    sessionState.byId['child-session'] = {
      id: 'child-session', displayTitle: '客研子 Agent', parentId: 'product-session', origin: 'subagent',
      running: true, blank: false, updatedAt: 4,
    }
    sessionState.ids = [...sessionState.ids, 'child-session']
    sessionState.current = 'child-session'

    const shellActions = actions({ readTaskRunFiles: vi.fn(async () => { throw new Error('child trace status read failed') }) })
    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)

    expect(await screen.findByText('子 Agent 上下文')).toBeVisible()
    expect(screen.getByText('客研子 Agent')).toBeVisible()
    expect(screen.getByRole('tab', { name: '任务轨迹' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => { expect(shellActions.readTaskRunFiles).toHaveBeenCalled() })
    expect(screen.queryByRole('heading', { name: '任务文件校验未通过' })).not.toBeInTheDocument()
  })

  it('shows the Judge failure reason beside actual disk files', async () => {
    bindTeamSession({
      sessionId: 'product-session',
      teamId: PRODUCT_TEAM_ID,
      revision: 1,
      presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product',
      sessionName: '失败任务',
      taskKey: '失败任务',
      dispatchPlanId: 'dispatch-plan-failed',
      dispatchState: 'running',
      dispatchDemand: '失败场景',
      dispatchAttachmentPaths: [],
      confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const shellActions = actions({
      readTaskRunFiles: vi.fn(async input => ({
        taskKey: input.taskKey,
        parentSessionId: input.sessionId,
        createdAt: '2026-09-03T12:00:00.000Z',
        cancellation: 'running' as const,
        runEpoch: 1,
        manifestPath: `.promax/tasks/${input.taskKey}/task-package.yml`,
        inputManifestPath: `.promax/input/${input.taskKey}/manifest.yml`,
        confirmedMemberIds: ['solution_design', 'quality_judge'],
        artifactStates: [{ path: `deliverables/${input.taskKey}/prd.md`, memberId: 'solution_design', exists: true, nonEmpty: true }],
        deliverablePath: `deliverables/${input.taskKey}`,
        deliverableFiles: [{ name: 'prd.md', relativePath: 'prd.md', path: `deliverables/${input.taskKey}/prd.md`, bytes: 2048, modifiedAt: '2026-09-03T12:02:00.000Z' }],
        judge: { path: `.promax/judge/${input.taskKey}/judge.md`, memberId: 'quality_judge' as const, state: 'fail' as const, exists: true, nonEmpty: true, reason: '验收追溯表缺少来源编号。' },
        observedAt: new Date().toISOString(),
      })),
    })

    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)

    expect(await screen.findByText('验收追溯表缺少来源编号。', {}, { timeout: 3_500 })).toBeVisible()
    expect(screen.getByText('团队成员')).toBeVisible()
    expect(screen.getByText('solution_design')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '跑完了。1 个文件。' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '交付物' }))
    expect(await screen.findByText('✕ 判定不通过')).toBeVisible()
    expect(screen.getByText('2 KB')).toBeVisible()
  })

  it('shows the current repair round from the disk snapshot instead of a generic running state', async () => {
    bindTeamSession({
      sessionId: 'product-session', teamId: PRODUCT_TEAM_ID, revision: 1, presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product', sessionName: '返修任务', taskKey: '返修任务', dispatchPlanId: 'dispatch-repair',
      dispatchState: 'running', dispatchDemand: '返修场景', dispatchAttachmentPaths: [], confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const shellActions = actions({
      readTaskRunFiles: vi.fn(async input => ({
        taskKey: input.taskKey, parentSessionId: input.sessionId, createdAt: '2026-09-03T12:00:00.000Z', cancellation: 'running' as const, runEpoch: 1,
        manifestPath: `.promax/tasks/${input.taskKey}/task-package.yml`, inputManifestPath: `.promax/input/${input.taskKey}/manifest.yml`,
        confirmedMemberIds: ['solution_design', 'quality_judge'],
        artifactStates: [{ path: `deliverables/${input.taskKey}/prd.md`, memberId: 'solution_design', exists: true, nonEmpty: true }],
        deliverablePath: `deliverables/${input.taskKey}`, deliverableFiles: [],
        judge: { path: `.promax/judge/${input.taskKey}/judge.md`, memberId: 'quality_judge' as const, state: 'fail' as const, exists: true, nonEmpty: true, reason: '首次越界。' },
        repair: { state: 'repairing' as const, round: 1, maxRounds: 2, reasons: ['首次越界。'], updatedAt: '2026-09-03T12:03:00.000Z' },
        observedAt: new Date().toISOString(),
      })),
    })

    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)
    expect((await screen.findAllByText('第 1/2 轮返修中')).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('任务运行中')).not.toBeInTheDocument()
  })

  it('shows the explicit exhausted-repair conclusion and Judge reasons', async () => {
    bindTeamSession({
      sessionId: 'product-session', teamId: PRODUCT_TEAM_ID, revision: 1, presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product', sessionName: '两轮失败', taskKey: '两轮失败', dispatchPlanId: 'dispatch-exhausted',
      dispatchState: 'running', dispatchDemand: '两轮失败场景', dispatchAttachmentPaths: [], confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const reason = '多次返修后仍未通过（2/2）：第一轮越界；第二轮仍越界'
    const shellActions = actions({
      readTaskRunFiles: vi.fn(async input => ({
        taskKey: input.taskKey, parentSessionId: input.sessionId, createdAt: '2026-09-03T12:00:00.000Z', cancellation: 'running' as const, runEpoch: 1,
        manifestPath: `.promax/tasks/${input.taskKey}/task-package.yml`, inputManifestPath: `.promax/input/${input.taskKey}/manifest.yml`,
        confirmedMemberIds: ['solution_design', 'quality_judge'],
        artifactStates: [{ path: `deliverables/${input.taskKey}/prd.md`, memberId: 'solution_design', exists: true, nonEmpty: true }],
        deliverablePath: `deliverables/${input.taskKey}`,
        deliverableFiles: [{ name: 'prd.md', relativePath: 'prd.md', path: `deliverables/${input.taskKey}/prd.md`, bytes: 1024, modifiedAt: '2026-09-03T12:05:00.000Z' }],
        judge: { path: `.promax/judge/${input.taskKey}/judge.md`, memberId: 'quality_judge' as const, state: 'fail' as const, exists: true, nonEmpty: true, reason },
        repair: { state: 'exhausted' as const, round: 2, maxRounds: 2, reasons: ['第一轮越界', '第二轮仍越界'], updatedAt: '2026-09-03T12:06:00.000Z' },
        observedAt: new Date().toISOString(),
      })),
    })

    render(<div className="app-shell"><PromaxWorkspaceOverlay useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} layout={layout} detailsOpen /></div>)
    expect(await screen.findByText(reason)).toBeVisible()
    expect(screen.getByText('团队成员')).toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: '交付物' }))
    expect(await screen.findByText('✕ 判定不通过')).toBeVisible()
  })

  it('describes an accepted stop request truthfully while the current step is still draining', () => {
    bindTeamSession({
      sessionId: 'product-session', teamId: PRODUCT_TEAM_ID, revision: 1, presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product', sessionName: '停止任务', taskKey: '停止任务', dispatchPlanId: 'dispatch-stop',
      dispatchState: 'running', dispatchDemand: '停止场景', dispatchAttachmentPaths: [], confirmedMemberIds: ['solution_design', 'quality_judge'],
      runState: 'draining', runEpoch: 1, runStateUpdatedAt: '2026-09-03T12:03:00.000Z',
    })
    render(<div className="app-shell"><PromaxComposerHost view="workbench" /><PromaxComposerBar
      sessionId="product-session"
      useInput={selector => selector({ draft: '', draftRev: 1, phase: 'plain' })}
      inputActions={{ setDraft: vi.fn(), submit: vi.fn() }}
      useSessions={useSessions}
      useWorkspaces={useWorkspaces}
      stopTeamTask={actions().stopTeamTask}
    /></div>)

    expect(screen.getByPlaceholderText('正在中止当前步骤并等待运行树真实静止')).toBeVisible()
    expect(screen.getByRole('button', { name: '已请求停止，正在中止当前步骤' })).toBeDisabled()
    expect(screen.queryByText(/本任务已停止/u)).not.toBeInTheDocument()
  })

  it('keeps the native composer as a direct continuation input', () => {
    const submit = vi.fn()
    const setDraft = vi.fn()
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    render(<div className="app-shell">
      <PromaxComposerHost view="workbench" />
      <PromaxComposerBar
        sessionId="product-session"
        useInput={selector => selector({ draft: '补充验收条件', draftRev: 1, phase: 'plain' })}
        inputActions={{ setDraft, submit }}
        useSessions={useSessions}
        useWorkspaces={useWorkspaces}
      />
    </div>)

    fireEvent.click(screen.getByRole('button', { name: '发送任务' }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('指定团队成员')).not.toBeInTheDocument()
  })
})
