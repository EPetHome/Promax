import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'

import { SqliteArtifactRepository } from '../../../server/src/artifact-repository.ts'
import { ArtifactService } from '../../../server/src/artifacts.ts'
import { AuthService, hashPassword } from '../../../server/src/auth.ts'
import { buildApp } from '../../../server/src/app.ts'
import { SqliteChunkUploadRepository } from '../../../server/src/chunk-upload-repository.ts'
import { ChunkUploadService } from '../../../server/src/chunk-uploads.ts'
import { SqliteConsoleRepository } from '../../../server/src/console-repository.ts'
import { ConsoleService } from '../../../server/src/console.ts'
import { openDatabase } from '../../../server/src/database.ts'
import { RawGitBatcher } from '../../../server/src/raw-git.ts'
import { SqliteRefreshTokenRepository } from '../../../server/src/refresh-token-repository.ts'
import { SqliteReportingRepository } from '../../../server/src/reporting-repository.ts'
import { ReportingService } from '../../../server/src/reporting.ts'
import { SqliteUserRepository } from '../../../server/src/user-repository.ts'

const secret = 'promax-cp1-secret-that-is-at-least-32-bytes'

test('CP1: 2-second AT auto-refreshes while native hook persists and deduplicates an artifact', async (testContext) => {
  const root = await mkdtemp(join(tmpdir(), 'promax-cp1-'))
  const data = join(root, 'server-data')
  const raw = join(data, 'raw')
  const dshHome = join(root, 'dsh-home')
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })

  const database = openDatabase(join(data, 'promax.db'))
  const users = new SqliteUserRepository(database)
  users.create({
    employeeId: '10086',
    name: 'CP1 脱敏用户',
    dept: '市场经营部',
    role: 'admin',
    passwordHash: await hashPassword('correct-password'),
    createdAt: '2026-08-26T00:00:00Z',
  })
  const artifactRepository = new SqliteArtifactRepository(database)
  const rawGit = new RawGitBatcher(raw, { batchSize: 100, intervalMs: 24 * 60 * 60 * 1000 })
  await rawGit.start()
  const artifacts = new ArtifactService(
    artifactRepository,
    raw,
    undefined,
    undefined,
    () => rawGit.noteArtifact(),
  )
  const reporting = new ReportingService(new SqliteReportingRepository(database))
  const consoleService = new ConsoleService(
    new SqliteConsoleRepository(database),
    artifactRepository,
    data,
    14,
  )
  const chunkUploads = new ChunkUploadService(
    new SqliteChunkUploadRepository(database),
    artifactRepository,
    artifacts,
    join(data, 'uploads'),
  )
  const auth = new AuthService(users, new SqliteRefreshTokenRepository(database), secret, 2, 30 * 24 * 60 * 60)
  const app = buildApp({ auth, artifacts, reporting, console: consoleService, chunkUploads })
  const artifactResponses: Array<{ status: number; body: Record<string, unknown> }> = []
  let storedPath = ''
  let storedSha256 = ''
  let hookTelemetryCount = 0
  let refreshCount = 0
  let expiredArtifactRequests = 0
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.method === 'POST' && request.url === '/api/v1/artifacts') {
      if (reply.statusCode === 401) expiredArtifactRequests += 1
      if (reply.statusCode >= 200 && reply.statusCode < 300) {
        artifactResponses.push({ status: reply.statusCode, body: JSON.parse(String(payload)) as Record<string, unknown> })
      }
    }
    if (request.method === 'POST' && request.url === '/api/v1/auth/refresh' && reply.statusCode === 200) {
      refreshCount += 1
    }
    return payload
  })
  app.addHook('onClose', async () => {
    try {
      await rawGit.close()
    } finally {
      database.close()
    }
  })

  let firstClient: Context | undefined
  let restartedClient: Context | undefined
  try {
    const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 })
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ employee_id: '10086', password: 'correct-password' }),
    })
    assert.equal(login.status, 200)
    const credentials = await login.json() as { access_token: string; refresh_token: string }

    const file = join(workspace, 'CP1-脱敏需求.md')
    const content = '# CP1 脱敏需求\n\n用于验证原生 hook 上报闭环。\n'
    await writeFile(file, content)

    firstClient = await activateClient({
      baseUrl,
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token,
      dshHome,
      workspace,
    })
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2_100))
    publishWriteResult(firstClient, file, 'cp1-session-first')
    await waitFor(() => artifactResponses.length === 1)
    await firstClient.fiber.dispose()
    firstClient = undefined

    restartedClient = await activateClient({
      baseUrl,
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token,
      dshHome,
      workspace,
    })
    await new Promise(resolvePromise => setTimeout(resolvePromise, 2_100))
    publishWriteResult(restartedClient, file, 'cp1-session-restarted')
    await waitFor(() => artifactResponses.length === 2)
    await restartedClient.fiber.dispose()
    restartedClient = undefined

    assert.equal(artifactResponses[0]?.status, 201)
    assert.equal(artifactResponses[1]?.status, 200)
    assert.deepEqual(artifactResponses[1]?.body, {
      artifact_id: artifactResponses[0]?.body.artifact_id,
      duplicate: true,
    })

    const rows = database.prepare(`
      SELECT artifact_id, employee_id, project, agent, filename, path, sha256, size
      FROM artifacts
    `).all() as Array<Record<string, unknown>>
    assert.equal(rows.length, 1)
    const row = rows[0]
    assert(row)
    assert.equal(row.employee_id, '10086')
    assert.equal(row.project, '产品中台')
    assert.equal(row.agent, 'product-solution')
    assert.equal(row.filename, 'CP1-脱敏需求.md')
    assert.match(String(row.path), /^raw\/10086\/产品中台\/\d{4}-\d{2}-\d{2}-CP1-脱敏需求\.md$/u)
    assert.equal(row.sha256, createHash('sha256').update(content).digest('hex'))
    assert.equal(row.size, Buffer.byteLength(content))
    assert.equal(await readFile(join(data, String(row.path)), 'utf8'), content)

    const telemetry = database.prepare(`
      SELECT source, event_type, target, status, output_files
      FROM telemetry ORDER BY occurred_at
    `).all() as Array<Record<string, unknown>>
    assert.equal(telemetry.length, 2)
    assert(telemetry.every(event => event.source === 'hook'))
    assert(telemetry.every(event => event.event_type === 'agent'))
    assert(telemetry.every(event => event.target === 'product-solution'))
    assert(telemetry.every(event => event.status === 'success'))
    assert(telemetry.every(event => event.output_files === '["CP1-脱敏需求.md"]'))
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM heartbeats').get()?.count, 1)
    assert.equal(refreshCount, 2)
    assert.equal(expiredArtifactRequests, 2)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM refresh_tokens WHERE revoked_at IS NULL').get()?.count, 1)
    const deadFiles = (await readdir(join(dshHome, 'promax', 'outbox', 'dead'))).filter(name => name.endsWith('.jsonl'))
    assert.deepEqual(deadFiles, [])
    const storedCredentials = JSON.parse(await readFile(join(dshHome, 'promax', 'auth.json'), 'utf8')) as Record<string, unknown>
    assert.notEqual(storedCredentials.refresh_token, credentials.refresh_token)
    storedPath = String(row.path)
    storedSha256 = String(row.sha256)
    hookTelemetryCount = telemetry.length
  } finally {
    if (firstClient) await firstClient.fiber.dispose()
    if (restartedClient) await restartedClient.fiber.dispose()
    await app.close()
  }

  try {
    const { stdout: commits } = await run('git', ['-C', raw, 'rev-list', '--count', 'HEAD'])
    const { stdout: tracked } = await run('git', ['-C', raw, '-c', 'core.quotepath=false', 'ls-files'])
    const { stdout: status } = await run('git', ['-C', raw, 'status', '--short'])
    assert.equal(commits.trim(), '1')
    assert.match(tracked, /^10086\/产品中台\/\d{4}-\d{2}-\d{2}-CP1-脱敏需求\.md\n$/u)
    assert.equal(status, '')
    testContext.diagnostic(JSON.stringify({
      first_status: artifactResponses[0]?.status,
      duplicate_status: artifactResponses[1]?.status,
      duplicate: artifactResponses[1]?.body.duplicate,
      raw_path: storedPath,
      sha256: storedSha256,
      db_artifacts: 1,
      hook_telemetry: hookTelemetryCount,
      auto_refreshes: refreshCount,
      expired_artifact_401s: expiredArtifactRequests,
      dead_letters: 0,
      raw_git_commits: Number(commits.trim()),
      raw_git_clean: status.length === 0,
    }))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function activateClient(options: {
  baseUrl: string
  accessToken: string
  refreshToken: string
  dshHome: string
  workspace: string
}): Promise<Context> {
  const context = new Context()
  const builtPath = resolve('packages/promax-report/lib/index.js')
  const plugin = await import(pathToFileURL(builtPath).href)
  await context.plugin(Loader)
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier !== '@promax/promax-report') throw new Error(`unexpected plugin: ${specifier}`)
      return plugin
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: '@promax/promax-report',
    config: {
      baseUrl: options.baseUrl,
      accessToken: options.accessToken,
      refreshToken: options.refreshToken,
      employeeId: '10086',
      project: '产品中台',
      dshHome: options.dshHome,
      artifactRoots: [options.workspace],
    },
  })
  await context.loader.await()
  const entry = [...context.loader.entries()].find(candidate => candidate.options.name === '@promax/promax-report')
  assert(entry?.fiber, 'promax-report must activate through the real Loader')
  return context
}

function publishWriteResult(context: Context, file: string, sessionId: string): void {
  const agent = {
    id: sessionId,
    session: {
      id: sessionId,
      header: { cwd: join(file, '..'), agentPreset: 'product-solution' },
      events: [],
    },
  }
  context.emit('tools/result', {
    callId: `call-${sessionId}`,
    rootCallId: `call-${sessionId}`,
    token: Symbol(sessionId),
    name: 'write',
    arguments: { file_path: file },
    agent,
    signal: new AbortController().signal,
  } as never, {
    content: [{ type: 'text', text: 'created' }],
    isError: false,
    value: { path: file, operation: 'create', before: null, after: 'created' },
  } as never)
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for CP1 request')
    await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
  }
}

async function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  return promisify(execFile)(command, args)
}
