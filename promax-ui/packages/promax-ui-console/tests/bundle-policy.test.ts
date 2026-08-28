import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../../promax-bundle/src/index.ts'

let temporaryHome: string | undefined

afterEach(async () => {
  if (temporaryHome !== undefined) await rm(temporaryHome, { recursive: true, force: true })
  temporaryHome = undefined
  delete process.env.PROMAX_GENERAL_WORKSPACE
  delete process.env.PROMAX_PRODUCT_WORKSPACE
})

describe('Promax bundle config policy', () => {
  it('only inserts Promax-owned rows and never targets an existing dsh row', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-bundle/cordis.patch.yml'), 'utf8')
    const topLevelOperations = source.split('\n').filter(line => /^-\s/u.test(line))
    const insertedIds = [...source.matchAll(/^\s+- id:\s+(\S+)\s*$/gmu)].map(match => match[1])

    expect(topLevelOperations).toEqual(['- insert:'])
    expect(insertedIds).toEqual([
      'promax-workspace-bootstrap',
      'promax-team-harness',
      'promax-ui-console',
      'promax-ui-brand',
      'promax-report',
    ])
    expect(insertedIds.every(id => id?.startsWith('promax-'))).toBe(true)
    expect(source).not.toMatch(/^\s*- id:\s+(?:ui-|agent-|sandbox|approval|code-mode)/gmu)
  })

  it('bootstraps separate general and product file boundaries without treating teams as folders', async () => {
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

    expect(create).toHaveBeenNthCalledWith(1, join(temporaryHome, 'general'), '通用工作区')
    expect(create).toHaveBeenNthCalledWith(2, join(temporaryHome, 'product'), '产品')
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
  })
})
