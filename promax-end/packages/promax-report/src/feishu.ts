import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'

import z from '@deepseek-ai/schemastery'
import { parse } from 'yaml'

import type { AgentLike, SessionLike, ToolExecutionLike, ToolResultLike } from './reporter.ts'
import type { ReportLogger } from './outbox.ts'
import type { DeliveryResult, ReportRequest, ReportTransport } from './transport.ts'
import { DurableReportQueue } from './outbox.ts'

export const FEISHU_TELEMETRY_SETTINGS_NS = 'promax-feishu-telemetry'
export const FEISHU_APP_ID_REF = 'APP_ID'
export const FEISHU_APP_SECRET_REF = 'APP_SECRET'

export interface FeishuTelemetrySettings {
  appToken: string
  folderToken: string
}

export const FeishuTelemetrySettingsSchema: z<FeishuTelemetrySettings> = z.object({
  appToken: z.string().default(''),
  folderToken: z.string().default(''),
})

export interface SettingsScope<T> {
  get(): T
  watch(listener: (next: T, previous: T) => void | Promise<void>): () => void
}

export interface CredentialsService {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
}

export interface FeishuSkillCall {
  time: number
  taskName: string
  agent: string
  skillName: string
  success: boolean
  durationSeconds: number
}

export interface FeishuRunSnapshot {
  startedAt: number
  observedAt: number
  taskName: string
  demand: string
  inputType: string
  plannedMembers: string[]
  actualMembers: string[]
  dispatchChanged: boolean
  artifacts: string[]
  judgeVerdict: 'pass' | 'block' | '未产生'
  judgeRuleIds: string[]
  judgePath: string
  repairRounds: number
  finalStatus: '完成' | '已停止' | '失败'
  failureReason: string
  durationSeconds: number
  tokenCount: number
  sessionId: string
  skillCalls: FeishuSkillCall[]
}

interface FeishuDeliveryState {
  docToken?: string
  docUrl?: string
  runWritten?: boolean
  skillsWritten?: boolean
}

interface FeishuTable {
  table_id?: string
  name?: string
}

interface FeishuField {
  field_id?: string
  field_name?: string
  type?: number
}

interface FeishuView {
  view_id?: string
  view_name?: string
}

interface TableSchema {
  tableId: string
  fields: Map<string, FeishuField>
}

interface FeishuSchema {
  runs: TableSchema
  skills: TableSchema
}

interface FeishuErrorOptions {
  kind: 'retry' | 'dead'
  status?: number
}

class FeishuDeliveryError extends Error {
  readonly kind: 'retry' | 'dead'
  readonly status: number | undefined

  constructor(message: string, options: FeishuErrorOptions) {
    super(message)
    this.name = 'FeishuDeliveryError'
    this.kind = options.kind
    this.status = options.status
  }
}

const RUN_FIELDS = [
  { field_name: '任务名', type: 1 },
  { field_name: '时间', type: 5, property: { date_formatter: 'yyyy/MM/dd HH:mm' } },
  { field_name: '需求摘要', type: 1 },
  { field_name: '输入类型', type: 1 },
  { field_name: '计划派工', type: 1 },
  { field_name: '实际派工', type: 1 },
  { field_name: '派工被改', type: 7 },
  { field_name: '产物清单', type: 1 },
  { field_name: '产物数', type: 2, property: { formatter: '0' } },
  { field_name: 'Judge 结论', type: 3, property: { options: [{ name: 'pass' }, { name: 'block' }, { name: '未产生' }] } },
  { field_name: '返修轮数', type: 2, property: { formatter: '0' } },
  { field_name: '最终状态', type: 3, property: { options: [{ name: '完成' }, { name: '已停止' }, { name: '失败' }] } },
  { field_name: '耗时秒', type: 2, property: { formatter: '0' } },
  { field_name: 'token', type: 2, property: { formatter: '0' } },
  { field_name: '会话ID', type: 1 },
  { field_name: '详情链接', type: 15 },
  { field_name: '是否已跟进', type: 7 },
  { field_name: '跟进结论', type: 1 },
  { field_name: '_待复盘', type: 7 },
] as const

