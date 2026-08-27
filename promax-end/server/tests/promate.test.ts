import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'

import { buildApp } from '../src/app.ts'
import { SqliteArtifactRepository, type ArtifactRecord } from '../src/artifact-repository.ts'
import { ArtifactService } from '../src/artifacts.ts'
import { AuthService, hashPassword } from '../src/auth.ts'
import { SqliteChunkUploadRepository } from '../src/chunk-upload-repository.ts'
import { ChunkUploadService } from '../src/chunk-uploads.ts'
import { SqliteConsoleRepository } from '../src/console-repository.ts'
import { ConsoleService } from '../src/console.ts'
import { parsePromateUserTokens } from '../src/config.ts'
import { openDatabase } from '../src/database.ts'
import { StaticPromateCredentialProvider } from '../src/promate-credentials.ts'
import {
  McpPromateGateway,
  PromateGatewayError,
  type PromateGateway,
  type PromateToolCall,
} from '../src/promate-gateway.ts'
import { SqlitePromateOperationRepository } from '../src/promate-operation-repository.ts'
import { PromateService } from '../src/promate.ts'
import { SqliteRefreshTokenRepository } from '../src/refresh-token-repository.ts'
import { SqliteReportingRepository } from '../src/reporting-repository.ts'
import { ReportingService } from '../src/reporting.ts'
import { SqliteUserRepository } from '../src/user-repository.ts'

const jwtSecret = 'promax-promate-test-secret-is-at-least-32-bytes'
const fixedNow = new Date('2026-08-27T12:00:00.000Z')

class FakePromateGateway implements PromateGateway {
  readonly calls: PromateToolCall[] = []
  private readonly results: Array<unknown | Error> = []

  enqueue(...results: Array<unknown | Error>): void {
    this.results.push(...results)
  }

  async callTool(call: PromateToolCall): Promise<unknown> {
    this.calls.push({ ...call, arguments: { ...call.arguments } })
    const result = this.results.shift()
    if (result === undefined) throw new Error(`No fake Promate result for ${call.tool}`)
    if (result instanceof Error) throw result
    return result
  }
}

interface TestContext {
  app: ReturnType<typeof buildApp>
  database: ReturnType<typeof openDatabase>
  directory: string
  gateway: FakePromateGateway
  operations: SqlitePromateOperationRepository
  artifacts: SqliteArtifactRepository
  promate: PromateService
  adminToken: string
  memberToken: string
  close(): Promise<void>
}

