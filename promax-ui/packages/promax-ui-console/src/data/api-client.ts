import type {
  ApiErrorCode,
  ApiErrorResponse,
  ConsoleArtifactsQuery,
  ConsoleArtifactsResponse,
  ConsoleOverviewResponse,
  ConsoleTelemetryQuery,
  ConsoleTelemetryResponse,
  ConsoleUsersResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
} from '@promax/contracts'
import { resolveApiBaseUrl } from './config.ts'
import type { AuthSession, TokenStore } from './token-store.ts'

export class PromaxApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ApiErrorCode,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'PromaxApiError'
  }
}

export class PromaxApiClient {
  readonly baseUrl: string

  constructor(
    baseUrl: string | undefined,
    private readonly tokens: TokenStore,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.baseUrl = resolveApiBaseUrl(baseUrl)
  }

  async login(request: LoginRequest): Promise<MeResponse> {
    const tokens = await this.requestPublic<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    this.tokens.write({ tokens })
    const user = await this.me()
    this.tokens.write({ tokens, user })
    return user
  }

  async logout(): Promise<void> {
    const session = this.tokens.read()
    try {
      if (session !== undefined) {
        await this.requestPublic<void>('/api/v1/auth/logout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refresh_token: session.tokens.refresh_token }),
        })
      }
    } finally {
      this.tokens.clear()
    }
  }

  me(): Promise<MeResponse> { return this.request<MeResponse>('/api/v1/me') }
  overview(): Promise<ConsoleOverviewResponse> { return this.request('/api/v1/console/overview') }
  users(): Promise<ConsoleUsersResponse> { return this.request('/api/v1/console/users') }
  artifacts(query: ConsoleArtifactsQuery): Promise<ConsoleArtifactsResponse> {
    return this.request(`/api/v1/console/artifacts?${queryString(query)}`)
  }
  telemetry(query: ConsoleTelemetryQuery): Promise<ConsoleTelemetryResponse> {
    return this.request(`/api/v1/console/telemetry?${queryString(query)}`)
  }
  download(artifactId: string): Promise<Response> {
    return this.requestResponse(`/api/v1/console/artifacts/${encodeURIComponent(artifactId)}/download`)
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.requestResponse(path, init)
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  private async requestResponse(path: string, init: RequestInit = {}): Promise<Response> {
    const initial = this.tokens.read()
    if (initial === undefined) throw new PromaxApiError(401, '请先登录 Promax')
    const usedAccessToken = initial.tokens.access_token
    let response = await this.fetchWithToken(path, usedAccessToken, init)
    if (response.status !== 401) return await ensureOk(response)

    const latest = this.tokens.read()
    if (latest !== undefined && latest.tokens.access_token !== usedAccessToken) {
      response = await this.fetchWithToken(path, latest.tokens.access_token, init)
      return await ensureOk(response)
    }
    await this.refresh(initial)
    const refreshed = this.tokens.read()
    if (refreshed === undefined) throw new PromaxApiError(401, '登录已失效，请重新登录')
    response = await this.fetchWithToken(path, refreshed.tokens.access_token, init)
    return await ensureOk(response)
  }

  private refreshPromise: Promise<void> | undefined

  private async refresh(session: AuthSession): Promise<void> {
    if (this.refreshPromise === undefined) {
      this.refreshPromise = this.requestPublic<LoginResponse>('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.tokens.refresh_token }),
      }).then((tokens) => { this.tokens.write({ tokens, ...(session.user === undefined ? {} : { user: session.user }) }) })
        .catch((error: unknown) => { this.tokens.clear(); throw error })
        .finally(() => { this.refreshPromise = undefined })
    }
    await this.refreshPromise
  }

  private fetchWithToken(path: string, accessToken: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${accessToken}`)
    return this.fetchImplementation(`${this.baseUrl}${path}`, { ...init, headers })
  }

  private async requestPublic<T>(path: string, init: RequestInit): Promise<T> {
    const response = await ensureOk(await this.fetchImplementation(`${this.baseUrl}${path}`, init))
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }
}

function queryString(query: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return params.toString()
}

async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) return response
  const fallback = response.status === 401 ? '登录已失效，请重新登录' : `请求失败（${response.status}）`
  try {
    const payload = await response.clone().json() as Partial<ApiErrorResponse>
    if (payload.error?.message !== undefined) {
      throw new PromaxApiError(response.status, payload.error.message, payload.error.code, payload.error.detail)
    }
  } catch (error: unknown) {
    if (error instanceof PromaxApiError) throw error
  }
  throw new PromaxApiError(response.status, fallback)
}
