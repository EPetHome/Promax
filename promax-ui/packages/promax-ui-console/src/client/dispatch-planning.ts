import type { PromaxTeam, TeamArtifactDefinition, TeamMember } from './team-state.ts'
import type { TaskAttachmentContext } from './task-attachments.ts'

export const DISPATCH_PLAN_PROTOCOL = 'promax.dispatch-plan/v1'
export const DISPATCH_PLAN_START = 'PROMAX_DISPATCH_PLAN_V1_START'
export const DISPATCH_PLAN_END = 'PROMAX_DISPATCH_PLAN_V1_END'

export interface DispatchPlanMember {
  memberId: string
  selected: boolean
  reason: string
  deliverables: string[]
}

export interface DispatchPlan {
  protocol: typeof DISPATCH_PLAN_PROTOCOL
  planId: string
  assessment: string
  members: DispatchPlanMember[]
}

export interface DispatchPlanResolution {
  plan?: DispatchPlan
  error?: string
}

const MAX_PLAN_ASSESSMENT_LENGTH = 4_000
const MAX_MEMBER_REASON_LENGTH = 2_000

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function materializedArtifacts(team: PromaxTeam, taskKey: string): Map<string, TeamArtifactDefinition[]> {
  const byMember = new Map<string, TeamArtifactDefinition[]>()
  for (const artifact of team.artifacts) {
    const current = byMember.get(artifact.producedBy) ?? []
    current.push({ ...artifact, relativePath: artifact.relativePath.replaceAll('{task_key}', taskKey) })
    byMember.set(artifact.producedBy, current)
  }
  return byMember
}

function checkedPlanMember(
  value: unknown,
  expected: TeamMember,
  allowedArtifacts: readonly TeamArtifactDefinition[],
): DispatchPlanMember {
  const row = recordOf(value)
  if (row === undefined || row.member_id !== expected.memberId || typeof row.selected !== 'boolean') {
    throw new Error(`模型计划缺少成员 ${expected.displayName} 的有效判断`)
  }
  const reason = typeof row.reason === 'string' ? row.reason.trim() : ''
  if (reason === '') throw new Error(`模型计划没有说明 ${expected.displayName} 的具体理由`)
  if (reason.length > MAX_MEMBER_REASON_LENGTH) throw new Error(`模型对 ${expected.displayName} 的判断异常冗长，请重新生成`)
  if (!Array.isArray(row.deliverables) || row.deliverables.some(item => typeof item !== 'string')) {
    throw new Error(`模型计划没有说明 ${expected.displayName} 会产出什么文件`)
  }
  const allowed = new Set(allowedArtifacts.map(artifact => artifact.relativePath))
  const stated = [...new Set(row.deliverables.map(item => String(item).trim()))]
  const fixedJudge = expected.memberId === 'quality_judge'
  if ((row.selected || fixedJudge) && stated.length === 0 && allowedArtifacts.length === 0) throw new Error(`模型计划没有说明 ${expected.displayName} 会产出什么文件`)
  const deliverables = stated.length > 0 ? stated : allowedArtifacts.map(artifact => artifact.relativePath)
  if (deliverables.length === 0) throw new Error(`当前团队版本没有定义 ${expected.displayName} 的产出文件`)
  if (deliverables.some(path => !allowed.has(path))) throw new Error(`模型计划为 ${expected.displayName} 返回了团队版本之外的文件`)
  return {
    memberId: expected.memberId,
    selected: fixedJudge || row.selected,
    reason: fixedJudge && !row.selected ? '所有任务都必须由独立 Judge 检查最终产物。' : reason,
    deliverables,
  }
}

/** Parses only the model's framed JSON response; it never infers selection from demand keywords. */
export function parseDispatchPlan(text: string, team: PromaxTeam, planId: string, taskKey: string): DispatchPlan {
  const start = text.lastIndexOf(DISPATCH_PLAN_START)
  const end = start < 0 ? -1 : text.indexOf(DISPATCH_PLAN_END, start + DISPATCH_PLAN_START.length)
  if (start < 0 || end < 0) throw new Error('模型没有返回可确认的结构化计划')
  const raw = text.slice(start + DISPATCH_PLAN_START.length, end).trim()
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('模型返回的计划不是有效 JSON')
  }
  const row = recordOf(value)
  if (row?.protocol !== DISPATCH_PLAN_PROTOCOL || row.plan_id !== planId) throw new Error('模型计划与当前会话不匹配')
  const assessment = typeof row.assessment === 'string' ? row.assessment.trim() : ''
  if (assessment === '') throw new Error('模型计划缺少对本次需求的判断')
  if (assessment.length > MAX_PLAN_ASSESSMENT_LENGTH) throw new Error('模型对本次需求的判断异常冗长，请重新生成')
  if (!Array.isArray(row.members) || row.members.length !== team.members.length) throw new Error('模型计划没有逐个判断全部团队成员')
  const rowsById = new Map<string, unknown>()
  for (const candidate of row.members) {
    const candidateRow = recordOf(candidate)
    const memberId = typeof candidateRow?.member_id === 'string' ? candidateRow.member_id : ''
    if (memberId === '' || rowsById.has(memberId)) throw new Error('模型计划的成员名单无效或重复')
    rowsById.set(memberId, candidate)
  }
  const artifacts = materializedArtifacts(team, taskKey)
  const members = team.members.map(member => checkedPlanMember(rowsById.get(member.memberId), member, artifacts.get(member.memberId) ?? []))
  return { protocol: DISPATCH_PLAN_PROTOCOL, planId, assessment, members }
}

