import type { ArtifactKind } from '@promax/contracts'
import type { DatabaseSync } from 'node:sqlite'

export interface ChunkUploadRecord {
  uploadId: string
  employeeId: string
  project: string
  agent: string
  kind: ArtifactKind
  filename: string
  createdAt: string
  sha256: string
  size: number
  chunkSize: number
  status: 'receiving' | 'completed'
  artifactId: string | null
  startedAt: string
  completedAt: string | null
}

export interface UploadChunkRecord {
  uploadId: string
  chunkNumber: number
  size: number
  sha256: string
  receivedAt: string
}

export interface ChunkUploadRepository {
  createUpload(record: ChunkUploadRecord): void
  findUpload(uploadId: string): ChunkUploadRecord | undefined
  findChunk(uploadId: string, chunkNumber: number): UploadChunkRecord | undefined
  insertChunk(record: UploadChunkRecord): void
  listChunks(uploadId: string): UploadChunkRecord[]
  markCompleted(uploadId: string, artifactId: string, completedAt: string): void
  deleteChunks(uploadId: string): void
}

interface UploadRow {
  upload_id: string
  employee_id: string
  project: string
  agent: string
  kind: ArtifactKind
  filename: string
  created_at: string
  sha256: string
  size: number
  chunk_size: number
  status: 'receiving' | 'completed'
  artifact_id: string | null
  started_at: string
  completed_at: string | null
}

interface ChunkRow {
  upload_id: string
  chunk_number: number
  size: number
  sha256: string
  received_at: string
}

export class SqliteChunkUploadRepository implements ChunkUploadRepository {
  constructor(private readonly database: DatabaseSync) {}

  createUpload(record: ChunkUploadRecord): void {
    this.database.prepare(`
      INSERT INTO artifact_uploads (
        upload_id, employee_id, project, agent, kind, filename, created_at,
        sha256, size, chunk_size, status, artifact_id, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.uploadId, record.employeeId, record.project, record.agent, record.kind, record.filename,
      record.createdAt, record.sha256, record.size, record.chunkSize, record.status, record.artifactId,
      record.startedAt, record.completedAt,
    )
  }

  findUpload(uploadId: string): ChunkUploadRecord | undefined {
    return mapUpload(this.database.prepare(`
      SELECT upload_id, employee_id, project, agent, kind, filename, created_at,
             sha256, size, chunk_size, status, artifact_id, started_at, completed_at
      FROM artifact_uploads WHERE upload_id = ?
    `).get(uploadId) as unknown as UploadRow | undefined)
  }

  findChunk(uploadId: string, chunkNumber: number): UploadChunkRecord | undefined {
    return mapChunk(this.database.prepare(`
      SELECT upload_id, chunk_number, size, sha256, received_at
      FROM artifact_upload_chunks WHERE upload_id = ? AND chunk_number = ?
    `).get(uploadId, chunkNumber) as unknown as ChunkRow | undefined)
  }

  insertChunk(record: UploadChunkRecord): void {
    this.database.prepare(`
      INSERT INTO artifact_upload_chunks (upload_id, chunk_number, size, sha256, received_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.uploadId, record.chunkNumber, record.size, record.sha256, record.receivedAt)
  }

  listChunks(uploadId: string): UploadChunkRecord[] {
    return (this.database.prepare(`
      SELECT upload_id, chunk_number, size, sha256, received_at
      FROM artifact_upload_chunks WHERE upload_id = ? ORDER BY chunk_number
    `).all(uploadId) as unknown as ChunkRow[]).map(row => mapChunk(row)!)
  }

  markCompleted(uploadId: string, artifactId: string, completedAt: string): void {
    this.database.prepare(`
      UPDATE artifact_uploads
      SET status = 'completed', artifact_id = ?, completed_at = ?
      WHERE upload_id = ?
    `).run(artifactId, completedAt, uploadId)
  }

  deleteChunks(uploadId: string): void {
    this.database.prepare('DELETE FROM artifact_upload_chunks WHERE upload_id = ?').run(uploadId)
  }
}

function mapUpload(row: UploadRow | undefined): ChunkUploadRecord | undefined {
  if (!row) return undefined
  return {
    uploadId: row.upload_id,
    employeeId: row.employee_id,
    project: row.project,
    agent: row.agent,
    kind: row.kind,
    filename: row.filename,
    createdAt: row.created_at,
    sha256: row.sha256,
    size: row.size,
    chunkSize: row.chunk_size,
    status: row.status,
    artifactId: row.artifact_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

function mapChunk(row: ChunkRow | undefined): UploadChunkRecord | undefined {
  if (!row) return undefined
  return {
    uploadId: row.upload_id,
    chunkNumber: row.chunk_number,
    size: row.size,
    sha256: row.sha256,
    receivedAt: row.received_at,
  }
}
