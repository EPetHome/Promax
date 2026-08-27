import type { ArtifactKind } from '@promax/contracts'
import type { DatabaseSync } from 'node:sqlite'

export interface ArtifactRecord {
  artifactId: string
  employeeId: string
  project: string
  agent: string
  kind: ArtifactKind
  filename: string
  path: string
  sha256: string
  size: number
  createdAt: string
  receivedAt: string
}

export interface ArtifactRepository {
  create(record: ArtifactRecord): void
  findBySha256(sha256: string): ArtifactRecord | undefined
  findById(artifactId: string): ArtifactRecord | undefined
}

interface ArtifactRow {
  artifact_id: string
  employee_id: string
  project: string
  agent: string
  kind: ArtifactKind
  filename: string
  path: string
  sha256: string
  size: number
  created_at: string
  received_at: string
}

export class SqliteArtifactRepository implements ArtifactRepository {
  constructor(private readonly database: DatabaseSync) {}

  create(record: ArtifactRecord): void {
    this.database.prepare(`
      INSERT INTO artifacts (
        artifact_id, employee_id, project, agent, kind, filename, path,
        sha256, size, created_at, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.artifactId,
      record.employeeId,
      record.project,
      record.agent,
      record.kind,
      record.filename,
      record.path,
      record.sha256,
      record.size,
      record.createdAt,
      record.receivedAt,
    )
  }

  findBySha256(sha256: string): ArtifactRecord | undefined {
    return mapRow(this.database.prepare(`
      SELECT artifact_id, employee_id, project, agent, kind, filename, path,
             sha256, size, created_at, received_at
      FROM artifacts
      WHERE sha256 = ?
    `).get(sha256) as ArtifactRow | undefined)
  }

  findById(artifactId: string): ArtifactRecord | undefined {
    return mapRow(this.database.prepare(`
      SELECT artifact_id, employee_id, project, agent, kind, filename, path,
             sha256, size, created_at, received_at
      FROM artifacts
      WHERE artifact_id = ?
    `).get(artifactId) as ArtifactRow | undefined)
  }
}

function mapRow(row: ArtifactRow | undefined): ArtifactRecord | undefined {
  if (!row) return undefined
  return {
    artifactId: row.artifact_id,
    employeeId: row.employee_id,
    project: row.project,
    agent: row.agent,
    kind: row.kind,
    filename: row.filename,
    path: row.path,
    sha256: row.sha256,
    size: row.size,
    createdAt: row.created_at,
    receivedAt: row.received_at,
  }
}
