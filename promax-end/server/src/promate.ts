import type {
  PromateArtifactOperation,
  PromateArtifactProposeRequest,
  PromateArtifactResponse,
  PromateEnvelope,
  PromateNext,
  PromateOperationResponse,
  PromateProject,
  PromateProjectsResponse,
  PromateRequirement,
  PromateRequirementsResponse,
  PromateSkill,
  PromateSkillSummary,
  PromateSkillsResponse,
  PromateSkillResponse,
} from '@promax/contracts'

import type { ArtifactRepository } from './artifact-repository.ts'
import type { AuthenticatedUser } from './auth.ts'
import { ApiError } from './errors.ts'
import type { PromateCredentialProvider } from './promate-credentials.ts'
import { PromateGatewayError, type PromateGateway } from './promate-gateway.ts'
import type {
  PromateCallRecord,
  PromateOperationRecord,
  PromateOperationRepository,
} from './promate-operation-repository.ts'

interface PromateServiceOptions {
  orgId: string
  publicBaseUrl: string
  maxAttempts: number
  requirementsTool: 'list_requirements' | 'my_requirements'
  now?: () => Date
}

interface ProxyContext {
  requestId: string
  employeeId: string
  agent: string
  projectId?: string
  capability: string
  stage: string
}

interface Invocation {
  payload: unknown
  attempts: number
}

interface CommitResult {
  statusCode: 200 | 202
  response: PromateArtifactResponse
}

interface UpstreamEnvelope {
  ok: boolean
  data: unknown
  next?: unknown
  errorCode?: string
  message?: string
}

const nextTypes = new Set(['choose_one', 'confirm', 'ask_text', 'done'])

export class PromateService {
  private readonly now: () => Date
  private readonly publicBaseUrl: string
  private readonly inFlightCommits = new Map<string, Promise<CommitResult>>()

