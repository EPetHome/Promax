import type { ComponentType } from 'react'
import { AgentStatusDock, type AgentStatusSnapshot } from '../components/AgentStatusDock.tsx'
import { PromaxConsole } from '../components/PromaxConsole.tsx'
import { ConsoleLauncher } from './ConsoleLauncher.tsx'
import {
  EmptyHeroSeat,
  PromaxConversationInputControl,
  PromaxDraftSettings,
  PromaxProcessAction,
  PromaxSessionBrowser,
  PromaxTeamRail,
  PromaxTeamSessionHeader,
  type SessionListState,
  type WorkspaceListState,
  type WorkspaceShellActions,
} from './PromaxWorkspaceShell.tsx'
import {
  PRODUCT_PRESET_ID,
  readTeamState,
  runtimeTeamRosterOf,
  syncProductTeamRuntimeRoster,
  teamForSession,
} from './team-state.ts'

interface SlotService {
  inject(name: string, setup: () => unknown): void
  register(options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>): unknown
}

interface ClientContext {
  effect(setup: () => void | (() => void), label?: string): void
  slots: SlotService
  sessions: {
    list: Observable<SessionListState>
    open(sessionId: string): void
    clear(): void
    noteAgentPreset(sessionId: string, presetId: string): void
    scope(sessionId: string): unknown | undefined
    binding(sessionId: string): {
      session: {
        prompt(content: Array<{ type: 'text'; text: string }>, mode: 'queue'): Promise<
          | { ok: true; value: { accepted: true } }
          | { ok: false; error: { message: string } }
        >
      }
    } | undefined
  }
  workspaces: {
    list: Observable<WorkspaceListState>
    connectWorkspace(workspaceId: string): Promise<string>
    pickDirectory(): Promise<string | null>
    createDirectory(path: string, name: string): Promise<string>
    openPath(path: string): Promise<void>
    create(input: { path: string }): Promise<{ workspaceId: string }>
    rename(workspaceId: string, title: string): Promise<{ workspaceId: string; path: string; title: string; sessionIds: string[] }>
  }
  get(name: 'connection'): ConnectionService
  get(name: 'inputTriggers'): InputTriggerService
}

interface Observable<State> {
  getSnapshot(): State
  subscribe(listener: () => void): () => void
}

interface ConnectionService {
  api: {
    agentPresets: {
      list(input: Record<string, never>): Promise<{
        result:
          | { ok: true; value: { presets: Array<{ id: string; broken?: string }> } }
          | { ok: false; error: { message: string } }
      }>
      read(input: { agentPreset: string }): Promise<{
        result:
          | { ok: true; value: { agentPreset: string; content: string } }
          | { ok: false; error: { message: string } }
      }>
      select(input: { sessionId: string; agentPreset: string }): Promise<{
        result:
          | { ok: true; value: { agentPreset: string } }
          | { ok: false; error: { message: string } }
      }>
    }
  }
}

interface InputTriggerCandidate {
  name: string
  description?: string
  section?: string
  value?: string
}

interface InputTriggerSource {
  trigger: '@'
  name: string
  order?: number
  showGroupTitle?: boolean
  candidates(
    session: { sessionId: string },
    request: { query: string; signal: AbortSignal },
  ): Promise<readonly InputTriggerCandidate[]>
  onPick(input: { candidate: InputTriggerCandidate }): {
    insert: { source: string; ref: string; label: string; clipboardText: string }
  } | undefined
  codec: {
    clipboardText(ref: string): string
    serialize(ref: string, signal: AbortSignal): Promise<string>
  }
}

interface InputTriggerController {
  menu: { getSnapshot(): { open: boolean }; subscribe(listener: () => void): () => void }
  launcher: { getSnapshot(): string | null; subscribe(listener: () => void): () => void }
  toggleSource(source: string, hit: {
    trigger: '@'
    query: string
    quoted: false
    position: 'leading' | 'inline'
    span: { start: number; end: number; draftRev: number }
  }): void
}

