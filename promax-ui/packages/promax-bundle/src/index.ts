import { createHash, randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, extname, join, resolve, sep } from 'node:path'

import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import YAML from 'yaml'
import { createApiProxy } from '../../promax-ui-console/src/host/api-proxy.ts'

interface WorkspaceRecord {
  id: string
  path: string
  title: string
  sessionIds: readonly string[]
}

interface WorkspaceRegistry {
  create(path: string, title?: string): Promise<WorkspaceRecord>
  get?(workspaceId: string): WorkspaceRecord | undefined
}

interface WebServer {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

interface SettingsScope<T> {
  get(): T
  watch(listener: (next: T, previous: T) => void | Promise<void>): () => void
  update(patch: Partial<T>): Promise<T>
}

interface SettingsService {
  register<T>(ns: string, schema: unknown, options: { base: T; applies: 'live' | 'restart' }): SettingsScope<T>
}

interface CredentialsService {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
}

interface MappedToolRunContext {
  callId: string
  rootCallId: string
  token: symbol
  agent?: unknown
  signal: AbortSignal
  deferContext(context: unknown): void
  concludeTurn(): void
}

interface MappedToolResult {
  isError: boolean
  value?: unknown
  content: readonly unknown[]
  error?: { message?: string }
  additionalContexts?: readonly unknown[]
  concludesTurn?: true
}

interface MappedToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
  }
  execute(args: unknown, exec: MappedToolRunContext): Promise<unknown>
}

interface ToolsService {
  schemas(): Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>
  register(definition: MappedToolDefinition): () => void
  get(name: string, scope?: unknown): MappedToolDefinition | undefined
  execute(exec: {
    callId: string
    rootCallId: string
    parent: symbol
    name: string
    arguments: unknown
    agent?: unknown
    signal: AbortSignal
  }): Promise<MappedToolResult>
}

interface PluginFiber {
  dispose(): void | Promise<void>
}

interface ChildAgentContext {
  agent: unknown
  tools: ToolsService
  systemPrompt: {
    assemble(input: { scope: unknown }): Promise<{ sections: Array<{ name: string; text?: string }> }>
  }
  effect(setup: () => void | (() => void), label?: string): void
}

interface CreatedAgentPayload {
  agent: {
    session: { header: { origin?: string } }
    ctx: ChildAgentContext
  }
}

interface HostContext {
  workspaceRegistry: WorkspaceRegistry
  webServer: WebServer
  settings: SettingsService
  credentials: CredentialsService
  tools: ToolsService
  effect(setup: () => void | (() => void), label?: string): void
  on(event: 'webserver/index-inject', listener: (table: Array<Record<string, unknown>>) => void): void
  on(event: 'credentials/reference-updated', listener: (ref: string) => void): void
  on(event: 'tools/change', listener: () => void): void
  on(event: 'tools/pre-execute', listener: (exec: DispatchToolExecution, next: () => Promise<unknown>) => Promise<unknown>): void
  on(event: 'agent/turn-stopping', listener: (payload: DispatchTurnStopping) => void | Promise<void>): void
  on(event: 'agent/created', listener: (payload: CreatedAgentPayload) => void): void
  plugin(plugin: unknown, config: Record<string, unknown>): Promise<PluginFiber>
  emit(event: 'promax/decision', payload: Record<string, unknown>): void
}

export const name = 'promax-workspace-bootstrap'
export const inject = ['workspaceRegistry', 'webServer', 'settings', 'credentials', 'tools']

export interface Config {
  apiBaseUrl: string
}

export type TaskRunCancellationState = 'running' | 'stop_requested' | 'draining' | 'cancelled' | 'completed' | 'failed'
export type TaskRunJudgeState = 'absent' | 'pass' | 'fail' | 'appealed' | 'human_required' | 'force_released' | 'unverified'
export type TaskJudgeRepairState = 'repairing' | 'judging' | 'passed' | 'exhausted'

export interface TaskJudgeRepairSnapshot {
  state: TaskJudgeRepairState
  round: number
  maxRounds: number
  reasons: string[]
  updatedAt: string
}

export interface TaskDeliverableFile {
  name: string
  relativePath: string
  path: string
  bytes: number
  modifiedAt: string
}

export type TaskHistoryStatus = 'running' | 'completed' | 'failed'

export interface TaskRunFileSnapshot {
  taskKey: string
  parentSessionId: string
  createdAt: string
  cancellation: TaskRunCancellationState
  runEpoch: number
  manifestPath: string
  inputManifestPath: string
  confirmedMemberIds: string[]
  artifactStates: Array<{ path: string; memberId: string; exists: boolean; nonEmpty: boolean }>
  deliverablePath: string
  deliverableFiles: TaskDeliverableFile[]
  judge: { path: string; memberId: 'quality_judge'; state: TaskRunJudgeState; exists: boolean; nonEmpty: boolean; reason?: string }
  repair?: TaskJudgeRepairSnapshot
  observedAt: string
}

export interface TaskHistoryItem {
  sessionId: string
  taskKey: string
  createdAt: string
  status: TaskHistoryStatus
  fileCount: number
  deliverablePath: string
  deliverableFiles: TaskDeliverableFile[]
  judge: TaskRunFileSnapshot['judge']
  observedAt: string
  error?: string
}

interface DispatchToolExecution {
  name: string
  arguments?: unknown
  agent?: {
    session: {
      header: { id: string; origin?: string; cwd?: string }
      events?: readonly DispatchSessionEvent[]
    }
  }
}

function isPathInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function shellCommandMayWrite(command: string): boolean {
  return /(?:^|[\s;&|])(?:rm|mv|cp|install|mkdir|rmdir|touch|truncate|chmod|chown|chflags|ln|dd|patch|rsync|tar|unzip|ed|ex)\b/iu.test(command)
    || /(?:^|[\s;&|])(?:sed|perl)\b[^\n;&|]*\s-i[^\s;&|]*(?:\s|$)/iu.test(command)
    || /(?:^|[\s;&|])(?:python(?:3(?:\.\d+)?)?|ruby|node)\b/iu.test(command)
    || /(?:^|[\s;&|])tee\b/iu.test(command)
    || /(?:^|[^<])>{1,2}(?![>&])/u.test(command)
}

/**
 * The frozen input tree is platform-owned after submission. This guard keeps
 * every agent tool on the read side of that boundary; platform internals write
 * the tree directly and therefore do not pass through the tool pipeline.
 */
export function frozenInputMutationReason(exec: DispatchToolExecution): string | undefined {
  const cwd = exec.agent?.session.header.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') return undefined
  const inputRoot = resolve(cwd, '.promax', 'input')
  const args = typeof exec.arguments === 'object' && exec.arguments !== null && !Array.isArray(exec.arguments)
    ? exec.arguments as Record<string, unknown>
    : {}
  const pathKeys = ['file_path', 'path', 'source', 'destination', 'target', 'old_path', 'new_path'] as const
  const targetsFrozenInput = pathKeys.some(key => typeof args[key] === 'string' && isPathInside(inputRoot, resolve(cwd, args[key])))
  const directMutator = ['write', 'edit', 'delete', 'move', 'rename', 'copy'].includes(exec.name)
  if (directMutator && targetsFrozenInput) {
    return '冻结输入由 Promax 平台管理，Agent 只能读取 .promax/input；请只写任务包登记的 deliverables 或 Judge 路径'
  }
  if (exec.name !== 'bash') return undefined
  const command = typeof args.command === 'string' ? args.command : ''
  const workdir = typeof args.workdir === 'string' ? resolve(cwd, args.workdir) : cwd
  const referencesFrozenInput = /(?:^|[\s'"`=])(?:\.\/)?\.promax\/input(?:\/|\b)/u.test(command)
    || command.includes(`${inputRoot}${sep}`)
    || isPathInside(inputRoot, workdir)
  if (referencesFrozenInput && shellCommandMayWrite(command)) {
    return '冻结输入由 Promax 平台管理，禁止通过 shell 修改 .promax/input；读取、校验哈希和引用仍然允许'
  }
  return undefined
}

interface DispatchSessionEvent {
  type: string
  data: unknown
}

interface DispatchAgent {
  session: {
    header: { id: string; origin?: string; cwd?: string }
    events: readonly DispatchSessionEvent[]
  }
  steer(message: ReturnType<typeof createUserMessage>): void
}

interface DispatchTurnStopping {
  agent: DispatchAgent
  turn: number
  signal: AbortSignal
}

interface DispatchPlanControl {
  api_version: 'promax.ai/v1alpha2'
  kind: 'DispatchPlanControl'
  metadata: { session_id: string; plan_id: string; task_key: string; created_at: string }
  spec: {
    state: 'planning' | 'confirmed'
    roster_member_ids: string[]
    confirmed_member_ids?: string[]
    confirmed_at?: string
  }
}

const API_PROXY_PREFIX = '/promax-api'
const WORKSPACE_API_PREFIX = '/promax-workspace-api'

export const PROMAX_FEISHU_MCP_SETTINGS_NS = 'promax-feishu-mcp'
export const PROMAX_CONNECTIONS_SETTINGS_NS = 'promax-connections'
export const FEISHU_MCP_SERVER_NAME = 'feishu'
export const FEISHU_MCP_PACKAGE = '@larksuiteoapi/lark-mcp'
export const FEISHU_MCP_TRANSPORT = 'stdio'
export const FEISHU_MCP_CREDENTIAL_REFS = ['APP_ID', 'APP_SECRET'] as const

export type FeishuMcpConnectionState = 'disabled' | 'credentials-required' | 'connecting' | 'connected' | 'error'

export interface FeishuMcpSettings {
  enabled: boolean
  probe: number
  connection: {
    probe: number
    state: FeishuMcpConnectionState
    tools: string[]
    checkedAt: string
    message: string
  }
}

const EMPTY_FEISHU_CONNECTION: FeishuMcpSettings['connection'] = {
  probe: 0,
  state: 'disabled',
  tools: [],
  checkedAt: '',
  message: '飞书 MCP 未启用',
}

const FeishuMcpSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  probe: z.number().step(1).min(0).default(0),
  connection: z.object({
    probe: z.number().step(1).min(0).default(0),
    state: z.union([
      z.const('disabled'),
      z.const('credentials-required'),
      z.const('connecting'),
      z.const('connected'),
      z.const('error'),
    ]).default('disabled'),
    tools: z.array(String).default([]),
    checkedAt: z.string().default(''),
    message: z.string().default('飞书 MCP 未启用'),
  }).default(EMPTY_FEISHU_CONNECTION),
})

export type CustomMcpTransport = 'stdio' | 'streamable-http'
export type CustomMcpConnectionState = FeishuMcpConnectionState

export interface CustomMcpCredentialBinding {
  name: string
  ref: string
}

export interface CustomMcpConnectionSettings {
  serverName: string
  displayName: string
  transport: CustomMcpTransport
  command: string
  args: string[]
  url: string
  env: CustomMcpCredentialBinding[]
  headers: CustomMcpCredentialBinding[]
  enabled: boolean
  probe: number
  connection: FeishuMcpSettings['connection']
}

export interface CustomMcpSettings {
  entries: CustomMcpConnectionSettings[]
}

const CustomMcpCredentialBindingSchema = z.object({
  name: z.string().required(),
  ref: z.string().required(),
})

const CustomMcpConnectionSchema = z.object({
  serverName: z.string().required().pattern(/^[A-Za-z0-9_-]{1,32}$/u),
  displayName: z.string().required(),
  transport: z.union([z.const('stdio'), z.const('streamable-http')]),
  command: z.string().default(''),
  args: z.array(String).default([]),
  url: z.string().default(''),
  env: z.array(CustomMcpCredentialBindingSchema).default([]),
  headers: z.array(CustomMcpCredentialBindingSchema).default([]),
  enabled: z.boolean().default(true),
  probe: z.number().step(1).min(0).default(0),
  connection: z.object({
    probe: z.number().step(1).min(0).default(0),
    state: z.union([
      z.const('disabled'),
      z.const('credentials-required'),
      z.const('connecting'),
      z.const('connected'),
      z.const('error'),
    ]).default('disabled'),
    tools: z.array(String).default([]),
    checkedAt: z.string().default(''),
    message: z.string().default('MCP 未启用'),
  }).default({ ...EMPTY_FEISHU_CONNECTION, message: 'MCP 未启用' }),
})

const CustomMcpSettingsSchema = z.object({
  entries: z.array(CustomMcpConnectionSchema).default([]),
})

type FeishuOpenClawToolName =
  | 'feishu_bitable_app'
  | 'feishu_bitable_app_table'
  | 'feishu_bitable_app_table_field'
  | 'feishu_bitable_app_table_record'
  | 'feishu_docx_import'
  | 'feishu_docx_raw_content'
  | 'feishu_spreadsheet_sheet'
  | 'feishu_spreadsheet_sheet_range_read'

export interface FeishuToolMapping {
  openClawTool: FeishuOpenClawToolName
  skillIds: readonly string[]
  defaultAction?: string
  actions: Readonly<Record<string, string>>
  parameters: Record<string, unknown>
  unsupportedReason?: string
}

const FEISHU_STRING_PROPERTY = { type: 'string' } as const
const FEISHU_BOOLEAN_PROPERTY = { type: 'boolean' } as const
const FEISHU_NUMBER_PROPERTY = { type: 'number' } as const
const FEISHU_JSON_OBJECT_PROPERTY = { type: 'object', additionalProperties: true } as const
const FEISHU_JSON_ARRAY_PROPERTY = { type: 'array', items: {} } as const

function feishuAliasParameters(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: false,
  }
}

/**
 * The only OpenClaw-to-lark-mcp name map. Targets are the exact public names
 * registered by dsh-mcp-client for @larksuiteoapi/lark-mcp 0.5.1. An empty
 * action table is intentional evidence that the current MCP has no equivalent;
 * those aliases remain callable only so they can fail with an actionable error.
 */
export const FEISHU_TOOL_MAPPINGS: readonly FeishuToolMapping[] = [
  {
    openClawTool: 'feishu_bitable_app',
    skillIds: ['feishu-requirement-entry'],
    actions: { create: 'mcp__feishu__bitable_v1_app_create' },
    parameters: feishuAliasParameters({
      action: { type: 'string', enum: ['create'] },
      name: FEISHU_STRING_PROPERTY,
      folder_token: FEISHU_STRING_PROPERTY,
      time_zone: FEISHU_STRING_PROPERTY,
      useUAT: FEISHU_BOOLEAN_PROPERTY,
    }, ['action', 'name']),
  },
  {
    openClawTool: 'feishu_bitable_app_table',
    skillIds: ['feishu-requirement-board'],
    defaultAction: 'list',
    actions: { list: 'mcp__feishu__bitable_v1_appTable_list' },
    parameters: feishuAliasParameters({
      action: { type: 'string', enum: ['list'] },
      app_token: FEISHU_STRING_PROPERTY,
      page_token: FEISHU_STRING_PROPERTY,
      page_size: FEISHU_NUMBER_PROPERTY,
      useUAT: FEISHU_BOOLEAN_PROPERTY,
    }, ['app_token']),
  },
  {
    openClawTool: 'feishu_bitable_app_table_field',
    skillIds: ['feishu-requirement-entry', 'feishu-requirement-board', 'feishu-requirement-archive'],
    defaultAction: 'list',
    actions: { list: 'mcp__feishu__bitable_v1_appTableField_list' },
    parameters: feishuAliasParameters({
      action: { type: 'string', enum: ['list'] },
      app_token: FEISHU_STRING_PROPERTY,
      table_id: FEISHU_STRING_PROPERTY,
      view_id: FEISHU_STRING_PROPERTY,
      text_field_as_array: FEISHU_BOOLEAN_PROPERTY,
      page_token: FEISHU_STRING_PROPERTY,
      page_size: FEISHU_NUMBER_PROPERTY,
      useUAT: FEISHU_BOOLEAN_PROPERTY,
    }, ['app_token', 'table_id']),
  },
  {
    openClawTool: 'feishu_bitable_app_table_record',
    skillIds: ['feishu-requirement-entry', 'feishu-requirement-board', 'feishu-requirement-archive'],
    defaultAction: 'list',
    actions: {
      create: 'mcp__feishu__bitable_v1_appTableRecord_create',
      list: 'mcp__feishu__bitable_v1_appTableRecord_search',
      search: 'mcp__feishu__bitable_v1_appTableRecord_search',
    },
    parameters: feishuAliasParameters({
      action: { type: 'string', enum: ['create', 'list', 'search'] },
      app_token: FEISHU_STRING_PROPERTY,
      table_id: FEISHU_STRING_PROPERTY,
      fields: FEISHU_JSON_OBJECT_PROPERTY,
      view_id: FEISHU_STRING_PROPERTY,
      field_names: { type: 'array', items: { type: 'string' } },
      sort: FEISHU_JSON_ARRAY_PROPERTY,
      filter: FEISHU_JSON_OBJECT_PROPERTY,
      automatic_fields: FEISHU_BOOLEAN_PROPERTY,
      user_id_type: { type: 'string', enum: ['open_id', 'union_id', 'user_id'] },
      client_token: FEISHU_STRING_PROPERTY,
      ignore_consistency_check: FEISHU_BOOLEAN_PROPERTY,
      page_token: FEISHU_STRING_PROPERTY,
      page_size: FEISHU_NUMBER_PROPERTY,
      useUAT: FEISHU_BOOLEAN_PROPERTY,
    }, ['app_token', 'table_id']),
  },
  {
    openClawTool: 'feishu_spreadsheet_sheet',
    skillIds: ['pm-weekly-monitor'],
    defaultAction: 'list',
    actions: {},
    parameters: feishuAliasParameters({
      action: FEISHU_STRING_PROPERTY,
      spreadsheet_token: FEISHU_STRING_PROPERTY,
    }, ['spreadsheet_token']),
    unsupportedReason: '当前 @larksuiteoapi/lark-mcp 0.5.1 的 tools/list 中没有飞书电子表格工作表能力',
  },
  {
    openClawTool: 'feishu_docx_import',
    skillIds: ['feishu-requirement-entry', 'feishu-requirement-board', 'feishu-requirement-archive'],
    defaultAction: 'create',
    actions: { create: 'mcp__feishu__docx_builtin_import' },
    parameters: feishuAliasParameters({
      action: { type: 'string', enum: ['create'] },
      markdown: FEISHU_STRING_PROPERTY,
      file_name: FEISHU_STRING_PROPERTY,
      useUAT: FEISHU_BOOLEAN_PROPERTY,
    }, ['markdown']),
  },
  {
    openClawTool: 'feishu_docx_raw_content',
    skillIds: ['feishu-requirement-entry', 'feishu-requirement-board', 'feishu-requirement-archive'],
    defaultAction: 'read',
    actions: { read: 'mcp__feishu__docx_v1_document_rawContent' },
    parameters: feishuAliasParameters({
      action: { type: 'string', enum: ['read'] },
      document_id: FEISHU_STRING_PROPERTY,
      lang: FEISHU_NUMBER_PROPERTY,
      useUAT: FEISHU_BOOLEAN_PROPERTY,
    }, ['document_id']),
  },
  {
    openClawTool: 'feishu_spreadsheet_sheet_range_read',
    skillIds: ['pm-weekly-monitor'],
    actions: {},
    parameters: feishuAliasParameters({
      spreadsheet_token: FEISHU_STRING_PROPERTY,
      sheet_id: FEISHU_STRING_PROPERTY,
      range: FEISHU_STRING_PROPERTY,
    }, ['spreadsheet_token', 'sheet_id', 'range']),
    unsupportedReason: '当前 @larksuiteoapi/lark-mcp 0.5.1 的 tools/list 中没有飞书电子表格区域读取能力',
  },
] as const

