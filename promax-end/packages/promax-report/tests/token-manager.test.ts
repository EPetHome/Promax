import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RotatingTokenManager } from '../src/token-manager.ts'
import { HttpReportTransport } from '../src/transport.ts'

const logger = { warn() {} }

test('401 refreshes once, retries the report, and persists the rotated pair for restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promax-token-manager-'))
  const storePath = join(directory, 'promax', 'auth.json')
  const authorizations: string[] = []
  const refreshBodies: unknown[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      if (request.url === '/api/v1/auth/refresh') {
        refreshBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({
          access_token: 'access-two',
          refresh_token: 'refresh-two',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_expires_in: 2_592_000,
        }))
        return
      }
      authorizations.push(request.headers.authorization ?? '')
      response.statusCode = request.headers.authorization === 'Bearer access-two' ? 202 : 401
      response.end('{}')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert(address && typeof address === 'object')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const options = {
      baseUrl,
      employeeId: '10086',
      accessToken: 'access-one',
      refreshToken: 'refresh-one',
      storePath,
      timeoutMs: 2_000,
    }
    const manager = new RotatingTokenManager(options, logger)
    const transport = new HttpReportTransport(baseUrl, manager, 2_000)
    assert.deepEqual(
      await transport.deliver({ path: '/api/v1/telemetry', body: { event: 1 } }),
      { kind: 'success', status: 202 },
    )
    assert.deepEqual(authorizations, ['Bearer access-one', 'Bearer access-two'])
    assert.deepEqual(refreshBodies, [{ refresh_token: 'refresh-one' }])

    const stored = JSON.parse(await readFile(storePath, 'utf8')) as Record<string, unknown>
    assert.equal(stored.access_token, 'access-two')
    assert.equal(stored.refresh_token, 'refresh-two')
    assert.equal((await stat(storePath)).mode & 0o777, 0o600)

    const restarted = new RotatingTokenManager(options, logger)
    const restartedTransport = new HttpReportTransport(baseUrl, restarted, 2_000)
    assert.deepEqual(
      await restartedTransport.deliver({ path: '/api/v1/telemetry', body: { event: 2 } }),
      { kind: 'success', status: 202 },
    )
    assert.equal(refreshBodies.length, 1, 'restart must prefer the rotated token store over stale config')
    assert.equal(authorizations.at(-1), 'Bearer access-two')
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})

test('failed refresh keeps an expired report retryable instead of classifying it as dead', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promax-token-retry-'))
  const server = createServer((request, response) => {
    response.statusCode = 401
    response.end('{}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert(address && typeof address === 'object')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const manager = new RotatingTokenManager({
      baseUrl,
      employeeId: '10086',
      accessToken: 'expired-access',
      refreshToken: 'revoked-refresh',
      storePath: join(directory, 'auth.json'),
      timeoutMs: 2_000,
    }, logger)
    const transport = new HttpReportTransport(baseUrl, manager, 2_000)
    assert.deepEqual(
      await transport.deliver({ path: '/api/v1/heartbeat', body: {} }),
      { kind: 'retry', status: 401, message: 'Promax token refresh returned HTTP 401' },
    )
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
