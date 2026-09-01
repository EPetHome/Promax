import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { ArtifactUploadMetadata } from '@promax/contracts'

import type { ChunkUploadState, ReportRequest, ReportTransport } from './transport.ts'

interface QueueFileState {
  blob: string
  upload_state?: ChunkUploadState
}

interface QueueEnvelope {
  version: 1
  id: string
  created_at: string
  path: ReportRequest['path']
  body: unknown
  file?: QueueFileState
}

export type ArtifactFileMetadata = Omit<ArtifactUploadMetadata, 'sha256' | 'size'>

export interface ReportLogger {
  debug(message: string): void
  warn(message: string): void
}

let sequence = 0

function nextIdentity(now: Date): string {
  sequence = (sequence + 1) % 1_000_000
  return `${now.getTime().toString().padStart(13, '0')}-${sequence.toString().padStart(6, '0')}-${randomUUID()}`
}

export class DurableReportQueue {
  readonly outboxDirectory: string
  readonly deadDirectory: string
  readonly blobDirectory: string
  private tail: Promise<void> = Promise.resolve()

  constructor(
    dshHome: string,
    private readonly transport: ReportTransport,
    private readonly logger: ReportLogger,
  ) {
    this.outboxDirectory = join(dshHome, 'promax', 'outbox')
    this.deadDirectory = join(this.outboxDirectory, 'dead')
    this.blobDirectory = join(this.outboxDirectory, 'blobs')
  }

  submit(request: ReportRequest): void {
    if (request.filePath !== undefined) throw new Error('use submitArtifactFile for file reports')
    const envelope = this.envelope(request)
    this.schedule(async () => {
      const recovered = await this.flushPending()
      if (!recovered) {
        await this.writePending(envelope)
        return
      }
      await this.deliverNew(envelope)
    })
  }

  submitArtifactFile(metadata: ArtifactFileMetadata, sourcePath: string): void {
    const now = new Date()
    const envelope: QueueEnvelope = {
      version: 1,
      id: nextIdentity(now),
      created_at: now.toISOString(),
      path: '/api/v1/artifacts',
      body: metadata,
      file: { blob: '' },
    }
    const preparation = this.prepareArtifactFile(envelope, sourcePath)
    this.schedule(async () => {
      await preparation
      await this.flushPending()
    })
  }

  flush(): void {
    this.schedule(async () => {
      await this.flushPending()
    })
  }

  async idle(): Promise<void> {
    await this.tail
  }

