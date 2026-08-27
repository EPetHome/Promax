import { mkdir } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { createApiProxy } from '../../promax-ui-console/src/host/api-proxy.ts'

interface WorkspaceRegistry {
  create(path: string, title?: string): Promise<unknown>
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
  await mkdir(generalWorkspacePath, { recursive: true })
  await mkdir(workspacePath, { recursive: true })
  await ctx.workspaceRegistry.create(generalWorkspacePath, '通用工作区')
  await ctx.workspaceRegistry.create(workspacePath, '产品')
}
