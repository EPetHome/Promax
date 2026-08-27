import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LoginResponse } from '@promax/contracts'

import { AuthService, hashPassword } from '../src/auth.ts'
import { buildApp } from '../src/app.ts'
import { SqliteArtifactRepository } from '../src/artifact-repository.ts'
import { ArtifactService } from '../src/artifacts.ts'
import { SqliteConsoleRepository } from '../src/console-repository.ts'
import { ConsoleService } from '../src/console.ts'
import { SqliteChunkUploadRepository } from '../src/chunk-upload-repository.ts'
import { ChunkUploadService } from '../src/chunk-uploads.ts'
import { openDatabase } from '../src/database.ts'
import { SqliteRefreshTokenRepository } from '../src/refresh-token-repository.ts'
import { SqliteReportingRepository } from '../src/reporting-repository.ts'
import { ReportingService } from '../src/reporting.ts'
import { SqliteUserRepository } from '../src/user-repository.ts'

const secret = 'promax-test-secret-that-is-at-least-32-bytes'

async function testApp(accessTtlSeconds = 3600, refreshTtlSeconds = 30 * 24 * 60 * 60) {
  const database = openDatabase(':memory:')
  const users = new SqliteUserRepository(database)
  users.create({
    employeeId: '10086',
    name: '测试用户',
    dept: '市场经营部',
    role: 'admin',
    passwordHash: await hashPassword('correct-password'),
    createdAt: '2026-08-26T00:00:00Z',
  })
  const auth = new AuthService(
    users,
    new SqliteRefreshTokenRepository(database),
    secret,
    accessTtlSeconds,
    refreshTtlSeconds,
    () => new Date('2026-08-26T00:00:00Z'),
  )
  const artifacts = new ArtifactService(new SqliteArtifactRepository(database), '/tmp/promax-auth-test-unused')
  const reporting = new ReportingService(new SqliteReportingRepository(database))
  const consoleService = new ConsoleService(new SqliteConsoleRepository(database), new SqliteArtifactRepository(database), '/tmp', 14)
  const chunkUploads = new ChunkUploadService(new SqliteChunkUploadRepository(database), new SqliteArtifactRepository(database), artifacts, '/tmp/promax-auth-uploads')
  const app = buildApp({ auth, artifacts, reporting, console: consoleService, chunkUploads })
  return { app, database, users }
}

