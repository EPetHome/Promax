import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DurableReportQueue, type ReportLogger } from '../src/outbox.ts'
import type { DeliveryResult, ReportRequest, ReportTransport } from '../src/transport.ts'

class ScriptedTransport implements ReportTransport {
  readonly requests: ReportRequest[] = []
  result: DeliveryResult = { kind: 'success', status: 202 }

  async deliver(request: ReportRequest): Promise<DeliveryResult> {
    this.requests.push(structuredClone(request))
    return this.result
  }
}

const logger: ReportLogger = { debug() {}, warn() {} }

test('network failure is persisted and recovered from the required outbox path', async () => {
  const home = await mkdtemp(join(tmpdir(), 'promax-report-outbox-'))
  try {
    const transport = new ScriptedTransport()
    transport.result = { kind: 'retry', message: 'offline' }
    const queue = new DurableReportQueue(home, transport, logger)
    queue.submit({ path: '/api/v1/telemetry', body: { sequence: 1 } })
    await queue.idle()

    const files = (await readdir(queue.outboxDirectory)).filter(name => name.endsWith('.jsonl'))
    assert.equal(files.length, 1)
    const queued = JSON.parse(await readFile(join(queue.outboxDirectory, files[0]!), 'utf8')) as Record<string, unknown>
    assert.equal(queued.path, '/api/v1/telemetry')
    assert.deepEqual(queued.body, { sequence: 1 })

    transport.result = { kind: 'success', status: 202 }
    queue.flush()
    await queue.idle()
    assert.deepEqual((await readdir(queue.outboxDirectory)).filter(name => name.endsWith('.jsonl')), [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('recovery preserves event order and never lets a new event jump the queue', async () => {
  const home = await mkdtemp(join(tmpdir(), 'promax-report-order-'))
  try {
    const transport = new ScriptedTransport()
    transport.result = { kind: 'retry', message: 'offline' }
    const queue = new DurableReportQueue(home, transport, logger)
    queue.submit({ path: '/api/v1/telemetry', body: { sequence: 1 } })
    queue.submit({ path: '/api/v1/telemetry', body: { sequence: 2 } })
    await queue.idle()

    transport.requests.length = 0
    transport.result = { kind: 'success', status: 202 }
    queue.flush()
    await queue.idle()
    assert.deepEqual(transport.requests.map(request => (request.body as { sequence: number }).sequence), [1, 2])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('non-429 4xx and malformed entries move to dead without retry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'promax-report-dead-'))
  try {
    const transport = new ScriptedTransport()
    transport.result = { kind: 'dead', status: 400, message: 'bad request' }
    const queue = new DurableReportQueue(home, transport, logger)
    queue.submit({ path: '/api/v1/heartbeat', body: { invalid: true } })
    await queue.idle()
    assert.equal((await readdir(queue.deadDirectory)).filter(name => name.endsWith('.jsonl')).length, 1)

    const malformed = join(queue.outboxDirectory, '0000000000000-malformed.jsonl')
    await writeFile(malformed, 'not json\n')
    queue.flush()
    await queue.idle()
    assert.equal(transport.requests.length, 1)
    assert.equal((await readdir(queue.deadDirectory)).filter(name => name.endsWith('.jsonl')).length, 2)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('large artifact is snapshotted with sha and resumable progress before delivery', async () => {
  const home = await mkdtemp(join(tmpdir(), 'promax-report-blob-'))
  try {
    const source = join(home, 'source.bin')
    await writeFile(source, 'large artifact bytes')
    let first = true
    const requests: ReportRequest[] = []
    const transport: ReportTransport = {
      async deliver(request) {
        requests.push(request)
        assert(request.filePath)
        assert(existsSync(request.filePath))
        if (first) {
          first = false
          await request.persistUploadState({ upload_id: 'upl_resume', chunk_size: 4, next_chunk: 2 })
          return { kind: 'retry', message: 'offline' }
        }
        return { kind: 'success', status: 201 }
      },
    }
    const queue = new DurableReportQueue(home, transport, logger)
    queue.submitArtifactFile({
      employee_id: '10086', project: '产品中台', agent: 'product-solution', kind: 'other',
      filename: 'source.bin', created_at: '2026-08-26T00:00:00Z',
    }, source)
    await queue.idle()

    const files = (await readdir(queue.outboxDirectory)).filter(name => name.endsWith('.jsonl'))
    assert.equal(files.length, 1)
    const envelope = JSON.parse(await readFile(join(queue.outboxDirectory, files[0]!), 'utf8')) as {
      body: { size: number; sha256: string }
      file: { blob: string; upload_state: { next_chunk: number } }
    }
    assert.equal(envelope.body.size, Buffer.byteLength('large artifact bytes'))
    assert.match(envelope.body.sha256, /^[0-9a-f]{64}$/u)
    assert.equal(envelope.file.upload_state.next_chunk, 2)
    assert(existsSync(join(queue.blobDirectory, envelope.file.blob)))

    queue.flush()
    await queue.idle()
    assert.equal(requests.length, 2)
    assert.deepEqual((requests[1] as { uploadState?: unknown }).uploadState, { upload_id: 'upl_resume', chunk_size: 4, next_chunk: 2 })
    assert.deepEqual((await readdir(queue.outboxDirectory)).filter(name => name.endsWith('.jsonl')), [])
    assert.deepEqual(await readdir(queue.blobDirectory), [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('Feishu delivery progress is durable and resumes without repeating completed stages', async () => {
  const home = await mkdtemp(join(tmpdir(), 'promax-report-feishu-progress-'))
  try {
    let first = true
    const restored: unknown[] = []
    const transport: ReportTransport = {
      async deliver(request) {
        assert.equal(request.path, '/feishu/v1/run')
        restored.push(structuredClone(request.deliveryState))
        if (first) {
          first = false
          await request.persistDeliveryState?.({ docToken: 'doc-1', docUrl: 'https://example.test/doc-1' })
          return { kind: 'retry', message: 'offline after document import' }
        }
        return { kind: 'success', status: 200 }
      },
    }
    const queue = new DurableReportQueue(home, transport, logger, 'feishu-outbox')
    queue.submit({ path: '/feishu/v1/run', body: { sessionId: 'session-1' } })
    await queue.idle()
    assert.equal((await readdir(queue.outboxDirectory)).filter(name => name.endsWith('.jsonl')).length, 1)

    queue.flush()
    await queue.idle()
    assert.deepEqual(restored, [undefined, { docToken: 'doc-1', docUrl: 'https://example.test/doc-1' }])
    assert.deepEqual((await readdir(queue.outboxDirectory)).filter(name => name.endsWith('.jsonl')), [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a valid Feishu 4xx dead letter is requeued only after target configuration changes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'promax-report-feishu-reconfigure-'))
  try {
    let result: DeliveryResult = { kind: 'dead', status: 400, message: 'bad app token' }
    let attempts = 0
    const transport: ReportTransport = {
      async deliver() {
        attempts += 1
        return result
      },
    }
    const queue = new DurableReportQueue(home, transport, logger, 'feishu-outbox')
    queue.submit({ path: '/feishu/v1/run', body: { sessionId: 'session-reconfigure' } })
    await queue.idle()

    const deadFiles = (await readdir(queue.deadDirectory)).filter(name => name.endsWith('.jsonl'))
    assert.equal(deadFiles.length, 1)
    const dead = JSON.parse(await readFile(join(queue.deadDirectory, deadFiles[0]!), 'utf8')) as Record<string, unknown>
    assert.equal(dead.status, 400)
    assert.equal(dead.error, 'bad app token')
    assert.equal(dead.attempts, 1)
    assert.match(String(dead.lastAttemptAt), /^\d{4}-\d{2}-\d{2}T/u)
    assert.equal((await readdir(queue.outboxDirectory)).filter(name => name.endsWith('.jsonl')).length, 0)

    result = { kind: 'success', status: 200 }
    queue.retryDead()
    await queue.idle()
    assert.equal(attempts, 2)
    assert.deepEqual((await readdir(queue.deadDirectory)).filter(name => name.endsWith('.jsonl')), [])
    assert.deepEqual((await readdir(queue.outboxDirectory)).filter(name => name.endsWith('.jsonl')), [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
