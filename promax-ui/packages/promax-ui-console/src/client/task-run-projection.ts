import type { ConsoleTaskStateResponse } from '@promax/contracts'

import type { SessionListState } from './PromaxWorkspaceShell.tsx'
import type { TaskSlotView } from './task-planning.ts'
import type { PromaxTeam, TeamSessionBinding } from './team-state.ts'

export type TaskRunPhase = 'planned' | 'running' | 'stopping' | 'cancelled' | 'judging' | 'completed' | 'blocked'
export type TaskRunMemberState = 'idle' | 'running' | 'done' | 'blocked'
export type TaskRunArtifactState = 'pending' | 'produced' | 'judged'
export type TaskRunJudgeState = 'pending' | 'running' | 'pass' | 'fail' | 'appealed' | 'human_required' | 'force_released'
export type TaskRunCancellationState = 'running' | 'stop_requested' | 'draining' | 'cancelled' | 'failed_to_stop'

export interface TaskRunFileSnapshot {
  taskKey: string
  parentSessionId: string
  cancellation: TaskRunCancellationState
  runEpoch: number
  artifactStates: Array<{ path: string; exists: boolean; nonEmpty: boolean }>
  judge: { path: string; state: 'absent' | 'pass' | 'fail' | 'appealed' | 'human_required' | 'force_released' | 'unverified'; exists: boolean }
  observedAt: string
}

export interface TaskRunProjection {
  taskKey: string
  parentSessionId: string
  coverageRevision: number
  phase: TaskRunPhase
  cancellation: { state: TaskRunCancellationState; runEpoch: number }
  slots: TaskSlotView[]
  members: Record<string, { state: TaskRunMemberState; childSessionIds: string[]; attempt: number }>
  artifacts: Record<string, { state: TaskRunArtifactState; requested: boolean; memberId: string }>
  judge: { state: TaskRunJudgeState; round?: number }
}

