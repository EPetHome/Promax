import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PromaxProcessAction,
  PromaxTeamMentionControl,
  PromaxTeamSessionHeader,
  PromaxSessionBrowser,
  PromaxTeamRail,
  type SessionListState,
  type WorkspaceView,
  type WorkspaceListState,
  type WorkspaceShellActions,
} from '../src/client/PromaxWorkspaceShell.tsx'
import { PRODUCT_TEAM_ID, createTeam, resetTeamStateForTests, selectTeamHome, selectTeamSession, updateTeamDefinition } from '../src/client/team-state.ts'

const workspaceState: WorkspaceListState = {
  items: [
    { workspaceId: 'general', title: '通用工作区', path: '/tmp/general', sessionIds: ['general-session'] },
    { workspaceId: 'product', title: '产品', path: '/tmp/product', sessionIds: ['product-session'] },
    { workspaceId: 'idaas', title: 'IDaaS', path: '/tmp/idaas', sessionIds: ['idaas-session'] },
  ],
  archivedSessionIds: [],
  state: 'idle',
  error: null,
}

const sessionState: SessionListState = {
  ids: ['general-session', 'product-session', 'idaas-session'],
  byId: {
    'general-session': { id: 'general-session', displayTitle: '通用任务', agentPreset: 'general', running: false, blank: false, updatedAt: 3 },
    'product-session': { id: 'product-session', displayTitle: '产品方案', agentPreset: 'product-solution', running: false, completed: true, blank: false, updatedAt: 2 },
    'idaas-session': { id: 'idaas-session', displayTitle: 'IDaaS 历史任务', agentPreset: 'cordis', running: false, blank: false, updatedAt: 1 },
  },
  current: undefined,
  phase: 'ready',
}

function useWorkspaces<Selected>(selector: (state: WorkspaceListState) => Selected): Selected { return selector(workspaceState) }
function useSessions<Selected>(selector: (state: SessionListState) => Selected): Selected { return selector(sessionState) }

function actions(overrides: Partial<WorkspaceShellActions> = {}): WorkspaceShellActions {
  return {
    startSession: vi.fn(async () => 'new-session'),
    sendPrompt: vi.fn(async () => {}),
    sendTeamPrompt: vi.fn(async () => {}),
    openSession: vi.fn(),
    clearSession: vi.fn(),
    createTeamWorkspace: vi.fn(async input => ({ workspaceId: `workspace-${input.teamId}`, title: input.teamName, path: `${input.parentPath}/promax-${input.teamId}`, sessionIds: [] })),
    openWorkspacePath: vi.fn(async () => {}),
    teamRoutingAvailable: true,
    ...overrides,
  }
}

const closedMenuSnapshot = { open: false }
const closedMenuStore = { getSnapshot: () => closedMenuSnapshot, subscribe: () => () => {} }
const closedLauncherStore = { getSnapshot: () => null, subscribe: () => () => {} }

function renderNativeHandoff(sessionId = 'new-session') {
  const setDraft = vi.fn()
  const submit = vi.fn()
  render(<PromaxTeamMentionControl
    sessionId={sessionId}
    input={{ draft: '', draftRev: 0, phase: 'plain', occurrences: [] }}
    inputActions={{ setDraft, submit }}
    menu={closedMenuStore}
    launcher={closedLauncherStore}
    toggleTeamMention={vi.fn()}
  />)
  return { setDraft, submit }
}