const FEISHU_IDENTITY_FALLBACK_NOTICE = 'Promax 未移植 OpenClaw 的 session_status、Relationships.md 与 wecom-cli 身份链路；身份不可得时继续执行并记为匿名 / unknown，不得伪造姓名，不得因此中止业务操作。'

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value as Record<string, unknown>
}

function requiredFeishuString(args: Record<string, unknown>, name: string): string {
  const value = typeof args[name] === 'string' ? args[name].trim() : ''
  if (value === '') throw new Error(`飞书工具参数 ${name} 不能为空`)
  return value
}

function copyDefined(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.flatMap(key => source[key] === undefined ? [] : [[key, source[key]]]))
}

function convertedFeishuArguments(mapping: FeishuToolMapping, action: string, args: Record<string, unknown>): Record<string, unknown> {
  const appToken = (): string => requiredFeishuString(args, 'app_token')
  const tableId = (): string => requiredFeishuString(args, 'table_id')
  const useUAT = args.useUAT === undefined ? {} : { useUAT: args.useUAT }
  switch (mapping.openClawTool) {
    case 'feishu_bitable_app':
      return {
        data: {
          name: requiredFeishuString(args, 'name'),
          ...copyDefined(args, ['folder_token', 'time_zone']),
        },
        ...useUAT,
      }
    case 'feishu_bitable_app_table':
      return {
        path: { app_token: appToken() },
        ...Object.keys(copyDefined(args, ['page_token', 'page_size'])).length === 0 ? {} : { params: copyDefined(args, ['page_token', 'page_size']) },
        ...useUAT,
      }
    case 'feishu_bitable_app_table_field':
      return {
        path: { app_token: appToken(), table_id: tableId() },
        ...Object.keys(copyDefined(args, ['view_id', 'text_field_as_array', 'page_token', 'page_size'])).length === 0 ? {} : { params: copyDefined(args, ['view_id', 'text_field_as_array', 'page_token', 'page_size']) },
        ...useUAT,
      }
    case 'feishu_bitable_app_table_record':
      if (action === 'create') {
        return {
          data: { fields: recordValue(args.fields, '飞书记录 fields') },
          path: { app_token: appToken(), table_id: tableId() },
          ...Object.keys(copyDefined(args, ['user_id_type', 'client_token', 'ignore_consistency_check'])).length === 0 ? {} : { params: copyDefined(args, ['user_id_type', 'client_token', 'ignore_consistency_check']) },
          ...useUAT,
        }
      }
      return {
        path: { app_token: appToken(), table_id: tableId() },
        ...Object.keys(copyDefined(args, ['view_id', 'field_names', 'sort', 'filter', 'automatic_fields'])).length === 0 ? {} : { data: copyDefined(args, ['view_id', 'field_names', 'sort', 'filter', 'automatic_fields']) },
        ...Object.keys(copyDefined(args, ['user_id_type', 'page_token', 'page_size'])).length === 0 ? {} : { params: copyDefined(args, ['user_id_type', 'page_token', 'page_size']) },
        ...useUAT,
      }
    case 'feishu_docx_import':
      return {
        data: {
          markdown: requiredFeishuString(args, 'markdown'),
          ...copyDefined(args, ['file_name']),
        },
        ...useUAT,
      }
    case 'feishu_docx_raw_content':
      return {
        path: { document_id: requiredFeishuString(args, 'document_id') },
        ...args.lang === undefined ? {} : { params: { lang: args.lang } },
        ...useUAT,
      }
    case 'feishu_spreadsheet_sheet':
    case 'feishu_spreadsheet_sheet_range_read':
      throw new Error(mapping.unsupportedReason ?? '当前飞书 MCP 没有对应能力')
    default:
      throw new Error(`未知飞书映射工具：${String(mapping.openClawTool)}`)
  }
}

function mappedFeishuText(value: unknown): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const content = (value as { content?: unknown }).content
    if (Array.isArray(content)) {
      const text = content.flatMap(block => typeof block === 'object' && block !== null && !Array.isArray(block) && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string'
        ? [(block as { text: string }).text]
        : []).join('\n')
      if (text !== '') return text
    }
  }
  try {
    return JSON.stringify(value, null, 2) ?? '飞书工具已执行，但没有文本结果'
  } catch {
    return '飞书工具已执行，但结果无法序列化为文本'
  }
}

function mappedFeishuError(result: MappedToolResult): string {
  const direct = result.error?.message?.trim()
  if (direct) return direct
  const content = result.content.flatMap(block => typeof block === 'object' && block !== null && !Array.isArray(block) && typeof (block as { text?: unknown }).text === 'string'
    ? [(block as { text: string }).text]
    : []).join('\n').trim()
  return content || '飞书 MCP 返回了未说明原因的失败'
}

function mappingSkillLabel(mapping: FeishuToolMapping): string {
  return mapping.skillIds.map(skillId => `Skill ${skillId}`).join('、')
}

async function assertFeishuCredentials(ctx: HostContext): Promise<void> {
  let credentials: Array<Awaited<ReturnType<CredentialsService['resolve']>>>
  try {
    credentials = await Promise.all(FEISHU_MCP_CREDENTIAL_REFS.map(ref => ctx.credentials.resolve(ref)))
  } catch {
    throw new Error('飞书凭据状态读取失败；请到“设置 → 连接”展开飞书条目，重新填写 APP_ID 与 APP_SECRET 后重试。凭据只写入，不会在页面回填。')
  }
  if (credentials.some(value => value === undefined)) {
    throw new Error('飞书凭据未配置：请到“设置 → 连接”展开飞书条目，填写 APP_ID 与 APP_SECRET 后重试。凭据只写入，不会在页面回填。')
  }
}

function feishuMappingDefinition(ctx: HostContext, scope: SettingsScope<FeishuMcpSettings>, mapping: FeishuToolMapping): MappedToolDefinition {
  return {
    name: mapping.openClawTool,
    description: `${mappingSkillLabel(mapping)} 使用的 OpenClaw 兼容入口。${FEISHU_IDENTITY_FALLBACK_NOTICE}`,
    parameters: mapping.parameters,
    output: {
      schema: {},
      render: (_args, value) => [{ type: 'text', text: mappedFeishuText(value) }],
    },
    async execute(value, exec) {
      const args = recordValue(value, `工具 ${mapping.openClawTool} 的参数`)
      await assertFeishuCredentials(ctx)
      const actionValue = typeof args.action === 'string' ? args.action.trim() : ''
      const action = actionValue || mapping.defaultAction
      if (action === undefined) throw new Error(`${mappingSkillLabel(mapping)} 调用 ${mapping.openClawTool} 时必须提供 action`)
      const targetName = mapping.actions[action]
      if (targetName === undefined) {
        throw new Error(`${mappingSkillLabel(mapping)} 需要工具 ${mapping.openClawTool}${action === '' ? '' : `（action=${action}）`}；${mapping.unsupportedReason ?? `当前 MCP 没有与该 action 对应的工具`}，未创建伪映射。`)
      }
      if (!scope.get().enabled) throw new Error('飞书连接未启用：请到“设置 → 连接”启用飞书条目后重试。')
      if (ctx.tools.get(targetName) === undefined) {
        throw new Error(`${mappingSkillLabel(mapping)} 需要工具 ${mapping.openClawTool}，映射目标 ${targetName} 当前未注册；请到“设置 → 连接”对飞书条目运行连接测试并检查权限。`)
      }
      const converted = convertedFeishuArguments(mapping, action, args)
      const result = await ctx.tools.execute({
        callId: `${exec.callId}:feishu-map:${randomUUID()}`,
        rootCallId: exec.rootCallId,
        parent: exec.token,
        name: targetName,
        arguments: converted,
        signal: exec.signal,
      })
      if (result.isError || result.value === undefined) {
        throw new Error(`飞书工具调用失败（${mapping.openClawTool} → ${targetName}）：${mappedFeishuError(result)}`)
      }
      for (const context of result.additionalContexts ?? []) exec.deferContext(context)
      if (result.concludesTurn) exec.concludeTurn()
      return result.value
    },
  }
}

function installFeishuToolMappings(ctx: HostContext, scope: SettingsScope<FeishuMcpSettings>): () => void {
  const disposers: Array<() => void> = []
  try {
    for (const mapping of FEISHU_TOOL_MAPPINGS) disposers.push(ctx.tools.register(feishuMappingDefinition(ctx, scope, mapping)))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

const PROMAX_MEMBER_ID_RE = /(?:^|\n)PROMAX_MEMBER_ID:([a-z][a-z0-9_]{2,47})(?:\n|$)/g

async function childPromaxMemberId(childCtx: ChildAgentContext): Promise<string> {
  const assembly = await childCtx.systemPrompt.assemble({ scope: childCtx.agent })
  const persona = assembly.sections.find(section => section.name === 'deployment:persona')?.text ?? ''
  const matches = [...persona.matchAll(PROMAX_MEMBER_ID_RE)]
  if (matches.length !== 1) throw new Error('飞书映射工具无法唯一识别 member_id')
  return matches[0]![1]!
}

function registerFeishuToolMappingsForChild(
  ctx: HostContext,
  scope: SettingsScope<FeishuMcpSettings>,
  childCtx: ChildAgentContext,
): () => void {
  const disposers: Array<() => void> = []
  try {
    for (const mapping of FEISHU_TOOL_MAPPINGS) {
      const rootDefinition = feishuMappingDefinition(ctx, scope, mapping)
      disposers.push(childCtx.tools.register({
        ...rootDefinition,
        async execute(args, exec) {
          if (await childPromaxMemberId(childCtx) !== 'requirement_management') {
            throw new Error(`${mapping.openClawTool} 仅允许 requirement_management`)
          }
          return rootDefinition.execute(args, exec)
        },
      }))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}

function installFeishuToolMappingsInChildren(ctx: HostContext, scope: SettingsScope<FeishuMcpSettings>): void {
  const installed = new WeakSet<object>()
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.origin !== 'subagent' || installed.has(agent.ctx)) return
    installed.add(agent.ctx)
    agent.ctx.effect(() => {
      try {
        const dispose = registerFeishuToolMappingsForChild(ctx, scope, agent.ctx)
        return () => {
          dispose()
          installed.delete(agent.ctx)
        }
      } catch (error) {
        installed.delete(agent.ctx)
        throw error
      }
    }, 'promax-feishu-mappings.one-shot-child')
  })
}

function mcpToolNames(tools: ToolsService, serverName: string): string[] {
  return tools.schemas()
    .map(schema => schema.name)
    .filter(toolName => toolName.startsWith(`mcp__${serverName}__`))
    .sort((left, right) => left.localeCompare(right))
}

function feishuToolNames(tools: ToolsService): string[] {
  return mcpToolNames(tools, FEISHU_MCP_SERVER_NAME)
}

async function waitForFeishuTools(tools: ToolsService, isStopped: () => boolean): Promise<string[]> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const current = feishuToolNames(tools)
    if (current.length > 0 || isStopped()) return current
    await new Promise<void>(resolveTimer => { setTimeout(resolveTimer, 250) })
  }
  return []
}

/**
 * Owns the built-in Feishu connection without creating a Promax-specific
 * HTTP/RPC contract. The settings page writes only the generic settings and
 * credentials seams; secret values are resolved only for the child process
 * operation and are never copied into settings, tool status, or diagnostics.
 */
export function installFeishuMcpRuntime(ctx: HostContext): void {
  const initial: FeishuMcpSettings = {
    enabled: false,
    probe: 0,
    connection: { ...EMPTY_FEISHU_CONNECTION },
  }
  const scope = ctx.settings.register<FeishuMcpSettings>(
    PROMAX_FEISHU_MCP_SETTINGS_NS,
    FeishuMcpSettingsSchema,
    { base: initial, applies: 'live' },
  )
  const disposeMappings = installFeishuToolMappings(ctx, scope)
  installFeishuToolMappingsInChildren(ctx, scope)
  let activeFiber: PluginFiber | undefined
  let stopped = false
  let queue = Promise.resolve()

  const publish = async (connection: FeishuMcpSettings['connection']): Promise<void> => {
    if (stopped) return
    await scope.update({ connection })
  }

  const disposeActive = async (): Promise<void> => {
    const fiber = activeFiber
    activeFiber = undefined
    if (fiber !== undefined) await fiber.dispose()
  }

  const reconcile = async (): Promise<void> => {
    const settings = scope.get()
    if (!settings.enabled) {
      await disposeActive()
      const current = settings.connection
      if (
        current.probe === settings.probe
        && current.state === EMPTY_FEISHU_CONNECTION.state
        && current.tools.length === 0
        && current.checkedAt === EMPTY_FEISHU_CONNECTION.checkedAt
        && current.message === EMPTY_FEISHU_CONNECTION.message
      ) return
      await publish({ ...EMPTY_FEISHU_CONNECTION, probe: settings.probe })
      return
    }

    let appId: Awaited<ReturnType<CredentialsService['resolve']>>
    let appSecret: Awaited<ReturnType<CredentialsService['resolve']>>
    try {
      [appId, appSecret] = await Promise.all(
        FEISHU_MCP_CREDENTIAL_REFS.map(ref => ctx.credentials.resolve(ref)),
      )
    } catch {
      await disposeActive()
      await publish({
        probe: settings.probe,
        state: 'error',
        tools: [],
        checkedAt: new Date().toISOString(),
        message: '飞书 MCP 凭据状态读取失败；未记录错误正文，避免凭据进入日志或设置',
      })
      return
    }
    if (appId === undefined || appSecret === undefined) {
      await disposeActive()
      await publish({
        probe: settings.probe,
        state: 'credentials-required',
        tools: [],
        checkedAt: new Date().toISOString(),
        message: '请先配置 APP_ID 与 APP_SECRET',
      })
      return
    }

    await disposeActive()
    await publish({
      probe: settings.probe,
      state: 'connecting',
      tools: [],
      checkedAt: new Date().toISOString(),
      message: '正在连接飞书 MCP',
    })
    try {
      const McpClient = await import('@deepseek-ai/dsh-mcp-client')
      activeFiber = await ctx.plugin(McpClient, {
        serverName: FEISHU_MCP_SERVER_NAME,
        transport: FEISHU_MCP_TRANSPORT,
        command: 'npx',
        args: ['-y', FEISHU_MCP_PACKAGE, 'mcp'],
        env: { APP_ID: appId.value, APP_SECRET: appSecret.value },
        cwd: '',
        toolCallTimeoutMs: 60_000,
        failOnStartupError: false,
      })
      const tools = await waitForFeishuTools(ctx.tools, () => stopped)
      await publish({
        probe: settings.probe,
        state: tools.length > 0 ? 'connected' : 'error',
        tools,
        checkedAt: new Date().toISOString(),
        message: tools.length > 0 ? `已注册 ${String(tools.length)} 个飞书工具` : '未发现飞书 MCP 工具，请检查专用测试凭据与网络',
      })
    } catch {
      await disposeActive()
      await publish({
        probe: settings.probe,
        state: 'error',
        tools: [],
        checkedAt: new Date().toISOString(),
        message: '飞书 MCP 连接失败；未记录服务端错误正文，避免凭据进入日志或设置',
      })
    }
  }

  const refreshToolSnapshot = async (): Promise<void> => {
    if (activeFiber === undefined || !scope.get().enabled) return
    const tools = feishuToolNames(ctx.tools)
    if (tools.length === 0 && scope.get().connection.state === 'connecting') return
    await publish({
      probe: scope.get().probe,
      state: tools.length > 0 ? 'connected' : 'error',
      tools,
      checkedAt: new Date().toISOString(),
      message: tools.length > 0 ? `已注册 ${String(tools.length)} 个飞书工具` : '飞书 MCP 当前没有已注册工具',
    })
  }

  const schedule = (operation: () => Promise<void>): void => {
    queue = queue.then(operation, operation).then(() => undefined, () => undefined)
  }

  scope.watch((next, previous) => {
    if (next.enabled !== previous.enabled || next.probe !== previous.probe) schedule(reconcile)
  })
  ctx.on('credentials/reference-updated', (ref) => {
    if (FEISHU_MCP_CREDENTIAL_REFS.some(expected => expected === ref)) schedule(reconcile)
  })
  ctx.on('tools/change', () => { schedule(refreshToolSnapshot) })
  schedule(reconcile)
  ctx.effect(() => async () => {
    stopped = true
    await queue
    await disposeActive()
    disposeMappings()
  }, 'promax-feishu-mcp-runtime')
}

function customMcpRuntimeKey(entry: CustomMcpConnectionSettings): string {
  return JSON.stringify({
    serverName: entry.serverName,
    displayName: entry.displayName,
    transport: entry.transport,
    command: entry.command,
    args: entry.args,
    url: entry.url,
    env: entry.env,
    headers: entry.headers,
    enabled: entry.enabled,
    probe: entry.probe,
  })
}

function customMcpSettingsKey(settings: CustomMcpSettings): string {
  return JSON.stringify(settings.entries.map(entry => customMcpRuntimeKey(entry)))
}

function customConnectionState(
  entry: CustomMcpConnectionSettings,
  state: CustomMcpConnectionState,
  message: string,
  tools: string[] = [],
): CustomMcpConnectionSettings['connection'] {
  return { probe: entry.probe, state, tools, checkedAt: new Date().toISOString(), message }
}

/**
 * Owns user-created MCP entries from the generic connection namespace. Secret
 * values are resolved only while constructing one live plugin instance; the
 * settings document stores credential references and key names, never values.
 */
