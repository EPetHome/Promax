import { randomUUID } from 'node:crypto'

import type {
  DecisionTarget,
  HeartbeatPostRequest,
  HeartbeatPostResponse,
  InformationKey,
  LegacyTelemetryEventType,
  TaskSlot,
  TaskSlotStatus,
  TaskStatePostRequest,
  TaskStatePostResponse,
  TaskTier,
  TelemetryDecision,
  TelemetryEventType,
  TelemetryPostRequest,
  TelemetryPostResponse,
  TelemetrySource,
  TelemetryStatus,
} from '@promax/contracts'

import { ApiError } from './errors.ts'
import type { ReportingRepository } from './reporting-repository.ts'

const eventTypes = new Set<TelemetryEventType>(['agent', 'skill', 'chat', 'decision'])
const decisionTargets = new Set<DecisionTarget>([
  'handoff.confirm', 'handoff.edit', 'coverage.override',
  'task.abandon', 'judge.force-release', 'judge.appeal',
])
const decisionFields = new Set(['task_key', 'revision', 'subject', 'before', 'after', 'reason'])
const sources = new Set<TelemetrySource>(['hook', 'llm'])
const statuses = new Set<TelemetryStatus>(['success', 'failed'])
const taskTiers = new Set<TaskTier>(['draft', 'single', 'team'])
const slotStatuses = new Set<TaskSlotStatus>(['provided', 'produced', 'pending', 'empty_non_blocking', 'gap'])
const informationKeys = new Set<InformationKey>([
  'goal', 'target_user', 'scenario', 'pain_point', 'scope', 'constraint',
  'success_criteria', 'competitive_difference', 'requirements_priority',
])
const isoWithTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const fingerprintPattern = /^sha256:[a-f0-9]{64}$/

export class ReportingService {
  constructor(
    private readonly repository: ReportingRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => `evt_${randomUUID().replaceAll('-', '')}`,
  ) {}

  telemetry(authenticatedEmployeeId: string, value: unknown): TelemetryPostResponse {
    const request = telemetryRequest(value)
    assertOwnEmployee(authenticatedEmployeeId, request.employee_id)
    const receivedAt = this.now().toISOString()
    this.repository.insertTelemetry({
      id: this.createId(),
      employeeId: request.employee_id,
      eventType: request.event_type,
      target: request.target,
      source: request.source,
      sessionId: request.session_id,
      occurredAt: request.occurred_at,
      status: request.status,
      outputFiles: request.output_files,
      ...request.event_type === 'decision' ? { decision: request.decision } : {},
      receivedAt,
    })
    return {}
  }

  taskState(authenticatedEmployeeId: string, value: unknown): TaskStatePostResponse {
    const request = taskStateRequest(value)
    assertOwnEmployee(authenticatedEmployeeId, request.employee_id)
    const result = this.repository.saveTaskState(request, this.now().toISOString())
    if (result === 'stale') throw new ApiError('CONFLICT', '旧 coverage_revision 不得覆盖新快照', { field: 'coverage_revision' })
    if (result === 'conflict') throw new ApiError('CONFLICT', '同一 coverage_revision 的槽位快照不一致', { field: 'coverage_revision' })
    return request
  }

  heartbeat(authenticatedEmployeeId: string, value: unknown): HeartbeatPostResponse {
    const request = heartbeatRequest(value)
    assertOwnEmployee(authenticatedEmployeeId, request.employee_id)
    this.repository.upsertHeartbeat({
      employeeId: request.employee_id,
      clientVersion: request.client_version,
      dshVersion: request.dsh_version,
      configFingerprint: request.config_fingerprint,
      at: this.now().toISOString(),
    })
    return {}
  }
}

function telemetryRequest(value: unknown): TelemetryPostRequest {
  const body = objectBody(value)
  const employeeId = requiredString(body, 'employee_id')
  const eventType = requiredString(body, 'event_type')
  const target = requiredString(body, 'target')
  const source = requiredString(body, 'source')
  const sessionId = requiredString(body, 'session_id')
  const occurredAt = requiredString(body, 'occurred_at')
  const status = requiredString(body, 'status')

  if (!eventTypes.has(eventType as TelemetryEventType)) throw validation('event_type 无效', 'event_type')
  if (!sources.has(source as TelemetrySource)) throw validation('source 无效', 'source')
  if (!statuses.has(status as TelemetryStatus)) throw validation('status 无效', 'status')
  if (eventType === 'chat' && target !== '-') throw validation('chat 事件的 target 必须是 -', 'target')
  if (!isoWithTimezone.test(occurredAt) || Number.isNaN(Date.parse(occurredAt))) {
    throw validation('occurred_at 必须是带时区的 ISO 8601 时间', 'occurred_at')
  }
  if (!Array.isArray(body.output_files) || !body.output_files.every((item) => typeof item === 'string')) {
    throw validation('output_files 必须是字符串数组', 'output_files')
  }

  const common = {
    employee_id: employeeId,
    source: source as TelemetrySource,
    session_id: sessionId,
    occurred_at: occurredAt,
    output_files: body.output_files as string[],
    status: status as TelemetryStatus,
  }
  if (eventType === 'decision') {
    if (!decisionTargets.has(target as DecisionTarget)) throw validation('decision 事件的 target 无效', 'target')
    return {
      ...common,
      event_type: 'decision',
      target: target as DecisionTarget,
      decision: telemetryDecision(body.decision),
    }
  }
  if (body.decision !== undefined) throw validation('非 decision 事件不得携带 decision', 'decision')
  return {
    ...common,
    event_type: eventType as LegacyTelemetryEventType,
    target,
  }
}

