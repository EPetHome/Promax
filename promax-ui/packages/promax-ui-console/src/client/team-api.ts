import type {
  TeamConfigurationSource,
  TeamMember,
  TeamProvisioningResult,
} from './team-state.ts'

const API_VERSION = 'promax.ai/v1alpha2'
const API_PREFIX = '/promax-team-api/v1alpha2'
const ALLOWED_DOCUMENT_NAMES = new Set(['AGENTS.md', 'SOUL.md', 'SKILL.md'])

export interface TeamRecipeSummary {
  recipeRef: string
  displayName: string
  description: string
  workerCount: number
}

export interface TeamSourceDocument {
  name: string
  relativePath?: string
  bytes: number
  content: string
}

export interface InstantiateTeamInput {
  teamId: string
  teamName: string
  teamDescription?: string
  workspaceRef: string
  source: TeamConfigurationSource
  documents: TeamSourceDocument[]
}

class PromaxTeamApiError extends Error {
  constructor(message: string, readonly code = 'TEAM_CONFIGURATION_FAILED') {
    super(message)
    this.name = 'PromaxTeamApiError'
  }
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} 返回格式无效`)
  return value as Record<string, unknown>
}

function textOf(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 缺失`)
  return value
}

function apiErrorMessage(value: Record<string, unknown>, operation: string, status: number): string {
  if (typeof value.user_message === 'string' && value.user_message.trim() !== '') return value.user_message.trim()
  if (status === 413) return 'Agents 包过大，请精简后重试'
  if (operation === 'catalog') return '暂时无法读取团队配置能力，请稍后重试'
  if (operation === 'publish') return '团队配置已经生成，但暂时无法启用，请重试'
  return '团队配置没有完成，请调整描述或上传内容后重试'
}

async function post(operation: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_PREFIX}/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let payload: Record<string, unknown>
  try {
    payload = recordOf(await response.json(), `Agent ${operation}`)
  } catch (reason) {
    if (response.status === 404 || response.status === 405) {
      throw new PromaxTeamApiError('当前 Promax 尚未启用团队配置服务', 'TEAM_SERVICE_UNAVAILABLE')
    }
    throw new PromaxTeamApiError('团队服务暂时没有返回有效结果，请重试', 'TEAM_RESPONSE_INVALID')
  }
  if (!response.ok || payload.kind === 'ErrorResponse') {
    throw new PromaxTeamApiError(apiErrorMessage(payload, operation, response.status), typeof payload.code === 'string' ? payload.code : undefined)
  }
  return payload
}

function randomId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 16)
    ?? Math.random().toString(36).slice(2, 18).padEnd(8, '0')
  return `${prefix}_${random.toLowerCase()}`
}

async function sha256(content: string): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) throw new Error('当前浏览器不支持配置文档哈希校验')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function apiDocuments(documents: TeamSourceDocument[]): Promise<Array<Record<string, unknown>>> {
  return Promise.all(documents.map(async document => {
    if (!ALLOWED_DOCUMENT_NAMES.has(document.name)) {
      throw new Error(`${document.name} 不受支持；配置文档只能命名为 AGENTS.md、SOUL.md 或 SKILL.md`)
    }
    if (document.bytes > 1024 * 1024) throw new Error(`${document.name} 超过 1 MiB`)
    const digest = await sha256(document.content)
    return {
      document_id: `doc_${digest.slice(0, 16)}`,
      filename: document.name,
      media_type: 'text/markdown',
      content: document.content,
      sha256: digest,
    }
  }))
}

function memberOf(value: unknown, role: TeamMember['role']): TeamMember {
  const row = recordOf(value, role === 'coordinator' ? '协调者' : '成员')
  const memberId = textOf(row.member_id, 'member_id')
  const displayName = textOf(row.display_name, 'display_name')
  const moduleRef = textOf(row.module_ref, 'module_ref')
  const instructions = typeof row.role_instructions === 'string' ? row.role_instructions : undefined
  return {
    memberId,
    displayName,
    objective: role === 'coordinator' ? '拆解任务、协调成员并完成终审。' : '按团队职责完成分派任务。',
    role,
    enabled: role === 'coordinator' || row.enabled !== false,
    moduleRef,
    ...(instructions === undefined ? {} : { instructions }),
  }
}

