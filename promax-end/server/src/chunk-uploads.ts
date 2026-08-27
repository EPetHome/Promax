import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ArtifactCompleteResponse, ArtifactInitResponse, ArtifactUploadResponse } from '@promax/contracts'

import type { ArtifactRepository } from './artifact-repository.ts'
import { ArtifactService, MAX_DIRECT_ARTIFACT_BYTES, parseArtifactMetadata } from './artifacts.ts'
import type { ChunkUploadRecord, ChunkUploadRepository, UploadChunkRecord } from './chunk-upload-repository.ts'
import { ApiError } from './errors.ts'

export const ARTIFACT_CHUNK_SIZE = 1024 * 1024
export const DEFAULT_MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024
const uploadIdPattern = /^upl_[a-f0-9]{32}$/u

export class ChunkUploadService {
  constructor(
    private readonly repository: ChunkUploadRepository,
    private readonly artifactRepository: ArtifactRepository,
    private readonly artifacts: ArtifactService,
    private readonly uploadsDirectory: string,
    private readonly maxArtifactBytes: number = DEFAULT_MAX_ARTIFACT_BYTES,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = () => `upl_${randomUUID().replaceAll('-', '')}`,
  ) {}

  init(authenticatedEmployeeId: string, value: unknown): ArtifactInitResponse {
    const metadata = parseArtifactMetadata(value)
    if (metadata.request.employee_id !== authenticatedEmployeeId) {
      throw new ApiError('UNAUTHORIZED', '不能为其他工号初始化上传')
    }
    if (metadata.request.size <= MAX_DIRECT_ARTIFACT_BYTES) {
      throw validation('不超过 5MB 的产出物请使用普通上传接口', 'size')
    }
    if (metadata.request.size > this.maxArtifactBytes) {
      throw validation(`产出物不能超过 ${this.maxArtifactBytes} 字节`, 'size')
    }

    const uploadId = this.createId()
    if (!uploadIdPattern.test(uploadId)) throw new Error('generated upload id is invalid')
    const record: ChunkUploadRecord = {
      uploadId,
      employeeId: metadata.request.employee_id,
      project: metadata.request.project,
      agent: metadata.request.agent,
      kind: metadata.request.kind,
      filename: metadata.request.filename,
      createdAt: metadata.request.created_at,
      sha256: metadata.request.sha256,
      size: metadata.request.size,
      chunkSize: ARTIFACT_CHUNK_SIZE,
      status: 'receiving',
      artifactId: null,
      startedAt: this.now().toISOString(),
      completedAt: null,
    }
    this.repository.createUpload(record)
    return { upload_id: uploadId, chunk_size: ARTIFACT_CHUNK_SIZE }
  }

  async putChunk(authenticatedEmployeeId: string, uploadId: string, chunkNumberValue: string, value: unknown): Promise<void> {
    assertUploadId(uploadId)
    const chunkNumber = chunkNumberFromPath(chunkNumberValue)
    if (!Buffer.isBuffer(value)) throw validation('分片必须是 application/octet-stream 二进制内容')
    const upload = this.requireOwnedUpload(authenticatedEmployeeId, uploadId)
    if (upload.status !== 'receiving') throw new ApiError('CONFLICT', '该上传已完成')

    const chunkCount = Math.ceil(upload.size / upload.chunkSize)
    if (chunkNumber >= chunkCount) throw validation('分片编号超出范围', 'n')
    const expectedSize = chunkNumber === chunkCount - 1
      ? upload.size - chunkNumber * upload.chunkSize
      : upload.chunkSize
    if (value.byteLength !== expectedSize) {
      throw validation(`分片大小应为 ${expectedSize} 字节`, 'chunk')
    }
    const sha256 = createHash('sha256').update(value).digest('hex')
    const existing = this.repository.findChunk(uploadId, chunkNumber)
    if (existing) {
      if (existing.size !== value.byteLength || existing.sha256 !== sha256) {
        throw new ApiError('CONFLICT', '同一分片编号已上传不同内容')
      }
      await this.ensureChunkFile(uploadId, chunkNumber, value, sha256)
      return
    }

    const directory = this.uploadDirectory(uploadId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = this.chunkPath(uploadId, chunkNumber)
    try {
      await writeFile(path, value, { flag: 'wx', mode: 0o600 })
      this.repository.insertChunk({
        uploadId,
        chunkNumber,
        size: value.byteLength,
        sha256,
        receivedAt: this.now().toISOString(),
      })
    } catch (error: unknown) {
      const raced = this.repository.findChunk(uploadId, chunkNumber)
      if (raced?.size === value.byteLength && raced.sha256 === sha256) {
        await this.ensureChunkFile(uploadId, chunkNumber, value, sha256)
        return
      }
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const diskContent = await readFile(path)
        const diskSha = createHash('sha256').update(diskContent).digest('hex')
        if (diskContent.byteLength !== value.byteLength || diskSha !== sha256) {
          throw new ApiError('CONFLICT', '同一分片编号已存在不同内容')
        }
        this.repository.insertChunk({ uploadId, chunkNumber, size: value.byteLength, sha256, receivedAt: this.now().toISOString() })
        return
      }
      await rm(path, { force: true })
      throw error
    }
  }

