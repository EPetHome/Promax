import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { apply, inject } from '../src/client/index.tsx'
import { PRODUCT_PRESET_ID, PRODUCT_TEAM_ID, resetTeamStateForTests, selectTeamSession } from '../src/client/team-state.ts'

const runtimePresetContent = `
  ## 已发布团队快照

  - team revision：\`team-mtcjsbcz-04tpe2@r7\`
  - preset：\`promax-team-mtcjsbcz-04tpe2-r7\`

  成员：
  - \`customer_research\`（客研管理智能体）：完成客户研究。
  - \`solution_design\`（产品需求方案智能体）：生成并验证 PRD。
  - \`quality_judge\`（独立 Judge）：独立判定最终产物。

  ## 稳定消息路由

  文件责任：
  - \`deliverables/{task_key}/prd.md\`：solution_design
  - \`.promax/judge/{task_key}/judge.md\`：quality_judge

  稳定回执字段（按顺序）：\`状态\`、\`产物\`、\`Judge判定\`
`

describe('Promax shell registration', () => {
  it('declares the replacement layout service as a runtime dependency', () => {
    expect(inject).toContain('layout')
  })

  it('occupies only published inner slots and prepares the requested preset without opening early', async () => {
    const registrations: Array<{ options: Record<string, unknown>; component: ComponentType<Record<string, unknown>> }> = []
    const sources: Array<Record<string, unknown>> = []
    const open = vi.fn()
    const noteAgentPreset = vi.fn()
    const list = vi.fn(async () => ({ result: { ok: true as const, value: { presets: [{ id: PRODUCT_PRESET_ID }] } } }))
    const read = vi.fn(async () => ({ result: { ok: true as const, value: { agentPreset: PRODUCT_PRESET_ID, content: runtimePresetContent } } }))
    const select = vi.fn(async () => ({ result: { ok: true as const, value: { agentPreset: PRODUCT_PRESET_ID } } }))
    const createSession = vi.fn(async () => ({ result: { ok: true as const, value: { sessionId: 'session-new', agentPreset: PRODUCT_PRESET_ID } } }))
    const interrupt = vi.fn(async () => ({ result: { ok: true as const, value: { accepted: true as const } } }))
    const cancel = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
    const sessionSnapshot = { running: false }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      workspaceId: 'workspace-new', path: '/tmp/Promax/云盘项目', title: '云盘项目', sessionIds: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const listState = {
      ids: ['session-new'],
      byId: {
        'session-new': {
          id: 'session-new', displayTitle: '新会话', agentPreset: 'promax-team-mtcjsbcz-04tpe2-r4', running: false, blank: true, updatedAt: 1,
        },
      },
      current: undefined,
      phase: 'ready',
    }
    const context = {
      effect: (setup: () => void | (() => void)) => { setup() },
      slots: {
        inject: (_name: string, setup: () => unknown) => { setup() },
        register: (options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>) => {
          registrations.push({ options, component })
          return () => {}
        },
      },
      sessions: {
        list: { getSnapshot: () => listState, subscribe: () => () => {} },
        open,
        clear: vi.fn(),
        noteAgentPreset,
        scope: () => ({}),
        binding: () => ({
          session: {
            getSnapshot: () => sessionSnapshot,
            subscribe: () => () => {},
            prompt: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
            cancel,
          },
        }),
      },
      workspaces: {
        list: {
          getSnapshot: () => ({ items: [], archivedSessionIds: [], state: 'idle' as const, error: null }),
          subscribe: () => () => {},
        },
        connectWorkspace: vi.fn(async () => 'session-new'),
        pickDirectory: vi.fn(async () => null),
        createDirectory: vi.fn(async (_path: string, name: string) => `/tmp/${name}`),
        openPath: vi.fn(async () => {}),
        create: vi.fn(async () => ({ workspaceId: 'workspace-new' })),
        rename: vi.fn(async (_workspaceId: string, title: string) => ({ workspaceId: 'workspace-new', path: '/tmp/promax-team', title, sessionIds: [] })),
      },
      get: (name: string) => name === 'inputTriggers'
        ? {
          registerSource: (source: Record<string, unknown>) => { sources.push(source); return () => {} },
          sessionOf: () => ({
            menu: { getSnapshot: () => ({ open: false }), subscribe: () => () => {} },
            launcher: { getSnapshot: () => null, subscribe: () => () => {} },
            toggleSource: vi.fn(),
          }),
        }
        : name === 'layout' ? { toggleSidebar: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn() } : { api: { agentPresets: { list, read, select }, sessions: { create: createSession }, subagents: { interrupt } } },
    }

    resetTeamStateForTests()
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    apply(context as unknown as Parameters<typeof apply>[0])
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledWith({ agentPreset: PRODUCT_PRESET_ID })
    })

    expect(registrations.map(entry => entry.options.name)).toEqual([
      'sidebar.footer.action',
      'settings.section',
      'settings.section',
      'conversation.input.dock',
      'conversation.session.header.actions',
      'conversation.input.left',
      'conversation.chat.assistant-actions',
      'sidebar.workspaces',
      'conversation.hero.workspace',
      'conversation.hero.agentPreset',
      'sidebar',
      'conversation.composer.bar',
      'details',
      'shell.overlay',
    ])
    expect(registrations.find(entry => entry.options.name === 'sidebar.workspaces')?.options.priority).toBe(-100)
    expect(registrations.find(entry => entry.options.name === 'conversation.hero.workspace')?.options.priority).toBe(-100)
    expect(registrations.find(entry => entry.options.name === 'conversation.hero.agentPreset')?.options.priority).toBe(-100)
    expect(registrations.find(entry => entry.options.name === 'shell.overlay')?.options.id).toBe('promax-workspace')
    const goalShadow = registrations.find(entry => entry.options.name === 'conversation.input.dock')
    expect(goalShadow?.options).toMatchObject({ id: 'goal', priority: -100 })
    expect(goalShadow?.options.children).toBeUndefined()
    expect(registrations.some(entry => entry.options.id === 'promax-agent-status')).toBe(false)
    expect(registrations.some(entry => entry.options.id === 'promax-preferences')).toBe(true)
    expect(registrations.some(entry => entry.options.name === 'root')).toBe(false)
    for (const name of ['sidebar', 'conversation.composer.bar', 'details']) {
      const shadow = registrations.find(entry => entry.options.name === name)
      expect(shadow?.options.priority).toBe(-100)
      expect(shadow?.options.children).toBeUndefined()
    }
    expect(registrations.some(entry => ['conversation.session', 'conversation.composer', 'conversation.view'].includes(String(entry.options.name)))).toBe(false)
    expect(registrations.find(entry => entry.options.name === 'conversation.session.header.actions')?.options.id).toBe('promax-team-context')
    expect(registrations.find(entry => entry.options.name === 'conversation.input.left')?.options.id).toBe('promax-team-members')
    expect(registrations.find(entry => entry.options.name === 'conversation.chat.assistant-actions')?.options.id).toBe('promax-process')

    const memberSource = sources.find(source => source.name === 'promax-team-member') as {
      candidates(session: { sessionId: string }, request: { query: string; signal: AbortSignal }): Promise<Array<{ name: string; value?: string }>>
      onPick(input: { candidate: { name: string; value?: string } }): { insert: { ref: string; label: string } } | undefined
      codec: { serialize(ref: string, signal: AbortSignal): Promise<string> }
    }
    const candidates = await memberSource.candidates({ sessionId: 'product-session' }, { query: '产品需求', signal: new AbortController().signal })
    const prd = candidates.find(candidate => candidate.name === '产品需求方案智能体')
    expect(prd).toBeDefined()
    expect(memberSource.onPick({ candidate: prd! })?.insert).toMatchObject({ ref: 'solution_design', label: '产品需求方案智能体' })
    await expect(memberSource.codec.serialize('solution_design', new AbortController().signal)).resolves.toBe('@solution_design')

    const shellEntry = registrations.find(entry => entry.options.name === 'shell.overlay')
    const actions = (shellEntry?.options.inject as (() => {
      startSession(workspaceId: string, presetId: string): Promise<string>
      createProjectWorkspace(input: { projectName: string; parentPath?: string }): Promise<{ workspaceId: string; path: string; title: string }>
      stopTeamDescendants(targets: Array<{ sessionId: string; parentSessionId: string }>): Promise<void>
    }))()
    await expect(actions.startSession('product', PRODUCT_PRESET_ID)).resolves.toBe('session-new')
    expect(createSession).toHaveBeenCalledWith({ workspaceId: 'product', agentPreset: PRODUCT_PRESET_ID })
    expect(select).not.toHaveBeenCalled()
    expect(noteAgentPreset).toHaveBeenCalledWith('session-new', PRODUCT_PRESET_ID)
    expect(open).not.toHaveBeenCalled()

    await expect(actions.stopTeamDescendants([{ sessionId: 'worker-1', parentSessionId: 'product-session' }])).resolves.toBeUndefined()
    expect(interrupt).toHaveBeenCalledWith({ parentSessionId: 'product-session', childSessionId: 'worker-1', mode: 'continuable' })

    const composerEntry = registrations.find(entry => entry.options.name === 'conversation.composer.bar')
    const composerInjected = (composerEntry?.options.inject as ((sessionId: string) => { stop(): Promise<void> }))('product-session')
    await expect(composerInjected.stop()).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledOnce()

    await expect(actions.createProjectWorkspace({ projectName: '云盘项目' })).resolves.toMatchObject({ title: '云盘项目', path: '/tmp/Promax/云盘项目' })
    expect(fetchMock).toHaveBeenCalledWith('/promax-workspace-api/project', expect.objectContaining({ method: 'POST' }))
    vi.unstubAllGlobals()
  })
})
