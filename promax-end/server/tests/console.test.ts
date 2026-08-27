import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { AuthService, hashPassword } from '../src/auth.ts'
import { buildApp } from '../src/app.ts'
import { SqliteArtifactRepository, type ArtifactRecord } from '../src/artifact-repository.ts'
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
const now = new Date('2026-08-26T12:00:00Z')

async function testContext() {
  const directory = await mkdtemp(join(tmpdir(), 'promax-console-'))
  const database = openDatabase(':memory:')
  const users = new SqliteUserRepository(database)
  const passwordHash = await hashPassword('correct-password')
  for (const input of [
    { employeeId: '10086', name: '测试管理员', dept: '市场经营部', role: 'admin' as const },
    { employeeId: '10010', name: '过期成员', dept: '市场经营部', role: 'member' as const },
    { employeeId: '10000', name: '未上报成员', dept: '产品部', role: 'member' as const },
  ]) {
    users.create({ ...input, passwordHash, createdAt: '2026-01-01T00:00:00Z' })
  }

  const artifactRepository = new SqliteArtifactRepository(database)
  const records: ArtifactRecord[] = [
    {
      artifactId: 'art_new', employeeId: '10086', project: '产品中台', agent: 'product-solution', kind: 'prd',
      filename: '需求方案.md', path: 'raw/10086/产品中台/2026-08-25-需求方案.md', sha256: '1'.repeat(64), size: 17,
      createdAt: '2026-08-25T14:03:22+08:00', receivedAt: '2026-08-25T06:03:23.000Z',
    },
    {
      artifactId: 'art_diagram', employeeId: '10086', project: '产品中台', agent: 'product-solution', kind: 'diagram',
      filename: '架构图.svg', path: 'raw/10086/产品中台/2026-08-24-架构图.svg', sha256: '2'.repeat(64), size: 11,
      createdAt: '2026-08-24T10:00:00+08:00', receivedAt: '2026-08-24T02:00:01.000Z',
    },
    {
      artifactId: 'art_old', employeeId: '10010', project: '旧项目', agent: 'requirement-management', kind: 'other',
      filename: '旧数据.csv', path: 'raw/10010/旧项目/2026-07-01-旧数据.csv', sha256: '3'.repeat(64), size: 8,
      createdAt: '2026-07-01T09:00:00+08:00', receivedAt: '2026-07-01T01:00:01.000Z',
    },
  ]
  for (const record of records) artifactRepository.create(record)
  const downloadContent = Buffer.from('# 需求方案\n')
  const downloadPath = join(directory, records[0]!.path)
  await mkdir(dirname(downloadPath), { recursive: true })
  await writeFile(downloadPath, downloadContent)

  const reportingRepository = new SqliteReportingRepository(database)
  const telemetry = [
    { id: 'evt_1', employeeId: '10086', eventType: 'agent' as const, target: 'product-solution', source: 'hook' as const, occurredAt: '2026-08-25T14:03:22+08:00' },
    { id: 'evt_2', employeeId: '10086', eventType: 'agent' as const, target: 'product-solution', source: 'llm' as const, occurredAt: '2026-08-25T14:03:23+08:00' },
    { id: 'evt_3', employeeId: '10010', eventType: 'chat' as const, target: '-', source: 'hook' as const, occurredAt: '2026-07-01T09:00:00+08:00' },
  ]
  for (const event of telemetry) {
    reportingRepository.insertTelemetry({
      ...event,
      sessionId: `session-${event.id}`,
      status: 'success',
      outputFiles: [],
      receivedAt: event.employeeId === '10086' ? '2026-08-25T06:03:24.000Z' : '2026-07-01T01:00:02.000Z',
    })
  }
  reportingRepository.upsertHeartbeat({
    employeeId: '10086', clientVersion: '0.1.0', dshVersion: '0.1.1-rc.2',
    configFingerprint: `sha256:${'a'.repeat(64)}`, at: '2026-08-26T11:30:00.000Z',
  })

  const auth = new AuthService(users, new SqliteRefreshTokenRepository(database), secret, 3600, 30 * 24 * 60 * 60, () => now)
  const artifacts = new ArtifactService(artifactRepository, join(directory, 'raw'))
  const reporting = new ReportingService(reportingRepository)
  const consoleService = new ConsoleService(new SqliteConsoleRepository(database), artifactRepository, directory, 14, () => now)
  const chunkUploads = new ChunkUploadService(new SqliteChunkUploadRepository(database), artifactRepository, artifacts, join(directory, 'uploads'))
  const app = buildApp({ auth, artifacts, reporting, console: consoleService, chunkUploads })

  async function token(employeeId: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { employee_id: employeeId, password: 'correct-password' },
    })
    assert.equal(response.statusCode, 200)
    return response.json().access_token as string
  }

  return {
    app,
    database,
    directory,
    downloadPath,
    adminToken: await token('10086'),
    memberToken: await token('10010'),
  }
}