export function installCustomMcpRuntime(ctx: HostContext): void {
  const scope = ctx.settings.register<CustomMcpSettings>(
    PROMAX_CONNECTIONS_SETTINGS_NS,
    CustomMcpSettingsSchema,
    { base: { entries: [] }, applies: 'live' },
  )
  const active = new Map<string, { fiber: PluginFiber; key: string }>()
  let stopped = false
  let queue = Promise.resolve()

  const schedule = (operation: () => Promise<void>): void => {
    queue = queue.then(operation, operation).then(() => undefined, () => undefined)
  }

  const publish = async (serverName: string, connection: CustomMcpConnectionSettings['connection']): Promise<void> => {
    if (stopped) return
    const current = scope.get()
    const index = current.entries.findIndex(entry => entry.serverName === serverName)
    if (index < 0 || JSON.stringify(current.entries[index]?.connection) === JSON.stringify(connection)) return
    const entries = current.entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, connection } : entry)
    await scope.update({ entries })
  }

  const dispose = async (serverName: string): Promise<void> => {
    const running = active.get(serverName)
    active.delete(serverName)
    if (running !== undefined) await running.fiber.dispose()
  }

  const credentialValues = async (bindings: readonly CustomMcpCredentialBinding[]): Promise<{ values?: Record<string, string>; missing: string[] }> => {
    const resolved = await Promise.all(bindings.map(async binding => ({ binding, credential: await ctx.credentials.resolve(binding.ref) })))
    return {
      ...(resolved.every(item => item.credential !== undefined)
        ? { values: Object.fromEntries(resolved.map(item => [item.binding.name, item.credential!.value])) }
        : {}),
      missing: resolved.flatMap(item => item.credential === undefined ? [item.binding.name] : []),
    }
  }

  const reconcileEntry = async (candidate: CustomMcpConnectionSettings): Promise<void> => {
    const entry = scope.get().entries.find(item => item.serverName === candidate.serverName)
    if (entry === undefined) return
    const key = customMcpRuntimeKey(entry)
    const running = active.get(entry.serverName)
    if (running !== undefined && running.key !== key) await dispose(entry.serverName)
    if (!entry.enabled) {
      await dispose(entry.serverName)
      await publish(entry.serverName, customConnectionState(entry, 'disabled', 'MCP 未启用'))
      return
    }
    if (entry.serverName === FEISHU_MCP_SERVER_NAME) {
      await dispose(entry.serverName)
      await publish(entry.serverName, customConnectionState(entry, 'error', 'serverName “feishu” 已被内置飞书连接占用'))
      return
    }
    if (active.get(entry.serverName)?.key === key) {
      const tools = mcpToolNames(ctx.tools, entry.serverName)
      await publish(entry.serverName, customConnectionState(entry, tools.length > 0 ? 'connected' : 'error', tools.length > 0 ? `已注册 ${String(tools.length)} 个 MCP 工具` : 'MCP 当前没有已注册工具', tools))
      return
    }
    if (entry.transport === 'stdio' && entry.command.trim() === '') {
      await publish(entry.serverName, customConnectionState(entry, 'error', 'stdio 连接缺少 command'))
      return
    }
    if (entry.transport === 'streamable-http') {
      try {
        const parsed = new URL(entry.url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
      } catch {
        await publish(entry.serverName, customConnectionState(entry, 'error', 'streamable-http 连接需要有效的 http(s) URL'))
        return
      }
    }
    let environment: Awaited<ReturnType<typeof credentialValues>>
    let headers: Awaited<ReturnType<typeof credentialValues>>
    try {
      [environment, headers] = await Promise.all([credentialValues(entry.env), credentialValues(entry.headers)])
    } catch {
      await publish(entry.serverName, customConnectionState(entry, 'error', 'MCP 凭据状态读取失败；未记录错误正文，避免凭据进入日志或设置'))
      return
    }
    const missing = [...environment.missing, ...headers.missing]
    if (missing.length > 0) {
      await publish(entry.serverName, customConnectionState(entry, 'credentials-required', `请配置只写凭据：${missing.join('、')}`))
      return
    }
    await publish(entry.serverName, customConnectionState(entry, 'connecting', '正在连接 MCP server'))
    try {
      const McpClient = await import('@deepseek-ai/dsh-mcp-client')
      const config = entry.transport === 'stdio'
        ? {
            serverName: entry.serverName,
            transport: 'stdio',
            command: entry.command,
            args: entry.args,
            env: environment.values ?? {},
            cwd: '',
            toolCallTimeoutMs: 60_000,
            failOnStartupError: false,
          }
        : {
            serverName: entry.serverName,
            transport: 'streamable-http',
            url: entry.url,
            headers: headers.values ?? {},
            toolCallTimeoutMs: 60_000,
            failOnStartupError: false,
          }
      const fiber = await ctx.plugin(McpClient, config)
      active.set(entry.serverName, { fiber, key })
      let tools: string[] = []
      for (let attempt = 0; attempt < 60; attempt += 1) {
        tools = mcpToolNames(ctx.tools, entry.serverName)
        if (tools.length > 0 || stopped) break
        await new Promise<void>(resolveTimer => { setTimeout(resolveTimer, 250) })
      }
      await publish(entry.serverName, customConnectionState(entry, tools.length > 0 ? 'connected' : 'error', tools.length > 0 ? `已注册 ${String(tools.length)} 个 MCP 工具` : '未发现 MCP 工具，请检查配置与网络', tools))
    } catch {
      await dispose(entry.serverName)
      await publish(entry.serverName, customConnectionState(entry, 'error', 'MCP 连接失败；未记录服务端错误正文，避免凭据进入日志或设置'))
    }
  }

  const reconcile = async (): Promise<void> => {
    const entries = scope.get().entries
    const wanted = new Set(entries.map(entry => entry.serverName))
    for (const serverName of [...active.keys()]) if (!wanted.has(serverName)) await dispose(serverName)
    for (const entry of entries) await reconcileEntry(entry)
  }

  const refreshToolSnapshots = async (): Promise<void> => {
    for (const entry of scope.get().entries) {
      if (!entry.enabled || !active.has(entry.serverName)) continue
      const tools = mcpToolNames(ctx.tools, entry.serverName)
      if (tools.length === 0 && entry.connection.state === 'connecting') continue
      await publish(entry.serverName, customConnectionState(entry, tools.length > 0 ? 'connected' : 'error', tools.length > 0 ? `已注册 ${String(tools.length)} 个 MCP 工具` : 'MCP 当前没有已注册工具', tools))
    }
  }

  scope.watch((next, previous) => {
    if (customMcpSettingsKey(next) !== customMcpSettingsKey(previous)) schedule(reconcile)
  })
  ctx.on('credentials/reference-updated', ref => {
    const affected = scope.get().entries.filter(entry => [...entry.env, ...entry.headers].some(binding => binding.ref === ref)).map(entry => entry.serverName)
    if (affected.length > 0) schedule(async () => {
      for (const serverName of affected) await dispose(serverName)
      await reconcile()
    })
  })
  ctx.on('tools/change', () => { schedule(refreshToolSnapshots) })
  schedule(reconcile)
  ctx.effect(() => async () => {
    stopped = true
    await queue
    for (const serverName of [...active.keys()]) await dispose(serverName)
  }, 'promax-custom-mcp-runtime')
}

async function readJson(request: IncomingMessage, maximumBytes = 1024 * 1024, overflowMessage = '请求体过大'): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > maximumBytes) throw new Error(overflowMessage)
    chunks.push(buffer)
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new Error('请求体不是有效的 JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('请求体必须是 JSON 对象')
  return value as Record<string, unknown>
}

function writeJson(response: ServerResponse, status: number, value: Record<string, unknown>): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
  })
  response.end(body)
}

function projectNameOf(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === '' || name.length > 80 || name === '.' || name === '..' || /[/\\\0]/u.test(name)) {
    throw new Error('项目组名称格式无效')
  }
  return name
}

const SESSION_SCOPE_MAX_LENGTH = 40
const NEW_TASK_KEY_PATTERN = /^[\p{Script=Han}A-Za-z0-9]+(?:-[\p{Script=Han}A-Za-z0-9]+)*$/u
const TASK_KEY_FILE_EXTENSION = /\.(?:md|txt|csv|json|ya?ml|docx|pdf|xlsx)$/iu