  constructor(
    private readonly gateway: PromateGateway,
    private readonly credentials: PromateCredentialProvider,
    private readonly operations: PromateOperationRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly options: PromateServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date())
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/$/u, '')
  }

  async projects(user: AuthenticatedUser, agent: string, requestId: string): Promise<PromateProjectsResponse> {
    const context = this.context(user, agent, requestId, 'projects', 'read')
    const invocation = await this.invokeWithRetry(context, 'my_projects', {})
    const upstream = unpackEnvelope(invocation.payload)
    return readEnvelope(requestId, upstream, () => projectList(upstream.data))
  }

  async requirements(
    user: AuthenticatedUser,
    agent: string,
    requestId: string,
    query: { projectId: string; query?: string; includeDone: boolean },
  ): Promise<PromateRequirementsResponse> {
    const context = this.context(user, agent, requestId, 'requirements', 'read', query.projectId)
    const invocation = await this.invokeWithRetry(context, this.options.requirementsTool, {
      project_id: query.projectId,
      ...(query.query === undefined ? {} : { query: query.query }),
      include_done: query.includeDone,
    })
    const upstream = unpackEnvelope(invocation.payload)
    return readEnvelope(requestId, upstream, () => requirementList(upstream.data))
  }

  async skills(
    user: AuthenticatedUser,
    agent: string,
    requestId: string,
    query: { query?: string; category?: string },
  ): Promise<PromateSkillsResponse> {
    const context = this.context(user, agent, requestId, 'skills', 'read')
    const invocation = await this.invokeWithRetry(context, 'list_skills', {
      ...(query.query === undefined ? {} : { query: query.query }),
      ...(query.category === undefined ? {} : { category: query.category }),
    })
    const upstream = unpackEnvelope(invocation.payload)
    return readEnvelope(requestId, upstream, () => skillSummaryList(upstream.data))
  }

  async skill(
    user: AuthenticatedUser,
    agent: string,
    requestId: string,
    id: string,
  ): Promise<PromateSkillResponse> {
    const context = this.context(user, agent, requestId, 'skill', 'read')
    const invocation = await this.invokeWithRetry(context, 'get_skill', { id })
    const upstream = unpackEnvelope(invocation.payload)
    return readEnvelope(requestId, upstream, () => skillDetail(upstream.data))
  }

  async proposeArtifact(
    user: AuthenticatedUser,
    agent: string,
    requestId: string,
    input: PromateArtifactProposeRequest,
  ): Promise<PromateArtifactResponse> {
    const artifact = this.artifacts.findById(input.artifact_id)
    if (!artifact) throw new ApiError('VALIDATION', '产出物不存在', { field: 'artifact_id' })
    if (artifact.employeeId !== user.employeeId && user.role !== 'admin') {
      throw new ApiError('UNAUTHORIZED', '无权关联该产出物')
    }
    const existing = this.operations.findByRequestId(requestId)
    if (existing) {
      return this.repeatedProposal(user, agent, existing, input)
    }

    const context = this.context(user, agent, requestId, 'artifact', 'propose', input.project_id)
    const invocation = await this.invokeWithRetry(context, 'add_artifact', {
      project_id: input.project_id,
      requirement_id: input.requirement_id,
      type: input.type,
      name: artifact.filename,
      url: `${this.publicBaseUrl}/api/v1/artifacts/${encodeURIComponent(artifact.artifactId)}/download`,
      summary: input.summary ?? '',
      agent: artifact.agent,
    })
    const upstream = unpackEnvelope(invocation.payload)
    if (!upstream.ok) throw upstreamValidation(upstream)
    const confirmToken = upstreamConfirmToken(upstream.next)
    const next = publicNext(upstream.next)
    if (next?.type !== 'confirm') {
      throw new ApiError('UPSTREAM_UNAVAILABLE', 'Promate 未返回确认步骤', { upstream_code: 'PROMATE_CONFIRM_REQUIRED' })
    }

    const now = this.now().toISOString()
    const record: PromateOperationRecord = {
      requestId,
      employeeId: user.employeeId,
      orgId: this.options.orgId,
      agent,
      artifactId: artifact.artifactId,
      projectId: input.project_id,
      requirementId: input.requirement_id,
      artifactType: input.type,
      summary: input.summary ?? '',
      confirmToken,
      status: 'proposed',
      attempts: invocation.attempts,
      commitAttempts: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.operations.create(record)
    return {
      request_id: requestId,
      ok: true,
      data: operationView(record),
      next,
    }
  }

  async commitArtifact(user: AuthenticatedUser, agent: string, requestId: string): Promise<CommitResult> {
    const record = this.authorizedOperation(user, agent, requestId)
    if (record.status === 'synced') {
      return { statusCode: 200, response: syncedResponse(record) }
    }
    if (record.status === 'dead') {
      return { statusCode: 200, response: failedResponse(record) }
    }
    return this.attemptCommit(record)
  }

  operation(user: AuthenticatedUser, agent: string, requestId: string): PromateOperationResponse {
    const record = this.authorizedOperation(user, agent, requestId)
    return { request_id: requestId, ok: record.status !== 'dead', data: operationView(record) }
  }

  async retryPending(limit = 25): Promise<void> {
    for (const record of this.operations.listPending(limit)) {
      await this.attemptCommit(record)
    }
  }

  private async attemptCommit(record: PromateOperationRecord): Promise<CommitResult> {
    const existing = this.inFlightCommits.get(record.requestId)
    if (existing) return existing
    const running = this.performCommit(record).finally(() => {
      this.inFlightCommits.delete(record.requestId)
    })
    this.inFlightCommits.set(record.requestId, running)
    return running
  }

  private async performCommit(record: PromateOperationRecord): Promise<CommitResult> {
    if (record.commitAttempts >= this.options.maxAttempts) {
      const dead = this.operations.markDead(record.requestId, 'PROMATE_RETRY_EXHAUSTED', this.now().toISOString())
      return { statusCode: 200, response: failedResponse(dead) }
    }

    const attempted = this.operations.incrementAttempts(record.requestId, this.now().toISOString())
    const context: ProxyContext = {
      requestId: attempted.requestId,
      employeeId: attempted.employeeId,
      agent: attempted.agent,
      projectId: attempted.projectId,
      capability: 'artifact',
      stage: 'commit',
    }
    try {
      const token = this.requiredToken(attempted.employeeId)
      const payload = await this.gateway.callTool({
        token,
        requestId: attempted.requestId,
        tool: 'add_artifact',
        arguments: this.commitArguments(attempted),
      })
      const upstream = unpackEnvelope(payload)
      if (!upstream.ok) {
        const code = upstream.errorCode ?? 'PROMATE_BUSINESS_ERROR'
        const dead = this.operations.markDead(attempted.requestId, code, this.now().toISOString())
        this.audit(context, 'failed', code)
        return {
          statusCode: 200,
          response: { ...failedResponse(dead), ...(upstream.message === undefined ? {} : { message: upstream.message }) },
        }
      }
      const data = recordValue(upstream.data, 'Promate 产出登记响应')
      const remoteId = requiredString(data.artifact_id, 'artifact_id')
      const requirementUrl = optionalString(data.requirement_url, 'requirement_url')
      const synced = this.operations.markSynced(
        attempted.requestId,
        remoteId,
        requirementUrl,
        this.now().toISOString(),
      )
      this.audit(context, 'success')
      return {
        statusCode: 200,
        response: {
          request_id: synced.requestId,
          ok: true,
          data: operationView(synced),
          ...(publicNext(upstream.next) === undefined ? {} : { next: publicNext(upstream.next) as PromateNext }),
        },
      }
    } catch (error: unknown) {
      const gatewayError = error instanceof PromateGatewayError
        ? error
        : new PromateGatewayError('Promate 产出登记响应无效', 'PROMATE_PROTOCOL_ERROR', false)
      const canRetry = gatewayError.retryable && attempted.commitAttempts < this.options.maxAttempts
      const updated = canRetry
        ? this.operations.markPending(attempted.requestId, gatewayError.code, this.now().toISOString())
        : this.operations.markDead(attempted.requestId, gatewayError.code, this.now().toISOString())
      this.audit(context, canRetry ? 'pending' : 'failed', gatewayError.code)
      return {
        statusCode: canRetry ? 202 : 200,
        response: canRetry ? pendingResponse(updated) : failedResponse(updated),
      }
    }
  }

  private commitArguments(record: PromateOperationRecord): Record<string, unknown> {
    const artifact = this.artifacts.findById(record.artifactId)
    if (!artifact) throw new PromateGatewayError('Promax 产出物记录已丢失', 'PROMAX_ARTIFACT_MISSING', false)
    return {
      project_id: record.projectId,
      requirement_id: record.requirementId,
      type: record.artifactType,
      name: artifact.filename,
      url: `${this.publicBaseUrl}/api/v1/artifacts/${encodeURIComponent(artifact.artifactId)}/download`,
      summary: record.summary,
      agent: artifact.agent,
      confirm_token: record.confirmToken,
    }
  }

  private repeatedProposal(
    user: AuthenticatedUser,
    agent: string,
    record: PromateOperationRecord,
    input: PromateArtifactProposeRequest,
  ): PromateArtifactResponse {
    if (record.employeeId !== user.employeeId || record.agent !== agent
      || record.artifactId !== input.artifact_id || record.projectId !== input.project_id
      || record.requirementId !== input.requirement_id || record.artifactType !== input.type
      || record.summary !== (input.summary ?? '')) {
      throw new ApiError('CONFLICT', 'request_id 已绑定其他 Promate 提案', { request_id: record.requestId })
    }
    if (record.status === 'synced') return syncedResponse(record)
    if (record.status === 'pending') return pendingResponse(record)
    if (record.status === 'dead') return failedResponse(record)
    return {
      request_id: record.requestId,
      ok: true,
      data: operationView(record),
      next: {
        type: 'confirm',
        question: '关联提案已保存，是否继续提交？',
        instruction: '等待用户明确确认；确认后只提交 request_id。',
      },
    }
  }

  private async invokeWithRetry(
    context: ProxyContext,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<Invocation> {
    let token: string
    try {
      token = this.requiredToken(context.employeeId)
    } catch (error: unknown) {
      if (error instanceof PromateGatewayError) throw upstreamUnavailable(error)
      throw error
    }
    let lastError: PromateGatewayError | undefined
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        const payload = await this.gateway.callTool({ token, requestId: context.requestId, tool, arguments: args })
        this.audit(context, 'success')
        return { payload, attempts: attempt }
      } catch (error: unknown) {
        const gatewayError = error instanceof PromateGatewayError
          ? error
          : new PromateGatewayError('Promate MCP 响应无效', 'PROMATE_PROTOCOL_ERROR', false)
        lastError = gatewayError
        this.audit(context, 'failed', gatewayError.code)
        if (!gatewayError.retryable || attempt >= this.options.maxAttempts) break
      }
    }
    throw upstreamUnavailable(lastError as PromateGatewayError)
  }

  private requiredToken(employeeId: string): string {
    const token = this.credentials.tokenFor(employeeId)
    if (!token) {
      throw new PromateGatewayError('当前员工未配置 Promate 凭证', 'PROMATE_CREDENTIAL_MISSING', true)
    }
    return token
  }

  private authorizedOperation(user: AuthenticatedUser, agent: string, requestId: string): PromateOperationRecord {
    const record = this.operations.findByRequestId(requestId)
    if (!record) throw new ApiError('VALIDATION', 'Promate 操作不存在', { field: 'request_id' })
    if (record.employeeId !== user.employeeId && user.role !== 'admin') {
      throw new ApiError('UNAUTHORIZED', '无权访问该 Promate 操作')
    }
    if (record.agent !== agent) throw new ApiError('CONFLICT', 'Agent 与原提案不一致', { field: 'X-Promax-Agent' })
    return record
  }

  private context(
    user: AuthenticatedUser,
    agent: string,
    requestId: string,
    capability: string,
    stage: string,
    projectId?: string,
  ): ProxyContext {
    return {
      requestId,
      employeeId: user.employeeId,
      agent,
      capability,
      stage,
      ...(projectId === undefined ? {} : { projectId }),
    }
  }

  private audit(context: ProxyContext, status: PromateCallRecord['status'], errorCode?: string): void {
    this.operations.recordCall({
      requestId: context.requestId,
      employeeId: context.employeeId,
      orgId: this.options.orgId,
      agent: context.agent,
      ...(context.projectId === undefined ? {} : { projectId: context.projectId }),
      capability: context.capability,
      stage: context.stage,
      status,
      ...(errorCode === undefined ? {} : { errorCode }),
      occurredAt: this.now().toISOString(),
    })
  }
}

