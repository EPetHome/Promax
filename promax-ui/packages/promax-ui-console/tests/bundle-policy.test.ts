import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Promax bundle config policy', () => {
  it('only inserts Promax-owned rows and never targets an existing dsh row', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-bundle/cordis.patch.yml'), 'utf8')
    const topLevelOperations = source.split('\n').filter(line => /^-\s/u.test(line))
    const insertedIds = [...source.matchAll(/^\s+- id:\s+(\S+)\s*$/gmu)].map(match => match[1])

    expect(topLevelOperations).toEqual(['- insert:'])
    expect(insertedIds).toEqual([
      'promax-workspace-bootstrap',
      'promax-ui-console',
      'promax-ui-brand',
      'promax-report',
    ])
    expect(insertedIds.every(id => id?.startsWith('promax-'))).toBe(true)
    expect(source).not.toMatch(/^\s*- id:\s+(?:ui-|agent-|sandbox|approval|code-mode)/gmu)
  })
})
