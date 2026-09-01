import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

import { createApiProxy } from '../../promax-ui-console/src/host/api-proxy.ts'
import {
  INFORMATION_KEYS,
  calculateTaskPlan,
  type InformationKey,
  type TaskPlanningArtifact,
  type TaskPlanningMember,
  type TaskSlotView,
  type TaskTier,
} from '../../promax-ui-console/src/client/task-planning.ts'

interface WorkspaceRecord {
  id: string
  path: string
  title: string
  sessionIds: readonly string[]
}

interface WorkspaceRegistry {
  create(path: string, title?: string): Promise<WorkspaceRecord>
  get?(workspaceId: string): WorkspaceRecord | undefined
}

interface WebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

interface HostContext {
  workspaceRegistry: WorkspaceRegistry
  webServer: WebServer
  effect(setup: () => void | (() => void), label?: string): void
  on(event: 'webserver/index-inject', listener: (table: Array<Record<string, unknown>>) => void): void
  emit(event: 'promax/decision' | 'promax/task-state', payload: Record<string, unknown>): void
}

export const name = 'promax-workspace-bootstrap'
export const inject = ['workspaceRegistry', 'webServer']

export interface Config {
  apiBaseUrl: string
}

export type TaskRunCancellationState = 'running' | 'stop_requested' | 'draining' | 'cancelled' | 'failed_to_stop'
export type TaskRunJudgeState = 'absent' | 'pass' | 'fail' | 'appealed' | 'human_required' | 'force_released' | 'unverified'

export interface TaskRunFileSnapshot {
  taskKey: string
  parentSessionId: string
  cancellation: TaskRunCancellationState
  runEpoch: number
  artifactStates: Array<{ path: string; exists: boolean; nonEmpty: boolean }>
  judge: { path: string; state: TaskRunJudgeState; exists: boolean }
  observedAt: string
}

const API_PROXY_PREFIX = '/promax-api'
const WORKSPACE_API_PREFIX = '/promax-workspace-api'

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > 1024 * 1024) throw new Error('请求体过大')
    chunks.push(buffer)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('请求体必须是 JSON 对象')
  return value as Record<string, unknown>
}

function writeJson(response: ServerResponse, status: number, value: Record<string, unknown>): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
  })
  response.end(body)
}

function projectNameOf(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === '' || name.length > 80 || name === '.' || name === '..' || /[/\\\0]/u.test(name)) {
    throw new Error('项目组名称格式无效')
  }
  return name
}

const SESSION_SCOPE_MAX_LENGTH = 40

function sessionScopeNameOf(value: unknown): string {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  if (
    name === '' || Array.from(name).length > SESSION_SCOPE_MAX_LENGTH || name === '.' || name === '..'
    || /[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(name) || /[. ]$/u.test(name)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(name)
  ) throw new Error('会话名称不能安全地用作产出目录')
  return name
}

function sessionIdOf(value: unknown): string {
  const sessionId = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(sessionId)) throw new Error('会话标识格式无效')
  return sessionId
}

function numberedSessionScopeName(base: string, ordinal: number): string {
  if (ordinal === 1) return base
  const suffix = `（${String(ordinal)}）`
  const available = SESSION_SCOPE_MAX_LENGTH - Array.from(suffix).length
  return `${Array.from(base).slice(0, available).join('').replace(/[. ]+$/u, '')}${suffix}`
}

