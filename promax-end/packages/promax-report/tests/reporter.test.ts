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
import { loadTeamRevisionArtifactCatalog } from '../src/team-revision-artifacts.ts'

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

async function installTeamRevision(home: string): Promise<void> {
  const directory = join(home, '.agent-presets', 'product-solution')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'team-revision.yml'), `kind: TeamRevision
spec:
  preset_id: product-solution
  artifacts:
    - kind: other
      relative_path: deliverables/{task_key}/customer_research.md
      produced_by: customer_research
    - kind: prd
      relative_path: deliverables/{task_key}/prd.md
      produced_by: solution_design
    - kind: diagram
      relative_path: deliverables/{task_key}/business-diagram.md
      produced_by: solution_design
    - kind: prototype
      relative_path: deliverables/{task_key}/prototype.html
      produced_by: solution_design
    - kind: judge-report
      relative_path: .promax/judge/{task_key}/judge.md
      produced_by: quality_judge
`)
}

test('TeamRevision 无效、重复或歧义声明都报错，不静默走扩展名兜底', async () => {
  for (const [name, artifacts, expected] of [
    ['invalid', `    - kind: spreadsheet\n      relative_path: deliverables/{task_key}/result.md\n      produced_by: worker`, /unsupported external artifact kind/u],
    ['duplicate', `    - kind: prd\n      relative_path: deliverables/{task_key}/result.md\n      produced_by: worker\n    - kind: prd\n      relative_path: deliverables/{task_key}/result.md\n      produced_by: worker`, /declares artifact path twice/u],
  ] as const) {
    const home = await mkdtemp(join(tmpdir(), `promax-reporter-${name}-`))
    const directory = join(home, '.agent-presets', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'team-revision.yml'), `kind: TeamRevision\nspec:\n  preset_id: ${name}\n  artifacts:\n${artifacts}\n`)
    try {
      await assert.rejects(() => loadTeamRevisionArtifactCatalog(home, name), expected)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  }

  const home = await mkdtemp(join(tmpdir(), 'promax-reporter-ambiguous-'))
  const directory = join(home, '.agent-presets', 'ambiguous')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'team-revision.yml'), `kind: TeamRevision
spec:
  preset_id: ambiguous
  artifacts:
    - kind: prd
      relative_path: deliverables/{task_key}/prd.md
      produced_by: worker_a
    - kind: diagram
      relative_path: deliverables/task-1/{task_key}
      produced_by: worker_b
`)
  try {
    const catalog = await loadTeamRevisionArtifactCatalog(home, 'ambiguous')
    assert(catalog)
    assert.throws(() => catalog.kindFor('deliverables/task-1/prd.md'), /ambiguous artifact declarations/u)
  } finally {
    await rm(home, { recursive: true, force: true })
  }

  const sameKindHome = await mkdtemp(join(tmpdir(), 'promax-reporter-same-kind-ambiguous-'))
  const sameKindDirectory = join(sameKindHome, '.agent-presets', 'same-kind-ambiguous')
  await mkdir(sameKindDirectory, { recursive: true })
  await writeFile(join(sameKindDirectory, 'team-revision.yml'), `kind: TeamRevision
spec:
  preset_id: same-kind-ambiguous
  artifacts:
    - kind: prd
      relative_path: deliverables/{task_key}/result.md
      produced_by: worker
    - kind: prd
      relative_path: deliverables/task-1/{task_key}
      produced_by: worker
`)
  try {
    const catalog = await loadTeamRevisionArtifactCatalog(sameKindHome, 'same-kind-ambiguous')
    assert(catalog)
    assert.throws(() => catalog.kindFor('deliverables/task-1/result.md'), /ambiguous artifact declarations/u)
    assert.throws(() => catalog.producerFor('deliverables/task-1/result.md'), /ambiguous artifact producers/u)
  } finally {
    await rm(sameKindHome, { recursive: true, force: true })
  }
})

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