function sessionScopeNameOf(value: unknown): string {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  if (
    name === '' || Array.from(name).length > SESSION_SCOPE_MAX_LENGTH || name === '.' || name === '..'
    || /[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(name) || /[. ]$/u.test(name)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(name)
  ) throw new Error('会话名称不能安全地用作产出目录')
  return name
}

function newTaskKeyOf(value: unknown): string {
  const taskKey = sessionScopeNameOf(value)
  if (!NEW_TASK_KEY_PATTERN.test(taskKey) || TASK_KEY_FILE_EXTENSION.test(taskKey)) {
    throw new Error('新任务 task_key 只能包含中文、字母、数字和连字符，且不能带扩展名')
  }
  return taskKey
}

function firstTopicLine(value: string): string {
  const lines = value.normalize('NFC').split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  const usable = lines.find(line => !/^#{1,6}\s*(?:从\s+.+\s+转换|文件转换说明)\s*$/u.test(line)) ?? ''
  return usable
    .replace(/^(?:@[a-z][a-z0-9_]*\s+)+/u, '')
    .replace(/^(?:#{1,6}|[-*+])\s*/u, '')
    .replace(/^(?:主题|标题|项目|需求|功能)\s*[：:]\s*/u, '')
    .split(/[。！？!?；;]/u)[0]!
    .trim()
}

function normalizedTaskKey(value: string): string {
  const topic = firstTopicLine(value).replace(TASK_KEY_FILE_EXTENSION, '')
  const safe = topic
    .replace(/[_\s]+/gu, '-')
    .replace(/[^\p{Script=Han}A-Za-z0-9-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
  const base = safe === '' || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(safe) ? '产品任务' : safe
  const characters = Array.from(base)
  if (characters.length <= SESSION_SCOPE_MAX_LENGTH) return newTaskKeyOf(base)
  const suffix = createHash('sha256').update(base).digest('hex').slice(0, 8)
  return newTaskKeyOf(`${characters.slice(0, SESSION_SCOPE_MAX_LENGTH - suffix.length - 1).join('')}-${suffix}`)
}

function demandLooksLikeFileReference(demand: string, attachmentNames: readonly string[]): boolean {
  const normalized = demand.normalize('NFC').trim()
  if (normalized === '') return true
  if (/[/\\~]/u.test(normalized)) return true
  return attachmentNames.some(name => normalized === name || normalized === name.replace(TASK_KEY_FILE_EXTENSION, ''))
}

/** Derives a bounded filesystem key from the demand, or from attachment content for file-only input. */
export function taskKeyFromSubmission(demand: string, attachments: readonly { name: string; text: string }[]): string {
  const source = demandLooksLikeFileReference(demand, attachments.map(attachment => attachment.name))
    ? attachments.map(attachment => firstTopicLine(attachment.text)).find(Boolean) ?? demand
    : demand
  return normalizedTaskKey(source)
}

function sessionIdOf(value: unknown): string {
  const sessionId = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(sessionId)) throw new Error('会话标识格式无效')
  return sessionId
}

const MAX_ATTACHMENT_COUNT = 20
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const MAX_ATTACHMENT_REQUEST_BYTES = Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 64 * 1024
const TEXT_ATTACHMENT_EXTENSIONS = new Set(['.md', '.txt', '.csv', '.json', '.yml', '.yaml'])
const OFFICE_ATTACHMENT_EXTENSIONS = new Set(['.docx', '.pdf', '.xlsx'])
const IMAGE_ATTACHMENT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const SUPPORTED_ATTACHMENT_FORMATS = '.md、.txt、.csv、.json、.yml、.yaml、.docx、.pdf、.xlsx'

function attachmentNameOf(value: unknown): string {
  const name = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  if (name === '' || name.length > 255 || name === '.' || name === '..' || basename(name) !== name || /[/\\\0]/u.test(name)) {
    throw new Error('附件名称格式无效')
  }
  return name
}

function attachmentBytesOf(value: unknown): Buffer {
  const encoded = typeof value === 'string' ? value : ''
  const paddingAt = encoded.indexOf('=')
  const padding = paddingAt < 0 ? '' : encoded.slice(paddingAt)
  if (encoded === '' || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(encoded)
    || (paddingAt >= 0 && (paddingAt < encoded.length - 2 || (padding !== '=' && padding !== '==')))) {
    throw new Error('附件内容不是有效的 base64')
  }
  return Buffer.from(encoded, 'base64')
}

function attachmentExtensionOf(name: string): string {
  const extension = extname(name).toLowerCase()
  if (IMAGE_ATTACHMENT_EXTENSIONS.has(extension)) throw new Error('图片请用对话框内的图片功能')
  if (!TEXT_ATTACHMENT_EXTENSIONS.has(extension) && !OFFICE_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new Error(`不支持文件“${name}”。支持的格式：${SUPPORTED_ATTACHMENT_FORMATS}`)
  }
  return extension
}

function isSafeAttachmentLeaf(name: string): boolean {
  try {
    return attachmentNameOf(name) === name
  } catch {
    return false
  }
}

function numberedAttachmentName(name: string, ordinal: number): string {
  if (ordinal === 1) return name
  const extension = extname(name)
  const stem = extension === '' ? name : name.slice(0, -extension.length)
  return `${stem}（${String(ordinal)}）${extension}`
}

async function writeUniquely(directory: string, name: string, bytes: Buffer): Promise<string> {
  for (let ordinal = 1; ordinal <= 10_000; ordinal += 1) {
    const candidate = numberedAttachmentName(name, ordinal)
    try {
      await writeFile(join(directory, candidate), bytes, { flag: 'wx' })
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw new Error(`附件“${name}”保存失败，请重试`)
    }
  }
  throw new Error(`附件“${name}”同名副本过多，请修改文件名后重试`)
}

/** Stores user-picked files under the current product workspace and returns prompt-safe relative paths. */
export async function saveTaskAttachments(
  workspacePath: string,
  sessionIdValue: string,
  values: unknown,
): Promise<string[]> {
  const workspace = resolve(workspacePath)
  const sessionId = sessionIdOf(sessionIdValue)
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_ATTACHMENT_COUNT) throw new Error('附件数量必须为 1 到 20 个')
  let totalBytes = 0
  const files = values.map(value => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('附件信息格式无效')
    const row = value as Record<string, unknown>
    const name = attachmentNameOf(row.name)
    attachmentExtensionOf(name)
    const bytes = attachmentBytesOf(row.contentBase64)
    totalBytes += bytes.byteLength
    if (totalBytes > MAX_ATTACHMENT_BYTES) throw new Error('附件总大小不能超过 20 MiB')
    return { name, bytes }
  })
  const directory = resolve(workspace, '输入', '源文件', sessionId)
  if (!directory.startsWith(`${workspace}${sep}`)) throw new Error('附件目录越界')
  try {
    await mkdir(directory, { recursive: true })
  } catch {
    throw new Error('附件保存目录创建失败，请检查工作目录后重试')
  }
  const storedNames: string[] = []
  try {
    for (const file of files) storedNames.push(await writeUniquely(directory, file.name, file.bytes))
  } catch (error) {
    await Promise.allSettled(storedNames.map(name => rm(join(directory, name), { force: true })))
    throw error
  }
  return storedNames.map(name => join('输入', '源文件', sessionId, name).split(sep).join('/'))
}

function numberedSessionScopeName(base: string, ordinal: number): string {
  if (ordinal === 1) return base
  const suffix = `-${String(ordinal)}`
  const available = SESSION_SCOPE_MAX_LENGTH - Array.from(suffix).length
  return `${Array.from(base).slice(0, available).join('').replace(/-+$/u, '')}${suffix}`
}

/** Claims one immutable per-session output folder; duplicate names receive the same suffix in UI and on disk. */
export async function ensureSessionOutputDirectory(
  workspacePath: string,
  sessionIdValue: string,
  requestedNameValue: string,
): Promise<{ sessionName: string; taskKey: string; relativePath: string }> {
  const root = resolve(workspacePath)
  const sessionId = sessionIdOf(sessionIdValue)
  const mappingDirectory = join(root, '.promax', 'session-scopes')
  const mappingPath = join(mappingDirectory, `${sessionId}.json`)
  await mkdir(mappingDirectory, { recursive: true })

  try {
    const stored = JSON.parse(await readFile(mappingPath, 'utf8')) as { sessionName?: unknown }
    const sessionName = sessionScopeNameOf(stored.sessionName)
    await mkdir(join(root, 'deliverables', sessionName), { recursive: true })
    return { sessionName, taskKey: sessionName, relativePath: join('deliverables', sessionName) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const requestedName = newTaskKeyOf(requestedNameValue)

  await mkdir(join(root, 'deliverables'), { recursive: true })
  for (let ordinal = 1; ordinal <= 999; ordinal += 1) {
    const sessionName = numberedSessionScopeName(requestedName, ordinal)
    try {
      await mkdir(join(root, 'deliverables', sessionName))
      await writeFile(mappingPath, `${JSON.stringify({ sessionId, sessionName, taskKey: sessionName }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      return { sessionName, taskKey: sessionName, relativePath: join('deliverables', sessionName) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error('同名会话产出目录数量超过上限')
}

async function scaffoldProject(path: string): Promise<void> {
  await Promise.all([
    mkdir(join(path, '输入', '源文件'), { recursive: true }),
    mkdir(join(path, '产出'), { recursive: true }),
    mkdir(join(path, '.promax', 'judge'), { recursive: true }),
  ])
  try {
    await writeFile(
      join(path, '.promax', 'source-ledger.md'),
      '# 来源台账\n\n> 由 Promax 管理。团队只读取“输入”，正式结果写入“产出”。\n',
      { encoding: 'utf8', flag: 'wx' },
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export async function ensureProjectWorkspace(
  workspaceRegistry: WorkspaceRegistry,
  root: string,
  projectName: string,
): Promise<WorkspaceRecord> {
  const trimmedName = projectNameOf(projectName)
  const normalizedRoot = resolve(root)
  const workspacePath = resolve(normalizedRoot, trimmedName)
  if (!workspacePath.startsWith(`${normalizedRoot}${sep}`)) throw new Error('项目组路径越界')
  await scaffoldProject(workspacePath)
  return workspaceRegistry.create(workspacePath, trimmedName)
}

function taskKeyOf(value: unknown): string {
  return sessionScopeNameOf(value)
}

function dispatchMemberIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || !/^[a-z][a-z0-9_]{2,47}$/u.test(item))) {
    throw new Error(`${label}无效`)
  }
  const memberIds = value as string[]
  if (new Set(memberIds).size !== memberIds.length) throw new Error(`${label}不得重复`)
  return memberIds
}

function dispatchPlanIdOf(value: unknown): string {
  const planId = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(planId)) throw new Error('调度计划标识无效')
  return planId
}

function dispatchPlanPath(root: string, sessionId: string, state: 'planning' | 'confirmed'): string {
  return join(resolve(root), `${sessionId}.${state}.json`)
}

function dispatchPlanControlOf(value: unknown, expectedState: 'planning' | 'confirmed'): DispatchPlanControl {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('调度计划控制文件无效')
  const row = value as Record<string, unknown>
  const metadata = typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : undefined
  const spec = typeof row.spec === 'object' && row.spec !== null && !Array.isArray(row.spec) ? row.spec as Record<string, unknown> : undefined
  const sessionId = sessionIdOf(metadata?.session_id)
  const planId = dispatchPlanIdOf(metadata?.plan_id)
  const taskKey = taskKeyOf(metadata?.task_key)
  const createdAt = typeof metadata?.created_at === 'string' && !Number.isNaN(Date.parse(metadata.created_at)) ? metadata.created_at : ''
  if (row.api_version !== 'promax.ai/v1alpha2' || row.kind !== 'DispatchPlanControl' || createdAt === '' || spec?.state !== expectedState) {
    throw new Error('调度计划控制文件格式无效')
  }
  const rosterMemberIds = dispatchMemberIds(spec.roster_member_ids, '调度计划团队名单')
  if (expectedState === 'planning') {
    return {
      api_version: 'promax.ai/v1alpha2',
      kind: 'DispatchPlanControl',
      metadata: { session_id: sessionId, plan_id: planId, task_key: taskKey, created_at: createdAt },
      spec: { state: 'planning', roster_member_ids: rosterMemberIds },
    }
  }
  const confirmedMemberIds = dispatchMemberIds(spec.confirmed_member_ids, '已确认成员名单')
  if (confirmedMemberIds.some(memberId => !rosterMemberIds.includes(memberId))) throw new Error('已确认成员不属于当前团队名单')
  const confirmedAt = typeof spec.confirmed_at === 'string' && !Number.isNaN(Date.parse(spec.confirmed_at)) ? spec.confirmed_at : ''
  if (confirmedAt === '') throw new Error('调度计划确认时间无效')
  return {
    api_version: 'promax.ai/v1alpha2',
    kind: 'DispatchPlanControl',
    metadata: { session_id: sessionId, plan_id: planId, task_key: taskKey, created_at: createdAt },
    spec: { state: 'confirmed', roster_member_ids: rosterMemberIds, confirmed_member_ids: confirmedMemberIds, confirmed_at: confirmedAt },
  }
}

async function optionalDispatchPlanControl(path: string, state: 'planning' | 'confirmed'): Promise<DispatchPlanControl | undefined> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('调度计划控制文件必须是普通文件')
    return dispatchPlanControlOf(JSON.parse(await readFile(path, 'utf8')) as unknown, state)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Opens a server-owned planning gate before the model sees the demand. */
export async function beginDispatchPlan(root: string, input: { sessionId: string; taskKey: string; rosterMemberIds: string[] }): Promise<{ planId: string; taskKey: string }> {
  const sessionId = sessionIdOf(input.sessionId)
  const taskKey = taskKeyOf(input.taskKey)
  const rosterMemberIds = dispatchMemberIds(input.rosterMemberIds, '调度计划团队名单')
  if (!rosterMemberIds.includes('quality_judge')) throw new Error('调度团队缺少固定 Judge')
  const directory = resolve(root)
  await mkdir(directory, { recursive: true })
  const existing = await optionalDispatchPlanControl(dispatchPlanPath(directory, sessionId, 'planning'), 'planning')
  if (existing !== undefined) {
    if (existing.metadata.task_key !== taskKey || existing.spec.roster_member_ids.join('\0') !== rosterMemberIds.join('\0')) throw new Error('当前会话已有另一份调度计划')
    return { planId: existing.metadata.plan_id, taskKey }
  }
  const planId = `dispatch-${randomUUID()}`
  const control: DispatchPlanControl = {
    api_version: 'promax.ai/v1alpha2',
    kind: 'DispatchPlanControl',
    metadata: { session_id: sessionId, plan_id: planId, task_key: taskKey, created_at: new Date().toISOString() },
    spec: { state: 'planning', roster_member_ids: rosterMemberIds },
  }
  await writeFile(dispatchPlanPath(directory, sessionId, 'planning'), `${JSON.stringify(control, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return { planId, taskKey }
}

/** Freezes the user-picked member ids once; a different retry cannot replace them. */
export async function confirmDispatchPlan(root: string, input: { sessionId: string; planId: string; confirmedMemberIds: string[] }): Promise<{ planId: string; taskKey: string; confirmedMemberIds: string[]; confirmedAt: string }> {
  const sessionId = sessionIdOf(input.sessionId)
  const planId = dispatchPlanIdOf(input.planId)
  const confirmedMemberIds = dispatchMemberIds(input.confirmedMemberIds, '已确认成员名单')
  if (!confirmedMemberIds.includes('quality_judge')) throw new Error('已确认名单必须包含固定 Judge')
  if (!confirmedMemberIds.some(memberId => memberId !== 'quality_judge')) throw new Error('已确认名单必须包含至少一名业务成员')
  const directory = resolve(root)
  const confirmedPath = dispatchPlanPath(directory, sessionId, 'confirmed')
  const existing = await optionalDispatchPlanControl(confirmedPath, 'confirmed')
  if (existing !== undefined) {
    if (existing.metadata.plan_id !== planId || existing.spec.confirmed_member_ids?.join('\0') !== confirmedMemberIds.join('\0')) {
      throw new Error('调度名单已经确认，不能再次修改')
    }
    return { planId, taskKey: existing.metadata.task_key, confirmedMemberIds, confirmedAt: existing.spec.confirmed_at! }
  }
  const planning = await optionalDispatchPlanControl(dispatchPlanPath(directory, sessionId, 'planning'), 'planning')
  if (planning === undefined || planning.metadata.plan_id !== planId) throw new Error('找不到当前待确认的调度计划')
  if (confirmedMemberIds.some(memberId => !planning.spec.roster_member_ids.includes(memberId))) throw new Error('已确认成员不属于当前团队名单')
  const confirmedAt = new Date().toISOString()
  const control: DispatchPlanControl = {
    ...planning,
    spec: {
      state: 'confirmed',
      roster_member_ids: planning.spec.roster_member_ids,
      confirmed_member_ids: confirmedMemberIds,
      confirmed_at: confirmedAt,
    },
  }
  try {
    await writeFile(confirmedPath, `${JSON.stringify(control, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return confirmDispatchPlan(directory, input)
  }
  return { planId, taskKey: planning.metadata.task_key, confirmedMemberIds, confirmedAt }
}

interface DispatchExecutionInput {
  planId: string
  taskKey: string
  demand: string
  attachmentPaths: string[]
  confirmedMemberIds: string[]
}

interface EvidenceInputSource {
  source_id: string
  relative_path: string
  sha256: string
  media_type: string
  origin_kind: 'user-provided' | 'web-snapshot'
  original_url?: string
  captured_at?: string
  fetch_status?: 'success' | 'failed'
  http_status?: number
}

interface EvidenceInputFile {
  source_id: string
  original_filename: string
  relative_path: string
  bytes: number
  sha256: string
  agent_readable: boolean
  conversion?: { tool: string; version: string; from_source_id: string }
}

interface TaskManifestArtifact {
  artifact_kind: string
  validation_kind: string
  relative_path: string
  produced_by: string
  domain_rubric?: unknown
}

interface TaskExecutionManifest {
  api_version: 'promax.ai/v1alpha2'
  kind: 'TaskPackage'
  metadata: { task_key: string; team_revision_id: string; confirmed_at: string }
  spec: {
    input_manifest_path: string
    members_confirmed: string[]
    artifacts: TaskManifestArtifact[]
    judge: { relative_path: string; produced_by: 'quality_judge' }
  }
}

interface TaskManifestContract {
  confirmed_at: string
  members_confirmed: string[]
  deliverables: TaskManifestArtifact[]
  judge: { relative_path: string; produced_by: 'quality_judge' }
}

interface EvidenceInputManifest {
  api_version: 'promax.ai/v1alpha2'
  kind: 'EvidenceInputManifest'
  metadata: { task_key: string; frozen: true; frozen_at: string }
  inputs: { src_files: EvidenceInputFile[] }
  spec: { source_root: string; sources: EvidenceInputSource[] }
}

function objectRow(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}格式无效`)
  return value as Record<string, unknown>
}

function exactKeys(row: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(row).find(key => !allowed.includes(key))
  if (unexpected !== undefined) throw new Error(`${label}包含未知字段 ${unexpected}`)
}

function eventText(event: DispatchSessionEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  const data = objectRow(event.data, '会话消息')
  if (!Array.isArray(data.content)) return undefined
  return data.content.flatMap(block => {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) return []
    const row = block as Record<string, unknown>
    return row.type === 'text' && typeof row.text === 'string' ? [row.text] : []
  }).join('\n')
}

function firstJsonObject(text: string, offset: number): Record<string, unknown> {
  const start = text.indexOf('{', offset)
  if (start < 0) throw new Error('执行请求缺少 JSON 数据')
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return objectRow(JSON.parse(text.slice(start, index + 1)) as unknown, '执行请求')
        } catch (error) {
          throw new Error(`执行请求 JSON 无效：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }
  throw new Error('执行请求 JSON 未闭合')
}

function executionInputOf(events: readonly DispatchSessionEvent[], control: DispatchPlanControl): DispatchExecutionInput {
  const marker = 'PROMAX_DISPATCH_EXECUTE_V1'
  let text: string | undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = eventText(events[index]!)
    if (candidate?.includes(marker)) { text = candidate; break }
  }
  if (text === undefined) throw new Error('会话缺少 PROMAX_DISPATCH_EXECUTE_V1 执行请求')
  const row = firstJsonObject(text, text.indexOf(marker) + marker.length)
  const planId = dispatchPlanIdOf(row.plan_id)
  const taskKey = taskKeyOf(row.task_key)
  const demand = typeof row.demand === 'string' ? row.demand.normalize('NFC').trim() : ''
  const attachmentPaths = Array.isArray(row.attachment_paths) && row.attachment_paths.every(path => typeof path === 'string')
    ? row.attachment_paths.map(path => path.normalize('NFC'))
    : undefined
  const confirmedMemberIds = dispatchMemberIds(row.confirmed_member_ids, '执行请求成员名单')
  if (planId !== control.metadata.plan_id || taskKey !== control.metadata.task_key) throw new Error('执行请求与已确认调度计划不一致')
  if (demand === '') throw new Error('执行请求需求不能为空')
  if (attachmentPaths === undefined || new Set(attachmentPaths).size !== attachmentPaths.length) throw new Error('执行请求附件路径无效或重复')
  if (confirmedMemberIds.join('\0') !== control.spec.confirmed_member_ids?.join('\0')) throw new Error('执行请求成员名单与已确认名单不一致')
  return { planId, taskKey, demand, attachmentPaths, confirmedMemberIds }
}

const ATTACHMENT_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.yml': 'application/yaml',
  '.yaml': 'application/yaml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const CONVERTERS = {
  '.docx': { tool: 'mammoth', version: '1.12.2', extension: '.md', mediaType: 'text/markdown' },
  '.pdf': { tool: 'pdf-parse', version: '2.4.5', extension: '.md', mediaType: 'text/markdown' },
  '.xlsx': { tool: 'exceljs', version: '4.4.0', extension: '.csv', mediaType: 'text/csv' },
} as const

interface UploadedAttachment {
  bytes: Buffer
  filename: string
  originalFilename: string
  extension: string
  mediaType: string
}

interface MaterializedAttachment extends UploadedAttachment {
  sourceId: string
  agentReadable: boolean
  conversion?: EvidenceInputFile['conversion']
  pageCount?: number
}

function frozenSourceFilename(file: Pick<MaterializedAttachment, 'sourceId' | 'extension'>): string {
  const extension = /^\.[A-Za-z0-9_-]+$/u.test(file.extension) ? file.extension : '.bin'
  return `${file.sourceId}${extension}`
}

function sourceFilename(path: string): string {
  const original = basename(path)
  const checked = attachmentNameOf(original)
  if (checked !== original) throw new Error(`附件“${original}”的名称与上传时不一致，请重新选择文件`)
  return original
}

async function uploadedAttachment(workspace: string, sessionId: string, path: string): Promise<UploadedAttachment> {
  const prefix = `输入/源文件/${sessionId}/`
  if (!path.startsWith(prefix) || path.slice(prefix.length) === '' || path.slice(prefix.length).includes('/') || path.includes('\\') || path.includes('..')) {
    throw new Error(`附件路径不属于当前会话：${path}`)
  }
  const file = resolve(workspace, ...path.split('/'))
  const attachmentRoot = resolve(workspace, '输入', '源文件', sessionId)
  if (!file.startsWith(`${attachmentRoot}${sep}`)) throw new Error(`附件路径越出当前会话目录：${path}`)
  let info
  let bytes: Buffer
  try {
    info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`附件必须是普通文件：${path}`)
    bytes = await readFile(file)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('附件必须')) throw error
    throw new Error(`附件“${basename(path)}”读取失败，请重新上传`)
  }
  const extension = extname(file).toLowerCase()
  attachmentExtensionOf(file)
  return {
    bytes,
    filename: sourceFilename(file),
    originalFilename: basename(file),
    extension,
    mediaType: ATTACHMENT_MEDIA_TYPES[extension]!,
  }
}

function markdownConversion(filename: string, text: string): Buffer {
  const content = text.trim()
  if (content === '') throw new Error(`文档“${filename}”没有可转换的文本内容`)
  return Buffer.from(`# 从 ${filename} 转换\n\n${content}\n`, 'utf8')
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

async function convertOfficeAttachment(file: UploadedAttachment): Promise<{ bytes: Buffer; filename: string; mediaType: string; tool: string; version: string; pageCount?: number }> {
  const converter = CONVERTERS[file.extension as keyof typeof CONVERTERS]
  if (converter === undefined) throw new Error(`文档“${file.originalFilename}”没有可用的转换器`)
  try {
    if (file.extension === '.docx') {
      const result = await mammoth.extractRawText({ buffer: file.bytes })
      return { bytes: markdownConversion(file.originalFilename, result.value), filename: 'agent-readable.md', mediaType: converter.mediaType, tool: converter.tool, version: converter.version }
    }
    if (file.extension === '.pdf') {
      const parser = new PDFParse({ data: file.bytes })
      try {
        const result = await parser.getText()
        if (result.text.trim() === '') throw new Error('PDF 中没有可搜索文字，可能是扫描件；请先进行 OCR 或上传可搜索 PDF')
        return { bytes: markdownConversion(file.originalFilename, result.text), filename: 'agent-readable.md', mediaType: converter.mediaType, tool: converter.tool, version: converter.version, pageCount: result.total }
      } finally {
        await parser.destroy()
      }
    }
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Uint8Array.from(file.bytes).buffer)
    if (workbook.worksheets.length === 0) throw new Error('工作簿没有工作表')
    const lines: string[] = []
    for (const [sheetIndex, worksheet] of workbook.worksheets.entries()) {
      if (sheetIndex > 0) lines.push('')
      lines.push(['__sheet__', worksheet.name].map(csvCell).join(','))
      for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber)
        const values = Array.from({ length: Math.max(worksheet.columnCount, row.cellCount) }, (_unused, index) => row.getCell(index + 1).text)
        lines.push(values.map(csvCell).join(','))
      }
    }
    return { bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'), filename: 'agent-readable.csv', mediaType: converter.mediaType, tool: converter.tool, version: converter.version }
  } catch (error) {
    const detail = error instanceof Error ? error.message : ''
    if (file.extension === '.pdf' && /password|encrypted|encryption/iu.test(detail)) {
      throw new Error(`PDF“${file.originalFilename}”已加密，解除密码后再上传`)
    }
    if (/没有可搜索文字|没有可转换的文本内容|工作簿没有工作表/u.test(detail)) {
      throw new Error(`文档“${file.originalFilename}”转换失败：${detail}`)
    }
    throw new Error(`文档“${file.originalFilename}”转换失败，请确认文件未损坏且内容可读取后重试（${converter.tool} ${converter.version}）`)
  }
}

export interface PlanningAttachmentContext {
  path: string
  name: string
  mediaType: string
  bytes: number
  readablePath: string
  textCharacters: number
  excerpt: string
  truncated: boolean
  converter?: string
  pageCount?: number
}

const PLANNING_ATTACHMENT_EXCERPT_PER_FILE = 12_000
const PLANNING_ATTACHMENT_EXCERPT_TOTAL = 40_000

function codePointSlice(value: string, limit: number): { text: string; characters: number; truncated: boolean } {
  const characters = Array.from(value.trim())
  return {
    text: characters.slice(0, limit).join(''),
    characters: characters.length,
    truncated: characters.length > limit,
  }
}

async function installPlanningReadableFile(workspace: string, sessionId: string, sourceId: string, filename: string, bytes: Buffer): Promise<string> {
  const relativePath = `.promax/planning-input/${sessionId}/${sourceId}/${filename}`
  const target = resolve(workspace, ...relativePath.split('/'))
  const directory = resolve(workspace, '.promax', 'planning-input', sessionId, sourceId)
  if (!target.startsWith(`${directory}${sep}`)) throw new Error('附件预解析路径越界')
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(target, bytes, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await readFile(target)
    if (sha256(existing) !== sha256(bytes)) throw new Error(`附件“${filename}”的预解析结果发生冲突，请重新创建需求`)
  }
  return relativePath
}

/** Converts uploaded documents before planning and returns a bounded, model-readable context. */
export async function prepareTaskAttachmentsForPlanning(
  workspacePath: string,
  sessionIdValue: string,
  paths: readonly string[],
): Promise<PlanningAttachmentContext[]> {
  const workspace = resolve(workspacePath)
  const sessionId = sessionIdOf(sessionIdValue)
  if (paths.length > MAX_ATTACHMENT_COUNT || new Set(paths).size !== paths.length) throw new Error('待解析附件数量无效或重复')
  const uploaded = await Promise.all(paths.map(path => uploadedAttachment(workspace, sessionId, path)))
  const contexts: PlanningAttachmentContext[] = []
  let remaining = PLANNING_ATTACHMENT_EXCERPT_TOTAL
  for (const [index, file] of uploaded.entries()) {
    const converted = OFFICE_ATTACHMENT_EXTENSIONS.has(file.extension) ? await convertOfficeAttachment(file) : undefined
    const readableBytes = converted?.bytes ?? file.bytes
    const readableName = converted?.filename ?? file.filename
    const readablePath = converted === undefined
      ? paths[index]!
      : await installPlanningReadableFile(workspace, sessionId, `SRC-${String(index + 1).padStart(3, '0')}`, readableName, readableBytes)
    const text = readableBytes.toString('utf8').replaceAll('\u0000', '').trim()
    if (text === '') throw new Error(`文档“${file.originalFilename}”没有可供智能体阅读的文字`)
    const filesLeft = uploaded.length - index
    const limit = Math.min(PLANNING_ATTACHMENT_EXCERPT_PER_FILE, Math.max(1, Math.floor(remaining / filesLeft)))
    const excerpt = codePointSlice(text, limit)
    remaining -= Array.from(excerpt.text).length
    contexts.push({
      path: paths[index]!,
      name: file.originalFilename,
      mediaType: file.mediaType,
      bytes: file.bytes.byteLength,
      readablePath,
      textCharacters: excerpt.characters,
      excerpt: excerpt.text,
      truncated: excerpt.truncated,
      ...(converted === undefined ? {} : { converter: `${converted.tool} ${converted.version}` }),
      ...(converted?.pageCount === undefined ? {} : { pageCount: converted.pageCount }),
    })
  }
  return contexts
}

async function materializeAttachments(workspace: string, sessionId: string, paths: readonly string[]): Promise<MaterializedAttachment[]> {
  const uploaded = await Promise.all(paths.map(path => uploadedAttachment(workspace, sessionId, path)))
  const materialized: MaterializedAttachment[] = []
  let ordinal = 1
  for (const file of uploaded) {
    const sourceId = `SRC-${String(ordinal).padStart(3, '0')}`
    ordinal += 1
    materialized.push({ ...file, sourceId, agentReadable: TEXT_ATTACHMENT_EXTENSIONS.has(file.extension) })
    if (OFFICE_ATTACHMENT_EXTENSIONS.has(file.extension)) {
      const converted = await convertOfficeAttachment(file)
      const convertedSourceId = `SRC-${String(ordinal).padStart(3, '0')}`
      ordinal += 1
      materialized.push({
        bytes: converted.bytes,
        filename: converted.filename,
        originalFilename: file.originalFilename,
        extension: extname(converted.filename),
        mediaType: converted.mediaType,
        sourceId: convertedSourceId,
        agentReadable: true,
        conversion: { tool: converted.tool, version: converted.version, from_source_id: sourceId },
        ...(converted.pageCount === undefined ? {} : { pageCount: converted.pageCount }),
      })
    }
  }
  return materialized
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function evidenceManifestOf(value: unknown, taskKey: string): EvidenceInputManifest {
  const row = objectRow(value, 'EvidenceInputManifest')
  exactKeys(row, ['api_version', 'kind', 'metadata', 'inputs', 'spec'], 'EvidenceInputManifest')
  const metadata = objectRow(row.metadata, 'EvidenceInputManifest.metadata')
  const inputs = row.inputs === undefined ? { src_files: [] } : objectRow(row.inputs, 'EvidenceInputManifest.inputs')
  const spec = objectRow(row.spec, 'EvidenceInputManifest.spec')
  exactKeys(metadata, ['task_key', 'frozen', 'frozen_at'], 'EvidenceInputManifest.metadata')
  exactKeys(inputs, ['src_files'], 'EvidenceInputManifest.inputs')
  exactKeys(spec, ['source_root', 'sources'], 'EvidenceInputManifest.spec')
  if (row.api_version !== 'promax.ai/v1alpha2' || row.kind !== 'EvidenceInputManifest'
    || metadata.task_key !== taskKey || metadata.frozen !== true
    || typeof metadata.frozen_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(metadata.frozen_at)
    || !Array.isArray(inputs.src_files) || inputs.src_files.length > 256
    || spec.source_root !== `.promax/input/${taskKey}/sources`
    || !Array.isArray(spec.sources) || spec.sources.length < 1 || spec.sources.length > 256) {
    throw new Error('EvidenceInputManifest Schema 校验失败')
  }
  const ids = new Set<string>()
  const sources = spec.sources.map((value, index) => {
    const source = objectRow(value, `EvidenceInputManifest.spec.sources[${String(index)}]`)
    exactKeys(source, ['source_id', 'relative_path', 'sha256', 'media_type', 'origin_kind', 'original_url', 'captured_at', 'fetch_status', 'http_status'], `EvidenceInputManifest.spec.sources[${String(index)}]`)
    const sourceId = typeof source.source_id === 'string' ? source.source_id : ''
    const relativePath = typeof source.relative_path === 'string' ? source.relative_path : ''
    const mediaType = typeof source.media_type === 'string' ? source.media_type : ''
    const originKind = source.origin_kind
    const sourcePathPrefix = `.promax/input/${taskKey}/sources/${sourceId}/`
    const sourceLeaf = relativePath.startsWith(sourcePathPrefix) ? relativePath.slice(sourcePathPrefix.length) : ''
    if (!/^SRC-[0-9]{3,6}$/u.test(sourceId) || ids.has(sourceId)
      || sourceLeaf === '' || sourceLeaf.includes('/') || !isSafeAttachmentLeaf(sourceLeaf)
      || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(source.sha256)
      || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType)
      || (originKind !== 'user-provided' && originKind !== 'web-snapshot')) {
      throw new Error(`EvidenceInputManifest source ${String(index + 1)} Schema 校验失败`)
    }
    if (originKind === 'web-snapshot' && (
      typeof source.original_url !== 'string' || !/^https?:\/\//u.test(source.original_url)
      || typeof source.captured_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(source.captured_at)
      || (source.fetch_status !== 'success' && source.fetch_status !== 'failed')
      || typeof source.http_status !== 'number' || !Number.isSafeInteger(source.http_status) || source.http_status < 0 || source.http_status > 599
    )) throw new Error(`EvidenceInputManifest web source ${String(index + 1)} Schema 校验失败`)
    ids.add(sourceId)
    return source as unknown as EvidenceInputSource
  })
  const srcFiles = inputs.src_files.map((value, index) => {
    const file = objectRow(value, `EvidenceInputManifest.inputs.src_files[${String(index)}]`)
    exactKeys(file, ['source_id', 'original_filename', 'relative_path', 'bytes', 'sha256', 'agent_readable', 'conversion'], `EvidenceInputManifest.inputs.src_files[${String(index)}]`)
    const conversion = file.conversion === undefined ? undefined : objectRow(file.conversion, `EvidenceInputManifest.inputs.src_files[${String(index)}].conversion`)
    if (conversion !== undefined) exactKeys(conversion, ['tool', 'version', 'from_source_id'], `EvidenceInputManifest.inputs.src_files[${String(index)}].conversion`)
    if (typeof file.source_id !== 'string' || !/^SRC-[0-9]{3,6}$/u.test(file.source_id)
      || typeof file.original_filename !== 'string' || file.original_filename === '' || file.original_filename.length > 255
      || typeof file.relative_path !== 'string' || !file.relative_path.startsWith(`.promax/input/${taskKey}/sources/${file.source_id}/`)
      || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 0
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)
      || typeof file.agent_readable !== 'boolean'
      || (conversion !== undefined && (
        typeof conversion.tool !== 'string' || conversion.tool === ''
        || typeof conversion.version !== 'string' || conversion.version === ''
        || typeof conversion.from_source_id !== 'string' || !/^SRC-[0-9]{3,6}$/u.test(conversion.from_source_id)
      ))) throw new Error(`EvidenceInputManifest src_file ${String(index + 1)} Schema 校验失败`)
    return {
      source_id: file.source_id,
      original_filename: file.original_filename,
      relative_path: file.relative_path,
      bytes: file.bytes,
      sha256: file.sha256,
      agent_readable: file.agent_readable,
      ...(conversion === undefined ? {} : { conversion: { tool: conversion.tool as string, version: conversion.version as string, from_source_id: conversion.from_source_id as string } }),
    }
  })
  return {
    api_version: 'promax.ai/v1alpha2',
    kind: 'EvidenceInputManifest',
    metadata: { task_key: taskKey, frozen: true, frozen_at: metadata.frozen_at },
    inputs: { src_files: srcFiles },
    spec: { source_root: spec.source_root, sources },
  }
}

async function validateEvidenceManifestFiles(workspace: string, manifest: EvidenceInputManifest): Promise<void> {
  const sources = new Map(manifest.spec.sources.map(source => [source.source_id, source]))
  for (const source of manifest.spec.sources) {
    const path = resolve(workspace, ...source.relative_path.split('/'))
    if (!path.startsWith(`${workspace}${sep}`)) throw new Error(`输入源路径越出工作区：${source.relative_path}`)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`输入源必须是普通文件：${source.relative_path}`)
    const bytes = await readFile(path)
    if (sha256(bytes) !== source.sha256) throw new Error(`输入源 sha256 不匹配：${source.source_id}`)
  }
  for (const file of manifest.inputs.src_files) {
    const source = sources.get(file.source_id)
    if (source === undefined || source.relative_path !== file.relative_path || source.sha256 !== file.sha256) {
      throw new Error(`src_files 与证据源登记不一致：${file.source_id}`)
    }
    const path = resolve(workspace, ...file.relative_path.split('/'))
    const bytes = await readFile(path)
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`src_files 写后校验失败：${file.source_id}`)
  }
}

function sameBaseSources(current: EvidenceInputManifest, expected: EvidenceInputManifest): boolean {
  if (current.spec.sources.length < expected.spec.sources.length) return false
  return expected.spec.sources.every((source, index) => JSON.stringify(current.spec.sources[index]) === JSON.stringify(source))
    && JSON.stringify(current.inputs.src_files) === JSON.stringify(expected.inputs.src_files)
}

type DispatchEvidencePreparationResult = { manifestPath: string; sources: number; replacedInvalidManifest: boolean }

const dispatchEvidencePreparations = new Map<string, Promise<DispatchEvidencePreparationResult>>()

async function prepareDispatchEvidenceInputOnce(input: {
  workspacePath: string
  sessionId: string
  taskKey: string
  demand: string
  attachmentPaths: string[]
  frozenAt: string
}, preparedAttachments?: readonly MaterializedAttachment[]): Promise<DispatchEvidencePreparationResult> {
  const workspace = resolve(input.workspacePath)
  const sessionId = sessionIdOf(input.sessionId)
  const taskKey = taskKeyOf(input.taskKey)
  if (input.demand.trim() === '') throw new Error('冻结输入需求不能为空')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.frozenAt)) throw new Error('冻结输入时间无效')
  if (new Set(input.attachmentPaths).size !== input.attachmentPaths.length) throw new Error('冻结输入附件路径不得重复')

  const attachments = preparedAttachments === undefined
    ? await materializeAttachments(workspace, sessionId, input.attachmentPaths)
    : [...preparedAttachments]
  const sourceRoot = `.promax/input/${taskKey}/sources`
  const demandContent = `${input.demand.trim()}\n`
  const attachmentSources: EvidenceInputSource[] = attachments.map(file => ({
    source_id: file.sourceId,
    relative_path: `${sourceRoot}/${file.sourceId}/${frozenSourceFilename(file)}`,
    sha256: sha256(file.bytes),
    media_type: file.mediaType,
    origin_kind: 'user-provided' as const,
  }))
  const demandSourceId = `SRC-${String(attachments.length + 1).padStart(3, '0')}`
  const sources: EvidenceInputSource[] = [...attachmentSources, {
    source_id: demandSourceId,
    relative_path: `${sourceRoot}/${demandSourceId}/demand.md`,
    sha256: sha256(demandContent),
    media_type: 'text/markdown',
    origin_kind: 'user-provided',
  }]
  const srcFiles: EvidenceInputFile[] = attachments.map(file => ({
    source_id: file.sourceId,
    original_filename: file.originalFilename,
    relative_path: `${sourceRoot}/${file.sourceId}/${frozenSourceFilename(file)}`,
    bytes: file.bytes.byteLength,
    sha256: sha256(file.bytes),
    agent_readable: file.agentReadable,
    ...(file.conversion === undefined ? {} : { conversion: file.conversion }),
  }))
  const manifest: EvidenceInputManifest = {
    api_version: 'promax.ai/v1alpha2',
    kind: 'EvidenceInputManifest',
    metadata: { task_key: taskKey, frozen: true, frozen_at: input.frozenAt },
    inputs: { src_files: srcFiles },
    spec: { source_root: sourceRoot, sources },
  }
  evidenceManifestOf(manifest, taskKey)

  const inputParent = join(workspace, '.promax', 'input')
  const target = join(inputParent, taskKey)
  const manifestPath = join(target, 'manifest.yml')
  const lock = join(inputParent, `.freeze-${sessionId}.lock`)
  const staging = join(inputParent, `.staging-${sessionId}-${randomUUID()}`)
  await mkdir(inputParent, { recursive: true })
  try {
    await mkdir(lock)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('当前会话的冻结输入正在准备，请稍后重试')
    throw error
  }
  try {
    for (const attachment of attachments) {
      const sourceDirectory = join(staging, 'sources', attachment.sourceId)
      await mkdir(sourceDirectory, { recursive: true })
      await writeFile(join(sourceDirectory, frozenSourceFilename(attachment)), attachment.bytes, { flag: 'wx' })
    }
    await mkdir(join(staging, 'sources', demandSourceId), { recursive: true })
    await writeFile(join(staging, 'sources', demandSourceId, 'demand.md'), demandContent, { flag: 'wx' })
    await writeFile(join(staging, 'manifest.yml'), evidenceManifestYaml(manifest), { encoding: 'utf8', flag: 'wx' })
    for (const source of sources) {
      const stagedPath = join(staging, ...source.relative_path.split('/').slice(-3))
      const bytes = await readFile(stagedPath)
      if (bytes.byteLength === 0 || sha256(bytes) !== source.sha256) throw new Error(`冻结输入写后校验失败：${source.source_id}`)
    }

    let current: EvidenceInputManifest | undefined
    let targetExists = false
    try {
      const info = await lstat(target)
      targetExists = true
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('既有冻结输入路径不是普通目录')
      current = evidenceManifestOf(YAML.parse(await readFile(manifestPath, 'utf8')) as unknown, taskKey)
      await validateEvidenceManifestFiles(workspace, current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !targetExists) current = undefined
      else if (!targetExists) throw error
    }

    if (current !== undefined) {
      if (!sameBaseSources(current, manifest)) throw new Error(`不可变输入已经冻结且与当前执行请求不一致：${manifestPath}`)
      await rm(staging, { recursive: true, force: true })
      return { manifestPath, sources: current.spec.sources.length, replacedInvalidManifest: false }
    }

    let replacedInvalidManifest = false
    let quarantine: string | undefined
    if (targetExists) {
      quarantine = join(inputParent, `.rejected-${sessionId}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`)
      await rename(target, quarantine)
      replacedInvalidManifest = true
    }
    try {
      await rename(staging, target)
    } catch (error) {
      if (quarantine !== undefined) await rename(quarantine, target)
      throw error
    }
    const installed = evidenceManifestOf(YAML.parse(await readFile(manifestPath, 'utf8')) as unknown, taskKey)
    await validateEvidenceManifestFiles(workspace, installed)
    return { manifestPath, sources: installed.spec.sources.length, replacedInvalidManifest }
  } finally {
    await rm(staging, { recursive: true, force: true })
    await rm(lock, { recursive: true, force: true })
  }
}

/** Materializes the server-owned immutable input before any confirmed member can start. */
export async function prepareDispatchEvidenceInput(input: {
  workspacePath: string
  sessionId: string
  taskKey: string
  demand: string
  attachmentPaths: string[]
  frozenAt: string
}): Promise<DispatchEvidencePreparationResult> {
  return prepareDispatchEvidenceInputCoordinated(input)
}

async function prepareDispatchEvidenceInputCoordinated(input: {
  workspacePath: string
  sessionId: string
  taskKey: string
  demand: string
  attachmentPaths: string[]
  frozenAt: string
}, preparedAttachments?: readonly MaterializedAttachment[]): Promise<DispatchEvidencePreparationResult> {
  const key = `${resolve(input.workspacePath)}\0${sessionIdOf(input.sessionId)}\0${taskKeyOf(input.taskKey)}`
  const active = dispatchEvidencePreparations.get(key)
  if (active !== undefined) return active
  const pending = prepareDispatchEvidenceInputOnce(input, preparedAttachments)
  dispatchEvidencePreparations.set(key, pending)
  try {
    return await pending
  } finally {
    if (dispatchEvidencePreparations.get(key) === pending) dispatchEvidencePreparations.delete(key)
  }
}

function planningContextsFromMaterialized(taskKey: string, paths: readonly string[], materialized: readonly MaterializedAttachment[]): PlanningAttachmentContext[] {
  const sourceRoot = `.promax/input/${taskKeyOf(taskKey)}/sources`
  const originals = materialized.filter(file => file.conversion === undefined)
  if (originals.length !== paths.length) throw new Error('附件解析结果与上传文件数量不一致')
  let remaining = PLANNING_ATTACHMENT_EXCERPT_TOTAL
  return originals.map((file, index) => {
    const readable = file.agentReadable
      ? file
      : materialized.find(candidate => candidate.conversion?.from_source_id === file.sourceId)
    if (readable === undefined) throw new Error(`文档“${file.originalFilename}”没有可供智能体阅读的转换结果`)
    const text = readable.bytes.toString('utf8').replaceAll('\u0000', '').trim()
    if (text === '') throw new Error(`文档“${file.originalFilename}”没有可供智能体阅读的文字`)
    const filesLeft = originals.length - index
    const limit = Math.min(PLANNING_ATTACHMENT_EXCERPT_PER_FILE, Math.max(1, Math.floor(remaining / filesLeft)))
    const excerpt = codePointSlice(text, limit)
    remaining -= Array.from(excerpt.text).length
    return {
      path: paths[index]!,
      name: file.originalFilename,
      mediaType: file.mediaType,
      bytes: file.bytes.byteLength,
      readablePath: `${sourceRoot}/${readable.sourceId}/${frozenSourceFilename(readable)}`,
      textCharacters: excerpt.characters,
      excerpt: excerpt.text,
      truncated: excerpt.truncated,
      ...(readable.conversion === undefined ? {} : { converter: `${readable.conversion.tool} ${readable.conversion.version}` }),
      ...(readable.pageCount === undefined ? {} : { pageCount: readable.pageCount }),
    }
  })
}

function topicAttachmentsFromMaterialized(materialized: readonly MaterializedAttachment[]): Array<{ name: string; text: string }> {
  return materialized.filter(file => file.conversion === undefined).map(file => {
    const readable = file.agentReadable
      ? file
      : materialized.find(candidate => candidate.conversion?.from_source_id === file.sourceId)
    if (readable === undefined) throw new Error(`文档“${file.originalFilename}”没有可供智能体读取的正文`)
    return { name: file.originalFilename, text: readable.bytes.toString('utf8').replaceAll('\u0000', '').trim() }
  })
}

/** Derives the final task key, claims its output directory, and freezes the exact input package. */
export async function prepareTaskSubmission(input: {
  workspacePath: string
  sessionId: string
  demand: string
  attachmentPaths: string[]
  frozenAt: string
}): Promise<DispatchEvidencePreparationResult & { taskKey: string; sessionName: string; attachments: PlanningAttachmentContext[] }> {
  const workspace = resolve(input.workspacePath)
  const sessionId = sessionIdOf(input.sessionId)
  if (input.attachmentPaths.length > MAX_ATTACHMENT_COUNT || new Set(input.attachmentPaths).size !== input.attachmentPaths.length) {
    throw new Error('冻结输入附件数量无效或存在重复')
  }
  const materialized = await materializeAttachments(workspace, sessionId, input.attachmentPaths)
  const taskKeyCandidate = taskKeyFromSubmission(input.demand, topicAttachmentsFromMaterialized(materialized))
  const scope = await ensureSessionOutputDirectory(workspace, sessionId, taskKeyCandidate)
  const effectiveDemand = input.demand.trim() === '' ? scope.taskKey : input.demand
  const attachments = planningContextsFromMaterialized(scope.taskKey, input.attachmentPaths, materialized)
  const result = await prepareDispatchEvidenceInputCoordinated({
    ...input,
    workspacePath: workspace,
    sessionId,
    taskKey: scope.taskKey,
    demand: effectiveDemand,
  }, materialized)
  return { ...result, taskKey: scope.taskKey, sessionName: scope.sessionName, attachments }
}

/** Converts once, freezes the verified package, and returns the same readable content used for planning. */
export async function prepareTaskSubmissionInput(input: {
  workspacePath: string
  sessionId: string
  taskKey: string
  demand: string
  attachmentPaths: string[]
  frozenAt: string
}): Promise<DispatchEvidencePreparationResult & { attachments: PlanningAttachmentContext[] }> {
  const workspace = resolve(input.workspacePath)
  const sessionId = sessionIdOf(input.sessionId)
  if (input.attachmentPaths.length > MAX_ATTACHMENT_COUNT
    || new Set(input.attachmentPaths).size !== input.attachmentPaths.length) {
    throw new Error('冻结输入附件数量无效或存在重复')
  }
  const materialized = await materializeAttachments(workspace, sessionId, input.attachmentPaths)
  const attachments = planningContextsFromMaterialized(input.taskKey, input.attachmentPaths, materialized)
  const result = await prepareDispatchEvidenceInputCoordinated(input, materialized)
  return { ...result, attachments }
}

/** Blocks every planning-stage tool and enforces the immutable confirmed member allowlist during execution. */
export async function enforceDispatchPlanTool(
  root: string,
  exec: DispatchToolExecution,
  next: () => Promise<unknown>,
): Promise<unknown> {
  const frozenInputDenial = frozenInputMutationReason(exec)
  if (frozenInputDenial !== undefined) return { kind: 'deny', reason: frozenInputDenial }
  if (exec.agent === undefined || exec.agent.session.header.origin === 'subagent') return next()
  const sessionId = sessionIdOf(exec.agent.session.header.id)
  const confirmed = await optionalDispatchPlanControl(dispatchPlanPath(root, sessionId, 'confirmed'), 'confirmed')
  if (confirmed !== undefined) {
    const roster = confirmed.spec.roster_member_ids
    const allowed = confirmed.spec.confirmed_member_ids ?? []
    if (roster.includes(exec.name) && !allowed.includes(exec.name)) {
      return { kind: 'deny', reason: `成员 ${exec.name} 不在用户已确认的调度名单中` }
    }
    if (roster.includes(exec.name)) {
      try {
        const cwd = exec.agent.session.header.cwd
        const events = exec.agent.session.events
        if (typeof cwd !== 'string' || cwd.trim() === '' || events === undefined) throw new Error('成员派发缺少当前工作区或执行消息')
        const execution = executionInputOf(events, confirmed)
        await prepareDispatchEvidenceInput({
          workspacePath: cwd,
          sessionId,
          taskKey: execution.taskKey,
          demand: execution.demand,
          attachmentPaths: execution.attachmentPaths,
          frozenAt: confirmed.spec.confirmed_at!,
        })
      } catch (error) {
        return { kind: 'deny', reason: `成员派发前输入准备失败：${error instanceof Error ? error.message : String(error)}` }
      }
    }
    return next()
  }
  const planning = await optionalDispatchPlanControl(dispatchPlanPath(root, sessionId, 'planning'), 'planning')
  if (planning !== undefined) return { kind: 'deny', reason: '调度计划尚未由用户确认；规划阶段禁止调用任何工具或启动成员' }
  return next()
}

const dispatchCompletionAttempts = new Map<string, number>()

function dispatchedMemberName(event: DispatchSessionEvent): string | undefined {
  if (event.type !== 'tool/call' || typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) return undefined
  const data = event.data as Record<string, unknown>
  return typeof data.name === 'string' ? data.name : undefined
}

/** Prevents settlement until the manifest's business files and independent Judge report exist on disk. */
export async function enforceConfirmedDispatchCompleteness(root: string, payload: DispatchTurnStopping): Promise<void> {
  const { agent, turn, signal } = payload
  if (agent.session.header.origin === 'subagent') return
  signal.throwIfAborted()
  const sessionId = sessionIdOf(agent.session.header.id)
  const confirmed = await optionalDispatchPlanControl(dispatchPlanPath(root, sessionId, 'confirmed'), 'confirmed')
  if (confirmed === undefined) return
  const required = confirmed.spec.confirmed_member_ids ?? []
  // Planning is runtime-tool-locked, so a matching call anywhere in this
  // session belongs to the confirmed execution. Once complete, later chat
  // turns must not re-dispatch the team.
  const dispatched = new Set(agent.session.events.map(dispatchedMemberName).filter((name): name is string => name !== undefined))
  const missingBusiness = required.filter(memberId => memberId !== 'quality_judge' && !dispatched.has(memberId))
  const attemptKey = `${sessionId}\0${String(turn)}`
  let instruction = missingBusiness.length === 0
    ? ''
    : `用户确认的业务成员尚有 ${missingBusiness.join('、')} 未派单。现在只调用这些遗漏成员；不得调用名单外成员，也不得直接结束。`
  const cwd = agent.session.header.cwd
  if (typeof cwd !== 'string' || cwd.trim() === '') throw new Error('运行完整性检查缺少当前工作区')
  const execution = executionInputOf(agent.session.events, confirmed)
  const files = await readTaskRunFiles(cwd, { sessionId, taskKey: execution.taskKey })
  if (files.cancellation !== 'running') {
    dispatchCompletionAttempts.delete(attemptKey)
    return
  }
  const missingFiles = files.artifactStates.filter(file => !file.nonEmpty)
  if (instruction === '' && missingFiles.length > 0) {
    // A background member call may settle after the coordinator's current
    // turn. Keep the task open on disk and let that settlement wake the
    // coordinator instead of prematurely dispatching Judge or duplicating work.
    dispatchCompletionAttempts.delete(attemptKey)
    return
  }
  const businessMemberIds = required.filter(memberId => memberId !== 'quality_judge')
  const artifactPaths = files.artifactStates.map(file => file.path)
  const repair = await optionalTaskJudgeRepairControl(cwd, execution.taskKey, sessionId)
  if (instruction === '' && repair?.state === 'passed') {
    await settleTaskRun(cwd, files, 'completed')
    dispatchCompletionAttempts.delete(attemptKey)
    return
  } else if (instruction === '' && repair?.state === 'exhausted') {
    await settleTaskRun(cwd, files, 'failed')
    dispatchCompletionAttempts.delete(attemptKey)
    return
  } else if (instruction === '' && repair === undefined && ['pass', 'force_released'].includes(files.judge.state)) {
    await settleTaskRun(cwd, files, 'completed')
    dispatchCompletionAttempts.delete(attemptKey)
    return
  } else if (instruction === '' && repair === undefined && ['appealed', 'human_required'].includes(files.judge.state)) {
    await settleTaskRun(cwd, files, 'failed')
    dispatchCompletionAttempts.delete(attemptKey)
    return
  } else if (instruction === '' && repair?.state === 'repairing') {
    const currentArtifacts = await artifactFingerprints(cwd, artifactPaths)
    const everyArtifactRegenerated = artifactPaths.every(path => currentArtifacts[path] !== repair.artifactFingerprints[path])
    if (!everyArtifactRegenerated) {
      dispatchCompletionAttempts.delete(attemptKey)
      return
    }
    const judging: TaskJudgeRepairControl = {
      ...repair,
      state: 'judging',
      artifactFingerprints: currentArtifacts,
      judgeFingerprint: await pathFingerprint(cwd, files.judge.path),
      updatedAt: new Date().toISOString(),
    }
    await writeTaskJudgeRepairControl(cwd, judging)
    instruction = `第 ${String(judging.round)}/${String(judging.maxRounds)} 轮业务成员已重新产出。现在调用 quality_judge 只从 ${files.manifestPath} 进入，复判登记产物并覆盖 ${files.judge.path}；报告最后一行必须逐字使用“最终判定：PASS”或“最终判定：FAIL”。`
  } else if (instruction === '' && repair?.state === 'judging') {
    const currentJudgeFingerprint = await pathFingerprint(cwd, files.judge.path)
    if (currentJudgeFingerprint === repair.judgeFingerprint) {
      dispatchCompletionAttempts.delete(attemptKey)
      return
    }
    if (files.judge.state === 'pass') {
      await writeTaskJudgeRepairControl(cwd, { ...repair, state: 'passed', judgeFingerprint: currentJudgeFingerprint, updatedAt: new Date().toISOString() })
      await settleTaskRun(cwd, files, 'completed')
      dispatchCompletionAttempts.delete(attemptKey)
      return
    }
    const reason = files.judge.reason ?? 'Judge 复判仍未通过，报告未提供可识别的具体理由。'
    const reasons = [...repair.reasons, reason].slice(-MAX_JUDGE_REPAIR_ROUNDS)
    if (repair.round >= repair.maxRounds) {
      await writeTaskJudgeRepairControl(cwd, { ...repair, state: 'exhausted', reasons, judgeFingerprint: currentJudgeFingerprint, updatedAt: new Date().toISOString() })
      await settleTaskRun(cwd, files, 'failed')
      dispatchCompletionAttempts.delete(attemptKey)
      return
    }
    const nextRepair: TaskJudgeRepairControl = {
      ...repair,
      state: 'repairing',
      round: repair.round + 1,
      reasons,
      artifactFingerprints: await artifactFingerprints(cwd, artifactPaths),
      judgeFingerprint: currentJudgeFingerprint,
      updatedAt: new Date().toISOString(),
    }
    await writeTaskJudgeRepairControl(cwd, nextRepair)
    instruction = `第 ${String(nextRepair.round)}/${String(nextRepair.maxRounds)} 轮返修开始。Judge 理由：${reason}。现在只让业务成员 ${businessMemberIds.join('、')} 基于冻结输入与该理由重写各自产物；不得修改 ${files.inputManifestPath} 或其 sources。完成后等待成员结算，不得提前调用 Judge。`
  } else if (instruction === '' && files.judge.state === 'fail') {
    const reason = files.judge.reason ?? 'Judge 首次判定未通过，报告未提供可识别的具体理由。'
    const firstRepair: TaskJudgeRepairControl = {
      taskKey: execution.taskKey,
      sessionId,
      state: 'repairing',
      round: 1,
      maxRounds: MAX_JUDGE_REPAIR_ROUNDS,
      reasons: [reason],
      artifactFingerprints: await artifactFingerprints(cwd, artifactPaths),
      judgeFingerprint: await pathFingerprint(cwd, files.judge.path),
      updatedAt: new Date().toISOString(),
    }
    await writeTaskJudgeRepairControl(cwd, firstRepair)
    instruction = `第 1/${String(firstRepair.maxRounds)} 轮返修开始。Judge 理由：${reason}。现在只让业务成员 ${businessMemberIds.join('、')} 基于冻结输入与该理由重写各自产物；不得修改 ${files.inputManifestPath} 或其 sources。完成后等待成员结算，不得提前调用 Judge。`
  } else if (instruction === '' && !dispatched.has('quality_judge')) {
    instruction = `业务产物已全部落盘。现在让 quality_judge 只从 ${files.manifestPath} 进入，独立检查登记产物并写入 ${files.judge.path}；报告最后一行必须逐字使用“最终判定：PASS”或“最终判定：FAIL”。`
  } else if (instruction === '' && (!files.judge.nonEmpty || files.judge.state === 'unverified')) {
    if (!files.judge.nonEmpty) {
      dispatchCompletionAttempts.delete(attemptKey)
      return
    }
    instruction = files.judge.nonEmpty
      ? `固定 Judge 报告 ${files.judge.path} 没有可识别的最终 verdict。现在调用 quality_judge 独立复核；报告最后一行必须逐字使用“最终判定：PASS”或“最终判定：FAIL”。`
      : `业务产物已落盘，但固定 Judge 报告 ${files.judge.path} 尚未产生。现在调用 quality_judge 独立检查 manifest 登记的产物并写入该文件。`
  } else if (instruction === '') {
    dispatchCompletionAttempts.delete(attemptKey)
    return
  }
  const attempts = (dispatchCompletionAttempts.get(attemptKey) ?? 0) + 1
  dispatchCompletionAttempts.set(attemptKey, attempts)
  if (attempts > 2) {
    throw new Error(`任务磁盘产物或固定 Judge 仍未齐备，拒绝结束本轮：${instruction}`)
  }
  agent.steer(createUserMessage({
    content: [{
      type: 'text',
      text: `运行时完整性闸门：${instruction}`,
    }],
    source: { kind: 'plugin', plugin: '@promax/promax-bundle' },
  }))
}

function jsonYaml(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function evidenceManifestYaml(manifest: EvidenceInputManifest): string {
  const count = manifest.inputs.src_files.length
  const comment = count === 0 ? '# 无用户上传文件\n' : `# 已冻结 ${String(count)} 个上传文件登记项（含办公文档转换件）\n`
  return `${comment}# 冻结路径使用 source_id 与 ASCII 扩展名；不合规扩展名使用 .bin，用户原名见 original_filename\n${YAML.stringify(manifest)}`
}

function taskRunControlValue(taskKey: string, sessionId: string, state: TaskRunCancellationState, runEpoch: number, updatedAt: string): Record<string, unknown> {
  return {
    api_version: 'promax.ai/v1alpha2',
    kind: 'TaskRunControl',
    metadata: { task_key: taskKey, session_id: sessionId, updated_at: updatedAt },
    spec: { state, run_epoch: runEpoch },
  }
}

function taskRunControlOf(value: unknown, taskKey: string, sessionId: string): { state: TaskRunCancellationState; runEpoch: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('任务运行控制文件无效')
  const row = value as Record<string, unknown>
  const metadata = typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : undefined
  const spec = typeof row.spec === 'object' && row.spec !== null && !Array.isArray(row.spec) ? row.spec as Record<string, unknown> : undefined
  if (row.kind !== 'TaskRunControl' || metadata?.task_key !== taskKey || metadata.session_id !== sessionId) throw new Error('任务运行控制文件与当前 task/session 不一致')
  const state = spec?.state
  const runEpoch = spec?.run_epoch
  if (!['running', 'stop_requested', 'draining', 'cancelled', 'completed', 'failed', 'failed_to_stop'].includes(String(state))) throw new Error('任务运行控制状态无效')
  if (typeof runEpoch !== 'number' || !Number.isSafeInteger(runEpoch) || runEpoch < 1) throw new Error('任务运行 epoch 无效')
  // Migrate historical failed_to_stop files into the truthful waiting state.
  // The next accepted transition rewrites the file without preserving the retired value.
  return { state: state === 'failed_to_stop' ? 'stop_requested' : state as TaskRunCancellationState, runEpoch }
}

async function writeTaskRunControl(path: string, taskKey: string, sessionId: string, state: TaskRunCancellationState, runEpoch: number, updatedAt: string): Promise<void> {
  const temporary = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`
  await writeFile(temporary, jsonYaml(taskRunControlValue(taskKey, sessionId, state, runEpoch, updatedAt)), { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, path)
}

function exactTaskArtifactPath(path: string, taskKey: string): boolean {
  return path.startsWith(`deliverables/${taskKey}/`) && !path.includes('..') && !path.includes('\\')
}

async function fileState(workspace: string, path: string): Promise<{ path: string; exists: boolean; nonEmpty: boolean }> {
  const absolute = resolve(workspace, path)
  if (absolute !== workspace && !absolute.startsWith(`${workspace}${sep}`)) throw new Error(`任务文件越出工作区：${path}`)
  try {
    const info = await lstat(absolute)
    if (info.isSymbolicLink()) throw new Error(`任务文件不得是符号链接：${path}`)
    return { path, exists: info.isFile(), nonEmpty: info.isFile() && info.size > 0 }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, exists: false, nonEmpty: false }
    throw error
  }
}

async function taskDeliverableFiles(workspace: string, taskKey: string): Promise<TaskDeliverableFile[]> {
  const deliverablePath = `deliverables/${taskKey}`
  const root = resolve(workspace, deliverablePath)
  if (root !== resolve(workspace, 'deliverables', taskKey)) throw new Error('任务产出目录无效')
  try {
    const rootInfo = await lstat(root)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error(`任务产出路径不是普通目录：${deliverablePath}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const files: TaskDeliverableFile[] = []
  const walk = async (directory: string, parents: string[]): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`任务产出目录不得包含符号链接：${[...parents, entry.name].join('/')}`)
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, [...parents, entry.name])
        continue
      }
      if (!entry.isFile()) throw new Error(`任务产出目录只允许普通文件：${[...parents, entry.name].join('/')}`)
      const info = await lstat(absolute)
      const relativePath = [...parents, entry.name].join('/')
      files.push({
        name: entry.name,
        relativePath,
        path: `${deliverablePath}/${relativePath}`,
        bytes: info.size,
        modifiedAt: info.mtime.toISOString(),
      })
    }
  }
  await walk(root, [])
  return files
}

export interface TaskRunArtifactRegistration {
  path: string
  memberId: string
}

function taskExecutionManifestOf(value: unknown, taskKey: string): TaskExecutionManifest {
  const row = objectRow(value, 'TaskPackage')
  exactKeys(row, ['api_version', 'kind', 'metadata', 'spec'], 'TaskPackage')
  const metadata = objectRow(row.metadata, 'TaskPackage.metadata')
  const spec = objectRow(row.spec, 'TaskPackage.spec')
  exactKeys(metadata, ['task_key', 'team_revision_id', 'confirmed_at'], 'TaskPackage.metadata')
  exactKeys(spec, ['input_manifest_path', 'members_confirmed', 'artifacts', 'judge'], 'TaskPackage.spec')
  const confirmedAt = typeof metadata.confirmed_at === 'string' && !Number.isNaN(Date.parse(metadata.confirmed_at)) ? metadata.confirmed_at : ''
  const teamRevisionId = typeof metadata.team_revision_id === 'string' ? metadata.team_revision_id : ''
  const membersConfirmed = dispatchMemberIds(spec.members_confirmed, 'TaskPackage 已确认成员名单')
  if (row.api_version !== 'promax.ai/v1alpha2' || row.kind !== 'TaskPackage' || metadata.task_key !== taskKey
    || teamRevisionId === '' || confirmedAt === '' || spec.input_manifest_path !== `.promax/input/${taskKey}/manifest.yml`
    || !membersConfirmed.includes('quality_judge') || !Array.isArray(spec.artifacts) || spec.artifacts.length === 0) {
    throw new Error('TaskPackage Schema 校验失败')
  }
  const artifacts = spec.artifacts.map((value, index) => {
    const artifact = objectRow(value, `TaskPackage.spec.artifacts[${String(index)}]`)
    exactKeys(artifact, ['artifact_kind', 'validation_kind', 'relative_path', 'produced_by', 'domain_rubric'], `TaskPackage.spec.artifacts[${String(index)}]`)
    const parsed: TaskManifestArtifact = {
      artifact_kind: typeof artifact.artifact_kind === 'string' ? artifact.artifact_kind : '',
      validation_kind: typeof artifact.validation_kind === 'string' ? artifact.validation_kind : '',
      relative_path: typeof artifact.relative_path === 'string' ? artifact.relative_path : '',
      produced_by: typeof artifact.produced_by === 'string' ? artifact.produced_by : '',
      ...(artifact.domain_rubric === undefined ? {} : { domain_rubric: artifact.domain_rubric }),
    }
    if (parsed.artifact_kind === '' || parsed.validation_kind === '' || !exactTaskArtifactPath(parsed.relative_path, taskKey)
      || parsed.produced_by === 'quality_judge' || !membersConfirmed.includes(parsed.produced_by)) {
      throw new Error(`TaskPackage 业务产物 ${String(index + 1)} 无效`)
    }
    return parsed
  })
  if (new Set(artifacts.map(artifact => artifact.relative_path)).size !== artifacts.length) throw new Error('TaskPackage 业务产物路径不得重复')
  const judge = objectRow(spec.judge, 'TaskPackage.spec.judge')
  exactKeys(judge, ['relative_path', 'produced_by'], 'TaskPackage.spec.judge')
  const expectedJudgePath = `.promax/judge/${taskKey}/judge.md`
  if (judge.relative_path !== expectedJudgePath || judge.produced_by !== 'quality_judge') throw new Error('TaskPackage Judge 登记无效')
  return {
    api_version: 'promax.ai/v1alpha2',
    kind: 'TaskPackage',
    metadata: { task_key: taskKey, team_revision_id: teamRevisionId, confirmed_at: confirmedAt },
    spec: {
      input_manifest_path: `.promax/input/${taskKey}/manifest.yml`,
      members_confirmed: membersConfirmed,
      artifacts,
      judge: { relative_path: expectedJudgePath, produced_by: 'quality_judge' },
    },
  }
}

function taskExecutionManifestFromTeamRevision(value: unknown, contract: TaskManifestContract, taskKey: string): TaskExecutionManifest {
  const row = objectRow(value, 'TeamRevision')
  const metadata = objectRow(row.metadata, 'TeamRevision.metadata')
  const spec = objectRow(row.spec, 'TeamRevision.spec')
  const teamRevisionId = typeof metadata.team_revision_id === 'string' ? metadata.team_revision_id : ''
  if (row.api_version !== 'promax.ai/v1alpha2' || row.kind !== 'TeamRevision' || metadata.status !== 'published'
    || teamRevisionId === '' || !Array.isArray(spec.artifacts)) throw new Error('已发布 TeamRevision 无效')
  const declarations = spec.artifacts.map((value, index) => {
    const artifact = objectRow(value, `TeamRevision.spec.artifacts[${String(index)}]`)
    const relativePath = typeof artifact.relative_path === 'string' ? artifact.relative_path.replaceAll('{task_key}', taskKey) : ''
    return {
      artifact_kind: typeof artifact.kind === 'string' ? artifact.kind : '',
      validation_kind: typeof artifact.validation_kind === 'string' ? artifact.validation_kind : '',
      relative_path: relativePath,
      produced_by: typeof artifact.produced_by === 'string' ? artifact.produced_by : '',
    }
  })
  const rubricCatalog = spec.domain_rubrics === undefined ? {} : objectRow(spec.domain_rubrics, 'TeamRevision.spec.domain_rubrics')
  const artifacts = contract.deliverables.map((registered, index) => {
    const declaration = declarations.find(candidate => candidate.relative_path === registered.relative_path && candidate.produced_by === registered.produced_by)
    if (declaration === undefined || declaration.artifact_kind === '' || declaration.validation_kind === '') {
      throw new Error(`已确认产物 ${String(index + 1)} 不属于已发布 TeamRevision`)
    }
    const rubric = rubricCatalog[declaration.validation_kind]
    return { ...declaration, ...(rubric === undefined ? {} : { domain_rubric: rubric }) }
  })
  const judgeDeclaration = declarations.find(candidate => candidate.relative_path === contract.judge.relative_path && candidate.produced_by === 'quality_judge')
  if (judgeDeclaration?.artifact_kind !== 'judge-report' || judgeDeclaration.validation_kind === '') throw new Error('已发布 TeamRevision 缺少固定 Judge 产物')
  return taskExecutionManifestOf({
    api_version: 'promax.ai/v1alpha2',
    kind: 'TaskPackage',
    metadata: { task_key: taskKey, team_revision_id: teamRevisionId, confirmed_at: contract.confirmed_at },
    spec: {
      input_manifest_path: `.promax/input/${taskKey}/manifest.yml`,
      members_confirmed: contract.members_confirmed,
      artifacts,
      judge: contract.judge,
    },
  }, taskKey)
}

async function writeImmutableTaskManifest(path: string, manifest: TaskExecutionManifest): Promise<void> {
  const content = YAML.stringify(manifest)
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = taskExecutionManifestOf(YAML.parse(await readFile(path, 'utf8')) as unknown, manifest.metadata.task_key)
    if (JSON.stringify(existing) !== JSON.stringify(manifest)) throw new Error('TaskPackage 已冻结且与当前执行契约不一致')
  }
}

