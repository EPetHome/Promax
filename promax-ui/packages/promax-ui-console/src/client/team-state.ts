import { useSyncExternalStore } from 'react'

export const PRODUCT_TEAM_ID = 'product-team'
export const GENERAL_PRESET_ID = 'general'
export const PRODUCT_PRESET_ID = 'product-solution'

export interface TeamMember {
  id: string
  name: string
  role: string
}

export interface TeamTemplate {
  id: string
  name: string
  description: string
  presetId: string
  members: readonly TeamMember[]
}

export interface PromaxTeam {
  id: string
  name: string
  description: string
  templateId: string
  workspaceIds: string[]
}

export type PromaxContext =
  | { kind: 'general'; workspaceId?: string }
  | { kind: 'team'; teamId: string; workspaceId?: string }

export interface PromaxTeamState {
  version: 1
  selected: PromaxContext
  teams: PromaxTeam[]
}

export const TEAM_TEMPLATES: Readonly<Record<string, TeamTemplate>> = {
  [PRODUCT_PRESET_ID]: {
    id: PRODUCT_PRESET_ID,
    name: '产品 Agent 团队',
    description: '由产品负责人组织 PRD、业务流程与交互原型三类交付。',
    presetId: PRODUCT_PRESET_ID,
    members: [
      { id: 'product_prd_agent', name: 'PRD 专员', role: '需求定义与验收口径' },
      { id: 'product_diagram_agent', name: '业务流程专员', role: '流程、状态与异常路径' },
      { id: 'product_prototype_agent', name: '交互原型专员', role: '单 HTML 可交互原型' },
    ],
  },
}

const STORAGE_KEY = 'promax.teams.v1'
const CHANGE_EVENT = 'promax:team-state-change'

const PRODUCT_TEAM: PromaxTeam = {
  id: PRODUCT_TEAM_ID,
  name: '产品团队',
  description: '产品方案、流程与原型的专用 Agent 团队。',
  templateId: PRODUCT_PRESET_ID,
  workspaceIds: [],
}

const DEFAULT_STATE: PromaxTeamState = {
  version: 1,
  selected: { kind: 'general' },
  teams: [PRODUCT_TEAM],
}

let cachedRaw: string | null | undefined
let cachedState: PromaxTeamState = DEFAULT_STATE

function contextOf(value: unknown): PromaxContext | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const workspaceId = typeof row.workspaceId === 'string' && row.workspaceId !== '' ? row.workspaceId : undefined
  if (row.kind === 'general') return { kind: 'general', ...(workspaceId === undefined ? {} : { workspaceId }) }
  if (row.kind === 'team' && typeof row.teamId === 'string' && row.teamId !== '') {
    return { kind: 'team', teamId: row.teamId, ...(workspaceId === undefined ? {} : { workspaceId }) }
  }
  return null
}

function teamOf(value: unknown): PromaxTeam | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (
    typeof row.id !== 'string' || row.id === ''
    || typeof row.name !== 'string' || row.name.trim() === ''
    || typeof row.description !== 'string'
    || typeof row.templateId !== 'string' || TEAM_TEMPLATES[row.templateId] === undefined
    || !Array.isArray(row.workspaceIds)
    || !row.workspaceIds.every(item => typeof item === 'string' && item !== '')
  ) return null
  return {
    id: row.id,
    name: row.name.trim(),
    description: row.description,
    templateId: row.templateId,
    workspaceIds: [...new Set(row.workspaceIds)],
  }
}

function parseState(raw: string | null): PromaxTeamState {
  if (raw === null) return DEFAULT_STATE
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null) return DEFAULT_STATE
    const row = value as Record<string, unknown>
    if (row.version !== 1 || !Array.isArray(row.teams)) return DEFAULT_STATE
    const selected = contextOf(row.selected)
    const teams = row.teams.map(teamOf).filter((team): team is PromaxTeam => team !== null)
    if (selected === null) return DEFAULT_STATE
    const product = teams.some(team => team.id === PRODUCT_TEAM_ID) ? teams : [PRODUCT_TEAM, ...teams]
    const selectedExists = selected.kind === 'general' || product.some(team => team.id === selected.teamId)
    return {
      version: 1,
      selected: selectedExists ? selected : { kind: 'general' },
      teams: product,
    }
  } catch {
    return DEFAULT_STATE
  }
}

export function readTeamState(): PromaxTeamState {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedState = parseState(raw)
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

export function selectTeam(teamId: string, workspaceId?: string): void {
  updateTeamState(current => ({
    ...current,
    selected: { kind: 'team', teamId, ...(workspaceId === undefined ? {} : { workspaceId }) },
  }))
}

export function createTeam(name: string): PromaxTeam {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('请填写团队名称')
  const id = `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const team: PromaxTeam = {
    id,
    name: trimmed,
    description: '基于产品 Agent 团队模板创建。',
    templateId: PRODUCT_PRESET_ID,
    workspaceIds: [],
  }
  updateTeamState(current => ({
    ...current,
    selected: { kind: 'team', teamId: id },
    teams: [...current.teams, team],
  }))
  return team
}

export function attachWorkspace(teamId: string, workspaceId: string): void {
  updateTeamState(current => ({
    ...current,
    selected: { kind: 'team', teamId, workspaceId },
    teams: current.teams.map(team => team.id === teamId
      ? { ...team, workspaceIds: [...new Set([...team.workspaceIds, workspaceId])] }
      : team),
  }))
}

export function templateFor(team: PromaxTeam): TeamTemplate {
  return TEAM_TEMPLATES[team.templateId] ?? TEAM_TEMPLATES[PRODUCT_PRESET_ID]!
}

export function resetTeamStateForTests(): void {
  cachedRaw = undefined
  cachedState = DEFAULT_STATE
}