export class PromateRetryWorker {
  private timer: NodeJS.Timeout | undefined
  private running: Promise<void> | undefined

  constructor(
    private readonly service: PromateService,
    private readonly intervalMs: number,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    this.timer.unref()
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.running
  }

  private async tick(): Promise<void> {
    if (this.running) return this.running
    this.running = this.service.retryPending().catch(this.onError).finally(() => {
      this.running = undefined
    })
    return this.running
  }
}

function unpackEnvelope(value: unknown): UpstreamEnvelope {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return { ok: true, data: value }
  return {
    ok: value.ok,
    data: value.data ?? {},
    ...('next' in value ? { next: value.next } : {}),
    ...(typeof value.error_code === 'string' ? { errorCode: value.error_code } : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
  }
}

function publicEnvelope<T>(requestId: string, upstream: UpstreamEnvelope, data: T): PromateEnvelope<T> {
  const next = publicNext(upstream.next)
  return {
    request_id: requestId,
    ok: upstream.ok,
    data,
    ...(next === undefined ? {} : { next }),
    ...(upstream.errorCode === undefined ? {} : { error_code: upstream.errorCode }),
    ...(upstream.message === undefined ? {} : { message: upstream.message }),
  }
}

function readEnvelope<T>(requestId: string, upstream: UpstreamEnvelope, normalize: () => T): PromateEnvelope<T> {
  try {
    return publicEnvelope(requestId, upstream, normalize())
  } catch (error: unknown) {
    if (error instanceof PromateGatewayError) throw upstreamUnavailable(error)
    throw error
  }
}

function publicNext(value: unknown): PromateNext | undefined {
  if (!isRecord(value) || typeof value.type !== 'string' || !nextTypes.has(value.type)) return undefined
  const options = Array.isArray(value.options)
    ? value.options.map((option) => {
        const record = recordValue(option, 'Promate next option')
        return { value: requiredString(record.value, 'value'), label: requiredString(record.label, 'label') }
      })
    : undefined
  return {
    type: value.type as PromateNext['type'],
    ...(typeof value.question === 'string' ? { question: value.question } : {}),
    ...(options === undefined ? {} : { options }),
    ...(typeof value.then_call === 'string' ? { then_call: value.then_call } : {}),
    ...(typeof value.then_arg === 'string' ? { then_arg: value.then_arg } : {}),
    ...(typeof value.instruction === 'string' ? { instruction: value.instruction } : {}),
  }
}

function upstreamConfirmToken(next: unknown): string {
  if (!isRecord(next) || typeof next.confirm_token !== 'string' || next.confirm_token.length === 0) {
    throw new ApiError('UPSTREAM_UNAVAILABLE', 'Promate 未返回有效确认令牌', { upstream_code: 'PROMATE_CONFIRM_TOKEN_MISSING' })
  }
  return next.confirm_token
}

function projectList(value: unknown): PromateProject[] {
  return arrayValue(value, 'Promate 项目列表').map((item) => {
    const record = recordValue(item, 'Promate 项目')
    return {
      project_id: requiredString(record.project_id, 'project_id'),
      name: requiredString(record.name, 'name'),
      req_count: nonNegativeInteger(record.req_count, 'req_count'),
    }
  })
}

function requirementList(value: unknown): PromateRequirement[] {
  return arrayValue(value, 'Promate 需求列表').map((item) => {
    const record = recordValue(item, 'Promate 需求')
    return {
      requirement_id: requiredString(record.requirement_id, 'requirement_id'),
      title: requiredString(record.title, 'title'),
      version: requiredString(record.version, 'version'),
      done: booleanValue(record.done, 'done'),
      artifact_count: nonNegativeInteger(record.artifact_count, 'artifact_count'),
    }
  })
}

function skillSummaryList(value: unknown): PromateSkillSummary[] {
  return arrayValue(value, 'Promate Skill 列表').map((item) => {
    const record = recordValue(item, 'Promate Skill')
    return {
      id: requiredString(record.id, 'id'),
      name: requiredString(record.name, 'name'),
      version: requiredString(record.version, 'version'),
      author: requiredString(record.author, 'author'),
      category: requiredString(record.category, 'category'),
      description: requiredString(record.description, 'description'),
      updated_at: requiredString(record.updated_at, 'updated_at'),
    }
  })
}

function skillDetail(value: unknown): PromateSkill {
  const record = recordValue(value, 'Promate Skill')
  return {
    id: requiredString(record.id, 'id'),
    name: requiredString(record.name, 'name'),
    version: requiredString(record.version, 'version'),
    files: arrayValue(record.files, 'files').map((item) => {
      const file = recordValue(item, 'Skill file')
      return { path: requiredString(file.path, 'path'), content: requiredString(file.content, 'content') }
    }),
    download_url: requiredString(record.download_url, 'download_url'),
  }
}

function operationView(record: PromateOperationRecord): PromateArtifactOperation {
  return {
    request_id: record.requestId,
    artifact_id: record.artifactId,
    project_id: record.projectId,
    requirement_id: record.requirementId,
    status: record.status,
    attempts: record.attempts,
    ...(record.promateArtifactId === undefined ? {} : { promate_artifact_id: record.promateArtifactId }),
    ...(record.requirementUrl === undefined ? {} : { requirement_url: record.requirementUrl }),
    ...(record.lastErrorCode === undefined ? {} : { last_error_code: record.lastErrorCode }),
  }
}

function syncedResponse(record: PromateOperationRecord): PromateArtifactResponse {
  return {
    request_id: record.requestId,
    ok: true,
    data: operationView(record),
    next: { type: 'done', question: '产出物已关联', instruction: '向用户报告关联结果。' },
  }
}

function pendingResponse(record: PromateOperationRecord): PromateArtifactResponse {
  return {
    request_id: record.requestId,
    ok: true,
    data: operationView(record),
    message: 'Promate 暂不可用，关联操作已进入持久补偿队列',
  }
}

function failedResponse(record: PromateOperationRecord): PromateArtifactResponse {
  return {
    request_id: record.requestId,
    ok: false,
    data: operationView(record),
    error_code: record.lastErrorCode ?? 'PROMATE_OPERATION_DEAD',
    message: 'Promate 关联未完成，请重新发起确认',
  }
}

function upstreamValidation(upstream: UpstreamEnvelope): ApiError {
  return new ApiError('VALIDATION', upstream.message ?? 'Promate 拒绝了业务请求', {
    upstream_code: upstream.errorCode ?? 'PROMATE_BUSINESS_ERROR',
  })
}

function upstreamUnavailable(error: PromateGatewayError): ApiError {
  return new ApiError('UPSTREAM_UNAVAILABLE', error.message, {
    capability: 'promate',
    upstream_code: error.code,
    retryable: error.retryable,
  })
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new PromateGatewayError(`${label}格式无效`, 'PROMATE_PROTOCOL_ERROR', false)
  return value
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new PromateGatewayError(`${label}格式无效`, 'PROMATE_PROTOCOL_ERROR', false)
  return value
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PromateGatewayError(`Promate 字段 ${field} 无效`, 'PROMATE_PROTOCOL_ERROR', false)
  }
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return requiredString(value, field)
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new PromateGatewayError(`Promate 字段 ${field} 无效`, 'PROMATE_PROTOCOL_ERROR', false)
  }
  return value
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new PromateGatewayError(`Promate 字段 ${field} 无效`, 'PROMATE_PROTOCOL_ERROR', false)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
