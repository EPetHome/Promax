import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { AccessTokenProvider } from '../src/token-manager.ts'
import { HttpReportTransport } from '../src/transport.ts'

function staticTokens(token: string): AccessTokenProvider {
  return {
    async accessToken() { return token },
    async refresh() { return { kind: 'retry', status: 401, message: 'refresh unavailable' } },
  }
}

test('HTTP transport sends bearer JSON and classifies retry/dead responses', async () => {
  const seen: Array<{ authorization?: string; body: unknown }> = []
  let responseStatus = 202
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      seen.push({
        ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      })
      response.statusCode = responseStatus
      response.end('{}')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert(address && typeof address === 'object')
    const transport = new HttpReportTransport(`http://127.0.0.1:${address.port}`, staticTokens('test-token'), 2_000)
    const request = { path: '/api/v1/telemetry' as const, body: { hello: 'world' } }

    assert.deepEqual(await transport.deliver(request), { kind: 'success', status: 202 })
    responseStatus = 503
    assert.deepEqual(await transport.deliver(request), { kind: 'retry', status: 503, message: 'Promax returned HTTP 503' })
    responseStatus = 429
    assert.deepEqual(await transport.deliver(request), { kind: 'retry', status: 429, message: 'Promax returned HTTP 429' })
    responseStatus = 400
    assert.deepEqual(await transport.deliver(request), { kind: 'dead', status: 400, message: 'Promax returned HTTP 400' })
    assert.deepEqual(seen[0], { authorization: 'Bearer test-token', body: { hello: 'world' } })
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('chunk transport persists progress and resumes from the failed chunk', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promax-transport-chunks-'))
  const file = join(directory, 'large.bin')
  const content = Buffer.from('abcdefghij')
  await writeFile(file, content)
  const calls: string[] = []
  let failChunkOne = true
  const server = createServer((request, response) => {
    const url = request.url ?? ''
    calls.push(`${request.method} ${url}`)
    if (request.method === 'POST' && url === '/api/v1/artifacts/init') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ upload_id: 'upl_resume', chunk_size: 4 }))
      return
    }
    if (request.method === 'PUT' && url.endsWith('/chunk/1') && failChunkOne) {
      failChunkOne = false
      response.statusCode = 503
      response.end('{}')
      return
    }
    response.statusCode = url.endsWith('/complete') ? 201 : 204
    response.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert(address && typeof address === 'object')
    const transport = new HttpReportTransport(`http://127.0.0.1:${address.port}`, staticTokens('token'), 2_000)
    const states: Array<{ upload_id: string; chunk_size: number; next_chunk: number }> = []
    const base = {
      path: '/api/v1/artifacts' as const,
      body: {
        employee_id: '10086', project: '产品中台', agent: 'product-solution', kind: 'other' as const,
        filename: 'large.bin', created_at: '2026-08-26T00:00:00Z', sha256: '0'.repeat(64), size: content.length,
      },
      filePath: file,
      persistUploadState: async (state: { upload_id: string; chunk_size: number; next_chunk: number }) => { states.push({ ...state }) },
    }
    assert.deepEqual(await transport.deliver(base), { kind: 'retry', status: 503, message: 'Promax returned HTTP 503' })
    assert.deepEqual(states, [
      { upload_id: 'upl_resume', chunk_size: 4, next_chunk: 0 },
      { upload_id: 'upl_resume', chunk_size: 4, next_chunk: 1 },
    ])
    const resumed = { ...base, uploadState: states.at(-1)! }
    assert.deepEqual(await transport.deliver(resumed), { kind: 'success', status: 201 })
    assert.equal(calls.filter(call => call === 'POST /api/v1/artifacts/init').length, 1)
    assert.equal(calls.filter(call => call.endsWith('/chunk/0')).length, 1)
    assert.equal(calls.filter(call => call.endsWith('/chunk/1')).length, 2)
    assert.equal(calls.filter(call => call.endsWith('/chunk/2')).length, 1)
    assert.equal(calls.filter(call => call.endsWith('/complete')).length, 1)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
