import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

export const FEISHU_MCP_SETTINGS_NS = 'promax-feishu-mcp'
export const FEISHU_TELEMETRY_SETTINGS_NS = 'promax-feishu-telemetry'
export const CONNECTIONS_SETTINGS_NS = 'promax-connections'
export const FEISHU_MCP_PACKAGE = '@larksuiteoapi/lark-mcp'
export const FEISHU_MCP_TRANSPORT = 'stdio'
export const FEISHU_MCP_SERVER_NAME = 'feishu'
export const FEISHU_CREDENTIAL_REFS = ['APP_ID', 'APP_SECRET'] as const

type RpcError = { code?: string; message: string; details?: unknown }
type RpcResponse<T> = Promise<{ result: { ok: true; value: T } | { ok: false; error: RpcError } }>

export interface SettingsNamespaceView {
  ns: string
  schema: unknown
  value: unknown
  base?: unknown
  user?: unknown
  applies: 'live' | 'restart'
  secrets: Array<{ path: string[]; set: boolean }>
  revision: number
}

export interface PromaxSettingsConnection {
  api: {
    settings: {
      describe(input: Record<string, never>): RpcResponse<{
        writable: boolean
        hasDocument: boolean
        namespaces: SettingsNamespaceView[]
      }>
      mutate(input: {
        ns: string
        ops: Array<{ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }>
        expectedRevision?: number
      }): RpcResponse<SettingsNamespaceView>
    }
    credentials: {
      describe(input: { refs: string[] }): RpcResponse<{
        credentials: Record<string, { configured: boolean; source?: string; writable: boolean }>
      }>
      set(input: { ref: string; value: string }): RpcResponse<Record<string, never>>
    }
  }
}

export interface ConfiguredProviderView {
  id: string
  displayName: string
  adapter: 'llm-deepseek' | 'llm-pi-ai'
  apiKeyEnv?: string
  baseURL?: string
  api?: string
  models: string[]
}

export interface FeishuConnectionView {
  probe: number
  state: 'disabled' | 'credentials-required' | 'connecting' | 'connected' | 'error'
  tools: string[]
  checkedAt: string
  message: string
}

export type ConnectionType = 'mcp-stdio' | 'mcp-streamable-http' | 'builtin-adapter' | 'cli' | (string & {})

export interface ConnectionCredentialView {
  name: string
  configured: boolean
  writable: boolean
  source?: string
}

export interface CustomMcpCredentialBinding {
  name: string
  ref: string
}

export interface CustomMcpConnectionValue {
  serverName: string
  displayName: string
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string[]
  url: string
  env: CustomMcpCredentialBinding[]
  headers: CustomMcpCredentialBinding[]
  enabled: boolean
  probe: number
  connection: FeishuConnectionView
}

export interface ConnectionEntryView {
  id: string
  displayName: string
  type: ConnectionType
  serverName: string
  enabled: boolean
  revision: number
  probe: number
  connection: FeishuConnectionView
  credentials: ConnectionCredentialView[]
  definition: Array<{ label: string; value: string }>
  builtin: boolean
}

export interface PromaxSettingsSnapshot {
  writable: boolean
  providers: ConfiguredProviderView[]
  piAiRevision: number
  providerCredentialStates: Record<string, { configured: boolean; source?: string; writable: boolean }>
  feishu: {
    enabled: boolean
    revision: number
    connection: FeishuConnectionView
    credentials: Record<string, { configured: boolean; source?: string; writable: boolean }>
    telemetry: {
      appToken: string
      folderToken: string
      revision: number
    }
  }
  connectionsRevision: number
  customConnections: CustomMcpConnectionValue[]
  connections: ConnectionEntryView[]
}

export interface CustomProviderDraft {
  providerId: string
  displayName: string
  baseURL: string
  api: string
  models: string
  apiKey: string
}

export interface CustomMcpServerDraft {
  serverName: string
  displayName: string
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string
  url: string
  environment: string
  headers: string
  enabled: boolean
}

export class PromaxSettingsError extends Error {
  readonly code?: string
  readonly details?: unknown

  constructor(error: RpcError) {
    super(error.message)
    this.name = 'PromaxSettingsError'
    if (error.code !== undefined) this.code = error.code
    if (error.details !== undefined) this.details = error.details
  }
}

function unwrap<T>(response: Awaited<RpcResponse<T>>): T {
  if (!response.result.ok) throw new PromaxSettingsError(response.result.error)
  return response.result.value
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function modelsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item === 'string') return item.trim() === '' ? [] : [item.trim()]
    const id = stringOf(recordOf(item).id)
    return id === undefined ? [] : [id]
  })
}

function configuredProviders(namespaces: SettingsNamespaceView[]): ConfiguredProviderView[] {
  const providers: ConfiguredProviderView[] = []
  const deepseek = namespaces.find(namespace => namespace.ns === 'llm-deepseek')
  if (deepseek !== undefined) {
    const value = recordOf(deepseek.value)
    const apiKeyEnv = stringOf(value.apiKeyEnv)
    const baseURL = stringOf(value.baseURL)
    providers.push({
      id: 'deepseek',
      displayName: stringOf(value.displayName) ?? 'DeepSeek',
      adapter: 'llm-deepseek',
      ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
      ...(baseURL === undefined ? {} : { baseURL }),
      models: modelsOf(value.models),
    })
  }
  const piAi = namespaces.find(namespace => namespace.ns === 'llm-pi-ai')
  const piProviders = recordOf(recordOf(piAi?.value).providers)
  for (const [id, rawProfile] of Object.entries(piProviders)) {
    const profile = recordOf(rawProfile)
    const apiKeyEnv = stringOf(profile.apiKeyEnv)
    const baseURL = stringOf(profile.baseURL)
    const api = stringOf(profile.api)
    providers.push({
      id,
      displayName: stringOf(profile.displayName) ?? id,
      adapter: 'llm-pi-ai',
      ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
      ...(baseURL === undefined ? {} : { baseURL }),
      ...(api === undefined ? {} : { api }),
      models: modelsOf(profile.models),
    })
  }
  return providers
}