function projectionMemberOf(value: unknown, role: TeamMember['role']): TeamMember {
  const row = recordOf(value, role === 'coordinator' ? '团队负责人' : '团队成员')
  const capabilities = Array.isArray(row.capabilities)
    ? row.capabilities.filter((capability): capability is string => typeof capability === 'string' && capability !== '')
    : []
  return {
    memberId: textOf(row.member_id, 'member_id'),
    displayName: textOf(row.display_name, 'display_name'),
    objective: role === 'coordinator'
      ? '理解目标、协调成员并完成终审。'
      : capabilities.length > 0 ? `负责：${capabilities.join('、')}` : '完成团队负责人分派的专业任务。',
    role,
    enabled: true,
  }
}

function resultFromDefinition(
  definitionValue: unknown,
  revisionValue: unknown,
  presetValue: unknown,
  state: 'ready' | 'review',
  message?: string,
): TeamProvisioningResult {
  const definition = recordOf(definitionValue, 'TeamDefinition')
  const metadata = recordOf(definition.metadata, 'TeamDefinition.metadata')
  const spec = recordOf(definition.spec, 'TeamDefinition.spec')
  if (!Array.isArray(spec.members)) throw new Error('TeamDefinition.spec.members 缺失')
  const revisionRow = revisionValue === null || revisionValue === undefined ? undefined : recordOf(revisionValue, 'TeamRevision')
  const revisionMetadata = revisionRow === undefined ? undefined : recordOf(revisionRow.metadata, 'TeamRevision.metadata')
  const presetId = typeof presetValue === 'string' && presetValue !== '' ? presetValue : undefined
  const revision = typeof revisionMetadata?.revision === 'number' && presetId !== undefined
    ? { revision: revisionMetadata.revision, presetId, status: 'published' as const }
    : undefined
  const description = typeof metadata.description === 'string' ? metadata.description : undefined
  return {
    coordinator: memberOf(spec.coordinator, 'coordinator'),
    members: spec.members.map(member => memberOf(member, 'worker')),
    state,
    ...(description === undefined ? {} : { description }),
    ...(message === undefined ? {} : { message }),
    ...(revision === undefined ? { pendingDefinition: definition } : { revision }),
  }
}

export async function loadPromaxTeamRecipes(): Promise<TeamRecipeSummary[]> {
  const response = await post('catalog', { api_version: API_VERSION, kind: 'CatalogRequest' })
  if (!Array.isArray(response.prompt_recipes)) throw new Error('Agent catalog 未返回团队模板')
  return response.prompt_recipes.map(value => {
    const recipe = recordOf(value, 'PromptRecipe')
    return {
      recipeRef: textOf(recipe.recipe_ref, 'recipe_ref'),
      displayName: textOf(recipe.display_name, 'display_name'),
      description: textOf(recipe.description, 'description'),
      workerCount: typeof recipe.worker_count === 'number' ? recipe.worker_count : 0,
    }
  })
}

export async function instantiatePromaxTeam(input: InstantiateTeamInput): Promise<TeamProvisioningResult> {
  const documents = await apiDocuments(input.documents)
  const source = input.source.kind === 'template'
    ? { type: 'recipe', recipe_ref: input.source.recipeRef }
    : input.source.kind === 'prompt'
      ? { type: 'prompt', prompt: input.source.prompt }
      : input.source.kind === 'documents'
        ? { type: 'documents', documents }
        : undefined
  if (source === undefined) throw new Error('兼容团队不能通过动态接口重新实例化')
  const response = await post('instantiate', {
    api_version: API_VERSION,
    kind: 'InstantiateRequest',
    team_id: input.teamId,
    display_name: input.teamName,
    description: `${input.teamName}的动态协作团队。`,
    workspace_ref: input.workspaceRef,
    revision: 1,
    source,
  })
  const status = textOf(response.status, 'instantiate.status')
  if (status === 'published') {
    return resultFromDefinition(response.team_definition, response.team_revision, response.preset_id, 'ready')
  }
  if (status === 'review-required') {
    return resultFromDefinition(
      response.team_definition,
      response.team_revision,
      response.preset_id,
      'review',
      '配置文档已生成团队草稿；确认后才会冻结运行配置。',
    )
  }
  throw new PromaxTeamApiError('Agent 没能生成可用团队，请补充团队目标后重试', 'TEAM_VALIDATION_FAILED')
}