function telemetryDecision(value: unknown): TelemetryDecision {
  const decision = objectBody(value)
  for (const key of Object.keys(decision)) {
    if (!decisionFields.has(key)) throw validation(`decision.${key} 未定义`, `decision.${key}`)
  }
  const taskKey = requiredString(decision, 'task_key')
  if (taskKey.length > 40 || /[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(taskKey) || taskKey === '.' || taskKey === '..') {
    throw validation('decision.task_key 无效', 'decision.task_key')
  }
  const revision = optionalPositiveInteger(decision.revision, 'decision.revision')
  const subject = optionalLimitedString(decision.subject, 'decision.subject', 256)
  const reason = optionalLimitedString(decision.reason, 'decision.reason', 2_000)
  if (JSON.stringify(decision).length > 16_384) throw validation('decision 过大，不得包含原始材料全文', 'decision')
  return {
    task_key: taskKey,
    ...revision === undefined ? {} : { revision },
    ...subject === undefined ? {} : { subject },
    ...decision.before === undefined ? {} : { before: decision.before },
    ...decision.after === undefined ? {} : { after: decision.after },
    ...reason === undefined ? {} : { reason },
  }
}

function taskStateRequest(value: unknown): TaskStatePostRequest {
  const body = objectBody(value)
  const employeeId = requiredString(body, 'employee_id')
  const project = requiredString(body, 'project')
  const sessionId = requiredString(body, 'session_id')
  const taskKey = requiredString(body, 'task_key')
  const tier = requiredString(body, 'tier')
  const updatedAt = requiredString(body, 'updated_at')
  if (!taskTiers.has(tier as TaskTier)) throw validation('tier 无效', 'tier')
  const coverageRevision = positiveInteger(body.coverage_revision, 'coverage_revision')
  if (!isoWithTimezone.test(updatedAt) || Number.isNaN(Date.parse(updatedAt))) {
    throw validation('updated_at 必须是带时区的 ISO 8601 时间', 'updated_at')
  }
  if (!Array.isArray(body.slots)) throw validation('slots 必须是数组', 'slots')
  const slotIds = new Set<string>()
  const slots = body.slots.map((value, index) => {
    const slot = taskSlot(value, index)
    if (slotIds.has(slot.slot_id)) throw validation('slot_id 不得重复', `slots.${index}.slot_id`)
    slotIds.add(slot.slot_id)
    return slot
  })
  return {
    employee_id: employeeId,
    project,
    session_id: sessionId,
    task_key: taskKey,
    tier: tier as TaskTier,
    coverage_revision: coverageRevision,
    updated_at: updatedAt,
    slots,
  }
}

function taskSlot(value: unknown, index: number): TaskSlot {
  const body = objectBody(value)
  const prefix = `slots.${index}`
  const status = requiredString(body, 'status')
  if (!slotStatuses.has(status as TaskSlotStatus)) throw validation('slot status 无效', `${prefix}.status`)
  if (!Array.isArray(body.satisfied_by)) throw validation('satisfied_by 必须是数组', `${prefix}.satisfied_by`)
  return {
    slot_id: requiredString(body, 'slot_id'),
    member_id: requiredString(body, 'member_id'),
    label: requiredString(body, 'label'),
    status: status as TaskSlotStatus,
    provides: informationKeyArray(body.provides, `${prefix}.provides`),
    requires: informationKeyArray(body.requires, `${prefix}.requires`),
    satisfied_by: body.satisfied_by.map((item, satisfiedIndex) => {
      const record = objectBody(item)
      const informationKey = requiredString(record, 'information_key')
      if (!informationKeys.has(informationKey as InformationKey)) {
        throw validation('information_key 无效', `${prefix}.satisfied_by.${satisfiedIndex}.information_key`)
      }
      return {
        source_id: requiredString(record, 'source_id'),
        information_key: informationKey as InformationKey,
        locator: requiredString(record, 'locator'),
      }
    }),
    missing: informationKeyArray(body.missing, `${prefix}.missing`),
  }
}

function informationKeyArray(value: unknown, field: string): InformationKey[] {
  if (!Array.isArray(value)) throw validation(`${field} 必须是数组`, field)
  const result = value.map(item => {
    if (typeof item !== 'string' || !informationKeys.has(item as InformationKey)) throw validation(`${field} 含无效信息项`, field)
    return item as InformationKey
  })
  if (new Set(result).size !== result.length) throw validation(`${field} 不得重复`, field)
  return result
}

function heartbeatRequest(value: unknown): HeartbeatPostRequest {
  const body = objectBody(value)
  const employeeId = requiredString(body, 'employee_id')
  const clientVersion = requiredString(body, 'client_version')
  const dshVersion = requiredString(body, 'dsh_version')
  const configFingerprint = requiredString(body, 'config_fingerprint')
  if (!fingerprintPattern.test(configFingerprint)) {
    throw validation('config_fingerprint 必须是 sha256:<64位小写十六进制>', 'config_fingerprint')
  }
  return {
    employee_id: employeeId,
    client_version: clientVersion,
    dsh_version: dshVersion,
    config_fingerprint: configFingerprint,
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw validation('请求体必须是 JSON 对象')
  return value as Record<string, unknown>
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.length === 0) throw validation(`${field} 不能为空`, field)
  return value
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw validation(`${field} 必须是正整数`, field)
  return value
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : positiveInteger(value, field)
}

function optionalLimitedString(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) throw validation(`${field} 无效`, field)
  return value
}

function assertOwnEmployee(authenticatedEmployeeId: string, reportedEmployeeId: string): void {
  if (authenticatedEmployeeId !== reportedEmployeeId) {
    throw new ApiError('UNAUTHORIZED', '不能为其他工号上报数据')
  }
}

function validation(message: string, field?: string): ApiError {
  return new ApiError('VALIDATION', message, field ? { field } : {})
}