export function validateProviderId(value: string): string {
  const id = value.trim()
  if (!/^[a-z][a-z0-9-]{0,47}$/u.test(id)) {
    throw new Error('Provider ID 必须以小写字母开头，且只能包含小写字母、数字和连字符')
  }
  return id
}

export function validateWriteOnlySecret(value: string, label = 'API Key'): string {
  const secret = value.trim()
  if (secret === '') throw new Error(`${label} 不能为空`)
  if (!/^[\x21-\x7E]+$/u.test(secret)) throw new Error(`${label} 只能包含可打印 ASCII 字符，不能含空格或换行`)
  if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(secret)) throw new Error(`${label} 请只粘贴值，不要粘贴 NAME=value`)
  if ((secret.startsWith('"') && secret.endsWith('"')) || (secret.startsWith("'") && secret.endsWith("'"))) {
    throw new Error(`${label} 请去掉成对引号后再保存`)
  }
  return secret
}

export function credentialRefForProvider(providerId: string): string {
  return `${providerId.toUpperCase().replace(/-/gu, '_')}_API_KEY`
}

export function connectionTypeLabel(type: ConnectionType): string {
  if (type === 'mcp-stdio') return 'MCP stdio'
  if (type === 'mcp-streamable-http') return 'MCP streamable-http'
  if (type === 'builtin-adapter') return '内置适配'
  if (type === 'cli') return 'CLI'
  return type.trim() || '未知类型'
}

export function validateServerName(value: string): string {
  const serverName = value.trim()
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(serverName)) throw new Error('serverName 只能包含字母、数字、下划线和连字符，长度 1–32')
  if (serverName === FEISHU_MCP_SERVER_NAME) throw new Error('serverName “feishu” 已被内置飞书连接占用')
  return serverName
}

function connectionCredentialRef(serverName: string, category: 'ENV' | 'HEADER', name: string): string {
  const normalizedName = name.toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  const normalizedServer = serverName.toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  if (normalizedName === '' || normalizedServer === '') throw new Error('凭据键名无法转换为安全引用名')
  return `PROMAX_MCP_${normalizedServer}_${category}_${normalizedName}`
}

function parseWriteOnlyPairs(value: string, serverName: string, category: 'ENV' | 'HEADER'): { bindings: CustomMcpCredentialBinding[]; writes: Array<{ ref: string; value: string }> } {
  const bindings: CustomMcpCredentialBinding[] = []
  const writes: Array<{ ref: string; value: string }> = []
  for (const [index, rawLine] of value.split(/\r?\n/u).entries()) {
    const line = rawLine.trim()
    if (line === '') continue
    const separator = line.indexOf('=')
    if (separator <= 0) throw new Error(`第 ${String(index + 1)} 行必须是 NAME=只写值`)
    const name = line.slice(0, separator).trim()
    const secret = line.slice(separator + 1).trim()
    const validName = category === 'ENV' ? /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u : /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u
    if (!validName.test(name)) throw new Error(`${category === 'ENV' ? '环境变量' : 'Header'} 键名格式无效：${name}`)
    if (secret === '' || /[\r\n\u0000]/u.test(secret)) throw new Error(`${name} 的只写值不能为空或包含换行`)
    const ref = connectionCredentialRef(serverName, category, name)
    bindings.push({ name, ref })
    writes.push({ ref, value: secret })
  }
  if (new Set(bindings.map(binding => binding.name.toLowerCase())).size !== bindings.length) throw new Error('凭据键名不能重复')
  if (new Set(bindings.map(binding => binding.ref)).size !== bindings.length) throw new Error('凭据键名规范化后发生冲突，请换一个键名')
  return { bindings, writes }
}

function customConnectionFromDraft(draft: CustomMcpServerDraft): { entry: CustomMcpConnectionValue; writes: Array<{ ref: string; value: string }> } {
  const serverName = validateServerName(draft.serverName)
  const displayName = draft.displayName.trim() || serverName
  const args = draft.args.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
  const environment = parseWriteOnlyPairs(draft.environment, serverName, 'ENV')
  const headers = parseWriteOnlyPairs(draft.headers, serverName, 'HEADER')
  let command = ''
  let url = ''
  if (draft.transport === 'stdio') {
    command = draft.command.trim()
    if (command === '') throw new Error('stdio 连接必须填写 command')
  } else {
    url = validateBaseURL(draft.url)
  }
  return {
    entry: {
      serverName,
      displayName,
      transport: draft.transport,
      command,
      args: draft.transport === 'stdio' ? args : [],
      url,
      env: draft.transport === 'stdio' ? environment.bindings : [],
      headers: draft.transport === 'streamable-http' ? headers.bindings : [],
      enabled: draft.enabled,
      probe: 0,
      connection: { probe: 0, state: draft.enabled ? 'connecting' : 'disabled', tools: [], checkedAt: '', message: draft.enabled ? '等待连接' : 'MCP 未启用' },
    },
    writes: draft.transport === 'stdio' ? environment.writes : headers.writes,
  }
}

function parseModelIds(value: string): string[] {
  const ids = value.split(/[\n,]/u).map(item => item.trim()).filter(Boolean)
  if (ids.length === 0) throw new Error('至少填写一个模型 ID')
  if (new Set(ids).size !== ids.length) throw new Error('模型 ID 不能重复')
  if (ids.some(id => id.length > 128 || /[\u0000-\u001F\u007F]/u.test(id))) throw new Error('模型 ID 格式无效')
  return ids
}

function validateBaseURL(value: string): string {
  const baseURL = value.trim().replace(/\/+$/u, '')
  let parsed: URL
  try { parsed = new URL(baseURL) } catch { throw new Error('Base URL 必须是有效的 http(s) 地址') }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Base URL 必须使用 http 或 https')
  return baseURL
}

function feishuValue(namespace: SettingsNamespaceView): { enabled: boolean; connection: FeishuConnectionView } {
  const value = recordOf(namespace.value)
  const connection = recordOf(value.connection)
  const state = stringOf(connection.state)
  return {
    enabled: value.enabled === true,
    connection: {
      probe: Number.isSafeInteger(connection.probe) ? Number(connection.probe) : 0,
      state: state === 'credentials-required' || state === 'connecting' || state === 'connected' || state === 'error' ? state : 'disabled',
      tools: Array.isArray(connection.tools) ? connection.tools.filter((item): item is string => typeof item === 'string') : [],
      checkedAt: stringOf(connection.checkedAt) ?? '',
      message: stringOf(connection.message) ?? '飞书 MCP 未启用',
    },
  }
}

