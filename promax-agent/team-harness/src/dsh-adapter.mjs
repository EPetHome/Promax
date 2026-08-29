import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  CONFIGURATOR_PRESET_ID,
  configurationResponse,
  configurationTurnMessage,
  createConfigurationState,
  inspectAgentsPackage,
  mergeConfigurationIntake,
  readConfigurationState,
} from './configuration.mjs'
import {
  catalogResponse,
  ContractError,
  HARNESS_DIR,
  importTeamConfiguration,
  instantiateTeam,
  publishTeamDefinitionRequest,
  validateApiPayload,
  validateTeamDefinitionRequest,
} from './harness.mjs'

export const name = 'promax-team-harness-api'
export const inject = ['webServer', 'apiProxy', 'agents']

export const TEAM_API_PREFIX = '/promax-team-api/v1alpha2'
const OPERATIONS = new Set(['catalog', 'configure', 'instantiate', 'import', 'validate', 'publish'])
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024

class HttpError extends Error {
  constructor(status, code, message, hint) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.hint = hint
  }
}

function requiredPositiveInteger(value, fallback, field) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${field} 必须是正整数`)
  }
  return resolved
}

function resolvedConfig(config = {}) {
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const contentRoot = resolve(config.contentRoot ?? HARNESS_DIR)
  const skillSourceRoot = resolve(config.skillSourceRoot ?? resolve(contentRoot, '..'))
  return {
    maxRequestBytes: requiredPositiveInteger(config.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, 'maxRequestBytes'),
    presetRoot: resolve(config.presetRoot ?? join(dshHome, '.agent-presets')),
    stateRoot: resolve(config.stateRoot ?? join(dshHome, '.promax', 'configuration-sessions')),
    configurationCwd: resolve(config.configurationCwd ?? join(dshHome, '.promax', 'configuration-workspace')),
    catalogOptions: {
      modulesDir: resolve(contentRoot, 'modules'),
      recipesDir: resolve(contentRoot, 'recipes'),
      skillCatalogFile: resolve(contentRoot, 'catalogs/skills.yml'),
      toolProfilesFile: resolve(contentRoot, 'catalogs/tool-profiles.yml'),
      skillSourceRoot,
    },
  }
}

function rpcValue(response, label) {
  if (response?.result?.ok === true) return response.result.value
  const error = response?.result?.error
  throw new HttpError(503, 'DSH_CONFIGURATION_UNAVAILABLE', `${label}失败：${sanitizeText(error?.message ?? 'dsh 未返回可用结果')}。`)
}

function rpcRequest(payload) {
  return { rpcId: `promax-${randomUUID()}`, payload }
}

function latestAssistantText(history) {
  const events = history?.events ?? []
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]?.event
    if (event?.type !== 'assistant/message') continue
    const content = event?.data?.message?.content
    if (!Array.isArray(content)) continue
    const text = content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text.trim())
      .filter(Boolean)
      .join('\n')
    if (text) return text
  }
  return ''
}

async function configureTeamConversation(request, resolved, runtime) {
  if (!runtime?.apiProxy || !runtime?.agents) {
    throw new HttpError(503, 'DSH_CONFIGURATION_UNAVAILABLE', '当前 profile 没有挂载团队配置会话所需的 dsh 服务。')
  }
  mkdirSync(resolved.configurationCwd, { recursive: true })
  let sessionId = request.configuration_session_id
  if (sessionId === null) {
    sessionId = `promax-config-${randomUUID()}`
    createConfigurationState({
      stateRoot: resolved.stateRoot,
      configurationSessionId: sessionId,
      teamId: request.team_id,
      displayName: request.display_name,
      description: request.description,
      workspaceRef: request.workspace_ref,
    })
  } else {
    const existing = readConfigurationState(resolved.stateRoot, sessionId)
    if (existing.team_id !== request.team_id) {
      throw new ContractError('配置会话与团队不匹配', [{
        code: 'CONFIGURATION_TEAM_MISMATCH',
        severity: 'error',
        field_path: '/team_id',
        message: '当前配置会话已绑定另一个团队。',
      }])
    }
    if (existing.status !== 'collecting') return configurationResponse(existing, '该团队已经配置完成，可以开始聊天。')
  }

  let packageInspection
  if (request.agents_package) {
    packageInspection = inspectAgentsPackage(request.agents_package, resolved.catalogOptions)
    mergeConfigurationIntake(resolved.stateRoot, sessionId, packageInspection)
  }
  const content = configurationTurnMessage({ message: request.message, packageInspection })
  const created = await runtime.apiProxy.sessions.create(rpcRequest({
    sessionId,
    cwd: resolved.configurationCwd,
    agentPreset: CONFIGURATOR_PRESET_ID,
  }))
  rpcValue(created, '创建团队配置会话')
  const prompted = await runtime.apiProxy.sessions.prompt(rpcRequest({
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: content }],
  }))
  rpcValue(prompted, '发送团队配置消息')
  const agent = runtime.agents.get(sessionId)
  if (!agent) throw new HttpError(503, 'DSH_CONFIGURATION_UNAVAILABLE', '配置 Agent 没有成功附着到会话。')
  await agent.whenIdle()
  const historyResponse = await runtime.apiProxy.sessions.history(rpcRequest({ sessionId, maxMessages: 4 }))
  const history = rpcValue(historyResponse, '读取团队配置结果')
  const state = readConfigurationState(resolved.stateRoot, sessionId)
  return configurationResponse(state, latestAssistantText(history))
}

function header(request, name) {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function assertSameOrigin(request) {
  const origin = header(request, 'origin')
  const host = header(request, 'host')
  if (origin === undefined) {
    if (!isLoopback(request.socket.remoteAddress)) {
      throw new HttpError(403, 'ORIGIN_REQUIRED', '非本机请求必须提供同源 Origin。')
    }
    return
  }
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    throw new HttpError(403, 'ORIGIN_INVALID', 'Origin 格式无效。')
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || host === undefined || parsed.host !== host) {
    throw new HttpError(403, 'ORIGIN_FORBIDDEN', '只接受 Promax 当前页面发起的同源请求。')
  }
}

async function readJson(request, maxRequestBytes) {
  const contentType = header(request, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'CONTENT_TYPE_REQUIRED', '请求必须使用 application/json。')
  }
  const declaredLength = Number(header(request, 'content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    throw new HttpError(413, 'REQUEST_TOO_LARGE', `请求体不能超过 ${maxRequestBytes} bytes。`)
  }
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.byteLength
    if (bytes > maxRequestBytes) throw new HttpError(413, 'REQUEST_TOO_LARGE', `请求体不能超过 ${maxRequestBytes} bytes。`)
    chunks.push(chunk)
  }
  let value
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'JSON_INVALID', '请求体不是有效 JSON。')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'JSON_OBJECT_REQUIRED', '请求体必须是 JSON 对象。')
  }
  return value
}

function sanitizeText(value) {
  if (typeof value !== 'string') return String(value ?? '')
  return value
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/gu, '[local-path]')
    .replace(/\/(?:Users|home|var|private|tmp)\/(?:[^/\s]+\/)+[^\s,;)]*/gu, '[local-path]')
}

function errorDetails(error) {
  if (error instanceof ContractError && error.details.length > 0) {
    return error.details.map(detail => ({
      code: String(detail.code || 'CONTRACT_ERROR'),
      severity: 'error',
      field_path: typeof detail.field_path === 'string' ? detail.field_path : '/',
      message: sanitizeText(detail.message),
      ...(detail.hint === undefined ? {} : { hint: sanitizeText(detail.hint) }),
    }))
  }
  if (error instanceof HttpError) {
    return [{
      code: error.code,
      severity: 'error',
      field_path: '/',
      message: error.message,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
    }]
  }
  return [{ code: 'INTERNAL_ERROR', severity: 'error', field_path: '/', message: 'Agent Harness 内部错误。' }]
}

function writeJson(response, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
  })
  response.end(body)
}

function operationFrom(request) {
  const pathname = new URL(request.url ?? '/', 'http://promax.local').pathname
  const prefix = `${TEAM_API_PREFIX}/`
  if (!pathname.startsWith(prefix)) return undefined
  const operation = pathname.slice(prefix.length)
  return OPERATIONS.has(operation) ? operation : undefined
}

function statusFor(error) {
  if (error instanceof HttpError) return error.status
  if (error instanceof ContractError && error.details.some(detail => detail.code === 'REVISION_IMMUTABLE')) return 409
  if (error instanceof ContractError) return 400
  return 500
}

export function createPromaxTeamApiHandler(config = {}, runtime = {}) {
  const resolved = resolvedConfig(config)
  return async function promaxTeamApiHandler(request, response) {
    const operation = operationFrom(request)
    if (operation === undefined) {
      writeJson(response, 404, { error: 'not-found' })
      return
    }
    let payload
    try {
      if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '只接受 POST 请求。')
      assertSameOrigin(request)
      payload = await readJson(request, resolved.maxRequestBytes)
      let result
      if (operation === 'catalog') {
        validateApiPayload(payload, 'catalog')
        result = catalogResponse(resolved.catalogOptions)
      } else if (operation === 'configure') {
        validateApiPayload(payload, 'configure')
        result = await configureTeamConversation(payload, resolved, runtime)
      } else if (operation === 'instantiate') {
        result = instantiateTeam(payload, {
          outputDir: resolved.presetRoot,
          ...resolved.catalogOptions,
        })
      } else if (operation === 'import') {
        result = importTeamConfiguration(payload, resolved.catalogOptions)
      } else if (operation === 'validate') {
        result = validateTeamDefinitionRequest(payload, resolved.catalogOptions)
      } else {
        result = publishTeamDefinitionRequest(payload, {
          outputDir: resolved.presetRoot,
          ...resolved.catalogOptions,
        })
      }
      validateApiPayload(result, operation)
      writeJson(response, 200, result)
    } catch (error) {
      const body = {
        api_version: 'promax.ai/v1alpha2',
        kind: 'ErrorResponse',
        operation,
        ...(typeof payload?.request_id === 'string' ? { request_id: payload.request_id } : {}),
        errors: errorDetails(error),
      }
      validateApiPayload(body, operation)
      writeJson(response, statusFor(error), body)
    }
  }
}

export function apply(ctx, config = {}) {
  const handler = createPromaxTeamApiHandler(config, { apiProxy: ctx.apiProxy, agents: ctx.agents })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: TEAM_API_PREFIX,
    handler,
  }), 'promax-team-harness-api')
}
