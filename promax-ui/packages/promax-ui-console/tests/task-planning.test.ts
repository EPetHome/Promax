import { describe, expect, it } from 'vitest'

import {
  fourPartHandoffMarkdown,
  taskPackageTeamPrompt,
} from '../src/client/PromaxWorkspaceShell.tsx'
import {
  calculateTaskPlan,
  slotVisual,
  type TaskPlanningArtifact,
  type TaskPlanningMember,
} from '../src/client/task-planning.ts'

const members: TaskPlanningMember[] = [
  { memberId: 'provided', label: '用户已提供', provides: ['goal'], requires: [] },
  { memberId: 'produced', label: '已经产出', provides: ['scope'], requires: ['goal'] },
  { memberId: 'pending', label: '等待执行', provides: ['success_criteria'], requires: ['goal'] },
  { memberId: 'empty', label: '空但不影响', provides: ['scenario'], requires: [] },
  { memberId: 'gap', label: '存在缺口', provides: ['requirements_priority'], requires: ['constraint'] },
]
const artifacts: TaskPlanningArtifact[] = members.slice(1).map(member => ({
  relativePath: `deliverables/{task_key}/${member.memberId}.md`,
  producedBy: member.memberId,
  required: true,
}))

describe('PRX-001 task planning and handoff contracts', () => {
  it('renders the four confirmed handoff parts and passes only the internal task-package path', () => {
    const handoff = fourPartHandoffMarkdown({
      wanted: '生成脱敏演示方案',
      available: 'SRC-001 覆盖目标',
      startingPoint: ['deliverables/demo/prd.md'],
      knownGaps: ['constraint'],
    })
    expect(handoff.match(/^## /gmu)).toHaveLength(4)
    expect(handoff).toContain('## 要什么')
    expect(handoff).toContain('## 手上有什么')
    expect(handoff).toContain('## 从哪儿接')
    expect(handoff).toContain('## 已知缺口')

    const prompt = taskPackageTeamPrompt('.promax/tasks/demo/task-package.yml')
    expect(prompt).toBe('请读取并执行内部任务包：.promax/tasks/demo/task-package.yml')
    expect(prompt).not.toContain('脱敏演示方案')
    expect(prompt).not.toContain('全链路')
  })

  it('calculates 0 / 1 / N from artifacts and never uses a fixed slot count', () => {
    const common = {
      taskKey: 'demo',
      members,
      artifacts,
      coverage: [{ sourceId: 'SRC-001', informationKey: 'goal' as const, locator: 'demo.md 第 1 行' }],
    }
    expect(calculateTaskPlan({ ...common, requestedArtifactPaths: [] })).toMatchObject({ tier: 'draft', requestedArtifactPaths: [], supportingArtifactPaths: [], artifactPaths: [] })
    expect(calculateTaskPlan({
      taskKey: 'demo',
      members: [members[2]!],
      artifacts: [artifacts[1]!],
      coverage: common.coverage,
      requestedArtifactPaths: [artifacts[1]!.relativePath],
    })).toMatchObject({ tier: 'single', requestedArtifactPaths: ['deliverables/demo/pending.md'], supportingArtifactPaths: [], artifactPaths: ['deliverables/demo/pending.md'] })
    const many = calculateTaskPlan({
      ...common,
      requestedArtifactPaths: [artifacts[0]!.relativePath, artifacts[1]!.relativePath, artifacts[3]!.relativePath],
      producedArtifactPaths: [artifacts[0]!.relativePath],
    })
    expect(many.tier).toBe('team')
    expect(many.requestedArtifactPaths).toEqual([
      'deliverables/demo/produced.md',
      'deliverables/demo/pending.md',
      'deliverables/demo/gap.md',
    ])
    expect(many.supportingArtifactPaths).toEqual([])
    expect(many.slots).toHaveLength(members.length)
    expect(many.slots).not.toHaveLength(7)
    expect(many.slots).not.toHaveLength(8)
    expect(many.slots.map(slot => slot.status)).toEqual([
      'provided', 'produced', 'pending', 'empty_non_blocking', 'gap',
    ])
  })

  it('keeps requested finals separate from mechanically added support outputs', () => {
    const plan = calculateTaskPlan({
      taskKey: 'demo',
      members: [
        { memberId: 'support', label: '支撑', provides: ['constraint'], requires: ['goal'] },
        { memberId: 'final', label: '最终', provides: ['scope'], requires: ['goal', 'constraint'] },
      ],
      artifacts: [
        { relativePath: 'deliverables/{task_key}/support.md', producedBy: 'support', required: true },
        { relativePath: 'deliverables/{task_key}/prd.md', producedBy: 'final', required: true },
      ],
      requestedArtifactPaths: ['deliverables/{task_key}/prd.md'],
      coverage: [{ sourceId: 'SRC-001', informationKey: 'goal', locator: 'source.md 第 1 行' }],
    })
    expect(plan).toMatchObject({
      tier: 'team',
      requestedArtifactPaths: ['deliverables/demo/prd.md'],
      supportingArtifactPaths: ['deliverables/demo/support.md'],
      artifactPaths: ['deliverables/demo/prd.md', 'deliverables/demo/support.md'],
    })
  })

  it('maps five states to four visual tones and distinguishes empty from gap with text and icons', () => {
    const visuals = (['provided', 'produced', 'pending', 'empty_non_blocking', 'gap'] as const).map(slotVisual)
    expect(new Set(visuals.map(item => item.tone))).toEqual(new Set(['green', 'blue', 'gray', 'yellow']))
    expect(visuals[3]).toMatchObject({ label: '空 · 不影响', icon: 'close', tone: 'gray' })
    expect(visuals[4]).toMatchObject({ label: '缺口', icon: 'shield', tone: 'yellow' })
    expect(visuals[3]?.description).not.toBe(visuals[4]?.description)
  })
})
