import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { apply, inject } from '../src/client/index.tsx'
import { PRODUCT_PRESET_ID, resetTeamStateForTests } from '../src/client/team-state.ts'

const runtimePresetContent = `
  ## 已发布团队快照
  - team revision：\`promax-product-team@r1\`
  - preset：\`promax-team\`
  成员：
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

  it('registers the flattened shell and exposes direct session messaging plus attachments', async () => {
    const registrations: Array<{ options: Record<string, unknown>; component: ComponentType<Record<string, unknown>> }> = []
    const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
    const rename = vi.fn(async (title: string) => ({ ok: true as const, value: { title, seq: 1 } }))
    const createSession = vi.fn(async () => ({ result: { ok: true as const, value: { sessionId: 'session-new', agentPreset: PRODUCT_PRESET_ID } } }))
    const listState = {
      ids: ['session-new'],
      byId: {
        'session-new': { id: 'session-new', displayTitle: '新需求', agentPreset: PRODUCT_PRESET_ID, running: false, blank: true, updatedAt: 1 },
      },
      current: undefined,
      phase: 'ready',
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/attachments/freeze')) return new Response(JSON.stringify({
        attachments: [{ path: '输入/源文件/session-new/brief.txt', name: 'brief.txt', mediaType: 'text/plain', bytes: 5, readablePath: '.promax/input/登录改版/sources/SRC-001/brief.txt', textCharacters: 5, excerpt: 'brief', truncated: false }],
        manifestPath: '.promax/input/登录改版/manifest.yml',
        taskKey: '登录改版',
        sessionName: '登录改版',
      }), { status: 200 })
      if (url.endsWith('/attachments')) return new Response(JSON.stringify({
        paths: ['输入/源文件/session-new/brief.txt'],
      }), { status: 200 })
      if (url.endsWith('/dispatch-plan/begin')) return new Response(JSON.stringify({ planId: 'dispatch-plan-1', taskKey: '登录改版' }), { status: 200 })
      if (url.endsWith('/dispatch-plan/confirm')) return new Response(JSON.stringify({ planId: 'dispatch-plan-1', taskKey: '登录改版', confirmedMemberIds: ['solution_design', 'quality_judge'], confirmedAt: '2026-09-03T12:00:00.000Z' }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
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
        open: vi.fn(),
        clear: vi.fn(),
        noteAgentPreset: vi.fn(),
        scope: () => ({}),
        binding: () => ({
          session: {
            getSnapshot: () => ({ running: false }),
            subscribe: () => () => {},
            prompt,
            cancel: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
            rename,
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
        rename: vi.fn(async (_workspaceId: string, title: string) => ({ workspaceId: 'workspace-new', path: '/tmp/product', title, sessionIds: [] })),
        archiveSession: vi.fn(async () => {}),
      },
      get: (name: string) => name === 'inputTriggers'
        ? {
          sessionOf: () => ({
            menu: { getSnapshot: () => ({ open: false }), subscribe: () => () => {} },
            launcher: { getSnapshot: () => null, subscribe: () => () => {} },
            toggleSource: vi.fn(),
          }),
        }
        : name === 'layout'
          ? { toggleSidebar: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn() }
          : {
            api: {
              agentPresets: {
                list: vi.fn(async () => ({
                  result: { ok: true as const, value: { presets: [{ id: PRODUCT_PRESET_ID }] } },
                })),
                read: vi.fn(async () => ({
                  result: { ok: true as const, value: { agentPreset: PRODUCT_PRESET_ID, content: runtimePresetContent } },
                })),
              },
              sessions: { create: createSession },
              subagents: { interrupt: vi.fn() },
            },
          },
    }

    resetTeamStateForTests()
    apply(context as unknown as Parameters<typeof apply>[0])

    expect(registrations.map(entry => entry.options.name)).toEqual([
      'sidebar.footer.action',
      'settings.section',
      'conversation.input.dock',
      'conversation.session.header.actions',
      'conversation.chat.assistant-actions',
      'sidebar.workspaces',
      'conversation.hero.workspace',
      'conversation.hero.agentPreset',
      'sidebar',
      'conversation.composer.bar',
      'details',
      'shell.overlay',
    ])
    expect(registrations.some(entry => entry.options.id === 'promax-preferences')).toBe(false)
    expect(registrations.some(entry => entry.options.name === 'conversation.input.left')).toBe(false)

    const shellEntry = registrations.find(entry => entry.options.name === 'shell.overlay')
    const actions = (shellEntry?.options.inject as (() => {
      startSession(workspaceId: string, presetId: string): Promise<string>
      sendSessionMessage(sessionId: string, text: string): Promise<void>
      renameSession(sessionId: string, title: string): Promise<void>
      saveTaskAttachments(input: Record<string, unknown>): Promise<{ paths: string[]; attachments: unknown[]; manifestPath: string; taskKey: string; sessionName: string }>
      beginDispatchPlan(input: Record<string, unknown>): Promise<{ planId: string; taskKey: string }>
      confirmDispatchPlan(input: Record<string, unknown>): Promise<{ planId: string; taskKey: string; confirmedMemberIds: string[]; confirmedAt: string }>
    }))()

    await expect(actions.startSession('product', PRODUCT_PRESET_ID)).resolves.toBe('session-new')
    await expect(actions.renameSession('session-new', '登录改版')).resolves.toBeUndefined()
    await expect(actions.sendSessionMessage('session-new', '登录改版')).resolves.toBeUndefined()
    await expect(actions.saveTaskAttachments({
      workspaceId: 'product',
      projectPath: '/tmp/product',
      sessionId: 'session-new',
      demand: '登录改版',
      files: [{ name: 'brief.txt', mediaType: 'text/plain', contentBase64: 'YnJpZWY=' }],
    })).resolves.toEqual({
      paths: ['输入/源文件/session-new/brief.txt'],
      attachments: [expect.objectContaining({ name: 'brief.txt', textCharacters: 5, excerpt: 'brief' })],
      manifestPath: '.promax/input/登录改版/manifest.yml',
      taskKey: '登录改版',
      sessionName: '登录改版',
    })
    await expect(actions.beginDispatchPlan({ sessionId: 'session-new', taskKey: '登录改版', rosterMemberIds: ['solution_design', 'quality_judge'] })).resolves.toEqual({ planId: 'dispatch-plan-1', taskKey: '登录改版' })
    await expect(actions.confirmDispatchPlan({ sessionId: 'session-new', planId: 'dispatch-plan-1', confirmedMemberIds: ['solution_design', 'quality_judge'] })).resolves.toEqual({ planId: 'dispatch-plan-1', taskKey: '登录改版', confirmedMemberIds: ['solution_design', 'quality_judge'], confirmedAt: '2026-09-03T12:00:00.000Z' })

    expect(createSession).toHaveBeenCalledWith({ workspaceId: 'product', agentPreset: PRODUCT_PRESET_ID })
    expect(rename).toHaveBeenCalledWith('登录改版')
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '登录改版' }], 'queue')
    expect(fetchMock).toHaveBeenCalledWith('/promax-workspace-api/attachments', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/promax-workspace-api/attachments/freeze', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/promax-workspace-api/dispatch-plan/begin', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/promax-workspace-api/dispatch-plan/confirm', expect.objectContaining({ method: 'POST' }))
    vi.unstubAllGlobals()
  })
})
