import { mkdir } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import { createApiProxy } from '../../promax-ui-console/src/host/api-proxy.ts'

interface WorkspaceRecord {
  id: string
  path: string
  title: string
  sessionIds: readonly string[]
}

interface WorkspaceRegistry {
  create(path: string, title?: string): Promise<WorkspaceRecord>
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
    if (bytes > 16 * 1024) throw new Error('请求体过大')
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

export async function ensureTeamWorkspace(
  workspaceRegistry: WorkspaceRegistry,
  root: string,
  teamId: string,
  teamName: string,
): Promise<WorkspaceRecord> {
  if (!/^[a-z][a-z0-9-]{2,47}$/u.test(teamId)) throw new Error('teamId 格式无效')
  const trimmedName = teamName.trim()
  if (trimmedName === '' || trimmedName.length > 80) throw new Error('团队名称格式无效')
  const normalizedRoot = resolve(root)
  const workspacePath = resolve(normalizedRoot, `promax-${teamId}`)
  if (!workspacePath.startsWith(`${normalizedRoot}${sep}`)) throw new Error('团队工作区路径越界')
  await mkdir(workspacePath, { recursive: true })
  return workspaceRegistry.create(workspacePath, trimmedName)
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
  const workspacePath = resolve(process.env.PROMAX_PRODUCT_WORKSPACE?.trim() || join(dshHome, 'workspaces', 'product'))
  const teamWorkspaceRoot = resolve(process.env.PROMAX_TEAM_WORKSPACE_ROOT?.trim() || join(dshHome, 'workspaces', 'teams'))
  await mkdir(generalWorkspacePath, { recursive: true })
  await mkdir(workspacePath, { recursive: true })
  await mkdir(teamWorkspaceRoot, { recursive: true })
  await ctx.workspaceRegistry.create(generalWorkspacePath, '通用工作区')
  await ctx.workspaceRegistry.create(workspacePath, '产品')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: WORKSPACE_API_PREFIX,
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          writeJson(response, 405, { error: '只接受 POST 请求' })
          return
        }
        const input = await readJson(request)
        const workspace = await ensureTeamWorkspace(
          ctx.workspaceRegistry,
          teamWorkspaceRoot,
          String(input.teamId ?? ''),
          String(input.teamName ?? ''),
        )
        writeJson(response, 200, {
          workspaceId: workspace.id,
          path: workspace.path,
          title: workspace.title,
          sessionIds: [...workspace.sessionIds],
        })
      } catch (error) {
        writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'promax-team-workspace-api')
}
