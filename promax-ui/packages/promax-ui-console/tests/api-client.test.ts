import type {
  ApiErrorResponse,
  ConsoleArtifactsQuery,
  ConsoleArtifactsResponse,
  ConsoleOverviewResponse,
  ConsoleUsersResponse,
  LoginResponse,
  MeResponse,
} from '@promax/contracts'
import { describe, expect, it, vi } from 'vitest'

import { PromaxApiClient, PromaxApiError } from '../src/data/api-client.ts'
import { MemoryTokenStore } from '../src/data/token-store.ts'
import { contractFixture, jsonResponse } from './fixtures.ts'

const loginTokens = contractFixture<LoginResponse>('auth.login.response.json')
const refreshedTokens = contractFixture<LoginResponse>('auth.refresh.response.json')
const me = contractFixture<MeResponse>('me.response.json')
const overview = contractFixture<ConsoleOverviewResponse>('console.overview.response.json')
const users = contractFixture<ConsoleUsersResponse>('console.users.response.json')
const artifacts = contractFixture<ConsoleArtifactsResponse>('console.artifacts.response.json')
const artifactQuery = contractFixture<ConsoleArtifactsQuery>('console.artifacts.request.json')
const apiErrors = contractFixture<Array<{ status: number } & ApiErrorResponse>>('errors.json')

function apiError(status: number): { status: number } & ApiErrorResponse {
  const fixture = apiErrors.find(item => item.status === status)
  if (fixture === undefined) throw new Error(`Missing ${status} fixture`)
  return fixture
}

describe('PromaxApiClient', () => {
  it('logs in using the contract response and persists /me', async () => {
    const store = new MemoryTokenStore()
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/login')) return jsonResponse(loginTokens)
      if (url.endsWith('/api/v1/me')) return jsonResponse(me)
      throw new Error(`Unexpected URL: ${url}`)
    })
    const client = new PromaxApiClient('http://127.0.0.1:3001/', store, fetchMock)

    await expect(client.login({ employee_id: me.employee_id, password: 'fixture-password' })).resolves.toEqual(me)
    expect(client.baseUrl).toBe('http://127.0.0.1:3001')
    expect(store.read()).toEqual({ tokens: loginTokens, user: me })
  })

  it('rotates both tokens once and retries concurrent 401 requests', async () => {
    const store = new MemoryTokenStore()
    store.write({ tokens: loginTokens, user: me })
    let refreshCalls = 0
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      const authorization = new Headers(init?.headers).get('authorization')
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshCalls += 1
        await Promise.resolve()
        return jsonResponse(refreshedTokens)
      }
      if (authorization === `Bearer ${loginTokens.access_token}`) {
        return jsonResponse(apiError(401), 401)
      }
      if (url.endsWith('/api/v1/console/overview')) return jsonResponse(overview)
      if (url.endsWith('/api/v1/console/users')) return jsonResponse(users)
      throw new Error(`Unexpected URL: ${url}`)
    })
    const client = new PromaxApiClient(undefined, store, fetchMock)

    await expect(Promise.all([client.overview(), client.users()])).resolves.toEqual([overview, users])
    expect(refreshCalls).toBe(1)
    expect(store.read()).toEqual({ tokens: refreshedTokens, user: me })
  })

  it('clears the session when refresh fails', async () => {
    const store = new MemoryTokenStore()
    store.write({ tokens: loginTokens })
    const unauthorized = apiError(401)
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(unauthorized, unauthorized.status))
    const client = new PromaxApiClient(undefined, store, fetchMock)

    await expect(client.overview()).rejects.toMatchObject({ status: 401 })
    expect(store.read()).toBeUndefined()
  })

  it('uses the server contract error message', async () => {
    const store = new MemoryTokenStore()
    store.write({ tokens: loginTokens })
    const serverError = apiError(429)
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(serverError, serverError.status))
    const client = new PromaxApiClient(undefined, store, fetchMock)

    await expect(client.overview()).rejects.toEqual(expect.objectContaining<Partial<PromaxApiError>>({
      status: 429,
      code: serverError.error.code,
      message: serverError.error.message,
      detail: serverError.error.detail,
    }))
  })

  it('serializes the supplied artifact filters without changing page origin', async () => {
    const store = new MemoryTokenStore()
    store.write({ tokens: loginTokens })
    let requestedUrl = ''
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      requestedUrl = String(input)
      return jsonResponse(artifacts)
    })
    const client = new PromaxApiClient(undefined, store, fetchMock)

    await client.artifacts(artifactQuery)

    const url = new URL(requestedUrl)
    expect(url.pathname).toBe('/api/v1/console/artifacts')
    expect(Object.fromEntries(url.searchParams)).toEqual(Object.fromEntries(
      Object.entries(artifactQuery).map(([key, value]) => [key, String(value)]),
    ))
    expect(url.searchParams.get('page')).toBe('1')
  })
})
