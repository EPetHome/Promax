import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'

import type { ArtifactKind, ArtifactUploadRequest, HeartbeatPostRequest, TelemetryPostRequest } from '@promax/contracts'

import { CLIENT_VERSION, MAX_DIRECT_ARTIFACT_BYTES, type ResolvedConfig } from './config.ts'
import type { ReportLogger } from './outbox.ts'
import { DurableReportQueue } from './outbox.ts'
import type { ArtifactFileMetadata } from './outbox.ts'
import {
  isJudgeReportPath,
  loadTeamRevisionArtifactCatalog,
  type TeamRevisionArtifactCatalog,
} from './team-revision-artifacts.ts'

export interface SessionLike {
  readonly id: string
  readonly header: { readonly cwd?: string; readonly agentPreset?: string }
  readonly events: readonly unknown[]
}

export interface AgentLike {
  readonly id: string
  readonly session: SessionLike
}

export interface ToolExecutionLike {
  readonly name: string
  readonly arguments: unknown
  readonly agent?: AgentLike
}

export interface ToolResultLike {
  readonly isError: boolean
  readonly value?: unknown
}

const IGNORED_SCAN_DIRECTORIES = new Set([
  '.dsh',
  '.git',
  '.hg',
  '.svn',
  'coverage',
  'dist',
  'node_modules',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function resolveAgentPreset(session: SessionLike): string {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (!isRecord(event) || event.type !== 'agent-preset/selected' || !isRecord(event.data)) continue
    if (typeof event.data.agentPreset === 'string' && event.data.agentPreset.length > 0) {
      return event.data.agentPreset
    }
  }
  return session.header.agentPreset ?? 'unknown'
}

export function extractMutationPath(exec: ToolExecutionLike, result: ToolResultLike): string | undefined {
  if (result.isError) return undefined
  if (exec.name === 'write' || exec.name === 'edit') {
    return isRecord(result.value) && typeof result.value.path === 'string' ? result.value.path : undefined
  }
  if (exec.name !== 'str_replace_editor' || !isRecord(exec.arguments)) return undefined
  if (!['create', 'str_replace', 'insert'].includes(String(exec.arguments.command))) return undefined
  return typeof exec.arguments.path === 'string' ? exec.arguments.path : undefined
}

export function isMutationTool(exec: ToolExecutionLike): boolean {
  if (exec.name === 'write' || exec.name === 'edit') return true
  return exec.name === 'str_replace_editor' && isRecord(exec.arguments)
    && ['create', 'str_replace', 'insert'].includes(String(exec.arguments.command))
}

export function artifactKind(filename: string): ArtifactKind {
  switch (extname(filename).toLowerCase()) {
    case '.drawio':
    case '.jpeg':
    case '.jpg':
    case '.mmd':
    case '.png':
    case '.svg':
      return 'diagram'
    case '.htm':
    case '.html':
    case '.zip':
      return 'prototype'
    case '.doc':
    case '.docx':
    case '.md':
    case '.pdf':
      return 'prd'
    default:
      return 'other'
  }
}

function containedBy(root: string, target: string): boolean {
  const suffix = relative(root, target)
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix))
}

export class PromaxReporter {
  private localTail: Promise<void> = Promise.resolve()
  private readonly sessionStartedAt = new Map<string, number>()
  private readonly seenDigestByPath = new Map<string, string>()
  private readonly artifactCatalogByPreset = new Map<string, Promise<TeamRevisionArtifactCatalog | undefined>>()
  private lastOccurredAt = 0

  constructor(
    private readonly config: ResolvedConfig,
    private readonly queue: DurableReportQueue,
    private readonly configFingerprint: () => string,
    private readonly logger: ReportLogger,
  ) {}

  startSession(agent: AgentLike): void {
    if (!this.sessionStartedAt.has(agent.id)) this.sessionStartedAt.set(agent.id, Date.now())
  }

