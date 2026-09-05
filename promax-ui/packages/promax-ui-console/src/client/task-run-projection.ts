import type { PromaxTeam, TeamSessionBinding } from './team-state.ts'

export type TaskRunPhase = 'running' | 'stopping' | 'cancelled' | 'repairing' | 'judging' | 'completed' | 'blocked'
export type TaskRunMemberState = 'idle' | 'running' | 'done' | 'blocked'
export type TaskRunArtifactState = 'pending' | 'produced' | 'judged'
export type TaskRunJudgeState = 'pending' | 'running' | 'pass' | 'fail' | 'appealed' | 'human_required' | 'force_released' | 'unverified'
export type TaskRunCancellationState = 'running' | 'stop_requested' | 'draining' | 'cancelled' | 'completed' | 'failed'
export type TaskJudgeRepairState = 'repairing' | 'judging' | 'passed' | 'exhausted'

export interface TaskJudgeRepairSnapshot {
  state: TaskJudgeRepairState
  round: number
  maxRounds: number
  reasons: string[]
  updatedAt: string
}

export interface TaskDeliverableFile {
  name: string
  relativePath: string
  path: string
  bytes: number
  modifiedAt: string
}

export interface TaskHistoryItem {
  sessionId: string
  taskKey: string
  createdAt: string
  status: 'running' | 'completed' | 'failed'
  fileCount: number
  deliverablePath: string
  deliverableFiles: TaskDeliverableFile[]
  judge: TaskRunFileSnapshot['judge']
  observedAt: string
  error?: string
}

export interface TaskRunFileSnapshot {
  taskKey: string
  parentSessionId: string
  createdAt: string
  cancellation: TaskRunCancellationState
  runEpoch: number
  manifestPath: string
  inputManifestPath: string
  confirmedMemberIds: string[]
  artifactStates: Array<{ path: string; memberId: string; exists: boolean; nonEmpty: boolean }>
  deliverablePath: string
  deliverableFiles: TaskDeliverableFile[]
  judge: {
    path: string
    memberId: 'quality_judge'
    state: 'absent' | 'pass' | 'fail' | 'appealed' | 'human_required' | 'force_released' | 'unverified'
    exists: boolean
    nonEmpty: boolean
    reason?: string
  }
  repair?: TaskJudgeRepairSnapshot
  observedAt: string
}

export interface TaskRunProjection {
  taskKey: string
  parentSessionId: string
  manifestPath: string
  phase: TaskRunPhase
  cancellation: { state: TaskRunCancellationState; runEpoch: number }
  members: Record<string, { state: TaskRunMemberState }>
  artifacts: Record<string, { state: TaskRunArtifactState; memberId: string }>
  judge: { state: TaskRunJudgeState; path: string }
  repair?: TaskJudgeRepairSnapshot
}

function materializedPath(template: string, taskKey: string): string {
  return template.replaceAll('{task_key}', taskKey)
}

function projectedJudgeState(files: TaskRunFileSnapshot): TaskRunJudgeState {
  if (files.repair?.state === 'repairing' || files.repair?.state === 'judging') return 'running'
  if (files.repair?.state === 'exhausted') return 'fail'
  if (files.judge.state !== 'absent') return files.judge.state
  return files.cancellation === 'running' ? 'running' : 'pending'
}

/** Projects task status exclusively from the sealed manifest and exact on-disk files. */
export function taskRunProjectionOf(input: {
  team: PromaxTeam
  binding: TeamSessionBinding
  files: TaskRunFileSnapshot
}): TaskRunProjection {
  const { team, binding, files } = input
  if (binding.taskKey === undefined) throw new Error('任务运行投影缺少 task_key')
  if (files.taskKey !== binding.taskKey || files.parentSessionId !== binding.sessionId) throw new Error('任务文件快照与当前 task/session 不一致')
  const confirmed = new Set(files.confirmedMemberIds)
  if (!confirmed.has('quality_judge')) throw new Error('任务 manifest 缺少固定 Judge')
  const teamArtifacts = new Map(team.artifacts.map(artifact => [materializedPath(artifact.relativePath, binding.taskKey!), artifact]))
  const artifacts: TaskRunProjection['artifacts'] = {}
  for (const file of files.artifactStates) {
    const definition = teamArtifacts.get(file.path)
    if (definition === undefined || definition.producedBy !== file.memberId) {
      throw new Error(`任务 manifest 登记了当前 TeamRevision 未声明的产物：${file.path}`)
    }
    artifacts[file.path] = {
      state: file.nonEmpty ? 'produced' : 'pending',
      memberId: file.memberId,
    }
  }
  const judge = projectedJudgeState(files)
  if (judge === 'pass' || judge === 'force_released') {
    for (const artifact of Object.values(artifacts)) {
      if (artifact.state === 'produced') artifact.state = 'judged'
    }
  }
  const members: TaskRunProjection['members'] = {}
  for (const member of team.members) {
    if (!confirmed.has(member.memberId)) continue
    if (member.memberId === 'quality_judge') {
      members[member.memberId] = {
        state: files.repair?.state === 'repairing'
          ? 'idle'
          : judge === 'running'
          ? 'running'
          : judge === 'pass' || judge === 'force_released'
            ? 'done'
            : judge === 'pending'
              ? 'idle'
              : 'blocked',
      }
      continue
    }
    const owned = Object.values(artifacts).filter(artifact => artifact.memberId === member.memberId)
    members[member.memberId] = { state: files.repair?.state === 'repairing' ? 'running' : owned.length > 0 && owned.every(artifact => artifact.state !== 'pending') ? 'done' : 'idle' }
  }
  const allArtifactsProduced = Object.values(artifacts).length > 0 && Object.values(artifacts).every(artifact => artifact.state !== 'pending')
  const phase: TaskRunPhase = files.cancellation === 'completed'
    ? 'completed'
    : files.cancellation === 'failed'
      ? 'blocked'
      : files.cancellation === 'cancelled'
        ? 'cancelled'
        : files.cancellation === 'stop_requested' || files.cancellation === 'draining'
      ? 'stopping'
      : files.repair?.state === 'repairing'
        ? 'repairing'
        : judge === 'pass' || judge === 'force_released'
          ? 'completed'
          : judge === 'fail' || judge === 'appealed' || judge === 'human_required' || judge === 'unverified'
            ? 'blocked'
            : allArtifactsProduced
              ? 'judging'
              : 'running'
  return {
    taskKey: binding.taskKey,
    parentSessionId: binding.sessionId,
    manifestPath: files.manifestPath,
    phase,
    cancellation: { state: files.cancellation, runEpoch: files.runEpoch },
    members,
    artifacts,
    judge: { state: judge, path: files.judge.path },
    ...(files.repair === undefined ? {} : { repair: files.repair }),
  }
}