function credentialBindingsOf(value: unknown): CustomMcpCredentialBinding[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const row = recordOf(item)
    const name = stringOf(row.name)
    const ref = stringOf(row.ref)
    return name === undefined || ref === undefined ? [] : [{ name, ref }]
  })
}

function connectionStateOf(value: unknown, enabled: boolean): FeishuConnectionView {
  const connection = recordOf(value)
  const state = stringOf(connection.state)
  return {
    probe: Number.isSafeInteger(connection.probe) ? Number(connection.probe) : 0,
    state: state === 'credentials-required' || state === 'connecting' || state === 'connected' || state === 'error'
      ? state
      : 'disabled',
    tools: Array.isArray(connection.tools) ? connection.tools.filter((item): item is string => typeof item === 'string') : [],
    checkedAt: stringOf(connection.checkedAt) ?? '',
    message: stringOf(connection.message) ?? (enabled ? '等待连接' : 'MCP 未启用'),
  }
}

function customConnectionsValue(namespace: SettingsNamespaceView): CustomMcpConnectionValue[] {
  const entries = recordOf(namespace.value).entries
  if (!Array.isArray(entries)) return []
  return entries.flatMap(item => {
    const row = recordOf(item)
    const serverName = stringOf(row.serverName)
    const displayName = stringOf(row.displayName)
    const transport = stringOf(row.transport)
    if (serverName === undefined || displayName === undefined || (transport !== 'stdio' && transport !== 'streamable-http')) return []
    const enabled = row.enabled === true
    return [{
      serverName,
      displayName,
      transport,
      command: stringOf(row.command) ?? '',
      args: Array.isArray(row.args) ? row.args.filter((arg): arg is string => typeof arg === 'string') : [],
      url: stringOf(row.url) ?? '',
      env: credentialBindingsOf(row.env),
      headers: credentialBindingsOf(row.headers),
      enabled,
      probe: Number.isSafeInteger(row.probe) ? Number(row.probe) : 0,
      connection: connectionStateOf(row.connection, enabled),
    }]
  })
}

function credentialView(name: string, ref: string, states: Record<string, { configured: boolean; source?: string; writable: boolean }>): ConnectionCredentialView {
  const state = states[ref] ?? { configured: false, writable: false }
  return { name, configured: state.configured, writable: state.writable, ...(state.source === undefined ? {} : { source: state.source }) }
}

function connectionViews(
  feishu: PromaxSettingsSnapshot['feishu'],
  customConnections: CustomMcpConnectionValue[],
  customRevision: number,
  credentialStates: Record<string, { configured: boolean; source?: string; writable: boolean }>,
): ConnectionEntryView[] {
  const feishuEntry: ConnectionEntryView = {
    id: 'builtin:feishu',
    displayName: '飞书',
    type: 'builtin-adapter',
    serverName: FEISHU_MCP_SERVER_NAME,
    enabled: feishu.enabled,
    revision: feishu.revision,
    probe: feishu.connection.probe,
    connection: feishu.connection,
    credentials: FEISHU_CREDENTIAL_REFS.map(ref => credentialView(ref, ref, credentialStates)),
    definition: [
      { label: 'serverName', value: FEISHU_MCP_SERVER_NAME },
      { label: '包名', value: FEISHU_MCP_PACKAGE },
      { label: 'transport', value: FEISHU_MCP_TRANSPORT },
      { label: 'command', value: `npx -y ${FEISHU_MCP_PACKAGE} mcp` },
    ],
    builtin: true,
  }
  return [feishuEntry, ...customConnections.map(entry => ({
    id: `mcp:${entry.serverName}`,
    displayName: entry.displayName,
    type: entry.transport === 'stdio' ? 'mcp-stdio' as const : 'mcp-streamable-http' as const,
    serverName: entry.serverName,
    enabled: entry.enabled,
    revision: customRevision,
    probe: entry.probe,
    connection: entry.connection,
    credentials: [
      ...entry.env.map(binding => credentialView(`环境变量 ${binding.name}`, binding.ref, credentialStates)),
      ...entry.headers.map(binding => credentialView(`Header ${binding.name}`, binding.ref, credentialStates)),
    ],
    definition: entry.transport === 'stdio'
      ? [
          { label: 'serverName', value: entry.serverName },
          { label: 'transport', value: 'stdio' },
          { label: 'command', value: entry.command },
          { label: 'args', value: entry.args.join(' ') || '无' },
        ]
      : [
          { label: 'serverName', value: entry.serverName },
          { label: 'transport', value: 'streamable-http' },
          { label: 'url', value: entry.url },
          { label: 'headers', value: entry.headers.map(binding => binding.name).join('、') || '无' },
        ],
    builtin: false,
  }))]
}

export interface PromaxSettingsService {
  load(): Promise<PromaxSettingsSnapshot>
  createProvider(draft: CustomProviderDraft, expectedRevision: number): Promise<SettingsNamespaceView>
  createConnection(draft: CustomMcpServerDraft, snapshot: PromaxSettingsSnapshot): Promise<SettingsNamespaceView>
  setFeishuCredentials(values: { appId?: string; appSecret?: string }): Promise<void>
  setFeishuTelemetry(values: { appToken: string; folderToken: string }, expectedRevision: number): Promise<SettingsNamespaceView>
  setConnectionEnabled(entry: ConnectionEntryView, enabled: boolean, snapshot: PromaxSettingsSnapshot): Promise<SettingsNamespaceView>
  testConnection(entry: ConnectionEntryView, snapshot: PromaxSettingsSnapshot): Promise<FeishuConnectionView>
}

