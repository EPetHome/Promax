import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { RefreshResponse } from '@promax/contracts'

export type TokenRefreshResult =
  | { kind: 'success' }
  | { kind: 'retry'; status?: number; message: string }

export interface AccessTokenProvider {
  accessToken(): Promise<string>
  refresh(failedAccessToken: string): Promise<TokenRefreshResult>
}

export interface TokenLogger {
  warn(message: string): void
}

export interface RotatingTokenManagerOptions {
  baseUrl: string
  employeeId: string
  accessToken: string
  refreshToken: string
  storePath: string
  timeoutMs: number
  fetchImplementation?: typeof fetch
  now?: () => Date
}

interface StoredTokenPair {
  version: 1
  base_url: string
  employee_id: string
  access_token: string
  refresh_token: string
  access_expires_at: string | null
  refresh_expires_at: string | null
  updated_at: string
}

export class RotatingTokenManager implements AccessTokenProvider {
  private readonly fetchImplementation: typeof fetch
  private readonly now: () => Date
  private state: StoredTokenPair | undefined
  private loadPromise: Promise<void> | undefined
  private refreshPromise: Promise<TokenRefreshResult> | undefined
  private dirty = false

  constructor(
    private readonly options: RotatingTokenManagerOptions,
    private readonly logger: TokenLogger,
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch
    this.now = options.now ?? (() => new Date())
  }

  async accessToken(): Promise<string> {
    await this.load()
    if (this.dirty) await this.persistBestEffort()
    return this.state!.access_token
  }

  async refresh(failedAccessToken: string): Promise<TokenRefreshResult> {
    await this.load()
    if (this.state!.access_token !== failedAccessToken) return { kind: 'success' }
    if (!this.refreshPromise) {
      this.refreshPromise = this.rotate().finally(() => {
        this.refreshPromise = undefined
      })
    }
    return this.refreshPromise
  }

  private async load(): Promise<void> {
    if (this.state) return
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk().catch((error: unknown) => {
        this.loadPromise = undefined
        throw error
      })
    }
    await this.loadPromise
  }

  private async loadFromDisk(): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.options.storePath, 'utf8'))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`promax-report token store cannot be read safely: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (parsed !== undefined) {
      if (!validStoredTokenPair(parsed)) {
        throw new Error('promax-report token store is malformed; refusing to reuse configured refresh token')
      }
      if (parsed.base_url === this.options.baseUrl && parsed.employee_id === this.options.employeeId) {
        this.state = parsed
        return
      }
    }

    const now = this.now().toISOString()
    this.state = {
      version: 1,
      base_url: this.options.baseUrl,
      employee_id: this.options.employeeId,
      access_token: this.options.accessToken,
      refresh_token: this.options.refreshToken,
      access_expires_at: null,
      refresh_expires_at: null,
      updated_at: now,
    }
    await this.persist()
  }

  private async rotate(): Promise<TokenRefreshResult> {
    const current = this.state!
    let response: Response
    try {
      response = await this.fetchImplementation(`${this.options.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    } catch (error: unknown) {
      return { kind: 'retry', message: `Promax token refresh failed: ${error instanceof Error ? error.message : String(error)}` }
    }

    if (response.status !== 200) {
      return { kind: 'retry', status: response.status, message: `Promax token refresh returned HTTP ${response.status}` }
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { kind: 'retry', message: 'Promax token refresh response was not valid JSON' }
    }
    if (!validRefreshResponse(payload)) {
      return { kind: 'retry', message: 'Promax token refresh response was missing required fields' }
    }
    if (payload.refresh_token === current.refresh_token) {
      return { kind: 'retry', message: 'Promax token refresh did not rotate refresh_token' }
    }

    const now = this.now()
    this.state = {
      version: 1,
      base_url: this.options.baseUrl,
      employee_id: this.options.employeeId,
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      access_expires_at: new Date(now.getTime() + payload.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now.getTime() + payload.refresh_expires_in * 1000).toISOString(),
      updated_at: now.toISOString(),
    }
    this.dirty = true
    await this.persistBestEffort()
    return { kind: 'success' }
  }

  private async persistBestEffort(): Promise<void> {
    try {
      await this.persist()
      this.dirty = false
    } catch (error: unknown) {
      this.logger.warn(`promax-report rotated tokens are only in memory; persistence failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.options.storePath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.options.storePath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(this.state)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    try {
      await rename(temporaryPath, this.options.storePath)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      throw error
    }
  }
}

function validRefreshResponse(value: unknown): value is RefreshResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.access_token === 'string' && candidate.access_token.length > 0
    && typeof candidate.refresh_token === 'string' && candidate.refresh_token.length > 0
    && candidate.token_type === 'Bearer'
    && Number.isSafeInteger(candidate.expires_in) && (candidate.expires_in as number) > 0
    && Number.isSafeInteger(candidate.refresh_expires_in) && (candidate.refresh_expires_in as number) > 0
}

function validStoredTokenPair(value: unknown): value is StoredTokenPair {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.version === 1
    && typeof candidate.base_url === 'string'
    && typeof candidate.employee_id === 'string'
    && typeof candidate.access_token === 'string' && candidate.access_token.length > 0
    && typeof candidate.refresh_token === 'string' && candidate.refresh_token.length > 0
    && (candidate.access_expires_at === null || typeof candidate.access_expires_at === 'string')
    && (candidate.refresh_expires_at === null || typeof candidate.refresh_expires_at === 'string')
    && typeof candidate.updated_at === 'string'
}
