import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalJson, effectiveConfigFingerprint } from '../src/fingerprint.ts'

test('canonical config serialization is key-order independent', () => {
  assert.equal(canonicalJson({ z: 1, nested: { b: 2, a: 1 } }), canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }))
})

test('effective fingerprint sorts loader entries and uses active fiber config', () => {
  const entryA = { id: 'a', options: { name: 'plugin-a', config: { stale: true } }, disabled: false, fiber: { config: { enabled: true } } }
  const entryB = { id: 'b', options: { name: 'plugin-b', config: { count: 2 } }, disabled: true }
  const first = effectiveConfigFingerprint({ loader: { entries: function* () { yield entryB; yield entryA } } } as never)
  const second = effectiveConfigFingerprint({ loader: { entries: function* () { yield entryA; yield entryB } } } as never)
  assert.match(first, /^sha256:[0-9a-f]{64}$/u)
  assert.equal(first, second)
})
