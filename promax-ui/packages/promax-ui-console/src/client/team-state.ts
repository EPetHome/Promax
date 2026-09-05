import { useSyncExternalStore } from 'react'

import { INFORMATION_KEYS, type InformationKey } from './task-state.ts'
import { taskAttachmentContextOf, type TaskAttachmentContext } from './task-attachments.ts'

export const PRODUCT_TEAM_ID = 'product-team'
export const PRODUCT_TEAM_DEFINITION_ID = 'promax-product-team'
export const GENERAL_PRESET_ID = 'general'
export const PRODUCT_PRESET_ID = 'promax-team'
export const PRODUCT_TEAM_REVISION = 1

const SESSION_SCOPE_MAX_LENGTH = 40
const RESERVED_SESSION_SCOPE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu

export function validSessionScopeName(value: string): boolean {
  return value === value.normalize('NFC')
    && value === value.trim()
    && Array.from(value).length >= 1
    && Array.from(value).length <= SESSION_SCOPE_MAX_LENGTH
    && value !== '.'
    && value !== '..'
    && !RESERVED_SESSION_SCOPE.test(value)
    && !/[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(value)
    && !/[. ]$/u.test(value)
}

export type TeamRevisionNumber = number | 'compat'
export type TeamStatus = 'draft' | 'published'
export type TeamProvisioningState = 'draft' | 'configuring' | 'review' | 'ready' | 'blocked'
export type TeamConfigurationSource =
  | { kind: 'template'; recipeRef: string; label: string }
  | { kind: 'prompt'; prompt: string }
  | { kind: 'documents'; files: Array<{ name: string; bytes: number }> }
  | { kind: 'compat'; label: string }
export type TeamPromptRecipeId = 'custom' | 'research' | 'content' | 'review' | 'imported' | 'product-compat'

export interface TeamMember {
  memberId: string
  displayName: string
  objective: string
  role: 'coordinator' | 'worker'
  enabled: boolean
  moduleRef?: string
  instructions?: string
  provides: InformationKey[]
  requires: InformationKey[]
}

export interface TeamArtifactDefinition {
  relativePath: string
  producedBy: string
  required?: boolean
}

export interface RuntimeTeamRoster {
  presetId: string
  revision: number
  members: TeamMember[]
  artifacts: TeamArtifactDefinition[]
}

export interface TeamPromptDraft {
  recipeId: TeamPromptRecipeId
  teamInstructions: string
  coordinatorInstructions: string
  importedSources: Array<{
    name: string
    kind: 'agents' | 'soul'
    bytes: number
    importedAt: string
  }>
}

export interface TeamRevisionRef {
  revision: TeamRevisionNumber
  presetId: string
  status: 'published'
}

export interface PromaxTeam {
  id: string
  name: string
  description: string
  status: TeamStatus
  coordinator: TeamMember
  members: TeamMember[]
  artifacts: TeamArtifactDefinition[]
  workspaceIds: string[]
  configurationSource: TeamConfigurationSource
  provisioning: { state: TeamProvisioningState; message?: string }
  promptDraft: TeamPromptDraft
  configurationSessionId?: string
  activeRevision?: TeamRevisionRef
  pendingDefinition?: Record<string, unknown>
}

export interface TeamSessionBinding {
  sessionId: string
  teamId: string
  revision: TeamRevisionNumber
  presetId: string
  workspaceId?: string
  sessionName?: string
  taskKey?: string
  dispatchPlanId?: string
  dispatchState?: 'planning' | 'confirmed' | 'running'
  dispatchDemand?: string
  dispatchAttachmentPaths?: string[]
  dispatchAttachmentContexts?: TaskAttachmentContext[]
  confirmedMemberIds?: string[]
  runState?: 'running' | 'stop_requested' | 'draining' | 'cancelled' | 'completed' | 'failed'
  runEpoch?: number
  runStateUpdatedAt?: string
}

export type PromaxContext =
  | { kind: 'general'; workspaceId?: string }
  | { kind: 'team'; teamId: string; view: 'home' | 'session'; sessionId?: string; workspaceId?: string }

export interface PromaxTeamState {
  version: 2
  selected: PromaxContext
  teams: PromaxTeam[]
  sessionBindings: TeamSessionBinding[]
}

const PRODUCT_TEAM: PromaxTeam = {
  id: PRODUCT_TEAM_ID,
  name: '产品智能体团队',
  description: '产品方案、流程与原型的专用 Agent 团队。',
  status: 'published',
  coordinator: {
    memberId: 'team_lead',
    displayName: '主智能体',
    objective: '理解需求、路由成员、等待结算并完成终审。',
    role: 'coordinator',
    enabled: true,
    moduleRef: 'team-coordinator@1',
    provides: [],
    requires: [],
  },
  members: [],
  artifacts: [],
  workspaceIds: [],
  configurationSource: { kind: 'compat', label: 'promax-team 固定运行配置' },
  provisioning: { state: 'ready' },
  promptDraft: {
    recipeId: 'product-compat',
    teamInstructions: '成员名单与信息契约由运行时已发布 preset 同步，GUI 不另存一份静态 roster。',
    coordinatorInstructions: '固定团队配置保持只读，不由 GUI 覆盖已发布 persona。',
    importedSources: [],
  },
  activeRevision: { revision: PRODUCT_TEAM_REVISION, presetId: PRODUCT_PRESET_ID, status: 'published' },
}

const DEFAULT_STATE: PromaxTeamState = {
  version: 2,
  selected: { kind: 'general' },
  teams: [PRODUCT_TEAM],
  sessionBindings: [],
}

const STORAGE_KEY = 'promax.teams.v2'
const LEGACY_STORAGE_KEY = 'promax.teams.v1'
const CHANGE_EVENT = 'promax:team-state-change'

let cachedRaw: string | null | undefined
let cachedState: PromaxTeamState = DEFAULT_STATE

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Read the deterministic "已发布团队快照" block emitted by team-harness.
 * The browser obtains this text through dsh's agentPreset.read API, so the
 * member list follows the installed preset instead of a GUI-owned duplicate.
 */
export function runtimeTeamRosterOf(content: string, expectedPresetId = PRODUCT_PRESET_ID): RuntimeTeamRoster {
  const snapshot = content.match(/## 已发布团队快照[\s\S]*?- team revision：`[^`]+@r(\d+)`[\s\S]*?- preset：`([^`]+)`[\s\S]*?\n\s*成员：\s*\n([\s\S]*?)\n\s*## 稳定消息路由/u)
  if (snapshot === null) throw new Error('固定 preset 未包含可读取的已发布团队快照')
  const revision = Number(snapshot[1])
  const presetId = snapshot[2]
  if (!Number.isSafeInteger(revision) || revision < 1 || presetId !== expectedPresetId) {
    throw new Error('固定 preset 的团队版本或 preset id 不匹配')
  }
  const rows = snapshot[3] ?? ''
  const informationContracts = content.match(/\n\s*信息契约：\s*\n([\s\S]*?)(?:\n\s*产物契约：|\n\s*##\s|$)/u)?.[1] ?? ''
  const informationByMember = new Map([...informationContracts.matchAll(/^\s*-\s+`([^`]+)`：provides=`([^`]*)`；requires=`([^`]*)`\s*$/gmu)].map(match => [
    match[1]!.trim(),
    { provides: informationKeysOf(match[2]), requires: informationKeysOf(match[3]) },
  ]))
  const members = [...rows.matchAll(/^\s*-\s+`([^`]+)`（([^）\n]+)）：(.+)$/gmu)].map(match => ({
    memberId: match[1]!.trim(),
    displayName: match[2]!.trim(),
    objective: match[3]!.trim(),
    role: 'worker' as const,
    enabled: true,
    provides: informationByMember.get(match[1]!.trim())?.provides ?? [],
    requires: informationByMember.get(match[1]!.trim())?.requires ?? [],
  }))
  if (members.length === 0 || new Set(members.map(member => member.memberId)).size !== members.length) {
    throw new Error('固定 preset 的成员名单为空或含重复 member_id')
  }
  const responsibilities = content.match(/\n\s*文件责任：\s*\n([\s\S]*?)(?:\n\s*稳定回执字段|\n\s*##\s|$)/u)?.[1] ?? ''
  const artifactContracts = content.match(/\n\s*产物契约：\s*\n([\s\S]*?)(?:\n\s*##\s|$)/u)?.[1] ?? ''
  const requiredByPath = new Map([...artifactContracts.matchAll(/^\s*-\s+`([^`]+)`：required=`(true|false)`\s*$/gmu)]
    .map(match => [match[1]!.trim(), match[2] === 'true']))
  const artifacts = [...responsibilities.matchAll(/^\s*-\s+`([^`]+)`：([a-z][a-z0-9_]*)\s*$/gmu)].map(match => ({
    relativePath: match[1]!.trim(),
    producedBy: match[2]!.trim(),
    required: requiredByPath.get(match[1]!.trim()) ?? false,
  }))
  return { presetId, revision, members, artifacts }
}

function informationKeysOf(value: string | undefined): InformationKey[] {
  if (value === undefined || value.trim() === '') return []
  const allowed = new Set<string>(INFORMATION_KEYS)
  const keys = value.split(',').map(item => item.trim())
  if (keys.some(key => !allowed.has(key)) || new Set(keys).size !== keys.length) throw new Error('固定 preset 的信息契约无效')
  return keys as InformationKey[]
}

function artifactOf(value: unknown): TeamArtifactDefinition | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const relativePath = nonEmpty(row.relativePath)
  const producedBy = nonEmpty(row.producedBy)
  const required = typeof row.required === 'boolean' ? row.required : undefined
  return relativePath === undefined || producedBy === undefined ? null : {
    relativePath,
    producedBy,
    ...(required === undefined ? {} : { required }),
  }
}

function memberOf(value: unknown, role: TeamMember['role']): TeamMember | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const memberId = nonEmpty(row.memberId)
  const displayName = nonEmpty(row.displayName)
  const objective = typeof row.objective === 'string' ? row.objective : ''
  if (memberId === undefined || displayName === undefined || row.role !== role || typeof row.enabled !== 'boolean') return null
  const moduleRef = nonEmpty(row.moduleRef)
  const instructions = typeof row.instructions === 'string' ? row.instructions : undefined
  const provides = Array.isArray(row.provides) ? informationKeysOf(row.provides.join(',')) : []
  const requires = Array.isArray(row.requires) ? informationKeysOf(row.requires.join(',')) : []
  return {
    memberId,
    displayName,
    objective,
    role,
    enabled: row.enabled,
    provides,
    requires,
    ...(moduleRef === undefined ? {} : { moduleRef }),
    ...(instructions === undefined ? {} : { instructions }),
  }
}

function promptDraftOf(value: unknown, fallback: TeamPromptDraft): TeamPromptDraft {
  if (typeof value !== 'object' || value === null) return fallback
  const row = value as Record<string, unknown>
  const recipeId = row.recipeId
  const allowedRecipes: readonly TeamPromptRecipeId[] = ['custom', 'research', 'content', 'review', 'imported', 'product-compat']
  if (!allowedRecipes.includes(recipeId as TeamPromptRecipeId)) return fallback
  const importedSources = Array.isArray(row.importedSources)
    ? row.importedSources.flatMap(source => {
      if (typeof source !== 'object' || source === null) return []
      const item = source as Record<string, unknown>
      const name = nonEmpty(item.name)
      if (
        name === undefined || (item.kind !== 'agents' && item.kind !== 'soul')
        || typeof item.bytes !== 'number' || item.bytes < 0 || typeof item.importedAt !== 'string'
      ) return []
      return [{ name, kind: item.kind as 'agents' | 'soul', bytes: item.bytes, importedAt: item.importedAt }]
    })
    : []
  return {
    recipeId: recipeId as TeamPromptRecipeId,
    teamInstructions: typeof row.teamInstructions === 'string' ? row.teamInstructions : '',
    coordinatorInstructions: typeof row.coordinatorInstructions === 'string' ? row.coordinatorInstructions : '',
    importedSources,
  }
}

function revisionOf(value: unknown): TeamRevisionRef | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  const presetId = nonEmpty(row.presetId)
  const revision = row.revision
  if (presetId === undefined || row.status !== 'published' || (revision !== 'compat' && !(typeof revision === 'number' && revision > 0))) {
    return undefined
  }
  return { revision, presetId, status: 'published' }
}

function teamOf(value: unknown): PromaxTeam | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const id = nonEmpty(row.id)
  const name = nonEmpty(row.name)
  const coordinator = memberOf(row.coordinator, 'coordinator')
  const members = Array.isArray(row.members)
    ? row.members.map(member => memberOf(member, 'worker')).filter((member): member is TeamMember => member !== null)
    : []
  const artifacts = Array.isArray(row.artifacts)
    ? row.artifacts.map(artifactOf).filter((artifact): artifact is TeamArtifactDefinition => artifact !== null)
    : []
  if (
    id === undefined || name === undefined || coordinator === null
    || (row.status !== 'draft' && row.status !== 'published')
    || !Array.isArray(row.workspaceIds)
    || !row.workspaceIds.every(item => nonEmpty(item) !== undefined)
  ) return null
  const activeRevision = revisionOf(row.activeRevision)
  if (row.status === 'published' && activeRevision === undefined) return null
  const pendingDefinition = typeof row.pendingDefinition === 'object' && row.pendingDefinition !== null && !Array.isArray(row.pendingDefinition)
    ? row.pendingDefinition as Record<string, unknown>
    : undefined
  const configurationSessionId = nonEmpty(row.configurationSessionId)
  return {
    id,
    name,
    description: typeof row.description === 'string' ? row.description : '',
    status: row.status,
    coordinator,
    members,
    artifacts,
    workspaceIds: [...new Set(row.workspaceIds as string[])],
    configurationSource: configurationSourceOf(row.configurationSource, id),
    provisioning: provisioningOf(row.provisioning, activeRevision),
    promptDraft: promptDraftOf(row.promptDraft, {
      recipeId: id === PRODUCT_TEAM_ID ? 'product-compat' : 'custom',
      teamInstructions: '',
      coordinatorInstructions: '',
      importedSources: [],
    }),
    ...(configurationSessionId === undefined ? {} : { configurationSessionId }),
    ...(activeRevision === undefined ? {} : { activeRevision }),
    ...(pendingDefinition === undefined ? {} : { pendingDefinition }),
  }
}

function configurationSourceOf(value: unknown, teamId: string): TeamConfigurationSource {
  if (teamId === PRODUCT_TEAM_ID) return { kind: 'compat', label: '产品团队兼容配置' }
  if (typeof value !== 'object' || value === null) return { kind: 'prompt', prompt: '' }
  const row = value as Record<string, unknown>
  if (row.kind === 'template' && nonEmpty(row.recipeRef) !== undefined && nonEmpty(row.label) !== undefined) {
    return { kind: 'template', recipeRef: nonEmpty(row.recipeRef)!, label: nonEmpty(row.label)! }
  }
  if (row.kind === 'prompt' && typeof row.prompt === 'string') return { kind: 'prompt', prompt: row.prompt }
  if (row.kind === 'documents' && Array.isArray(row.files)) {
    const files = row.files.flatMap(file => {
      if (typeof file !== 'object' || file === null) return []
      const item = file as Record<string, unknown>
      const name = nonEmpty(item.name)
      return name !== undefined && typeof item.bytes === 'number' && item.bytes >= 0 ? [{ name, bytes: item.bytes }] : []
    })
    return { kind: 'documents', files }
  }
  return { kind: 'prompt', prompt: '' }
}

function provisioningOf(value: unknown, revision: TeamRevisionRef | undefined): PromaxTeam['provisioning'] {
  if (revision !== undefined) return { state: 'ready' }
  if (typeof value !== 'object' || value === null) return { state: 'draft' }
  const row = value as Record<string, unknown>
  if (!['draft', 'configuring', 'review', 'ready', 'blocked'].includes(String(row.state))) return { state: 'draft' }
  const message = nonEmpty(row.message)
  return { state: row.state as TeamProvisioningState, ...(message === undefined ? {} : { message }) }
}

function contextOf(value: unknown, teams: readonly PromaxTeam[]): PromaxContext {
  if (typeof value !== 'object' || value === null) return { kind: 'general' }
  const row = value as Record<string, unknown>
  const workspaceId = nonEmpty(row.workspaceId)
  if (row.kind === 'general') return { kind: 'general', ...(workspaceId === undefined ? {} : { workspaceId }) }
  const teamId = nonEmpty(row.teamId)
  if (row.kind !== 'team' || teamId === undefined || !teams.some(team => team.id === teamId)) return { kind: 'general' }
  const view = row.view === 'session' ? 'session' : 'home'
  const sessionId = view === 'session' ? nonEmpty(row.sessionId) : undefined
  return {
    kind: 'team',
    teamId,
    view,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
  }
}

function bindingOf(value: unknown, teams: readonly PromaxTeam[]): TeamSessionBinding | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const sessionId = nonEmpty(row.sessionId)
  const teamId = nonEmpty(row.teamId)
  const presetId = nonEmpty(row.presetId)
  const workspaceId = nonEmpty(row.workspaceId)
  const sessionName = nonEmpty(row.sessionName)
  const taskKey = nonEmpty(row.taskKey)
  const revision = row.revision
  if (
    sessionId === undefined || teamId === undefined || presetId === undefined
    || !teams.some(team => team.id === teamId)
    || (revision !== 'compat' && !(typeof revision === 'number' && revision > 0))
  ) return null
  const scope = sessionName !== undefined && taskKey === sessionName && validSessionScopeName(sessionName)
    ? { sessionName, taskKey }
    : {}
  const dispatchPlanId = nonEmpty(row.dispatchPlanId)
  const dispatchState = row.dispatchState === 'planning' || row.dispatchState === 'confirmed' || row.dispatchState === 'running'
    ? row.dispatchState
    : undefined
  const dispatchDemand = nonEmpty(row.dispatchDemand)
  const rawDispatchAttachmentPaths = Array.isArray(row.dispatchAttachmentPaths) ? row.dispatchAttachmentPaths : undefined
  const dispatchAttachmentPaths = rawDispatchAttachmentPaths?.map(nonEmpty).filter((path): path is string => path !== undefined)
  const rawDispatchAttachmentContexts = Array.isArray(row.dispatchAttachmentContexts) ? row.dispatchAttachmentContexts : undefined
  const dispatchAttachmentContexts = rawDispatchAttachmentContexts?.map(taskAttachmentContextOf).filter((context): context is TaskAttachmentContext => context !== undefined)
  const rawConfirmedMemberIds = Array.isArray(row.confirmedMemberIds) ? row.confirmedMemberIds : undefined
  const confirmedMemberIds = rawConfirmedMemberIds?.map(nonEmpty).filter((memberId): memberId is string => memberId !== undefined)
  const team = teams.find(candidate => candidate.id === teamId)
  const allowedMemberIds = new Set(team?.members.map(member => member.memberId) ?? [])
  const completeDispatchState = scope.taskKey !== undefined
    && dispatchPlanId !== undefined
    && dispatchPlanId.length <= 128
    && dispatchState !== undefined
    && dispatchDemand !== undefined
    && dispatchAttachmentPaths !== undefined
    && dispatchAttachmentPaths.length === rawDispatchAttachmentPaths?.length
    && dispatchAttachmentPaths.every(path => !path.startsWith('/') && !path.includes('..') && !path.includes('\\'))
    && (dispatchState === 'planning'
      ? confirmedMemberIds === undefined
      : confirmedMemberIds !== undefined
        && confirmedMemberIds.length === rawConfirmedMemberIds?.length
        && confirmedMemberIds.length > 0
        && new Set(confirmedMemberIds).size === confirmedMemberIds.length
        && confirmedMemberIds.every(memberId => /^[a-z][a-z0-9_]{2,47}$/u.test(memberId))
        && (allowedMemberIds.size === 0 || confirmedMemberIds.every(memberId => allowedMemberIds.has(memberId))))
  const runState = row.runState === 'failed_to_stop'
    ? 'stop_requested'
    : row.runState === 'running' || row.runState === 'stop_requested' || row.runState === 'draining' || row.runState === 'cancelled' || row.runState === 'completed' || row.runState === 'failed' ? row.runState : undefined
  const runEpoch = typeof row.runEpoch === 'number' && Number.isSafeInteger(row.runEpoch) && row.runEpoch > 0 ? row.runEpoch : undefined
  const runStateUpdatedAt = nonEmpty(row.runStateUpdatedAt)
  return {
    sessionId,
    teamId,
    revision,
    presetId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...scope,
    ...(completeDispatchState ? {
      dispatchPlanId,
      dispatchState,
      dispatchDemand,
      dispatchAttachmentPaths,
      ...(dispatchAttachmentContexts !== undefined
        && dispatchAttachmentContexts.length === rawDispatchAttachmentContexts?.length
        && dispatchAttachmentContexts.every(context => dispatchAttachmentPaths?.includes(context.path))
        ? { dispatchAttachmentContexts }
        : {}),
      ...(confirmedMemberIds === undefined ? {} : { confirmedMemberIds }),
    } : {}),
    ...(runState === undefined ? {} : { runState, ...(runEpoch === undefined ? {} : { runEpoch }), ...(runStateUpdatedAt === undefined ? {} : { runStateUpdatedAt }) }),
  }
}

function parseV2(raw: string): PromaxTeamState | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null) return null
    const row = value as Record<string, unknown>
    if (row.version !== 2 || !Array.isArray(row.teams) || !Array.isArray(row.sessionBindings)) return null
    const storedProduct = row.teams.map(teamOf).find((team): team is PromaxTeam => team?.id === PRODUCT_TEAM_ID)
    const storedRuntimeProduct = storedProduct?.activeRevision?.presetId === PRODUCT_PRESET_ID
      ? storedProduct
      : undefined
    const teams = [{
      ...PRODUCT_TEAM,
      workspaceIds: storedProduct?.workspaceIds ?? [],
      members: storedRuntimeProduct?.members ?? [],
      artifacts: storedRuntimeProduct?.artifacts ?? [],
      activeRevision: storedRuntimeProduct?.activeRevision ?? PRODUCT_TEAM.activeRevision!,
    }]
    const bindings = row.sessionBindings
      .map(binding => bindingOf(binding, teams))
      .filter((binding): binding is TeamSessionBinding => binding !== null)
    return {
      version: 2,
      selected: contextOf(row.selected, teams),
      teams,
      sessionBindings: bindings,
    }
  } catch {
    return null
  }
}

function migrateLegacy(raw: string | null): PromaxTeamState {
  if (raw === null) return DEFAULT_STATE
  try {
    const value = JSON.parse(raw) as { teams?: unknown[]; selected?: unknown }
    const legacyTeams = Array.isArray(value.teams) ? value.teams : []
    const storedProduct = legacyTeams.find(item => typeof item === 'object' && item !== null && (item as Record<string, unknown>).id === PRODUCT_TEAM_ID)
    const workspaceIds = typeof storedProduct === 'object' && storedProduct !== null && Array.isArray((storedProduct as Record<string, unknown>).workspaceIds)
      ? ((storedProduct as Record<string, unknown>).workspaceIds as unknown[]).filter((workspaceId): workspaceId is string => nonEmpty(workspaceId) !== undefined)
      : []
    const migrated: PromaxTeam[] = [{ ...PRODUCT_TEAM, workspaceIds }]
    return { version: 2, selected: contextOf(value.selected, migrated), teams: migrated, sessionBindings: [] }
  } catch {
    return DEFAULT_STATE
  }
}

function draftTeam(
  id: string,
  name: string,
  workspaceIds: string[] = [],
  configurationSource: TeamConfigurationSource = { kind: 'prompt', prompt: '' },
  description = '',
): PromaxTeam {
  return {
    id,
    name,
    description,
    status: 'draft',
    coordinator: {
      memberId: `${id.replace(/[^a-z0-9_]/gu, '_').replace(/^([^a-z])/u, 't_$1').slice(0, 40)}_lead`,
      displayName: `${name}负责人`,
      objective: '拆解任务、路由成员、等待结算并执行终审。',
      role: 'coordinator',
      enabled: true,
      provides: [],
      requires: [],
    },
    members: [],
    artifacts: [],
    workspaceIds: [...new Set(workspaceIds)],
    configurationSource,
    provisioning: { state: 'draft' },
    promptDraft: {
      recipeId: 'custom',
      teamInstructions: '',
      coordinatorInstructions: '',
      importedSources: [],
    },
  }
}

export function readTeamState(): PromaxTeamState {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedState = raw === null
      ? migrateLegacy(window.localStorage.getItem(LEGACY_STORAGE_KEY))
      : parseV2(raw) ?? DEFAULT_STATE
  }
  return cachedState
}

export function writeTeamState(next: PromaxTeamState): void {
  const raw = JSON.stringify(next)
  window.localStorage.setItem(STORAGE_KEY, raw)
  cachedRaw = raw
  cachedState = next
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function updateTeamState(change: (current: PromaxTeamState) => PromaxTeamState): void {
  writeTeamState(change(readTeamState()))
}

export function syncProductTeamRuntimeRoster(roster: RuntimeTeamRoster): void {
  if (roster.presetId !== PRODUCT_PRESET_ID) throw new Error('不能把其他 preset 的 roster 同步到固定产品团队')
  updateTeamDefinition(PRODUCT_TEAM_ID, team => ({
    ...team,
    status: 'published',
    coordinator: PRODUCT_TEAM.coordinator,
    members: roster.members,
    artifacts: roster.artifacts,
    provisioning: { state: 'ready' },
    activeRevision: { revision: roster.revision, presetId: roster.presetId, status: 'published' },
  }))
}

export function subscribeTeamState(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== STORAGE_KEY) return
    cachedRaw = undefined
    listener()
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useTeamState(): PromaxTeamState {
  return useSyncExternalStore(subscribeTeamState, readTeamState, () => DEFAULT_STATE)
}

export function selectGeneralWorkspace(workspaceId?: string): void {
  updateTeamState(current => ({
    ...current,
    selected: { kind: 'general', ...(workspaceId === undefined ? {} : { workspaceId }) },
  }))
}

export function selectTeamHome(teamId: string, workspaceId?: string): void {
  updateTeamState(current => ({
    ...current,
    selected: { kind: 'team', teamId, view: 'home', ...(workspaceId === undefined ? {} : { workspaceId }) },
  }))
}

export function selectTeamSession(teamId: string, sessionId: string, workspaceId?: string): void {
  updateTeamState(current => ({
    ...current,
    selected: {
      kind: 'team', teamId, view: 'session', sessionId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    },
  }))
}

export interface CreateTeamInput {
  name: string
  description?: string
  configurationSource?: TeamConfigurationSource
}

export function createTeam(input: string | CreateTeamInput): PromaxTeam {
  const name = typeof input === 'string' ? input : input.name
  const description = typeof input === 'string' ? '' : input.description?.trim() ?? ''
  const configurationSource = typeof input === 'string'
    ? { kind: 'prompt' as const, prompt: '' }
    : input.configurationSource ?? { kind: 'prompt' as const, prompt: '' }
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('请填写团队名称')
  const id = `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const team = draftTeam(id, trimmed, [], configurationSource, description)
  updateTeamState(current => ({
    ...current,
    selected: { kind: 'team', teamId: id, view: 'home' },
    teams: [...current.teams, team],
  }))
  return team
}

export type TeamProvisioningResult =
  | {
    state: 'collecting'
    configurationSessionId: string
    message: string
  }
  | {
    coordinator: TeamMember
    members: TeamMember[]
    state: 'ready' | 'review'
    revision?: TeamRevisionRef
    description?: string
    message?: string
    pendingDefinition?: Record<string, unknown>
    configurationSessionId?: string
  }

export function markTeamProvisioning(teamId: string, state: TeamProvisioningState, message?: string): void {
  updateTeamDefinition(teamId, team => ({
    ...team,
    provisioning: { state, ...(message === undefined ? {} : { message }) },
  }))
}

export function applyTeamProvisioningResult(teamId: string, result: TeamProvisioningResult): void {
  updateTeamDefinition(teamId, team => {
    if (result.state === 'collecting') {
      return {
        ...team,
        provisioning: { state: 'draft', message: result.message },
        configurationSessionId: result.configurationSessionId,
      }
    }
    const { activeRevision: _activeRevision, pendingDefinition: _pendingDefinition, ...base } = team
    return {
      ...base,
      status: result.revision === undefined ? 'draft' : 'published',
      coordinator: result.coordinator,
      members: result.members,
      provisioning: { state: result.state, ...(result.message === undefined ? {} : { message: result.message }) },
      ...(result.revision === undefined ? {} : { activeRevision: result.revision }),
      ...(result.pendingDefinition === undefined ? {} : { pendingDefinition: result.pendingDefinition }),
      ...(result.description === undefined ? {} : { description: result.description }),
      ...(result.configurationSessionId === undefined ? {} : { configurationSessionId: result.configurationSessionId }),
    }
  })
}

export function updateTeamDefinition(teamId: string, change: (team: PromaxTeam) => PromaxTeam): void {
  updateTeamState(current => ({
    ...current,
    teams: current.teams.map(team => team.id === teamId ? change(team) : team),
  }))
}

export function addTeamWorker(teamId: string): void {
  updateTeamDefinition(teamId, team => {
    const ordinal = team.members.length + 1
    return {
      ...team,
      status: 'draft',
      members: [...team.members, {
        memberId: `worker_${ordinal}`,
        displayName: `Worker ${ordinal}`,
        objective: '',
        role: 'worker',
        enabled: true,
        provides: [],
        requires: [],
      }],
    }
  })
}

export function updateTeamMember(teamId: string, memberId: string, patch: Partial<Pick<TeamMember, 'displayName' | 'objective' | 'enabled' | 'instructions'>>): void {
  updateTeamDefinition(teamId, team => ({
    ...team,
    status: 'draft',
    members: team.members.map(member => member.memberId === memberId ? { ...member, ...patch } : member),
  }))
}

export function updateTeamPrompt(teamId: string, patch: Partial<Pick<TeamPromptDraft, 'teamInstructions' | 'coordinatorInstructions'>>): void {
  updateTeamDefinition(teamId, team => ({
    ...team,
    status: 'draft',
    promptDraft: {
      ...team.promptDraft,
      ...patch,
      recipeId: 'custom',
      importedSources: team.promptDraft.importedSources.filter(source => (
        source.kind === 'agents' ? patch.teamInstructions === undefined : patch.coordinatorInstructions === undefined
      )),
    },
  }))
}

export function importTeamPromptSource(teamId: string, source: { name: string; kind: 'agents' | 'soul'; bytes: number; content: string }): void {
  const content = source.content.trim()
  if (content === '') throw new Error(`${source.name} 没有可导入内容`)
  if (source.bytes > 65_536) throw new Error(`${source.name} 超过 64 KiB 草稿上限`)
  updateTeamDefinition(teamId, team => ({
    ...team,
    status: 'draft',
    promptDraft: {
      ...team.promptDraft,
      recipeId: 'imported',
      ...(source.kind === 'agents' ? { teamInstructions: content } : { coordinatorInstructions: content }),
      importedSources: [
        ...team.promptDraft.importedSources.filter(item => item.kind !== source.kind),
        { name: source.name, kind: source.kind, bytes: source.bytes, importedAt: new Date().toISOString() },
      ],
    },
  }))
}

export function removeTeamMember(teamId: string, memberId: string): void {
  updateTeamDefinition(teamId, team => ({
    ...team,
    status: 'draft',
    members: team.members.filter(member => member.memberId !== memberId),
  }))
}

export function attachWorkspace(teamId: string, workspaceId: string): void {
  updateTeamDefinition(teamId, team => ({
    ...team,
    workspaceIds: [...new Set([...team.workspaceIds, workspaceId])],
  }))
  selectTeamHome(teamId, workspaceId)
}

export function bindTeamSession(binding: TeamSessionBinding): void {
  updateTeamState(current => ({
    ...current,
    selected: {
      kind: 'team', teamId: binding.teamId, view: 'session', sessionId: binding.sessionId,
      ...(binding.workspaceId === undefined ? {} : { workspaceId: binding.workspaceId }),
    },
    sessionBindings: [
      ...current.sessionBindings.filter(item => item.sessionId !== binding.sessionId),
      binding,
    ],
  }))
}

export function confirmTeamSessionDispatch(sessionId: string, confirmedMemberIds: readonly string[]): void {
  updateTeamState(current => ({
    ...current,
    sessionBindings: current.sessionBindings.map(binding => binding.sessionId === sessionId
      ? { ...binding, dispatchState: 'confirmed', confirmedMemberIds: [...confirmedMemberIds] }
      : binding),
  }))
}

export function startTeamSessionDispatch(sessionId: string): void {
  updateTeamState(current => ({
    ...current,
    sessionBindings: current.sessionBindings.map(binding => binding.sessionId === sessionId
      ? { ...binding, dispatchState: 'running' }
      : binding),
  }))
}

export function setTeamSessionRunState(sessionId: string, runState: 'running' | 'stop_requested' | 'draining' | 'cancelled' | 'completed' | 'failed', updatedAt = new Date().toISOString()): void {
  updateTeamState(current => ({
    ...current,
    sessionBindings: current.sessionBindings.map(binding => binding.sessionId === sessionId
      ? { ...binding, runState, runStateUpdatedAt: updatedAt }
      : binding),
  }))
}

export function bindingForSession(state: PromaxTeamState, sessionId: string): TeamSessionBinding | undefined {
  return state.sessionBindings.find(binding => binding.sessionId === sessionId)
}

/** Resolve the stable Promax team represented by one dsh session. */
export function teamForSession(state: PromaxTeamState, sessionId: string): PromaxTeam | undefined {
  const binding = bindingForSession(state, sessionId)
  if (binding !== undefined) return state.teams.find(team => team.id === binding.teamId)
  const selected = state.selected
  if (selected.kind !== 'team' || selected.view !== 'session' || selected.sessionId !== sessionId) return undefined
  return state.teams.find(team => team.id === selected.teamId)
}

export function resetTeamStateForTests(): void {
  cachedRaw = undefined
  cachedState = DEFAULT_STATE
}