  private schedule(operation: () => Promise<void>): void {
    const task = this.tail.then(operation, operation)
    this.tail = task.catch((error: unknown) => {
      this.logger.warn(`promax-report queue operation failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private envelope(request: ReportRequest): QueueEnvelope {
    const now = new Date()
    return {
      version: 1,
      id: nextIdentity(now),
      created_at: now.toISOString(),
      path: request.path,
      body: request.body,
    }
  }

  private async ensureDirectories(): Promise<void> {
    await Promise.all([
      mkdir(this.deadDirectory, { recursive: true, mode: 0o700 }),
      mkdir(this.blobDirectory, { recursive: true, mode: 0o700 }),
    ])
  }

  private async prepareArtifactFile(envelope: QueueEnvelope, sourcePath: string): Promise<void> {
    await this.ensureDirectories()
    const blob = `${envelope.id}.bin`
    const blobPath = join(this.blobDirectory, blob)
    try {
      await copyFile(sourcePath, blobPath, constants.COPYFILE_EXCL)
      await chmod(blobPath, 0o600)
      const metadata = await stat(blobPath)
      if (!metadata.isFile()) throw new Error('artifact source was not a regular file')
      const sha256 = await sha256File(blobPath)
      envelope.body = { ...(envelope.body as ArtifactFileMetadata), sha256, size: metadata.size }
      envelope.file = { blob }
      await this.writePending(envelope)
    } catch (error) {
      await rm(blobPath, { force: true })
      throw error
    }
  }

  private async pendingFiles(): Promise<string[]> {
    await this.ensureDirectories()
    return (await readdir(this.outboxDirectory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right))
  }

  private async readEnvelope(path: string): Promise<QueueEnvelope> {
    const text = await readFile(path, 'utf8')
    const parsed: unknown = JSON.parse(text.trim())
    if (!parsed || typeof parsed !== 'object') throw new Error(`invalid outbox envelope ${basename(path)}`)
    const candidate = parsed as Partial<QueueEnvelope>
    if (candidate.version !== 1 || typeof candidate.id !== 'string' || typeof candidate.created_at !== 'string'
      || !['/api/v1/artifacts', '/api/v1/telemetry', '/api/v1/heartbeat', '/api/v1/task-state'].includes(candidate.path ?? '')) {
      throw new Error(`invalid outbox envelope ${basename(path)}`)
    }
    if (candidate.file !== undefined) {
      if (candidate.path !== '/api/v1/artifacts' || typeof candidate.file.blob !== 'string'
        || candidate.file.blob !== basename(candidate.file.blob) || !candidate.file.blob.endsWith('.bin')) {
        throw new Error(`invalid file outbox envelope ${basename(path)}`)
      }
      if (candidate.file.upload_state !== undefined && !validUploadState(candidate.file.upload_state)) {
        throw new Error(`invalid upload progress in ${basename(path)}`)
      }
    }
    return candidate as QueueEnvelope
  }

  private async flushPending(): Promise<boolean> {
    const files = await this.pendingFiles()
    for (const filename of files) {
      const path = join(this.outboxDirectory, filename)
      let envelope: QueueEnvelope
      try {
        envelope = await this.readEnvelope(path)
      } catch (error: unknown) {
        await this.moveToDead(path)
        this.logger.warn(`promax-report moved malformed queue entry ${filename} to dead: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }

      const result = await this.deliverEnvelope(path, envelope)
      if (result.kind === 'success') {
        await unlink(path)
        await this.removeBlob(envelope)
        this.logger.debug(`promax-report recovered ${filename}`)
        continue
      }
      if (result.kind === 'dead') {
        await this.moveToDead(path, envelope)
        this.logger.warn(`promax-report moved ${filename} to dead after HTTP ${result.status}`)
        continue
      }
      this.logger.debug(`promax-report recovery paused: ${result.message}`)
      return false
    }
    return true
  }

  private async deliverEnvelope(path: string, envelope: QueueEnvelope) {
    if (!envelope.file) return this.transport.deliver({ path: envelope.path, body: envelope.body })
    const filePath = join(this.blobDirectory, envelope.file.blob)
    return this.transport.deliver({
      path: '/api/v1/artifacts',
      body: envelope.body as ArtifactUploadMetadata,
      filePath,
      ...(envelope.file.upload_state === undefined ? {} : { uploadState: envelope.file.upload_state }),
      persistUploadState: async (state) => {
        envelope.file = { blob: envelope.file!.blob, upload_state: state }
        await this.replaceEnvelope(path, envelope)
      },
    })
  }

  private async deliverNew(envelope: QueueEnvelope): Promise<void> {
    const result = await this.transport.deliver({ path: envelope.path, body: envelope.body })
    if (result.kind === 'success') return
    if (result.kind === 'dead') {
      await this.writeDead(envelope)
      this.logger.warn(`promax-report sent event to dead after HTTP ${result.status}`)
      return
    }
    await this.writePending(envelope)
    this.logger.debug(`promax-report queued event for retry: ${result.message}`)
  }

  private async writeEnvelope(path: string, envelope: QueueEnvelope, exclusive: boolean): Promise<void> {
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    try {
      if (exclusive) {
        await copyFile(temporaryPath, path, constants.COPYFILE_EXCL)
        await unlink(temporaryPath)
      } else {
        await rename(temporaryPath, path)
      }
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
  }

  private async writePending(envelope: QueueEnvelope): Promise<void> {
    await this.ensureDirectories()
    await this.writeEnvelope(join(this.outboxDirectory, `${envelope.id}.jsonl`), envelope, true)
  }

  private async replaceEnvelope(path: string, envelope: QueueEnvelope): Promise<void> {
    await this.writeEnvelope(path, envelope, false)
  }

  private async writeDead(envelope: QueueEnvelope): Promise<void> {
    await this.ensureDirectories()
    await this.writeEnvelope(join(this.deadDirectory, `${envelope.id}.jsonl`), envelope, true)
  }

  private async moveToDead(path: string, envelope?: QueueEnvelope): Promise<void> {
    await this.ensureDirectories()
    await rename(path, join(this.deadDirectory, basename(path)))
    if (envelope?.file) {
      await rename(join(this.blobDirectory, envelope.file.blob), join(this.deadDirectory, envelope.file.blob))
    }
  }

  private async removeBlob(envelope: QueueEnvelope): Promise<void> {
    if (envelope.file) await rm(join(this.blobDirectory, envelope.file.blob), { force: true })
  }
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

function validUploadState(value: unknown): value is ChunkUploadState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.upload_id === 'string'
    && Number.isSafeInteger(candidate.chunk_size) && (candidate.chunk_size as number) > 0
    && Number.isSafeInteger(candidate.next_chunk) && (candidate.next_chunk as number) >= 0
}
