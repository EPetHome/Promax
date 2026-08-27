import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import type {
  ArtifactKind,
  ConsoleArtifactsResponse,
  ConsoleOverviewResponse,
  ConsoleTelemetryResponse,
  ConsoleUser,
  ConsoleUsersResponse,
  TelemetryEventType,
  TelemetryGroupBy,
  TelemetrySource,
} from '@promax/contracts'

import type { ArtifactRepository } from './artifact-repository.ts'
import type { AuthenticatedUser } from './auth.ts'
import type { ArtifactListFilter, ConsoleRepository, TelemetrySeriesFilter } from './console-repository.ts'
import { ApiError } from './errors.ts'

const DAY_MS = 24 * 60 * 60 * 1_000
const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const artifactKinds = new Set<ArtifactKind>(['prd', 'diagram', 'prototype', 'other'])
const eventTypes = new Set<TelemetryEventType>(['agent', 'skill', 'chat'])
const sources = new Set<TelemetrySource>(['hook', 'llm'])
const groupings = new Set<TelemetryGroupBy>(['day', 'user', 'target'])
const isoWithTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export interface ArtifactDownload {
  content: Buffer
  filename: string
}

export class ConsoleService {
  constructor(
    private readonly repository: ConsoleRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly dataDirectory: string,
    private readonly staleAfterDays: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  overview(user: AuthenticatedUser): ConsoleOverviewResponse {
    requireAdmin(user)
    const now = this.now()
    const users = this.usersFromFacts(now)
    const sevenDayCutoff = new Date(now.getTime() - 7 * DAY_MS)
    const active = users.filter(candidate => candidate.last_report_at !== null
      && Date.parse(candidate.last_report_at) >= sevenDayCutoff.getTime()).length
    const ok = users.filter(candidate => candidate.status === 'ok').length
    return {
      users_total: users.length,
      users_active_7d: active,
      artifacts_total: this.repository.countArtifacts(),
      artifacts_7d: this.repository.countArtifactsSince(sevenDayCutoff.toISOString()),
      coverage_rate: users.length === 0 ? 0 : Number((ok / users.length).toFixed(4)),
    }
  }

  users(user: AuthenticatedUser): ConsoleUsersResponse {
    requireAdmin(user)
    return this.usersFromFacts(this.now())
  }

  artifactList(user: AuthenticatedUser, value: unknown): ConsoleArtifactsResponse {
    requireAdmin(user)
    const query = queryObject(value)
    const page = positiveQueryInteger(query.page, DEFAULT_PAGE, 'page')
    const size = positiveQueryInteger(query.size, DEFAULT_PAGE_SIZE, 'size')
    if (size > MAX_PAGE_SIZE) throw validation(`size 不能超过 ${MAX_PAGE_SIZE}`, 'size')
    const kind = optionalString(query.kind, 'kind')
    if (kind !== undefined && !artifactKinds.has(kind as ArtifactKind)) throw validation('kind 无效', 'kind')
    const from = optionalDate(query.from, 'from')
    const to = optionalDate(query.to, 'to')
    const employeeId = optionalString(query.employee_id, 'employee_id')
    const project = optionalString(query.project, 'project')
    assertDateRange(from, to)
    const filter: ArtifactListFilter = {
      offset: (page - 1) * size,
      limit: size,
      ...employeeId === undefined ? {} : { employeeId },
      ...project === undefined ? {} : { project },
      ...kind === undefined ? {} : { kind: kind as ArtifactKind },
      ...from === undefined ? {} : { from },
      ...to === undefined ? {} : { to },
    }
    return this.repository.listArtifacts(filter)
  }

  telemetry(user: AuthenticatedUser, value: unknown): ConsoleTelemetryResponse {
    requireAdmin(user)
    const query = queryObject(value)
    const eventType = optionalString(query.event_type, 'event_type')
    if (eventType !== undefined && !eventTypes.has(eventType as TelemetryEventType)) {
      throw validation('event_type 无效', 'event_type')
    }
    const source = optionalString(query.source, 'source')
    if (source !== undefined && !sources.has(source as TelemetrySource)) throw validation('source 无效', 'source')
    const groupBy = optionalString(query.group_by, 'group_by') ?? 'day'
    if (!groupings.has(groupBy as TelemetryGroupBy)) throw validation('group_by 无效', 'group_by')
    const from = optionalDate(query.from, 'from')
    const to = optionalDate(query.to, 'to')
    assertDateRange(from, to)
    const filter: TelemetrySeriesFilter = {
      groupBy: groupBy as TelemetryGroupBy,
      ...eventType === undefined ? {} : { eventType: eventType as TelemetryEventType },
      ...source === undefined ? {} : { source: source as TelemetrySource },
      ...from === undefined ? {} : { from },
      ...to === undefined ? {} : { to },
    }
    return { series: this.repository.telemetrySeries(filter) }
  }

  async download(user: AuthenticatedUser, artifactId: string): Promise<ArtifactDownload> {
    requireAdmin(user)
    return this.readArtifact(artifactId)
  }

  async downloadOwned(user: AuthenticatedUser, artifactId: string): Promise<ArtifactDownload> {
    if (artifactId.length === 0) throw validation('artifact id 不能为空', 'id')
    const artifact = this.artifacts.findById(artifactId)
    if (!artifact) throw validation('产出物不存在', 'id')
    if (artifact.employeeId !== user.employeeId && user.role !== 'admin') {
      throw new ApiError('UNAUTHORIZED', '无权下载该产出物')
    }
    return this.readArtifact(artifactId)
  }

  private async readArtifact(artifactId: string): Promise<ArtifactDownload> {
    if (artifactId.length === 0) throw validation('artifact id 不能为空', 'id')
    const artifact = this.artifacts.findById(artifactId)
    if (!artifact) throw validation('产出物不存在', 'id')
    const configuredRoot = resolve(this.dataDirectory)
    const configuredPath = resolve(configuredRoot, artifact.path)
    const configuredSuffix = relative(configuredRoot, configuredPath)
    if (configuredSuffix.startsWith('..') || isAbsolute(configuredSuffix)) {
      throw new ApiError('INTERNAL', '产出物存储路径异常')
    }
    try {
      const root = await realpath(configuredRoot)
      const path = await realpath(configuredPath)
      const canonicalSuffix = relative(root, path)
      if (canonicalSuffix.startsWith('..') || isAbsolute(canonicalSuffix)) {
        throw new ApiError('INTERNAL', '产出物存储路径异常')
      }
      return { content: await readFile(path), filename: artifact.filename }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw validation('产出物文件不存在', 'id')
      throw error
    }
  }

  private usersFromFacts(now: Date): ConsoleUser[] {
    const staleCutoff = now.getTime() - this.staleAfterDays * DAY_MS
    return this.repository.listUserFacts().map(facts => ({
      employee_id: facts.employeeId,
      name: facts.name,
      dept: facts.dept,
      last_report_at: facts.lastReportAt,
      artifacts_count: facts.artifactsCount,
      status: facts.lastReportAt === null ? 'never' : Date.parse(facts.lastReportAt) < staleCutoff ? 'stale' : 'ok',
    }))
  }
}

function requireAdmin(user: AuthenticatedUser): void {
  if (user.role !== 'admin') throw new ApiError('UNAUTHORIZED', '无权访问控制台')
}

function queryObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validation('查询参数无效')
  return value as Record<string, unknown>
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) throw validation(`${field} 不能为空`, field)
  return value
}

function positiveQueryInteger(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) throw validation(`${field} 必须是正整数`, field)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw validation(`${field} 必须是正整数`, field)
  return parsed
}

function optionalDate(value: unknown, field: string): string | undefined {
  const date = optionalString(value, field)
  if (date === undefined) return undefined
  if (!isoWithTimezone.test(date) || Number.isNaN(Date.parse(date))) {
    throw validation(`${field} 必须是带时区的 ISO 8601 时间`, field)
  }
  return date
}

function assertDateRange(from: string | undefined, to: string | undefined): void {
  if (from !== undefined && to !== undefined && Date.parse(from) > Date.parse(to)) {
    throw validation('from 不能晚于 to')
  }
}

function validation(message: string, field?: string): ApiError {
  return new ApiError('VALIDATION', message, field ? { field } : {})
}
