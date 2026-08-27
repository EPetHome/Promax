import type { LoginResponse, MeResponse } from '@promax/contracts'

export interface AuthSession {
  tokens: LoginResponse
  user?: MeResponse
}

export interface TokenStore {
  read(): AuthSession | undefined
  write(session: AuthSession): void
  clear(): void
}

export class MemoryTokenStore implements TokenStore {
  private session: AuthSession | undefined

  read(): AuthSession | undefined { return this.session }
  write(session: AuthSession): void { this.session = session }
  clear(): void { this.session = undefined }
}

const STORAGE_KEY = 'promax.auth.v1'
export const AUTH_SESSION_EVENT = 'promax-auth-session-change'

export class BrowserTokenStore implements TokenStore {
  read(): AuthSession | undefined {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return undefined
    try {
      const value: unknown = JSON.parse(raw)
      if (!isAuthSession(value)) throw new Error('Invalid Promax auth session')
      return value
    } catch {
      this.clear()
      return undefined
    }
  }

  write(session: AuthSession): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    window.dispatchEvent(new Event(AUTH_SESSION_EVENT))
  }

  clear(): void {
    window.localStorage.removeItem(STORAGE_KEY)
    window.dispatchEvent(new Event(AUTH_SESSION_EVENT))
  }
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value) || !isRecord(value.tokens)) return false
  const tokens = value.tokens
  if (
    typeof tokens.access_token !== 'string'
    || typeof tokens.refresh_token !== 'string'
    || tokens.token_type !== 'Bearer'
    || typeof tokens.expires_in !== 'number'
    || typeof tokens.refresh_expires_in !== 'number'
  ) return false
  if (value.user === undefined) return true
  return isRecord(value.user)
    && typeof value.user.employee_id === 'string'
    && typeof value.user.name === 'string'
    && typeof value.user.dept === 'string'
    && (value.user.role === 'admin' || value.user.role === 'member')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