export function createPromaxSettingsService(connection: PromaxSettingsConnection): PromaxSettingsService {
  const describe = async (): Promise<{ writable: boolean; namespaces: SettingsNamespaceView[] }> => {
    const value = unwrap(await connection.api.settings.describe({}))
    return { writable: value.writable, namespaces: value.namespaces }
  }

  return {
    async load() {
      const described = await describe()
      const piAi = described.namespaces.find(namespace => namespace.ns === 'llm-pi-ai')
      if (piAi === undefined) throw new Error('运行时未挂载 llm-pi-ai 设置空间')
      const feishuNamespace = described.namespaces.find(namespace => namespace.ns === FEISHU_MCP_SETTINGS_NS)
      if (feishuNamespace === undefined) throw new Error('运行时未挂载 Promax 飞书 MCP 设置空间')
      const feishuTelemetryNamespace = described.namespaces.find(namespace => namespace.ns === FEISHU_TELEMETRY_SETTINGS_NS)
      if (feishuTelemetryNamespace === undefined) throw new Error('运行时未挂载 Promax 飞书遥测设置空间')
      const connectionsNamespace = described.namespaces.find(namespace => namespace.ns === CONNECTIONS_SETTINGS_NS)
      if (connectionsNamespace === undefined) throw new Error('运行时未挂载 Promax 连接设置空间')
      const providers = configuredProviders(described.namespaces)
      const customConnections = customConnectionsValue(connectionsNamespace)
      const providerRefs = providers.flatMap(provider => provider.apiKeyEnv === undefined ? [] : [provider.apiKeyEnv])
      const customRefs = customConnections.flatMap(entry => [...entry.env, ...entry.headers].map(binding => binding.ref))
      const refs = [...new Set([...providerRefs, ...FEISHU_CREDENTIAL_REFS, ...customRefs])]
      const credentialState = unwrap(await connection.api.credentials.describe({ refs })).credentials
      const feishu = feishuValue(feishuNamespace)
      const feishuTelemetryValue = recordOf(feishuTelemetryNamespace.value)
      const feishuSnapshot = {
        enabled: feishu.enabled,
        revision: feishuNamespace.revision,
        connection: feishu.connection,
        credentials: Object.fromEntries(FEISHU_CREDENTIAL_REFS.map(ref => [ref, credentialState[ref] ?? { configured: false, writable: false }])),
        telemetry: {
          appToken: stringOf(feishuTelemetryValue.appToken) ?? '',
          folderToken: stringOf(feishuTelemetryValue.folderToken) ?? '',
          revision: feishuTelemetryNamespace.revision,
        },
      }
      return {
        writable: described.writable,
        providers,
        piAiRevision: piAi.revision,
        providerCredentialStates: Object.fromEntries(providerRefs.map(ref => [ref, credentialState[ref] ?? { configured: false, writable: false }])),
        feishu: feishuSnapshot,
        connectionsRevision: connectionsNamespace.revision,
        customConnections,
        connections: connectionViews(feishuSnapshot, customConnections, connectionsNamespace.revision, credentialState),
      }
    },

    async createProvider(draft, expectedRevision) {
      const providerId = validateProviderId(draft.providerId)
      const apiKey = validateWriteOnlySecret(draft.apiKey)
      const baseURL = validateBaseURL(draft.baseURL)
      const models = parseModelIds(draft.models).map(id => ({ id }))
      if (draft.api !== 'openai-completions' && draft.api !== 'openai-responses') throw new Error('请选择受支持的 API 协议')
      const ref = credentialRefForProvider(providerId)
      const profile = {
        displayName: draft.displayName.trim() || providerId,
        baseURL,
        api: draft.api,
        apiKeyEnv: ref,
        models,
      }
      const mutated = unwrap(await connection.api.settings.mutate({
        ns: 'llm-pi-ai',
        ops: [{ op: 'set', path: ['providers', providerId], value: profile }],
        expectedRevision,
      }))
      try {
        unwrap(await connection.api.credentials.set({ ref, value: apiKey }))
      } catch {
        let rolledBack = false
        try {
          unwrap(await connection.api.settings.mutate({
            ns: 'llm-pi-ai',
            ops: [{ op: 'unset', path: ['providers', providerId] }],
            expectedRevision: mutated.revision,
          }))
          rolledBack = true
        } catch { /* a concurrent settings change must not be overwritten */ }
        throw new Error(rolledBack
          ? 'API Key 未保存，Provider 创建已撤回；请重试。错误正文未显示，以免第三方消息夹带凭据。'
          : 'API Key 未保存，且并发设置变更阻止了安全撤回；已重新载入后请检查 Provider。错误正文未显示，以免第三方消息夹带凭据。')
      }
      return mutated
    },

    async createConnection(draft, snapshot) {
      const { entry, writes } = customConnectionFromDraft(draft)
      if (snapshot.connections.some(connectionEntry => connectionEntry.serverName === entry.serverName)) throw new Error(`serverName “${entry.serverName}” 已存在`)
      const entries = [...snapshot.customConnections, entry]
      const mutated = unwrap(await connection.api.settings.mutate({
        ns: CONNECTIONS_SETTINGS_NS,
        ops: [{ op: 'set', path: ['entries'], value: entries }],
        expectedRevision: snapshot.connectionsRevision,
      }))
      try {
        await Promise.all(writes.map(write => connection.api.credentials.set(write).then(unwrap)))
      } catch {
        let rolledBack = false
        try {
          unwrap(await connection.api.settings.mutate({
            ns: CONNECTIONS_SETTINGS_NS,
            ops: [{ op: 'set', path: ['entries'], value: snapshot.customConnections }],
            expectedRevision: mutated.revision,
          }))
          rolledBack = true
        } catch { /* never overwrite a concurrent settings change */ }
        throw new Error(rolledBack
          ? '连接凭据未保存，MCP server 创建已撤回；请重试。错误正文未显示，以免第三方消息夹带凭据。'
          : '连接凭据未保存，且并发设置变更阻止了安全撤回；已重新载入后请检查连接。错误正文未显示，以免第三方消息夹带凭据。')
      }
      return mutated
    },

    async setFeishuCredentials(values) {
      const writes: Array<Promise<unknown>> = []
      if (values.appId?.trim()) writes.push(connection.api.credentials.set({ ref: 'APP_ID', value: validateWriteOnlySecret(values.appId, 'APP_ID') }).then(unwrap))
      if (values.appSecret?.trim()) writes.push(connection.api.credentials.set({ ref: 'APP_SECRET', value: validateWriteOnlySecret(values.appSecret, 'APP_SECRET') }).then(unwrap))
      if (writes.length === 0) throw new Error('至少填写一项要更新的飞书凭据')
      await Promise.all(writes)
    },

    async setFeishuTelemetry(values, expectedRevision) {
      const appToken = values.appToken.trim()
      const folderToken = values.folderToken.trim()
      if (appToken !== '' && !/^[A-Za-z0-9_-]{8,128}$/u.test(appToken)) throw new Error('多维表格 app_token 格式无效')
      if (folderToken !== '' && !/^[A-Za-z0-9_-]{8,128}$/u.test(folderToken)) throw new Error('云文档文件夹 token 格式无效')
      return unwrap(await connection.api.settings.mutate({
        ns: FEISHU_TELEMETRY_SETTINGS_NS,
        ops: [
          { op: 'set', path: ['appToken'], value: appToken },
          { op: 'set', path: ['folderToken'], value: folderToken },
        ],
        expectedRevision,
      }))
    },

    async setConnectionEnabled(entry, enabled, snapshot) {
      if (entry.builtin) {
        return unwrap(await connection.api.settings.mutate({
          ns: FEISHU_MCP_SETTINGS_NS,
          ops: [{ op: 'set', path: ['enabled'], value: enabled }],
          expectedRevision: entry.revision,
        }))
      }
      const entries = snapshot.customConnections.map(value => value.serverName === entry.serverName ? { ...value, enabled } : value)
      return unwrap(await connection.api.settings.mutate({
        ns: CONNECTIONS_SETTINGS_NS,
        ops: [{ op: 'set', path: ['entries'], value: entries }],
        expectedRevision: snapshot.connectionsRevision,
      }))
    },

    async testConnection(entry, snapshot) {
      const probe = Math.max(Date.now(), entry.probe + 1)
      const namespaceName = entry.builtin ? FEISHU_MCP_SETTINGS_NS : CONNECTIONS_SETTINGS_NS
      const ops = entry.builtin
        ? [{ op: 'set' as const, path: ['probe'], value: probe }]
        : [{
            op: 'set' as const,
            path: ['entries'],
            value: snapshot.customConnections.map(value => value.serverName === entry.serverName ? { ...value, probe } : value),
          }]
      const mutated = unwrap(await connection.api.settings.mutate({
        ns: namespaceName,
        ops,
        expectedRevision: entry.builtin ? entry.revision : snapshot.connectionsRevision,
      }))
      const immediate = entry.builtin
        ? feishuValue(mutated).connection
        : customConnectionsValue(mutated).find(value => value.serverName === entry.serverName)?.connection
      if (immediate === undefined) throw new Error(`连接 ${entry.displayName} 在连接测试期间消失`)
      if (immediate.probe === probe && immediate.state !== 'connecting') return immediate
      for (let attempt = 0; attempt < 160; attempt += 1) {
        await new Promise<void>(resolve => { window.setTimeout(resolve, 250) })
        const described = await describe()
        const namespace = described.namespaces.find(item => item.ns === namespaceName)
        if (namespace === undefined) throw new Error(`连接 ${entry.displayName} 的设置空间在连接测试期间消失`)
        const current = entry.builtin
          ? feishuValue(namespace).connection
          : customConnectionsValue(namespace).find(value => value.serverName === entry.serverName)?.connection
        if (current === undefined) throw new Error(`连接 ${entry.displayName} 在连接测试期间消失`)
        if (current.probe === probe && current.state !== 'connecting') return current
      }
      throw new Error(`连接 ${entry.displayName} 测试超时`)
    },
  }
}

