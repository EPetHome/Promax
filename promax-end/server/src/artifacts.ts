import { createHash, randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, join, posix } from 'node:path'

import type {
  ArtifactCreatedResponse,
  ArtifactDuplicateResponse,
  ArtifactKind,
  ArtifactUploadMetadata,
  ArtifactUploadResponse,
} from '@promax/contracts'

import type { ArtifactRecord, ArtifactRepository } from './artifact-repository.ts'
import { ApiError } from './errors.ts'

export const MAX_DIRECT_ARTIFACT_BYTES = 5 * 1024 * 1024
const artifactKinds = new Set<ArtifactKind>(['prd', 'diagram', 'prototype', 'other'])
const isoWithTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const sha256Pattern = /^[a-f0-9]{64}$/

interface ParsedArtifact {
  metadata: ParsedArtifactMetadata
  content: Buffer
}

export interface ParsedArtifactMetadata {
  request: ArtifactUploadMetadata
  date: string
}

export class ArtifactService {
  constructor(
    private readonly artifacts: ArtifactRepository,
    private readonly rawDirectory: string,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => `art_${randomUUID().replaceAll('-', '')}`,
    private readonly onStored: (record: ArtifactRecord) => void = () => undefined,
  ) {}

  upload(authenticatedEmployeeId: string, value: unknown): ArtifactUploadResponse {
    const parsed = parseArtifact(value)
    if (parsed.metadata.request.employee_id !== authenticatedEmployeeId) {
      throw new ApiError('UNAUTHORIZED', '不能为其他工号上传产出物')
    }
    return this.persist(parsed.metadata, (directory, date, filename) => writeWithoutOverwrite(directory, date, filename, parsed.content))
  }

  /** Commit a chunk service's already verified assembled file without loading it into memory. */
  importVerifiedFile(
    authenticatedEmployeeId: string,
    metadata: ParsedArtifactMetadata,
    sourcePath: string,
  ): ArtifactUploadResponse {
    if (metadata.request.employee_id !== authenticatedEmployeeId) {
      throw new ApiError('UNAUTHORIZED', '不能为其他工号上传产出物')
    }
    return this.persist(metadata, (directory, date, filename) => linkWithoutOverwrite(directory, date, filename, sourcePath))
  }

  private persist(
    metadata: ParsedArtifactMetadata,
    materialize: (directory: string, date: string, filename: string) => { absolutePath: string; filename: string },
  ): ArtifactUploadResponse {
    const duplicate = this.artifacts.findBySha256(metadata.request.sha256)
    if (duplicate) return duplicateResponse(duplicate)

    const directory = join(this.rawDirectory, metadata.request.employee_id, metadata.request.project)
    mkdirSync(directory, { recursive: true })
    const stored = materialize(directory, metadata.date, metadata.request.filename)
    const relativePath = posix.join(
      'raw',
      metadata.request.employee_id,
      metadata.request.project,
      stored.filename,
    )

    const record: ArtifactRecord = {
      artifactId: this.createId(),
      employeeId: metadata.request.employee_id,
      project: metadata.request.project,
      agent: metadata.request.agent,
      kind: metadata.request.kind,
      filename: stored.filename.slice(metadata.date.length + 1),
      path: relativePath,
      sha256: metadata.request.sha256,
      size: metadata.request.size,
      createdAt: metadata.request.created_at,
      receivedAt: this.now().toISOString(),
    }

    try {
      this.artifacts.create(record)
    } catch (error) {
      unlinkSync(stored.absolutePath)
      const racedDuplicate = this.artifacts.findBySha256(metadata.request.sha256)
      if (racedDuplicate) return duplicateResponse(racedDuplicate)
      throw error
    }

    this.onStored(record)

    const response: ArtifactCreatedResponse = { artifact_id: record.artifactId, path: record.path }
    return response
  }
}

function parseArtifact(value: unknown): ParsedArtifact {
  const metadata = parseArtifactMetadata(value)
  const body = value as Record<string, unknown>
  if (typeof body.content !== 'string') throw validation('content 必须是 base64 字符串', 'content')
  const contentBase64 = body.content

  const content = decodeBase64(contentBase64)
  if (content.length > MAX_DIRECT_ARTIFACT_BYTES) {
    throw validation('超过 5MB 的产出物必须使用分片上传', 'size')
  }
  if (content.length !== metadata.request.size) throw validation('size 与解码后的文件大小不一致', 'size')
  const actualSha256 = createHash('sha256').update(content).digest('hex')
  if (actualSha256 !== metadata.request.sha256) throw validation('sha256 与文件内容不一致', 'sha256')

  return { metadata, content }
}

