export const INFORMATION_KEYS = [
  'goal', 'target_user', 'scenario', 'pain_point', 'scope', 'constraint',
  'success_criteria', 'competitive_difference', 'requirements_priority',
] as const

export type InformationKey = typeof INFORMATION_KEYS[number]
export type TaskTier = 'draft' | 'single' | 'team'
export type TaskSlotStatus = 'provided' | 'produced' | 'pending' | 'empty_non_blocking' | 'gap'

export const INFORMATION_KEY_LABELS: Record<InformationKey, string> = {
  goal: '目标',
  target_user: '目标用户',
  scenario: '场景',
  pain_point: '痛点',
  scope: '范围',
  constraint: '约束',
  success_criteria: '成功标准',
  competitive_difference: '竞品差异',
  requirements_priority: '需求条目与优先级',
}

export interface TaskPlanningMember {
  memberId: string
  label: string
  provides: InformationKey[]
  requires: InformationKey[]
}

export interface TaskPlanningArtifact {
  relativePath: string
  producedBy: string
  required: boolean
}

export interface TaskCoverageFact {
  sourceId: string
  informationKey: InformationKey
  locator: string
}

export interface TaskSlotSatisfaction {
  source_id: string
  information_key: InformationKey
  locator: string
}

export interface TaskSlotView {
  slot_id: string
  member_id: string
  label: string
  status: TaskSlotStatus
  provides: InformationKey[]
  requires: InformationKey[]
  satisfied_by: TaskSlotSatisfaction[]
  missing: InformationKey[]
}

export interface TaskPlan {
  tier: TaskTier
  memberIds: string[]
  requestedArtifactPaths: string[]
  supportingArtifactPaths: string[]
  artifactPaths: string[]
  unresolved: InformationKey[]
  slots: TaskSlotView[]
}

export interface SlotVisual {
  tone: 'green' | 'blue' | 'gray' | 'yellow'
  icon: 'check' | 'artifact' | 'activity' | 'close' | 'shield'
  label: '用户提供' | '本次产出' | '待跑' | '空 · 不影响' | '缺口'
  description: string
}

export function slotVisual(status: TaskSlotStatus): SlotVisual {
  if (status === 'provided') return { tone: 'green', icon: 'check', label: '用户提供', description: '已由经确认的输入材料覆盖' }
  if (status === 'produced') return { tone: 'green', icon: 'artifact', label: '本次产出', description: '本次任务已经生成对应产物' }
  if (status === 'pending') return { tone: 'blue', icon: 'activity', label: '待跑', description: '本次任务计划执行' }
  if (status === 'empty_non_blocking') return { tone: 'gray', icon: 'close', label: '空 · 不影响', description: '当前没有内容，但下游不依赖这一槽位' }
  return { tone: 'yellow', icon: 'shield', label: '缺口', description: '下游需要的信息仍没有可定位来源' }
}

function materialize(path: string, taskKey: string): string {
  return path.replaceAll('{task_key}', taskKey)
}

function plannedRequirements(
  members: readonly TaskPlanningMember[],
  plannedMemberIds: ReadonlySet<string>,
  coveredKeys: ReadonlySet<InformationKey>,
): { missingByMember: Map<string, InformationKey[]>; missingKeys: Set<InformationKey> } {
  const missingByMember = new Map<string, InformationKey[]>()
  const missingKeys = new Set<InformationKey>()
  for (const member of members.filter(item => plannedMemberIds.has(item.memberId))) {
    const otherPlannedProvides = new Set(members
      .filter(item => item.memberId !== member.memberId && plannedMemberIds.has(item.memberId))
      .flatMap(item => item.provides))
    const missing = member.requires.filter(key => !coveredKeys.has(key) && !otherPlannedProvides.has(key))
    missingByMember.set(member.memberId, missing)
    for (const key of missing) missingKeys.add(key)
  }
  return { missingByMember, missingKeys }
}

