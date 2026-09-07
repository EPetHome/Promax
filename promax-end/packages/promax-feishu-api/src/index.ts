/** Shared Feishu authentication and HTTP client; no plugin or user settings. */
export const FEISHU_APP_ID_REF = 'APP_ID'
export const FEISHU_APP_SECRET_REF = 'APP_SECRET'
export interface CredentialsService {
  resolve(ref: string): Promise<{ value: string } | undefined>
}
const record = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
const jsonBody = (value: unknown): string => JSON.stringify(value)

interface FeishuErrorOptions {
  kind: 'retry' | 'dead'
  status?: number
  code?: number
}

export class FeishuDeliveryError extends Error {
  readonly kind: 'retry' | 'dead'
  readonly status: number | undefined
  readonly code: number | undefined

  constructor(message: string, options: FeishuErrorOptions) {
    super(message)
    this.name = 'FeishuDeliveryError'
    this.kind = options.kind
    this.status = options.status
    this.code = options.code
  }
}

export class FeishuApi {
  private tokenValue?: { value: string; expiresAt: number; appId: string }

  constructor(
    private readonly credentials: CredentialsService,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: typeof fetch,
  ) {}

  protected async accessToken(signal?: AbortSignal): Promise<string> {
    const [appId, appSecret] = await Promise.all([
      this.credentials.resolve(FEISHU_APP_ID_REF),
      this.credentials.resolve(FEISHU_APP_SECRET_REF),
    ])
    if (!appId || !appSecret) throw new FeishuDeliveryError('飞书 APP_ID 或 APP_SECRET 未配置', { kind: 'retry' })
    if (this.tokenValue && this.tokenValue.appId === appId.value && this.tokenValue.expiresAt > Date.now() + 60_000) return this.tokenValue.value
    const response = await this.raw('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: jsonBody({ app_id: appId.value, app_secret: appSecret.value }),
      ...(signal === undefined ? {} : { signal }),
    })
    const payload = await this.responseJson(response)
    const token = string(payload.tenant_access_token)
    if (!response.ok || payload.code !== 0 || !token) throw this.apiFailure(response.status, payload, '获取 tenant_access_token 失败')
    const expires = typeof payload.expire === 'number' ? payload.expire : 7200
    this.tokenValue = { value: token, expiresAt: Date.now() + expires * 1000, appId: appId.value }
    return token
  }

  protected async raw(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImplementation(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs) })
    } catch (error: unknown) {
      throw new FeishuDeliveryError(error instanceof Error ? error.message : String(error), { kind: 'retry' })
    }
  }

  protected async responseJson(response: Response): Promise<Record<string, unknown>> {
    try {
      const value: unknown = await response.json()
      return record(value)
    } catch {
      throw new FeishuDeliveryError(`飞书返回了非 JSON 响应（HTTP ${String(response.status)}）`, {
        kind: response.status === 429 || response.status >= 500 ? 'retry' : 'dead',
        status: response.status,
      })
    }
  }

  protected apiFailure(status: number, payload: Record<string, unknown>, context: string): FeishuDeliveryError {
    const code = typeof payload.code === 'number' ? payload.code : undefined
    const message = string(payload.msg) ?? 'unknown error'
    const httpFailure = status < 200 || status >= 300
    const retryable = !httpFailure || status === 401 || status === 408 || status === 409 || status === 429 || status >= 500
    return new FeishuDeliveryError(`${context}: ${message}${code === undefined ? '' : ` (code ${String(code)})`}`, {
      kind: retryable ? 'retry' : 'dead',
      status,
      ...(code === undefined ? {} : { code }),
    })
  }

  async json(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const token = await this.accessToken(signal)
    const response = await this.raw(`https://open.feishu.cn/open-apis${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: jsonBody(body) }),
      ...(signal === undefined ? {} : { signal }),
    })
    const payload = await this.responseJson(response)
    if (!response.ok || (typeof payload.code === 'number' && payload.code !== 0)) throw this.apiFailure(response.status, payload, `${method} ${path}`)
    return payload
  }

}