interface InputTriggerService {
  registerSource(source: InputTriggerSource): () => void
  sessionOf(scope: unknown): InputTriggerController
}

interface PluginConfig { apiBaseUrl?: string }

export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'inputTriggers']

function ConsoleSection(props: Record<string, unknown>) {
  const apiBaseUrl = props.apiBaseUrl as string | undefined
  return <PromaxConsole {...(apiBaseUrl === undefined ? {} : { apiBaseUrl })} />
}

function PromaxAgentStatusDock(props: Record<string, unknown>) {
  return <AgentStatusDock session={props.session as AgentStatusSnapshot} />
}

async function readProductTeamRoster(connection: ConnectionService) {
  const listed = await connection.api.agentPresets.list({})
  if (!listed.result.ok) throw new Error(listed.result.error.message)
  const preset = listed.result.value.presets.find(item => item.id === PRODUCT_PRESET_ID)
  if (preset === undefined) throw new Error(`运行时未安装固定团队 preset：${PRODUCT_PRESET_ID}`)
  if (preset.broken !== undefined) throw new Error(`固定团队 preset 不可用：${preset.broken}`)
  const read = await connection.api.agentPresets.read({ agentPreset: PRODUCT_PRESET_ID })
  if (!read.result.ok) throw new Error(read.result.error.message)
  if (read.result.value.agentPreset !== PRODUCT_PRESET_ID) throw new Error('运行时返回了错误的固定团队 preset')
  return runtimeTeamRosterOf(read.result.value.content)
}