/** Claims one immutable per-session output folder; duplicate names receive the same suffix in UI and on disk. */
export async function ensureSessionOutputDirectory(
  workspacePath: string,
  sessionIdValue: string,
  requestedNameValue: string,
): Promise<{ sessionName: string; taskKey: string; relativePath: string }> {
  const root = resolve(workspacePath)
  const sessionId = sessionIdOf(sessionIdValue)
  const requestedName = sessionScopeNameOf(requestedNameValue)
  const mappingDirectory = join(root, '.promax', 'session-scopes')
  const mappingPath = join(mappingDirectory, `${sessionId}.json`)
  await mkdir(mappingDirectory, { recursive: true })

  try {
    const stored = JSON.parse(await readFile(mappingPath, 'utf8')) as { sessionName?: unknown }
    const sessionName = sessionScopeNameOf(stored.sessionName)
    await mkdir(join(root, 'deliverables', sessionName), { recursive: true })
    return { sessionName, taskKey: sessionName, relativePath: join('deliverables', sessionName) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await mkdir(join(root, 'deliverables'), { recursive: true })
  for (let ordinal = 1; ordinal <= 999; ordinal += 1) {
    const sessionName = numberedSessionScopeName(requestedName, ordinal)
    try {
      await mkdir(join(root, 'deliverables', sessionName))
      await writeFile(mappingPath, `${JSON.stringify({ sessionId, sessionName, taskKey: sessionName }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      return { sessionName, taskKey: sessionName, relativePath: join('deliverables', sessionName) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('同名会话产出目录数量超过上限')
}

async function scaffoldProject(path: string): Promise<void> {
  await Promise.all([
    mkdir(join(path, '输入', '草稿'), { recursive: true }),
    mkdir(join(path, '输入', '源文件'), { recursive: true }),
    mkdir(join(path, '产出'), { recursive: true }),
    mkdir(join(path, '.promax', 'drafts'), { recursive: true }),
    mkdir(join(path, '.promax', 'judge'), { recursive: true }),
  ])
  try {
    await writeFile(
      join(path, '.promax', 'source-ledger.md'),
      '# 来源台账\n\n> 由 Promax 管理。团队只读取“输入”，正式结果写入“产出”。\n',
      { encoding: 'utf8', flag: 'wx' },
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export async function ensureProjectWorkspace(
  workspaceRegistry: WorkspaceRegistry,
  root: string,
  projectName: string,
): Promise<WorkspaceRecord> {
  const trimmedName = projectNameOf(projectName)
  const normalizedRoot = resolve(root)
  const workspacePath = resolve(normalizedRoot, trimmedName)
  if (!workspacePath.startsWith(`${normalizedRoot}${sep}`)) throw new Error('项目组路径越界')
  await scaffoldProject(workspacePath)
  return workspaceRegistry.create(workspacePath, trimmedName)
}

export interface TaskPackageWriteInput {
  sessionId: string
  project: string
  taskKey: string
  teamRevisionId: string
  confirmedAt: string
  confirmedHandoff: string
  handoffEdited: boolean
  requestedArtifactPaths: string[]
  coverageInformationKeys: InformationKey[]
  coverageWasOverridden: boolean
  members: TaskPlanningMember[]
  artifacts: TaskPlanningArtifact[]
}

export interface TaskPackageWriteResult {
  taskPackagePath: string
  coveragePath: string
  slotsPath: string
  inputManifestPath: string
  tier: TaskTier
  coverageRevision: number
  artifactPaths: string[]
  slots: TaskSlotView[]
}

function taskKeyOf(value: unknown): string {
  return sessionScopeNameOf(value)
}

function checkedInformationKeys(value: unknown): InformationKey[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !INFORMATION_KEYS.includes(item as InformationKey))) {
    throw new Error('覆盖登记包含未批准的信息项')
  }
  const keys = value as InformationKey[]
  if (new Set(keys).size !== keys.length) throw new Error('覆盖登记信息项不得重复')
  return keys
}

function jsonYaml(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function taskRunControlValue(taskKey: string, sessionId: string, state: TaskRunCancellationState, runEpoch: number, updatedAt: string): Record<string, unknown> {
  return {
    api_version: 'promax.ai/v1alpha2',
    kind: 'TaskRunControl',
    metadata: { task_key: taskKey, session_id: sessionId, updated_at: updatedAt },
    spec: { state, run_epoch: runEpoch },
  }
}

function taskRunControlOf(value: unknown, taskKey: string, sessionId: string): { state: TaskRunCancellationState; runEpoch: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('任务运行控制文件无效')
  const row = value as Record<string, unknown>
  const metadata = typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : undefined
  const spec = typeof row.spec === 'object' && row.spec !== null && !Array.isArray(row.spec) ? row.spec as Record<string, unknown> : undefined
  if (row.kind !== 'TaskRunControl' || metadata?.task_key !== taskKey || metadata.session_id !== sessionId) throw new Error('任务运行控制文件与当前 task/session 不一致')
  const state = spec?.state
  const runEpoch = spec?.run_epoch
  if (!['running', 'stop_requested', 'draining', 'cancelled', 'failed_to_stop'].includes(String(state))) throw new Error('任务运行控制状态无效')
  if (typeof runEpoch !== 'number' || !Number.isSafeInteger(runEpoch) || runEpoch < 1) throw new Error('任务运行 epoch 无效')
  return { state: state as TaskRunCancellationState, runEpoch }
}

async function writeTaskRunControl(path: string, taskKey: string, sessionId: string, state: TaskRunCancellationState, runEpoch: number, updatedAt: string): Promise<void> {
  const temporary = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`
  await writeFile(temporary, jsonYaml(taskRunControlValue(taskKey, sessionId, state, runEpoch, updatedAt)), { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, path)
}

function exactTaskArtifactPath(path: string, taskKey: string): boolean {
  return path.startsWith(`deliverables/${taskKey}/`) && !path.includes('..') && !path.includes('\\')
}

async function fileState(workspace: string, path: string): Promise<{ path: string; exists: boolean; nonEmpty: boolean }> {
  const absolute = resolve(workspace, path)
  if (absolute !== workspace && !absolute.startsWith(`${workspace}${sep}`)) throw new Error(`任务文件越出工作区：${path}`)
  try {
    const info = await lstat(absolute)
    if (info.isSymbolicLink()) throw new Error(`任务文件不得是符号链接：${path}`)
    return { path, exists: info.isFile(), nonEmpty: info.isFile() && info.size > 0 }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, exists: false, nonEmpty: false }
    throw error
  }
}

function judgeStateOf(report: string): TaskRunJudgeState {
  const manual = /\|\s*人工处理\s*\|([^\n|]+)/iu.exec(report)?.[1]?.trim() ?? ''
  if (/人工强制放行|force[-_ ]?release/iu.test(manual)) return 'force_released'
  if (/APPEALED|已?申诉|申诉中/iu.test(manual)) return 'appealed'
  if (/HUMAN_REQUIRED|等待人工|需要人工|需人工|人工复核|交由人工/iu.test(manual)) return 'human_required'
  const verdict = /(?:整体\s*verdict|overall\s+verdict)\s*[：:]\s*\**\s*(PASS|FAIL|APPEALED|HUMAN_REQUIRED)\b/iu.exec(report)?.[1]?.toUpperCase()
  if (verdict === 'PASS') return 'pass'
  if (verdict === 'FAIL') return 'fail'
  if (verdict === 'APPEALED') return 'appealed'
  if (verdict === 'HUMAN_REQUIRED') return 'human_required'
  return 'unverified'
}

async function taskWorkspace(workspacePath: string, sessionId: string, taskKey: string): Promise<string> {
  const workspace = resolve(workspacePath)
  const scope = JSON.parse(await readFile(join(workspace, '.promax', 'session-scopes', `${sessionId}.json`), 'utf8')) as Record<string, unknown>
  if (scope.sessionName !== taskKey) throw new Error('当前父 session 与 task_key 不一致')
  const taskPackage = JSON.parse(await readFile(join(workspace, '.promax', 'tasks', taskKey, 'task-package.yml'), 'utf8')) as { metadata?: { task_key?: unknown } }
  if (taskPackage.metadata?.task_key !== taskKey) throw new Error('当前任务包与 task_key 不一致')
  return workspace
}

/** Reads only exact current-task control, planned artifacts, and Judge file. */
export async function readTaskRunFiles(workspacePath: string, input: { sessionId: string; taskKey: string; artifactPaths: string[] }): Promise<TaskRunFileSnapshot> {
  const sessionId = sessionIdOf(input.sessionId)
  const taskKey = taskKeyOf(input.taskKey)
  if (new Set(input.artifactPaths).size !== input.artifactPaths.length || input.artifactPaths.some(path => !exactTaskArtifactPath(path, taskKey))) throw new Error('任务产物计划不属于当前 task_key')
  const workspace = await taskWorkspace(workspacePath, sessionId, taskKey)
  const controlPath = join(workspace, '.promax', 'tasks', taskKey, 'run-control.yml')
  const control = taskRunControlOf(JSON.parse(await readFile(controlPath, 'utf8')) as unknown, taskKey, sessionId)
  const artifactStates = await Promise.all(input.artifactPaths.map(path => fileState(workspace, path)))
  const judgePath = `.promax/judge/${taskKey}/judge.md`
  const judgeFile = await fileState(workspace, judgePath)
  const state = judgeFile.nonEmpty ? judgeStateOf(await readFile(resolve(workspace, judgePath), 'utf8')) : 'absent'
  return { taskKey, parentSessionId: sessionId, cancellation: control.state, runEpoch: control.runEpoch, artifactStates, judge: { path: judgePath, state, exists: judgeFile.exists }, observedAt: new Date().toISOString() }
}

const TASK_RUN_TRANSITIONS: Record<TaskRunCancellationState, readonly TaskRunCancellationState[]> = {
  running: ['running', 'stop_requested'],
  stop_requested: ['stop_requested', 'draining', 'failed_to_stop'],
  draining: ['draining', 'cancelled', 'failed_to_stop'],
  cancelled: ['cancelled'],
  // A failed stop is not a successful terminal cancellation. The user may
  // explicitly retry stopping the same run epoch, while the runtime guard
  // keeps new member routes latched off throughout the retry.
  failed_to_stop: ['failed_to_stop', 'stop_requested'],
}

/** Persists one idempotent cancellation transition before/after runtime work. */
export async function controlTaskRunFiles(workspacePath: string, input: { sessionId: string; taskKey: string; state: TaskRunCancellationState; runEpoch: number; updatedAt: string }): Promise<{ state: TaskRunCancellationState; runEpoch: number; updatedAt: string; changed: boolean }> {
  const sessionId = sessionIdOf(input.sessionId)
  const taskKey = taskKeyOf(input.taskKey)
  if (!['running', 'stop_requested', 'draining', 'cancelled', 'failed_to_stop'].includes(input.state)) throw new Error('任务运行控制状态无效')
  if (!Number.isSafeInteger(input.runEpoch) || input.runEpoch < 1) throw new Error('任务运行 epoch 无效')
  if (Number.isNaN(Date.parse(input.updatedAt)) || !input.updatedAt.endsWith('Z')) throw new Error('任务运行控制时间无效')
  const workspace = await taskWorkspace(workspacePath, sessionId, taskKey)
  const path = join(workspace, '.promax', 'tasks', taskKey, 'run-control.yml')
  const current = taskRunControlOf(JSON.parse(await readFile(path, 'utf8')) as unknown, taskKey, sessionId)
  if (current.runEpoch !== input.runEpoch) throw new Error('任务运行 epoch 已变化，拒绝用旧停止请求修改新 run')
  if ((input.state === 'stop_requested' || input.state === 'draining') && (current.state === 'draining' || current.state === 'cancelled')) {
    return { state: current.state, runEpoch: current.runEpoch, updatedAt: input.updatedAt, changed: false }
  }
  if (!TASK_RUN_TRANSITIONS[current.state].includes(input.state)) throw new Error(`任务运行控制不允许 ${current.state} → ${input.state}`)
  if (current.state === input.state) return { state: current.state, runEpoch: current.runEpoch, updatedAt: input.updatedAt, changed: false }
  await writeTaskRunControl(path, taskKey, sessionId, input.state, input.runEpoch, input.updatedAt)
  return { state: input.state, runEpoch: input.runEpoch, updatedAt: input.updatedAt, changed: true }
}

async function writeImmutable(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (await readFile(path, 'utf8') !== content) throw new Error(`不可变输入已经冻结，拒绝覆盖：${path}`)
  }
}

async function writeFrozenInputManifest(path: string, manifest: Record<string, unknown>): Promise<void> {
  try {
    await writeFile(path, jsonYaml(manifest), { encoding: 'utf8', flag: 'wx' })
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  let existing: Record<string, unknown>
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object')
    existing = value as Record<string, unknown>
  } catch {
    throw new Error(`不可变输入清单无效，拒绝覆盖：${path}`)
  }
  const metadata = existing.metadata
  const frozenAt = typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).frozen_at
    : undefined
  if (typeof frozenAt !== 'string' || Number.isNaN(Date.parse(frozenAt))) {
    throw new Error(`不可变输入清单缺少首次冻结时间，拒绝覆盖：${path}`)
  }
  const expected = structuredClone(manifest) as { metadata?: Record<string, unknown> }
  expected.metadata = { ...expected.metadata, frozen_at: frozenAt }
  if (JSON.stringify(existing) !== JSON.stringify(expected)) {
    throw new Error(`不可变输入清单已经冻结，拒绝覆盖：${path}`)
  }
}

/** Writes B2's immutable input manifest and independently revisioned coverage/slot/task package files. */
export async function writeTaskPackageFiles(workspacePath: string, input: TaskPackageWriteInput): Promise<TaskPackageWriteResult> {
  const workspace = resolve(workspacePath)
  const taskKey = taskKeyOf(input.taskKey)
  sessionIdOf(input.sessionId)
  if (!/^[a-z][a-z0-9-]{2,47}@r[1-9][0-9]*$/u.test(input.teamRevisionId)) throw new Error('TeamRevision 标识无效')
  if (input.confirmedHandoff.trim() === '') throw new Error('经确认交底不能为空')
  if (Number.isNaN(Date.parse(input.confirmedAt)) || !input.confirmedAt.endsWith('Z')) throw new Error('确认时间无效')
  const coverageInformationKeys = checkedInformationKeys(input.coverageInformationKeys)
  const inputRoot = join(workspace, '.promax', 'input', taskKey)
  const sourceRoot = join(inputRoot, 'sources', 'SRC-001')
  const sourceRelativePath = `.promax/input/${taskKey}/sources/SRC-001/confirmed-handoff.md`
  const sourceContent = `${input.confirmedHandoff.trim()}\n`
  const locatorValue = `第 1–${sourceContent.split(/\r?\n/u).filter(Boolean).length} 行`
  const coverageFacts = coverageInformationKeys.map(informationKey => ({
    sourceId: 'SRC-001',
    informationKey,
    locator: `${sourceRelativePath} ${locatorValue}`,
  }))
  const plan = calculateTaskPlan({
    taskKey,
    members: input.members,
    artifacts: input.artifacts,
    requestedArtifactPaths: input.requestedArtifactPaths,
    coverage: coverageFacts,
  })
  if (plan.tier === 'draft') throw new Error('0 产物草稿不得写入任务包或启动执行会话')
  await mkdir(sourceRoot, { recursive: true })
  await writeImmutable(join(sourceRoot, 'confirmed-handoff.md'), sourceContent)
  const inputManifestPath = `.promax/input/${taskKey}/manifest.yml`
  const inputManifest = {
    api_version: 'promax.ai/v1alpha2',
    kind: 'EvidenceInputManifest',
    metadata: { task_key: taskKey, frozen: true, frozen_at: input.confirmedAt },
    spec: {
      source_root: `.promax/input/${taskKey}/sources`,
      sources: [{
        source_id: 'SRC-001',
        relative_path: sourceRelativePath,
        sha256: createHash('sha256').update(sourceContent).digest('hex'),
        media_type: 'text/markdown',
        origin_kind: 'user-provided',
      }],
    },
  }
  await writeFrozenInputManifest(join(inputRoot, 'manifest.yml'), inputManifest)

  const taskRoot = join(workspace, '.promax', 'tasks', taskKey)
  await mkdir(taskRoot, { recursive: true })
  let coverageRevision = 1
  try {
    const previous = JSON.parse(await readFile(join(taskRoot, 'coverage.yml'), 'utf8')) as { metadata?: { revision?: unknown } }
    if (!Number.isSafeInteger(previous.metadata?.revision) || Number(previous.metadata?.revision) < 1) throw new Error('既有 coverage.yml 无效')
    coverageRevision = Number(previous.metadata!.revision) + 1
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const coverage = {
    api_version: 'promax.ai/v1alpha2',
    kind: 'CoverageDecision',
    metadata: { task_key: taskKey, revision: coverageRevision, confirmed_at: input.confirmedAt },
    spec: {
      input_manifest_path: inputManifestPath,
      sources: [{
        source_id: 'SRC-001',
        covers: coverageInformationKeys.map(informationKey => ({
          information_key: informationKey,
          locator: { relative_path: sourceRelativePath, location_type: 'line', value: locatorValue },
        })),
      }],
    },
  }
  const relativeTaskRoot = `.promax/tasks/${taskKey}`
  const slots = {
    api_version: 'promax.ai/v1alpha2',
    kind: 'TaskSlots',
    metadata: {
      task_key: taskKey,
      team_revision_id: input.teamRevisionId,
      coverage_revision: coverageRevision,
      computed_at: input.confirmedAt,
    },
    spec: { tier: plan.tier, slots: plan.slots },
  }
  const taskPackage = {
    api_version: 'promax.ai/v1alpha2',
    kind: 'TaskPackage',
    metadata: { task_key: taskKey, team_revision_id: input.teamRevisionId, confirmed_at: input.confirmedAt },
    spec: {
      input_manifest_path: inputManifestPath,
      coverage_path: `${relativeTaskRoot}/coverage.yml`,
      slots_path: `${relativeTaskRoot}/slots.yml`,
      requested_artifacts: plan.requestedArtifactPaths,
      handoff: {
        wanted: input.confirmedHandoff.trim(),
        available: [{ source_id: 'SRC-001', information_keys: coverageInformationKeys }],
        starting_point: plan.memberIds,
        known_gaps: plan.unresolved.map(informationKey => ({
          information_key: informationKey,
          handling: '由用户补充、选择补跑，或在产物中明确标为假设',
        })),
      },
    },
  }
  await writeFile(join(taskRoot, 'coverage.yml'), jsonYaml(coverage), 'utf8')
  await writeFile(join(taskRoot, 'slots.yml'), jsonYaml(slots), 'utf8')
  const runControlPath = join(taskRoot, 'run-control.yml')
  try {
    const existing = JSON.parse(await readFile(runControlPath, 'utf8')) as unknown
    taskRunControlOf(existing, taskKey, input.sessionId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(runControlPath, jsonYaml(taskRunControlValue(taskKey, input.sessionId, 'running', 1, input.confirmedAt)), { encoding: 'utf8', flag: 'wx' })
  }
  await writeFile(join(taskRoot, 'task-package.yml'), jsonYaml(taskPackage), 'utf8')
  return {
    taskPackagePath: `${relativeTaskRoot}/task-package.yml`,
    coveragePath: `${relativeTaskRoot}/coverage.yml`,
    slotsPath: `${relativeTaskRoot}/slots.yml`,
    inputManifestPath,
    tier: plan.tier,
    coverageRevision,
    artifactPaths: plan.artifactPaths,
    slots: plan.slots,
  }
}

function taskPlanningMembers(value: unknown): TaskPlanningMember[] {
  if (!Array.isArray(value)) throw new Error('团队信息契约缺少成员')
  return value.map(item => {
    if (typeof item !== 'object' || item === null) throw new Error('团队成员信息契约无效')
    const row = item as Record<string, unknown>
    const memberId = typeof row.memberId === 'string' ? row.memberId : ''
    const label = typeof row.label === 'string' ? row.label : ''
    if (!/^[a-z][a-z0-9_]*$/u.test(memberId) || label.trim() === '') throw new Error('团队成员信息契约无效')
    return {
      memberId,
      label: label.trim(),
      provides: checkedInformationKeys(row.provides),
      requires: checkedInformationKeys(row.requires),
    }
  })
}

function taskPlanningArtifacts(value: unknown): TaskPlanningArtifact[] {
  if (!Array.isArray(value)) throw new Error('团队信息契约缺少产物')
  return value.map(item => {
    if (typeof item !== 'object' || item === null) throw new Error('团队产物契约无效')
    const row = item as Record<string, unknown>
    if (typeof row.relativePath !== 'string' || row.relativePath.trim() === ''
      || typeof row.producedBy !== 'string' || !/^[a-z][a-z0-9_]*$/u.test(row.producedBy)
      || typeof row.required !== 'boolean') throw new Error('团队产物契约无效')
    return { relativePath: row.relativePath, producedBy: row.producedBy, required: row.required }
  })
}

function requestPath(request: IncomingMessage): string {
  return (request.url ?? '').split('?')[0]?.replace(/\/+$/u, '') ?? ''
}

export async function apply(ctx: HostContext, config: Config): Promise<void> {
  const proxy = createApiProxy(config.apiBaseUrl)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PROXY_PREFIX,
    handler: proxy,
  }), 'promax-api-proxy')
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'html',
      placement: 'head',
      html: '<meta name="promax-api-base-url" content="/promax-api">',
    })
  })

  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const generalWorkspacePath = resolve(process.env.PROMAX_GENERAL_WORKSPACE?.trim() || join(dshHome, 'workspaces', 'general'))
  const projectRoot = resolve(process.env.PROMAX_PROJECT_ROOT?.trim() || join(homedir(), 'Promax'))
  const compatibilityProductPath = resolve(process.env.PROMAX_PRODUCT_WORKSPACE?.trim() || join(projectRoot, '产品'))
  const knownWorkspaces = new Map<string, WorkspaceRecord>()

  await mkdir(generalWorkspacePath, { recursive: true })
  const general = await ctx.workspaceRegistry.create(generalWorkspacePath, '草稿')
  knownWorkspaces.set(general.id, general)
  await scaffoldProject(compatibilityProductPath)
  const product = await ctx.workspaceRegistry.create(compatibilityProductPath, '产品')
  knownWorkspaces.set(product.id, product)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: WORKSPACE_API_PREFIX,
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          writeJson(response, 405, { error: '只接受 POST 请求' })
          return
        }
        const path = requestPath(request)
        const input = await readJson(request)

        if (path.endsWith('/draft')) {
          const draftDirectory = join(dshHome, 'promax', 'drafts')
          await mkdir(draftDirectory, { recursive: true })
          await writeFile(join(draftDirectory, 'state.json'), `${JSON.stringify(input, null, 2)}\n`, 'utf8')
          writeJson(response, 200, { ok: true })
          return
        }

        if (path.endsWith('/project')) {
          const customParent = typeof input.parentPath === 'string' && input.parentPath.trim() !== ''
            ? resolve(input.parentPath.trim())
            : projectRoot
          const workspace = await ensureProjectWorkspace(ctx.workspaceRegistry, customParent, String(input.projectName ?? ''))
          knownWorkspaces.set(workspace.id, workspace)
          writeJson(response, 200, {
            workspaceId: workspace.id,
            path: workspace.path,
            title: workspace.title,
            sessionIds: [...workspace.sessionIds],
          })
          return
        }

        if (path.endsWith('/task-run/read')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const snapshot = await readTaskRunFiles(workspacePath, {
            sessionId: String(input.sessionId ?? ''),
            taskKey: String(input.taskKey ?? ''),
            artifactPaths: Array.isArray(input.artifactPaths) ? input.artifactPaths.filter((item): item is string => typeof item === 'string') : [],
          })
          writeJson(response, 200, { ...snapshot })
          return
        }

        if (path.endsWith('/task-run/control')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const result = await controlTaskRunFiles(workspacePath, {
            sessionId: String(input.sessionId ?? ''),
            taskKey: String(input.taskKey ?? ''),
            state: String(input.state ?? '') as TaskRunCancellationState,
            runEpoch: Number(input.runEpoch),
            updatedAt: String(input.updatedAt ?? ''),
          })
          if (result.changed && result.state === 'cancelled') ctx.emit('promax/decision', {
            sessionId: String(input.sessionId ?? ''),
            target: 'task.abandon',
            decision: { task_key: String(input.taskKey ?? ''), reason: 'user-stop' },
          })
          writeJson(response, 200, result)
          return
        }

        if (path.endsWith('/handoff')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const result = await writeTaskPackageFiles(workspacePath, {
            sessionId: String(input.sessionId ?? ''),
            project: typeof input.project === 'string' && input.project.trim() !== '' ? input.project.trim() : registered?.title ?? basename(workspacePath),
            taskKey: String(input.taskKey ?? ''),
            teamRevisionId: String(input.teamRevisionId ?? ''),
            confirmedAt: String(input.confirmedAt ?? ''),
            confirmedHandoff: typeof input.confirmedHandoff === 'string' ? input.confirmedHandoff : '',
            handoffEdited: input.handoffEdited === true,
            requestedArtifactPaths: Array.isArray(input.requestedArtifactPaths)
              ? input.requestedArtifactPaths.filter((item): item is string => typeof item === 'string')
              : [],
            coverageInformationKeys: checkedInformationKeys(input.coverageInformationKeys),
            coverageWasOverridden: input.coverageWasOverridden === true,
            members: taskPlanningMembers(input.members),
            artifacts: taskPlanningArtifacts(input.artifacts),
          })
          const taskKey = taskKeyOf(input.taskKey)
          ctx.emit('promax/decision', {
            sessionId: String(input.sessionId ?? ''),
            target: 'handoff.confirm',
            decision: { task_key: taskKey, revision: result.coverageRevision, subject: 'four-part-handoff' },
          })
          if (input.handoffEdited === true) ctx.emit('promax/decision', {
            sessionId: String(input.sessionId ?? ''),
            target: 'handoff.edit',
            decision: { task_key: taskKey, revision: result.coverageRevision, subject: 'four-part-handoff' },
          })
          if (input.coverageWasOverridden === true) ctx.emit('promax/decision', {
            sessionId: String(input.sessionId ?? ''),
            target: 'coverage.override',
            decision: { task_key: taskKey, revision: result.coverageRevision, subject: 'information-coverage' },
          })
          ctx.emit('promax/task-state', {
            project: typeof input.project === 'string' && input.project.trim() !== '' ? input.project.trim() : registered?.title ?? basename(workspacePath),
            session_id: String(input.sessionId ?? ''),
            task_key: taskKey,
            tier: result.tier,
            coverage_revision: result.coverageRevision,
            updated_at: String(input.confirmedAt ?? ''),
            slots: result.slots,
          })
          writeJson(response, 200, { ...result })
          return
        }

        if (path.endsWith('/session-scope')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const scope = await ensureSessionOutputDirectory(workspacePath, String(input.sessionId ?? ''), String(input.sessionName ?? ''))
          writeJson(response, 200, scope)
          return
        }

        writeJson(response, 404, { error: '未知的 Promax 工作区操作' })
      } catch (error) {
        writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'promax-project-workspace-api')
}