export type SettingsTab = 'models' | 'connections' | 'preferences'

const EMPTY_CONNECTION_DRAFT: CustomMcpServerDraft = {
  serverName: '', displayName: '', transport: 'stdio', command: '', args: '', url: '', environment: '', headers: '', enabled: true,
}

function errorMessage(error: unknown): string {
  if (error instanceof PromaxSettingsError && error.code === 'settings-conflict') return '设置已在另一窗口更新。已重新载入最新版本，请确认后重试。'
  return error instanceof Error ? error.message : String(error)
}

function connectionStatus(entry: ConnectionEntryView): { connected: boolean; label: string } {
  const connected = entry.connection.state === 'connected'
  const label = connected ? '已连接' : entry.connection.state === 'connecting' ? '连接中' : entry.connection.state === 'credentials-required' ? '凭据缺失' : entry.enabled ? '未连接' : '已停用'
  return { connected, label }
}

export function ConnectionCard({ entry, busy, writable, onOpen, onToggle }: {
  entry: ConnectionEntryView
  busy: boolean
  writable: boolean
  onOpen(): void
  onToggle(enabled: boolean): void
}) {
  const status = connectionStatus(entry)
  return <article className="promax-settings-card" data-connection-component="connection-card" data-connection-id={entry.id}>
    <header><div><strong>{entry.displayName}</strong><small>{entry.serverName} · {connectionTypeLabel(entry.type)}</small></div><span className={`promax-settings-status ${status.connected ? 'configured' : 'missing'}`}>{status.label}</span></header>
    <p>{entry.connection.message}</p>
    <div className="promax-settings-credential-state" aria-label={`${entry.displayName}凭据状态`}>
      {entry.credentials.length === 0 ? <span><strong>凭据</strong>无</span> : entry.credentials.map(credential => <span key={credential.name}><strong>{credential.name}</strong>{credential.configured ? '已配置' : '未配置'}</span>)}
    </div>
    <div className="promax-settings-card-actions">
      <label className="promax-switch"><input type="checkbox" checked={entry.enabled} disabled={busy || !writable} onChange={event => { onToggle(event.currentTarget.checked) }} /><span>{entry.enabled ? '已启用' : '已停用'}</span></label>
      <button className="promax-button promax-button--primary" type="button" aria-label={`查看详情：${entry.displayName}`} onClick={onOpen}>查看详情</button>
    </div>
  </article>
}