/** Seals the confirmed output contract beside the immutable input manifest before execution starts. */
export async function sealTaskRunManifest(workspacePath: string, input: {
  sessionId: string
  taskKey: string
  confirmedAt: string
  confirmedMemberIds: string[]
  artifacts: TaskRunArtifactRegistration[]
  teamRevision: unknown
}): Promise<{ manifestPath: string; artifactPaths: string[]; judgePath: string; runEpoch: number }> {
  const workspace = resolve(workspacePath)
  const sessionId = sessionIdOf(input.sessionId)
  const taskKey = taskKeyOf(input.taskKey)
  const confirmedMemberIds = dispatchMemberIds(input.confirmedMemberIds, 'manifest 已确认成员名单')
  if (!confirmedMemberIds.includes('quality_judge')) throw new Error('manifest 已确认成员必须包含固定 Judge')
  if (Number.isNaN(Date.parse(input.confirmedAt))) throw new Error('manifest 确认时间无效')
  if (!Array.isArray(input.artifacts) || input.artifacts.length < 2) throw new Error('manifest 至少需要一个业务产物和固定 Judge')
  const expectedJudgePath = `.promax/judge/${taskKey}/judge.md`
  const judgeRows = input.artifacts.filter(artifact => artifact.memberId === 'quality_judge' || artifact.path === expectedJudgePath)
  if (judgeRows.length !== 1 || judgeRows[0]?.memberId !== 'quality_judge' || judgeRows[0].path !== expectedJudgePath) {
    throw new Error('manifest 必须且只能登记一个固定 Judge 产物')
  }
  const deliverables = input.artifacts.filter(artifact => artifact.memberId !== 'quality_judge').map((artifact, index) => {
    if (!confirmedMemberIds.includes(artifact.memberId) || !exactTaskArtifactPath(artifact.path, taskKey)) {
      throw new Error(`manifest 业务产物 ${String(index + 1)} 不属于已确认任务`)
    }
    return { artifact_kind: '', validation_kind: '', relative_path: artifact.path, produced_by: artifact.memberId }
  })
  if (deliverables.length === 0 || new Set(deliverables.map(deliverable => deliverable.relative_path)).size !== deliverables.length) {
    throw new Error('manifest 业务产物为空或路径重复')
  }
  const scope = JSON.parse(await readFile(join(workspace, '.promax', 'session-scopes', `${sessionId}.json`), 'utf8')) as Record<string, unknown>
  if (scope.sessionName !== taskKey || scope.taskKey !== taskKey) throw new Error('当前父 session 与 task_key 不一致')
  const manifestPath = join(workspace, '.promax', 'input', taskKey, 'manifest.yml')
  const current = evidenceManifestOf(YAML.parse(await readFile(manifestPath, 'utf8')) as unknown, taskKey)
  await validateEvidenceManifestFiles(workspace, current)
  const contract: TaskManifestContract = {
    confirmed_at: input.confirmedAt,
    members_confirmed: confirmedMemberIds,
    deliverables,
    judge: { relative_path: expectedJudgePath, produced_by: 'quality_judge' },
  }
  const taskRoot = join(workspace, '.promax', 'tasks', taskKey)
  await mkdir(taskRoot, { recursive: true })
  const taskManifest = taskExecutionManifestFromTeamRevision(input.teamRevision, contract, taskKey)
  const taskManifestPath = join(taskRoot, 'task-package.yml')
  await writeImmutableTaskManifest(taskManifestPath, taskManifest)
  const runControlPath = join(taskRoot, 'run-control.yml')
  try {
    const existing = JSON.parse(await readFile(runControlPath, 'utf8')) as unknown
    taskRunControlOf(existing, taskKey, sessionId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(runControlPath, jsonYaml(taskRunControlValue(taskKey, sessionId, 'running', 1, input.confirmedAt)), { encoding: 'utf8', flag: 'wx' })
  }
  return {
    manifestPath: `.promax/tasks/${taskKey}/task-package.yml`,
    artifactPaths: deliverables.map(deliverable => deliverable.relative_path),
    judgePath: expectedJudgePath,
    runEpoch: 1,
  }
}

function judgeStateOf(report: string): TaskRunJudgeState {
  const manual = /\|\s*人工处理\s*\|([^\n|]+)/iu.exec(report)?.[1]?.trim() ?? ''
  if (/人工强制放行|force[-_ ]?release/iu.test(manual)) return 'force_released'
  if (/APPEALED|已?申诉|申诉中/iu.test(manual)) return 'appealed'
  if (/HUMAN_REQUIRED|等待人工|需要人工|需人工|人工复核|交由人工/iu.test(manual)) return 'human_required'
  const verdicts = [...report.matchAll(/(?:判定结论|(?:(?:整体|最终)\s*verdict)|overall[_ -]+verdict|(?:最终|复核)\s*判定)\s*(?:[：:=]|\|)\s*\**\s*(PASS(?:ED)?|FAIL(?:ED)?|APPEALED|HUMAN_REQUIRED)\b/giu)]
  const verdict = verdicts.at(-1)?.[1]?.toUpperCase()
  if (verdict === 'PASS' || verdict === 'PASSED') return 'pass'
  if (verdict === 'FAIL' || verdict === 'FAILED') return 'fail'
  if (verdict === 'APPEALED') return 'appealed'
  if (verdict === 'HUMAN_REQUIRED') return 'human_required'
  return 'unverified'
}

function cleanJudgeReason(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s+|>\s*)/u, '')
    .replace(/\*\*/gu, '')
    .replace(/`/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function judgeReasonOf(report: string, state: TaskRunJudgeState): string | undefined {
  if (!['fail', 'appealed', 'human_required', 'unverified'].includes(state)) return undefined
  const explicit = /(?:失败原因|不通过原因|阻断原因|主要缺陷|修复方向)\s*[：:]\s*([^\n]+)/iu.exec(report)?.[1]
  if (explicit !== undefined && cleanJudgeReason(explicit) !== '') return cleanJudgeReason(explicit)

  const lines = report.split(/\r?\n/u)
  const failingHeading = lines.findIndex(line => /^#{2,6}\s+.*(?:—|-|：|:)\s*\**fail(?:ed)?\**\s*$/iu.test(line.trim()))
  if (failingHeading >= 0) {
    const detail = lines.slice(failingHeading + 1).find(line => {
      const value = line.trim()
      return value !== '' && !value.startsWith('#') && !value.startsWith('|') && !/^[-*_]{3,}$/u.test(value) && !/诊断分/u.test(value)
    })
    if (detail !== undefined && cleanJudgeReason(detail) !== '') return cleanJudgeReason(detail)
  }

  const failingRow = lines.find(line => /^\|.*\|\s*\**fail(?:ed)?\**\s*\|/iu.test(line.trim()))
  if (failingRow !== undefined) {
    const cells = failingRow.split('|').map(cleanJudgeReason).filter(Boolean)
    const verdictIndex = cells.findIndex(cell => /^fail(?:ed)?$/iu.test(cell))
    const detail = verdictIndex >= 0 ? cells[verdictIndex + 1] : undefined
    if (detail !== undefined && detail !== '') return detail
  }

  if (state === 'appealed') return 'Judge 判定已申诉，正在等待后续处理。'
  if (state === 'human_required') return 'Judge 要求人工复核后才能放行。'
  if (state === 'unverified') return 'Judge 报告没有可识别的最终通过结论。'
  return 'Judge 最终判定不通过；请按报告中的有效缺陷修复。'
}

const MAX_JUDGE_REPAIR_ROUNDS = 2

interface TaskJudgeRepairControl extends TaskJudgeRepairSnapshot {
  taskKey: string
  sessionId: string
  artifactFingerprints: Record<string, string>
  judgeFingerprint: string
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}无效`)
  const entries = Object.entries(value)
  if (entries.some(([key, item]) => key === '' || typeof item !== 'string' || item === '')) throw new Error(`${label}无效`)
  return Object.fromEntries(entries) as Record<string, string>
}

