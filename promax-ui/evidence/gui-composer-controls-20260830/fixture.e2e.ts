import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from '/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/apps/web/tests/scaffold.ts'

const CONTROL_DIR = process.env.PROMAX_COMPOSER_CONTROL_DIR
if (CONTROL_DIR === undefined || CONTROL_DIR === '') throw new Error('PROMAX_COMPOSER_CONTROL_DIR is required')

const OVERLAY = '/Users/Admin/Desktop/Promax/promax-ui/evidence/gui-team-stop-dynamic-20260830/promax-overlay.yml'
const INSTALLED_MODULES = '/Users/Admin/.dsh-promax/profiles/web/node_modules/@promax'
const PRESET_ROOT = '/Users/Admin/.dsh-promax/.agent-presets'
const PRESET = 'promax-team-mtcjsbcz-04tpe2-r6'
const DSH_PACKAGES = '/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness/packages'

type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

async function rpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `promax-composer-${crypto.randomUUID()}`, method, payload }),
  })
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`)
  const result = (await response.json() as { result: RpcResult<T> }).result
  if (!result.ok) throw new Error(`${method} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 180_000): Promise<void> {
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
      if (manifest.name?.startsWith('@deepseek-ai/') === true) await symlink(packageDirectory, join(scope, manifest.name.slice('@deepseek-ai/'.length)), 'junction')
    } else {
      await linkDshWorkspacePackages(scope, packageDirectory)
    }
  }
}

describe('Promax browser: composer controls', () => {
  let scaffold: WebScaffold
  let sidecarRoot: string
  let harnessHome: string

  beforeAll(async () => {
    await mkdir(CONTROL_DIR, { recursive: true })
    sidecarRoot = await mkdtemp(join(tmpdir(), 'promax-composer-sidecar-'))
    harnessHome = await mkdtemp(join(tmpdir(), 'promax-composer-home-'))
    const promaxScope = join(harnessHome, 'profiles', 'node_modules', '@promax')
    await mkdir(promaxScope, { recursive: true })
    for (const packageName of ['promax-ui-layout', 'promax-ui-console', 'promax-ui-brand', 'team-harness']) {
      await symlink(join(INSTALLED_MODULES, packageName), join(promaxScope, packageName), 'junction')
    }
    const dshScope = join(harnessHome, 'profiles', 'node_modules', '@deepseek-ai')
    await mkdir(dshScope, { recursive: true })
    await linkDshWorkspacePackages(dshScope)
    const replay = join(sidecarRoot, 'empty.jsonl')
    await writeFile(replay, '{"type":"session","version":0,"id":"composer-controls","createdAt":0}\n')
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      replayFixture: replay,
      replayProvidersOnly: true,
      paceMs: 5,
      harnessHome,
      agentPresets: { roots: [{ path: PRESET_ROOT, trust: 'user' }], default: PRESET },
    })
    const generalPath = join(scaffold.workspaceCwd, 'general')
    await mkdir(generalPath)
    const generalWorkspace = await rpc<{ workspaceId: string }>(scaffold.baseUrl, 'workspace.create', { path: generalPath })
    await rpc(scaffold.baseUrl, 'session.create', {
      sessionId: `composer-draft-${crypto.randomUUID()}`,
      workspaceId: generalWorkspace.workspaceId,
      agentPreset: 'general',
    })
    const projectPath = join(scaffold.workspaceCwd, 'product')
    await mkdir(projectPath)
    const workspace = await rpc<{ workspaceId: string }>(scaffold.baseUrl, 'workspace.create', { path: projectPath })
    const sessionId = `composer-controls-${crypto.randomUUID()}`
    await rpc(scaffold.baseUrl, 'session.create', { sessionId, workspaceId: workspace.workspaceId, agentPreset: PRESET })
    await writeFile(join(CONTROL_DIR, 'ready.json'), JSON.stringify({ baseUrl: scaffold.baseUrl, sessionId }, null, 2))
  }, 180_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (sidecarRoot !== undefined) await rm(sidecarRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (harnessHome !== undefined) await rm(harnessHome, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'composer fixture teardown failed')
  })

  it('keeps the isolated page alive until browser evidence is captured', async () => {
    await waitFor(() => existsSync(join(CONTROL_DIR, 'capture-done')), 'browser evidence capture', 900_000)
  }, 960_000)
})
