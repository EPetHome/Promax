import { beforeEach, describe, expect, it } from 'vitest'

import {
  GENERAL_PRESET_ID,
  PRODUCT_PRESET_ID,
  PRODUCT_TEAM_ID,
  PRODUCT_TEAM_REVISION,
  addTeamWorker,
  applyTeamProvisioningResult,
  attachWorkspace,
  bindTeamSession,
  bindingForSession,
  createTeam,
  importTeamPromptSource,
  readTeamState,
  resetTeamStateForTests,
  runtimeTeamRosterOf,
  syncProductTeamRuntimeRoster,
  updateTeamDefinition,
  updateTeamMember,
  writeTeamState,
} from '../src/client/team-state.ts'

describe('Promax dynamic team state', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetTeamStateForTests()
  })

  it('seeds the general entry and routes the fixed product team to r2 without a GUI-owned worker roster', () => {
    const state = readTeamState()
    const product = state.teams.find(team => team.id === PRODUCT_TEAM_ID)

    expect(GENERAL_PRESET_ID).toBe('general')
    expect(state.selected).toEqual({ kind: 'general' })
    expect(product).toMatchObject({
      name: '产品智能体团队',
      status: 'published',
      coordinator: { memberId: 'team_lead', displayName: '主智能体' },
      activeRevision: { revision: PRODUCT_TEAM_REVISION, presetId: PRODUCT_PRESET_ID },
    })
    expect(PRODUCT_PRESET_ID).toBe('promax-team-mtcjsbcz-04tpe2-r2')
    expect(product?.members).toEqual([])
  })

  it('parses and syncs the installed r2 roster instead of hardcoding three GUI members', () => {
    const roster = runtimeTeamRosterOf(`
      ## 已发布团队快照

      - team revision：\`team-mtcjsbcz-04tpe2@r2\`
      - preset：\`promax-team-mtcjsbcz-04tpe2-r2\`

      成员：
      - \`customer_research\`（客研管理智能体）：完成客户研究。
      - \`solution_design\`（产品需求方案智能体）：生成并验证 PRD。
      - \`quality_judge\`（独立 Judge）：独立判定最终产物。

      ## 稳定消息路由

      文件责任：
      - \`deliverables/{task_key}/prd.md\`：solution_design
      - \`.promax/judge/{task_key}/judge.md\`：quality_judge

      稳定回执字段（按顺序）：\`状态\`、\`产物\`、\`Judge判定\`
    `)

    syncProductTeamRuntimeRoster(roster)
    const product = readTeamState().teams.find(team => team.id === PRODUCT_TEAM_ID)
    expect(product?.activeRevision).toEqual({ revision: 2, presetId: PRODUCT_PRESET_ID, status: 'published' })
    expect(product?.members.map(member => [member.memberId, member.displayName])).toEqual([
      ['customer_research', '客研管理智能体'],
      ['solution_design', '产品需求方案智能体'],
      ['quality_judge', '独立 Judge'],
    ])
    expect(product?.artifacts).toEqual([
      { relativePath: 'deliverables/{task_key}/prd.md', producedBy: 'solution_design' },
      { relativePath: '.promax/judge/{task_key}/judge.md', producedBy: 'quality_judge' },
    ])
  })

  it('creates an editable draft instead of silently cloning product-solution', () => {
    const team = createTeam('增长团队')

    expect(team.status).toBe('draft')
    expect(team.activeRevision).toBeUndefined()
    expect(team.members).toEqual([])

    addTeamWorker(team.id)
    const worker = readTeamState().teams.find(item => item.id === team.id)?.members[0]
    expect(worker).toMatchObject({ memberId: 'worker_1', role: 'worker' })

    updateTeamMember(team.id, 'worker_1', { displayName: '调研专员', objective: '整理公开事实' })
    attachWorkspace(team.id, 'workspace-growth')

    expect(readTeamState().teams.find(item => item.id === team.id)).toMatchObject({
      status: 'draft',
      workspaceIds: ['workspace-growth'],
      members: [{ displayName: '调研专员', objective: '整理公开事实' }],
    })
  })

  it('imports AGENTS/SOUL files into the GUI draft without pretending to instantiate a team', () => {
    const team = createTeam('增长团队')
    addTeamWorker(team.id)

    importTeamPromptSource(team.id, { name: 'AGENTS.md', kind: 'agents', bytes: 18, content: '团队共同说明' })
    importTeamPromptSource(team.id, { name: 'SOUL.md', kind: 'soul', bytes: 20, content: '协调者工作方式' })
    const current = readTeamState().teams.find(item => item.id === team.id)!
    expect(current.promptDraft).toMatchObject({
      recipeId: 'imported',
      teamInstructions: '团队共同说明',
      coordinatorInstructions: '协调者工作方式',
    })
    expect(current.promptDraft.importedSources.map(source => source.kind).sort()).toEqual(['agents', 'soul'])

    expect(() => {
      importTeamPromptSource(team.id, { name: 'too-large.md', kind: 'agents', bytes: 65_537, content: 'x' })
    }).toThrow('超过 64 KiB')

  })

  it('only becomes runnable after a formal Agent provisioning result is applied', () => {
    const team = createTeam({ name: '调研团队', configurationSource: { kind: 'prompt', prompt: '调研并复核市场事实' } })
    expect(team.provisioning.state).toBe('draft')
    expect(team.activeRevision).toBeUndefined()

    applyTeamProvisioningResult(team.id, {
      coordinator: { memberId: 'research_lead', displayName: '调研负责人', objective: '拆解与终审', role: 'coordinator', enabled: true },
      members: [{ memberId: 'fact_checker', displayName: '事实核验员', objective: '核验来源', role: 'worker', enabled: true }],
      state: 'ready',
      revision: { revision: 1, presetId: 'promax-team-research-r1', status: 'published' },
    })

    expect(readTeamState().teams.find(item => item.id === team.id)).toMatchObject({
      status: 'published',
      provisioning: { state: 'ready' },
      members: [{ memberId: 'fact_checker' }],
      activeRevision: { revision: 1, presetId: 'promax-team-research-r1' },
    })
  })

  it('keeps an existing session on its creation-time revision after the draft changes', () => {
    const team = createTeam('增长团队')
    const current = readTeamState()
    writeTeamState({
      ...current,
      teams: current.teams.map(item => item.id === team.id ? {
        ...item,
        status: 'published',
        activeRevision: { revision: 1, presetId: 'promax-team-growth-r1', status: 'published' },
      } : item),
    })
    bindTeamSession({
      sessionId: 'session-r1',
      teamId: team.id,
      revision: 1,
      presetId: 'promax-team-growth-r1',
      workspaceId: 'workspace-growth',
    })

    updateTeamDefinition(team.id, item => ({ ...item, name: '增长团队（新草稿）', status: 'draft' }))

    expect(bindingForSession(readTeamState(), 'session-r1')).toEqual({
      sessionId: 'session-r1',
      teamId: team.id,
      revision: 1,
      presetId: 'promax-team-growth-r1',
      workspaceId: 'workspace-growth',
    })
  })
})
