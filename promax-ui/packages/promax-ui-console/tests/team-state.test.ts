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
  validSessionScopeName,
  writeTeamState,
} from '../src/client/team-state.ts'

describe('Promax dynamic team state', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetTeamStateForTests()
  })

  it('seeds the general entry and routes the product team to the fixed installed snapshot without a GUI-owned worker roster', () => {
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
    expect(PRODUCT_PRESET_ID).toBe('promax-team')
    expect(product?.members).toEqual([])
  })

  it('accepts historical safe session names without rewriting their directories', () => {
    expect(validSessionScopeName('图书馆座位预约')).toBe(true)
    expect(validSessionScopeName('../图书馆')).toBe(false)
    expect(validSessionScopeName('旧任务 含空格')).toBe(true)
  })

  it('parses and syncs the installed fixed roster and information contracts instead of hardcoding GUI members', () => {
    const roster = runtimeTeamRosterOf(`
      ## 已发布团队快照

      - team revision：\`promax-product-team@r1\`
      - preset：\`promax-team\`

      成员：
      - \`customer_research\`（客研管理智能体）：完成客户研究。
      - \`product_discovery\`（产品探索智能体）：完成产品探索。
      - \`requirement_management\`（需求管理智能体）：完成需求管理。
      - \`solution_design\`（产品需求方案智能体）：生成并验证 PRD。
      - \`requirement_review\`（需求评审智能体）：完成需求评审。
      - \`user_analysis\`（用户分析智能体）：完成用户分析。
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

      信息契约：
      - \`customer_research\`：provides=\`target_user,scenario,pain_point\`；requires=\`goal\`
      - \`product_discovery\`：provides=\`competitive_difference\`；requires=\`goal,target_user,scenario\`
      - \`requirement_management\`：provides=\`scope,constraint,requirements_priority\`；requires=\`goal,scenario,pain_point\`
      - \`solution_design\`：provides=\`goal,target_user,scenario,pain_point,scope,constraint,success_criteria,competitive_difference,requirements_priority\`；requires=\`goal,target_user,scenario,pain_point,constraint,requirements_priority\`
      - \`requirement_review\`：provides=\`success_criteria\`；requires=\`goal,scope,constraint,success_criteria,requirements_priority\`
      - \`user_analysis\`：provides=\`target_user,scenario,pain_point\`；requires=\`goal\`
      - \`quality_judge\`：provides=\`\`；requires=\`\`

      产物契约：
      - \`deliverables/{task_key}/prd.md\`：required=\`true\`

      稳定回执字段（按顺序）：\`状态\`、\`产物\`、\`Judge判定\`
    `)

    syncProductTeamRuntimeRoster(roster)
    const product = readTeamState().teams.find(team => team.id === PRODUCT_TEAM_ID)
    expect(product?.activeRevision).toEqual({ revision: 1, presetId: PRODUCT_PRESET_ID, status: 'published' })
    expect(product?.members).toHaveLength(7)
    expect(product?.members.at(-1)).toMatchObject({ memberId: 'quality_judge', displayName: '独立 Judge' })
    expect(product?.artifacts).toHaveLength(9)
    expect(product?.artifacts).toContainEqual(expect.objectContaining({ relativePath: 'deliverables/{task_key}/business-diagram.md', producedBy: 'solution_design' }))
    expect(product?.artifacts).toContainEqual(expect.objectContaining({ relativePath: '.promax/judge/{task_key}/judge.md', producedBy: 'quality_judge' }))
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
      coordinator: { memberId: 'research_lead', displayName: '调研负责人', objective: '拆解与终审', role: 'coordinator', enabled: true, provides: [], requires: [] },
      members: [{ memberId: 'fact_checker', displayName: '事实核验员', objective: '核验来源', role: 'worker', enabled: true, provides: [], requires: [] }],
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

  it('persists only dispatch identity and run-control state for a task binding', () => {
    bindTeamSession({
      sessionId: 'session-b2',
      teamId: PRODUCT_TEAM_ID,
      revision: PRODUCT_TEAM_REVISION,
      presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product',
      sessionName: '脱敏任务',
      taskKey: '脱敏任务',
      dispatchPlanId: 'dispatch-plan-b2',
      dispatchState: 'running',
      dispatchDemand: '脱敏目标',
      dispatchAttachmentPaths: [],
      confirmedMemberIds: ['solution_design', 'quality_judge'],
      runState: 'draining',
      runEpoch: 3,
      runStateUpdatedAt: '2026-08-31T12:00:00.000Z',
    })

    resetTeamStateForTests()
    expect(bindingForSession(readTeamState(), 'session-b2')).toMatchObject({
      dispatchPlanId: 'dispatch-plan-b2',
      confirmedMemberIds: ['solution_design', 'quality_judge'],
      runState: 'draining',
      runEpoch: 3,
    })
  })

  it('persists prepared attachment context for planning retries and status display', () => {
    bindTeamSession({
      sessionId: 'session-attachment-context',
      teamId: PRODUCT_TEAM_ID,
      revision: PRODUCT_TEAM_REVISION,
      presetId: PRODUCT_PRESET_ID,
      workspaceId: 'product',
      sessionName: '分析文档',
      taskKey: '分析文档',
      dispatchPlanId: 'dispatch-plan-context',
      dispatchState: 'planning',
      dispatchDemand: '评审上传的方案',
      dispatchAttachmentPaths: ['输入/源文件/session-attachment-context/方案.pdf'],
      dispatchAttachmentContexts: [{
        path: '输入/源文件/session-attachment-context/方案.pdf',
        name: '方案.pdf',
        mediaType: 'application/pdf',
        bytes: 1024,
        readablePath: '.promax/planning-input/session-attachment-context/SRC-001/agent-readable.md',
        textCharacters: 123,
        excerpt: '文档正文摘录',
        truncated: false,
        converter: 'pdf-parse 2.4.5',
        pageCount: 5,
      }],
    })

    resetTeamStateForTests()
    expect(bindingForSession(readTeamState(), 'session-attachment-context')).toMatchObject({
      dispatchPlanId: 'dispatch-plan-context',
      dispatchAttachmentContexts: [{ name: '方案.pdf', textCharacters: 123, pageCount: 5 }],
    })
  })

  it('advances the product team to the fixed preset without migrating stored r3/r4 session bindings', () => {
    const current = readTeamState()
    const r3PresetId = 'promax-team-mtcjsbcz-04tpe2-r3'
    const r4PresetId = 'promax-team-mtcjsbcz-04tpe2-r4'
    writeTeamState({
      ...current,
      teams: current.teams.map(team => team.id === PRODUCT_TEAM_ID ? {
        ...team,
        members: [{ memberId: 'legacy_worker', displayName: '旧成员', objective: '旧版任务', role: 'worker', enabled: true, provides: [], requires: [] }],
        activeRevision: { revision: 3, presetId: r3PresetId, status: 'published' },
      } : team),
      sessionBindings: [{
        sessionId: 'product-session-r3',
        teamId: PRODUCT_TEAM_ID,
        revision: 3,
        presetId: r3PresetId,
        workspaceId: 'product',
      }, {
        sessionId: 'product-session-r4',
        teamId: PRODUCT_TEAM_ID,
        revision: 4,
        presetId: r4PresetId,
        workspaceId: 'product',
      }],
    })

    resetTeamStateForTests()
    const restored = readTeamState()
    const product = restored.teams.find(team => team.id === PRODUCT_TEAM_ID)

    expect(product?.activeRevision).toEqual({ revision: 1, presetId: PRODUCT_PRESET_ID, status: 'published' })
    expect(product?.members).toEqual([])
    expect(bindingForSession(restored, 'product-session-r3')).toEqual({
      sessionId: 'product-session-r3',
      teamId: PRODUCT_TEAM_ID,
      revision: 3,
      presetId: r3PresetId,
      workspaceId: 'product',
    })
    expect(bindingForSession(restored, 'product-session-r4')).toEqual({
      sessionId: 'product-session-r4',
      teamId: PRODUCT_TEAM_ID,
      revision: 4,
      presetId: r4PresetId,
      workspaceId: 'product',
    })
  })
})
