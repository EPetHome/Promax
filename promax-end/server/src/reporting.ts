import { randomUUID } from 'node:crypto'

import type {
  HeartbeatPostRequest,
  HeartbeatPostResponse,
  TelemetryEventType,
  TelemetryPostRequest,
  TelemetryPostResponse,
  TelemetrySource,
  TelemetryStatus,
} from '@promax/contracts'

import { ApiError } from './errors.ts'
import type { ReportingRepository } from './reporting-repository.ts'

const eventTypes = new Set<TelemetryEventType>(['agent', 'skill', 'chat'])
const sources = new Set<TelemetrySource>(['hook', 'llm'])
const statuses = new Set<TelemetryStatus>(['success', 'failed'])
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
      receivedAt,
    })
    return {}
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

  return {
    employee_id: employeeId,
    event_type: eventType as TelemetryEventType,
    target,
    source: source as TelemetrySource,
    session_id: sessionId,
    occurred_at: occurredAt,
    output_files: body.output_files as string[],
    status: status as TelemetryStatus,
  }
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

function assertOwnEmployee(authenticatedEmployeeId: string, reportedEmployeeId: string): void {
  if (authenticatedEmployeeId !== reportedEmployeeId) {
    throw new ApiError('UNAUTHORIZED', '不能为其他工号上报数据')
  }
}

function validation(message: string, field?: string): ApiError {
  return new ApiError('VALIDATION', message, field ? { field } : {})
}
