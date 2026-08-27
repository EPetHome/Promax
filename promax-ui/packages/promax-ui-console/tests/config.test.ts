import { afterEach, describe, expect, it } from 'vitest'

import { resolveApiBaseUrl } from '../src/data/config.ts'

describe('resolveApiBaseUrl', () => {
  afterEach(() => document.querySelector('meta[name="promax-api-base-url"]')?.remove())

  it('normalizes an explicit host-level override', () => {
    expect(resolveApiBaseUrl('  https://promax.example/api///  ')).toBe('https://promax.example/api')
  })

  it('reads the standalone host meta configuration', () => {
    const meta = document.createElement('meta')
    meta.name = 'promax-api-base-url'
    meta.content = 'http://localhost:4100/'
    document.head.append(meta)

    expect(resolveApiBaseUrl()).toBe('http://localhost:4100')
  })
})
