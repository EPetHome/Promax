import { open, stat } from 'node:fs/promises'

import type { ArtifactUploadMetadata } from '@promax/contracts'

import type { AccessTokenProvider } from './token-manager.ts'

export type ReportPath = '/api/v1/artifacts' | '/api/v1/telemetry' | '/api/v1/heartbeat' | '/api/v1/task-state' | '/feishu/v1/run'

export interface ChunkUploadState {
  upload_id: string
  chunk_size: number
  next_chunk: number
}

export interface JsonReportRequest {
  path: ReportPath
  body: unknown
  filePath?: never
  /** Sink-owned durable progress restored from the outbox after a retry. */
  deliveryState?: unknown
  /** Persists sink-owned progress without removing the pending envelope. */
  persistDeliveryState?(state: unknown): Promise<void>
}

export interface ChunkedArtifactReportRequest {
  path: '/api/v1/artifacts'
  body: ArtifactUploadMetadata
  filePath: string
  uploadState?: ChunkUploadState
  persistUploadState(state: ChunkUploadState): Promise<void>
}

export type ReportRequest = JsonReportRequest | ChunkedArtifactReportRequest

export type DeliveryResult =
  | { kind: 'success'; status: number }
  | { kind: 'retry'; status?: number; message: string }
  | { kind: 'dead'; status: number; message: string }

export interface ReportTransport {
  deliver(request: ReportRequest): Promise<DeliveryResult>
}

function retry(message: string, status?: number): DeliveryResult {
  return status === undefined ? { kind: 'retry', message } : { kind: 'retry', status, message }
}

function classifyResponse(response: Response): DeliveryResult {
  if (response.status >= 200 && response.status < 300) return { kind: 'success', status: response.status }
  const message = `Promax returned HTTP ${response.status}`
  if (response.status === 401) return retry(message, response.status)
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    return { kind: 'dead', status: response.status, message }
  }
  return retry(message, response.status)
}

export class HttpReportTransport implements ReportTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: AccessTokenProvider,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async deliver(request: ReportRequest): Promise<DeliveryResult> {
    return request.filePath === undefined ? this.deliverJson(request) : this.deliverChunkedArtifact(request)
  }

  private async rawFetch(url: string, init: RequestInit): Promise<Response | DeliveryResult> {
    try {
      return await this.fetchImplementation(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error: unknown) {
      return retry(error instanceof Error ? error.message : String(error))
    }
  }

  private async authenticatedFetch(url: string, init: RequestInit): Promise<Response | DeliveryResult> {
    let accessToken: string
    try {
      accessToken = await this.tokens.accessToken()
    } catch (error: unknown) {
      return retry(error instanceof Error ? error.message : String(error))
    }
    const first = await this.rawFetch(url, withBearer(init, accessToken))
    if (!(first instanceof Response) || first.status !== 401) return first

    const refreshed = await this.tokens.refresh(accessToken)
    if (refreshed.kind === 'retry') return refreshed
    try {
      accessToken = await this.tokens.accessToken()
    } catch (error: unknown) {
      return retry(error instanceof Error ? error.message : String(error))
    }
    return this.rawFetch(url, withBearer(init, accessToken))
  }

  private async deliverJson(request: JsonReportRequest): Promise<DeliveryResult> {
    const response = await this.authenticatedFetch(`${this.baseUrl}${request.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request.body),
    })
    return response instanceof Response ? classifyResponse(response) : response
  }

  private async deliverChunkedArtifact(request: ChunkedArtifactReportRequest): Promise<DeliveryResult> {
    let file
    try {
      file = await stat(request.filePath)
    } catch (error: unknown) {
      return { kind: 'dead', status: 400, message: `Promax outbox blob is unavailable: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (!file.isFile() || file.size !== request.body.size) {
      return { kind: 'dead', status: 400, message: 'Promax outbox blob size no longer matches metadata' }
    }

    let state = request.uploadState
    if (!state) {
      const initialized = await this.authenticatedFetch(`${this.baseUrl}/api/v1/artifacts/init`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
      })
      if (!(initialized instanceof Response)) return initialized
      const classification = classifyResponse(initialized)
      if (classification.kind !== 'success') return classification
      let payload: unknown
      try {
        payload = await initialized.json()
      } catch {
        return retry('Promax init response was not valid JSON')
      }
      if (!payload || typeof payload !== 'object'
        || typeof (payload as Record<string, unknown>).upload_id !== 'string'
        || !Number.isSafeInteger((payload as Record<string, unknown>).chunk_size)
        || ((payload as Record<string, unknown>).chunk_size as number) <= 0) {
        return retry('Promax init response was missing upload_id or chunk_size')
      }
      state = {
        upload_id: (payload as { upload_id: string }).upload_id,
        chunk_size: (payload as { chunk_size: number }).chunk_size,
        next_chunk: 0,
      }
      await request.persistUploadState(state)
    }

    const chunkCount = Math.ceil(request.body.size / state.chunk_size)
    if (state.next_chunk < 0 || state.next_chunk > chunkCount) {
      return { kind: 'dead', status: 400, message: 'Promax outbox chunk progress is invalid' }
    }

    let handle
    try {
      handle = await open(request.filePath, 'r')
    } catch (error: unknown) {
      return { kind: 'dead', status: 400, message: `Promax outbox blob cannot be opened: ${error instanceof Error ? error.message : String(error)}` }
    }
    try {
      for (let number = state.next_chunk; number < chunkCount; number += 1) {
        const offset = number * state.chunk_size
        const length = Math.min(state.chunk_size, request.body.size - offset)
        const content = Buffer.allocUnsafe(length)
        const read = await handle.read(content, 0, length, offset)
        if (read.bytesRead !== length) {
          return { kind: 'dead', status: 400, message: `Promax outbox blob ended during chunk ${number}` }
        }
        const response = await this.authenticatedFetch(
          `${this.baseUrl}/api/v1/artifacts/${encodeURIComponent(state.upload_id)}/chunk/${number}`,
          { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(content) },
        )
        if (!(response instanceof Response)) return response
        const classification = classifyResponse(response)
        if (classification.kind !== 'success') return classification
        state = { ...state, next_chunk: number + 1 }
        await request.persistUploadState(state)
      }
    } finally {
      await handle.close()
    }

    const completed = await this.authenticatedFetch(
      `${this.baseUrl}/api/v1/artifacts/${encodeURIComponent(state.upload_id)}/complete`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    )
    return completed instanceof Response ? classifyResponse(completed) : completed
  }
}

function withBearer(init: RequestInit, accessToken: string): RequestInit {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${accessToken}`)
  return { ...init, headers }
}
