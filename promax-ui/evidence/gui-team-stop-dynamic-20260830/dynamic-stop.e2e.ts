import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  launchWebScaffold,
  type WebScaffold,
} from '/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/apps/web/tests/scaffold.ts'

const CONTROL_DIR = process.env.PROMAX_STOP_CONTROL_DIR
if (CONTROL_DIR === undefined || CONTROL_DIR === '') throw new Error('PROMAX_STOP_CONTROL_DIR is required')

const OVERLAY = '/Users/Admin/Desktop/Promax/promax-ui/evidence/gui-team-stop-dynamic-20260830/promax-overlay.yml'
const INSTALLED_MODULES = '/Users/Admin/.dsh-promax/profiles/web/node_modules/@promax'
const PRESET_ROOT = '/Users/Admin/.dsh-promax/.agent-presets'
const PRESET = 'promax-team-mtcjsbcz-04tpe2-r5'
const BASE_FIXTURE = '/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/apps/web/tests/snapshots/live-interactions/session.jsonl'
const DSH_PACKAGES = '/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/packages'

type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

async function rpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `promax-stop-${method}-${crypto.randomUUID()}`,
      method,
      payload,
    }),
  })
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`)
  const result = (await response.json() as { result: RpcResult<T> }).result
  if (!result.ok) throw new Error(`${method} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise<void>(resolve => setTimeout(resolve, 25))
  }
}

async function linkDshWorkspacePackages(scope: string, directory = DSH_PACKAGES): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const packageDirectory = join(directory, entry.name)
    const packageJson = join(packageDirectory, 'package.json')
    if (existsSync(packageJson)) {
      const manifest = JSON.parse(await readFile(packageJson, 'utf8')) as { name?: string }
      if (manifest.name?.startsWith('@deepseek-ai/') === true) {
        await symlink(packageDirectory, join(scope, manifest.name.slice('@deepseek-ai/'.length)), 'junction')
      }
    } else {
      await linkDshWorkspacePackages(scope, packageDirectory)
    }
  }
}

describe('Promax browser: one-click team stop', () => {
  let scaffold: WebScaffold
  let sidecarRoot: string
  let harnessHome: string
  let parentId: string
  let childId: string

  beforeAll(async () => {
    await mkdir(CONTROL_DIR, { recursive: true })
    sidecarRoot = await mkdtemp(join(tmpdir(), 'promax-team-stop-sidecar-'))
    harnessHome = await mkdtemp(join(tmpdir(), 'promax-team-stop-home-'))

    const scope = join(harnessHome, 'profiles', 'node_modules', '@promax')
    await mkdir(scope, { recursive: true })
    for (const packageName of ['promax-ui-layout', 'promax-ui-console', 'promax-ui-brand']) {
      await symlink(join(INSTALLED_MODULES, packageName), join(scope, packageName), 'junction')
    }
    const dshScope = join(harnessHome, 'profiles', 'node_modules', '@deepseek-ai')
    await mkdir(dshScope, { recursive: true })
    await linkDshWorkspacePackages(dshScope)

    const parentReady = join(sidecarRoot, 'parent-running')
    const parentRestartReady = join(sidecarRoot, 'parent-restarted')
    await writeFile(join(sidecarRoot, 'primary.jsonl'), '{"type":"session","version":0,"id":"primary","createdAt":0}\n')
    await writeFile(join(sidecarRoot, 'override.json'), JSON.stringify([
      { kind: 'hang', readyFile: parentReady },
      { kind: 'hang', readyFile: parentRestartReady },
    ]))
    const parentFixture = join(sidecarRoot, 'parent.jsonl')
    const parentText = (await readFile(BASE_FIXTURE, 'utf8'))
      .replace('"id":"{{sessionId}}"', '"id":"slow-parent"')
      .replace(/"createdAt":\d+/, '"createdAt":1784998084442')
    await writeFile(parentFixture, parentText)

    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      replayFixture: join(sidecarRoot, 'primary.jsonl'),
      replayOverride: join(sidecarRoot, 'override.json'),
      replayChildFixtures: [parentFixture],
      paceMs: 2_000,
      harnessHome,
      agentPresets: {
        roots: [{ path: PRESET_ROOT, trust: 'user' }],
        default: PRESET,
      },
    })

    const projectPath = join(scaffold.workspaceCwd, 'product')
    await mkdir(projectPath)
    const workspace = await rpc<{ workspaceId: string }>(scaffold.baseUrl, 'workspace.create', { path: projectPath })
    await writeFile(join(CONTROL_DIR, 'ready.json'), JSON.stringify({
      baseUrl: scaffold.baseUrl,
      workspaceId: workspace.workspaceId,
      project: 'product',
    }, null, 2))
    await waitFor(() => scaffold.ctx.agents.roots().some(agent => agent.status === 'running'), 'browser to start the parent session', 180_000)
    await waitFor(() => existsSync(parentReady), 'parent replay hang')
    const parentAgent = scaffold.ctx.agents.roots().find(agent => agent.status === 'running')
    if (parentAgent === undefined) throw new Error('browser-started parent Agent was not found')
    parentId = parentAgent.id

    const child = await scaffold.ctx.subagents.startContinuable({
      provider: 'spawn',
      label: '停止按钮验收子 Agent',
      signal: new AbortController().signal,
      request: {
        prompt: [{ type: 'text', text: '保持运行，等待界面停止。' }],
        parent: parentAgent,
      },
    })
    childId = child.childId
    await waitFor(() => scaffold.ctx.agents.get(childId as never)?.status === 'running', 'child running')

    await writeFile(join(CONTROL_DIR, 'running.json'), JSON.stringify({
      baseUrl: scaffold.baseUrl,
      parentId,
      childId,
      project: 'product',
      sessionTitle: '动态停止验收',
    }, null, 2))
  }, 180_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (sidecarRoot !== undefined) await rm(sidecarRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (harnessHome !== undefined) await rm(harnessHome, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'dynamic stop teardown failed')
  })

  it('stops both the running child and running parent from the Promax primary button', async () => {
    await waitFor(() => (
      scaffold.ctx.agents.get(parentId as never)?.status === 'idle'
      && scaffold.ctx.agents.get(childId as never)?.status !== 'running'
    ), 'browser to stop parent and child', 300_000)

    const parentSession = await scaffold.ctx.sessionPersistence.load(parentId as never)
    const childSession = await scaffold.ctx.sessionPersistence.load(childId as never)
    const parentTurnEnd = parentSession.events.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind
    const childTurnEnd = childSession.events.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind
    expect(parentTurnEnd).toBe('aborted')
    expect(childTurnEnd).toBe('aborted')

    await writeFile(join(CONTROL_DIR, 'result.json'), JSON.stringify({
      parentStatus: scaffold.ctx.agents.get(parentId as never)?.status ?? 'removed',
      childStatus: scaffold.ctx.agents.get(childId as never)?.status ?? 'removed',
      parentTurnEnd,
      childTurnEnd,
    }, null, 2))
    await waitFor(() => existsSync(join(CONTROL_DIR, 'capture-done')), 'browser evidence capture', 180_000)
  }, 360_000)
})
