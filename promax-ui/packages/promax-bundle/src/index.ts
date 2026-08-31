import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

import { createApiProxy } from '../../promax-ui-console/src/host/api-proxy.ts'

interface WorkspaceRecord {
  id: string
  path: string
  title: string
  sessionIds: readonly string[]
}

interface WorkspaceRegistry {
  create(path: string, title?: string): Promise<WorkspaceRecord>
  get?(workspaceId: string): WorkspaceRecord | undefined
}

interface WebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

interface HostContext {
  workspaceRegistry: WorkspaceRegistry
  webServer: WebServer
  effect(setup: () => void | (() => void), label?: string): void
  on(event: 'webserver/index-inject', listener: (table: Array<Record<string, unknown>>) => void): void
}

export const name = 'promax-workspace-bootstrap'
export const inject = ['workspaceRegistry', 'webServer']

export interface Config {
  apiBaseUrl: string
}

const API_PROXY_PREFIX = '/promax-api'
const WORKSPACE_API_PREFIX = '/promax-workspace-api'

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > 1024 * 1024) throw new Error('请求体过大')
    chunks.push(buffer)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('请求体必须是 JSON 对象')
  return value as Record<string, unknown>
}

function writeJson(response: ServerResponse, status: number, value: Record<string, unknown>): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
  })
  response.end(body)
}

function projectNameOf(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === '' || name.length > 80 || name === '.' || name === '..' || /[/\\\0]/u.test(name)) {
    throw new Error('项目组名称格式无效')
  }
  return name
}

const SESSION_SCOPE_MAX_LENGTH = 40

function sessionScopeNameOf(value: unknown): string {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  if (
    name === '' || Array.from(name).length > SESSION_SCOPE_MAX_LENGTH || name === '.' || name === '..'
    || /[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(name) || /[. ]$/u.test(name)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(name)
  ) throw new Error('会话名称不能安全地用作产出目录')
  return name
}

function sessionIdOf(value: unknown): string {
  const sessionId = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(sessionId)) throw new Error('会话标识格式无效')
  return sessionId
}

function numberedSessionScopeName(base: string, ordinal: number): string {
  if (ordinal === 1) return base
  const suffix = `（${String(ordinal)}）`
  const available = SESSION_SCOPE_MAX_LENGTH - Array.from(suffix).length
  return `${Array.from(base).slice(0, available).join('').replace(/[. ]+$/u, '')}${suffix}`
}

