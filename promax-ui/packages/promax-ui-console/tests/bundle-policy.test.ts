import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply, writeHandoffFiles } from '../../promax-bundle/src/index.ts'

let temporaryHome: string | undefined

afterEach(async () => {
  if (temporaryHome !== undefined) await rm(temporaryHome, { recursive: true, force: true })
  temporaryHome = undefined
  delete process.env.PROMAX_GENERAL_WORKSPACE
  delete process.env.PROMAX_PRODUCT_WORKSPACE
})

describe('Promax bundle config policy', () => {
  it('disables only the approved shell rows and inserts only Promax-owned rows', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-bundle/cordis.patch.yml'), 'utf8')
    const topLevelOperations = source.split('\n').filter(line => /^-\s/u.test(line))
    const insertedIds = [...source.matchAll(/^[ \t]+- id:\s+(\S+)\s*$/gmu)].map(match => match[1])

    expect(topLevelOperations).toEqual(['- id: ui-layout', '- id: ui-sidebar', '- id: ui-brand-official', '- insert:'])
    expect(insertedIds).toEqual([
      'promax-workspace-bootstrap',
      'promax-team-harness',
      'promax-ui-console',
      'promax-ui-layout',
      'promax-ui-brand',
      'promax-report',
    ])
    expect(insertedIds.every(id => id?.startsWith('promax-'))).toBe(true)
    const targetedDshIds = [...source.matchAll(/^- id:\s+(\S+)\s*$/gmu)].map(match => match[1])
    expect(targetedDshIds).toEqual(['ui-layout', 'ui-sidebar', 'ui-brand-official'])
    expect(source.match(/^\s+disabled:\s+true$/gmu)).toHaveLength(3)
  })

  it('bootstraps the draft boundary and a standard product project tree', async () => {
    temporaryHome = await mkdtemp(join(tmpdir(), 'promax-bundle-test-'))
    process.env.PROMAX_GENERAL_WORKSPACE = join(temporaryHome, 'general')
    process.env.PROMAX_PRODUCT_WORKSPACE = join(temporaryHome, 'product')
    let workspaceOrdinal = 0
    const create = vi.fn(async (path: string, title?: string) => {
      workspaceOrdinal += 1
      return { id: `workspace-${workspaceOrdinal}`, path, title: title ?? 'workspace', sessionIds: [] }
    })
    const register = vi.fn(() => () => {})

    await apply({
      workspaceRegistry: { create },
      webServer: { register },
      effect: setup => { setup() },
      on: (_event, _listener) => {},
    }, { apiBaseUrl: 'http://127.0.0.1:3100' })

    expect(create).toHaveBeenNthCalledWith(1, join(temporaryHome, 'general'), '草稿')
    expect(create).toHaveBeenNthCalledWith(2, join(temporaryHome, 'product'), '产品')
    expect(readFileSync(join(temporaryHome, 'product', '.promax', 'source-ledger.md'), 'utf8')).toContain('来源台账')
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prefix',
      path: '/promax-api',
      handler: expect.any(Function) as (request: IncomingMessage, response: ServerResponse) => void,
    }))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prefix',
      path: '/promax-workspace-api',
      handler: expect.any(Function) as (request: IncomingMessage, response: ServerResponse) => void,
    }))

    const saved = await writeHandoffFiles(join(temporaryHome, 'product'), '## 背景\n\n- 脱敏需求', '## 用户\n\n脱敏需求')
    expect(saved.handoffPath).toContain('需求交底.md')
    expect(saved.transcriptPath).toContain('原始对话.md')
    expect(await readdir(join(temporaryHome, 'product', '输入', '草稿'))).toHaveLength(2)
  })
})
