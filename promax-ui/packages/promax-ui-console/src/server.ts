#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { API_PROXY_PREFIX, createApiProxy } from './host/api-proxy.ts'

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

export interface StandaloneConsoleConfig {
  apiBaseUrl: string
  host: string
  port: number
  distDirectory?: string
}

export function createStandaloneConsoleServer(config: StandaloneConsoleConfig): ReturnType<typeof createServer> {
  const proxy = createApiProxy(config.apiBaseUrl)
  const distDirectory = resolve(config.distDirectory ?? resolve(dirname(fileURLToPath(import.meta.url)), '../dist'))
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://promax.local').pathname
    if (pathname === API_PROXY_PREFIX || pathname.startsWith(`${API_PROXY_PREFIX}/`)) {
      proxy(request, response)
      return
    }
    serveStatic(request, response, pathname, distDirectory).catch(() => {
      if (response.headersSent) response.destroy()
      else {
        response.writeHead(404)
        response.end()
      }
    })
  })
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  distDirectory: string,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return
  }
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  let path = resolve(distDirectory, requested)
  if (!path.startsWith(`${distDirectory}${sep}`)) throw new Error('path escapes console distribution')
  let body: Buffer
  try {
    body = await readFile(path)
  } catch {
    path = resolve(distDirectory, 'index.html')
    body = await readFile(path)
  }
  response.writeHead(200, {
    'content-type': MIME_TYPES[extname(path)] ?? 'application/octet-stream',
    'content-length': body.byteLength,
    'cache-control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  response.end(request.method === 'HEAD' ? undefined : body)
}

function positivePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? '3090', 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error('PROMAX_CONSOLE_PORT must be a valid TCP port')
  return port
}

export async function startStandaloneConsole(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config: StandaloneConsoleConfig = {
    apiBaseUrl: environment.PROMAX_API_BASE_URL?.trim() || 'http://127.0.0.1:3001',
    host: environment.PROMAX_CONSOLE_HOST?.trim() || '127.0.0.1',
    port: positivePort(environment.PROMAX_CONSOLE_PORT),
  }
  const server = createStandaloneConsoleServer(config)
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, () => {
      server.off('error', reject)
      resolvePromise()
    })
  })
  process.stdout.write(`Promax console: http://${config.host}:${String(config.port)}\n`)
}

if (process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  await startStandaloneConsole()
}
