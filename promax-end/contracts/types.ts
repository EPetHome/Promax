/** ISO 8601 date-time string with an explicit timezone offset. */
export type IsoDateTime = string

/** Lowercase hexadecimal SHA-256 digest. */
export type Sha256 = string

export type EmployeeRole = 'member' | 'admin'
export type ArtifactKind = 'prd' | 'diagram' | 'prototype' | 'other'
export type TelemetryEventType = 'agent' | 'skill' | 'chat'
export type TelemetrySource = 'hook' | 'llm'
export type TelemetryStatus = 'success' | 'failed'
export type UserReportStatus = 'ok' | 'stale' | 'never'
export type TelemetryGroupBy = 'day' | 'user' | 'target'
export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMIT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL'

export type PromateNextType = 'choose_one' | 'confirm' | 'ask_text' | 'done'
export type PromateArtifactType =
  | '调研报告'
  | '需求文档PRD'
  | '产品方案'
  | '原型'
  | '评审记录'
  | '技术方案'
  | '竞品分析'
  | '市场调研'
export type PromateOperationStatus = 'proposed' | 'pending' | 'synced' | 'dead'

export interface LoginRequest {
  employee_id: string
  password: string
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_expires_in: number
}

export interface RefreshRequest {
  refresh_token: string
}

export type RefreshResponse = LoginResponse

export interface LogoutRequest {
  refresh_token: string
}

/** The logout endpoint succeeds with HTTP 204 and no response body. */
export type LogoutResponse = void

export interface MeResponse {
  employee_id: string
  name: string
  dept: string
  role: EmployeeRole
}

export interface PromateNextOption {
  value: string
  label: string
}

/** Agent-facing interaction instruction. Upstream confirmation tokens never leave the server. */
export interface PromateNext {
  type: PromateNextType
  question?: string
  options?: PromateNextOption[]
  then_call?: string
  then_arg?: string
  instruction?: string
}

export interface PromateEnvelope<T> {
  request_id: string
  ok: boolean
  data: T
  next?: PromateNext
  error_code?: string
  message?: string
}

export interface PromateProject {
  project_id: string
  name: string
  req_count: number
}

export type PromateProjectsResponse = PromateEnvelope<PromateProject[]>

export interface PromateRequirementsQuery {
  project_id: string
  query?: string
  include_done?: boolean
}

export interface PromateRequirement {
  requirement_id: string
  title: string
  version: string
  done: boolean
  artifact_count: number
}

export type PromateRequirementsResponse = PromateEnvelope<PromateRequirement[]>

export interface PromateSkillsQuery {
  query?: string
  category?: string
}

export interface PromateSkillSummary {
  id: string
  name: string
  version: string
  author: string
  category: string
  description: string
  updated_at: string
}

export type PromateSkillsResponse = PromateEnvelope<PromateSkillSummary[]>

export interface PromateSkillFile {
  path: string
  content: string
}

export interface PromateSkill extends Pick<PromateSkillSummary, 'id' | 'name' | 'version'> {
  files: PromateSkillFile[]
  download_url: string
}

export type PromateSkillResponse = PromateEnvelope<PromateSkill>

export interface PromateArtifactProposeRequest {
  stage: 'propose'
  artifact_id: string
  project_id: string
  requirement_id: string
  type: PromateArtifactType
  summary?: string
}

export interface PromateArtifactCommitRequest {
  stage: 'commit'
  request_id: string
}

export type PromateArtifactRequest = PromateArtifactProposeRequest | PromateArtifactCommitRequest

export interface PromateArtifactOperation {
  request_id: string
  artifact_id: string
  project_id: string
  requirement_id: string
  status: PromateOperationStatus
  attempts: number
  promate_artifact_id?: string
  requirement_url?: string
  last_error_code?: string
}

export type PromateArtifactResponse = PromateEnvelope<PromateArtifactOperation>
export type PromateOperationResponse = PromateEnvelope<PromateArtifactOperation>

export interface ArtifactUploadMetadata {
  employee_id: string
  project: string
  agent: string
  kind: ArtifactKind
  filename: string
  created_at: IsoDateTime
  sha256: Sha256
  size: number
}

export interface ArtifactUploadRequest extends ArtifactUploadMetadata {
  /** Base64-encoded file bytes. */
  content: string
}

export interface ArtifactCreatedResponse {
  artifact_id: string
  path: string
}

export interface ArtifactDuplicateResponse {
  artifact_id: string
  duplicate: true
}

export type ArtifactUploadResponse = ArtifactCreatedResponse | ArtifactDuplicateResponse

export interface TelemetryPostRequest {
  employee_id: string
  event_type: TelemetryEventType
  target: string
  source: TelemetrySource
  session_id: string
  occurred_at: IsoDateTime
  output_files: string[]
  status: TelemetryStatus
}

export type TelemetryPostResponse = Record<string, never>

export interface HeartbeatPostRequest {
  employee_id: string
  client_version: string
  dsh_version: string
  config_fingerprint: string
}

export type HeartbeatPostResponse = Record<string, never>

export interface ConsoleOverviewResponse {
  users_total: number
  users_active_7d: number
  artifacts_total: number
  artifacts_7d: number
  /** Ratio of users whose report status is `ok`, in the inclusive range 0..1. */
  coverage_rate: number
}

export interface ConsoleUser {
  employee_id: string
  name: string
  dept: string
  last_report_at: IsoDateTime | null
  artifacts_count: number
  status: UserReportStatus
}

export type ConsoleUsersResponse = ConsoleUser[]

export interface ConsoleArtifactsQuery {
  employee_id?: string
  project?: string
  kind?: ArtifactKind
  from?: IsoDateTime
  to?: IsoDateTime
  page?: number
  size?: number
}

export interface ConsoleArtifact {
  artifact_id: string
  employee_id: string
  project: string
  agent: string
  kind: ArtifactKind
  filename: string
  created_at: IsoDateTime
  size: number
  path: string
}

export interface ConsoleArtifactsResponse {
  total: number
  items: ConsoleArtifact[]
}

export interface ConsoleTelemetryQuery {
  event_type?: TelemetryEventType
  source?: TelemetrySource
  from?: IsoDateTime
  to?: IsoDateTime
  group_by?: TelemetryGroupBy
}

/** `key` is a day, employee id, or target according to the requested `group_by`. */
export interface ConsoleTelemetrySeriesPoint {
  key: string
  event_type: TelemetryEventType
  source: TelemetrySource
  count: number
}

export interface ConsoleTelemetryResponse {
  series: ConsoleTelemetrySeriesPoint[]
}

/** File bytes returned by the artifact download endpoint. */
export type ArtifactDownloadResponse = Uint8Array

export type ArtifactInitRequest = ArtifactUploadMetadata

export interface ArtifactInitResponse {
  upload_id: string
  chunk_size: number
}

/** Raw binary bytes sent as `application/octet-stream`. */
export type ArtifactChunkPutRequest = Uint8Array

/** The chunk endpoint succeeds with HTTP 204 and no response body. */
export type ArtifactChunkPutResponse = void

export type ArtifactCompleteResponse = ArtifactUploadResponse

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode
    message: string
    detail: Record<string, unknown>
  }
}
