import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ensureSessionOutputDirectory } from '../src/index.ts'

const temporaryRoots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'promax-session-output-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('per-session output directories', () => {
  it('uses the visible Chinese session name and suffixes duplicate folders', async () => {
    const root = await temporaryRoot()
    const first = await ensureSessionOutputDirectory(root, 'session-1', '图书馆座位预约')
    const duplicate = await ensureSessionOutputDirectory(root, 'session-2', '图书馆座位预约')
    const repeated = await ensureSessionOutputDirectory(root, 'session-1', '会被已有映射忽略')

    expect(first).toEqual({ sessionName: '图书馆座位预约', taskKey: '图书馆座位预约', relativePath: 'deliverables/图书馆座位预约' })
    expect(duplicate.sessionName).toBe('图书馆座位预约（2）')
    expect(repeated).toEqual(first)
    expect(await readdir(join(root, 'deliverables'))).toEqual(['图书馆座位预约', '图书馆座位预约（2）'])
    expect(JSON.parse(await readFile(join(root, '.promax', 'session-scopes', 'session-1.json'), 'utf8'))).toMatchObject({ sessionName: '图书馆座位预约', taskKey: '图书馆座位预约' })
  })

  it('rejects names that could escape or break a cross-platform project directory', async () => {
    const root = await temporaryRoot()
    await expect(ensureSessionOutputDirectory(root, 'session-1', '../越界')).rejects.toThrow('会话名称不能安全地用作产出目录')
  })
})
