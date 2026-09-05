import type { ComponentType } from 'react'
import { PromaxConsole } from '../components/PromaxConsole.tsx'
import { ConsoleLauncher } from './ConsoleLauncher.tsx'
import {
  EmptyHeroSeat,
  PromaxComposerBar,
  PromaxDetailsSidebar,
  PromaxLeftSidebar,
  PromaxProcessAction,
  PromaxSessionBrowser,
  PromaxTeamSessionHeader,
  PromaxWorkspaceOverlay,
  type SessionListState,
  type WorkspaceListState,
  type WorkspaceShellActions,
} from './PromaxWorkspaceShell.tsx'
import {
  PRODUCT_PRESET_ID,
  runtimeTeamRosterOf,
  syncProductTeamRuntimeRoster,
} from './team-state.ts'
import { createPromaxSettingsService, type PromaxSettingsConnection } from './PromaxSettings.tsx'
import { taskAttachmentContextOf } from './task-attachments.ts'

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
        getSnapshot(): { running: boolean }
        subscribe(listener: () => void): () => void
        prompt(content: Array<{ type: 'text'; text: string }>, mode: 'queue'): Promise<
          | { ok: true; value: { accepted: true } }
          | { ok: false; error: { message: string } }
        >
        cancel(): Promise<
          | { ok: true; value: { accepted: true } }
          | { ok: false; error: { message: string } }
        >
        rename(title: string): Promise<
          | { ok: true; value: { title: string; seq: number } }
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
    archiveSession(sessionId: string): Promise<void>
  }
  get(name: 'connection'): ConnectionService
  get(name: 'inputTriggers'): InputTriggerService
  get(name: 'layout'): LayoutService
}

interface LayoutService {
  toggleSidebar(): void
  openDetails(): void
  closeDetails(): void
}

interface Observable<State> {
  getSnapshot(): State
  subscribe(listener: () => void): () => void
}

async function waitForRuntimeState(predicate: () => boolean, subscribe: (listener: () => void) => () => void, label: string, timeoutMs = 15_000): Promise<void> {
  if (predicate()) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let unsubscribe = (): void => {}
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      unsubscribe()
      if (error === undefined) resolve()
      else reject(error)
    }
    const timeout = window.setTimeout(() => { finish(new Error(`${label}在 ${String(timeoutMs)}ms 内未静止`)) }, timeoutMs)
    unsubscribe = subscribe(() => { if (predicate()) finish() })
    if (predicate()) finish()
  })
}

interface ConnectionService {
  api: PromaxSettingsConnection['api'] & {
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
    }
    sessions: {
      create(input: { workspaceId: string; agentPreset: string }): Promise<{
        result:
          | { ok: true; value: { sessionId: string; agentPreset?: string } }
          | { ok: false; error: { message: string } }
      }>
    }
    subagents: {
      interrupt(input: { parentSessionId: string; childSessionId: string; mode: 'continuable' }): Promise<{
        result:
          | { ok: true; value: { accepted: true } }
          | { ok: false; error: { message: string } }
      }>
    }
  }
}

interface InputTriggerController {
  menu: { getSnapshot(): { open: boolean }; subscribe(listener: () => void): () => void }
  launcher: { getSnapshot(): string | null; subscribe(listener: () => void): () => void }
  toggleSource(source: string, hit: {
    trigger: '@' | '/'
    query: string
    quoted: false
    position: 'leading' | 'inline'
    span: { start: number; end: number; draftRev: number }
  }): void
}

interface InputTriggerService {
  sessionOf(scope: unknown): InputTriggerController
}

interface PluginConfig { apiBaseUrl?: string }

export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'inputTriggers', 'layout']

function ConsoleSection(props: Record<string, unknown>) {
  const apiBaseUrl = props.apiBaseUrl as string | undefined
  return <PromaxConsole {...(apiBaseUrl === undefined ? {} : { apiBaseUrl })} />
}