const SKILL_FIELDS = [
  { field_name: '任务名', type: 1 },
  { field_name: '时间', type: 5, property: { date_formatter: 'yyyy/MM/dd HH:mm' } },
  { field_name: '智能体', type: 1 },
  { field_name: 'Skill 名', type: 1 },
  { field_name: '成败', type: 3, property: { options: [{ name: '成功' }, { name: '失败' }] } },
  { field_name: '耗时秒', type: 2, property: { formatter: '0.00' } },
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function safeWorkspacePath(cwd: string, path: string): string {
  const root = resolve(cwd)
  const target = resolve(root, path)
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`Promax telemetry path escaped workspace: ${path}`)
  return target
}

async function readStructured(path: string): Promise<Record<string, unknown>> {
  const text = await readFile(path, 'utf8')
  const value: unknown = path.endsWith('.json') ? JSON.parse(text) : parse(text)
  if (!isRecord(value)) throw new Error(`Promax telemetry file is not an object: ${path}`)
  return value
}

function parentSessionId(session: SessionLike): string | undefined {
  return string(session.header.parentSession)
}

function sessionOrigin(session: SessionLike): string | undefined {
  return string(session.header.origin)
}

function rootSessionId(agent: AgentLike): string {
  return parentSessionId(agent.session) ?? agent.id
}

const MEMBER_ID_LINE = /(?:^|\n)PROMAX_MEMBER_ID:([a-z][a-z0-9_]{2,47})(?:\n|$)/u

export function memberId(session: SessionLike): string {
  for (const event of session.events) {
    if (!isRecord(event)) continue
    const data = record(event.data)
    const persona = event.type === 'subagent/descriptor'
      ? string(data.persona)
      : event.type === 'request/header'
        ? string(record(data.header).system)
        : undefined
    const match = MEMBER_ID_LINE.exec(persona ?? '')
    if (match) return match[1]!
  }
  return session.header.agentPreset ?? 'unknown'
}

function matchingToolStartedAt(session: SessionLike, callId: string | undefined): number | undefined {
  if (!callId) return undefined
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (!isRecord(event) || event.type !== 'tool/call' || typeof event.time !== 'number') continue
    if (record(event.data).callId === callId) return event.time
  }
  return undefined
}

