import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
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
      client_version: '0.1.0',
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
