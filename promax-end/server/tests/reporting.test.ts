import assert from 'node:assert/strict'
import { test } from 'node:test'

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

async function testContext() {
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
  let sequence = 0
  let clock = new Date('2026-08-26T01:00:00Z')
  const reporting = new ReportingService(
    new SqliteReportingRepository(database),
    () => clock,
    () => `evt_test_${++sequence}`,
  )
  const auth = new AuthService(
    users,
    new SqliteRefreshTokenRepository(database),
    secret,
    3600,
    30 * 24 * 60 * 60,
    () => new Date('2026-08-26T00:00:00Z'),
  )
  const artifacts = new ArtifactService(new SqliteArtifactRepository(database), '/tmp/promax-reporting-test-unused')
  const consoleService = new ConsoleService(new SqliteConsoleRepository(database), new SqliteArtifactRepository(database), '/tmp', 14)
  const chunkUploads = new ChunkUploadService(new SqliteChunkUploadRepository(database), new SqliteArtifactRepository(database), artifacts, '/tmp/promax-reporting-uploads')
  const app = buildApp({ auth, artifacts, reporting, console: consoleService, chunkUploads })
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { employee_id: '10086', password: 'correct-password' },
  })
  return {
    app,
    database,
    token: login.json().access_token as string,
    setClock(value: string) { clock = new Date(value) },
  }
}

const hookEvent = {
  employee_id: '10086',
  event_type: 'agent',
  target: 'product-solution',
  source: 'hook',
  session_id: 'session-1',
  occurred_at: '2026-08-25T14:03:22+08:00',
  output_files: ['需求方案.md'],
  status: 'success',
}

test('telemetry is idempotent and stores hook/llm as separate rows', async () => {
  const context = await testContext()
  try {
    for (const payload of [hookEvent, hookEvent, {
      ...hookEvent,
      source: 'llm',
      target: 'prd-writer',
      occurred_at: '2026-08-25T14:03:23+08:00',
    }]) {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/telemetry',
        headers: { authorization: `Bearer ${context.token}` },
        payload,
      })
      assert.equal(response.statusCode, 202)
      assert.deepEqual(response.json(), {})
    }

    const rows = context.database.prepare(`
      SELECT source, target, output_files FROM telemetry ORDER BY occurred_at
    `).all() as Array<{ source: string, target: string, output_files: string }>
    assert.deepEqual(rows.map(({ source, target }) => ({ source, target })), [
      { source: 'hook', target: 'product-solution' },
      { source: 'llm', target: 'prd-writer' },
    ])
    assert.deepEqual(JSON.parse(rows[0]?.output_files ?? '[]'), ['需求方案.md'])
  } finally {
    await context.app.close()
    context.database.close()
  }
})

test('heartbeat upserts client state and server receipt time', async () => {
  const context = await testContext()
  try {
    const first = {
      employee_id: '10086',
      client_version: '0.1.0',
      dsh_version: '0.1.1-rc.2',
      config_fingerprint: `sha256:${'1'.repeat(64)}`,
    }
    const initial = await context.app.inject({
      method: 'POST', url: '/api/v1/heartbeat', headers: { authorization: `Bearer ${context.token}` }, payload: first,
    })
    assert.equal(initial.statusCode, 200)
    context.setClock('2026-08-26T02:00:00Z')
    const updated = await context.app.inject({
      method: 'POST', url: '/api/v1/heartbeat', headers: { authorization: `Bearer ${context.token}` },
      payload: { ...first, client_version: '0.1.1', config_fingerprint: `sha256:${'2'.repeat(64)}` },
    })
    assert.equal(updated.statusCode, 200)

    const rows = context.database.prepare('SELECT * FROM heartbeats').all()
    assert.equal(rows.length, 1)
    assert.deepEqual({ ...rows[0] }, {
      employee_id: '10086',
      client_version: '0.1.1',
      dsh_version: '0.1.1-rc.2',
      config_fingerprint: `sha256:${'2'.repeat(64)}`,
      at: '2026-08-26T02:00:00.000Z',
    })
  } finally {
    await context.app.close()
    context.database.close()
  }
})

test('reporting rejects identity mismatch and invalid dimensions', async () => {
  const context = await testContext()
  try {
    const cases = [
      { route: 'telemetry', payload: { ...hookEvent, employee_id: '10010' }, status: 401 },
      { route: 'telemetry', payload: { ...hookEvent, source: 'combined' }, status: 400 },
      { route: 'telemetry', payload: { ...hookEvent, event_type: 'chat', target: 'product-solution' }, status: 400 },
      { route: 'telemetry', payload: { ...hookEvent, output_files: '需求方案.md' }, status: 400 },
      {
        route: 'heartbeat',
        payload: { employee_id: '10086', client_version: '0.1.0', dsh_version: '0.1.1-rc.2', config_fingerprint: 'changed' },
        status: 400,
      },
    ]
    for (const item of cases) {
      const response = await context.app.inject({
        method: 'POST',
        url: `/api/v1/${item.route}`,
        headers: { authorization: `Bearer ${context.token}` },
        payload: item.payload,
      })
      assert.equal(response.statusCode, item.status)
    }
  } finally {
    await context.app.close()
    context.database.close()
  }
})