function EmptyInputDockSeat() { return null }

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
  const settings = createPromaxSettingsService(connection)
  const inputTriggers = ctx.get('inputTriggers')
  const layout = ctx.get('layout')
  const descendants = (rootSessionId: string): Array<{ parentSessionId: string; sessionId: string; running: boolean }> => {
    const state = ctx.sessions.list.getSnapshot()
    const belongs = (sessionId: string): boolean => {
      const seen = new Set<string>()
      let cursor = state.byId[sessionId]
      while (cursor?.parentId !== undefined && !seen.has(cursor.id)) {
        seen.add(cursor.id)
        if (cursor.parentId === rootSessionId) return true
        cursor = state.byId[cursor.parentId]
      }
      return false
    }
    return state.ids.flatMap(sessionId => {
      const session = state.byId[sessionId]
      return session?.parentId === undefined || !belongs(sessionId) ? [] : [{ parentSessionId: session.parentId, sessionId, running: session.running }]
    })
  }
  const interruptTeamDescendants = async (rootSessionId: string): Promise<void> => {
    const unique = descendants(rootSessionId).filter(target => target.running)
    const results = await Promise.all(unique.map(async target => {
      const response = await connection.api.subagents.interrupt({
        parentSessionId: target.parentSessionId,
        childSessionId: target.sessionId,
        mode: 'continuable',
      })
      return response.result.ok ? null : `${target.sessionId}：${response.result.error.message}`
    }))
    const failures = results.filter((failure): failure is string => failure !== null)
    if (failures.length > 0) throw new Error(failures.join('；'))
  }
  const controlTaskRun = async (input: { workspaceId: string; projectPath: string; sessionId: string; taskKey: string; runEpoch: number; state: 'stop_requested' | 'draining' | 'cancelled' }): Promise<{ state: 'running' | 'stop_requested' | 'draining' | 'cancelled' | 'completed' | 'failed'; runEpoch: number }> => {
    const response = await fetch('/promax-workspace-api/task-run/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, updatedAt: new Date().toISOString() }),
    })
    const value = await response.json() as Record<string, unknown>
    if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `任务控制保存失败（HTTP ${response.status}）`)
    if (!['running', 'stop_requested', 'draining', 'cancelled', 'completed', 'failed'].includes(String(value.state)) || !Number.isSafeInteger(value.runEpoch)) throw new Error('任务控制响应格式无效')
    return value as { state: 'running' | 'stop_requested' | 'draining' | 'cancelled' | 'completed' | 'failed'; runEpoch: number }
  }
  const cancelParent = async (sessionId: string): Promise<void> => {
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined) throw new Error(`父会话 ${sessionId} 不可用`)
    const response = await session.cancel()
    if (!response.ok) throw new Error(response.error.message)
  }
  const waitForStableTeamStop = async (rootSessionId: string, stableMs = 600): Promise<void> => {
    let stableSince: number | undefined
    while (true) {
      const parentRunning = ctx.sessions.list.getSnapshot().byId[rootSessionId]?.running === true
      const runningChildren = descendants(rootSessionId).filter(target => target.running)
      if (runningChildren.length > 0) await interruptTeamDescendants(rootSessionId)
      if (parentRunning) await cancelParent(rootSessionId)
      if (!parentRunning && runningChildren.length === 0) {
        stableSince ??= Date.now()
        if (Date.now() - stableSince >= stableMs) return
      } else stableSince = undefined
      await new Promise<void>(resolve => { window.setTimeout(resolve, 250) })
    }
  }
  ctx.effect(() => {
    let active = true
    void readProductTeamRoster(connection).then(roster => {
      if (active) syncProductTeamRuntimeRoster(roster)
    }).catch(reason => {
      console.error('[Promax] 固定产品团队 roster 同步失败', reason)
    })
    return () => { active = false }
  }, 'promax: sync fixed product-team roster from runtime preset')
  const shellActions: WorkspaceShellActions = {
    startSession: async (workspaceId, presetId) => {
      const response = await connection.api.sessions.create({ workspaceId, agentPreset: presetId })
      if (!response.result.ok) throw new Error(response.result.error.message)
      const { sessionId, agentPreset } = response.result.value
      if (agentPreset !== presetId) throw new Error(`新会话没有绑定要求的 preset：${presetId}`)
      await waitForRuntimeState(
        () => ctx.sessions.list.getSnapshot().byId[sessionId] !== undefined,
        listener => ctx.sessions.list.subscribe(listener),
        '新会话',
      )
      ctx.sessions.noteAgentPreset(sessionId, agentPreset)
      return sessionId
    },
    sendSessionMessage: async (sessionId, text) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`找不到会话“${sessionId}”`)
      const response = await session.prompt([{ type: 'text', text }], 'queue')
      if (!response.ok) throw new Error(response.error.message)
    },
    openSession: sessionId => { ctx.sessions.open(sessionId) },
    clearSession: () => { ctx.sessions.clear() },
    archiveSession: async sessionId => { await ctx.workspaces.archiveSession(sessionId) },
    renameSession: async (sessionId, title) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`找不到会话“${sessionId}”`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    saveTaskAttachments: async input => {
      try {
        let paths: string[] = []
        if (input.files.length > 0) {
          const uploadResponse = await fetch('/promax-workspace-api/attachments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              workspaceId: input.workspaceId,
              projectPath: input.projectPath,
              sessionId: input.sessionId,
              files: input.files,
            }),
          })
          let uploaded: Record<string, unknown>
          try {
            uploaded = await uploadResponse.json() as Record<string, unknown>
          } catch {
            throw new Error('附件服务返回了无法识别的响应，请重试')
          }
          if (!uploadResponse.ok) throw new Error(typeof uploaded.error === 'string' ? uploaded.error : `附件上传失败（HTTP ${uploadResponse.status}）`)
          if (!Array.isArray(uploaded.paths) || !uploaded.paths.every(item => typeof item === 'string')) throw new Error('附件保存响应格式无效')
          paths = uploaded.paths as string[]
        }
        const freezeResponse = await fetch('/promax-workspace-api/attachments/freeze', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId: input.workspaceId,
            projectPath: input.projectPath,
            sessionId: input.sessionId,
            demand: input.demand,
            paths,
          }),
        })
        let frozen: Record<string, unknown>
        try {
          frozen = await freezeResponse.json() as Record<string, unknown>
        } catch {
          throw new Error('附件冻结服务返回了无法识别的响应，请重试')
        }
        if (!freezeResponse.ok) throw new Error(typeof frozen.error === 'string' ? frozen.error : `附件冻结失败（HTTP ${freezeResponse.status}）`)
        const attachments = Array.isArray(frozen.attachments) ? frozen.attachments.map(taskAttachmentContextOf) : []
        if (attachments.some(item => item === undefined) || attachments.length !== paths.length) throw new Error('附件解析响应格式无效')
        if (typeof frozen.manifestPath !== 'string' || frozen.manifestPath === '' || typeof frozen.taskKey !== 'string' || typeof frozen.sessionName !== 'string') throw new Error('附件冻结响应格式无效')
        return { paths, attachments: attachments as NonNullable<(typeof attachments)[number]>[], manifestPath: frozen.manifestPath, taskKey: frozen.taskKey, sessionName: frozen.sessionName }
      } catch (error) {
        if (error instanceof Error && /[\u3400-\u9FFF]/u.test(error.message)) throw error
        throw new Error('附件上传失败，请检查服务状态后重试')
      }
    },
    beginDispatchPlan: async input => {
      const response = await fetch('/promax-workspace-api/dispatch-plan/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const value = await response.json() as Record<string, unknown>
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `调度计划创建失败（HTTP ${response.status}）`)
      if (typeof value.planId !== 'string' || typeof value.taskKey !== 'string') throw new Error('调度计划创建响应格式无效')
      return { planId: value.planId, taskKey: value.taskKey }
    },
    confirmDispatchPlan: async input => {
      const response = await fetch('/promax-workspace-api/dispatch-plan/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const value = await response.json() as Record<string, unknown>
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `调度名单确认失败（HTTP ${response.status}）`)
      if (
        typeof value.planId !== 'string' || typeof value.taskKey !== 'string' || typeof value.confirmedAt !== 'string'
        || !Array.isArray(value.confirmedMemberIds) || !value.confirmedMemberIds.every(item => typeof item === 'string')
      ) throw new Error('调度名单确认响应格式无效')
      return { planId: value.planId, taskKey: value.taskKey, confirmedAt: value.confirmedAt, confirmedMemberIds: value.confirmedMemberIds as string[] }
    },
    readTaskRunFiles: async input => {
      const response = await fetch('/promax-workspace-api/task-run/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const value = await response.json() as Record<string, unknown>
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `任务状态读取失败（HTTP ${response.status}）`)
      if (
        value.taskKey !== input.taskKey || value.parentSessionId !== input.sessionId
        || !['running', 'stop_requested', 'draining', 'cancelled', 'completed', 'failed'].includes(String(value.cancellation))
        || typeof value.runEpoch !== 'number' || !Number.isSafeInteger(value.runEpoch)
        || typeof value.manifestPath !== 'string' || typeof value.inputManifestPath !== 'string' || !Array.isArray(value.confirmedMemberIds)
        || !Array.isArray(value.artifactStates) || typeof value.judge !== 'object' || value.judge === null
      ) throw new Error('任务文件快照响应格式无效')
      return value as unknown as Awaited<ReturnType<WorkspaceShellActions['readTaskRunFiles']>>
    },
    readTaskHistory: async input => {
      const response = await fetch('/promax-workspace-api/task-history/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const value = await response.json() as Record<string, unknown>
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `任务历史读取失败（HTTP ${response.status}）`)
      if (!Array.isArray(value.items) || value.items.some(item => {
        if (typeof item !== 'object' || item === null) return true
        const row = item as Record<string, unknown>
        return typeof row.sessionId !== 'string' || typeof row.taskKey !== 'string' || typeof row.createdAt !== 'string'
          || !['running', 'completed', 'failed'].includes(String(row.status)) || !Number.isSafeInteger(row.fileCount)
          || typeof row.deliverablePath !== 'string' || !Array.isArray(row.deliverableFiles)
      })) throw new Error('任务历史响应格式无效')
      return value.items as Awaited<ReturnType<WorkspaceShellActions['readTaskHistory']>>
    },
    openTaskFolder: async input => {
      const response = await fetch('/promax-workspace-api/task-folder/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const value = await response.json() as Record<string, unknown>
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : `产出目录读取失败（HTTP ${response.status}）`)
      if (typeof value.path !== 'string' || value.path === '') throw new Error('产出目录响应格式无效')
      await ctx.workspaces.openPath(value.path)
      return { path: value.path }
    },
    stopTeamTask: async input => {
      let control = await controlTaskRun({ ...input, state: 'stop_requested' })
      if (control.state === 'cancelled') return { state: 'cancelled' as const, runEpoch: control.runEpoch }
      control = await controlTaskRun({ ...input, state: 'draining' })
      if (control.state === 'cancelled') return { state: 'cancelled' as const, runEpoch: control.runEpoch }
      await interruptTeamDescendants(input.sessionId)
      // DSH interrupt aborts each current child turn. Keep the disk truth in
      // draining until the parent and every descendant actually report idle.
      await cancelParent(input.sessionId)
      await waitForStableTeamStop(input.sessionId)
      control = await controlTaskRun({ ...input, state: 'cancelled' })
      if (control.state !== 'cancelled') throw new Error(`任务停止后控制状态异常：${control.state}`)
      return { state: 'cancelled' as const, runEpoch: control.runEpoch }
    },
    teamRoutingAvailable: true,
  }
  const shellInjected = () => ({
    ...shellActions,
    layout,
    settings,
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
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'goal',
    priority: -100,
  }, EmptyInputDockSeat))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'promax-team-context',
    order: -50,
  }, PromaxTeamSessionHeader as unknown as ComponentType<Record<string, unknown>>))
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
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    priority: -100,
    inject: shellInjected,
  }, PromaxLeftSidebar as unknown as ComponentType<Record<string, unknown>>))
  ctx.slots.inject('conversation.composer.bar', () => ctx.slots.register({
    name: 'conversation.composer.bar',
    priority: -100,
    inject: (sessionId: string | undefined) => {
      if (sessionId === undefined) return shellInjected()
      const stop = async (): Promise<void> => {
        const session = ctx.sessions.binding(sessionId)?.session
        if (session === undefined) throw new Error(`Promax 团队会话 ${sessionId} 尚未就绪`)
        const response = await session.cancel()
        if (!response.ok) throw new Error(response.error.message)
        await waitForRuntimeState(
          () => session.getSnapshot().running !== true,
          listener => session.subscribe(listener),
          '主会话',
        )
      }
      const scope = ctx.sessions.scope(sessionId)
      if (scope === undefined) return { ...shellInjected(), stop }
      const controller = inputTriggers.sessionOf(scope)
      return {
        ...shellInjected(),
        stop,
        toggleCommand: (draft: string, draftRev: number) => {
          controller.toggleSource('command', {
            trigger: '/',
            query: '',
            quoted: false,
            position: draft.slice(0, -1).trim() === '' ? 'leading' : 'inline',
            span: { start: draft.length - 1, end: draft.length, draftRev },
          })
        },
      }
    },
  }, PromaxComposerBar as unknown as ComponentType<Record<string, unknown>>))
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    priority: -100,
    inject: shellInjected,
  }, PromaxDetailsSidebar as unknown as ComponentType<Record<string, unknown>>))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'promax-workspace',
    order: 50,
    inject: shellInjected,
  }, PromaxWorkspaceOverlay as unknown as ComponentType<Record<string, unknown>>))
}