function taskJudgeRepairControlOf(value: unknown, taskKey: string, sessionId: string): TaskJudgeRepairControl {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Judge 返修控制文件无效')
  const row = value as Record<string, unknown>
  const metadata = typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : undefined
  const spec = typeof row.spec === 'object' && row.spec !== null && !Array.isArray(row.spec) ? row.spec as Record<string, unknown> : undefined
  if (row.kind !== 'TaskJudgeRepairControl' || metadata?.task_key !== taskKey || metadata.session_id !== sessionId) throw new Error('Judge 返修控制文件与当前 task/session 不一致')
  const state = spec?.state
  const round = spec?.round
  const maxRounds = spec?.max_rounds
  const updatedAt = metadata.updated_at
  const reasons = spec?.reasons
  if (!['repairing', 'judging', 'passed', 'exhausted'].includes(String(state))) throw new Error('Judge 返修状态无效')
  if (!Number.isSafeInteger(round) || !Number.isSafeInteger(maxRounds) || Number(round) < 1 || Number(round) > Number(maxRounds) || maxRounds !== MAX_JUDGE_REPAIR_ROUNDS) throw new Error('Judge 返修轮次无效')
  if (!Array.isArray(reasons) || reasons.length < 1 || reasons.length > MAX_JUDGE_REPAIR_ROUNDS || reasons.some(reason => typeof reason !== 'string' || reason.trim() === '')) throw new Error('Judge 返修原因无效')
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt)) || !updatedAt.endsWith('Z')) throw new Error('Judge 返修时间无效')
  const artifactFingerprints = stringRecord(spec?.artifact_fingerprints, 'Judge 返修产物指纹')
  const judgeFingerprint = typeof spec?.judge_fingerprint === 'string' && spec.judge_fingerprint !== '' ? spec.judge_fingerprint : undefined
  if (judgeFingerprint === undefined) throw new Error('Judge 返修报告指纹无效')
  return {
    taskKey,
    sessionId,
    state: state as TaskJudgeRepairState,
    round: Number(round),
    maxRounds: Number(maxRounds),
    reasons: reasons.map(String),
    updatedAt,
    artifactFingerprints,
    judgeFingerprint,
  }
}

