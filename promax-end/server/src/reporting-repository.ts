import type { TaskStateSnapshot, TelemetryDecision, TelemetryEventType, TelemetrySource, TelemetryStatus } from '@promax/contracts'
import type { DatabaseSync } from 'node:sqlite'

export interface TelemetryRecord {
  id: string
  employeeId: string
  eventType: TelemetryEventType
  target: string
  source: TelemetrySource
  sessionId: string
  occurredAt: string
  status: TelemetryStatus
  outputFiles: string[]
  decision?: TelemetryDecision
  receivedAt: string
}

export interface HeartbeatRecord {
  employeeId: string
  clientVersion: string
  dshVersion: string
  configFingerprint: string
  at: string
}

export interface ReportingRepository {
  insertTelemetry(record: TelemetryRecord): boolean
  upsertHeartbeat(record: HeartbeatRecord): void
  saveTaskState(snapshot: TaskStateSnapshot, receivedAt: string): 'saved' | 'unchanged' | 'stale' | 'conflict'
}

export class SqliteReportingRepository implements ReportingRepository {
  constructor(private readonly database: DatabaseSync) {}

  insertTelemetry(record: TelemetryRecord): boolean {
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO telemetry (
        id, employee_id, event_type, target, source, session_id,
        occurred_at, status, output_files, decision, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.employeeId,
      record.eventType,
      record.target,
      record.source,
      record.sessionId,
      record.occurredAt,
      record.status,
      JSON.stringify(record.outputFiles),
      record.decision === undefined ? null : JSON.stringify(record.decision),
      record.receivedAt,
    )
    return result.changes === 1
  }

  upsertHeartbeat(record: HeartbeatRecord): void {
    this.database.prepare(`
      INSERT INTO heartbeats (employee_id, client_version, dsh_version, config_fingerprint, at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(employee_id) DO UPDATE SET
        client_version = excluded.client_version,
        dsh_version = excluded.dsh_version,
        config_fingerprint = excluded.config_fingerprint,
        at = excluded.at
    `).run(record.employeeId, record.clientVersion, record.dshVersion, record.configFingerprint, record.at)
  }

  saveTaskState(snapshot: TaskStateSnapshot, receivedAt: string): 'saved' | 'unchanged' | 'stale' | 'conflict' {
    const slots = JSON.stringify(snapshot.slots)
    const result = this.database.prepare(`
      INSERT INTO task_states (
        employee_id, task_key, project, session_id, tier,
        coverage_revision, updated_at, slots, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, task_key) DO UPDATE SET
        project = excluded.project,
        session_id = excluded.session_id,
        tier = excluded.tier,
        coverage_revision = excluded.coverage_revision,
        updated_at = excluded.updated_at,
        slots = excluded.slots,
        received_at = excluded.received_at
      WHERE excluded.coverage_revision > task_states.coverage_revision
         OR (
           excluded.coverage_revision = task_states.coverage_revision
           AND julianday(excluded.updated_at) > julianday(task_states.updated_at)
         )
    `).run(
      snapshot.employee_id,
      snapshot.task_key,
      snapshot.project,
      snapshot.session_id,
      snapshot.tier,
      snapshot.coverage_revision,
      snapshot.updated_at,
      slots,
      receivedAt,
    )
    if (result.changes === 1) return 'saved'
    const current = this.database.prepare(`
      SELECT project, session_id, tier, coverage_revision, updated_at, slots
      FROM task_states WHERE employee_id = ? AND task_key = ?
    `).get(snapshot.employee_id, snapshot.task_key) as {
      project: string
      session_id: string
      tier: TaskStateSnapshot['tier']
      coverage_revision: number
      updated_at: string
      slots: string
    }
    if (snapshot.coverage_revision < current.coverage_revision) return 'stale'
    if (snapshot.coverage_revision > current.coverage_revision) return 'conflict'
    return current.project === snapshot.project
      && current.session_id === snapshot.session_id
      && current.tier === snapshot.tier
      && current.updated_at === snapshot.updated_at
      && current.slots === slots
      ? 'unchanged'
      : 'conflict'
  }
}