/** Browser/runtime mirror of the harness's deterministic provides/requires difference calculation. */
export function calculateTaskPlan(input: {
  taskKey: string
  members: readonly TaskPlanningMember[]
  artifacts: readonly TaskPlanningArtifact[]
  requestedArtifactPaths: readonly string[]
  coverage: readonly TaskCoverageFact[]
  producedArtifactPaths?: readonly string[]
}): TaskPlan {
  const memberOrder = new Map(input.members.map((member, index) => [member.memberId, index]))
  const artifacts = input.artifacts.map(artifact => ({ ...artifact, relativePath: materialize(artifact.relativePath, input.taskKey) }))
  const artifactsByPath = new Map<string, TaskPlanningArtifact>()
  for (const artifact of artifacts) {
    if (artifactsByPath.has(artifact.relativePath)) throw new Error(`团队产物路径重复：${artifact.relativePath}`)
    artifactsByPath.set(artifact.relativePath, artifact)
  }
  const requested = [...new Set(input.requestedArtifactPaths.map(path => materialize(path, input.taskKey)))]
  const requestedArtifacts = requested.map(path => {
    const artifact = artifactsByPath.get(path)
    if (artifact === undefined || !memberOrder.has(artifact.producedBy)) throw new Error(`请求产物不属于业务成员：${path}`)
    return artifact
  })
  const plannedMemberIds = new Set(requestedArtifacts.map(artifact => artifact.producedBy))
  const coveredKeys = new Set(input.coverage.map(item => item.informationKey))

  while (plannedMemberIds.size > 0) {
    const { missingKeys } = plannedRequirements(input.members, plannedMemberIds, coveredKeys)
    if (missingKeys.size === 0) break
    const candidates = input.members
      .filter(member => !plannedMemberIds.has(member.memberId))
      .map(member => ({ member, score: member.provides.filter(key => missingKeys.has(key)).length }))
      .filter(candidate => candidate.score > 0)
      .sort((left, right) => right.score - left.score
        || (memberOrder.get(left.member.memberId) ?? 0) - (memberOrder.get(right.member.memberId) ?? 0))
    if (candidates.length === 0) break
    plannedMemberIds.add(candidates[0]!.member.memberId)
  }

  const { missingByMember, missingKeys } = plannedRequirements(input.members, plannedMemberIds, coveredKeys)
  const plannedArtifacts = [...requestedArtifacts]
  const plannedPaths = new Set(plannedArtifacts.map(artifact => artifact.relativePath))
  for (const member of input.members.filter(item => plannedMemberIds.has(item.memberId))) {
    if (requestedArtifacts.some(artifact => artifact.producedBy === member.memberId)) continue
    const owned = artifacts.filter(artifact => artifact.producedBy === member.memberId)
    const required = owned.filter(artifact => artifact.required)
    for (const artifact of required.length > 0 ? required : owned.slice(0, 1)) {
      if (!plannedPaths.has(artifact.relativePath)) {
        plannedPaths.add(artifact.relativePath)
        plannedArtifacts.push(artifact)
      }
    }
  }

  const produced = new Set((input.producedArtifactPaths ?? []).map(path => materialize(path, input.taskKey)))
  const slots = input.members.map(member => {
    const ownedPaths = artifacts.filter(artifact => artifact.producedBy === member.memberId).map(artifact => artifact.relativePath)
    const isProduced = ownedPaths.some(path => produced.has(path))
    const isPlanned = plannedMemberIds.has(member.memberId)
    const isProvided = member.provides.length > 0 && member.provides.every(key => coveredKeys.has(key))
    const missing = missingByMember.get(member.memberId) ?? []
    const status: TaskSlotStatus = isProduced
      ? 'produced'
      : isPlanned ? (missing.some(key => missingKeys.has(key)) ? 'gap' : 'pending')
        : isProvided ? 'provided' : 'empty_non_blocking'
    const relevant = new Set([...member.provides, ...member.requires])
    return {
      slot_id: member.memberId,
      member_id: member.memberId,
      label: member.label,
      status,
      provides: [...member.provides],
      requires: [...member.requires],
      satisfied_by: input.coverage
        .filter(item => relevant.has(item.informationKey))
        .map(item => ({ source_id: item.sourceId, information_key: item.informationKey, locator: item.locator })),
      missing: [...missing],
    }
  })
  return {
    tier: plannedArtifacts.length === 0 ? 'draft' : plannedArtifacts.length === 1 ? 'single' : 'team',
    memberIds: input.members.filter(member => plannedMemberIds.has(member.memberId)).map(member => member.memberId),
    requestedArtifactPaths: requestedArtifacts.map(artifact => artifact.relativePath),
    supportingArtifactPaths: plannedArtifacts
      .filter(artifact => !requestedArtifacts.includes(artifact))
      .map(artifact => artifact.relativePath),
    artifactPaths: plannedArtifacts.map(artifact => artifact.relativePath),
    unresolved: INFORMATION_KEYS.filter(key => missingKeys.has(key)),
    slots,
  }
}
