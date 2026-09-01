import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)

test('packed plugin installs outside the workspace with self-contained contract types', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promax-package-install-'))
  const tarball = join(directory, 'promax-promax-report-0.1.4.tgz')
  try {
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name: 'promax-package-consumer',
      version: '1.0.0',
      private: true,
      type: 'module',
      packageManager: 'pnpm@11.7.0',
    }))
    await run('pnpm', [
      '--filter', '@promax/promax-report', 'pack',
      '--pack-destination', directory,
    ])
    await run('pnpm', ['--dir', directory, 'add', '--offline', tarball])

    const installedPackage = JSON.parse(await readFile(
      join(directory, 'node_modules', '@promax', 'promax-report', 'package.json'),
      'utf8',
    )) as { dependencies?: Record<string, string> }
    assert.equal(installedPackage.dependencies?.['@promax/contracts'], undefined)
    assert.match(await readFile(
      join(directory, 'node_modules', '@promax', 'promax-report', 'lib', 'types', 'contracts.d.ts'),
      'utf8',
    ), /export interface ArtifactUploadMetadata/u)

    const runtime = await run(process.execPath, [
      '--input-type=module',
      '-e',
      "const plugin=await import('@promax/promax-report'); console.log(JSON.stringify({name:plugin.name,apply:typeof plugin.apply,config:typeof plugin.Config}))",
    ], directory)
    assert.deepEqual(JSON.parse(runtime.stdout), { name: 'promax-report', apply: 'function', config: 'function' })

    const consumer = join(directory, 'consumer.mts')
    await writeFile(consumer, [
      "import { artifactKind } from '@promax/promax-report'",
      "const kind: ReturnType<typeof artifactKind> = 'prd'",
      'void kind',
      '',
    ].join('\n'))
    await run('pnpm', [
      'exec', 'tsc', '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck',
      '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
      '--lib', 'ES2023,DOM', consumer,
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

async function run(command: string, args: string[], cwd = resolve('.')): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(command, args, { cwd })
  } catch (error: unknown) {
    if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
      throw new Error(`${error.message}\nstdout:\n${String(error.stdout)}\nstderr:\n${String(error.stderr)}`)
    }
    throw error
  }
}
