import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { AuthService, hashPassword } from '../src/auth.ts'
import { buildApp } from '../src/app.ts'
import { SqliteArtifactRepository } from '../src/artifact-repository.ts'
import { ArtifactService, MAX_DIRECT_ARTIFACT_BYTES } from '../src/artifacts.ts'
import { SqliteChunkUploadRepository } from '../src/chunk-upload-repository.ts'
import { ARTIFACT_CHUNK_SIZE, ChunkUploadService } from '../src/chunk-uploads.ts'
import { SqliteConsoleRepository } from '../src/console-repository.ts'
import { ConsoleService } from '../src/console.ts'
import { openDatabase } from '../src/database.ts'
import { SqliteRefreshTokenRepository } from '../src/refresh-token-repository.ts'
import { SqliteReportingRepository } from '../src/reporting-repository.ts'
import { ReportingService } from '../src/reporting.ts'
import { SqliteUserRepository } from '../src/user-repository.ts'

const secret = 'promax-test-secret-that-is-at-least-32-bytes'
const clock = new Date('2026-08-26T12:00:00Z')

async function testContext(maxArtifactBytes = 16 * 1024 * 1024) {
  const directory = await mkdtemp(join(tmpdir(), 'promax-chunks-'))
  const database = openDatabase(':memory:')
  const users = new SqliteUserRepository(database)
  const passwordHash = await hashPassword('correct-password')
  users.create({ employeeId: '10086', name: '上传者', dept: '市场经营部', role: 'admin', passwordHash, createdAt: clock.toISOString() })
  users.create({ employeeId: '10010', name: '其他用户', dept: '市场经营部', role: 'member', passwordHash, createdAt: clock.toISOString() })
  const artifactRepository = new SqliteArtifactRepository(database)
  let artifactSequence = 0
  const artifacts = new ArtifactService(
    artifactRepository,
    join(directory, 'raw'),
    () => clock,
    () => `art_chunk_${++artifactSequence}`,
  )
  let uploadSequence = 0
  const uploadsDirectory = join(directory, 'uploads')
  const chunkRepository = new SqliteChunkUploadRepository(database)
  const chunkUploads = new ChunkUploadService(
    chunkRepository,
    artifactRepository,
    artifacts,
    uploadsDirectory,
    maxArtifactBytes,
    () => clock,
    () => `upl_${(++uploadSequence).toString(16).padStart(32, '0')}`,
  )
  const auth = new AuthService(users, new SqliteRefreshTokenRepository(database), secret, 3600, 30 * 24 * 60 * 60, () => clock)
  const reporting = new ReportingService(new SqliteReportingRepository(database))
  const consoleService = new ConsoleService(new SqliteConsoleRepository(database), artifactRepository, directory, 14, () => clock)
  const app = buildApp({ auth, artifacts, reporting, console: consoleService, chunkUploads })

  async function token(employeeId: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { employee_id: employeeId, password: 'correct-password' },
    })
    return response.json().access_token as string
  }
  return {
    app,
    database,
    directory,
    uploadsDirectory,
    artifactRepository,
    adminToken: await token('10086'),
    memberToken: await token('10010'),
  }
}

function metadata(content: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    employee_id: '10086',
    project: '产品中台',
    agent: 'product-solution',
    kind: 'prototype',
    filename: '大型原型.zip',
    created_at: '2026-08-25T14:03:22+08:00',
    sha256: createHash('sha256').update(content).digest('hex'),
    size: content.byteLength,
    ...overrides,
  }
}

async function init(context: Awaited<ReturnType<typeof testContext>>, content: Buffer, overrides: Record<string, unknown> = {}) {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/v1/artifacts/init',
    headers: { authorization: `Bearer ${context.adminToken}` },
    payload: metadata(content, overrides),
  })
  return response
}

