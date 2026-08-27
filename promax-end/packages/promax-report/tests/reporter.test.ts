import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { resolveConfig } from '../src/config.ts'
import { DurableReportQueue, type ReportLogger } from '../src/outbox.ts'
import {
  artifactKind,
  extractMutationPath,
  PromaxReporter,
  resolveAgentPreset,
  type AgentLike,
} from '../src/reporter.ts'
import type { ReportRequest, ReportTransport } from '../src/transport.ts'

class RecordingTransport implements ReportTransport {
  readonly requests: ReportRequest[] = []
  async deliver(request: ReportRequest) {
    this.requests.push(request.filePath === undefined ? structuredClone(request) : request)
    return { kind: 'success' as const, status: request.path === '/api/v1/artifacts' ? 201 : 202 }
  }
}

const logger: ReportLogger = { debug() {}, warn() {} }

function agent(cwd: string): AgentLike {
  return {
    id: 'session-1',
    session: {
      id: 'session-1',
      header: { cwd, agentPreset: 'old-preset' },
      events: [{ type: 'agent-preset/selected', data: { agentPreset: 'product-solution' } }],
    },
  }
}

test('native file-tool result uploads bytes and emits a separate hook telemetry event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promax-reporter-'))
  const home = join(root, 'dsh-home')
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  try {
    const file = join(workspace, '需求方案.md')
    await writeFile(file, '# 需求方案\n')
    const transport = new RecordingTransport()
    const queue = new DurableReportQueue(home, transport, logger)
    const reporter = new PromaxReporter(resolveConfig({
      baseUrl: 'http://127.0.0.1:3000',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      employeeId: '10086',
      project: '产品中台',
      dshHome: home,
    }), queue, () => `sha256:${'a'.repeat(64)}`, logger)
    const subject = agent(workspace)

    reporter.recordToolResult({ name: 'write', arguments: { file_path: file }, agent: subject }, {
      isError: false,
      value: { path: file, operation: 'create', before: null, after: '# 需求方案\n' },
    })
    await reporter.idle()

    assert.equal(transport.requests.length, 2)
    assert.equal(transport.requests[0]?.path, '/api/v1/artifacts')
    const artifact = transport.requests[0]?.body as Record<string, unknown>
    assert.equal(artifact.employee_id, '10086')
    assert.equal(artifact.project, '产品中台')
    assert.equal(artifact.agent, 'product-solution')
    assert.equal(artifact.kind, 'prd')
    assert.equal(artifact.filename, '需求方案.md')
    assert.equal(Buffer.from(String(artifact.content), 'base64').toString('utf8'), '# 需求方案\n')

    assert.equal(transport.requests[1]?.path, '/api/v1/telemetry')
    assert.deepEqual(transport.requests[1]?.body, {
      employee_id: '10086',
      event_type: 'agent',
      target: 'product-solution',
      source: 'hook',
      session_id: 'session-1',
      occurred_at: (transport.requests[1]?.body as { occurred_at: string }).occurred_at,
      output_files: ['需求方案.md'],
      status: 'success',
    })

    reporter.recordToolResult({ name: 'edit', arguments: {}, agent: subject }, {
      isError: false,
      value: { path: file, before: '# 需求方案\n', after: '# 需求方案\n' },
    })
    await reporter.idle()
    assert.equal(transport.requests.length, 2, 'unchanged sha must not be re-reported in one client run')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('artifact above 5MB uses a durable file snapshot and chunk transport request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promax-reporter-large-'))
  const home = join(root, 'dsh-home')
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  try {
    const file = join(workspace, 'large.zip')
    const content = Buffer.alloc(5 * 1024 * 1024 + 1, 0x6b)
    await writeFile(file, content)
    const transport = new RecordingTransport()
    const queue = new DurableReportQueue(home, transport, logger)
    const reporter = new PromaxReporter(resolveConfig({
      baseUrl: 'http://127.0.0.1:3000', accessToken: 'access-token', refreshToken: 'refresh-token', employeeId: '10086', dshHome: home,
    }), queue, () => `sha256:${'c'.repeat(64)}`, logger)

    reporter.recordToolResult({ name: 'write', arguments: { file_path: file }, agent: agent(workspace) }, {
      isError: false, value: { path: file },
    })
    await reporter.idle()

    const artifact = transport.requests[0]
    assert.equal(artifact?.path, '/api/v1/artifacts')
    assert(artifact?.filePath)
    assert.equal((artifact.body as { size: number }).size, content.byteLength)
    assert.equal((artifact.body as { sha256: string }).sha256, createHash('sha256').update(content).digest('hex'))
    assert.equal(transport.requests[1]?.path, '/api/v1/telemetry')
    assert.deepEqual(await readdir(queue.blobDirectory), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('chat, skill, heartbeat, failed mutation, and turn-end scanning stay on hook source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promax-reporter-events-'))
  const home = join(root, 'dsh-home')
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  try {
    const transport = new RecordingTransport()
    const queue = new DurableReportQueue(home, transport, logger)
    const reporter = new PromaxReporter(resolveConfig({
      baseUrl: 'http://127.0.0.1:3000', accessToken: 'access-token', refreshToken: 'refresh-token', employeeId: '10086', dshHome: home,
    }), queue, () => `sha256:${'b'.repeat(64)}`, logger)
    const subject = agent(workspace)
    reporter.startSession(subject)
    reporter.recordChat(subject)
    reporter.recordToolResult({ name: 'skill', arguments: { name: 'prd-document-generator' }, agent: subject }, { isError: false })
    reporter.recordToolResult({ name: 'write', arguments: {}, agent: subject }, { isError: true })
    reporter.heartbeat()
    await writeFile(join(workspace, 'shell-output.html'), '<main>prototype</main>')
    reporter.scanTurnArtifacts(subject)
    await reporter.idle()

    const telemetry = transport.requests.filter(request => request.path === '/api/v1/telemetry').map(request => request.body as Record<string, unknown>)
    assert.deepEqual(telemetry.map(row => [row.event_type, row.target, row.status]), [
      ['chat', '-', 'success'],
      ['skill', 'prd-document-generator', 'success'],
      ['agent', 'product-solution', 'failed'],
      ['agent', 'product-solution', 'success'],
    ])
    assert(telemetry.every(row => row.source === 'hook'))
    assert.equal(transport.requests.filter(request => request.path === '/api/v1/artifacts').length, 1)
    const heartbeat = transport.requests.find(request => request.path === '/api/v1/heartbeat')?.body as Record<string, unknown>
    assert.equal(heartbeat.client_version, '0.1.0')
    assert.equal(heartbeat.dsh_version, '0.1.1-rc.2')
    assert.equal(heartbeat.config_fingerprint, `sha256:${'b'.repeat(64)}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('tool extraction and artifact classification follow locked dsh tool shapes', () => {
  assert.equal(extractMutationPath({ name: 'write', arguments: {} }, { isError: false, value: { path: 'a.md' } }), 'a.md')
  assert.equal(extractMutationPath({ name: 'str_replace_editor', arguments: { command: 'insert', path: '/a.md' } }, { isError: false }), '/a.md')
  assert.equal(extractMutationPath({ name: 'str_replace_editor', arguments: { command: 'view', path: '/a.md' } }, { isError: false }), undefined)
  assert.equal(extractMutationPath({ name: 'write', arguments: {} }, { isError: true }), undefined)
  assert.equal(artifactKind('flow.drawio'), 'diagram')
  assert.equal(artifactKind('prototype.html'), 'prototype')
  assert.equal(artifactKind('requirements.docx'), 'prd')
  assert.equal(artifactKind('metrics.csv'), 'other')
  assert.equal(resolveAgentPreset(agent('/tmp').session), 'product-solution')
})
