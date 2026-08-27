import { request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'

export const API_PROXY_PREFIX = '/promax-api'

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function forwardedHeaders(headers: IncomingHttpHeaders, host: string): IncomingHttpHeaders {
  const forwarded: IncomingHttpHeaders = { host }
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name === 'host' || HOP_BY_HOP_HEADERS.has(name)) continue
    forwarded[name] = value
  }
  return forwarded
}

function responseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const forwarded: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name)) continue
    forwarded[name] = value
  }
  return forwarded
}

export function createApiProxy(apiBaseUrl: string): (request: IncomingMessage, response: ServerResponse) => void {
  const upstream = new URL(apiBaseUrl)
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
    throw new Error('PROMAX_API_BASE_URL must use http or https')
  }
  const normalizedBasePath = upstream.pathname.replace(/\/+$/u, '')

  return (request, response) => {
    const incoming = new URL(request.url ?? '/', 'http://promax.local')
    const suffix = incoming.pathname.slice(API_PROXY_PREFIX.length)
    const target = new URL(upstream)
    target.pathname = `${normalizedBasePath}${suffix || '/'}`
    target.search = incoming.search
    const transport = target.protocol === 'https:' ? httpsRequest : httpRequest
    const proxied = transport(target, {
      method: request.method,
      headers: forwardedHeaders(request.headers, target.host),
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders(upstreamResponse.headers))
      upstreamResponse.pipe(response)
    })
    proxied.on('error', (error) => {
      if (response.headersSent) {
        response.destroy(error)
        return
      }
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Promax 服务暂不可用', detail: {} } }))
    })
    request.on('aborted', () => { proxied.destroy() })
    request.pipe(proxied)
  }
}