test('TeamRevision declarations classify artifacts, exclude Judge, and use extension fallback only when unmatched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promax-reporter-team-revision-'))
  const home = join(root, 'dsh-home')
  const workspace = join(root, 'workspace')
  const deliverables = join(workspace, 'deliverables', 'task-1')
  const judge = join(workspace, '.promax', 'judge', 'task-1')
  const frozenInput = join(workspace, '.promax', 'input', 'task-1', 'sources', 'SRC-001')
  const sessionScopes = join(workspace, '.promax', 'session-scopes')
  const taskRoot = join(workspace, '.promax', 'tasks', 'task-1')
  await mkdir(deliverables, { recursive: true })
  await mkdir(judge, { recursive: true })
  await mkdir(frozenInput, { recursive: true })
  await mkdir(sessionScopes, { recursive: true })
  await mkdir(taskRoot, { recursive: true })
  await installTeamRevision(home)
  try {
    const transport = new RecordingTransport()
    const queue = new DurableReportQueue(home, transport, logger)
    const reporter = new PromaxReporter(resolveConfig({
      baseUrl: 'http://127.0.0.1:3000', accessToken: 'access-token', refreshToken: 'refresh-token', employeeId: '10086', dshHome: home,
    }), queue, () => `sha256:${'d'.repeat(64)}`, logger)
    const subject = agent(workspace)
    const worker = { ...subject, id: 'worker-child-session', session: { ...subject.session, id: 'worker-child-session' } }
    reporter.startSession(subject)
    reporter.startSession(worker)

    await writeFile(join(sessionScopes, 'parent-session.json'), JSON.stringify({ sessionId: 'parent-session', sessionName: 'task-1', taskKey: 'task-1' }))

    await writeFile(join(taskRoot, 'slots.yml'), JSON.stringify({
      api_version: 'promax.ai/v1alpha2', kind: 'TaskSlots',
      metadata: { task_key: 'task-1', team_revision_id: 'team-demo@r1', coverage_revision: 1, computed_at: '2026-08-31T12:00:00.000Z' },
      spec: { tier: 'team', slots: [
        { slot_id: 'solution_design', member_id: 'solution_design', label: '方案设计', status: 'pending', provides: ['scope'], requires: ['goal'], satisfied_by: [], missing: [] },
        { slot_id: 'customer_research', member_id: 'customer_research', label: '客研', status: 'pending', provides: ['target_user'], requires: ['goal'], satisfied_by: [], missing: [] },
      ] },
    }))

    await writeFile(join(deliverables, 'prd.md'), '# PRD\n')
    await writeFile(join(deliverables, 'business-diagram.md'), '# Diagram\n')
    await writeFile(join(deliverables, 'prototype.html'), '<main>Prototype</main>')
    await writeFile(join(deliverables, 'customer_research.md'), '# Research\n')
    await writeFile(join(deliverables, 'undeclared.md'), '# Undeclared\n')
    await writeFile(join(judge, 'judge.md'), '# Judge\n')
    await writeFile(join(frozenInput, 'confirmed-handoff.md'), '# Frozen input, not an artifact\n')

    reporter.scanTurnArtifacts(worker)
    await reporter.idle()

    const artifacts = transport.requests
      .filter(request => request.path === '/api/v1/artifacts')
      .map(request => request.body as Record<string, unknown>)
    assert.deepEqual(
      artifacts.map(artifact => [artifact.filename, artifact.kind]).sort(([left], [right]) => String(left).localeCompare(String(right))),
      [
        ['business-diagram.md', 'diagram'],
        ['customer_research.md', 'other'],
        ['prd.md', 'prd'],
        ['prototype.html', 'prototype'],
        ['undeclared.md', 'prd'],
      ],
    )
    assert.equal(transport.requests.filter(request => request.path === '/api/v1/telemetry').length, 5)
    const taskStates = transport.requests.filter(request => request.path === '/api/v1/task-state')
    assert(taskStates.length >= 2)
    const latest = taskStates.at(-1)?.body as { session_id: string, slots: Array<{ member_id: string, status: string }> }
    assert.equal(latest.session_id, 'parent-session')
    assert.deepEqual(latest.slots.map(slot => [slot.member_id, slot.status]), [
      ['solution_design', 'produced'],
      ['customer_research', 'produced'],
    ])
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
    reporter.recordDecisionForSession(subject.id, 'handoff.confirm', { task_key: 'public-demo', revision: 1 })
    reporter.recordTaskState({
      project: '脱敏演示',
      session_id: subject.id,
      task_key: 'public-demo',
      tier: 'single',
      coverage_revision: 1,
      updated_at: '2026-08-31T12:00:00.000Z',
      slots: [{
        slot_id: 'solution_design', member_id: 'solution_design', label: '方案设计', status: 'pending',
        provides: ['scope'], requires: ['goal'], satisfied_by: [], missing: [],
      }],
    })
    reporter.recordToolResult({ name: 'skill', arguments: { name: 'prd-document-generator' }, agent: subject }, { isError: false })
    reporter.recordToolResult({ name: 'write', arguments: {}, agent: subject }, { isError: true })
    reporter.heartbeat()
    await writeFile(join(workspace, 'shell-output.html'), '<main>prototype</main>')
    reporter.scanTurnArtifacts(subject)
    await reporter.idle()

    const telemetry = transport.requests.filter(request => request.path === '/api/v1/telemetry').map(request => request.body as Record<string, unknown>)
    assert.deepEqual(telemetry.map(row => [row.event_type, row.target, row.status]), [
      ['chat', '-', 'success'],
      ['decision', 'handoff.confirm', 'success'],
      ['skill', 'prd-document-generator', 'success'],
      ['agent', 'product-solution', 'failed'],
      ['agent', 'product-solution', 'success'],
    ])
    assert(telemetry.every(row => row.source === 'hook'))
    assert.deepEqual(telemetry[1]?.decision, { task_key: 'public-demo', revision: 1 })
    const taskState = transport.requests.find(request => request.path === '/api/v1/task-state')?.body as Record<string, unknown>
    assert.equal(taskState.employee_id, '10086')
    assert.equal(taskState.task_key, 'public-demo')
    assert.equal(transport.requests.filter(request => request.path === '/api/v1/artifacts').length, 1)
    const heartbeat = transport.requests.find(request => request.path === '/api/v1/heartbeat')?.body as Record<string, unknown>
    assert.equal(heartbeat.client_version, '0.1.4')
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