  heartbeat(): void {
    let fingerprint: string
    try {
      fingerprint = this.configFingerprint()
    } catch (error: unknown) {
      this.logger.warn(`promax-report could not fingerprint effective config: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const body: HeartbeatPostRequest = {
      employee_id: this.config.employeeId,
      client_version: CLIENT_VERSION,
      dsh_version: this.config.dshVersion,
      config_fingerprint: fingerprint,
    }
    this.queue.submit({ path: '/api/v1/heartbeat', body })
  }

  recordChat(agent: AgentLike): void {
    this.startSession(agent)
    this.telemetry(agent, 'chat', '-', [], 'success')
  }

  recordToolResult(exec: ToolExecutionLike, result: ToolResultLike): void {
    const agent = exec.agent
    if (!agent) return
    this.startSession(agent)

    if (exec.name === 'skill' && isRecord(exec.arguments) && typeof exec.arguments.name === 'string') {
      this.telemetry(agent, 'skill', exec.arguments.name, [], result.isError ? 'failed' : 'success')
    }

    if (!isMutationTool(exec)) return
    if (result.isError) {
      this.telemetry(agent, 'agent', resolveAgentPreset(agent.session), [], 'failed')
      return
    }
    const path = extractMutationPath(exec, result)
    if (path) this.scheduleLocal(() => this.reportArtifactPath(agent, path))
  }

  scanTurnArtifacts(agent: AgentLike): void {
    this.startSession(agent)
    this.scheduleLocal(() => this.scan(agent))
  }

  async idle(): Promise<void> {
    await this.localTail
    await this.queue.idle()
  }

  private scheduleLocal(operation: () => Promise<void>): void {
    const task = this.localTail.then(operation, operation)
    this.localTail = task.catch((error: unknown) => {
      this.logger.warn(`promax-report artifact observation failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private occurredAt(): string {
    const value = Math.max(Date.now(), this.lastOccurredAt + 1)
    this.lastOccurredAt = value
    return new Date(value).toISOString()
  }

  private telemetry(
    agent: AgentLike,
    eventType: TelemetryPostRequest['event_type'],
    target: string,
    outputFiles: string[],
    status: TelemetryPostRequest['status'],
  ): void {
    const body: TelemetryPostRequest = {
      employee_id: this.config.employeeId,
      event_type: eventType,
      target,
      source: 'hook',
      session_id: agent.id,
      occurred_at: this.occurredAt(),
      output_files: outputFiles,
      status,
    }
    this.queue.submit({ path: '/api/v1/telemetry', body })
  }

  private sessionCwd(agent: AgentLike): string | undefined {
    return agent.session.header.cwd ? resolve(agent.session.header.cwd) : undefined
  }

  private rootsFor(agent: AgentLike): string[] {
    const cwd = this.sessionCwd(agent)
    if (!cwd) return []
    return this.config.artifactRoots.map(root => isAbsolute(root) ? resolve(root) : resolve(cwd, root))
  }

  private async allowedCanonicalPath(agent: AgentLike, reportedPath: string): Promise<string | undefined> {
    const cwd = this.sessionCwd(agent)
    if (!cwd) return undefined
    const candidate = resolve(cwd, reportedPath)
    const canonical = await realpath(candidate)
    for (const root of this.rootsFor(agent)) {
      try {
        if (containedBy(await realpath(root), canonical)) return canonical
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return undefined
  }

  private async workspaceRelativePath(agent: AgentLike, path: string): Promise<string | undefined> {
    const cwd = this.sessionCwd(agent)
    if (!cwd) return undefined
    const suffix = relative(await realpath(cwd), path)
    if (suffix === '' || suffix === '..' || suffix.startsWith('../') || suffix.startsWith('..\\') || isAbsolute(suffix)) return undefined
    return suffix.replaceAll('\\', '/')
  }

  private artifactCatalog(presetId: string): Promise<TeamRevisionArtifactCatalog | undefined> {
    let catalog = this.artifactCatalogByPreset.get(presetId)
    if (!catalog) {
      catalog = loadTeamRevisionArtifactCatalog(this.config.dshHome, presetId)
      this.artifactCatalogByPreset.set(presetId, catalog)
    }
    return catalog
  }

  private async reportableArtifactKind(agent: AgentLike, path: string): Promise<ArtifactKind | undefined> {
    const workspaceRelativePath = await this.workspaceRelativePath(agent, path)
    if (workspaceRelativePath && isJudgeReportPath(workspaceRelativePath)) return undefined

    const presetId = resolveAgentPreset(agent.session)
    const catalog = await this.artifactCatalog(presetId)
    if (!catalog) return artifactKind(basename(path))
    if (!workspaceRelativePath) return undefined
    const kind = catalog.kindFor(workspaceRelativePath)
    if (!kind) {
      this.logger.debug(`promax-report skipped file not declared by TeamRevision ${presetId}: ${workspaceRelativePath}`)
    }
    return kind
  }

  private async reportArtifactPath(agent: AgentLike, reportedPath: string): Promise<void> {
    if (!this.config.artifactExtensions.has(extname(reportedPath).toLowerCase())) return
    const path = await this.allowedCanonicalPath(agent, reportedPath)
    if (!path) return
    const kind = await this.reportableArtifactKind(agent, path)
    if (!kind) return
    const metadata = await stat(path)
    if (!metadata.isFile()) return
    const seenKey = `${agent.id}\0${path}`
    if (metadata.size > MAX_DIRECT_ARTIFACT_BYTES) {
      if (metadata.size > this.config.maxArtifactBytes) {
        this.logger.warn(`promax-report skipped artifact above configured maximum (${this.config.maxArtifactBytes} bytes): ${path}`)
        return
      }
      const version = `file:${metadata.size}:${metadata.mtimeMs}`
      if (this.seenDigestByPath.get(seenKey) === version) return
      this.seenDigestByPath.set(seenKey, version)
      const filename = basename(path)
      const body: ArtifactFileMetadata = {
        employee_id: this.config.employeeId,
        project: this.config.project,
        agent: resolveAgentPreset(agent.session),
        kind,
        filename,
        created_at: metadata.mtime.toISOString(),
      }
      this.queue.submitArtifactFile(body, path)
      this.telemetry(agent, 'agent', body.agent, [filename], 'success')
      return
    }

    const content = await readFile(path)
    if (content.byteLength > MAX_DIRECT_ARTIFACT_BYTES) {
      this.logger.debug(`promax-report deferred growing >5MB artifact until chunk upload support: ${path}`)
      return
    }
    const digest = createHash('sha256').update(content).digest('hex')
    if (this.seenDigestByPath.get(seenKey) === digest) return
    this.seenDigestByPath.set(seenKey, digest)

    const filename = basename(path)
    const body: ArtifactUploadRequest = {
      employee_id: this.config.employeeId,
      project: this.config.project,
      agent: resolveAgentPreset(agent.session),
      kind,
      filename,
      created_at: metadata.mtime.toISOString(),
      sha256: digest,
      size: content.byteLength,
      content: content.toString('base64'),
    }
    this.queue.submit({ path: '/api/v1/artifacts', body })
    this.telemetry(agent, 'agent', body.agent, [filename], 'success')
  }

  private async scan(agent: AgentLike): Promise<void> {
    const modifiedAfter = this.sessionStartedAt.get(agent.id) ?? Date.now()
    let scanned = 0
    const pending = [...this.rootsFor(agent)]
    while (pending.length > 0 && scanned < this.config.maxScanFiles) {
      const directory = pending.pop()
      if (!directory) break
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') continue
        throw error
      }
      for (const entry of entries) {
        if (scanned >= this.config.maxScanFiles) break
        if (entry.isSymbolicLink()) continue
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) {
          if (!IGNORED_SCAN_DIRECTORIES.has(entry.name)) pending.push(path)
          continue
        }
        scanned += 1
        if (!entry.isFile() || !this.config.artifactExtensions.has(extname(entry.name).toLowerCase())) continue
        const metadata = await stat(path)
        if (metadata.mtimeMs + 1_000 < modifiedAfter) continue
        await this.reportArtifactPath(agent, path)
      }
    }
    if (pending.length > 0) {
      this.logger.warn(`promax-report stopped turn-end scan after ${this.config.maxScanFiles} files`)
    }
  }
}
