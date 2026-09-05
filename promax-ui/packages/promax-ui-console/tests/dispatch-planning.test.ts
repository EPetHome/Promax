import { describe, expect, it } from 'vitest'

import {
  DISPATCH_PLAN_END,
  DISPATCH_PLAN_START,
  dispatchExecutionMessage,
  dispatchPlanningMessage,
  latestDispatchPlanResult,
  parseDispatchPlan,
} from '../src/client/dispatch-planning.ts'
import type { PromaxTeam } from '../src/client/team-state.ts'

const team: PromaxTeam = {
  id: 'product-team',
  name: '产品智能体团队',
  description: '测试团队',
  status: 'published',
  coordinator: { memberId: 'team_lead', displayName: '主智能体', objective: '协调', role: 'coordinator', enabled: true, provides: [], requires: [] },
  members: [
    { memberId: 'solution_design', displayName: '产品需求方案智能体', objective: '生成 PRD', role: 'worker', enabled: true, provides: [], requires: [] },
    { memberId: 'quality_judge', displayName: '独立 Judge', objective: '独立判定', role: 'worker', enabled: true, provides: [], requires: [] },
  ],
  artifacts: [
    { relativePath: 'deliverables/{task_key}/prd.md', producedBy: 'solution_design', required: true },
    { relativePath: '.promax/judge/{task_key}/judge.md', producedBy: 'quality_judge', required: true },
  ],
  workspaceIds: [],
  configurationSource: { kind: 'compat', label: 'test' },
  provisioning: { state: 'ready' },
  promptDraft: { recipeId: 'product-compat', teamInstructions: '', coordinatorInstructions: '', importedSources: [] },
  activeRevision: { revision: 1, presetId: 'promax-team', status: 'published' },
}

function modelPlan(): string {
  return `${DISPATCH_PLAN_START}\n${JSON.stringify({
    protocol: 'promax.dispatch-plan/v1',
    plan_id: 'dispatch-plan-1',
    assessment: '我看这是一份产品功能需求。',
    members: [
      { member_id: 'solution_design', selected: true, reason: '需要把输入整理成可验收的 PRD。', deliverables: ['deliverables/登录流程/prd.md'] },
      { member_id: 'quality_judge', selected: false, reason: '你这次只要求先形成单份草稿，没有要求独立验收。', deliverables: [] },
    ],
  })}\n${DISPATCH_PLAN_END}`
}

describe('model-backed dispatch planning', () => {
  it('asks the model to judge every runtime member without keyword routing rules', () => {
    const prompt = dispatchPlanningMessage({
      demand: '分析这份资料',
      attachmentPaths: ['输入/源文件/session-1/方案.pdf'],
      attachmentContexts: [{
        path: '输入/源文件/session-1/方案.pdf',
        name: '方案.pdf',
        mediaType: 'application/pdf',
        bytes: 1024,
        readablePath: '.promax/planning-input/session-1/SRC-001/agent-readable.md',
        textCharacters: 81,
        excerpt: '正文唯一信息：服务先行，分阶段上线。',
        truncated: false,
        converter: 'pdf-parse 2.4.5',
        pageCount: 5,
      }],
      team,
      planId: 'dispatch-plan-1',
      taskKey: '登录流程',
    })
    expect(prompt).toContain('不要调用任何工具、不要启动成员、不要创建或修改文件')
    expect(prompt).toContain('"member_id": "solution_design"')
    expect(prompt).toContain('"member_id": "quality_judge"')
    expect(prompt).toContain('正文唯一信息：服务先行，分阶段上线。')
    expect(prompt).toContain('"page_count": 5')
    expect(prompt).toContain('不要只根据文件名猜测')
    expect(prompt).toContain('quality_judge 是固定成员，必须 selected=true')
  })

  it('accepts only a complete framed model plan with per-member reasons and owned files', () => {
    const plan = parseDispatchPlan(modelPlan(), team, 'dispatch-plan-1', '登录流程')
    expect(plan.assessment).toBe('我看这是一份产品功能需求。')
    expect(plan.members.map(member => [member.memberId, member.selected])).toEqual([
      ['solution_design', true],
      ['quality_judge', true],
    ])
    expect(plan.members[1]?.deliverables).toEqual(['.promax/judge/登录流程/judge.md'])
    expect(() => parseDispatchPlan(modelPlan().replace('deliverables/登录流程/prd.md', '.promax/judge/登录流程/judge.md'), team, 'dispatch-plan-1', '登录流程')).toThrow('团队版本之外的文件')
  })

  it('always includes the fixed Judge in execution', () => {
    const plan = parseDispatchPlan(modelPlan(), team, 'dispatch-plan-1', '登录流程')
    const message = dispatchExecutionMessage({ demand: '为移动端设计登录流程', attachmentPaths: [], plan, selectedMemberIds: ['solution_design'], taskKey: '登录流程' })
    expect(message).toMatch(/"confirmed_member_ids": \[[\s\S]*"solution_design",[\s\S]*"quality_judge"/u)
    expect(message).toContain('"member_id": "quality_judge"')
    expect(message).toContain('"task_package_path": ".promax/tasks/登录流程/task-package.yml"')
    expect(message).toContain('只从 task_package_path 指定的精确任务包进入')
    expect(message).toContain('judge.md 未产生不得汇总为完成')
  })

  it('accepts a useful assessment longer than the old 240-character display limit', () => {
    const longAssessment = '这是对上传方案的具体判断。'.repeat(30)
    const plan = parseDispatchPlan(modelPlan().replace('我看这是一份产品功能需求。', longAssessment), team, 'dispatch-plan-1', '登录流程')
    expect(plan.assessment).toBe(longAssessment)
    expect(plan.assessment.length).toBeGreaterThan(240)
  })

  it('keeps the previous valid plan and reports why a newer model reply cannot be used', () => {
    const result = latestDispatchPlanResult([
      { kind: 'assistant', blocks: [{ kind: 'text', text: modelPlan() }] },
      { kind: 'assistant', blocks: [{ kind: 'text', text: '我没有按协议返回 JSON' }] },
    ], team, 'dispatch-plan-1', '登录流程')
    expect(result.plan?.assessment).toBe('我看这是一份产品功能需求。')
    expect(result.error).toBe('模型没有返回可确认的结构化计划')
  })
})
