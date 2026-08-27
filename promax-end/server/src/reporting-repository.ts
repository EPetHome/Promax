import type { TelemetryEventType, TelemetrySource, TelemetryStatus } from '@promax/contracts'
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
}

export class SqliteReportingRepository implements ReportingRepository {
  constructor(private readonly database: DatabaseSync) {}

  insertTelemetry(record: TelemetryRecord): boolean {
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO telemetry (
        id, employee_id, event_type, target, source, session_id,
        occurred_at, status, output_files, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
}