/** Claims one immutable per-session output folder; duplicate names receive the same suffix in UI and on disk. */
export async function ensureSessionOutputDirectory(
  workspacePath: string,
  sessionIdValue: string,
  requestedNameValue: string,
): Promise<{ sessionName: string; taskKey: string; relativePath: string }> {
  const root = resolve(workspacePath)
  const sessionId = sessionIdOf(sessionIdValue)
  const requestedName = sessionScopeNameOf(requestedNameValue)
  const mappingDirectory = join(root, '.promax', 'session-scopes')
  const mappingPath = join(mappingDirectory, `${sessionId}.json`)
  await mkdir(mappingDirectory, { recursive: true })

  try {
    const stored = JSON.parse(await readFile(mappingPath, 'utf8')) as { sessionName?: unknown }
    const sessionName = sessionScopeNameOf(stored.sessionName)
    await mkdir(join(root, 'deliverables', sessionName), { recursive: true })
    return { sessionName, taskKey: sessionName, relativePath: join('deliverables', sessionName) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await mkdir(join(root, 'deliverables'), { recursive: true })
  for (let ordinal = 1; ordinal <= 999; ordinal += 1) {
    const sessionName = numberedSessionScopeName(requestedName, ordinal)
    try {
      await mkdir(join(root, 'deliverables', sessionName))
      await writeFile(mappingPath, `${JSON.stringify({ sessionId, sessionName, taskKey: sessionName }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      return { sessionName, taskKey: sessionName, relativePath: join('deliverables', sessionName) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('同名会话产出目录数量超过上限')
}

async function scaffoldProject(path: string): Promise<void> {
  await Promise.all([
    mkdir(join(path, '输入', '草稿'), { recursive: true }),
    mkdir(join(path, '输入', '源文件'), { recursive: true }),
    mkdir(join(path, '产出'), { recursive: true }),
    mkdir(join(path, '.promax', 'drafts'), { recursive: true }),
    mkdir(join(path, '.promax', 'judge'), { recursive: true }),
  ])
  try {
    await writeFile(
      join(path, '.promax', 'source-ledger.md'),
      '# 来源台账\n\n> 由 Promax 管理。团队只读取“输入”，正式结果写入“产出”。\n',
      { encoding: 'utf8', flag: 'wx' },
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export async function ensureProjectWorkspace(
  workspaceRegistry: WorkspaceRegistry,
  root: string,
  projectName: string,
): Promise<WorkspaceRecord> {
  const trimmedName = projectNameOf(projectName)
  const normalizedRoot = resolve(root)
  const workspacePath = resolve(normalizedRoot, trimmedName)
  if (!workspacePath.startsWith(`${normalizedRoot}${sep}`)) throw new Error('项目组路径越界')
  await scaffoldProject(workspacePath)
  return workspaceRegistry.create(workspacePath, trimmedName)
}

function localDate(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

async function writeUniqueMarkdown(directory: string, stem: string, content: string): Promise<string> {
  for (let ordinal = 1; ordinal <= 999; ordinal += 1) {
    const suffix = ordinal === 1 ? '' : `-${ordinal}`
    const path = join(directory, `${stem}${suffix}.md`)
    try {
      await writeFile(path, `${content.trim()}\n`, { encoding: 'utf8', flag: 'wx' })
      return path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('当天交底文件数量超过上限')
}

export async function writeHandoffFiles(
  workspacePath: string,
  handoff: string,
  transcript: string,
): Promise<{ handoffPath: string; transcriptPath: string }> {
  const normalizedHandoff = handoff.trim()
  const normalizedTranscript = transcript.trim()
  if (normalizedHandoff === '' || normalizedTranscript === '') throw new Error('交底或原始对话为空')
  await scaffoldProject(workspacePath)
  const draftDirectory = join(workspacePath, '输入', '草稿')
  const date = localDate()
  const handoffPath = await writeUniqueMarkdown(draftDirectory, `${date}-需求交底`, normalizedHandoff)
  const transcriptPath = await writeUniqueMarkdown(draftDirectory, `${date}-原始对话`, normalizedTranscript)
  return { handoffPath, transcriptPath }
}

function requestPath(request: IncomingMessage): string {
  return (request.url ?? '').split('?')[0]?.replace(/\/+$/u, '') ?? ''
}

export async function apply(ctx: HostContext, config: Config): Promise<void> {
  const proxy = createApiProxy(config.apiBaseUrl)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PROXY_PREFIX,
    handler: proxy,
  }), 'promax-api-proxy')
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'html',
      placement: 'head',
      html: '<meta name="promax-api-base-url" content="/promax-api">',
    })
  })

  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const generalWorkspacePath = resolve(process.env.PROMAX_GENERAL_WORKSPACE?.trim() || join(dshHome, 'workspaces', 'general'))
  const projectRoot = resolve(process.env.PROMAX_PROJECT_ROOT?.trim() || join(homedir(), 'Promax'))
  const compatibilityProductPath = resolve(process.env.PROMAX_PRODUCT_WORKSPACE?.trim() || join(projectRoot, '产品'))
  const knownWorkspaces = new Map<string, WorkspaceRecord>()

  await mkdir(generalWorkspacePath, { recursive: true })
  const general = await ctx.workspaceRegistry.create(generalWorkspacePath, '草稿')
  knownWorkspaces.set(general.id, general)
  await scaffoldProject(compatibilityProductPath)
  const product = await ctx.workspaceRegistry.create(compatibilityProductPath, '产品')
  knownWorkspaces.set(product.id, product)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: WORKSPACE_API_PREFIX,
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          writeJson(response, 405, { error: '只接受 POST 请求' })
          return
        }
        const path = requestPath(request)
        const input = await readJson(request)

        if (path.endsWith('/draft')) {
          const draftDirectory = join(dshHome, 'promax', 'drafts')
          await mkdir(draftDirectory, { recursive: true })
          await writeFile(join(draftDirectory, 'state.json'), `${JSON.stringify(input, null, 2)}\n`, 'utf8')
          writeJson(response, 200, { ok: true })
          return
        }

        if (path.endsWith('/project')) {
          const customParent = typeof input.parentPath === 'string' && input.parentPath.trim() !== ''
            ? resolve(input.parentPath.trim())
            : projectRoot
          const workspace = await ensureProjectWorkspace(ctx.workspaceRegistry, customParent, String(input.projectName ?? ''))
          knownWorkspaces.set(workspace.id, workspace)
          writeJson(response, 200, {
            workspaceId: workspace.id,
            path: workspace.path,
            title: workspace.title,
            sessionIds: [...workspace.sessionIds],
          })
          return
        }

        if (path.endsWith('/handoff')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const handoff = typeof input.handoff === 'string' ? input.handoff : ''
          const transcript = typeof input.transcript === 'string' ? input.transcript : ''
          const { handoffPath, transcriptPath } = await writeHandoffFiles(workspacePath, handoff, transcript)
          writeJson(response, 200, { handoffPath, transcriptPath })
          return
        }

        if (path.endsWith('/session-scope')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const scope = await ensureSessionOutputDirectory(workspacePath, String(input.sessionId ?? ''), String(input.sessionName ?? ''))
          writeJson(response, 200, scope)
          return
        }

        writeJson(response, 404, { error: '未知的 Promax 工作区操作' })
      } catch (error) {
        writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'promax-project-workspace-api')
}
