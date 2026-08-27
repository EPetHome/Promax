import { resolve } from 'node:path'

export interface ServerConfig {
  dataDirectory: string
  databasePath: string
  rawDirectory: string
  uploadsDirectory: string
  host: string
  port: number
  jwtSecret: string
  accessTtlSeconds: number
  refreshTtlSeconds: number
  staleAfterDays: number
  maxArtifactBytes: number
  rawGitBatchSize: number
  rawGitIntervalMs: number
  publicBaseUrl: string
  promateMcpUrl: string | undefined
  promateOrgId: string
  promateUserTokens: Readonly<Record<string, string>>
  promateTimeoutMs: number
  promateRetryAttempts: number
  promateRetryIntervalMs: number
  promateRequirementsTool: 'list_requirements' | 'my_requirements'
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function serviceUrl(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be an absolute HTTP(S) URL without embedded credentials`)
  }
  return parsed.toString()
}

export function parsePromateUserTokens(value: string | undefined): Readonly<Record<string, string>> {
  if (value === undefined || value.trim().length === 0) return Object.freeze({})
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('PROMAX_PROMATE_USER_TOKENS_JSON must be a JSON object')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PROMAX_PROMATE_USER_TOKENS_JSON must be a JSON object')
  }
  const result = Object.create(null) as Record<string, string>
  for (const [employeeId, token] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(employeeId)
      || typeof token !== 'string' || token.length === 0) {
      throw new Error('PROMAX_PROMATE_USER_TOKENS_JSON must map non-empty employee ids to non-empty tokens')
    }
    result[employeeId] = token
  }
  return Object.freeze(result)
}

export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const jwtSecret = environment.PROMAX_JWT_SECRET
  if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
    throw new Error('PROMAX_JWT_SECRET must contain at least 32 bytes')
  }

  const dataDirectory = resolve(environment.PROMAX_DATA_DIR ?? 'server/data')
  const port = positiveInteger(environment.PROMAX_PORT, 3000, 'PROMAX_PORT')
  if (port > 65_535) throw new Error('PROMAX_PORT must not exceed 65535')
  const maxArtifactBytes = positiveInteger(environment.PROMAX_MAX_ARTIFACT_BYTES, 1024 * 1024 * 1024, 'PROMAX_MAX_ARTIFACT_BYTES')
  if (maxArtifactBytes <= 5 * 1024 * 1024) throw new Error('PROMAX_MAX_ARTIFACT_BYTES must exceed 5MB')

  const host = environment.PROMAX_HOST ?? '127.0.0.1'
  const fallbackPublicHost = host === '0.0.0.0' ? '127.0.0.1' : host
  const publicBaseUrl = serviceUrl(
    environment.PROMAX_PUBLIC_BASE_URL ?? `http://${fallbackPublicHost}:${port}`,
    'PROMAX_PUBLIC_BASE_URL',
  )
  if (publicBaseUrl === undefined) throw new Error('PROMAX_PUBLIC_BASE_URL is required')
  const promateRequirementsTool = environment.PROMAX_PROMATE_REQUIREMENTS_TOOL ?? 'list_requirements'
  if (promateRequirementsTool !== 'list_requirements' && promateRequirementsTool !== 'my_requirements') {
    throw new Error('PROMAX_PROMATE_REQUIREMENTS_TOOL must be list_requirements or my_requirements')
  }
  const promateOrgId = environment.PROMAX_ORG_ID ?? 'promax-local'
  if (promateOrgId.length === 0) throw new Error('PROMAX_ORG_ID must not be empty')

  return {
    dataDirectory,
    databasePath: resolve(dataDirectory, 'promax.db'),
    rawDirectory: resolve(dataDirectory, 'raw'),
    uploadsDirectory: resolve(dataDirectory, 'uploads'),
    host,
    port,
    jwtSecret,
    accessTtlSeconds: positiveInteger(environment.PROMAX_ACCESS_TTL_SECONDS, 60 * 60, 'PROMAX_ACCESS_TTL_SECONDS'),
    refreshTtlSeconds: positiveInteger(environment.PROMAX_REFRESH_TTL_SECONDS, 30 * 24 * 60 * 60, 'PROMAX_REFRESH_TTL_SECONDS'),
    staleAfterDays: positiveInteger(environment.PROMAX_STALE_AFTER_DAYS, 14, 'PROMAX_STALE_AFTER_DAYS'),
    maxArtifactBytes,
    rawGitBatchSize: positiveInteger(environment.PROMAX_RAW_GIT_BATCH_SIZE, 100, 'PROMAX_RAW_GIT_BATCH_SIZE'),
    rawGitIntervalMs: positiveInteger(environment.PROMAX_RAW_GIT_INTERVAL_SECONDS, 24 * 60 * 60, 'PROMAX_RAW_GIT_INTERVAL_SECONDS') * 1000,
    publicBaseUrl,
    promateMcpUrl: serviceUrl(environment.PROMAX_PROMATE_MCP_URL, 'PROMAX_PROMATE_MCP_URL'),
    promateOrgId,
    promateUserTokens: parsePromateUserTokens(environment.PROMAX_PROMATE_USER_TOKENS_JSON),
    promateTimeoutMs: positiveInteger(environment.PROMAX_PROMATE_TIMEOUT_MS, 5_000, 'PROMAX_PROMATE_TIMEOUT_MS'),
    promateRetryAttempts: positiveInteger(environment.PROMAX_PROMATE_RETRY_ATTEMPTS, 4, 'PROMAX_PROMATE_RETRY_ATTEMPTS'),
    promateRetryIntervalMs: positiveInteger(environment.PROMAX_PROMATE_RETRY_INTERVAL_SECONDS, 30, 'PROMAX_PROMATE_RETRY_INTERVAL_SECONDS') * 1000,
    promateRequirementsTool,
  }
}