async function testContext(tokens: Readonly<Record<string, string>> = {
  '10086': 'pk-admin-secret',
  '10010': 'pk-member-secret',
}): Promise<TestContext> {
  const directory = await mkdtemp(join(tmpdir(), 'promax-promate-'))
  const database = openDatabase(':memory:')
  const users = new SqliteUserRepository(database)
  const passwordHash = await hashPassword('correct-password')
  users.create({
    employeeId: '10086', name: '脱敏管理员', dept: '市场经营部', role: 'admin', passwordHash,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  users.create({
    employeeId: '10010', name: '脱敏成员', dept: '产品部', role: 'member', passwordHash,
    createdAt: '2026-01-01T00:00:00.000Z',
  })

  const artifacts = new SqliteArtifactRepository(database)
  const records: ArtifactRecord[] = [
    {
      artifactId: 'art_admin_001', employeeId: '10086', project: '演示项目', agent: 'product-solution',
      kind: 'prd', filename: '脱敏需求方案.md', path: 'raw/10086/演示项目/脱敏需求方案.md',
      sha256: '1'.repeat(64), size: 18, createdAt: '2026-08-27T08:00:00+08:00', receivedAt: fixedNow.toISOString(),
    },
    {
      artifactId: 'art_member_001', employeeId: '10010', project: '示例项目', agent: 'research-agent',
      kind: 'other', filename: '虚构调研.md', path: 'raw/10010/示例项目/虚构调研.md',
      sha256: '2'.repeat(64), size: 16, createdAt: '2026-08-27T09:00:00+08:00', receivedAt: fixedNow.toISOString(),
    },
  ]
  for (const record of records) {
    artifacts.create(record)
    const path = join(directory, record.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `fixture:${record.artifactId}`)
  }

  const gateway = new FakePromateGateway()
  const operations = new SqlitePromateOperationRepository(database)
  const promate = new PromateService(
    gateway,
    new StaticPromateCredentialProvider(tokens),
    operations,
    artifacts,
    {
      orgId: 'org-fixture',
      publicBaseUrl: 'https://promax.example.invalid',
      maxAttempts: 4,
      requirementsTool: 'list_requirements',
      now: () => fixedNow,
    },
  )
  const auth = new AuthService(
    users,
    new SqliteRefreshTokenRepository(database),
    jwtSecret,
    3600,
    86400,
    () => fixedNow,
  )
  const artifactService = new ArtifactService(artifacts, join(directory, 'raw'))
  const reporting = new ReportingService(new SqliteReportingRepository(database))
  const consoleService = new ConsoleService(
    new SqliteConsoleRepository(database), artifacts, directory, 14, () => fixedNow,
  )
  const chunkUploads = new ChunkUploadService(
    new SqliteChunkUploadRepository(database), artifacts, artifactService, join(directory, 'uploads'),
  )
  const app = buildApp({ auth, artifacts: artifactService, reporting, console: consoleService, chunkUploads, promate })

  async function login(employeeId: string): Promise<string> {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { employee_id: employeeId, password: 'correct-password' },
    })
    assert.equal(response.statusCode, 200)
    return response.json().access_token as string
  }

  return {
    app,
    database,
    directory,
    gateway,
    operations,
    artifacts,
    promate,
    adminToken: await login('10086'),
    memberToken: await login('10010'),
    async close() {
      await app.close()
      database.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

function authHeaders(token: string, agent = 'product-solution', requestId = 'req-p0-fixture-0001') {
  return {
    authorization: `Bearer ${token}`,
    'x-promax-agent': agent,
    'x-request-id': requestId,
  }
}

function proposal(confirmToken = 'confirm-server-only-secret') {
  return {
    ok: true,
    data: {},
    next: {
      type: 'confirm',
      question: '确认关联虚构产出物吗？',
      instruction: '等待明确确认。',
      confirm_token: confirmToken,
    },
  }
}

function committed(remoteId = 'ART-FIXTURE-001') {
  return {
    ok: true,
    data: {
      artifact_id: remoteId,
      requirement_url: 'https://promate.example.invalid/requirements/REQ-FIXTURE-001',
    },
    next: { type: 'done', question: '关联完成' },
  }
}

test('Promate read routes use AT-derived personal credentials and keep an auditable request id', async () => {
  const context = await testContext()
  try {
    context.gateway.enqueue(
      { ok: true, data: [{ project_id: 'project-fixture', name: '虚构项目', req_count: 2 }] },
      { ok: true, data: [{ requirement_id: 'REQ-FIXTURE-001', title: '虚构需求', version: 'v1', done: false, artifact_count: 0 }] },
      { ok: true, data: [{ id: 'skill-fixture', name: '演示 Skill', version: '1.0.0', author: '示例作者', category: 'research', description: '仅用于测试', updated_at: fixedNow.toISOString() }] },
      { ok: true, data: { id: 'skill-fixture', name: '演示 Skill', version: '1.0.0', files: [{ path: 'SKILL.md', content: '# fixture' }], download_url: 'https://promate.example.invalid/skills/skill-fixture.zip' } },
    )
    const headers = authHeaders(context.adminToken)
    const projects = await context.app.inject({ method: 'GET', url: '/api/v1/promate/projects', headers })
    const requirements = await context.app.inject({
      method: 'GET', url: '/api/v1/promate/requirements?project_id=project-fixture&query=%E8%99%9A%E6%9E%84&include_done=true', headers,
    })
    const skills = await context.app.inject({ method: 'GET', url: '/api/v1/promate/skills?category=research', headers })
    const skill = await context.app.inject({ method: 'GET', url: '/api/v1/promate/skills/skill-fixture', headers })

    for (const response of [projects, requirements, skills, skill]) {
      assert.equal(response.statusCode, 200, response.body)
      assert.equal(response.json().request_id, 'req-p0-fixture-0001')
      assert.equal(response.json().ok, true)
    }
    assert.equal(projects.json().data[0].project_id, 'project-fixture')
    assert.equal(requirements.json().data[0].requirement_id, 'REQ-FIXTURE-001')
    assert.equal(skills.json().data[0].id, 'skill-fixture')
    assert.equal(skill.json().data.files[0].path, 'SKILL.md')

    assert.deepEqual(context.gateway.calls.map(call => call.tool), [
      'my_projects', 'list_requirements', 'list_skills', 'get_skill',
    ])
    assert(context.gateway.calls.every(call => call.token === 'pk-admin-secret'))
    assert(context.gateway.calls.every(call => call.requestId === 'req-p0-fixture-0001'))
    assert.deepEqual(context.gateway.calls[1]?.arguments, {
      project_id: 'project-fixture', query: '虚构', include_done: true,
    })
    const calls = context.database.prepare(`
      SELECT employee_id, org_id, agent, capability, stage, status
      FROM promate_calls ORDER BY id
    `).all()
    assert.equal(calls.length, 4)
    assert(calls.every(row => (row as { employee_id: string }).employee_id === '10086'))
    assert(calls.every(row => (row as { org_id: string }).org_id === 'org-fixture'))
    assert.equal((context.database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 6)
  } finally {
    await context.close()
  }
})

test('artifact propose/commit is server-owned, hides confirm token, and is idempotent', async () => {
  const context = await testContext()
  try {
    context.gateway.enqueue(proposal(), committed())
    const headers = authHeaders(context.adminToken, 'product-solution', 'req-p0-artifact-0001')
    const proposed = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: {
        stage: 'propose', artifact_id: 'art_admin_001', project_id: 'project-fixture',
        requirement_id: 'REQ-FIXTURE-001', type: '需求文档PRD', summary: '脱敏摘要',
      },
    })
    assert.equal(proposed.statusCode, 200, proposed.body)
    assert.equal(proposed.json().data.status, 'proposed')
    assert.equal(proposed.json().data.attempts, 1)
    assert.equal(proposed.json().next.type, 'confirm')
    assert(!proposed.body.includes('confirm-server-only-secret'))
    const stored = context.operations.findByRequestId('req-p0-artifact-0001')
    assert.equal(stored?.confirmToken, 'confirm-server-only-secret')
    assert.deepEqual(context.gateway.calls[0]?.arguments, {
      project_id: 'project-fixture',
      requirement_id: 'REQ-FIXTURE-001',
      type: '需求文档PRD',
      name: '脱敏需求方案.md',
      url: 'https://promax.example.invalid/api/v1/artifacts/art_admin_001/download',
      summary: '脱敏摘要',
      agent: 'product-solution',
    })

    const repeatedProposal = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: {
        stage: 'propose', artifact_id: 'art_admin_001', project_id: 'project-fixture',
        requirement_id: 'REQ-FIXTURE-001', type: '需求文档PRD', summary: '脱敏摘要',
      },
    })
    assert.equal(repeatedProposal.statusCode, 200)
    assert.equal(repeatedProposal.json().data.status, 'proposed')
    assert.equal(context.gateway.calls.length, 1, 'an identical propose retry must not call Promate again')
    const conflictingProposal = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: {
        stage: 'propose', artifact_id: 'art_admin_001', project_id: 'project-fixture',
        requirement_id: 'REQ-FIXTURE-001', type: '需求文档PRD', summary: '被改过的摘要',
      },
    })
    assert.equal(conflictingProposal.statusCode, 409)
    assert.equal(conflictingProposal.json().error.code, 'CONFLICT')

    const committedResponse = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: { stage: 'commit', request_id: 'req-p0-artifact-0001' },
    })
    assert.equal(committedResponse.statusCode, 200, committedResponse.body)
    assert.equal(committedResponse.json().data.status, 'synced')
    assert.equal(committedResponse.json().data.attempts, 2)
    assert.equal(context.gateway.calls[1]?.arguments.confirm_token, 'confirm-server-only-secret')

    const repeated = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: { stage: 'commit', request_id: 'req-p0-artifact-0001' },
    })
    assert.equal(repeated.statusCode, 200)
    assert.equal(repeated.json().data.status, 'synced')
    assert.equal(context.gateway.calls.length, 2, 'a repeated commit must not call Promate again')

    const status = await context.app.inject({
      method: 'GET', url: '/api/v1/promate/operations/req-p0-artifact-0001', headers,
    })
    assert.equal(status.statusCode, 200)
    assert.equal(status.json().data.promate_artifact_id, 'ART-FIXTURE-001')
    assert(!status.body.includes('confirm-server-only-secret'))
    const auditJson = JSON.stringify(context.database.prepare('SELECT * FROM promate_calls').all())
    assert(!auditJson.includes('pk-admin-secret'))
    assert(!auditJson.includes('confirm-server-only-secret'))
  } finally {
    await context.close()
  }
})