function messageText(event: unknown): string {
  if (!isRecord(event) || event.type !== 'assistant/message') return ''
  const message = record(record(event.data).message)
  return list(message.content).flatMap(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

function plannedMembers(events: readonly unknown[]): string[] {
  let selected: string[] = []
  const matcher = /PROMAX_DISPATCH_PLAN_V1_START\s*([\s\S]*?)\s*PROMAX_DISPATCH_PLAN_V1_END/gu
  for (const event of events) {
    const text = messageText(event)
    for (const match of text.matchAll(matcher)) {
      try {
        const payload: unknown = JSON.parse(match[1]!)
        if (!isRecord(payload) || payload.protocol !== 'promax.dispatch-plan/v1') continue
        const members = list(payload.members).flatMap(value => {
          const row = record(value)
          const id = string(row.member_id)
          return id !== undefined && row.selected === true ? [id] : []
        })
        if (members.length > 0) selected = members
      } catch { /* planning prompts contain a deliberately non-JSON example */ }
    }
  }
  return selected
}

function tokenCount(sessions: readonly SessionLike[]): number {
  let total = 0
  for (const session of sessions) {
    for (const event of session.events) {
      if (!isRecord(event) || event.type !== 'assistant/message') continue
      const usage = record(record(event.data).usage)
      const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0
      const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0
      total += input + output
    }
  }
  return Math.max(0, Math.round(total))
}

export function judgeSummary(
  text: string,
  allowedRuleIds?: readonly string[],
): { verdict: 'pass' | 'block' | '未产生'; ruleIds: string[] } {
  let verdict: 'pass' | 'block' | '未产生' = '未产生'
  for (const match of text.matchAll(/(?:整体\s*verdict|overall\s*verdict)\s*[:：]\s*(?:\*{1,2})?\s*(PASS|FAIL|BLOCK)/giu)) {
    verdict = match[1]!.toUpperCase() === 'PASS' ? 'pass' : 'block'
  }
  if (verdict === '未产生') {
    const values = [...text.matchAll(/\b(PASS|FAIL|BLOCK)\b/gu)]
    const latest = values.at(-1)?.[1]
    if (latest) verdict = latest === 'PASS' ? 'pass' : 'block'
  }
  const candidates = [...new Set([...text.matchAll(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/gu)].map(match => match[0]))]
  const allowlist = allowedRuleIds === undefined ? undefined : new Set(allowedRuleIds)
  const ruleIds = allowlist === undefined ? candidates : candidates.filter(ruleId => allowlist.has(ruleId))
  return { verdict, ruleIds }
}

function taskRuleIds(taskPackage: Record<string, unknown>): string[] {
  const artifacts = list(record(taskPackage.spec).artifacts).map(record)
  return [...new Set(artifacts.flatMap(artifact => list(record(artifact.domain_rubric).rules)
    .map(record)
    .flatMap(rule => string(rule.rule_id) === undefined ? [] : [string(rule.rule_id)!])))]
}

function stringArray(value: unknown): string[] {
  return list(value).flatMap(item => string(item) === undefined ? [] : [string(item)!])
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return [...new Set(left)].sort().join('\0') === [...new Set(right)].sort().join('\0')
}

async function actualArtifacts(cwd: string, taskName: string): Promise<string[]> {
  const directory = safeWorkspacePath(cwd, `deliverables/${taskName}`)
  const files: string[] = []
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()!
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile() && (await stat(path)).size > 0) files.push(relative(cwd, path).replaceAll('\\', '/'))
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

async function taskNameForSession(cwd: string, sessionId: string): Promise<string | undefined> {
  try {
    const scope = await readStructured(safeWorkspacePath(cwd, `.promax/session-scopes/${sessionId}.json`))
    return string(scope.taskKey)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function originalDemand(cwd: string, manifest: Record<string, unknown>): Promise<string> {
  const source = list(record(manifest.spec).sources).map(record).find(row => row.source_id === 'SRC-001')
  const relativePath = string(source?.relative_path)
  if (!relativePath) return ''
  return (await readFile(safeWorkspacePath(cwd, relativePath), 'utf8')).trim()
}

function inputDescription(manifest: Record<string, unknown>): string {
  const files = list(record(manifest.inputs).src_files).map(record)
  if (files.length === 0) return '内联'
  const extensions = [...new Set(files.flatMap(file => {
    const name = string(file.original_name) ?? string(file.relative_path) ?? ''
    const suffix = extname(name).toLowerCase()
    return suffix === '' ? [] : [suffix]
  }))]
  return `上传文件（${String(files.length)} 个${extensions.length === 0 ? '' : `：${extensions.join('、')}`}）`
}

export function terminalState(
  runControl: Record<string, unknown>,
  repair: Record<string, unknown> | undefined,
): { finalStatus: FeishuRunSnapshot['finalStatus']; repairRounds: number; failureReason: string } | undefined {
  const runState = string(record(runControl.spec).state)
  const repairSpec = record(repair?.spec)
  const repairRounds = typeof repairSpec.round === 'number' && Number.isSafeInteger(repairSpec.round) ? repairSpec.round : 0
  const reasons = stringArray(repairSpec.reasons)
  if (runState === 'cancelled') return { finalStatus: '已停止', repairRounds, failureReason: reasons.join('；') }
  if (runState === 'completed') return { finalStatus: '完成', repairRounds, failureReason: '' }
  if (runState === 'failed') return { finalStatus: '失败', repairRounds, failureReason: reasons.join('；') || '任务运行已失败' }
  return undefined
}

async function optionalStructured(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return await readStructured(path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export class FeishuTelemetryCollector {
  private tail: Promise<void> = Promise.resolve()
  private readonly sessionsByRoot = new Map<string, Map<string, SessionLike>>()
  private readonly skillsByRoot = new Map<string, FeishuSkillCall[]>()
  private readonly submitted = new Set<string>()

  constructor(
    private readonly settings: () => FeishuTelemetrySettings,
    private readonly queue: DurableReportQueue,
    private readonly logger: ReportLogger,
  ) {}

  startSession(agent: AgentLike): void {
    const root = rootSessionId(agent)
    const sessions = this.sessionsByRoot.get(root) ?? new Map<string, SessionLike>()
    sessions.set(agent.id, agent.session)
    this.sessionsByRoot.set(root, sessions)
  }

  recordToolResult(exec: ToolExecutionLike, result: ToolResultLike): void {
    const agent = exec.agent
    if (!agent || exec.name !== 'skill' || !isRecord(exec.arguments)) return
    const skillName = string(exec.arguments.name)
    if (!skillName) return
    this.startSession(agent)
    const root = rootSessionId(agent)
    const now = Date.now()
    const callId = string(exec.callId)
    const startedAt = matchingToolStartedAt(agent.session, callId) ?? now
    const calls = this.skillsByRoot.get(root) ?? []
    if (callId && calls.some(call => (call as FeishuSkillCall & { callId?: string }).callId === callId)) return
    calls.push(Object.assign({
      time: startedAt,
      taskName: '',
      agent: memberId(agent.session),
      skillName,
      success: !result.isError,
      durationSeconds: Math.max(0, Math.round((now - startedAt) / 10) / 100),
    }, callId ? { callId } : {}))
    this.skillsByRoot.set(root, calls)
  }

  observeTurn(agent: AgentLike): void {
    this.startSession(agent)
    if (sessionOrigin(agent.session) === 'subagent' || parentSessionId(agent.session)) return
    const configured = this.settings()
    if (configured.appToken.trim() === '' || configured.folderToken.trim() === '') return
    this.schedule(async () => {
      let snapshot: FeishuRunSnapshot | undefined
      for (let attempt = 0; attempt < 50 && !snapshot; attempt += 1) {
        snapshot = await this.snapshot(agent)
        if (!snapshot) await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
      }
      if (!snapshot || this.submitted.has(snapshot.sessionId)) return
      this.submitted.add(snapshot.sessionId)
      this.queue.submit({ path: '/feishu/v1/run', body: snapshot })
    })
  }

  flush(): void {
    const configured = this.settings()
    if (configured.appToken.trim() !== '' && configured.folderToken.trim() !== '') this.queue.flush()
  }

  retryDead(): void {
    const configured = this.settings()
    if (configured.appToken.trim() !== '' && configured.folderToken.trim() !== '') this.queue.retryDead()
  }

  async idle(): Promise<void> {
    await this.tail
    await this.queue.idle()
  }

  private schedule(operation: () => Promise<void>): void {
    const task = this.tail.then(operation, operation)
    this.tail = task.catch((error: unknown) => {
      this.logger.warn(`promax-report Feishu observation failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private async snapshot(agent: AgentLike): Promise<FeishuRunSnapshot | undefined> {
    const cwd = agent.session.header.cwd ? resolve(agent.session.header.cwd) : undefined
    if (!cwd || !isAbsolute(cwd)) return undefined
    const taskName = await taskNameForSession(cwd, agent.id)
    if (!taskName) return undefined
    const manifest = await readStructured(safeWorkspacePath(cwd, `.promax/input/${taskName}/manifest.yml`))
    const taskPackage = await readStructured(safeWorkspacePath(cwd, `.promax/tasks/${taskName}/task-package.yml`))
    const runControl = await readStructured(safeWorkspacePath(cwd, `.promax/tasks/${taskName}/run-control.yml`))
    const repair = await optionalStructured(safeWorkspacePath(cwd, `.promax/tasks/${taskName}/judge-repair.yml`))
    const judgePath = `.promax/judge/${taskName}/judge.md`
    let judgeText = ''
    try {
      judgeText = await readFile(safeWorkspacePath(cwd, judgePath), 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const judge = judgeSummary(judgeText, taskRuleIds(taskPackage))
    const terminal = terminalState(runControl, repair)
    if (!terminal) return undefined
    const startedAtText = string(record(manifest.metadata).frozen_at) ?? string(record(taskPackage.metadata).confirmed_at)
    const startedAt = startedAtText === undefined ? Date.now() : Date.parse(startedAtText)
    const observedAt = Date.now()
    const parentEvents = agent.session.events
    const planned = plannedMembers(parentEvents)
    const actual = stringArray(record(taskPackage.spec).members_confirmed)
    const artifacts = await actualArtifacts(cwd, taskName)
    const skillCalls = (this.skillsByRoot.get(agent.id) ?? []).map(call => ({ ...call, taskName }))
    const sessions = [...(this.sessionsByRoot.get(agent.id)?.values() ?? [agent.session])]
    return {
      startedAt: Number.isFinite(startedAt) ? startedAt : observedAt,
      observedAt,
      taskName,
      demand: await originalDemand(cwd, manifest),
      inputType: inputDescription(manifest),
      plannedMembers: planned,
      actualMembers: actual,
      dispatchChanged: planned.length > 0 && !sameMembers(planned, actual),
      artifacts,
      judgeVerdict: judge.verdict,
      judgeRuleIds: judge.ruleIds,
      judgePath: safeWorkspacePath(cwd, judgePath),
      repairRounds: terminal.repairRounds,
      finalStatus: terminal.finalStatus,
      failureReason: terminal.failureReason,
      durationSeconds: Math.max(0, Math.round((observedAt - startedAt) / 1000)),
      tokenCount: tokenCount(sessions),
      sessionId: agent.id,
      skillCalls,
    }
  }
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value)
}

function stableClientToken(scope: string): string {
  const digest = createHash('sha256').update(scope).digest('hex').slice(0, 32)
  // Feishu Bitable accepts an idempotency token in UUID form. Keep it stable
  // per run so retries cannot create duplicate records.
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20)}`
}

function markdownEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|')
}

export function runDetailMarkdown(snapshot: FeishuRunSnapshot): string {
  const artifacts = snapshot.artifacts.length === 0 ? '- 无' : snapshot.artifacts.map(path => `- \`${path}\``).join('\n')
  const rules = snapshot.judgeRuleIds.length === 0 ? '未记录' : snapshot.judgeRuleIds.map(markdownEscape).join('、')
  return `# Promax 运行明细：${snapshot.taskName}\n\n## 需求原文\n\n${snapshot.demand || '（空）'}\n\n## 派工\n\n| 项目 | 成员 |\n|---|---|\n| 计划派工 | ${snapshot.plannedMembers.map(markdownEscape).join('、') || '未记录'} |\n| 实际派工 | ${snapshot.actualMembers.map(markdownEscape).join('、') || '未记录'} |\n| 派工被改 | ${snapshot.dispatchChanged ? '是' : '否'} |\n\n## 产物清单\n\n${artifacts}\n\n> 业务产物仅列本机路径，未自动上传。\n\n## Judge 摘要\n\n- verdict：${snapshot.judgeVerdict}\n- 命中的 rule_id：${rules}\n- Judge 本机路径：\`${snapshot.judgePath}\`\n\n> Judge 全文未上传。\n\n## 运行结果\n\n- 最终状态：${snapshot.finalStatus}\n- 失败原因：${snapshot.failureReason || '无'}\n- 返修轮数：${String(snapshot.repairRounds)}\n- 耗时：${String(snapshot.durationSeconds)} 秒\n- token：${String(snapshot.tokenCount)}\n- 会话ID：${snapshot.sessionId}\n`
}

class FeishuApi {
  private tokenValue?: { value: string; expiresAt: number; appId: string }

  constructor(
    private readonly credentials: CredentialsService,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: typeof fetch,
  ) {}

  private async accessToken(): Promise<string> {
    const [appId, appSecret] = await Promise.all([
      this.credentials.resolve(FEISHU_APP_ID_REF),
      this.credentials.resolve(FEISHU_APP_SECRET_REF),
    ])
    if (!appId || !appSecret) throw new FeishuDeliveryError('飞书 APP_ID 或 APP_SECRET 未配置', { kind: 'retry' })
    if (this.tokenValue && this.tokenValue.appId === appId.value && this.tokenValue.expiresAt > Date.now() + 60_000) return this.tokenValue.value
    const response = await this.raw('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: jsonBody({ app_id: appId.value, app_secret: appSecret.value }),
    })
    const payload = await this.responseJson(response)
    const token = string(payload.tenant_access_token)
    if (!response.ok || payload.code !== 0 || !token) throw this.apiFailure(response.status, payload, '获取 tenant_access_token 失败')
    const expires = typeof payload.expire === 'number' ? payload.expire : 7200
    this.tokenValue = { value: token, expiresAt: Date.now() + expires * 1000, appId: appId.value }
    return token
  }

  private async raw(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImplementation(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (error: unknown) {
      throw new FeishuDeliveryError(error instanceof Error ? error.message : String(error), { kind: 'retry' })
    }
  }

  private async responseJson(response: Response): Promise<Record<string, unknown>> {
    try {
      const value: unknown = await response.json()
      return record(value)
    } catch {
      throw new FeishuDeliveryError(`飞书返回了非 JSON 响应（HTTP ${String(response.status)}）`, {
        kind: response.status === 429 || response.status >= 500 ? 'retry' : 'dead',
        status: response.status,
      })
    }
  }

  private apiFailure(status: number, payload: Record<string, unknown>, context: string): FeishuDeliveryError {
    const code = typeof payload.code === 'number' ? payload.code : undefined
    const message = string(payload.msg) ?? 'unknown error'
    const httpFailure = status < 200 || status >= 300
    const retryable = !httpFailure || status === 401 || status === 408 || status === 409 || status === 429 || status >= 500
    return new FeishuDeliveryError(`${context}: ${message}${code === undefined ? '' : ` (code ${String(code)})`}`, {
      kind: retryable ? 'retry' : 'dead',
      status,
    })
  }

  async json(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const token = await this.accessToken()
    const response = await this.raw(`https://open.feishu.cn/open-apis${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: jsonBody(body) }),
    })
    const payload = await this.responseJson(response)
    if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) throw this.apiFailure(response.status, payload, `${method} ${path}`)
    return payload
  }

  async uploadMarkdown(markdown: string): Promise<string> {
    const token = await this.accessToken()
    const bytes = Buffer.from(markdown, 'utf8')
    const form = new FormData()
    form.set('file_name', 'promax-run.md')
    form.set('parent_type', 'ccm_import_open')
    form.set('parent_node', '/')
    form.set('size', String(bytes.byteLength))
    form.set('extra', jsonBody({ obj_type: 'docx', file_extension: 'md' }))
    form.set('file', new Blob([bytes], { type: 'text/markdown' }), 'promax-run.md')
    const response = await this.raw('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
    })
    const payload = await this.responseJson(response)
    const fileToken = string(payload.file_token) ?? string(record(payload.data).file_token)
    if (!response.ok || !fileToken) throw this.apiFailure(response.status, payload, '上传云文档导入素材失败')
    return fileToken
  }
}

function data(payload: Record<string, unknown>): Record<string, unknown> {
  return record(payload.data)
}

function items(payload: Record<string, unknown>): unknown[] {
  return list(data(payload).items)
}

async function ensureTable(
  api: FeishuApi,
  appToken: string,
  tableName: string,
  fields: readonly Record<string, unknown>[],
  defaultViewName: string,
): Promise<TableSchema> {
  const tablesPayload = await api.json('GET', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?page_size=100`)
  let table = items(tablesPayload).map(value => record(value) as FeishuTable).find(value => value.name === tableName)
  if (!table?.table_id) {
    const created = await api.json('POST', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`, {
      table: { name: tableName, default_view_name: defaultViewName, fields },
    })
    const createdData = data(created)
    const createdId = string(createdData.table_id)
    if (!createdId) throw new FeishuDeliveryError(`飞书没有返回数据表 ${tableName} 的 table_id`, { kind: 'retry' })
    table = { table_id: createdId, name: tableName }
  }
  if (!table?.table_id) throw new FeishuDeliveryError(`飞书没有返回数据表 ${tableName} 的 table_id`, { kind: 'retry' })
  const tableId = table.table_id
  const fieldPayload = await api.json('GET', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields?page_size=100`)
  const current = new Map(items(fieldPayload).map(value => {
    const field = record(value) as FeishuField
    return [field.field_name ?? '', field] as const
  }))
  for (const definition of fields) {
    const name = string(definition.field_name)!
    const expectedType = definition.type
    const existing = current.get(name)
    if (existing && name === '_待复盘' && existing.type !== expectedType && existing.field_id) {
      await api.json('DELETE', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields/${encodeURIComponent(existing.field_id)}`)
      current.delete(name)
    } else if (existing) {
      if (existing.type !== expectedType) throw new FeishuDeliveryError(`数据表 ${tableName} 的字段 ${name} 类型不一致`, { kind: 'dead', status: 400 })
      continue
    }
    const created = await api.json('POST', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`, definition)
    const field = record(data(created).field) as FeishuField
    current.set(name, field)
  }
  return { tableId, fields: current }
}

async function ensureView(api: FeishuApi, appToken: string, tableId: string, name: string): Promise<string> {
  const payload = await api.json('GET', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/views?page_size=100`)
  let view = items(payload).map(value => record(value) as FeishuView).find(value => value.view_name === name)
  if (!view?.view_id) {
    const created = await api.json('POST', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/views`, {
      view_name: name, view_type: 'grid',
    })
    view = record(data(created).view) as FeishuView
  }
  if (!view.view_id) throw new FeishuDeliveryError(`飞书没有返回视图 ${name} 的 view_id`, { kind: 'retry' })
  return view.view_id
}

async function ensureSchema(api: FeishuApi, appToken: string): Promise<FeishuSchema> {
  const runs = await ensureTable(api, appToken, '运行记录', RUN_FIELDS, '全部')
  const skills = await ensureTable(api, appToken, 'Skill 调用', SKILL_FIELDS, '全部')
  await ensureView(api, appToken, runs.tableId, '全部')
  const reviewView = await ensureView(api, appToken, runs.tableId, '待复盘')
  const reviewFieldId = runs.fields.get('_待复盘')?.field_id
  const followedFieldId = runs.fields.get('是否已跟进')?.field_id
  if (!reviewFieldId) throw new FeishuDeliveryError('字段 _待复盘 缺少 field_id', { kind: 'retry' })
  if (!followedFieldId) throw new FeishuDeliveryError('字段 是否已跟进 缺少 field_id', { kind: 'retry' })
  await api.json('PATCH', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(runs.tableId)}/views/${encodeURIComponent(reviewView)}`, {
    property: {
      filter_info: { conjunction: 'and', conditions: [
        { field_id: reviewFieldId, operator: 'is', value: 'true' },
        { field_id: followedFieldId, operator: 'is', value: 'false' },
      ] },
      hidden_fields: [reviewFieldId],
    },
  })
  return { runs, skills }
}

/** Uses the same idempotent provisioning path as live delivery without creating a run row. */
export async function provisionFeishuTelemetry(
  settings: FeishuTelemetrySettings,
  credentials: CredentialsService,
  timeoutMs = 15_000,
  fetchImplementation: typeof fetch = fetch,
): Promise<{ runTableId: string; skillTableId: string }> {
  const schema = await ensureSchema(new FeishuApi(credentials, timeoutMs, fetchImplementation), settings.appToken.trim())
  return { runTableId: schema.runs.tableId, skillTableId: schema.skills.tableId }
}

async function importDocument(api: FeishuApi, folderToken: string, snapshot: FeishuRunSnapshot): Promise<{ token: string; url: string }> {
  const fileToken = await api.uploadMarkdown(runDetailMarkdown(snapshot))
  const title = `Promax运行-${snapshot.taskName}`.slice(0, 27)
  const created = await api.json('POST', '/drive/v1/import_tasks', {
    file_extension: 'md', file_name: title, file_token: fileToken, type: 'docx',
    point: { mount_type: 1, mount_key: folderToken },
  })
  const ticket = string(data(created).ticket)
  if (!ticket) throw new FeishuDeliveryError('飞书没有返回云文档导入 ticket', { kind: 'retry' })
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const polled = await api.json('GET', `/drive/v1/import_tasks/${encodeURIComponent(ticket)}`)
    const result = record(data(polled).result)
    const status = typeof result.job_status === 'number' ? result.job_status : undefined
    if (status === 0) {
      const token = string(result.token)
      const url = string(result.url)
      if (!token || !url) throw new FeishuDeliveryError('云文档导入成功但缺少 token 或 URL', { kind: 'retry' })
      return { token, url }
    }
    if (status !== 1 && status !== 2) {
      throw new FeishuDeliveryError(`云文档导入失败：${string(result.job_error_msg) ?? '未知原因'}`, { kind: 'retry' })
    }
    await new Promise<void>(resolveTimer => { setTimeout(resolveTimer, 500) })
  }
  throw new FeishuDeliveryError('云文档导入轮询超时', { kind: 'retry' })
}

function runFields(snapshot: FeishuRunSnapshot, docUrl: string, includeFollowDefaults: boolean): Record<string, unknown> {
  const needsReview = snapshot.judgeVerdict === 'block' || snapshot.dispatchChanged
    || snapshot.finalStatus === '已停止' || snapshot.finalStatus === '失败' || snapshot.repairRounds >= 2
  return {
    任务名: snapshot.taskName,
    时间: snapshot.startedAt,
    需求摘要: snapshot.demand.slice(0, 100),
    输入类型: snapshot.inputType,
    计划派工: snapshot.plannedMembers.join('、'),
    实际派工: snapshot.actualMembers.join('、'),
    派工被改: snapshot.dispatchChanged,
    产物清单: snapshot.artifacts.join('\n'),
    产物数: snapshot.artifacts.length,
    'Judge 结论': snapshot.judgeVerdict,
    返修轮数: snapshot.repairRounds,
    最终状态: snapshot.finalStatus,
    耗时秒: snapshot.durationSeconds,
    token: snapshot.tokenCount,
    会话ID: snapshot.sessionId,
    详情链接: { text: '打开运行明细', link: docUrl },
    ...(includeFollowDefaults ? { 是否已跟进: false, 跟进结论: '' } : {}),
    _待复盘: needsReview,
  }
}

async function existingRun(api: FeishuApi, appToken: string, tableId: string, sessionId: string): Promise<{ recordId: string; docUrl?: string } | undefined> {
  const payload = await api.json('POST', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/search?page_size=20`, {
    field_names: ['会话ID', '详情链接'],
    filter: { conjunction: 'and', conditions: [{ field_name: '会话ID', operator: 'is', value: [sessionId] }] },
  })
  const row = items(payload).map(record).find(Boolean)
  const recordId = string(row?.record_id)
  if (!recordId) return undefined
  const link = record(record(row?.fields)['详情链接'])
  return { recordId, ...(string(link.link) === undefined ? {} : { docUrl: string(link.link)! }) }
}

async function writeRun(api: FeishuApi, appToken: string, tableId: string, snapshot: FeishuRunSnapshot, docUrl: string): Promise<void> {
  const existing = await existingRun(api, appToken, tableId, snapshot.sessionId)
  if (existing) {
    await api.json('PUT', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(existing.recordId)}`, {
      // A retry may update telemetry, but it must never erase the operator's
      // follow-up checkbox or conclusion in Feishu.
      fields: runFields(snapshot, docUrl, false),
    })
    return
  }
  await api.json('POST', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?client_token=${stableClientToken(`run:${snapshot.sessionId}`)}`, {
    fields: runFields(snapshot, docUrl, true),
  })
}

async function writeSkills(api: FeishuApi, appToken: string, tableId: string, snapshot: FeishuRunSnapshot): Promise<void> {
  if (snapshot.skillCalls.length === 0) return
  const records = snapshot.skillCalls.map(call => ({ fields: {
    任务名: snapshot.taskName,
    时间: call.time,
    智能体: call.agent,
    'Skill 名': call.skillName,
    成败: call.success ? '成功' : '失败',
    耗时秒: call.durationSeconds,
  } }))
  await api.json('POST', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_create?client_token=${stableClientToken(`skills:${snapshot.sessionId}`)}`, { records })
}

export class FeishuReportTransport implements ReportTransport {
  private readonly api: FeishuApi

  constructor(
    private readonly settings: () => FeishuTelemetrySettings,
    credentials: CredentialsService,
    timeoutMs: number,
    fetchImplementation: typeof fetch = fetch,
  ) {
    this.api = new FeishuApi(credentials, timeoutMs, fetchImplementation)
  }

  async deliver(request: ReportRequest): Promise<DeliveryResult> {
    if (request.path !== '/feishu/v1/run' || request.filePath !== undefined) {
      return { kind: 'dead', status: 400, message: 'Feishu transport received an unsupported report request' }
    }
    const snapshot = request.body as FeishuRunSnapshot
    const configured = this.settings()
    if (configured.appToken.trim() === '' || configured.folderToken.trim() === '') {
      return { kind: 'retry', message: '飞书遥测目标尚未配置' }
    }
    const state = isRecord(request.deliveryState) ? request.deliveryState as FeishuDeliveryState : {}
    const persist = async (): Promise<void> => { await request.persistDeliveryState?.(state) }
    try {
      const schema = await ensureSchema(this.api, configured.appToken.trim())
      if (!state.docUrl || !state.docToken) {
        const existing = await existingRun(this.api, configured.appToken.trim(), schema.runs.tableId, snapshot.sessionId)
        if (existing?.docUrl) state.docUrl = existing.docUrl
      }
      if (!state.docUrl) {
        const document = await importDocument(this.api, configured.folderToken.trim(), snapshot)
        state.docToken = document.token
        state.docUrl = document.url
        await persist()
      }
      if (!state.runWritten) {
        await writeRun(this.api, configured.appToken.trim(), schema.runs.tableId, snapshot, state.docUrl)
        state.runWritten = true
        await persist()
      }
      if (!state.skillsWritten) {
        await writeSkills(this.api, configured.appToken.trim(), schema.skills.tableId, snapshot)
        state.skillsWritten = true
        await persist()
      }
      return { kind: 'success', status: 200 }
    } catch (error: unknown) {
      if (error instanceof FeishuDeliveryError) {
        return error.kind === 'dead'
          ? { kind: 'dead', status: error.status ?? 400, message: error.message }
          : { kind: 'retry', ...(error.status === undefined ? {} : { status: error.status }), message: error.message }
      }
      return { kind: 'retry', message: error instanceof Error ? error.message : String(error) }
    }
  }
}
