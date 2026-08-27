import { createHash } from 'node:crypto'

import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Context } from '@deepseek-ai/cordis'

function canonicalValue(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : `[${String(value)}]`
  if (typeof value === 'bigint') return `[bigint:${value.toString()}]`
  if (typeof value === 'undefined') return '[undefined]'
  if (typeof value === 'function') return `[function:${value.name || 'anonymous'}]`
  if (typeof value === 'symbol') return `[symbol:${value.description ?? ''}]`

  if (ancestors.has(value)) return '[circular]'
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return value.map(item => canonicalValue(item, ancestors))
    if (value instanceof Date) return value.toISOString()
    const object = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(object)
        .sort((left, right) => left.localeCompare(right))
        .map(key => [key, canonicalValue(object[key], ancestors)]),
    )
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, new Set()))
}

/** Hash the loader's effective, interpolated config tree without transmitting it. */
export function effectiveConfigFingerprint(ctx: Pick<Context, 'loader'>): string {
  const entries = [...ctx.loader.entries()]
    .map(entry => ({
      id: entry.id,
      name: entry.options.name,
      disabled: entry.disabled,
      config: entry.fiber?.config ?? entry.options.config ?? null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  return `sha256:${createHash('sha256').update(canonicalJson(entries)).digest('hex')}`
}
