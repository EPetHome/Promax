import { spawn } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface RawGitBatcherOptions {
  batchSize?: number
  intervalMs?: number
  now?: () => Date
  onError?: (error: unknown) => void
}

interface GitResult {
  code: number
  stdout: string
  stderr: string
}

const DEFAULT_BATCH_SIZE = 100
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Maintains raw/ as its own repository while keeping Git outside the upload request path. */
export class RawGitBatcher {
  private readonly batchSize: number
  private readonly intervalMs: number
  private readonly now: () => Date
  private readonly onError: (error: unknown) => void
  private timer: NodeJS.Timeout | undefined
  private activeFlush: Promise<void> | undefined
  private pendingArtifacts = 0
  private started = false
  private closing = false

  constructor(
    private readonly rawDirectory: string,
    options: RawGitBatcherOptions = {},
  ) {
    this.batchSize = positiveInteger(options.batchSize ?? DEFAULT_BATCH_SIZE, 'batchSize')
    this.intervalMs = positiveInteger(options.intervalMs ?? DEFAULT_INTERVAL_MS, 'intervalMs')
    this.now = options.now ?? (() => new Date())
    this.onError = options.onError ?? (() => undefined)
  }

  async start(): Promise<void> {
    if (this.started) return
    await mkdir(this.rawDirectory, { recursive: true })
    if (!(await exists(join(this.rawDirectory, '.git')))) {
      await git(this.rawDirectory, ['init', '-b', 'main'])
    }
    this.started = true

    // A previous process may have stopped before its daily/batch commit. Adopt it
    // immediately so those files do not remain outside Git until the next window.
    const pendingChanges = await this.changeCount()
    if (pendingChanges > 0) {
      this.pendingArtifacts = Math.max(this.pendingArtifacts, pendingChanges)
      await this.flush()
    } else if (this.pendingArtifacts > 0) {
      this.schedule()
    }
  }

  /** Called only after the file and its database record have both been persisted. */
  noteArtifact(): void {
    this.pendingArtifacts += 1
    if (!this.started || this.closing) return
    if (this.pendingArtifacts >= this.batchSize) {
      void this.flush().catch(this.onError)
      return
    }
    this.schedule()
  }

  flush(): Promise<void> {
    if (!this.started) return Promise.resolve()
    if (this.activeFlush) return this.activeFlush
    this.clearTimer()
    const operation = this.flushNow()
    this.activeFlush = operation
    void operation.finally(() => {
      if (this.activeFlush === operation) this.activeFlush = undefined
      if (this.closing || this.pendingArtifacts === 0) return
      if (this.pendingArtifacts >= this.batchSize) void this.flush().catch(this.onError)
      else this.schedule()
    }).catch(() => undefined)
    return operation
  }

  async close(): Promise<void> {
    if (!this.started || this.closing) return
    this.closing = true
    this.clearTimer()
    if (this.activeFlush) await this.activeFlush
    await this.flushNow()
  }

  private async flushNow(): Promise<void> {
    const includedArtifacts = this.pendingArtifacts
    this.pendingArtifacts = 0
    try {
      await git(this.rawDirectory, ['add', '--all'])
      const staged = await git(this.rawDirectory, ['diff', '--cached', '--quiet'], [0, 1])
      if (staged.code === 0) return

      const date = this.now().toISOString().slice(0, 10)
      const count = Math.max(includedArtifacts, 1)
      await git(this.rawDirectory, [
        'commit',
        '--no-gpg-sign',
        '-m',
        `promax raw ${date} batch (${count} artifacts)`,
      ], [0], {
        GIT_AUTHOR_NAME: 'Promax Server',
        GIT_AUTHOR_EMAIL: 'promax@localhost',
        GIT_COMMITTER_NAME: 'Promax Server',
        GIT_COMMITTER_EMAIL: 'promax@localhost',
      })
    } catch (error) {
      this.pendingArtifacts += Math.max(includedArtifacts, 1)
      throw error
    }
  }

  private async changeCount(): Promise<number> {
    const result = await git(this.rawDirectory, ['status', '--porcelain', '--untracked-files=all', '-z'])
    return result.stdout.split('\0').filter(Boolean).length
  }

  private schedule(): void {
    if (this.timer || this.closing) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush().catch(this.onError)
    }, this.intervalMs)
    this.timer.unref()
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function git(
  cwd: string,
  args: string[],
  acceptedCodes: number[] = [0],
  additionalEnvironment: NodeJS.ProcessEnv = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, ...additionalEnvironment },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      const result = {
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }
      if (acceptedCodes.includes(result.code)) resolve(result)
      else reject(new Error(`git ${args.join(' ')} failed (${result.code}): ${result.stderr.trim()}`))
    })
  })
}
