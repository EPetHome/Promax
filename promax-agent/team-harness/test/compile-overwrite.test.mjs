import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const harnessDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(harnessDir, 'src', 'cli.mjs')
const definition = join(harnessDir, 'definitions', 'promax-product-team.yml')
const presetId = 'promax-team'

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: harnessDir,
    encoding: 'utf8',
    ...options,
  })
}

function compileArgs(output, extra = []) {
  return ['compile', '--definition', definition, '--revision', '1', '--output', output, ...extra]
}

function treeSnapshot(root) {
  const entries = []
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = join(prefix, entry.name)
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute, relative)
      else entries.push([relative, readFileSync(absolute).toString('base64')])
    }
  }
  visit(root)
  return entries
}

function writeFailurePreload(directory, failureKind) {
  const preload = join(directory, `fail-${failureKind}.mjs`)
  const source = failureKind === 'staging-write'
    ? `
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
const original = fs.writeFileSync
let stagingWrites = 0
fs.writeFileSync = function (path, ...args) {
  if (String(path).includes('.staging-') && ++stagingWrites === 2) throw new Error('TEST_STAGING_WRITE_FAILURE')
  return original.call(this, path, ...args)
}
syncBuiltinESMExports()
`
    : failureKind === 'atomic-exchange'
      ? `
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
const original = childProcess.spawnSync
childProcess.spawnSync = function (command, args, options) {
  if (Array.isArray(args) && String(args[1]).includes('ATOMIC_DIRECTORY_EXCHANGE_FAILED')) {
    return { status: 73, signal: null, stdout: '', stderr: 'TEST_ATOMIC_EXCHANGE_FAILURE' }
  }
  return original.call(this, command, args, options)
}
syncBuiltinESMExports()
`
      : `
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
const original = childProcess.spawnSync
childProcess.spawnSync = function (command, args, options) {
  const result = original.call(this, command, args, options)
  if (Array.isArray(args) && String(args[1]).includes('ATOMIC_DIRECTORY_EXCHANGE_FAILED') && result.status === 0) {
    process.stderr.write('TEST_CRASH_AFTER_ATOMIC_EXCHANGE\\n')
    process.exit(86)
  }
  return result
}
syncBuiltinESMExports()
`
  writeFileSync(preload, source)
  return preload
}

test('compile defaults to immutable and the CLI flag overwrites an explicit output directory', () => {
  const output = mkdtempSync(join(tmpdir(), 'prx-002-cli-'))
  try {
    const first = runCli(compileArgs(output))
    assert.equal(first.status, 0, first.stderr)
    const target = join(output, presetId)
    const beforeManifest = readFileSync(join(target, 'manifest.sha256'), 'utf8')

    const rejected = runCli(compileArgs(output))
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /REVISION_IMMUTABLE/)

    const overwritten = runCli(compileArgs(output, ['--allow-overwrite']))
    assert.equal(overwritten.status, 0, overwritten.stderr)
    assert.equal(JSON.parse(overwritten.stdout).outputPath, target)
    assert.equal(readFileSync(join(target, 'manifest.sha256'), 'utf8'), beforeManifest)

    const verified = runCli(['verify', '--revision', target])
    assert.equal(verified.status, 0, verified.stderr)
    const verification = JSON.parse(verified.stdout)
    assert.equal(verification.status, 'valid')
    assert.equal(verification.files, beforeManifest.trim().split('\n').length)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})

test('覆盖前归档失败时拒绝覆盖并保持现有 preset 完整', () => {
  const output = mkdtempSync(join(tmpdir(), 'prx-006-archive-'))
  try {
    execFileSync(process.execPath, [cli, ...compileArgs(output)], { cwd: harnessDir })
    const target = join(output, presetId)
    const before = treeSnapshot(target)
    const blockedArchiveRoot = join(output, 'archive-root-is-a-file')
    writeFileSync(blockedArchiveRoot, 'not a directory\n')

    const failed = runCli(compileArgs(output, ['--allow-overwrite', '--archive-root', blockedArchiveRoot]))
    assert.notEqual(failed.status, 0)
    assert.match(failed.stderr, /PRESET_ARCHIVE_FAILED/)
    assert.deepEqual(treeSnapshot(target), before)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})

test('a staging write failure leaves the existing revision byte-for-byte intact', () => {
  const output = mkdtempSync(join(tmpdir(), 'prx-002-staging-'))
  try {
    execFileSync(process.execPath, [cli, ...compileArgs(output)], { cwd: harnessDir })
    const target = join(output, presetId)
    writeFileSync(join(target, 'existing-sentinel.txt'), 'old revision remains installed\n')
    const before = treeSnapshot(target)
    const preload = writeFailurePreload(output, 'staging-write')

    const failed = spawnSync(process.execPath, ['--import', preload, cli, ...compileArgs(output, ['--allow-overwrite'])], {
      cwd: harnessDir,
      encoding: 'utf8',
    })
    assert.notEqual(failed.status, 0)
    assert.match(failed.stderr, /TEST_STAGING_WRITE_FAILURE/)
    assert.deepEqual(treeSnapshot(target), before)
    assert.equal(readdirSync(output).some(name => name.includes('.staging-')), false)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})

test('an atomic exchange failure leaves the existing revision byte-for-byte intact', () => {
  const output = mkdtempSync(join(tmpdir(), 'prx-002-exchange-'))
  try {
    execFileSync(process.execPath, [cli, ...compileArgs(output)], { cwd: harnessDir })
    const target = join(output, presetId)
    writeFileSync(join(target, 'existing-sentinel.txt'), 'old revision remains installed\n')
    const before = treeSnapshot(target)
    const preload = writeFailurePreload(output, 'atomic-exchange')

    const failed = spawnSync(process.execPath, ['--import', preload, cli, ...compileArgs(output, ['--allow-overwrite'])], {
      cwd: harnessDir,
      encoding: 'utf8',
    })
    assert.notEqual(failed.status, 0)
    assert.match(failed.stderr, /TEST_ATOMIC_EXCHANGE_FAILURE/)
    assert.deepEqual(treeSnapshot(target), before)
    assert.equal(readdirSync(output).some(name => name.includes('.backup-') || name.includes('.staging-')), false)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})

test('a hard exit after the atomic exchange never exposes a missing target or temporary directory', () => {
  const output = mkdtempSync(join(tmpdir(), 'prx-002-crash-'))
  try {
    execFileSync(process.execPath, [cli, ...compileArgs(output)], { cwd: harnessDir })
    const target = join(output, presetId)
    writeFileSync(join(target, 'existing-sentinel.txt'), 'old revision remains installed\n')
    const preload = writeFailurePreload(output, 'crash-after-exchange')

    const crashed = spawnSync(process.execPath, ['--import', preload, cli, ...compileArgs(output, ['--allow-overwrite'])], {
      cwd: harnessDir,
      encoding: 'utf8',
    })
    assert.equal(crashed.status, 86)
    assert.match(crashed.stderr, /TEST_CRASH_AFTER_ATOMIC_EXCHANGE/)
    assert.throws(() => readFileSync(join(target, 'existing-sentinel.txt'), 'utf8'), { code: 'ENOENT' })
    const verified = runCli(['verify', '--revision', target])
    assert.equal(verified.status, 0, verified.stderr)
    assert.equal(readdirSync(output).some(name => name.includes('.backup-') || name.includes('.staging-')), false)
  } finally {
    rmSync(output, { recursive: true, force: true })
  }
})