test('retryable commit failure persists and a fresh service instance compensates with the same request id', async () => {
  const context = await testContext()
  try {
    context.gateway.enqueue(
      proposal('confirm-retry-secret'),
      new PromateGatewayError('temporary outage', 'PROMATE_HTTP_503', true),
    )
    const headers = authHeaders(context.adminToken, 'product-solution', 'req-p0-retry-0001')
    const proposed = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: {
        stage: 'propose', artifact_id: 'art_admin_001', project_id: 'project-fixture',
        requirement_id: 'REQ-FIXTURE-001', type: '产品方案',
      },
    })
    assert.equal(proposed.statusCode, 200)
    const pending = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: { stage: 'commit', request_id: 'req-p0-retry-0001' },
    })
    assert.equal(pending.statusCode, 202, pending.body)
    assert.equal(pending.json().data.status, 'pending')
    assert.equal(pending.json().data.last_error_code, 'PROMATE_HTTP_503')
    assert.equal(context.operations.findByRequestId('req-p0-retry-0001')?.status, 'pending')
    assert.equal(context.artifacts.findById('art_admin_001')?.artifactId, 'art_admin_001')

    const resumedGateway = new FakePromateGateway()
    resumedGateway.enqueue(committed('ART-AFTER-RESTART'))
    const resumed = new PromateService(
      resumedGateway,
      new StaticPromateCredentialProvider({ '10086': 'pk-admin-secret' }),
      new SqlitePromateOperationRepository(context.database),
      new SqliteArtifactRepository(context.database),
      {
        orgId: 'org-fixture', publicBaseUrl: 'https://promax.example.invalid', maxAttempts: 4,
        requirementsTool: 'list_requirements', now: () => fixedNow,
      },
    )
    await resumed.retryPending()
    const synced = context.operations.findByRequestId('req-p0-retry-0001')
    assert.equal(synced?.status, 'synced')
    assert.equal(synced?.attempts, 3)
    assert.equal(synced?.promateArtifactId, 'ART-AFTER-RESTART')
    assert.equal(resumedGateway.calls[0]?.requestId, 'req-p0-retry-0001')
    assert.equal(resumedGateway.calls[0]?.arguments.confirm_token, 'confirm-retry-secret')
    const statuses = context.database.prepare(`
      SELECT status FROM promate_calls WHERE request_id = ? ORDER BY id
    `).all('req-p0-retry-0001').map(row => (row as { status: string }).status)
    assert.deepEqual(statuses, ['success', 'pending', 'success'])
  } finally {
    await context.close()
  }
})