async function agentsPackageOf(documents: TeamSourceDocument[]): Promise<Record<string, unknown>> {
  if (documents.length === 0) throw new PromaxTeamApiError('Agents 包中没有可解析的配置文件', 'AGENTS_PACKAGE_EMPTY')
  if (documents.length > 32) throw new PromaxTeamApiError('Agents 包最多包含 32 份配置文件', 'AGENTS_PACKAGE_TOO_MANY_FILES')
  const files = await Promise.all(documents.map(async document => {
    if (document.bytes > 262_144) throw new PromaxTeamApiError(`${document.name} 超过 256 KiB，请精简后重试`, 'AGENTS_PACKAGE_FILE_TOO_LARGE')
    const relativePath = document.relativePath?.trim() || document.name
    if (relativePath.startsWith('/') || relativePath.includes('\\') || relativePath.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
      throw new PromaxTeamApiError(`${document.name} 的包内路径无效`, 'AGENTS_PACKAGE_PATH_INVALID')
    }
    return {
      relative_path: relativePath,
      media_type: 'text/markdown',
      content: document.content,
      sha256: await sha256(document.content),
    }
  }))
  const normalized = files
    .map(file => ({ relative_path: file.relative_path, media_type: file.media_type, sha256: file.sha256 }))
    .sort((left, right) => left.relative_path.localeCompare(right.relative_path))
  const packageDigest = await sha256(JSON.stringify(normalized))
  return {
    package_id: `pkg_${packageDigest.slice(0, 16)}`,
    package_sha256: packageDigest,
    files,
  }
}

export async function configurePromaxTeam(input: InstantiateTeamInput & { configurationSessionId?: string | null }): Promise<TeamProvisioningResult> {
  const body: Record<string, unknown> = {
    team_id: input.teamId,
    display_name: input.teamName,
    workspace_ref: input.workspaceRef,
    configuration_session_id: input.configurationSessionId ?? null,
  }
  if (input.teamDescription?.trim()) body.description = input.teamDescription.trim()
  if (input.source.kind === 'prompt') body.message = input.source.prompt
  else if (input.source.kind === 'documents') body.agents_package = await agentsPackageOf(input.documents)
  else if (input.source.kind === 'template') body.message = `请按“${input.source.label}”组建团队。`
  else throw new PromaxTeamApiError('兼容团队不能重新配置', 'TEAM_COMPAT_IMMUTABLE')
  const response = await post('configure', body)
  const status = textOf(response.status, 'configure.status')
  const configurationSessionId = textOf(response.configuration_session_id, 'configuration_session_id')
  const assistantMessage = typeof response.assistant_message === 'string' && response.assistant_message.trim() !== ''
    ? response.assistant_message.trim()
    : '请继续描述团队需要哪些角色和分工。'
  if (status === 'collecting') {
    return { state: 'collecting', configurationSessionId, message: assistantMessage }
  }
  if (status !== 'configured' && status !== 'configured-with-warnings') {
    throw new PromaxTeamApiError('团队配置服务返回了未知状态，请重试', 'TEAM_CONFIGURATION_STATE_INVALID')
  }
  const team = recordOf(response.team, 'configure.team')
  const runtime = recordOf(response.runtime_binding, 'configure.runtime_binding')
  const workers = Array.isArray(team.workers) ? team.workers : []
  const description = typeof team.description === 'string' ? team.description : undefined
  const revision = runtime.revision
  if (typeof revision !== 'number' || revision < 1) throw new PromaxTeamApiError('团队运行配置不完整，请重试', 'TEAM_RUNTIME_BINDING_INVALID')
  return {
    state: 'ready',
    configurationSessionId,
    coordinator: projectionMemberOf(team.coordinator, 'coordinator'),
    members: workers.map(worker => projectionMemberOf(worker, 'worker')),
    ...(description === undefined ? {} : { description }),
    revision: {
      revision,
      presetId: textOf(runtime.preset_id, 'preset_id'),
      status: 'published',
    },
    message: assistantMessage,
  }
}

export async function publishPromaxTeamDraft(definition: Record<string, unknown>): Promise<TeamProvisioningResult> {
  const response = await post('publish', {
    api_version: API_VERSION,
    kind: 'PublishRequest',
    request_id: randomId('pub'),
    revision: 1,
    team_definition: definition,
  })
  return resultFromDefinition(definition, response.team_revision, response.preset_id, 'ready')
}

export function routedTeamPrompt(text: string, targetMemberIds: readonly string[]): string {
  const trimmed = text.trim()
  if (targetMemberIds.length === 0) return trimmed
  return `${targetMemberIds.map(memberId => `@${memberId}`).join(' ')} ${trimmed}`
}

export function friendlyTeamError(reason: unknown): string {
  if (reason instanceof PromaxTeamApiError) return reason.message
  if (reason instanceof Error && /不受支持|超过 (?:1 MiB|256 KiB)|工作区|尚未启用|还不能自动启用/u.test(reason.message)) return reason.message
  return '团队配置没有完成，请重试；如果仍然失败，请让管理员查看诊断记录'
}