export function apply(ctx: ClientContext, config: PluginConfig = {}): void {
  const connection = ctx.get('connection')
  const inputTriggers = ctx.get('inputTriggers')
  ctx.effect(() => {
    let active = true
    void readProductTeamRoster(connection).then(roster => {
      if (active) syncProductTeamRuntimeRoster(roster)
    }).catch(reason => {
      console.error('[Promax] 固定产品团队 roster 同步失败', reason)
    })
    return () => { active = false }
  }, 'promax: sync fixed product-team roster from runtime preset')
  const teamMemberSource: InputTriggerSource = {
    trigger: '@',
    name: 'promax-team-member',
    order: -100,
    showGroupTitle: false,
    async candidates(session, { query, signal }) {
      const team = teamForSession(readTeamState(), String(session.sessionId))
      if (team === undefined || signal.aborted) return []
      const normalized = query.trim().toLocaleLowerCase()
      return [team.coordinator, ...team.members.filter(member => member.enabled)]
        .filter(member => normalized === '' || member.displayName.toLocaleLowerCase().includes(normalized) || member.memberId.toLocaleLowerCase().includes(normalized))
        .map(member => ({
          name: member.displayName,
          description: `${member.role === 'coordinator' ? 'Coordinator' : 'Worker'} · ${member.objective || member.memberId}`,
          section: `${team.name}团队成员`,
          value: JSON.stringify({ memberId: member.memberId, displayName: member.displayName }),
        }))
    },
    onPick({ candidate }) {
      if (candidate.value === undefined) return undefined
      try {
        const value = JSON.parse(candidate.value) as { memberId?: unknown; displayName?: unknown }
        if (typeof value.memberId !== 'string' || typeof value.displayName !== 'string') return undefined
        return {
          insert: {
            source: 'promax-team-member',
            ref: value.memberId,
            label: value.displayName,
            clipboardText: `@${value.memberId}`,
          },
        }
      } catch {
        return undefined
      }
    },
    codec: {
      clipboardText: memberId => `@${memberId}`,
      serialize: memberId => Promise.resolve(`@${memberId}`),
    },
  }
  ctx.effect(() => inputTriggers.registerSource(teamMemberSource), 'promax: stable team-member @ source')
  const shellActions: WorkspaceShellActions = {
    startSession: async (workspaceId, presetId) => {
      const sessionId = await ctx.workspaces.connectWorkspace(workspaceId)
      const session = ctx.sessions.list.getSnapshot().byId[sessionId]
      if (session?.blank === true && session.agentPreset !== presetId) {
        const response = await connection.api.agentPresets.select({ sessionId, agentPreset: presetId })
        if (!response.result.ok) throw new Error(response.result.error.message)
        ctx.sessions.noteAgentPreset(sessionId, response.result.value.agentPreset)
      }
      return sessionId
    },
    openSession: sessionId => { ctx.sessions.open(sessionId) },
    clearSession: () => { ctx.sessions.clear() },
    createProjectWorkspace: async input => {
      const response = await fetch('/promax-workspace-api/project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const value = await response.json() as Record<string, unknown>
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `项目组创建失败（HTTP ${response.status}）`)
      if (
        typeof value.workspaceId !== 'string' || typeof value.path !== 'string' || typeof value.title !== 'string'
        || !Array.isArray(value.sessionIds) || !value.sessionIds.every(item => typeof item === 'string')
      ) throw new Error('项目组响应格式无效')
      return { workspaceId: value.workspaceId, path: value.path, title: value.title, sessionIds: value.sessionIds as string[] }
    },
    pickProjectDirectory: () => ctx.workspaces.pickDirectory(),
    writeDraftHandoff: async input => {
      const response = await fetch('/promax-workspace-api/handoff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const value = await response.json() as Record<string, unknown>
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `交底保存失败（HTTP ${response.status}）`)
      if (typeof value.handoffPath !== 'string' || typeof value.transcriptPath !== 'string') throw new Error('交底保存响应格式无效')
      return { handoffPath: value.handoffPath, transcriptPath: value.transcriptPath }
    },
    openWorkspacePath: async path => { await ctx.workspaces.openPath(path) },
    teamRoutingAvailable: true,
  }
  const shellInjected = () => ({
    ...shellActions,
    ...(config.apiBaseUrl === undefined ? {} : { apiBaseUrl: config.apiBaseUrl }),
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'promax-console',
    order: -10,
    inject: () => ({ apiBaseUrl: config.apiBaseUrl }),
  }, ConsoleLauncher))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'promax-console',
    order: 5,
    label: '管理控制台',
    inject: () => ({ apiBaseUrl: config.apiBaseUrl }),
  }, ConsoleSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'promax-preferences',
    order: 6,
    label: 'Promax 偏好',
  }, PromaxDraftSettings as unknown as ComponentType<Record<string, unknown>>))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'promax-agent-status',
    order: -20,
  }, PromaxAgentStatusDock))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'promax-team-context',
    order: -50,
  }, PromaxTeamSessionHeader as unknown as ComponentType<Record<string, unknown>>))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'promax-team-members',
    order: -50,
    inject: (sessionId: string) => {
      const scope = ctx.sessions.scope(sessionId)
      if (scope === undefined) throw new Error(`Promax 团队会话 ${sessionId} 尚未就绪`)
      const controller = inputTriggers.sessionOf(scope)
      return {
        menu: controller.menu,
        launcher: controller.launcher,
        toggleTeamMention: (draft: string, draftRev: number) => {
          const position = draft.trim() === '' ? 'leading' : 'inline'
          controller.toggleSource('promax-team-member', {
            trigger: '@',
            query: '',
            quoted: false,
            position,
            span: { start: draft.length, end: draft.length, draftRev },
          })
        },
      }
    },
  }, PromaxConversationInputControl as unknown as ComponentType<Record<string, unknown>>))
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'promax-process',
    order: 40,
  }, PromaxProcessAction as unknown as ComponentType<Record<string, unknown>>))
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    priority: -100,
    inject: shellInjected,
  }, PromaxSessionBrowser as unknown as ComponentType<Record<string, unknown>>))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
    name: 'conversation.hero.workspace',
    priority: -100,
  }, EmptyHeroSeat))
  ctx.slots.inject('conversation.hero.agentPreset', () => ctx.slots.register({
    name: 'conversation.hero.agentPreset',
    priority: -100,
  }, EmptyHeroSeat))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'promax-team-rail',
    order: 50,
    inject: shellInjected,
  }, PromaxTeamRail as unknown as ComponentType<Record<string, unknown>>))
}
