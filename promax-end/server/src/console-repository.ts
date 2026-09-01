import type {
  ArtifactKind,
  ConsoleArtifact,
  ConsoleTelemetrySeriesPoint,
  TaskStateSnapshot,
  TelemetryEventType,
  TelemetryGroupBy,
  TelemetrySource,
} from '@promax/contracts'
import type { DatabaseSync } from 'node:sqlite'

export interface ConsoleUserFacts {
  employeeId: string
  name: string
  dept: string
  lastReportAt: string | null
  artifactsCount: number
}

export interface ArtifactListFilter {
  employeeId?: string
  project?: string
  kind?: ArtifactKind
  from?: string
  to?: string
  offset: number
  limit: number
}

export interface TelemetrySeriesFilter {
  eventType?: TelemetryEventType
  source?: TelemetrySource
  from?: string
  to?: string
  groupBy: TelemetryGroupBy
}

export interface ConsoleRepository {
  listUserFacts(): ConsoleUserFacts[]
  countArtifacts(): number
  countArtifactsSince(from: string): number
  listArtifacts(filter: ArtifactListFilter): { total: number; items: ConsoleArtifact[] }
  telemetrySeries(filter: TelemetrySeriesFilter): ConsoleTelemetrySeriesPoint[]
  findTaskState(sessionId: string, taskKey: string): TaskStateSnapshot | null
}

interface UserFactsRow {
  employee_id: string
  name: string
  dept: string
  last_report_at: string | null
  artifacts_count: number
}

interface ArtifactRow {
  artifact_id: string
  employee_id: string
  project: string
  agent: string
  kind: ArtifactKind
  filename: string
  created_at: string
  size: number
  path: string
}

interface CountRow { count: number }

interface TelemetrySeriesRow {
  key: string
  event_type: TelemetryEventType
  source: TelemetrySource
  count: number
}

interface TaskStateRow {
  employee_id: string
  project: string
  session_id: string
  task_key: string
  tier: TaskStateSnapshot['tier']
  coverage_revision: number
  updated_at: string
  slots: string
}

export class SqliteConsoleRepository implements ConsoleRepository {
  constructor(private readonly database: DatabaseSync) {}

  listUserFacts(): ConsoleUserFacts[] {
    const rows = this.database.prepare(`
      WITH all_reports(employee_id, report_at) AS (
        SELECT employee_id, received_at FROM artifacts
        UNION ALL
        SELECT employee_id, received_at FROM telemetry
        UNION ALL
        SELECT employee_id, at FROM heartbeats
      ),
      last_reports AS (
        SELECT employee_id, MAX(report_at) AS last_report_at
        FROM all_reports
        GROUP BY employee_id
      ),
      artifact_counts AS (
        SELECT employee_id, COUNT(*) AS artifacts_count
        FROM artifacts
        GROUP BY employee_id
      )
      SELECT u.employee_id, u.name, u.dept,
             lr.last_report_at,
             COALESCE(ac.artifacts_count, 0) AS artifacts_count
      FROM users u
      LEFT JOIN last_reports lr ON lr.employee_id = u.employee_id
      LEFT JOIN artifact_counts ac ON ac.employee_id = u.employee_id
      ORDER BY lr.last_report_at IS NULL, julianday(lr.last_report_at) DESC, u.employee_id
    `).all() as unknown as UserFactsRow[]
    return rows.map(row => ({
      employeeId: row.employee_id,
      name: row.name,
      dept: row.dept,
      lastReportAt: row.last_report_at,
      artifactsCount: row.artifacts_count,
    }))
  }

  countArtifacts(): number {
    return (this.database.prepare('SELECT COUNT(*) AS count FROM artifacts').get() as unknown as CountRow).count
  }

  countArtifactsSince(from: string): number {
    return (this.database.prepare(`
      SELECT COUNT(*) AS count FROM artifacts WHERE julianday(created_at) >= julianday(?)
    `).get(from) as unknown as CountRow).count
  }

  listArtifacts(filter: ArtifactListFilter): { total: number; items: ConsoleArtifact[] } {
    const clauses: string[] = []
    const parameters: Array<string | number> = []
    if (filter.employeeId !== undefined) {
      clauses.push('employee_id = ?')
      parameters.push(filter.employeeId)
    }
    if (filter.project !== undefined) {
      clauses.push('project = ?')
      parameters.push(filter.project)
    }
    if (filter.kind !== undefined) {
      clauses.push('kind = ?')
      parameters.push(filter.kind)
    }
    if (filter.from !== undefined) {
      clauses.push('julianday(created_at) >= julianday(?)')
      parameters.push(filter.from)
    }
    if (filter.to !== undefined) {
      clauses.push('julianday(created_at) <= julianday(?)')
      parameters.push(filter.to)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const total = (this.database.prepare(`SELECT COUNT(*) AS count FROM artifacts ${where}`).get(...parameters) as unknown as CountRow).count
    const rows = this.database.prepare(`
      SELECT artifact_id, employee_id, project, agent, kind, filename, created_at, size, path
      FROM artifacts
      ${where}
      ORDER BY julianday(created_at) DESC, artifact_id DESC
      LIMIT ? OFFSET ?
    `).all(...parameters, filter.limit, filter.offset) as unknown as ArtifactRow[]
    return {
      total,
      items: rows.map(row => ({
        artifact_id: row.artifact_id,
        employee_id: row.employee_id,
        project: row.project,
        agent: row.agent,
        kind: row.kind,
        filename: row.filename,
        created_at: row.created_at,
        size: row.size,
        path: row.path,
      })),
    }
  }

  telemetrySeries(filter: TelemetrySeriesFilter): ConsoleTelemetrySeriesPoint[] {
    const clauses: string[] = []
    const parameters: string[] = []
    if (filter.eventType !== undefined) {
      clauses.push('event_type = ?')
      parameters.push(filter.eventType)
    }
    if (filter.source !== undefined) {
      clauses.push('source = ?')
      parameters.push(filter.source)
    }
    if (filter.from !== undefined) {
      clauses.push('julianday(occurred_at) >= julianday(?)')
      parameters.push(filter.from)
    }
    if (filter.to !== undefined) {
      clauses.push('julianday(occurred_at) <= julianday(?)')
      parameters.push(filter.to)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const groupExpression = filter.groupBy === 'day'
      ? "substr(occurred_at, 1, 10)"
      : filter.groupBy === 'user' ? 'employee_id' : 'target'
    const rows = this.database.prepare(`
      SELECT ${groupExpression} AS key, event_type, source, COUNT(*) AS count
      FROM telemetry
      ${where}
      GROUP BY ${groupExpression}, event_type, source
      ORDER BY key, event_type, source
    `).all(...parameters) as unknown as TelemetrySeriesRow[]
    return rows.map(row => ({
      key: row.key,
      event_type: row.event_type,
      source: row.source,
      count: row.count,
    }))
  }

  findTaskState(sessionId: string, taskKey: string): TaskStateSnapshot | null {
    const row = this.database.prepare(`
      SELECT employee_id, project, session_id, task_key, tier, coverage_revision, updated_at, slots
      FROM task_states
      WHERE session_id = ? AND task_key = ?
    `).get(sessionId, taskKey) as TaskStateRow | undefined
    if (!row) return null
    return {
      employee_id: row.employee_id,
      project: row.project,
      session_id: row.session_id,
      task_key: row.task_key,
      tier: row.tier,
      coverage_revision: row.coverage_revision,
      updated_at: row.updated_at,
      slots: JSON.parse(row.slots) as TaskStateSnapshot['slots'],
    }
  }
}