function taskJudgeRepairValue(control: TaskJudgeRepairControl): Record<string, unknown> {
  return {
    api_version: 'promax.ai/v1alpha2',
    kind: 'TaskJudgeRepairControl',
    metadata: { task_key: control.taskKey, session_id: control.sessionId, updated_at: control.updatedAt },
    spec: {
      state: control.state,
      round: control.round,
      max_rounds: control.maxRounds,
      reasons: control.reasons,
      artifact_fingerprints: control.artifactFingerprints,
      judge_fingerprint: control.judgeFingerprint,
    },
  }
}

async function optionalTaskJudgeRepairControl(workspace: string, taskKey: string, sessionId: string): Promise<TaskJudgeRepairControl | undefined> {
  try {
    return taskJudgeRepairControlOf(JSON.parse(await readFile(join(workspace, '.promax', 'tasks', taskKey, 'judge-repair.yml'), 'utf8')) as unknown, taskKey, sessionId)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function writeTaskJudgeRepairControl(workspace: string, control: TaskJudgeRepairControl): Promise<void> {
  const path = join(workspace, '.promax', 'tasks', control.taskKey, 'judge-repair.yml')
  const temporary = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`
  await writeFile(temporary, jsonYaml(taskJudgeRepairValue(control)), { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, path)
}

async function pathFingerprint(workspace: string, relativePath: string): Promise<string> {
  const absolute = resolve(workspace, relativePath)
  if (absolute !== workspace && !absolute.startsWith(`${workspace}${sep}`)) throw new Error(`Judge 返修文件越出工作区：${relativePath}`)
  try {
    const info = await lstat(absolute)
    if (!info.isFile() || info.isSymbolicLink()) return 'missing'
    const content = await readFile(absolute)
    return `${String(info.mtimeMs)}:${String(info.size)}:${createHash('sha256').update(content).digest('hex')}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

async function artifactFingerprints(workspace: string, paths: readonly string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, await pathFingerprint(workspace, path)])))
}

function repairSnapshotOf(control: TaskJudgeRepairControl): TaskJudgeRepairSnapshot {
  return { state: control.state, round: control.round, maxRounds: control.maxRounds, reasons: [...control.reasons], updatedAt: control.updatedAt }
}

async function taskWorkspace(workspacePath: string, sessionId: string, taskKey: string): Promise<string> {
  const workspace = resolve(workspacePath)
  const scope = JSON.parse(await readFile(join(workspace, '.promax', 'session-scopes', `${sessionId}.json`), 'utf8')) as Record<string, unknown>
  if (scope.sessionName !== taskKey || scope.taskKey !== taskKey) throw new Error('当前父 session 与 task_key 不一致')
  return workspace
}