test('non-retryable failures become dead and invalid upstream reads become 503', async () => {
  const context = await testContext()
  try {
    context.gateway.enqueue(
      proposal(),
      new PromateGatewayError('credential rejected', 'PROMATE_CREDENTIAL_REJECTED', false),
      { ok: true, data: { invalid: true } },
    )
    const headers = authHeaders(context.adminToken, 'product-solution', 'req-p0-dead-0001')
    await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: {
        stage: 'propose', artifact_id: 'art_admin_001', project_id: 'project-fixture',
        requirement_id: 'REQ-FIXTURE-001', type: '技术方案',
      },
    })
    const dead = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: { stage: 'commit', request_id: 'req-p0-dead-0001' },
    })
    assert.equal(dead.statusCode, 200)
    assert.equal(dead.json().ok, false)
    assert.equal(dead.json().data.status, 'dead')
    assert.equal(dead.json().data.last_error_code, 'PROMATE_CREDENTIAL_REJECTED')

    const malformed = await context.app.inject({
      method: 'GET', url: '/api/v1/promate/projects',
      headers: authHeaders(context.adminToken, 'product-solution', 'req-p0-read-bad1'),
    })
    assert.equal(malformed.statusCode, 503, malformed.body)
    assert.equal(malformed.json().error.code, 'UPSTREAM_UNAVAILABLE')
    assert.equal(malformed.json().error.detail.upstream_code, 'PROMATE_PROTOCOL_ERROR')
  } finally {
    await context.close()
  }
})