  async complete(authenticatedEmployeeId: string, uploadId: string): Promise<ArtifactCompleteResponse> {
    assertUploadId(uploadId)
    const upload = this.requireOwnedUpload(authenticatedEmployeeId, uploadId)
    if (upload.status === 'completed') {
      if (!upload.artifactId || !this.artifactRepository.findById(upload.artifactId)) {
        throw new ApiError('INTERNAL', '已完成上传的产出物记录缺失')
      }
      await this.cleanup(uploadId)
      return { artifact_id: upload.artifactId, duplicate: true }
    }

    const existingArtifact = this.artifactRepository.findBySha256(upload.sha256)
    if (existingArtifact) {
      this.repository.markCompleted(uploadId, existingArtifact.artifactId, this.now().toISOString())
      await this.cleanup(uploadId)
      return { artifact_id: existingArtifact.artifactId, duplicate: true }
    }

    const chunks = this.repository.listChunks(uploadId)
    this.assertCompleteChunkSet(upload, chunks)
    const directory = this.uploadDirectory(uploadId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const assembledPath = join(directory, `assembled-${randomUUID()}.tmp`)
    const digest = createHash('sha256')
    let assembledBytes = 0
    try {
      const output = await open(assembledPath, 'wx', 0o600)
      try {
        for (const chunk of chunks) {
          let content: Buffer
          try {
            content = await readFile(this.chunkPath(uploadId, chunk.chunkNumber))
          } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              throw new ApiError('CONFLICT', `缺少分片 ${chunk.chunkNumber}`)
            }
            throw error
          }
          const actualChunkSha = createHash('sha256').update(content).digest('hex')
          if (content.byteLength !== chunk.size || actualChunkSha !== chunk.sha256) {
            throw new ApiError('CONFLICT', `分片 ${chunk.chunkNumber} 校验失败`)
          }
          await output.write(content)
          digest.update(content)
          assembledBytes += content.byteLength
        }
        await output.sync()
      } finally {
        await output.close()
      }
    } catch (error) {
      await rm(assembledPath, { force: true })
      throw error
    }

    if (assembledBytes !== upload.size || digest.digest('hex') !== upload.sha256) {
      await rm(assembledPath, { force: true })
      throw validation('完整文件的 size 或 sha256 校验失败')
    }

    const metadata = parseArtifactMetadata({
      employee_id: upload.employeeId,
      project: upload.project,
      agent: upload.agent,
      kind: upload.kind,
      filename: upload.filename,
      created_at: upload.createdAt,
      sha256: upload.sha256,
      size: upload.size,
    })
    let response: ArtifactUploadResponse
    try {
      response = this.artifacts.importVerifiedFile(authenticatedEmployeeId, metadata, assembledPath)
    } catch (error) {
      await rm(assembledPath, { force: true })
      throw error
    }
    this.repository.markCompleted(uploadId, response.artifact_id, this.now().toISOString())
    await this.cleanup(uploadId)
    return response
  }

  private requireOwnedUpload(authenticatedEmployeeId: string, uploadId: string): ChunkUploadRecord {
    const upload = this.repository.findUpload(uploadId)
    if (!upload) throw validation('上传任务不存在', 'upload_id')
    if (upload.employeeId !== authenticatedEmployeeId) {
      throw new ApiError('UNAUTHORIZED', '不能操作其他工号的上传任务')
    }
    return upload
  }

  private assertCompleteChunkSet(upload: ChunkUploadRecord, chunks: UploadChunkRecord[]): void {
    const expectedCount = Math.ceil(upload.size / upload.chunkSize)
    if (chunks.length !== expectedCount) throw new ApiError('CONFLICT', '分片尚未全部上传')
    for (let index = 0; index < expectedCount; index += 1) {
      const chunk = chunks[index]
      const expectedSize = index === expectedCount - 1 ? upload.size - index * upload.chunkSize : upload.chunkSize
      if (!chunk || chunk.chunkNumber !== index || chunk.size !== expectedSize) {
        throw new ApiError('CONFLICT', `分片 ${index} 缺失或大小不正确`)
      }
    }
  }

  private async ensureChunkFile(uploadId: string, chunkNumber: number, content: Buffer, sha256: string): Promise<void> {
    const path = this.chunkPath(uploadId, chunkNumber)
    try {
      const existing = await readFile(path)
      if (existing.byteLength === content.byteLength && createHash('sha256').update(existing).digest('hex') === sha256) return
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(this.uploadDirectory(uploadId), { recursive: true, mode: 0o700 })
    await writeFile(path, content, { mode: 0o600 })
  }

  private async cleanup(uploadId: string): Promise<void> {
    this.repository.deleteChunks(uploadId)
    await rm(this.uploadDirectory(uploadId), { recursive: true, force: true })
  }

  private uploadDirectory(uploadId: string): string {
    return join(this.uploadsDirectory, uploadId)
  }

  private chunkPath(uploadId: string, chunkNumber: number): string {
    return join(this.uploadDirectory(uploadId), `chunk-${chunkNumber.toString().padStart(8, '0')}.bin`)
  }
}

function assertUploadId(uploadId: string): void {
  if (!uploadIdPattern.test(uploadId)) throw validation('upload_id 无效', 'upload_id')
}

function chunkNumberFromPath(value: string): number {
  if (!/^\d+$/u.test(value)) throw validation('分片编号必须是非负整数', 'n')
  const chunkNumber = Number(value)
  if (!Number.isSafeInteger(chunkNumber)) throw validation('分片编号必须是非负整数', 'n')
  return chunkNumber
}

function validation(message: string, field?: string): ApiError {
  return new ApiError('VALIDATION', message, field ? { field } : {})
}