export function latestDispatchPlanResult(nodes: readonly unknown[], team: PromaxTeam, planId: string, taskKey: string): DispatchPlanResolution {
  const assistantTexts = nodes.flatMap(node => {
    const row = recordOf(node)
    if (row?.kind !== 'assistant' || !Array.isArray(row.blocks)) return []
    const text = row.blocks.flatMap(block => {
      const item = recordOf(block)
      return item?.kind === 'text' && typeof item.text === 'string' ? [item.text] : []
    }).join('')
    return text.trim() === '' ? [] : [text]
  })
  let latestError: string | undefined
  for (let index = assistantTexts.length - 1; index >= 0; index -= 1) {
    try {
      const plan = parseDispatchPlan(assistantTexts[index]!, team, planId, taskKey)
      return { plan, ...(latestError === undefined ? {} : { error: latestError }) }
    } catch (error) {
      if (latestError === undefined) latestError = error instanceof Error ? error.message : String(error)
    }
  }
  return latestError === undefined ? {} : { error: latestError }
}

export function latestDispatchPlan(nodes: readonly unknown[], team: PromaxTeam, planId: string, taskKey: string): DispatchPlan | undefined {
  return latestDispatchPlanResult(nodes, team, planId, taskKey).plan
}

function rosterForPrompt(team: PromaxTeam, taskKey: string): Array<Record<string, unknown>> {
  const artifacts = materializedArtifacts(team, taskKey)
  return team.members.map(member => ({
    member_id: member.memberId,
    display_name: member.displayName,
    responsibility: member.objective,
    allowed_deliverables: (artifacts.get(member.memberId) ?? []).map(artifact => artifact.relativePath),
  }))
}

export function dispatchPlanningMessage(input: {
  demand: string
  attachmentPaths: readonly string[]
  attachmentContexts?: readonly TaskAttachmentContext[]
  team: PromaxTeam
  planId: string
  taskKey: string
}): string {
  const request = {
    protocol: DISPATCH_PLAN_PROTOCOL,
    plan_id: input.planId,
    task_key: input.taskKey,
    demand: input.demand.trim(),
    attachment_paths: [...input.attachmentPaths],
    attachment_context: (input.attachmentContexts ?? []).map(attachment => ({
      path: attachment.path,
      original_name: attachment.name,
      media_type: attachment.mediaType,
      bytes: attachment.bytes,
      readable_path: attachment.readablePath,
      text_characters: attachment.textCharacters,
      page_count: attachment.pageCount,
      excerpt_truncated: attachment.truncated,
      text_excerpt: attachment.excerpt,
    })),
    roster: rosterForPrompt(input.team, input.taskKey),
  }
  return `这是一次调度计划请求，不是执行请求。附件正文已经由 Promax 预解析到 attachment_context；请结合需求和正文摘录真实判断最小必要成员，不要只根据文件名猜测。不要调用任何工具、不要启动成员、不要创建或修改文件。\n\n逐个判断 roster 中的全部成员。quality_judge 是固定成员，必须 selected=true，且必须登记它的 judge.md；其他业务成员按最小必要原则选择。assessment 和 reason 应简洁具体。selected=false 时，reason 必须结合本次输入说明为什么不叫；禁止写“按需调度”“不需要”这类空话。selected=true 时，reason 说明它在本次任务中的具体职责。selected=true 的 deliverables 只能从该成员的 allowed_deliverables 中选择，且至少一项；selected=false 时可以返回空数组，页面会用当前团队版本的 allowed_deliverables 展示勾选后会产出的文件。\n\n只输出下面两个标记及其中一份 JSON，不要输出 Markdown 围栏或其他文字：\n${DISPATCH_PLAN_START}\n{"protocol":"${DISPATCH_PLAN_PROTOCOL}","plan_id":"${input.planId}","assessment":"我看这是一份……","members":[{"member_id":"...","selected":true,"reason":"...","deliverables":["..."]}]}\n${DISPATCH_PLAN_END}\n\n本次请求数据：\n${JSON.stringify(request, null, 2)}`
}

export function dispatchExecutionMessage(input: {
  demand: string
  attachmentPaths: readonly string[]
  plan: DispatchPlan
  selectedMemberIds: readonly string[]
  taskKey: string
}): string {
  const selected = new Set([...input.selectedMemberIds, 'quality_judge'])
  if (!input.plan.members.some(member => member.memberId === 'quality_judge')) throw new Error('调度计划缺少固定 Judge')
  if (!input.plan.members.some(member => member.memberId !== 'quality_judge' && selected.has(member.memberId))) throw new Error('至少选择一名业务成员')
  const assignments = input.plan.members
    .filter(member => selected.has(member.memberId))
    .map(member => ({ member_id: member.memberId, deliverables: member.deliverables }))
  return `PROMAX_DISPATCH_EXECUTE_V1\n${JSON.stringify({
    plan_id: input.plan.planId,
    task_key: input.taskKey,
    demand: input.demand.trim(),
    attachment_paths: [...input.attachmentPaths],
    task_package_path: `.promax/tasks/${input.taskKey}/task-package.yml`,
    confirmed_member_ids: input.plan.members.filter(member => selected.has(member.memberId)).map(member => member.memberId),
    assignments,
  }, null, 2)}\n\n用户已经确认以上名单。现在才开始执行：只能调用 confirmed_member_ids 中的成员，不得增加、删除或替换；运行时会机械拒绝名单外成员。先让业务成员按 assignments 交付文件；业务文件全部落盘后，必须让 quality_judge 只从 task_package_path 指定的精确任务包进入，独立检查其中登记的业务产物并写入其 assignment 中的 judge.md。judge.md 未产生不得汇总为完成。`
}
