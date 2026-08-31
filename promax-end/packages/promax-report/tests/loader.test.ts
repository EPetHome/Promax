import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'

test('compiled package activates through the real Cordis Loader and sends startup heartbeat', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'promax-loader-'))
  const requests: Array<{ path?: string; body: Record<string, unknown> }> = []
  let heartbeatResolve: (() => void) | undefined
  const heartbeatReceived = new Promise<void>(resolvePromise => { heartbeatResolve = resolvePromise })
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      requests.push({
        ...(request.url ? { path: request.url } : {}),
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      })
      response.statusCode = 200
      response.end('{}')
      heartbeatResolve?.()
    })
  })
  await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))

  const context = new Context()
  try {
    const address = server.address()
    assert(address && typeof address === 'object')
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
        baseUrl: `http://127.0.0.1:${address.port}`,
        accessToken: 'loader-access-token',
        refreshToken: 'loader-refresh-token',
        employeeId: '10086',
        dshHome,
      },
    })
    await context.loader.await()
    await Promise.race([
      heartbeatReceived,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('startup heartbeat timeout')), 2_000)),
    ])

    const entry = [...context.loader.entries()].find(candidate => candidate.options.name === '@promax/promax-report')
    assert(entry?.fiber, 'Loader entry must have an active fiber')
    assert.equal(requests[0]?.path, '/api/v1/heartbeat')
    assert.deepEqual(requests[0]?.body, {
      employee_id: '10086',
      client_version: '0.1.1',
      dsh_version: '0.1.1-rc.2',
      config_fingerprint: (requests[0]?.body.config_fingerprint as string),
    })
    assert.match(String(requests[0]?.body.config_fingerprint), /^sha256:[0-9a-f]{64}$/u)
  } finally {
    await context.fiber.dispose()
    await new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()))
    await rm(dshHome, { recursive: true, force: true })
  }
})

test('real Cordis tool hook uses TeamRevision kind and never reports judge.md', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promax-loader-team-revision-'))
  const dshHome = join(root, 'dsh-home')
  const workspace = join(root, 'workspace')
  const presetId = 'promax-team-test-r4'
  const presetDirectory = join(dshHome, '.agent-presets', presetId)
  const deliverables = join(workspace, 'deliverables', 'task-1')
  const judgeDirectory = join(workspace, '.promax', 'judge', 'task-1')
  await mkdir(presetDirectory, { recursive: true })
  await mkdir(deliverables, { recursive: true })
  await mkdir(judgeDirectory, { recursive: true })
  await writeFile(join(presetDirectory, 'team-revision.yml'), `kind: TeamRevision
spec:
  preset_id: ${presetId}
  artifacts:
    - kind: diagram
      relative_path: deliverables/{task_key}/business-diagram.md
    - kind: judge-report
      relative_path: .promax/judge/{task_key}/judge.md
`)
  const diagram = join(deliverables, 'business-diagram.md')
  const judge = join(judgeDirectory, 'judge.md')
  await writeFile(diagram, '# Diagram\n')
  await writeFile(judge, '# Judge\n')

  const requests: Array<{ path?: string; body: Record<string, unknown> }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      requests.push({
        ...(request.url ? { path: request.url } : {}),
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      })
      response.statusCode = request.url === '/api/v1/artifacts' ? 201 : 202
      response.end('{}')
    })
  })
  await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))

  const context = new Context()
  try {
    const address = server.address()
    assert(address && typeof address === 'object')
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
        baseUrl: `http://127.0.0.1:${address.port}`,
        accessToken: 'loader-access-token',
        refreshToken: 'loader-refresh-token',
        employeeId: '10086',
        dshHome,
        artifactRoots: [workspace],
      },
    })
    await context.loader.await()

    emitWriteResult(context, workspace, presetId, diagram, 'diagram-write')
    emitWriteResult(context, workspace, presetId, judge, 'judge-write')
    await waitFor(() => requests.filter(request => request.path === '/api/v1/telemetry').length === 1)

    const artifactRequests = requests.filter(request => request.path === '/api/v1/artifacts')
    assert.equal(artifactRequests.length, 1)
    assert.equal(artifactRequests[0]?.body.kind, 'diagram')
    assert.equal(artifactRequests[0]?.body.filename, 'business-diagram.md')
    const telemetryRequests = requests.filter(request => request.path === '/api/v1/telemetry')
    assert.equal(telemetryRequests.length, 1)
    assert.deepEqual(telemetryRequests[0]?.body.output_files, ['business-diagram.md'])
  } finally {
    await context.fiber.dispose()
    await new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()))
    await rm(root, { recursive: true, force: true })
  }
})

function emitWriteResult(
  context: Context,
  cwd: string,
  presetId: string,
  path: string,
  sessionId: string,
): void {
  context.emit('tools/result', {
    callId: `call-${sessionId}`,
    rootCallId: `call-${sessionId}`,
    token: Symbol(sessionId),
    name: 'write',
    arguments: { file_path: path },
    agent: {
      id: sessionId,
      session: { id: sessionId, header: { cwd, agentPreset: presetId }, events: [] },
    },
    signal: new AbortController().signal,
  } as never, {
    content: [{ type: 'text', text: 'created' }],
    isError: false,
    value: { path, operation: 'create', before: null, after: 'created' },
  } as never)
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for report hook requests')
    await new Promise(resolvePromise => setTimeout(resolvePromise, 20))
  }
}
