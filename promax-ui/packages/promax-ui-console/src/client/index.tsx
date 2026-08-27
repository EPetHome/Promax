import type { ComponentType } from 'react'
import { AgentStatusDock, type AgentStatusSnapshot } from '../components/AgentStatusDock.tsx'
import { PromaxConsole } from '../components/PromaxConsole.tsx'
import { ConsoleLauncher } from './ConsoleLauncher.tsx'
import {
  EmptyHeroSeat,
  PromaxSessionBrowser,
  PromaxTeamRail,
  type SessionListState,
  type WorkspaceListState,
  type WorkspaceShellActions,
} from './PromaxWorkspaceShell.tsx'

interface SlotService {
  inject(name: string, setup: () => unknown): void
  register(options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>): unknown
}

interface ClientContext {
  slots: SlotService
  sessions: {
    list: Observable<SessionListState>
    open(sessionId: string): void
    noteAgentPreset(sessionId: string, presetId: string): void
  }
  workspaces: {
    list: Observable<WorkspaceListState>
    connectWorkspace(workspaceId: string): Promise<string>
    pickDirectory(): Promise<string | null>
    create(input: { path: string }): Promise<{ workspaceId: string }>
  }
  get(name: 'connection'): ConnectionService
}

interface Observable<State> {
  getSnapshot(): State
  subscribe(listener: () => void): () => void
}

interface ConnectionService {
  api: {
    agentPresets: {
      select(input: { sessionId: string; agentPreset: string }): Promise<{
        result:
          | { ok: true; value: { agentPreset: string } }
          | { ok: false; error: { message: string } }
      }>
    }
  }
}

interface PluginConfig { apiBaseUrl?: string }

export const inject = ['slots', 'sessions', 'workspaces', 'connection']

function ConsoleSection(props: Record<string, unknown>) {
  const apiBaseUrl = props.apiBaseUrl as string | undefined
  return <PromaxConsole {...(apiBaseUrl === undefined ? {} : { apiBaseUrl })} />
}

function PromaxAgentStatusDock(props: Record<string, unknown>) {
  return <AgentStatusDock session={props.session as AgentStatusSnapshot} />
}

type ShellRuntimeProps = WorkspaceShellActions & {
  useWorkspaces: <Selected>(selector: (state: WorkspaceListState) => Selected) => Selected
  useSessions: <Selected>(selector: (state: SessionListState) => Selected) => Selected
}

export function apply(ctx: ClientContext, config: PluginConfig = {}): void {
  const connection = ctx.get('connection')
  const shellActions: WorkspaceShellActions = {
    openWorkspace: async (workspaceId, presetId) => {
      const sessionId = await ctx.workspaces.connectWorkspace(workspaceId)
      const session = ctx.sessions.list.getSnapshot().byId[sessionId]
      if (session?.blank === true && session.agentPreset !== presetId) {
        const response = await connection.api.agentPresets.select({ sessionId, agentPreset: presetId })
        if (!response.result.ok) throw new Error(response.result.error.message)
        ctx.sessions.noteAgentPreset(sessionId, response.result.value.agentPreset)
      }
      ctx.sessions.open(sessionId)
    },
    openSession: sessionId => { ctx.sessions.open(sessionId) },
    chooseAndAttachWorkspace: async () => {
      const path = await ctx.workspaces.pickDirectory()
      if (path === null) return null
      const workspace = await ctx.workspaces.create({ path })
      return workspace.workspaceId
    },
  }
  const shellInjected = (): WorkspaceShellActions => shellActions

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
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'promax-agent-status',
    order: -20,
  }, PromaxAgentStatusDock))
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
    name: 'sidebar.workspaces',
    priority: -100,
    inject: shellInjected,
  }, PromaxSessionBrowser as ComponentType<ShellRuntimeProps> as ComponentType<Record<string, unknown>>))
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
  }, PromaxTeamRail as ComponentType<ShellRuntimeProps> as ComponentType<Record<string, unknown>>))
}
