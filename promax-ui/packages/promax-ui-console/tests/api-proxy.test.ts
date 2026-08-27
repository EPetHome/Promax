import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'

import { createApiProxy } from '../src/host/api-proxy.ts'

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolvePromise) => {
    server.close(() => { resolvePromise() })
  })))
})

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolvePromise) => { server.listen(0, '127.0.0.1', resolvePromise) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected TCP address')
  return `http://127.0.0.1:${address.port}`
}

describe('Promax API same-origin proxy', () => {
  it('forwards method, path, query, authorization and response body', async () => {
    const upstream = await listen((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        method: request.method,
        path: request.url,
        authorization: request.headers.authorization,
      }))
    })
    const gateway = await listen(createApiProxy(upstream))

    const response = await fetch(`${gateway}/promax-api/api/v1/console/users?page=2`, {
      headers: { authorization: 'Bearer fixture-token' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      method: 'GET',
      path: '/api/v1/console/users?page=2',
      authorization: 'Bearer fixture-token',
    })
  })

  it('returns a structured 502 when the upstream is unavailable', async () => {
    const gateway = await listen(createApiProxy('http://127.0.0.1:1'))
    const response = await fetch(`${gateway}/promax-api/api/v1/console/overview`)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UPSTREAM_UNAVAILABLE' },
    })
  })
})
