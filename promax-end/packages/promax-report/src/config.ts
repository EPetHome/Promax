import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { isAbsolute, join, resolve } from 'node:path'

export const CLIENT_VERSION = '0.1.1'
export const DEFAULT_DSH_VERSION = '0.1.1-rc.2'
export const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1_000
export const MAX_DIRECT_ARTIFACT_BYTES = 5 * 1024 * 1024

export const DEFAULT_ARTIFACT_EXTENSIONS = [
  '.csv',
  '.doc',
  '.docx',
  '.drawio',
  '.htm',
  '.html',
  '.jpeg',
  '.jpg',
  '.md',
  '.mmd',
  '.pdf',
  '.png',
  '.ppt',
  '.pptx',
  '.svg',
  '.xls',
  '.xlsx',
  '.zip',
] as const

export interface Config {
  /** Promax server origin, for example `https://promax.example.com`. */
  baseUrl: string
  /** Short-lived access token issued by `POST /api/v1/auth/login`. */
  accessToken: string
  /** Rotating refresh token issued by `POST /api/v1/auth/login`. */
  refreshToken: string
  /** Employee id bound to the token pair. */
  employeeId: string
  /** Project attached to artifacts; defaults to the contract's `未归属`. */
  project?: string
  /** dsh version reported by heartbeat. */
  dshVersion?: string
  /** Explicit dsh home; omitted follows `$DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Rotated token store; relative paths are resolved beneath dsh home. */
  tokenStorePath?: string
  /** Roots scanned at turn end, relative to each session cwd unless absolute. */
  artifactRoots?: string[]
  /** File extensions treated as artifacts. */
  artifactExtensions?: string[]
  /** Upper bound for a single turn-end scan. */
  maxScanFiles?: number
  /** Largest artifact the client will snapshot for chunk upload. */
  maxArtifactBytes?: number
  /** Per-request timeout. */
  requestTimeoutMs?: number
}

export interface ResolvedConfig {
  baseUrl: string
  accessToken: string
  refreshToken: string
  employeeId: string
  project: string
  dshVersion: string
  dshHome: string
  tokenStorePath: string
  artifactRoots: readonly string[]
  artifactExtensions: ReadonlySet<string>
  maxScanFiles: number
  maxArtifactBytes: number
  requestTimeoutMs: number
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().required(),
  accessToken: z.string().required().role('secret'),
  refreshToken: z.string().required().role('secret'),
  employeeId: z.string().required(),
  project: z.string().default('未归属'),
  dshVersion: z.string().default(DEFAULT_DSH_VERSION),
  dshHome: z.string(),
  tokenStorePath: z.string(),
  artifactRoots: z.array(z.string()).default(['.']),
  artifactExtensions: z.array(z.string()).default([...DEFAULT_ARTIFACT_EXTENSIONS]),
  maxScanFiles: z.number().default(5_000),
  maxArtifactBytes: z.number().default(1024 * 1024 * 1024),
  requestTimeoutMs: z.number().default(15_000),
})

function nonBlank(value: string, name: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`promax-report: ${name} must be non-empty`)
  return normalized
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`promax-report: ${name} must be a positive safe integer`)
  }
  return value
}

function extension(value: string): string {
  const normalized = nonBlank(value, 'artifactExtensions entry').toLowerCase()
  return normalized.startsWith('.') ? normalized : `.${normalized}`
}

export function resolveConfig(config: Config): ResolvedConfig {
  const rawBaseUrl = nonBlank(config.baseUrl, 'baseUrl')
  const baseUrl = new URL(rawBaseUrl)
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error('promax-report: baseUrl must use http or https')
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('promax-report: baseUrl must not contain credentials, query, or fragment')
  }

  const roots = config.artifactRoots ?? ['.']
  if (roots.length === 0 || roots.some(root => root.trim().length === 0)) {
    throw new Error('promax-report: artifactRoots must contain non-empty paths')
  }

  const extensions = config.artifactExtensions ?? [...DEFAULT_ARTIFACT_EXTENSIONS]
  if (extensions.length === 0) throw new Error('promax-report: artifactExtensions must not be empty')
  const dshHome = resolveDshHome(config.dshHome)
  const configuredTokenStore = config.tokenStorePath?.trim()
  if (config.tokenStorePath !== undefined && !configuredTokenStore) {
    throw new Error('promax-report: tokenStorePath must be non-empty when provided')
  }
  const tokenStorePath = configuredTokenStore
    ? isAbsolute(configuredTokenStore) ? resolve(configuredTokenStore) : resolve(dshHome, configuredTokenStore)
    : join(dshHome, 'promax', 'auth.json')

  return {
    baseUrl: baseUrl.toString().replace(/\/+$/u, ''),
    accessToken: nonBlank(config.accessToken, 'accessToken'),
    refreshToken: nonBlank(config.refreshToken, 'refreshToken'),
    employeeId: nonBlank(config.employeeId, 'employeeId'),
    project: nonBlank(config.project ?? '未归属', 'project'),
    dshVersion: nonBlank(config.dshVersion ?? DEFAULT_DSH_VERSION, 'dshVersion'),
    dshHome,
    tokenStorePath,
    artifactRoots: roots.map(root => root.trim()),
    artifactExtensions: new Set(extensions.map(extension)),
    maxScanFiles: positiveSafeInteger(config.maxScanFiles ?? 5_000, 'maxScanFiles'),
    maxArtifactBytes: positiveSafeInteger(config.maxArtifactBytes ?? 1024 * 1024 * 1024, 'maxArtifactBytes'),
    requestTimeoutMs: positiveSafeInteger(config.requestTimeoutMs ?? 15_000, 'requestTimeoutMs'),
  }
}