export function parseArtifactMetadata(value: unknown): ParsedArtifactMetadata {
  if (!value || typeof value !== 'object') throw validation('请求体必须是 JSON 对象')
  const body = value as Record<string, unknown>
  const employeeId = requiredString(body, 'employee_id')
  const project = requiredString(body, 'project')
  const agent = requiredString(body, 'agent')
  const kind = requiredString(body, 'kind')
  const filename = requiredString(body, 'filename')
  const createdAt = requiredString(body, 'created_at')
  const sha256 = requiredString(body, 'sha256')
  safePathSegment(employeeId, 'employee_id')
  safePathSegment(project, 'project')
  safePathSegment(filename, 'filename')
  if (!artifactKinds.has(kind as ArtifactKind)) throw validation('产出物类型无效', 'kind')
  if (!isoWithTimezone.test(createdAt) || Number.isNaN(Date.parse(createdAt))) {
    throw validation('created_at 必须是带时区的 ISO 8601 时间', 'created_at')
  }
  if (!sha256Pattern.test(sha256)) throw validation('sha256 必须是 64 位小写十六进制', 'sha256')
  if (!Number.isSafeInteger(body.size) || (body.size as number) < 0) {
    throw validation('size 必须是非负整数', 'size')
  }

  return {
    request: {
      employee_id: employeeId,
      project,
      agent,
      kind: kind as ArtifactKind,
      filename,
      created_at: createdAt,
      sha256,
      size: body.size as number,
    },
    date: createdAt.slice(0, 10),
  }
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field]
  if (typeof value !== 'string' || value.length === 0) throw validation(`${field} 不能为空`, field)
  return value
}

function safePathSegment(value: string, field: string): void {
  if (value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw validation(`${field} 包含不安全的路径字符`, field)
  }
}

function decodeBase64(value: string): Buffer {
  if (!isBase64(value)) throw validation('content 必须是有效的 base64', 'content')
  return Buffer.from(value, 'base64')
}

function isBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false
  let contentLength = value.length
  if (value.endsWith('==')) contentLength -= 2
  else if (value.endsWith('=')) contentLength -= 1

  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index)
    const valid = (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57)
      || code === 43
      || code === 47
    if (!valid) return false
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false
  }
  return true
}

function writeWithoutOverwrite(directory: string, date: string, originalFilename: string, content: Buffer): {
  absolutePath: string
  filename: string
} {
  const extension = extname(originalFilename)
  const stem = extension.length === originalFilename.length ? originalFilename : originalFilename.slice(0, -extension.length)
  for (let suffix = 1; ; suffix += 1) {
    const resolvedName = suffix === 1 ? originalFilename : `${stem}-${suffix}${extension}`
    const filename = `${date}-${resolvedName}`
    const absolutePath = join(directory, filename)
    try {
      writeFileSync(absolutePath, content, { flag: 'wx', mode: 0o600 })
      return { absolutePath, filename }
    } catch (error) {
      if (isAlreadyExists(error)) continue
      throw error
    }
  }
}

function linkWithoutOverwrite(directory: string, date: string, originalFilename: string, sourcePath: string): {
  absolutePath: string
  filename: string
} {
  const extension = extname(originalFilename)
  const stem = extension.length === originalFilename.length ? originalFilename : originalFilename.slice(0, -extension.length)
  for (let suffix = 1; ; suffix += 1) {
    const resolvedName = suffix === 1 ? originalFilename : `${stem}-${suffix}${extension}`
    const filename = `${date}-${resolvedName}`
    const absolutePath = join(directory, filename)
    try {
      linkSync(sourcePath, absolutePath)
      return { absolutePath, filename }
    } catch (error) {
      if (isAlreadyExists(error)) continue
      throw error
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function duplicateResponse(record: ArtifactRecord): ArtifactDuplicateResponse {
  return { artifact_id: record.artifactId, duplicate: true }
}

function validation(message: string, field?: string): ApiError {
  return new ApiError('VALIDATION', message, field ? { field } : {})
}
