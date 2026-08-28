import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { apply } from '../src/client/index.tsx'
import { PRODUCT_TEAM_ID, resetTeamStateForTests, selectTeamSession } from '../src/client/team-state.ts'

describe('Promax shell registration', () => {
  it('occupies only published inner slots and applies the requested preset before opening', async () => {
    const registrations: Array<{ options: Record<string, unknown>; component: ComponentType<Record<string, unknown>> }> = []
    const sources: Array<Record<string, unknown>> = []
    const open = vi.fn()
    const noteAgentPreset = vi.fn()
    const select = vi.fn(async () => ({ result: { ok: true as const, value: { agentPreset: 'product-solution' } } }))
    const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      workspaceId: 'workspace-new', path: '/tmp/promax-team', title: '增长团队', sessionIds: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const listState = {
      ids: ['session-new'],
      byId: {
        'session-new': {
          id: 'session-new', displayTitle: '新会话', agentPreset: 'cordis', running: false, blank: true, updatedAt: 1,
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
        binding: () => ({ session: { prompt } }),
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
        : { api: { agentPresets: { select } } },
    }

    resetTeamStateForTests()
    selectTeamSession(PRODUCT_TEAM_ID, 'product-session', 'product')
    apply(context as unknown as Parameters<typeof apply>[0])

    expect(registrations.map(entry => entry.options.name)).toEqual([
      'sidebar.footer.action',
      'settings.section',
      'conversation.input.dock',
      'conversation.session.header.actions',
      'conversation.input.left',
      'conversation.chat.assistant-actions',
      'sidebar.workspaces',
      'conversation.hero.workspace',
      'conversation.hero.agentPreset',
      'shell.overlay',
    ])
    expect(registrations.find(entry => entry.options.name === 'sidebar.workspaces')?.options.priority).toBe(-100)
    expect(registrations.find(entry => entry.options.name === 'conversation.hero.workspace')?.options.priority).toBe(-100)
    expect(registrations.find(entry => entry.options.name === 'conversation.hero.agentPreset')?.options.priority).toBe(-100)
    expect(registrations.find(entry => entry.options.name === 'shell.overlay')?.options.id).toBe('promax-team-rail')
    expect(registrations.some(entry => entry.options.name === 'root' || entry.options.name === 'sidebar')).toBe(false)
    expect(registrations.some(entry => ['conversation.session', 'conversation.composer', 'conversation.view'].includes(String(entry.options.name)))).toBe(false)
    expect(registrations.find(entry => entry.options.name === 'conversation.session.header.actions')?.options.id).toBe('promax-team-context')
    expect(registrations.find(entry => entry.options.name === 'conversation.input.left')?.options.id).toBe('promax-team-members')
    expect(registrations.find(entry => entry.options.name === 'conversation.chat.assistant-actions')?.options.id).toBe('promax-process')

    const memberSource = sources.find(source => source.name === 'promax-team-member') as {
      candidates(session: { sessionId: string }, request: { query: string; signal: AbortSignal }): Promise<Array<{ name: string; value?: string }>>
      onPick(input: { candidate: { name: string; value?: string } }): { insert: { ref: string; label: string } } | undefined
      codec: { serialize(ref: string, signal: AbortSignal): Promise<string> }
    }
    const candidates = await memberSource.candidates({ sessionId: 'product-session' }, { query: 'PRD', signal: new AbortController().signal })
    const prd = candidates.find(candidate => candidate.name === 'PRD 专员')
    expect(prd).toBeDefined()
    expect(memberSource.onPick({ candidate: prd! })?.insert).toMatchObject({ ref: 'product_prd_agent', label: 'PRD 专员' })
    await expect(memberSource.codec.serialize('product_prd_agent', new AbortController().signal)).resolves.toBe('@product_prd_agent')

    const shellEntry = registrations.find(entry => entry.options.name === 'shell.overlay')
    const actions = (shellEntry?.options.inject as (() => {
      startSession(workspaceId: string, presetId: string): Promise<string>
      sendPrompt(sessionId: string, text: string): Promise<void>
      sendTeamPrompt(input: { sessionId: string; teamId: string; text: string; targetMemberIds: string[] }): Promise<void>
      createTeamWorkspace(input: { teamId: string; teamName: string; parentPath: string }): Promise<{ workspaceId: string; path: string; title: string }>
    }))()
    await expect(actions.startSession('product', 'product-solution')).resolves.toBe('session-new')
    expect(select).toHaveBeenCalledWith({ sessionId: 'session-new', agentPreset: 'product-solution' })
    expect(noteAgentPreset).toHaveBeenCalledWith('session-new', 'product-solution')
    expect(open).toHaveBeenCalledWith('session-new')

    await actions.sendPrompt('session-new', '生成产品方案')
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '生成产品方案' }], 'queue')
    await actions.sendTeamPrompt({ sessionId: 'session-new', teamId: 'product-team', text: '继续', targetMemberIds: [] })
    expect(prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '继续' }], 'queue')
    await actions.sendTeamPrompt({ sessionId: 'session-new', teamId: 'product-team', text: '定向', targetMemberIds: ['product_prd_agent'] })
    expect(prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '@product_prd_agent 定向' }], 'queue')
    await expect(actions.createTeamWorkspace({ teamId: 'team-1', teamName: '增长团队', parentPath: '/tmp' })).resolves.toMatchObject({ title: '增长团队', path: '/tmp/promax-team' })
    expect(fetchMock).toHaveBeenCalledWith('/promax-workspace-api/team', expect.objectContaining({ method: 'POST' }))
    vi.unstubAllGlobals()
  })
})
