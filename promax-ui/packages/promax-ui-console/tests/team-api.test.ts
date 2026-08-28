import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  configurePromaxTeam,
  instantiatePromaxTeam,
  routedTeamPrompt,
} from '../src/client/team-api.ts'

const definition = {
  api_version: 'promax.ai/v1alpha2',
  kind: 'TeamDefinition',
  metadata: { team_id: 'team-growth', display_name: '增长团队', description: '增长协作团队。' },
  spec: {
    coordinator: { member_id: 'growth_lead', display_name: '增长负责人', module_ref: 'team-coordinator@1', role_instructions: '拆解并终审。' },
    members: [{ member_id: 'growth_worker', display_name: '增长研究员', module_ref: 'general-worker@1', enabled: true, role_instructions: '研究并复核。' }],
  },
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Promax dynamic team API client', () => {
  it('keeps a conversational configuration session when Agent asks for one clarification', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      status: 'collecting',
      configuration_session_id: 'promax-config-12345678-1234-1234-1234-123456789abc',
      assistant_message: '还需要确认由谁负责最终结论。',
      team: null,
      runtime_binding: null,
      warnings: [],
      review_items: [],
      next_action: 'continue-configuration',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await configurePromaxTeam({
      teamId: 'team-growth',
      teamName: '增长团队',
      workspaceRef: 'workspace-team-growth',
      configurationSessionId: null,
      source: { kind: 'prompt', prompt: '组建增长研究与复核团队' },
      documents: [],
    })

    expect(result).toEqual({
      state: 'collecting',
      configurationSessionId: 'promax-config-12345678-1234-1234-1234-123456789abc',
      message: '还需要确认由谁负责最终结论。',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      team_id: 'team-growth',
      configuration_session_id: null,
      message: '组建增长研究与复核团队',
    })
  })

  it('maps a published instantiate response into a runnable GUI team', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      api_version: 'promax.ai/v1alpha2',
      kind: 'InstantiateResponse',
      status: 'published',
      team_definition: definition,
      team_revision: { metadata: { revision: 1 } },
      preset_id: 'promax-team-growth-r1',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await instantiatePromaxTeam({
      teamId: 'team-growth',
      teamName: '增长团队',
      workspaceRef: 'workspace-team-growth',
      source: { kind: 'prompt', prompt: '组建增长研究与复核团队' },
      documents: [],
    })

    expect(result).toMatchObject({
      state: 'ready',
      coordinator: { memberId: 'growth_lead', displayName: '增长负责人' },
      members: [{ memberId: 'growth_worker', displayName: '增长研究员' }],
      revision: { revision: 1, presetId: 'promax-team-growth-r1' },
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      kind: 'InstantiateRequest',
      workspace_ref: 'workspace-team-growth',
      source: { type: 'prompt', prompt: '组建增长研究与复核团队' },
    })
  })

  it('serializes selected stable members into the Agent leading-mention contract', () => {
    expect(routedTeamPrompt('补全验收口径', ['prd_agent', 'review_agent'])).toBe('@prd_agent @review_agent 补全验收口径')
    expect(routedTeamPrompt('  交给协调者  ', [])).toBe('交给协调者')
  })

  it('rejects unsupported document names before calling the Agent API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(instantiatePromaxTeam({
      teamId: 'team-growth',
      teamName: '增长团队',
      workspaceRef: 'workspace-team-growth',
      source: { kind: 'documents', files: [{ name: 'notes.txt', bytes: 4 }] },
      documents: [{ name: 'notes.txt', bytes: 4, content: 'demo' }],
    })).rejects.toThrow('只能命名为 AGENTS.md、SOUL.md 或 SKILL.md')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not leak schema diagnostics into the product interface', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      api_version: 'promax.ai/v1alpha2',
      kind: 'ErrorResponse',
      errors: [{ field_path: '/source', message: "must have required property 'recipe_ref'" }],
    }), { status: 400, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(instantiatePromaxTeam({
      teamId: 'team-growth',
      teamName: '增长团队',
      workspaceRef: 'workspace-team-growth',
      source: { kind: 'prompt', prompt: '组建增长研究与复核团队' },
      documents: [],
    })).rejects.toThrow('团队配置没有完成，请调整描述或上传内容后重试')
  })
})