/** Reads the exact artifact list from the sealed task manifest, then observes only those disk paths. */
export async function readTaskRunFiles(workspacePath: string, input: { sessionId: string; taskKey: string }): Promise<TaskRunFileSnapshot> {
  const sessionId = sessionIdOf(input.sessionId)
  const taskKey = taskKeyOf(input.taskKey)
  const workspace = await taskWorkspace(workspacePath, sessionId, taskKey)
  const inputManifestPath = `.promax/input/${taskKey}/manifest.yml`
  const inputManifest = evidenceManifestOf(YAML.parse(await readFile(resolve(workspace, inputManifestPath), 'utf8')) as unknown, taskKey)
  await validateEvidenceManifestFiles(workspace, inputManifest)
  const manifestPath = `.promax/tasks/${taskKey}/task-package.yml`
  const manifest = taskExecutionManifestOf(YAML.parse(await readFile(resolve(workspace, manifestPath), 'utf8')) as unknown, taskKey)
  const controlPath = join(workspace, '.promax', 'tasks', taskKey, 'run-control.yml')
  const control = taskRunControlOf(JSON.parse(await readFile(controlPath, 'utf8')) as unknown, taskKey, sessionId)
  const artifactStates = await Promise.all(manifest.spec.artifacts.map(async deliverable => ({
    ...await fileState(workspace, deliverable.relative_path),
    memberId: deliverable.produced_by,
  })))
  const judgePath = manifest.spec.judge.relative_path
  const judgeFile = await fileState(workspace, judgePath)
  const judgeReport = judgeFile.nonEmpty ? await readFile(resolve(workspace, judgePath), 'utf8') : ''
  const state = judgeFile.nonEmpty ? judgeStateOf(judgeReport) : 'absent'
  const repair = await optionalTaskJudgeRepairControl(workspace, taskKey, sessionId)
  const judgeReason = judgeReasonOf(judgeReport, state)
  const reason = repair?.state === 'exhausted'
    ? `多次返修后仍未通过（${String(repair.round)}/${String(repair.maxRounds)}）：${repair.reasons.join('；')}`
    : judgeReason
  const deliverablePath = `deliverables/${taskKey}`
  const deliverableFiles = await taskDeliverableFiles(workspace, taskKey)
  return {
    taskKey,
    parentSessionId: sessionId,
    createdAt: inputManifest.metadata.frozen_at,
    cancellation: control.state,
    runEpoch: control.runEpoch,
    manifestPath,
    inputManifestPath,
    confirmedMemberIds: manifest.spec.members_confirmed,
    artifactStates,
    deliverablePath,
    deliverableFiles,
    judge: { path: judgePath, memberId: 'quality_judge', state, exists: judgeFile.exists, nonEmpty: judgeFile.nonEmpty, ...(reason === undefined ? {} : { reason }) },
    ...(repair === undefined ? {} : { repair: repairSnapshotOf(repair) }),
    observedAt: new Date().toISOString(),
  }
}

function historyStatusOf(snapshot: TaskRunFileSnapshot): TaskHistoryStatus {
  if (snapshot.cancellation === 'completed') return 'completed'
  if (snapshot.cancellation === 'failed') return 'failed'
  if (snapshot.cancellation === 'cancelled') return 'failed'
  if (snapshot.repair?.state === 'repairing' || snapshot.repair?.state === 'judging') return 'running'
  if (snapshot.repair?.state === 'exhausted') return 'failed'
  if (snapshot.judge.state === 'pass' || snapshot.judge.state === 'force_released') return 'completed'
  if (['fail', 'appealed', 'human_required', 'unverified'].includes(snapshot.judge.state)) return 'failed'
  return 'running'
}

async function incompleteHistoryItem(workspace: string, sessionId: string, taskKey: string, scopeModifiedAt: string, error: unknown): Promise<TaskHistoryItem> {
  const deliverablePath = `deliverables/${taskKey}`
  const deliverableFiles = await taskDeliverableFiles(workspace, taskKey)
  const inputManifestPath = `.promax/input/${taskKey}/manifest.yml`
  let createdAt = scopeModifiedAt
  let invalidInput = false
  try {
    const inputManifest = evidenceManifestOf(YAML.parse(await readFile(resolve(workspace, inputManifestPath), 'utf8')) as unknown, taskKey)
    await validateEvidenceManifestFiles(workspace, inputManifest)
    createdAt = inputManifest.metadata.frozen_at
  } catch (reason) {
    invalidInput = (reason as NodeJS.ErrnoException).code !== 'ENOENT'
  }
  const judgePath = `.promax/judge/${taskKey}/judge.md`
  const judgeFile = await fileState(workspace, judgePath)
  const judgeReport = judgeFile.nonEmpty ? await readFile(resolve(workspace, judgePath), 'utf8') : ''
  const judgeState = judgeFile.nonEmpty ? judgeStateOf(judgeReport) : 'absent'
  const reason = judgeReasonOf(judgeReport, judgeState)
  const message = error instanceof Error ? error.message : String(error)
  const terminalJudge = ['fail', 'appealed', 'human_required', 'unverified'].includes(judgeState)
  const invalidExecution = (error as NodeJS.ErrnoException).code !== 'ENOENT'
  return {
    sessionId,
    taskKey,
    createdAt,
    status: invalidInput || invalidExecution || terminalJudge ? 'failed' : 'running',
    fileCount: deliverableFiles.length,
    deliverablePath,
    deliverableFiles,
    judge: { path: judgePath, memberId: 'quality_judge', state: judgeState, exists: judgeFile.exists, nonEmpty: judgeFile.nonEmpty, ...(reason === undefined ? {} : { reason }) },
    observedAt: new Date().toISOString(),
    ...(invalidInput || invalidExecution ? { error: message } : {}),
  }
}

/** Lists task assets from session-scope files and current disk contents; no browser state participates. */
export async function readTaskHistory(workspacePath: string): Promise<TaskHistoryItem[]> {
  const workspace = resolve(workspacePath)
  const scopeRoot = join(workspace, '.promax', 'session-scopes')
  let entries: Dirent[]
  try {
    entries = await readdir(scopeRoot, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const items: TaskHistoryItem[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue
    const sessionId = sessionIdOf(entry.name.slice(0, -'.json'.length))
    const scopePath = join(scopeRoot, entry.name)
    const scopeInfo = await lstat(scopePath)
    const scope = JSON.parse(await readFile(scopePath, 'utf8')) as Record<string, unknown>
    const taskKey = taskKeyOf(scope.taskKey)
    if (scope.sessionId !== sessionId || scope.sessionName !== taskKey) throw new Error(`任务范围文件与文件名不一致：${entry.name}`)
    try {
      const snapshot = await readTaskRunFiles(workspace, { sessionId, taskKey })
      items.push({
        sessionId,
        taskKey,
        createdAt: snapshot.createdAt,
        status: historyStatusOf(snapshot),
        fileCount: snapshot.deliverableFiles.length,
        deliverablePath: snapshot.deliverablePath,
        deliverableFiles: snapshot.deliverableFiles,
        judge: snapshot.judge,
        observedAt: snapshot.observedAt,
      })
    } catch (error) {
      items.push(await incompleteHistoryItem(workspace, sessionId, taskKey, scopeInfo.mtime.toISOString(), error))
    }
  }
  return items.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

/** Resolves only the current task's real delivery directory for the native file-manager action. */
export async function resolveTaskDeliverableDirectory(workspacePath: string, input: { sessionId: string; taskKey: string }): Promise<string> {
  const sessionId = sessionIdOf(input.sessionId)
  const taskKey = taskKeyOf(input.taskKey)
  const workspace = await taskWorkspace(workspacePath, sessionId, taskKey)
  const directory = resolve(workspace, 'deliverables', taskKey)
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('任务产出路径不是普通目录')
  return directory
}

const TASK_RUN_TRANSITIONS: Record<TaskRunCancellationState, readonly TaskRunCancellationState[]> = {
  running: ['running', 'stop_requested', 'completed', 'failed'],
  stop_requested: ['stop_requested', 'draining'],
  draining: ['draining', 'cancelled'],
  cancelled: ['cancelled'],
  completed: ['completed'],
  failed: ['failed'],
}

async function settleTaskRun(workspacePath: string, snapshot: TaskRunFileSnapshot, state: 'completed' | 'failed'): Promise<void> {
  const workspace = await taskWorkspace(workspacePath, snapshot.parentSessionId, snapshot.taskKey)
  const path = join(workspace, '.promax', 'tasks', snapshot.taskKey, 'run-control.yml')
  const current = taskRunControlOf(JSON.parse(await readFile(path, 'utf8')) as unknown, snapshot.taskKey, snapshot.parentSessionId)
  if (current.runEpoch !== snapshot.runEpoch) throw new Error('任务运行 epoch 已变化，拒绝结算旧 run')
  if (current.state === state) return
  if (current.state !== 'running') throw new Error(`任务运行控制不允许 ${current.state} → ${state}`)
  await writeTaskRunControl(path, snapshot.taskKey, snapshot.parentSessionId, state, snapshot.runEpoch, new Date().toISOString())
}

/** Persists one idempotent cancellation transition before/after runtime work. */
export async function controlTaskRunFiles(workspacePath: string, input: { sessionId: string; taskKey: string; state: TaskRunCancellationState; runEpoch: number; updatedAt: string }): Promise<{ state: TaskRunCancellationState; runEpoch: number; updatedAt: string; changed: boolean }> {
  const sessionId = sessionIdOf(input.sessionId)
  const taskKey = taskKeyOf(input.taskKey)
  if (!['running', 'stop_requested', 'draining', 'cancelled'].includes(input.state)) throw new Error('任务运行控制状态无效')
  if (!Number.isSafeInteger(input.runEpoch) || input.runEpoch < 1) throw new Error('任务运行 epoch 无效')
  if (Number.isNaN(Date.parse(input.updatedAt)) || !input.updatedAt.endsWith('Z')) throw new Error('任务运行控制时间无效')
  const workspace = await taskWorkspace(workspacePath, sessionId, taskKey)
  const path = join(workspace, '.promax', 'tasks', taskKey, 'run-control.yml')
  const current = taskRunControlOf(JSON.parse(await readFile(path, 'utf8')) as unknown, taskKey, sessionId)
  if (current.runEpoch !== input.runEpoch) throw new Error('任务运行 epoch 已变化，拒绝用旧停止请求修改新 run')
  if ((input.state === 'stop_requested' || input.state === 'draining') && (current.state === 'draining' || current.state === 'cancelled')) {
    return { state: current.state, runEpoch: current.runEpoch, updatedAt: input.updatedAt, changed: false }
  }
  if (!TASK_RUN_TRANSITIONS[current.state].includes(input.state)) throw new Error(`任务运行控制不允许 ${current.state} → ${input.state}`)
  if (current.state === input.state) return { state: current.state, runEpoch: current.runEpoch, updatedAt: input.updatedAt, changed: false }
  await writeTaskRunControl(path, taskKey, sessionId, input.state, input.runEpoch, input.updatedAt)
  return { state: input.state, runEpoch: input.runEpoch, updatedAt: input.updatedAt, changed: true }
}

function requestPath(request: IncomingMessage): string {
  return (request.url ?? '').split('?')[0]?.replace(/\/+$/u, '') ?? ''
}

function taskRunArtifactRegistrations(value: unknown): TaskRunArtifactRegistration[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'object' || item === null || Array.isArray(item))) {
    throw new Error('任务产物登记格式无效')
  }
  return value.map(item => {
    const row = item as Record<string, unknown>
    const path = typeof row.path === 'string' ? row.path : ''
    const memberId = typeof row.memberId === 'string' ? row.memberId : ''
    if (path === '' || !/^[a-z][a-z0-9_]{2,47}$/u.test(memberId)) throw new Error('任务产物登记格式无效')
    return { path, memberId }
  })
}

export async function apply(ctx: HostContext, config: Config): Promise<void> {
  installFeishuMcpRuntime(ctx)
  installCustomMcpRuntime(ctx)
  const proxy = createApiProxy(config.apiBaseUrl)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PROXY_PREFIX,
    handler: proxy,
  }), 'promax-api-proxy')
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'html',
      placement: 'head',
      html: '<meta name="promax-api-base-url" content="/promax-api">',
    })
  })

  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const dispatchPlanRoot = join(dshHome, '.promax', 'dispatch-plans')
  ctx.on('tools/pre-execute', (exec, next) => enforceDispatchPlanTool(dispatchPlanRoot, exec, next))
  ctx.on('agent/turn-stopping', payload => enforceConfirmedDispatchCompleteness(dispatchPlanRoot, payload))
  const generalWorkspacePath = resolve(process.env.PROMAX_GENERAL_WORKSPACE?.trim() || join(dshHome, 'workspaces', 'general'))
  const projectRoot = resolve(process.env.PROMAX_PROJECT_ROOT?.trim() || join(homedir(), 'Promax'))
  const compatibilityProductPath = resolve(process.env.PROMAX_PRODUCT_WORKSPACE?.trim() || join(projectRoot, '产品'))
  const knownWorkspaces = new Map<string, WorkspaceRecord>()

  await mkdir(generalWorkspacePath, { recursive: true })
  const general = await ctx.workspaceRegistry.create(generalWorkspacePath, '通用')
  knownWorkspaces.set(general.id, general)
  await scaffoldProject(compatibilityProductPath)
  const product = await ctx.workspaceRegistry.create(compatibilityProductPath, '产品')
  knownWorkspaces.set(product.id, product)

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: WORKSPACE_API_PREFIX,
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          writeJson(response, 405, { error: '只接受 POST 请求' })
          return
        }
        const path = requestPath(request)
        const input = path.endsWith('/attachments')
          ? await readJson(request, MAX_ATTACHMENT_REQUEST_BYTES, '附件总大小不能超过 20 MiB')
          : await readJson(request)

        if (path.endsWith('/dispatch-plan/begin')) {
          const result = await beginDispatchPlan(dispatchPlanRoot, {
            sessionId: String(input.sessionId ?? ''),
            taskKey: String(input.taskKey ?? ''),
            rosterMemberIds: dispatchMemberIds(input.rosterMemberIds, '调度计划团队名单'),
          })
          writeJson(response, 200, result)
          return
        }

        if (path.endsWith('/dispatch-plan/confirm')) {
          const result = await confirmDispatchPlan(dispatchPlanRoot, {
            sessionId: String(input.sessionId ?? ''),
            planId: String(input.planId ?? ''),
            confirmedMemberIds: dispatchMemberIds(input.confirmedMemberIds, '已确认成员名单'),
          })
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const sealed = await sealTaskRunManifest(workspacePath, {
            sessionId: String(input.sessionId ?? ''),
            taskKey: result.taskKey,
            confirmedAt: result.confirmedAt,
            confirmedMemberIds: result.confirmedMemberIds,
            artifacts: taskRunArtifactRegistrations(input.artifacts),
            teamRevision: YAML.parse(await readFile(join(dshHome, '.agent-presets', 'promax-team', 'team-revision.yml'), 'utf8')) as unknown,
          })
          ctx.emit('promax/decision', {
            sessionId: String(input.sessionId ?? ''),
            target: 'dispatch.confirm',
            decision: { task_key: result.taskKey, plan_id: result.planId, member_ids: result.confirmedMemberIds },
          })
          writeJson(response, 200, { ...result, ...sealed })
          return
        }

        if (path.endsWith('/attachments/freeze')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标工作目录无效')
          const sessionId = String(input.sessionId ?? '')
          const paths = Array.isArray(input.paths) && input.paths.every(item => typeof item === 'string') ? input.paths : []
          const prepared = await prepareTaskSubmission({
            workspacePath,
            sessionId,
            demand: String(input.demand ?? ''),
            attachmentPaths: paths,
            frozenAt: new Date().toISOString(),
          })
          writeJson(response, 200, prepared)
          return
        }

        if (path.endsWith('/attachments')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标工作目录无效')
          const sessionId = String(input.sessionId ?? '')
          const paths = await saveTaskAttachments(workspacePath, sessionId, input.files)
          writeJson(response, 200, { paths })
          return
        }

        if (path.endsWith('/project')) {
          const customParent = typeof input.parentPath === 'string' && input.parentPath.trim() !== ''
            ? resolve(input.parentPath.trim())
            : projectRoot
          const workspace = await ensureProjectWorkspace(ctx.workspaceRegistry, customParent, String(input.projectName ?? ''))
          knownWorkspaces.set(workspace.id, workspace)
          writeJson(response, 200, {
            workspaceId: workspace.id,
            path: workspace.path,
            title: workspace.title,
            sessionIds: [...workspace.sessionIds],
          })
          return
        }

        if (path.endsWith('/task-history/read')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const items = await readTaskHistory(workspacePath)
          writeJson(response, 200, { items, observedAt: new Date().toISOString() })
          return
        }

        if (path.endsWith('/task-folder/resolve')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const folderPath = await resolveTaskDeliverableDirectory(workspacePath, {
            sessionId: String(input.sessionId ?? ''),
            taskKey: String(input.taskKey ?? ''),
          })
          writeJson(response, 200, { path: folderPath })
          return
        }

        if (path.endsWith('/task-run/read')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const snapshot = await readTaskRunFiles(workspacePath, {
            sessionId: String(input.sessionId ?? ''),
            taskKey: String(input.taskKey ?? ''),
          })
          writeJson(response, 200, { ...snapshot })
          return
        }

        if (path.endsWith('/task-run/control')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const result = await controlTaskRunFiles(workspacePath, {
            sessionId: String(input.sessionId ?? ''),
            taskKey: String(input.taskKey ?? ''),
            state: String(input.state ?? '') as TaskRunCancellationState,
            runEpoch: Number(input.runEpoch),
            updatedAt: String(input.updatedAt ?? ''),
          })
          if (result.changed && result.state === 'cancelled') ctx.emit('promax/decision', {
            sessionId: String(input.sessionId ?? ''),
            target: 'task.abandon',
            decision: { task_key: String(input.taskKey ?? ''), reason: 'user-stop' },
          })
          writeJson(response, 200, result)
          return
        }

        if (path.endsWith('/session-scope')) {
          const workspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : ''
          const registered = ctx.workspaceRegistry.get?.(workspaceId) ?? knownWorkspaces.get(workspaceId)
          const claimedPath = typeof input.projectPath === 'string' ? resolve(input.projectPath) : undefined
          const workspacePath = registered?.path ?? claimedPath
          if (workspaceId === '' || workspacePath === undefined || basename(workspacePath) === '') throw new Error('目标项目组无效')
          const scope = await ensureSessionOutputDirectory(workspacePath, String(input.sessionId ?? ''), String(input.sessionName ?? ''))
          writeJson(response, 200, scope)
          return
        }

        writeJson(response, 404, { error: '未知的 Promax 工作区操作' })
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const attachmentMessage = /^(?:请求体|附件|图片|不支持文件|文档|PDF|冻结输入|当前会话的冻结输入)/u.test(message)
          ? message
          : '附件处理失败，请确认文件可读取且工作目录可写后重试'
        const path = requestPath(request)
        writeJson(response, 400, { error: (path.endsWith('/attachments') || path.endsWith('/attachments/freeze')) ? attachmentMessage : message || '请求处理失败' })
      }
    },
  }), 'promax-project-workspace-api')
}