test('login returns AT/RT fields and /me verifies the stateless access token', async () => {
  const { app, database, users } = await testApp()
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { employee_id: '10086', password: 'correct-password' },
    })
    assert.equal(login.statusCode, 200)
    const loginBody = login.json<LoginResponse>()
    assert.equal(loginBody.token_type, 'Bearer')
    assert.equal(loginBody.expires_in, 3600)
    assert.equal(loginBody.refresh_expires_in, 30 * 24 * 60 * 60)
    assert.ok(loginBody.access_token.length > 20)
    assert.match(loginBody.refresh_token, /^prt_[A-Za-z0-9_-]{43}$/u)
    const stored = database.prepare('SELECT token_hash FROM refresh_tokens').get() as { token_hash: string }
    assert.match(stored.token_hash, /^[0-9a-f]{64}$/u)
    assert.notEqual(stored.token_hash, loginBody.refresh_token)

    let lookupsAfterLogin = 0
    const findByEmployeeId = users.findByEmployeeId.bind(users)
    users.findByEmployeeId = (employeeId: string) => {
      lookupsAfterLogin += 1
      return findByEmployeeId(employeeId)
    }

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${loginBody.access_token}` },
    })
    assert.equal(me.statusCode, 200)
    assert.deepEqual(me.json(), {
      employee_id: '10086',
      name: '测试用户',
      dept: '市场经营部',
      role: 'admin',
    })
    assert.equal(lookupsAfterLogin, 0, 'access-token authentication must not query users')
  } finally {
    await app.close()
    database.close()
  }
})

test('refresh rotates once and reuse revokes the entire token chain', async () => {
  const { app, database } = await testApp()
  try {
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { employee_id: '10086', password: 'correct-password' },
    })
    const first = login.json<LoginResponse>()
    const refreshed = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: first.refresh_token },
    })
    assert.equal(refreshed.statusCode, 200)
    const second = refreshed.json<LoginResponse>()
    assert.notEqual(second.refresh_token, first.refresh_token)
    assert.notEqual(second.access_token, first.access_token)

    const reused = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: first.refresh_token },
    })
    assert.equal(reused.statusCode, 401)

    const chainRevoked = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: second.refresh_token },
    })
    assert.equal(chainRevoked.statusCode, 401)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM refresh_tokens').get()?.count, 2)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM refresh_tokens WHERE revoked_at IS NULL').get()?.count, 0)
  } finally {
    await app.close()
    database.close()
  }
})

test('logout revokes only one device refresh token and remains idempotent', async () => {
  const { app, database } = await testApp()
  try {
    const login = async () => (await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { employee_id: '10086', password: 'correct-password' },
    })).json<LoginResponse>()
    const deviceOne = await login()
    const deviceTwo = await login()

    const logout = await app.inject({
      method: 'POST', url: '/api/v1/auth/logout', payload: { refresh_token: deviceOne.refresh_token },
    })
    assert.equal(logout.statusCode, 204)
    assert.equal(logout.body, '')

    const deviceOneRejected = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: deviceOne.refresh_token },
    })
    assert.equal(deviceOneRejected.statusCode, 401)
    const deviceTwoAccepted = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: deviceTwo.refresh_token },
    })
    assert.equal(deviceTwoAccepted.statusCode, 200)

    const unknown = await app.inject({
      method: 'POST', url: '/api/v1/auth/logout', payload: { refresh_token: 'unknown-refresh-token' },
    })
    assert.equal(unknown.statusCode, 204)
  } finally {
    await app.close()
    database.close()
  }
})

test('refresh rejects invalid and expired tokens, and auth token bodies are validated', async () => {
  const { app, database } = await testApp(3600, -1)
  try {
    const invalid = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', payload: { refresh_token: 'not-issued' },
    })
    assert.equal(invalid.statusCode, 401)

    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { employee_id: '10086', password: 'correct-password' },
    })
    const expired = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh',
      payload: { refresh_token: login.json<LoginResponse>().refresh_token },
    })
    assert.equal(expired.statusCode, 401)

    for (const url of ['/api/v1/auth/refresh', '/api/v1/auth/logout']) {
      const missing = await app.inject({ method: 'POST', url, payload: {} })
      assert.equal(missing.statusCode, 400)
      assert.equal(missing.json().error.code, 'VALIDATION')
    }
  } finally {
    await app.close()
    database.close()
  }
})

test('login rejects an incorrect password without revealing which credential failed', async () => {
  const { app, database } = await testApp()
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { employee_id: '10086', password: 'wrong-password' },
    })
    assert.equal(response.statusCode, 401)
    assert.deepEqual(response.json(), {
      error: { code: 'UNAUTHORIZED', message: '工号或密码错误', detail: {} },
    })
  } finally {
    await app.close()
    database.close()
  }
})

test('login validates required fields and malformed JSON', async () => {
  const { app, database } = await testApp()
  try {
    const missing = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { employee_id: '' } })
    assert.equal(missing.statusCode, 400)
    assert.equal(missing.json().error.code, 'VALIDATION')

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    })
    assert.equal(malformed.statusCode, 400)
    assert.equal(malformed.json().error.code, 'VALIDATION')
  } finally {
    await app.close()
    database.close()
  }
})

test('/me rejects missing, malformed, and expired tokens', async () => {
  const { app, database } = await testApp(-1)
  try {
    const missing = await app.inject({ method: 'GET', url: '/api/v1/me' })
    assert.equal(missing.statusCode, 401)

    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: 'Bearer not-a-jwt' },
    })
    assert.equal(malformed.statusCode, 401)

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { employee_id: '10086', password: 'correct-password' },
    })
    const expired = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${login.json().access_token}` },
    })
    assert.equal(expired.statusCode, 401)
  } finally {
    await app.close()
    database.close()
  }
})

test('unexpected route failures use the INTERNAL error response', async () => {
  const { app, database } = await testApp()
  app.get('/__test/internal-error', async () => {
    throw new Error('sensitive failure detail')
  })
  try {
    const response = await app.inject({ method: 'GET', url: '/__test/internal-error' })
    assert.equal(response.statusCode, 500)
    assert.deepEqual(response.json(), {
      error: { code: 'INTERNAL', message: '服务暂时不可用，请稍后重试', detail: {} },
    })
    assert.equal(response.body.includes('sensitive failure detail'), false)
  } finally {
    await app.close()
    database.close()
  }
})