test('proposal read retries do not consume the separate commit compensation budget', async () => {
  const context = await testContext()
  try {
    context.gateway.enqueue(
      new PromateGatewayError('temporary outage', 'PROMATE_HTTP_503', true),
      new PromateGatewayError('temporary outage', 'PROMATE_HTTP_503', true),
      new PromateGatewayError('temporary outage', 'PROMATE_HTTP_503', true),
      proposal(),
      committed('ART-AFTER-PROPOSE-RETRIES'),
    )
    const headers = authHeaders(context.adminToken, 'product-solution', 'req-p0-budget-0001')
    const proposed = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: {
        stage: 'propose', artifact_id: 'art_admin_001', project_id: 'project-fixture',
        requirement_id: 'REQ-FIXTURE-001', type: '产品方案',
      },
    })
    assert.equal(proposed.statusCode, 200, proposed.body)
    assert.equal(proposed.json().data.attempts, 4)
    assert.equal(context.operations.findByRequestId('req-p0-budget-0001')?.commitAttempts, 0)
    const result = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts', headers,
      payload: { stage: 'commit', request_id: 'req-p0-budget-0001' },
    })
    assert.equal(result.statusCode, 200, result.body)
    assert.equal(result.json().data.status, 'synced')
    assert.equal(result.json().data.attempts, 5)
    assert.equal(context.operations.findByRequestId('req-p0-budget-0001')?.commitAttempts, 1)
  } finally {
    await context.close()
  }
})

test('Promate endpoints enforce employee ownership, agent binding, headers, and credential presence', async () => {
  const context = await testContext({ '10086': 'pk-admin-secret' })
  try {
    const noAgent = await context.app.inject({
      method: 'GET', url: '/api/v1/promate/projects',
      headers: { authorization: `Bearer ${context.adminToken}` },
    })
    assert.equal(noAgent.statusCode, 400)
    assert.equal(noAgent.json().error.code, 'VALIDATION')

    const missingCredential = await context.app.inject({
      method: 'GET', url: '/api/v1/promate/projects',
      headers: authHeaders(context.memberToken, 'research-agent', 'req-p0-member-0001'),
    })
    assert.equal(missingCredential.statusCode, 503)
    assert.equal(missingCredential.json().error.detail.upstream_code, 'PROMATE_CREDENTIAL_MISSING')
    assert(!missingCredential.body.includes('pk-admin-secret'))

    const otherArtifact = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts',
      headers: authHeaders(context.memberToken, 'research-agent', 'req-p0-member-0002'),
      payload: {
        stage: 'propose', artifact_id: 'art_admin_001', project_id: 'project-fixture',
        requirement_id: 'REQ-FIXTURE-001', type: '调研报告',
      },
    })
    assert.equal(otherArtifact.statusCode, 401)

    context.gateway.enqueue(proposal())
    const boundProposal = await context.app.inject({
      method: 'POST', url: '/api/v1/promate/artifacts',
      headers: authHeaders(context.adminToken, 'product-solution', 'req-p0-binding-0001'),
      payload: {
        stage: 'propose', artifact_id: 'art_admin_001', project_id: 'project-fixture',
        requirement_id: 'REQ-FIXTURE-001', type: '产品方案',
      },
    })
    assert.equal(boundProposal.statusCode, 200)
    const wrongAgent = await context.app.inject({
      method: 'GET', url: '/api/v1/promate/operations/req-p0-binding-0001',
      headers: authHeaders(context.adminToken, 'another-agent', 'req-p0-status-0001'),
    })
    assert.equal(wrongAgent.statusCode, 409)
    assert.equal(wrongAgent.json().error.code, 'CONFLICT')

    const ownDownload = await context.app.inject({
      method: 'GET', url: '/api/v1/artifacts/art_member_001/download',
      headers: { authorization: `Bearer ${context.memberToken}` },
    })
    assert.equal(ownDownload.statusCode, 200)
    assert.equal(ownDownload.rawPayload.toString(), 'fixture:art_member_001')
    const forbiddenDownload = await context.app.inject({
      method: 'GET', url: '/api/v1/artifacts/art_admin_001/download',
      headers: { authorization: `Bearer ${context.memberToken}` },
    })
    assert.equal(forbiddenDownload.statusCode, 401)
  } finally {
    await context.close()
  }
})

