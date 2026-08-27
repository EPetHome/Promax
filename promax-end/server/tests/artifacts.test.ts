import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { AuthService, hashPassword } from '../src/auth.ts'
import { buildApp } from '../src/app.ts'
import { SqliteArtifactRepository } from '../src/artifact-repository.ts'
import { ArtifactService, MAX_DIRECT_ARTIFACT_BYTES } from '../src/artifacts.ts'
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
  const directory = mkdtempSync(join(tmpdir(), 'promax-artifacts-'))
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
  const repository = new SqliteArtifactRepository(database)
  let sequence = 0
  const artifacts = new ArtifactService(
    repository,
    join(directory, 'raw'),
    () => new Date('2026-08-26T01:02:03Z'),
    () => `art_test_${++sequence}`,
  )
  const auth = new AuthService(
    users,
    new SqliteRefreshTokenRepository(database),
    secret,
    3600,
    30 * 24 * 60 * 60,
    () => new Date('2026-08-26T00:00:00Z'),
  )
  const reporting = new ReportingService(new SqliteReportingRepository(database))
  const consoleService = new ConsoleService(new SqliteConsoleRepository(database), repository, directory, 14)
  const chunkUploads = new ChunkUploadService(new SqliteChunkUploadRepository(database), repository, artifacts, join(directory, 'uploads'))
  const app = buildApp({ auth, artifacts, reporting, console: consoleService, chunkUploads })
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { employee_id: '10086', password: 'correct-password' },
  })
  return { app, database, repository, directory, token: login.json().access_token as string }
}

function request(content: string, overrides: Record<string, unknown> = {}) {
  const bytes = Buffer.from(content)
  return {
    employee_id: '10086',
    project: '产品中台',
    agent: 'product-solution',
    kind: 'prd',
    filename: '需求方案.md',
    created_at: '2026-08-25T14:03:22+08:00',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    content: bytes.toString('base64'),
    ...overrides,
  }
}

test('artifact upload writes the file and database row, then returns duplicate for the same sha', async () => {
  const context = await testContext()
  try {
    const first = await context.app.inject({
      method: 'POST',
      url: '/api/v1/artifacts',
      headers: { authorization: `Bearer ${context.token}` },
      payload: request('first artifact'),
    })
    assert.equal(first.statusCode, 201)
    assert.deepEqual(first.json(), {
      artifact_id: 'art_test_1',
      path: 'raw/10086/产品中台/2026-08-25-需求方案.md',
    })
    const absolutePath = join(context.directory, first.json().path)
    assert.equal(readFileSync(absolutePath, 'utf8'), 'first artifact')
    assert.equal(context.repository.findById('art_test_1')?.path, first.json().path)

    const duplicate = await context.app.inject({
      method: 'POST',
      url: '/api/v1/artifacts',
      headers: { authorization: `Bearer ${context.token}` },
      payload: request('first artifact'),
    })
    assert.equal(duplicate.statusCode, 200)
    assert.deepEqual(duplicate.json(), { artifact_id: 'art_test_1', duplicate: true })
    assert.equal(readdirSync(join(context.directory, 'raw', '10086', '产品中台')).length, 1)
  } finally {
    await context.app.close()
    context.database.close()
  }
})

test('a different artifact with the same filename receives a numeric suffix', async () => {
  const context = await testContext()
  try {
    const first = await context.app.inject({
      method: 'POST', url: '/api/v1/artifacts', headers: { authorization: `Bearer ${context.token}` }, payload: request('one'),
    })
    const second = await context.app.inject({
      method: 'POST', url: '/api/v1/artifacts', headers: { authorization: `Bearer ${context.token}` }, payload: request('two'),
    })
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.json().path, 'raw/10086/产品中台/2026-08-25-需求方案-2.md')
  } finally {
    await context.app.close()
    context.database.close()
  }
})

test('artifact upload validates identity, paths, size, base64, and sha256', async () => {
  const context = await testContext()
  try {
    const cases = [
      request('content', { employee_id: '10010' }),
      request('content', { project: '../escape' }),
      request('content', { filename: '../escape.md' }),
      request('content', { size: 999 }),
      request('content', { content: 'not-base64' }),
      request('content', { sha256: '0'.repeat(64) }),
      request('content', { created_at: '2026-08-25T14:03:22' }),
    ]
    for (const payload of cases) {
      const response = await context.app.inject({
        method: 'POST', url: '/api/v1/artifacts', headers: { authorization: `Bearer ${context.token}` }, payload,
      })
      assert.ok(response.statusCode === 400 || response.statusCode === 401)
      assert.ok(response.json().error.code === 'VALIDATION' || response.json().error.code === 'UNAUTHORIZED')
    }
  } finally {
    await context.app.close()
    context.database.close()
  }
})

test('direct upload rejects decoded content larger than 5MB', async () => {
  const context = await testContext()
  try {
    const content = Buffer.alloc(MAX_DIRECT_ARTIFACT_BYTES + 1, 1)
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/artifacts',
      headers: { authorization: `Bearer ${context.token}` },
      payload: request('', {
        size: content.length,
        content: content.toString('base64'),
        sha256: createHash('sha256').update(content).digest('hex'),
      }),
    })
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(response.json().error.code, 'VALIDATION')
  } finally {
    await context.app.close()
    context.database.close()
  }
})