export function ConnectionDetailPage({ entry, busy, writable, onBack, onToggle, onTest, credentialEditor }: {
  entry: ConnectionEntryView
  busy: boolean
  writable: boolean
  onBack(): void
  onToggle(enabled: boolean): void
  onTest(): void
  credentialEditor?: ReactNode
}) {
  const status = connectionStatus(entry)
  return <section className="promax-settings-detail-page" aria-labelledby="promax-connection-detail-heading" data-connection-detail-id={entry.id}>
    <button className="promax-settings-back" type="button" onClick={onBack}>返回连接列表</button>
    <header className="promax-settings-detail-header">
      <div><span className="promax-eyebrow">MCP CONNECTION</span><h3 id="promax-connection-detail-heading">{entry.displayName}</h3><p>{entry.serverName} · {connectionTypeLabel(entry.type)}</p></div>
      <span className={`promax-settings-status ${status.connected ? 'configured' : 'missing'}`}>{status.label}</span>
    </header>
    <div className="promax-settings-detail-actions">
      <label className="promax-switch"><input type="checkbox" checked={entry.enabled} disabled={busy || !writable} onChange={event => { onToggle(event.currentTarget.checked) }} /><span>{entry.enabled ? '已启用' : '已停用'}</span></label>
      <button className="promax-button promax-button--primary" type="button" aria-label={`连接测试：${entry.displayName}`} disabled={busy || !writable || !entry.enabled} onClick={onTest}>{busy ? '正在连接…' : '连接测试'}</button>
    </div>
    <div className="promax-settings-detail-section">
      <h4>连接定义</h4>
      <dl className="promax-settings-definition">{entry.definition.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    </div>
    <div className="promax-settings-detail-section">
      <h4>凭据状态</h4>
      <div className="promax-settings-credential-state" aria-label={`${entry.displayName}凭据状态`}>
        {entry.credentials.length === 0 ? <span><strong>凭据</strong>无</span> : entry.credentials.map(credential => <span key={credential.name}><strong>{credential.name}</strong>{credential.configured ? '已配置' : '未配置'}</span>)}
      </div>
    </div>
    {credentialEditor}
    <div className="promax-settings-detail-section">
      <h4>运行状态</h4>
      <div className={`promax-settings-connection promax-settings-connection--${entry.connection.state}`}><strong>{entry.connection.message}</strong>{entry.connection.checkedAt === '' ? null : <small>最近检查：{entry.connection.checkedAt}</small>}</div>
    </div>
    <div className="promax-settings-detail-section">
      <h4>实际注册工具</h4>
      {entry.connection.tools.length === 0 ? <p>尚未从运行时读到工具；请先运行连接测试。</p> : <ul className="promax-settings-tools" aria-label={`实际注册工具：${entry.displayName}`}>{entry.connection.tools.map(tool => <li key={tool}>{tool}</li>)}</ul>}
    </div>
  </section>
}

export function PromaxSettingsPanel({ service, preferences }: { service: PromaxSettingsService; preferences: ReactNode }) {
  const [tab, setTab] = useState<SettingsTab>('models')
  const [snapshot, setSnapshot] = useState<PromaxSettingsSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [providerDraft, setProviderDraft] = useState<CustomProviderDraft>({
    providerId: '', displayName: '', baseURL: '', api: 'openai-completions', models: '', apiKey: '',
  })
  const [connectionDraft, setConnectionDraft] = useState<CustomMcpServerDraft>(EMPTY_CONNECTION_DRAFT)
  const [addingConnection, setAddingConnection] = useState(false)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [appToken, setAppToken] = useState('')
  const [folderToken, setFolderToken] = useState('')

  const reload = async (): Promise<PromaxSettingsSnapshot> => {
    const next = await service.load()
    setSnapshot(next)
    return next
  }

  useEffect(() => {
    let active = true
    setError(null)
    void service.load().then(next => { if (active) setSnapshot(next) }).catch(reason => { if (active) setError(errorMessage(reason)) })
    return () => { active = false }
  }, [service])

  useEffect(() => {
    if (selectedConnectionId !== 'builtin:feishu' || snapshot === null) return
    setAppToken(snapshot.feishu.telemetry.appToken)
    setFolderToken(snapshot.feishu.telemetry.folderToken)
  }, [selectedConnectionId, snapshot?.feishu.telemetry.appToken, snapshot?.feishu.telemetry.folderToken])

  const run = (operation: () => Promise<string>): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    void operation().then(message => {
      setNotice(message)
    }).catch(async reason => {
      setError(errorMessage(reason))
      if (reason instanceof PromaxSettingsError && reason.code === 'settings-conflict') {
        try { await reload() } catch { /* keep the conflict message */ }
      }
    }).finally(() => { setBusy(false) })
  }

  const submitProvider = (event: FormEvent): void => {
    event.preventDefault()
    run(async () => {
      if (snapshot === null) throw new Error('设置仍在加载')
      const id = validateProviderId(providerDraft.providerId)
      if (snapshot.providers.some(provider => provider.id === id)) throw new Error(`Provider ID “${id}” 已存在`)
      await service.createProvider(providerDraft, snapshot.piAiRevision)
      setProviderDraft({ providerId: '', displayName: '', baseURL: '', api: 'openai-completions', models: '', apiKey: '' })
      await reload()
      return `Provider “${id}” 已创建；密钥已写入安全凭据存储，页面不会回填。`
    })
  }

  const saveFeishu = (event: FormEvent): void => {
    event.preventDefault()
    run(async () => {
      await service.setFeishuCredentials({ appId, appSecret })
      setAppId('')
      setAppSecret('')
      await reload()
      return '飞书凭据已更新；输入框已清空，页面不会读取或回填密钥。'
    })
  }

  const saveFeishuTelemetry = (event: FormEvent): void => {
    event.preventDefault()
    run(async () => {
      if (snapshot === null) throw new Error('设置仍在加载')
      await service.setFeishuTelemetry({ appToken, folderToken }, snapshot.feishu.telemetry.revision)
      await reload()
      return appToken.trim() === '' ? '飞书运行记录已关闭。' : '飞书运行记录目标已保存；后续任务会由运行时自动写入。'
    })
  }

  const submitConnection = (event: FormEvent): void => {
    event.preventDefault()
    run(async () => {
      if (snapshot === null) throw new Error('设置仍在加载')
      const serverName = validateServerName(connectionDraft.serverName)
      await service.createConnection(connectionDraft, snapshot)
      setConnectionDraft(EMPTY_CONNECTION_DRAFT)
      setAddingConnection(false)
      setSelectedConnectionId(`mcp:${serverName}`)
      await reload()
      return `MCP server “${serverName}” 已添加；凭据值已写入只写存储，不会回填。`
    })
  }

  const setConnectionEnabled = (entry: ConnectionEntryView, enabled: boolean): void => {
    run(async () => {
      if (snapshot === null) throw new Error('设置仍在加载')
      await service.setConnectionEnabled(entry, enabled, snapshot)
      await reload()
      return enabled ? `已启用 ${entry.displayName}。` : `已停用 ${entry.displayName}。`
    })
  }

  const testConnection = (entry: ConnectionEntryView): void => {
    run(async () => {
      if (snapshot === null) throw new Error('设置仍在加载')
      const result = await service.testConnection(entry, snapshot)
      await reload()
      if (result.state !== 'connected') throw new Error(result.message)
      return `连接成功，实际注册 ${String(result.tools.length)} 个工具：${result.tools.join('、')}`
    })
  }

  const selectedConnection = selectedConnectionId === null ? undefined : snapshot?.connections.find(entry => entry.id === selectedConnectionId)

  return <div className={`promax-team-settings-layout${selectedConnection === undefined ? '' : ' promax-team-settings-layout--detail'}`}>
    {selectedConnection === undefined ? <>
    <nav className="promax-settings-tabs" aria-label="Promax 设置分类">
      {([
        ['models', '模型'], ['connections', '连接'], ['preferences', '偏好'],
      ] as Array<[SettingsTab, string]>).map(([id, label]) => <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setSelectedConnectionId(null); setError(null); setNotice(null) }}>{label}</button>)}
    </nav>
    <div className="promax-settings-content">
      {error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}
      {notice === null ? null : <div className="promax-settings-notice" role="status">{notice}</div>}
      {snapshot === null && error === null ? <p role="status">正在读取脱敏设置…</p> : null}

      {tab === 'models' && snapshot !== null ? <section aria-labelledby="promax-model-settings-heading">
        <div className="promax-settings-section-heading"><div><span className="promax-eyebrow">MODELS</span><h3 id="promax-model-settings-heading">已配置模型</h3><p>这里只显示当前已配置的 Provider；凭据只显示状态，不显示值。</p></div></div>
        <div className="promax-settings-card-grid">{snapshot.providers.map(provider => {
          const credential = provider.apiKeyEnv === undefined ? undefined : snapshot.providerCredentialStates[provider.apiKeyEnv]
          return <article className="promax-settings-card" key={`${provider.adapter}:${provider.id}`}><header><div><strong>{provider.displayName}</strong><small>{provider.id} · {provider.adapter}</small></div><span className={`promax-settings-status ${credential?.configured === true ? 'configured' : 'missing'}`}>{credential === undefined ? '原生认证' : credential.configured ? '密钥已配置' : '密钥未配置'}</span></header>{provider.baseURL === undefined ? null : <p>{provider.baseURL}</p>}<p>{provider.models.length > 0 ? provider.models.join('、') : '使用 Provider 默认模型目录'}</p></article>
        })}</div>
        <form className="promax-settings-form" onSubmit={submitProvider}>
          <h3>新增自定义 Provider</h3>
          <div className="promax-settings-form-grid"><label>Provider ID<input autoComplete="off" value={providerDraft.providerId} onChange={event => { const value = event.currentTarget.value; setProviderDraft(current => ({ ...current, providerId: value })) }} placeholder="acme-gateway" disabled={busy || !snapshot.writable} /></label><label>显示名称<input value={providerDraft.displayName} onChange={event => { const value = event.currentTarget.value; setProviderDraft(current => ({ ...current, displayName: value })) }} placeholder="Acme Gateway" disabled={busy || !snapshot.writable} /></label><label className="wide">Base URL<input type="url" value={providerDraft.baseURL} onChange={event => { const value = event.currentTarget.value; setProviderDraft(current => ({ ...current, baseURL: value })) }} placeholder="https://gateway.example/v1" disabled={busy || !snapshot.writable} /></label><label>API 协议<select value={providerDraft.api} onChange={event => { const value = event.currentTarget.value; setProviderDraft(current => ({ ...current, api: value })) }} disabled={busy || !snapshot.writable}><option value="openai-completions">OpenAI Completions</option><option value="openai-responses">OpenAI Responses</option></select></label><label>API Key（只写）<input type="password" autoComplete="new-password" value={providerDraft.apiKey} onChange={event => { const value = event.currentTarget.value; setProviderDraft(current => ({ ...current, apiKey: value })) }} placeholder="保存后不会回填" disabled={busy || !snapshot.writable} /></label><label className="wide">模型 ID 列表<textarea value={providerDraft.models} onChange={event => { const value = event.currentTarget.value; setProviderDraft(current => ({ ...current, models: value })) }} placeholder={'model-a\nmodel-b'} disabled={busy || !snapshot.writable} /></label></div>
          <button className="promax-button promax-button--primary" type="submit" disabled={busy || !snapshot.writable}>{busy ? '正在保存…' : '创建 Provider'}</button>
        </form>
      </section> : null}

      {tab === 'connections' && snapshot !== null ? <section aria-labelledby="promax-connection-settings-heading">
        <div className="promax-settings-section-heading"><div><span className="promax-eyebrow">CONNECTIONS</span><h3 id="promax-connection-settings-heading">连接</h3><p>所有外部系统使用同一列表、同一卡片和同一连接测试流程。凭据只显示状态，不显示值。</p></div><button className="promax-button promax-button--primary" type="button" onClick={() => { setAddingConnection(current => !current) }} disabled={busy || !snapshot.writable}>{addingConnection ? '取消' : '+ 添加'}</button></div>
        {addingConnection ? <form className="promax-settings-form" onSubmit={submitConnection}>
          <h3>添加自定义 MCP server</h3>
          <div className="promax-settings-form-grid">
            <label>serverName<input autoComplete="off" value={connectionDraft.serverName} onChange={event => { const value = event.currentTarget.value; setConnectionDraft(current => ({ ...current, serverName: value })) }} placeholder="research-tools" disabled={busy || !snapshot.writable} /></label>
            <label>显示名称<input value={connectionDraft.displayName} onChange={event => { const value = event.currentTarget.value; setConnectionDraft(current => ({ ...current, displayName: value })) }} placeholder="Research Tools" disabled={busy || !snapshot.writable} /></label>
            <label>transport<select value={connectionDraft.transport} onChange={event => { const transport = event.currentTarget.value as CustomMcpServerDraft['transport']; setConnectionDraft(current => ({ ...current, transport })) }} disabled={busy || !snapshot.writable}><option value="stdio">MCP stdio</option><option value="streamable-http">MCP streamable-http</option></select></label>
            {connectionDraft.transport === 'stdio' ? <><label>command<input value={connectionDraft.command} onChange={event => { const value = event.currentTarget.value; setConnectionDraft(current => ({ ...current, command: value })) }} placeholder="npx" disabled={busy || !snapshot.writable} /></label><label className="wide">args（每行一个参数）<textarea value={connectionDraft.args} onChange={event => { const value = event.currentTarget.value; setConnectionDraft(current => ({ ...current, args: value })) }} placeholder={'-y\n@scope/package'} disabled={busy || !snapshot.writable} /></label><label className="wide">环境变量（每行 NAME=只写值）<textarea value={connectionDraft.environment} onChange={event => { const value = event.currentTarget.value; setConnectionDraft(current => ({ ...current, environment: value })) }} placeholder="TOKEN=保存后不会回填" autoComplete="off" disabled={busy || !snapshot.writable} /></label></> : <><label className="wide">URL<input type="url" value={connectionDraft.url} onChange={event => { const value = event.currentTarget.value; setConnectionDraft(current => ({ ...current, url: value })) }} placeholder="https://mcp.example.com/mcp" disabled={busy || !snapshot.writable} /></label><label className="wide">Headers（每行 Name=只写值）<textarea value={connectionDraft.headers} onChange={event => { const value = event.currentTarget.value; setConnectionDraft(current => ({ ...current, headers: value })) }} placeholder="Authorization=Bearer …" autoComplete="off" disabled={busy || !snapshot.writable} /></label></>}
            <label className="promax-switch"><input type="checkbox" checked={connectionDraft.enabled} onChange={event => { const enabled = event.currentTarget.checked; setConnectionDraft(current => ({ ...current, enabled })) }} disabled={busy || !snapshot.writable} /><span>创建后立即启用</span></label>
          </div>
          <button className="promax-button promax-button--primary" type="submit" disabled={busy || !snapshot.writable}>{busy ? '正在保存…' : '创建连接'}</button>
        </form> : null}
        <div className="promax-settings-card-grid">{snapshot.connections.map(entry => <ConnectionCard key={entry.id} entry={entry} busy={busy} writable={snapshot.writable} onOpen={() => { setSelectedConnectionId(entry.id); setError(null); setNotice(null) }} onToggle={enabled => { setConnectionEnabled(entry, enabled) }} />)}</div>
      </section> : null}

      {tab === 'preferences' ? <section aria-labelledby="promax-preference-settings-heading"><div className="promax-settings-section-heading"><div><span className="promax-eyebrow">PREFERENCES</span><h3 id="promax-preference-settings-heading">偏好</h3></div></div>{preferences}</section> : null}
    </div>
    </> : <main className="promax-settings-detail-surface">
      {error === null ? null : <div className="promax-inline-error" role="alert">{error}</div>}
      {notice === null ? null : <div className="promax-settings-notice" role="status">{notice}</div>}
      <ConnectionDetailPage
        entry={selectedConnection}
        busy={busy}
        writable={snapshot?.writable ?? false}
        onBack={() => { setSelectedConnectionId(null); setError(null); setNotice(null) }}
        onToggle={enabled => { setConnectionEnabled(selectedConnection, enabled) }}
        onTest={() => { testConnection(selectedConnection) }}
        credentialEditor={selectedConnection.builtin ? <>
          <form className="promax-settings-form" onSubmit={saveFeishu}><h4>更新凭据（只写）</h4><div className="promax-settings-form-grid"><label>APP_ID（只写）<input type="password" autoComplete="new-password" value={appId} onChange={event => { setAppId(event.currentTarget.value) }} placeholder="留空表示不修改" disabled={busy || !(snapshot?.writable ?? false)} /></label><label>APP_SECRET（只写）<input type="password" autoComplete="new-password" value={appSecret} onChange={event => { setAppSecret(event.currentTarget.value) }} placeholder="留空表示不修改" disabled={busy || !(snapshot?.writable ?? false)} /></label></div><button className="promax-button promax-button--primary" type="submit" disabled={busy || !(snapshot?.writable ?? false)}>{busy ? '正在保存…' : '安全保存凭据'}</button></form>
          <form className="promax-settings-form" onSubmit={saveFeishuTelemetry}><h4>运行记录目标</h4><p>每次任务结束后，由运行时自动把记录写入多维表格，并在指定云空间文件夹创建明细文档；不要求智能体操作飞书。</p><div className="promax-settings-form-grid"><label>多维表格 app_token<input autoComplete="off" value={appToken} onChange={event => { setAppToken(event.currentTarget.value) }} placeholder="例如 C2XIb…" disabled={busy || !(snapshot?.writable ?? false)} /></label><label>云文档文件夹 token<input autoComplete="off" value={folderToken} onChange={event => { setFolderToken(event.currentTarget.value) }} placeholder="例如 CMhUf…" disabled={busy || !(snapshot?.writable ?? false)} /></label></div><button className="promax-button promax-button--primary" type="submit" disabled={busy || !(snapshot?.writable ?? false)}>{busy ? '正在保存…' : '保存运行记录目标'}</button></form>
        </> : undefined}
      />
    </main>}
  </div>
}