test('MCP gateway sends only the personal Bearer key and stable Promax request id', async () => {
  const exchanges: Array<{
    method: string
    headers: IncomingMessage['headers']
    payload?: Record<string, unknown>
  }> = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8')
    const payload = body.length === 0 ? undefined : JSON.parse(body) as Record<string, unknown>
    exchanges.push({ method: request.method ?? '', headers: request.headers, ...(payload === undefined ? {} : { payload }) })

    if (request.method === 'DELETE') {
      response.writeHead(204).end()
      return
    }
    if (payload?.method === 'initialize') {
      response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'session-fixture' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } }))
      return
    }
    if (payload?.method === 'notifications/initialized') {
      response.writeHead(202).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    const toolData = { ok: true, data: [{ project_id: 'fixture' }] }
    response.end(JSON.stringify({
      jsonrpc: '2.0', id: payload?.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(toolData) }],
        structuredContent: { result: JSON.stringify(toolData) },
      },
    }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address() as AddressInfo
    const gateway = new McpPromateGateway(`http://127.0.0.1:${address.port}/mcp`, 2_000)
    const result = await gateway.callTool({
      token: 'pk-personal-fixture', requestId: 'req-p0-mcp-0001', tool: 'my_projects', arguments: {},
    })
    assert.deepEqual(result, { ok: true, data: [{ project_id: 'fixture' }] })
    assert.deepEqual(exchanges.map(exchange => exchange.method), ['POST', 'POST', 'POST', 'DELETE'])
    assert(exchanges.every(exchange => exchange.headers.authorization === 'Bearer pk-personal-fixture'))
    assert(exchanges.every(exchange => exchange.headers['x-promax-request-id'] === 'req-p0-mcp-0001'))
    assert(exchanges.every(exchange => exchange.headers['x-promate-user'] === undefined))
    assert.equal(exchanges[1]?.headers['mcp-session-id'], 'session-fixture')
    assert.equal(exchanges[2]?.headers['mcp-session-id'], 'session-fixture')
    assert.equal(exchanges[3]?.headers['mcp-session-id'], 'session-fixture')
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('personal credential configuration rejects inherited or malformed employee ids without echoing secrets', () => {
  const tokens = parsePromateUserTokens('{"10086":"pk-fixture"}')
  assert.equal(tokens['10086'], 'pk-fixture')
  assert.equal(Object.getPrototypeOf(tokens), null)
  assert(Object.isFrozen(tokens))
  const provider = new StaticPromateCredentialProvider({ '10086': 'pk-fixture' })
  assert.equal(provider.tokenFor('10086'), 'pk-fixture')
  assert.equal(provider.tokenFor('toString'), undefined)
  for (const invalid of [
    '{"../10086":"pk-do-not-echo"}',
    '{"10086":""}',
    '["pk-do-not-echo"]',
    'not-json-pk-do-not-echo',
  ]) {
    assert.throws(
      () => parsePromateUserTokens(invalid),
      error => error instanceof Error && !error.message.includes('pk-do-not-echo'),
    )
  }
})