async function putChunks(context: Awaited<ReturnType<typeof testContext>>, uploadId: string, content: Buffer, skip = new Set<number>()) {
  const count = Math.ceil(content.byteLength / ARTIFACT_CHUNK_SIZE)
  for (let number = 0; number < count; number += 1) {
    if (skip.has(number)) continue
    const chunk = content.subarray(number * ARTIFACT_CHUNK_SIZE, Math.min((number + 1) * ARTIFACT_CHUNK_SIZE, content.byteLength))
    const response = await context.app.inject({
      method: 'PUT',
      url: `/api/v1/artifacts/${uploadId}/chunk/${number}`,
      headers: {
        authorization: `Bearer ${context.adminToken}`,
        'content-type': 'application/octet-stream',
      },
      payload: chunk,
    })
    assert.equal(response.statusCode, 204, response.body)
  }
}

test('six binary chunks assemble into one verified artifact and complete is idempotent', async () => {
  const context = await testContext()
  try {
    const content = Buffer.alloc(MAX_DIRECT_ARTIFACT_BYTES + 123, 0x5a)
    const initialized = await init(context, content)
    assert.equal(initialized.statusCode, 200)
    assert.deepEqual(initialized.json(), { upload_id: `upl_${'1'.padStart(32, '0')}`, chunk_size: ARTIFACT_CHUNK_SIZE })
    const uploadId = initialized.json().upload_id as string
    await putChunks(context, uploadId, content)

    const repeatedChunk = await context.app.inject({
      method: 'PUT', url: `/api/v1/artifacts/${uploadId}/chunk/0`,
      headers: { authorization: `Bearer ${context.adminToken}`, 'content-type': 'application/octet-stream' },
      payload: content.subarray(0, ARTIFACT_CHUNK_SIZE),
    })
    assert.equal(repeatedChunk.statusCode, 204)

    const completed = await context.app.inject({
      method: 'POST', url: `/api/v1/artifacts/${uploadId}/complete`, headers: { authorization: `Bearer ${context.adminToken}` }, payload: {},
    })
    assert.equal(completed.statusCode, 201, completed.body)
    assert.deepEqual(completed.json(), {
      artifact_id: 'art_chunk_1',
      path: 'raw/10086/产品中台/2026-08-25-大型原型.zip',
    })
    const artifact = context.artifactRepository.findById('art_chunk_1')
    assert(artifact)
    const stored = readFileSync(join(context.directory, artifact.path))
    assert.equal(stored.byteLength, content.byteLength)
    assert.equal(createHash('sha256').update(stored).digest('hex'), metadata(content).sha256)
    assert.equal(existsSync(join(context.uploadsDirectory, uploadId)), false)
    assert.equal(context.database.prepare('SELECT COUNT(*) AS n FROM artifact_upload_chunks').get()!.n, 0)

    const repeatedComplete = await context.app.inject({
      method: 'POST', url: `/api/v1/artifacts/${uploadId}/complete`, headers: { authorization: `Bearer ${context.adminToken}` }, payload: {},
    })
    assert.equal(repeatedComplete.statusCode, 200)
    assert.deepEqual(repeatedComplete.json(), { artifact_id: 'art_chunk_1', duplicate: true })

    const duplicateInit = await init(context, content)
    const duplicateComplete = await context.app.inject({
      method: 'POST', url: `/api/v1/artifacts/${duplicateInit.json().upload_id}/complete`,
      headers: { authorization: `Bearer ${context.adminToken}` }, payload: {},
    })
    assert.equal(duplicateComplete.statusCode, 200)
    assert.deepEqual(duplicateComplete.json(), { artifact_id: 'art_chunk_1', duplicate: true })
  } finally {
    await context.app.close()
    context.database.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test('chunk endpoint rejects missing, conflicting, oversized, and cross-user operations', async () => {
  const context = await testContext()
  try {
    const content = Buffer.alloc(MAX_DIRECT_ARTIFACT_BYTES + 1, 0x41)
    const initialized = await init(context, content)
    const uploadId = initialized.json().upload_id as string
    const first = content.subarray(0, ARTIFACT_CHUNK_SIZE)
    const put = await context.app.inject({
      method: 'PUT', url: `/api/v1/artifacts/${uploadId}/chunk/0`,
      headers: { authorization: `Bearer ${context.adminToken}`, 'content-type': 'application/octet-stream' }, payload: first,
    })
    assert.equal(put.statusCode, 204)

    const conflicting = Buffer.from(first)
    conflicting[0] = 0x42
    const conflict = await context.app.inject({
      method: 'PUT', url: `/api/v1/artifacts/${uploadId}/chunk/0`,
      headers: { authorization: `Bearer ${context.adminToken}`, 'content-type': 'application/octet-stream' }, payload: conflicting,
    })
    assert.equal(conflict.statusCode, 409)
    assert.equal(conflict.json().error.code, 'CONFLICT')

    const wrongSize = await context.app.inject({
      method: 'PUT', url: `/api/v1/artifacts/${uploadId}/chunk/1`,
      headers: { authorization: `Bearer ${context.adminToken}`, 'content-type': 'application/octet-stream' }, payload: Buffer.from('short'),
    })
    assert.equal(wrongSize.statusCode, 400)
    const outOfRange = await context.app.inject({
      method: 'PUT', url: `/api/v1/artifacts/${uploadId}/chunk/99`,
      headers: { authorization: `Bearer ${context.adminToken}`, 'content-type': 'application/octet-stream' }, payload: Buffer.from('short'),
    })
    assert.equal(outOfRange.statusCode, 400)
    const wrongUser = await context.app.inject({
      method: 'PUT', url: `/api/v1/artifacts/${uploadId}/chunk/1`,
      headers: { authorization: `Bearer ${context.memberToken}`, 'content-type': 'application/octet-stream' }, payload: content.subarray(ARTIFACT_CHUNK_SIZE, 2 * ARTIFACT_CHUNK_SIZE),
    })
    assert.equal(wrongUser.statusCode, 401)
    const missing = await context.app.inject({
      method: 'POST', url: `/api/v1/artifacts/${uploadId}/complete`, headers: { authorization: `Bearer ${context.adminToken}` }, payload: {},
    })
    assert.equal(missing.statusCode, 409)
  } finally {
    await context.app.close()
    context.database.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test('init enforces identity, >5MB routing, configured maximum, and metadata sha at completion', async () => {
  const context = await testContext(MAX_DIRECT_ARTIFACT_BYTES + 1024)
  try {
    const small = Buffer.alloc(MAX_DIRECT_ARTIFACT_BYTES, 1)
    assert.equal((await init(context, small)).statusCode, 400)
    const tooLarge = Buffer.alloc(MAX_DIRECT_ARTIFACT_BYTES + 1025, 2)
    assert.equal((await init(context, tooLarge)).statusCode, 400)
    const valid = Buffer.alloc(MAX_DIRECT_ARTIFACT_BYTES + 1, 3)
    assert.equal((await init(context, valid, { employee_id: '10010' })).statusCode, 401)

    const wrongSha = await init(context, valid, { sha256: '0'.repeat(64) })
    assert.equal(wrongSha.statusCode, 200)
    const uploadId = wrongSha.json().upload_id as string
    await putChunks(context, uploadId, valid)
    const complete = await context.app.inject({
      method: 'POST', url: `/api/v1/artifacts/${uploadId}/complete`, headers: { authorization: `Bearer ${context.adminToken}` }, payload: {},
    })
    assert.equal(complete.statusCode, 400)
    assert.equal(complete.json().error.code, 'VALIDATION')
    assert.equal(context.database.prepare('SELECT COUNT(*) AS n FROM artifacts').get()!.n, 0)
  } finally {
    await context.app.close()
    context.database.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})