test('overview and users implement receipt-based ok/stale/never detection', async () => {
  const context = await testContext()
  try {
    const headers = { authorization: `Bearer ${context.adminToken}` }
    const overview = await context.app.inject({ method: 'GET', url: '/api/v1/console/overview', headers })
    assert.equal(overview.statusCode, 200)
    assert.deepEqual(overview.json(), {
      users_total: 3,
      users_active_7d: 1,
      artifacts_total: 3,
      artifacts_7d: 2,
      coverage_rate: 0.3333,
    })

    const users = await context.app.inject({ method: 'GET', url: '/api/v1/console/users', headers })
    assert.equal(users.statusCode, 200)
    assert.deepEqual(users.json(), [
      {
        employee_id: '10086', name: '测试管理员', dept: '市场经营部', last_report_at: '2026-08-26T11:30:00.000Z',
        artifacts_count: 2, status: 'ok',
      },
      {
        employee_id: '10010', name: '过期成员', dept: '市场经营部', last_report_at: '2026-07-01T01:00:02.000Z',
        artifacts_count: 1, status: 'stale',
      },
      {
        employee_id: '10000', name: '未上报成员', dept: '产品部', last_report_at: null,
        artifacts_count: 0, status: 'never',
      },
    ])
  } finally {
    await context.app.close()
    context.database.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test('artifact list filters, paginates, and downloads the exact stored bytes', async () => {
  const context = await testContext()
  try {
    const headers = { authorization: `Bearer ${context.adminToken}` }
    const filtered = await context.app.inject({
      method: 'GET',
      url: '/api/v1/console/artifacts?employee_id=10086&project=%E4%BA%A7%E5%93%81%E4%B8%AD%E5%8F%B0&kind=prd&from=2026-08-25T00%3A00%3A00%2B08%3A00&to=2026-08-26T00%3A00%3A00%2B08%3A00&page=1&size=1',
      headers,
    })
    assert.equal(filtered.statusCode, 200, filtered.body)
    assert.equal(filtered.json().total, 1)
    assert.deepEqual(filtered.json().items[0], {
      artifact_id: 'art_new', employee_id: '10086', project: '产品中台', agent: 'product-solution', kind: 'prd',
      filename: '需求方案.md', created_at: '2026-08-25T14:03:22+08:00', size: 17,
      path: 'raw/10086/产品中台/2026-08-25-需求方案.md',
    })

    const page = await context.app.inject({ method: 'GET', url: '/api/v1/console/artifacts?page=2&size=1', headers })
    assert.equal(page.statusCode, 200)
    assert.equal(page.json().total, 3)
    assert.equal(page.json().items[0].artifact_id, 'art_diagram')

    const download = await context.app.inject({ method: 'GET', url: '/api/v1/console/artifacts/art_new/download', headers })
    assert.equal(download.statusCode, 200)
    assert.equal(download.headers['content-type'], 'application/octet-stream')
    assert.match(download.headers['content-disposition'] ?? '', /%E9%9C%80%E6%B1%82%E6%96%B9%E6%A1%88\.md/u)
    assert.equal(createHash('sha256').update(download.rawPayload).digest('hex'), createHash('sha256').update('# 需求方案\n').digest('hex'))

    const missing = await context.app.inject({ method: 'GET', url: '/api/v1/console/artifacts/missing/download', headers })
    assert.equal(missing.statusCode, 400)
    await unlink(context.downloadPath)
    const missingFile = await context.app.inject({ method: 'GET', url: '/api/v1/console/artifacts/art_new/download', headers })
    assert.equal(missingFile.statusCode, 400)
  } finally {
    await context.app.close()
    context.database.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test('telemetry keeps hook and llm series separate for every grouping', async () => {
  const context = await testContext()
  try {
    const headers = { authorization: `Bearer ${context.adminToken}` }
    const byDay = await context.app.inject({ method: 'GET', url: '/api/v1/console/telemetry?event_type=agent&group_by=day', headers })
    assert.equal(byDay.statusCode, 200)
    assert.deepEqual(byDay.json(), { series: [
      { key: '2026-08-25', event_type: 'agent', source: 'hook', count: 1 },
      { key: '2026-08-25', event_type: 'agent', source: 'llm', count: 1 },
    ] })

    const byUser = await context.app.inject({ method: 'GET', url: '/api/v1/console/telemetry?source=hook&group_by=user', headers })
    assert.deepEqual(byUser.json(), { series: [
      { key: '10010', event_type: 'chat', source: 'hook', count: 1 },
      { key: '10086', event_type: 'agent', source: 'hook', count: 1 },
    ] })

    const byTarget = await context.app.inject({ method: 'GET', url: '/api/v1/console/telemetry?group_by=target', headers })
    assert.equal(byTarget.statusCode, 200)
    assert(byTarget.json().series.some((row: { key: string }) => row.key === 'product-solution'))
  } finally {
    await context.app.close()
    context.database.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})

test('console requires admin and rejects invalid contract query values', async () => {
  const context = await testContext()
  try {
    for (const url of [
      '/api/v1/console/overview',
      '/api/v1/console/users',
      '/api/v1/console/artifacts',
      '/api/v1/console/telemetry',
      '/api/v1/console/artifacts/art_new/download',
    ]) {
      const response = await context.app.inject({
        method: 'GET', url, headers: { authorization: `Bearer ${context.memberToken}` },
      })
      assert.equal(response.statusCode, 401)
      assert.equal(response.json().error.code, 'UNAUTHORIZED')
    }

    const headers = { authorization: `Bearer ${context.adminToken}` }
    for (const url of [
      '/api/v1/console/artifacts?page=0',
      '/api/v1/console/artifacts?size=101',
      '/api/v1/console/artifacts?kind=unknown',
      '/api/v1/console/artifacts?from=2026-08-25T00%3A00%3A00',
      '/api/v1/console/artifacts?from=2026-08-26T00%3A00%3A00Z&to=2026-08-25T00%3A00%3A00Z',
      '/api/v1/console/telemetry?source=combined',
      '/api/v1/console/telemetry?group_by=month',
    ]) {
      const response = await context.app.inject({ method: 'GET', url, headers })
      assert.equal(response.statusCode, 400, `${url}: ${response.body}`)
      assert.equal(response.json().error.code, 'VALIDATION')
    }
  } finally {
    await context.app.close()
    context.database.close()
    await rm(context.directory, { recursive: true, force: true })
  }
})
