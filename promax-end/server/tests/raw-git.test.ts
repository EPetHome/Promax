import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import { RawGitBatcher } from '../src/raw-git.ts'

const execFileAsync = promisify(execFile)

test('raw Git waits for a batch and commits multiple artifacts together', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'promax-raw-git-batch-'))
  context.after(async () => rm(directory, { recursive: true, force: true }))
  const raw = join(directory, 'raw')
  const batcher = new RawGitBatcher(raw, {
    batchSize: 2,
    intervalMs: 60 * 60 * 1000,
    now: () => new Date('2026-08-26T12:00:00Z'),
  })

  await batcher.start()
  assert.equal((await stat(join(raw, '.git'))).isDirectory(), true)

  await mkdir(join(raw, '10086', '产品中台'), { recursive: true })
  await writeFile(join(raw, '10086', '产品中台', '2026-08-26-需求.md'), '# 需求\n')
  batcher.noteArtifact()
  assert.deepEqual(await commitSubjects(raw), [])

  await writeFile(join(raw, '10086', '产品中台', '2026-08-26-流程图.svg'), '<svg/>')
  batcher.noteArtifact()
  await batcher.flush()

  assert.deepEqual(await commitSubjects(raw), ['promax raw 2026-08-26 batch (2 artifacts)'])
  assert.deepEqual(await trackedFiles(raw), [
    '10086/产品中台/2026-08-26-流程图.svg',
    '10086/产品中台/2026-08-26-需求.md',
  ])

  await writeFile(join(raw, '10086', '产品中台', '2026-08-26-原型.html'), '<main/>')
  batcher.noteArtifact()
  await batcher.close()
  assert.deepEqual(await commitSubjects(raw), [
    'promax raw 2026-08-26 batch (1 artifacts)',
    'promax raw 2026-08-26 batch (2 artifacts)',
  ])
})

test('raw Git adopts files left by an earlier process on startup', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'promax-raw-git-recovery-'))
  context.after(async () => rm(directory, { recursive: true, force: true }))
  const raw = join(directory, 'raw')
  await mkdir(join(raw, '10086', '产品中台'), { recursive: true })
  await writeFile(join(raw, '10086', '产品中台', '2026-08-25-遗留.md'), 'pending\n')

  const batcher = new RawGitBatcher(raw, {
    batchSize: 100,
    intervalMs: 24 * 60 * 60 * 1000,
    now: () => new Date('2026-08-26T01:00:00Z'),
  })
  await batcher.start()
  await batcher.close()

  assert.deepEqual(await commitSubjects(raw), ['promax raw 2026-08-26 batch (1 artifacts)'])
  assert.deepEqual(await trackedFiles(raw), ['10086/产品中台/2026-08-25-遗留.md'])

  const restarted = new RawGitBatcher(raw)
  await restarted.start()
  await restarted.close()
  assert.equal((await commitSubjects(raw)).length, 1)
})

test('raw Git commits a partial batch when its time window expires', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'promax-raw-git-timer-'))
  context.after(async () => rm(directory, { recursive: true, force: true }))
  const raw = join(directory, 'raw')
  const batcher = new RawGitBatcher(raw, {
    batchSize: 100,
    intervalMs: 20,
    now: () => new Date('2026-08-26T23:59:00Z'),
  })

  await batcher.start()
  await writeFile(join(raw, 'timer.md'), 'daily batch\n')
  batcher.noteArtifact()
  await waitFor(async () => (await commitSubjects(raw)).length === 1)
  await batcher.close()

  assert.deepEqual(await commitSubjects(raw), ['promax raw 2026-08-26 batch (1 artifacts)'])
})

async function commitSubjects(directory: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['log', '--format=%s'], { cwd: directory })
    return stdout.trim().length === 0 ? [] : stdout.trim().split('\n')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 128) return []
    throw error
  }
}

async function trackedFiles(directory: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: directory })
  return stdout.trim().split('\n').filter(Boolean).sort()
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for raw Git batch')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
