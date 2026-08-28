import { useSyncExternalStore } from 'react'

export const PRODUCT_TEAM_ID = 'product-team'
export const GENERAL_PRESET_ID = 'general'
export const PRODUCT_PRESET_ID = 'product-solution'

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
  name: '产品团队',
  description: '产品方案、流程与原型的专用 Agent 团队。',
  status: 'published',
  coordinator: {
    memberId: 'product_lead',
    displayName: '产品负责人',
    objective: '拆解任务、委派三名专员、等待结算并完成终审。',
    role: 'coordinator',
    enabled: true,
  },
  members: [
    {
      memberId: 'product_prd_agent',
      displayName: 'PRD 专员',
      objective: '需求定义、范围、业务规则与验收口径。',
      role: 'worker',
      enabled: true,
      moduleRef: 'prd-document-generator@1',
    },
    {
      memberId: 'product_diagram_agent',
      displayName: '业务流程专员',
      objective: '业务流程、状态变化和异常路径。',
      role: 'worker',
      enabled: true,
      moduleRef: 'business-diagram-generator@1',
    },
    {
      memberId: 'product_prototype_agent',
      displayName: '交互原型专员',
      objective: '单 HTML 可交互原型与界面反馈。',
      role: 'worker',
      enabled: true,
      moduleRef: 'interactive-prototype-generator@1',
    },
  ],
  workspaceIds: [],
  configurationSource: { kind: 'compat', label: '产品团队兼容配置' },
  provisioning: { state: 'ready' },
  promptDraft: {
    recipeId: 'product-compat',
    teamInstructions: '沿用 product-solution 的已发布协调规则、成员职责和产物契约。',
    coordinatorInstructions: '兼容配置保持只读，不由 GUI 覆盖已发布 persona。',
    importedSources: [],
  },
  activeRevision: { revision: 'compat', presetId: PRODUCT_PRESET_ID, status: 'published' },
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

function memberOf(value: unknown, role: TeamMember['role']): TeamMember | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const memberId = nonEmpty(row.memberId)
  const displayName = nonEmpty(row.displayName)
  const objective = typeof row.objective === 'string' ? row.objective : ''
  if (memberId === undefined || displayName === undefined || row.role !== role || typeof row.enabled !== 'boolean') return null
  const moduleRef = nonEmpty(row.moduleRef)
  const instructions = typeof row.instructions === 'string' ? row.instructions : undefined
  return {
    memberId,
    displayName,
    objective,
    role,
    enabled: row.enabled,
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
  const revision = row.revision
  if (
    sessionId === undefined || teamId === undefined || presetId === undefined
    || !teams.some(team => team.id === teamId)
    || (revision !== 'compat' && !(typeof revision === 'number' && revision > 0))
  ) return null
  return { sessionId, teamId, revision, presetId, ...(workspaceId === undefined ? {} : { workspaceId }) }
}

function parseV2(raw: string): PromaxTeamState | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null) return null
    const row = value as Record<string, unknown>
    if (row.version !== 2 || !Array.isArray(row.teams) || !Array.isArray(row.sessionBindings)) return null
    const parsedTeams = row.teams.map(teamOf).filter((team): team is PromaxTeam => team !== null)
    const teams = parsedTeams.some(team => team.id === PRODUCT_TEAM_ID) ? parsedTeams : [PRODUCT_TEAM, ...parsedTeams]
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
    const migrated: PromaxTeam[] = [PRODUCT_TEAM]
    for (const item of legacyTeams) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as Record<string, unknown>
      const id = nonEmpty(row.id)
      const name = nonEmpty(row.name)
      if (id === undefined || name === undefined || id === PRODUCT_TEAM_ID) continue
      const workspaceIds = Array.isArray(row.workspaceIds)
        ? row.workspaceIds.filter((workspaceId): workspaceId is string => nonEmpty(workspaceId) !== undefined)
        : []
      migrated.push(draftTeam(id, name, workspaceIds))
    }
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
    },
    members: [],
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

export function revisionLabel(revision: TeamRevisionNumber): string {
  return revision === 'compat' ? '兼容版本' : `Revision ${revision}`
}

export function resetTeamStateForTests(): void {
  cachedRaw = undefined
  cachedState = DEFAULT_STATE
}
