import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function contractFixture<T>(name: string): T {
  const path = resolve(process.cwd(), '../promax-end/contracts/fixtures', name)
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
