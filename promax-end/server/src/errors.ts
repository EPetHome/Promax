import type { ApiErrorCode, ApiErrorResponse } from '@promax/contracts'

const statusByCode: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMIT: 429,
  UPSTREAM_UNAVAILABLE: 503,
  INTERNAL: 500,
}

export class ApiError extends Error {
  readonly status: number

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = statusByCode[code]
  }

  toResponse(): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        detail: this.detail,
      },
    }
  }
}