describe('Promax workspace and team shell', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetTeamStateForTests()
    workspaceState.items = workspaceState.items.filter(item => ['general', 'product', 'idaas'].includes(item.workspaceId))
  })

  it('shows only general sessions in the general entry and hides IDaaS history', () => {
    render(<PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} />)
    expect(screen.getByText('通用会话')).toBeVisible()
    expect(screen.getByText('通用任务')).toBeVisible()
    expect(screen.queryByText('产品方案')).not.toBeInTheDocument()
    expect(screen.queryByText('IDaaS 历史任务')).not.toBeInTheDocument()
  })

  it('switches the left list to product-team sessions with its compatibility configuration', () => {
    selectTeamHome(PRODUCT_TEAM_ID, 'product')
    render(<PromaxSessionBrowser useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} />)
    expect(screen.getByText('产品团队的会话')).toBeVisible()
    expect(screen.getByText('产品方案')).toBeVisible()
    expect(screen.getByText('兼容版本')).toBeVisible()
    expect(screen.queryByText('通用任务')).not.toBeInTheDocument()
  })

  it('releases the center to the native dsh Conversation after opening a team session', () => {
    const shellActions = actions()
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />)
    fireEvent.click(screen.getByRole('button', { name: /产品团队/ }))
    fireEvent.click(screen.getByRole('button', { name: /产品方案/ }))
    expect(screen.queryByRole('main', { name: '产品团队团队专用界面' })).not.toBeInTheDocument()
    expect(shellActions.openSession).toHaveBeenCalledWith('product-session')
  })

  it('creates an empty team, then configures it from the team chat composer', async () => {
    const provisionTeam = vi.fn(async () => ({
      coordinator: { memberId: 'growth_lead', displayName: '增长负责人', objective: '拆解与终审', role: 'coordinator' as const, enabled: true },
      members: [{ memberId: 'growth_worker', displayName: '增长研究员', objective: '研究和复核', role: 'worker' as const, enabled: true }],
      state: 'ready' as const,
      revision: { revision: 1 as const, presetId: 'promax-growth-r1', status: 'published' as const },
    }))
    const createTeamWorkspace = vi.fn(async (input: { teamId: string; teamName: string; parentPath: string }) => {
      const workspace: WorkspaceView = { workspaceId: `workspace-${input.teamId}`, title: input.teamName, path: `${input.parentPath}/promax-${input.teamId}`, sessionIds: [] }
      workspaceState.items = [...workspaceState.items, workspace]
      return workspace
    })
    const shellActions = actions({ provisionTeam, createTeamWorkspace })
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />)
    fireEvent.click(screen.getByRole('button', { name: '创建团队' }))
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '增长团队' } })
    fireEvent.change(screen.getByLabelText(/团队简介/u), { target: { value: '负责增长策略研究' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并进入' }))
    await waitFor(() => { expect(screen.getByRole('main', { name: '增长团队团队专用界面' })).toBeVisible() })
    expect(shellActions.createTeamWorkspace).toHaveBeenCalledWith(expect.objectContaining({ teamName: '增长团队', parentPath: '/tmp' }))
    expect(provisionTeam).not.toHaveBeenCalled()
    expect(screen.getByText('还没有配置团队成员')).toBeVisible()
    const setupComposer = screen.getByPlaceholderText(/描述你希望这个团队负责什么/u)
    expect(setupComposer).toBeEnabled()
    fireEvent.change(setupComposer, { target: { value: '组建一个负责增长研究和复核的团队' } })
    fireEvent.click(screen.getByRole('button', { name: '配置团队' }))
    await waitFor(() => { expect(provisionTeam).toHaveBeenCalledTimes(1) })
    expect(provisionTeam).toHaveBeenCalledWith(expect.objectContaining({ teamName: '增长团队', workspaceRef: expect.stringMatching(/^workspace-team-/u) }))
    await waitFor(() => { expect(screen.getByText('增长负责人统筹 · 1 名团队成员 · 团队首页')).toBeVisible() })
    expect(screen.getByPlaceholderText(/描述任务/u)).toBeEnabled()
  })

  it('uploads an Agents package from the chat composer and enables it without another form', async () => {
    const pendingDefinition = { api_version: 'promax.ai/v1alpha2', kind: 'TeamDefinition' }
    const provisionTeam = vi.fn(async () => ({
      coordinator: { memberId: 'review_lead', displayName: '复核负责人', objective: '审核配置', role: 'coordinator' as const, enabled: true },
      members: [{ memberId: 'review_worker', displayName: '复核成员', objective: '执行任务', role: 'worker' as const, enabled: true }],
      state: 'review' as const,
      message: '配置文档已生成团队草稿；确认后才会冻结运行配置。',
      pendingDefinition,
    }))
    const publishTeamDraft = vi.fn(async () => ({
      coordinator: { memberId: 'review_lead', displayName: '复核负责人', objective: '审核配置', role: 'coordinator' as const, enabled: true },
      members: [{ memberId: 'review_worker', displayName: '复核成员', objective: '执行任务', role: 'worker' as const, enabled: true }],
      state: 'ready' as const,
      revision: { revision: 1 as const, presetId: 'promax-review-r1', status: 'published' as const },
    }))
    const createTeamWorkspace = vi.fn(async (input: { teamId: string; teamName: string; parentPath: string }) => {
      const workspace: WorkspaceView = { workspaceId: `workspace-${input.teamId}`, title: input.teamName, path: `${input.parentPath}/promax-${input.teamId}`, sessionIds: [] }
      workspaceState.items = [...workspaceState.items, workspace]
      return workspace
    })
    const shellActions = actions({ provisionTeam, publishTeamDraft, createTeamWorkspace })
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...shellActions} />)
    fireEvent.click(screen.getByRole('button', { name: '创建团队' }))
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '文档团队' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并进入' }))
    await waitFor(() => { expect(screen.getByRole('main', { name: '文档团队团队专用界面' })).toBeVisible() })
    const file = new File(['```promax-team\nname: demo\n```'], 'AGENTS.md', { type: 'text/markdown' })
    fireEvent.change(screen.getByLabelText('上传 Agents 包'), { target: { files: [file] } })
    await waitFor(() => { expect(publishTeamDraft).toHaveBeenCalledWith(pendingDefinition) })
    expect(screen.queryByRole('button', { name: '确认并启用团队' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/描述任务/u)).toBeEnabled()
  })

  it('hands the first product-team prompt to the native input machine', async () => {
    const sendTeamPrompt = vi.fn(async () => {})
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions({ sendTeamPrompt })} />)
    fireEvent.click(screen.getByRole('button', { name: /产品团队/ }))
    fireEvent.change(screen.getByPlaceholderText(/描述任务/u), { target: { value: '生成产品方案' } })
    fireEvent.click(screen.getByRole('button', { name: '发送给团队' }))
    await waitFor(() => { expect(screen.queryByRole('main', { name: '产品团队团队专用界面' })).not.toBeInTheDocument() })
    const native = renderNativeHandoff()
    await waitFor(() => { expect(native.setDraft).toHaveBeenCalledWith('生成产品方案') })
    expect(native.submit).toHaveBeenCalledTimes(1)
    expect(sendTeamPrompt).not.toHaveBeenCalled()
  })

  it('sends on Enter, keeps Shift+Enter as a newline, ignores IME confirmation, and prevents duplicate submit', async () => {
    let resolveStart: ((sessionId: string) => void) | undefined
    const startSession = vi.fn(() => new Promise<string>(resolve => { resolveStart = resolve }))
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions({ startSession })} />)
    fireEvent.click(screen.getByRole('button', { name: /产品团队/ }))
    const composer = screen.getByPlaceholderText(/描述任务/u)
    fireEvent.change(composer, { target: { value: '生成产品方案' } })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
    expect(startSession).not.toHaveBeenCalled()
    fireEvent.keyDown(composer, { key: 'Enter', keyCode: 229, isComposing: true })
    expect(startSession).not.toHaveBeenCalled()
    fireEvent.keyDown(composer, { key: 'Enter' })
    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(startSession).toHaveBeenCalledTimes(1)
    resolveStart?.('new-session')
    await waitFor(() => { expect(screen.queryByRole('main', { name: '产品团队团队专用界面' })).not.toBeInTheDocument() })
    const native = renderNativeHandoff()
    await waitFor(() => { expect(native.setDraft).toHaveBeenCalledWith('生成产品方案') })
    expect(native.submit).toHaveBeenCalledTimes(1)
  })

  it('turns @ selection into stable member ids instead of prompt text', async () => {
    const sendTeamPrompt = vi.fn(async () => {})
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions({ sendTeamPrompt })} />)
    fireEvent.click(screen.getByRole('button', { name: /产品团队/ }))
    fireEvent.change(screen.getByPlaceholderText(/描述任务/u), { target: { value: '@' } })
    fireEvent.click(screen.getByRole('option', { name: /PRD 专员/ }))
    expect(screen.getByPlaceholderText(/描述任务/u)).toHaveValue('')
    fireEvent.change(screen.getByPlaceholderText(/描述任务/u), { target: { value: '补全验收口径' } })
    fireEvent.click(screen.getByRole('button', { name: '发送给团队' }))
    await waitFor(() => { expect(screen.queryByRole('main', { name: '产品团队团队专用界面' })).not.toBeInTheDocument() })
    const native = renderNativeHandoff()
    await waitFor(() => { expect(native.setDraft).toHaveBeenCalledWith('@product_prd_agent 补全验收口径') })
    expect(native.submit).toHaveBeenCalledTimes(1)
    expect(sendTeamPrompt).not.toHaveBeenCalled()
  })

  it('closes the team @ menu by button, Escape, outside pointer, or selection and restores focus', () => {
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} />)
    fireEvent.click(screen.getByRole('button', { name: /产品团队/ }))
    const composer = screen.getByPlaceholderText(/描述任务/u)
    const mentionButton = screen.getByRole('button', { name: '指定团队成员' })

    fireEvent.click(mentionButton)
    expect(screen.getByRole('listbox', { name: '选择团队成员' })).toBeVisible()
    fireEvent.click(mentionButton)
    expect(screen.queryByRole('listbox', { name: '选择团队成员' })).not.toBeInTheDocument()
    expect(composer).toHaveFocus()

    fireEvent.click(mentionButton)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: '选择团队成员' })).not.toBeInTheDocument()
    expect(composer).toHaveFocus()

    fireEvent.click(mentionButton)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox', { name: '选择团队成员' })).not.toBeInTheDocument()
    expect(composer).toHaveFocus()

    fireEvent.click(mentionButton)
    fireEvent.click(screen.getByRole('option', { name: /PRD 专员/ }))
    expect(screen.queryByRole('listbox', { name: '选择团队成员' })).not.toBeInTheDocument()
    expect(composer).toHaveFocus()
    const chip = screen.getByRole('button', { name: /@PRD 专员/ })
    fireEvent.click(chip)
    expect(screen.queryByRole('button', { name: /@PRD 专员/ })).not.toBeInTheDocument()
  })

  it('paginates stable team members at six per page without rendering fake runtime states', () => {
    updateTeamDefinition(PRODUCT_TEAM_ID, team => ({
      ...team,
      members: [...team.members, ...Array.from({ length: 4 }, (_, index) => ({
        memberId: `extra_${index + 1}`,
        displayName: `扩展成员 ${index + 1}`,
        objective: '补充专业工作',
        role: 'worker' as const,
        enabled: true,
      }))],
    }))
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const nativeSnapshot = { nodes: [], turnTimings: new Map<number, { startTime: number; endTime?: number }>(), running: false }
    const useSession = <Selected,>(selector: (state: typeof nativeSnapshot) => Selected): Selected => selector(nativeSnapshot)
    render(<PromaxTeamSessionHeader sessionId="product-session" useSession={useSession} />)
    fireEvent.click(screen.getByRole('button', { name: '团队成员 · 8' }))
    expect(screen.getAllByText('已配置')).toHaveLength(6)
    expect(screen.queryByText('等待分派')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getAllByText('已配置')).toHaveLength(2)
    expect(screen.getByText('2 / 2 · 共 8 名')).toBeVisible()
  })

  it('exposes a safe per-turn process summary while leaving full evidence to native Trajectory', () => {
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    const nativeSnapshot = {
      nodes: [{ kind: 'assistant', messageId: 'message-1', turn: 3, blocks: [{ kind: 'tool-call' }, { kind: 'text' }] }],
      turnTimings: new Map([[3, { startTime: 1_000, endTime: 3_500 }]]),
      running: false,
    }
    const useSession = <Selected,>(selector: (state: typeof nativeSnapshot) => Selected): Selected => selector(nativeSnapshot)
    render(<PromaxProcessAction sessionId="product-session" messageId="message-1" useSession={useSession} />)
    fireEvent.click(screen.getByText('处理过程'))
    expect(screen.getByText('第 3 轮 · 完成')).toBeVisible()
    expect(screen.getByText('成员/工具调用：1 项')).toBeVisible()
    expect(screen.getByText(/耗时 2.5 秒；详细时间线可在 Trajectory 查看/u)).toBeVisible()
  })

  it('paginates the right team navigation at eight teams per page', () => {
    for (let index = 1; index <= 9; index += 1) createTeam({ name: `脱敏团队 ${index}`, description: '' })
    selectTeamHome(PRODUCT_TEAM_ID, 'product')
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} />)
    expect(screen.getByText('1 / 2 · 共 10 个')).toBeVisible()
    expect(screen.getByText('脱敏团队 7')).toBeVisible()
    expect(screen.queryByText('脱敏团队 8')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('脱敏团队 8')).toBeVisible()
    expect(screen.getByText('脱敏团队 9')).toBeVisible()
    expect(screen.getByText('2 / 2 · 共 10 个')).toBeVisible()
  })

  it('keeps ordinary team settings compact and workspace read-only', () => {
    render(<PromaxTeamRail useWorkspaces={useWorkspaces} useSessions={useSessions} {...actions()} />)
    fireEvent.click(screen.getByRole('button', { name: /产品团队/ }))
    fireEvent.click(screen.getByRole('button', { name: '团队设置' }))
    expect(screen.getByRole('heading', { name: '基本信息' })).toBeVisible()
    expect(screen.getByRole('button', { name: '打开位置' })).toBeVisible()
    expect(screen.queryByText(/^高级设置/u)).not.toBeInTheDocument()
    expect(screen.queryByText('配置来源')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByText('发布与版本')).not.toBeInTheDocument()
    expect(screen.queryByText('TeamDefinition 草稿')).not.toBeInTheDocument()
  })
})