export interface StructuredConversationSnapshot {
  nodes: readonly unknown[]
  running: boolean
  runningCalls?: ReadonlyArray<{ callId?: string; name?: string; argsRaw?: string }>
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function contentText(value: unknown): string | undefined {
  const block = recordOf(value)
  return block?.type === 'text' && typeof block.text === 'string' ? block.text : undefined
}

function startedChildId(node: Record<string, unknown>): string | undefined {
  if (node.kind !== 'tool-result' || node.isError === true || !Array.isArray(node.content)) return undefined
  if (node.content.length !== 1) return undefined
  const text = contentText(node.content[0])
  const match = text === undefined ? undefined : /^started subagent ([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/u.exec(text)
  return match?.[1]
}

function memberToolLifecycle(team: PromaxTeam, snapshot: StructuredConversationSnapshot | undefined, sessions: SessionListState | undefined): Record<string, { childSessionIds: string[]; attempt: number; running: boolean; failed: boolean }> {
  const memberIds = new Set(team.members.map(member => member.memberId))
  const childIds = new Map<string, Set<string>>()
  const attempts = new Map<string, Set<string>>()
  const failed = new Set<string>()
  for (const memberId of memberIds) {
    childIds.set(memberId, new Set())
    attempts.set(memberId, new Set())
  }
  for (const raw of snapshot?.nodes ?? []) {
    const node = recordOf(raw)
    const call = recordOf(node?.call)
    const name = typeof call?.name === 'string' ? call.name : ''
    if (node?.kind !== 'tool-result' || !memberIds.has(name)) continue
    if (typeof node.callId === 'string') attempts.get(name)?.add(node.callId)
    const childId = startedChildId(node)
    if (childId !== undefined) childIds.get(name)?.add(childId)
    if (node.isError === true) failed.add(name)
  }
  for (const call of snapshot?.runningCalls ?? []) {
    if (typeof call.name !== 'string' || !memberIds.has(call.name)) continue
    attempts.get(call.name)?.add(typeof call.callId === 'string' ? call.callId : `running:${call.name}`)
  }
  return Object.fromEntries([...memberIds].map(memberId => {
    const ids = [...(childIds.get(memberId) ?? [])].sort()
    const runningByChild = ids.some(id => sessions?.byId[id]?.running === true)
    const runningByCall = snapshot?.runningCalls?.some(call => call.name === memberId) === true
    return [memberId, { childSessionIds: ids, attempt: attempts.get(memberId)?.size ?? 0, running: runningByChild || runningByCall, failed: failed.has(memberId) }]
  }))
}

function materializedPath(template: string, taskKey: string): string {
  return template.replaceAll('{task_key}', taskKey)
}

function liveSlots(binding: TeamSessionBinding, taskState: ConsoleTaskStateResponse | undefined): TaskSlotView[] {
  if (taskState !== undefined && taskState.session_id === binding.sessionId && taskState.task_key === binding.taskKey) {
    return taskState.slots.map(slot => ({ ...slot }))
  }
  // A handoff snapshot is planning evidence only. Never replay its produced state as live state.
  return (binding.slots ?? []).map(slot => ({ ...slot, status: slot.status === 'produced' ? 'pending' : slot.status }))
}

function judgeState(file: TaskRunFileSnapshot | undefined, judgeRunning: boolean): TaskRunJudgeState {
  if (file?.judge.state === 'pass' || file?.judge.state === 'fail' || file?.judge.state === 'appealed' || file?.judge.state === 'human_required' || file?.judge.state === 'force_released') return file.judge.state
  return judgeRunning ? 'running' : 'pending'
}

/** One correctness projection. It intentionally accepts no transcript text. */
export function taskRunProjectionOf(input: {
  team: PromaxTeam
  binding: TeamSessionBinding
  taskState?: ConsoleTaskStateResponse
  files?: TaskRunFileSnapshot
  snapshot?: StructuredConversationSnapshot
  sessions?: SessionListState
}): TaskRunProjection {
  const { team, binding } = input
  if (binding.taskKey === undefined || binding.coverageRevision === undefined || binding.artifactPaths === undefined) throw new Error('任务运行投影缺少冻结 binding')
  if (input.files !== undefined && (input.files.taskKey !== binding.taskKey || input.files.parentSessionId !== binding.sessionId)) throw new Error('任务文件快照与当前 task/session 不一致')
  const slots = liveSlots(binding, input.taskState)
  const lifecycle = memberToolLifecycle(team, input.snapshot, input.sessions)
  const requested = new Set((binding.requestedArtifactPaths ?? []).map(path => materializedPath(path, binding.taskKey!)))
  const exactFiles = new Map(input.files?.artifactStates.map(row => [row.path, row]) ?? [])
  const teamArtifacts = new Map(team.artifacts.map(artifact => [materializedPath(artifact.relativePath, binding.taskKey!), artifact]))
  const ownerProduced = new Set(slots.filter(slot => slot.status === 'produced').map(slot => slot.member_id))
  const plannedCountByOwner = new Map<string, number>()
  for (const path of binding.artifactPaths) {
    const owner = teamArtifacts.get(path)?.producedBy
    if (owner !== undefined) plannedCountByOwner.set(owner, (plannedCountByOwner.get(owner) ?? 0) + 1)
  }
  const artifacts: TaskRunProjection['artifacts'] = {}
  for (const path of binding.artifactPaths) {
    const definition = teamArtifacts.get(path)
    if (definition === undefined) throw new Error(`任务运行投影遇到 TeamRevision 未声明的产物：${path}`)
    const produced = exactFiles.get(path)?.nonEmpty === true || ownerProduced.has(definition.producedBy) && plannedCountByOwner.get(definition.producedBy) === 1
    const requestedArtifact = requested.has(path)
    const currentJudge = judgeState(input.files, lifecycle.quality_judge?.running === true)
    artifacts[path] = {
      state: produced && requestedArtifact && ['pass', 'force_released'].includes(currentJudge) ? 'judged' : produced ? 'produced' : 'pending',
      requested: requestedArtifact,
      memberId: definition.producedBy,
    }
  }
  const judge = judgeState(input.files, lifecycle.quality_judge?.running === true)
  const members: TaskRunProjection['members'] = {}
  for (const member of team.members) {
    const life = lifecycle[member.memberId] ?? { childSessionIds: [], attempt: 0, running: false, failed: false }
    const owned = Object.values(artifacts).filter(artifact => artifact.memberId === member.memberId)
    members[member.memberId] = {
      state: life.running ? 'running' : life.failed ? 'blocked' : owned.length > 0 && owned.every(artifact => artifact.state !== 'pending') ? 'done' : 'idle',
      childSessionIds: life.childSessionIds,
      attempt: life.attempt,
    }
  }
  if (members.quality_judge !== undefined) {
    members.quality_judge.state = judge === 'running' ? 'running' : judge === 'pending' ? 'idle' : judge === 'pass' ? 'done' : 'blocked'
  }
  const cancellationState = input.files?.cancellation ?? binding.runState ?? 'running'
  const runEpoch = input.files?.runEpoch ?? binding.runEpoch ?? 1
  const phase: TaskRunPhase = cancellationState === 'cancelled'
    ? 'cancelled'
    : cancellationState === 'stop_requested' || cancellationState === 'draining'
      ? 'stopping'
      : cancellationState === 'failed_to_stop'
        ? 'blocked'
        : judge === 'running'
          ? 'judging'
          : judge === 'pass' || judge === 'force_released'
            ? 'completed'
            : judge === 'fail' || judge === 'appealed' || judge === 'human_required'
              ? 'blocked'
              : Object.values(members).some(member => member.state === 'running') ? 'running' : 'planned'
  return {
    taskKey: binding.taskKey,
    parentSessionId: binding.sessionId,
    coverageRevision: input.taskState?.coverage_revision ?? binding.coverageRevision,
    phase,
    cancellation: { state: cancellationState, runEpoch },
    slots,
    members,
    artifacts,
    judge: { state: judge },
  }
}
