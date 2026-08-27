import type { PromateArtifactType, PromateOperationStatus } from '@promax/contracts'
import type { DatabaseSync } from 'node:sqlite'

export interface PromateOperationRecord {
  requestId: string
  employeeId: string
  orgId: string
  agent: string
  artifactId: string
  projectId: string
  requirementId: string
  artifactType: PromateArtifactType
  summary: string
  confirmToken: string
  status: PromateOperationStatus
  attempts: number
  commitAttempts: number
  promateArtifactId?: string
  requirementUrl?: string
  lastErrorCode?: string
  createdAt: string
  updatedAt: string
}

export interface PromateCallRecord {
  requestId: string
  employeeId: string
  orgId: string
  agent: string
  projectId?: string
  capability: string
  stage: string
  status: 'success' | 'failed' | 'pending'
  errorCode?: string
  occurredAt: string
}

export interface PromateOperationRepository {
  create(record: PromateOperationRecord): void
  findByRequestId(requestId: string): PromateOperationRecord | undefined
  incrementAttempts(requestId: string, updatedAt: string): PromateOperationRecord
  markPending(requestId: string, errorCode: string, updatedAt: string): PromateOperationRecord
  markSynced(
    requestId: string,
    promateArtifactId: string,
    requirementUrl: string | undefined,
    updatedAt: string,
  ): PromateOperationRecord
  markDead(requestId: string, errorCode: string, updatedAt: string): PromateOperationRecord
  listPending(limit: number): PromateOperationRecord[]
  recordCall(record: PromateCallRecord): void
}

interface PromateOperationRow {
  request_id: string
  employee_id: string
  org_id: string
  agent: string
  artifact_id: string
  project_id: string
  requirement_id: string
  artifact_type: PromateArtifactType
  summary: string
  confirm_token: string
  status: PromateOperationStatus
  attempts: number
  commit_attempts: number
  promate_artifact_id: string | null
  requirement_url: string | null
  last_error_code: string | null
  created_at: string
  updated_at: string
}

export class SqlitePromateOperationRepository implements PromateOperationRepository {
  constructor(private readonly database: DatabaseSync) {}

  create(record: PromateOperationRecord): void {
    this.database.prepare(`
      INSERT INTO promate_operations (
        request_id, employee_id, org_id, agent, artifact_id, project_id, requirement_id,
        artifact_type, summary, confirm_token, status, attempts, promate_artifact_id,
        commit_attempts, requirement_url, last_error_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.requestId,
      record.employeeId,
      record.orgId,
      record.agent,
      record.artifactId,
      record.projectId,
      record.requirementId,
      record.artifactType,
      record.summary,
      record.confirmToken,
      record.status,
      record.attempts,
      record.promateArtifactId ?? null,
      record.commitAttempts,
      record.requirementUrl ?? null,
      record.lastErrorCode ?? null,
      record.createdAt,
      record.updatedAt,
    )
  }

  findByRequestId(requestId: string): PromateOperationRecord | undefined {
    return mapOperation(this.database.prepare(`
      SELECT request_id, employee_id, org_id, agent, artifact_id, project_id, requirement_id,
             artifact_type, summary, confirm_token, status, attempts, promate_artifact_id,
             commit_attempts, requirement_url, last_error_code, created_at, updated_at
      FROM promate_operations
      WHERE request_id = ?
    `).get(requestId) as PromateOperationRow | undefined)
  }

  incrementAttempts(requestId: string, updatedAt: string): PromateOperationRecord {
    this.database.prepare(`
      UPDATE promate_operations
      SET attempts = attempts + 1, commit_attempts = commit_attempts + 1, updated_at = ?
      WHERE request_id = ?
    `).run(updatedAt, requestId)
    return this.required(requestId)
  }

  markPending(requestId: string, errorCode: string, updatedAt: string): PromateOperationRecord {
    this.database.prepare(`
      UPDATE promate_operations
      SET status = 'pending', last_error_code = ?, updated_at = ?
      WHERE request_id = ?
    `).run(errorCode, updatedAt, requestId)
    return this.required(requestId)
  }

  markSynced(
    requestId: string,
    promateArtifactId: string,
    requirementUrl: string | undefined,
    updatedAt: string,
  ): PromateOperationRecord {
    this.database.prepare(`
      UPDATE promate_operations
      SET status = 'synced', promate_artifact_id = ?, requirement_url = ?,
          last_error_code = NULL, updated_at = ?
      WHERE request_id = ?
    `).run(promateArtifactId, requirementUrl ?? null, updatedAt, requestId)
    return this.required(requestId)
  }

  markDead(requestId: string, errorCode: string, updatedAt: string): PromateOperationRecord {
    this.database.prepare(`
      UPDATE promate_operations
      SET status = 'dead', last_error_code = ?, updated_at = ?
      WHERE request_id = ?
    `).run(errorCode, updatedAt, requestId)
    return this.required(requestId)
  }

  listPending(limit: number): PromateOperationRecord[] {
    const rows = this.database.prepare(`
      SELECT request_id, employee_id, org_id, agent, artifact_id, project_id, requirement_id,
             artifact_type, summary, confirm_token, status, attempts, promate_artifact_id,
             commit_attempts, requirement_url, last_error_code, created_at, updated_at
      FROM promate_operations
      WHERE status = 'pending'
      ORDER BY updated_at, request_id
      LIMIT ?
    `).all(limit) as unknown as PromateOperationRow[]
    return rows.map((row) => mapOperation(row) as PromateOperationRecord)
  }

  recordCall(record: PromateCallRecord): void {
    this.database.prepare(`
      INSERT INTO promate_calls (
        request_id, employee_id, org_id, agent, project_id, capability,
        stage, status, error_code, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.requestId,
      record.employeeId,
      record.orgId,
      record.agent,
      record.projectId ?? null,
      record.capability,
      record.stage,
      record.status,
      record.errorCode ?? null,
      record.occurredAt,
    )
  }

  private required(requestId: string): PromateOperationRecord {
    const record = this.findByRequestId(requestId)
    if (!record) throw new Error(`Missing Promate operation ${requestId}`)
    return record
  }
}

function mapOperation(row: PromateOperationRow | undefined): PromateOperationRecord | undefined {
  if (!row) return undefined
  return {
    requestId: row.request_id,
    employeeId: row.employee_id,
    orgId: row.org_id,
    agent: row.agent,
    artifactId: row.artifact_id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    artifactType: row.artifact_type,
    summary: row.summary,
    confirmToken: row.confirm_token,
    status: row.status,
    attempts: row.attempts,
    commitAttempts: row.commit_attempts,
    ...(row.promate_artifact_id === null ? {} : { promateArtifactId: row.promate_artifact_id }),
    ...(row.requirement_url === null ? {} : { requirementUrl: row.requirement_url }),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
