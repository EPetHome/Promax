import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FEISHU_MCP_PACKAGE,
  FEISHU_TOOL_MAPPINGS,
  apply,
  controlTaskRunFiles,
  installCustomMcpRuntime,
  installFeishuMcpRuntime,
  prepareTaskSubmission,
  readTaskHistory,
  readTaskRunFiles,
  resolveTaskDeliverableDirectory,
  saveTaskAttachments,
  sealTaskRunManifest,
  type FeishuMcpSettings,
  type CustomMcpSettings,
} from '../../promax-bundle/src/index.ts'

let temporaryHome: string | undefined

const TEAM_REVISION = {
  api_version: 'promax.ai/v1alpha2',
  kind: 'TeamRevision',
  metadata: { team_revision_id: 'promax-product-team@r1', status: 'published' },
  spec: {
    artifacts: [
      { kind: 'prd', validation_kind: 'prd', relative_path: 'deliverables/{task_key}/prd.md', produced_by: 'solution_design' },
      { kind: 'judge-report', validation_kind: 'judge-report', relative_path: '.promax/judge/{task_key}/judge.md', produced_by: 'quality_judge' },
    ],
    domain_rubrics: { prd: { display_name: 'PRD', rules: [{ rule_id: 'PRD_REQUIRED_SECTIONS', check: 'check' }] } },
  },
}

afterEach(async () => {
  if (temporaryHome !== undefined) await rm(temporaryHome, { recursive: true, force: true })
  temporaryHome = undefined
  delete process.env.PROMAX_GENERAL_WORKSPACE
  delete process.env.PROMAX_PRODUCT_WORKSPACE
})

describe('Promax bundle config policy', () => {
  it('packages the fixed product preset and a tool-free 0-artifact general preset', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/package-distribution.mjs'), 'utf8')
    const packageManifest = readFileSync(resolve(process.cwd(), 'packages/promax-bundle/package.json'), 'utf8')
    const generalPreset = readFileSync(resolve(process.cwd(), 'packages/promax-bundle/presets/general/agent.cordis.yml'), 'utf8')
    expect(source).toContain('PRODUCT_SOURCE="$HARNESS_ROOT/generated/promax-team"')
    expect(source).not.toMatch(/promax-team-[a-z0-9]+-r\d+/u)
    expect(source).toContain('promax-bundle/presets/general')
    expect(JSON.parse(packageManifest).files).toContain('presets')
    expect(generalPreset).toContain('草稿阶段产生 0 份正式产物')
    expect(generalPreset).not.toMatch(/dsh-tool-(?:fs|bash)|subagent|team-harness/u)
  })

  it('disables only the approved shell rows and assembles Promax plus required web rows', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-bundle/cordis.patch.yml'), 'utf8')
    const topLevelOperations = source.split('\n').filter(line => /^-\s/u.test(line))
    const insertedIds = [...source.matchAll(/^[ \t]+- id:\s+(\S+)\s*$/gmu)].map(match => match[1])

    expect(topLevelOperations).toEqual(['- id: ui-layout', '- id: ui-sidebar', '- id: ui-brand-official', '- id: web-search-deepseek', '- id: tool-web', '- insert:'])
    expect(insertedIds).toEqual([
      'web-fetch-http',
      'promax-workspace-bootstrap',
      'promax-team-harness',
      'promax-ui-console',
      'promax-ui-layout',
      'promax-ui-brand',
      'promax-report',
    ])
    expect(insertedIds.filter(id => id !== 'web-fetch-http').every(id => id?.startsWith('promax-'))).toBe(true)
    const targetedDshIds = [...source.matchAll(/^- id:\s+(\S+)\s*$/gmu)].map(match => match[1])
    expect(targetedDshIds).toEqual(['ui-layout', 'ui-sidebar', 'ui-brand-official', 'web-search-deepseek', 'tool-web'])
    expect(source.match(/^\s+disabled:\s+true$/gmu)).toHaveLength(3)
    expect(source).toContain("name: '@deepseek-ai/dsh-tool-web'")
    expect(source).toContain("name: '@deepseek-ai/dsh-web-fetch-http'")
    expect(source).toContain("name: '@deepseek-ai/dsh-web-search-deepseek'")
    expect(source).toContain('apiKeyEnv: DEEPSEEK_API_KEY')
  })

  it('runs the one preconfigured Feishu server from credential refs and reports actual registered tools without persisting secrets', async () => {
    let state: FeishuMcpSettings | undefined
    let watcher: ((next: FeishuMcpSettings, previous: FeishuMcpSettings) => void | Promise<void>) | undefined
    let toolSchemas: Array<{ name: string }> = []
    const updates: Array<Partial<FeishuMcpSettings>> = []
    const plugin = vi.fn(async (_plugin: unknown, _config: Record<string, unknown>) => {
      setTimeout(() => { toolSchemas = [{ name: 'mcp__feishu__search_docs' }, { name: 'read' }] }, 50)
      return { dispose: vi.fn() }
    })
    const runtime = {
      settings: {
        register: <T>(_ns: string, _schema: unknown, options: { base: T }) => {
          state = options.base as FeishuMcpSettings
          return {
            get: () => state as T,
            watch: (listener: (next: T, previous: T) => void | Promise<void>) => {
              watcher = listener as typeof watcher
              return () => {}
            },
            update: async (patch: Partial<T>) => {
              const previous = state!
              updates.push(patch as Partial<FeishuMcpSettings>)
              state = { ...previous, ...patch as Partial<FeishuMcpSettings> }
              await watcher?.(state, previous)
              return state as T
            },
          }
        },
      },
      credentials: { resolve: vi.fn(async (ref: string) => ({ value: ref === 'APP_ID' ? 'cli_demo_app_id' : 'cli_demo_app_secret', source: 'file' })) },
      tools: { schemas: () => toolSchemas, register: vi.fn(() => vi.fn()), get: vi.fn(), execute: vi.fn() },
      plugin,
      effect: (setup: () => unknown) => { setup() },
      on: vi.fn(),
    }

    installFeishuMcpRuntime(runtime as never)
    await vi.waitFor(() => { expect(state).toBeDefined() })
    const previous = state!
    state = { ...previous, enabled: true, probe: 1 }
    watcher?.(state, previous)
    await vi.waitFor(() => { expect(state?.connection.state).toBe('connected') })

    expect(plugin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      serverName: 'feishu', transport: 'stdio', command: 'npx', args: ['-y', FEISHU_MCP_PACKAGE, 'mcp'],
    }))
    expect(state?.connection.tools).toEqual(['mcp__feishu__search_docs'])
    expect(JSON.stringify(updates)).not.toContain('cli_demo_app_id')
    expect(JSON.stringify(updates)).not.toContain('cli_demo_app_secret')
  })

  it('reports a sanitized Feishu state when credential resolution fails', async () => {
    let state: FeishuMcpSettings | undefined
    let watcher: ((next: FeishuMcpSettings, previous: FeishuMcpSettings) => void | Promise<void>) | undefined
    const updates: Array<Partial<FeishuMcpSettings>> = []
    const runtime = {
      settings: {
        register: <T>(_ns: string, _schema: unknown, options: { base: T }) => {
          state = options.base as FeishuMcpSettings
          return {
            get: () => state as T,
            watch: (listener: (next: T, previous: T) => void | Promise<void>) => {
              watcher = listener as typeof watcher
              return () => {}
            },
            update: async (patch: Partial<T>) => {
              const previous = state!
              updates.push(patch as Partial<FeishuMcpSettings>)
              state = { ...previous, ...patch as Partial<FeishuMcpSettings> }
              await watcher?.(state, previous)
              return state as T
            },
          }
        },
      },
      credentials: { resolve: vi.fn(async () => { throw new Error('secret-bearing credential backend response') }) },
      tools: { schemas: vi.fn(() => []), register: vi.fn(() => vi.fn()), get: vi.fn(), execute: vi.fn() },
      plugin: vi.fn(),
      effect: (setup: () => unknown) => { setup() },
      on: vi.fn(),
    }

    installFeishuMcpRuntime(runtime as never)
    await vi.waitFor(() => { expect(state).toBeDefined() })
    const previous = state!
    state = { ...previous, enabled: true, probe: 1 }
    watcher?.(state, previous)
    await vi.waitFor(() => { expect(state?.connection.state).toBe('error') })

    expect(state?.connection.message).toBe('飞书 MCP 凭据状态读取失败；未记录错误正文，避免凭据进入日志或设置')
    expect(JSON.stringify(updates)).not.toContain('secret-bearing credential backend response')
    expect(runtime.plugin).not.toHaveBeenCalled()
  })

  it('runs custom stdio and streamable-http entries and reports their actual registered tools without persisting secrets', async () => {
    let state: CustomMcpSettings | undefined
    let watcher: ((next: CustomMcpSettings, previous: CustomMcpSettings) => void | Promise<void>) | undefined
    const updates: Array<Partial<CustomMcpSettings>> = []
    const toolSchemas: Array<{ name: string }> = []
    const plugin = vi.fn(async (_plugin: unknown, config: Record<string, unknown>) => {
      toolSchemas.push({ name: `mcp__${String(config.serverName)}__ping` })
      return { dispose: vi.fn() }
    })
    const runtime = {
      settings: {
        register: <T>(_ns: string, _schema: unknown, options: { base: T }) => {
          state = options.base as CustomMcpSettings
          return {
            get: () => state as T,
            watch: (listener: (next: T, previous: T) => void | Promise<void>) => {
              watcher = listener as typeof watcher
              return () => {}
            },
            update: async (patch: Partial<T>) => {
              const previous = state!
              updates.push(patch as Partial<CustomMcpSettings>)
              state = { ...previous, ...patch as Partial<CustomMcpSettings> }
              await watcher?.(state, previous)
              return state as T
            },
          }
        },
      },
      credentials: { resolve: vi.fn(async (ref: string) => ({ value: `${ref}-ONLY-IN-PLUGIN`, source: 'file' })) },
      tools: { schemas: () => toolSchemas, register: vi.fn(() => vi.fn()), get: vi.fn(), execute: vi.fn() },
      plugin,
      effect: (setup: () => unknown) => { setup() },
      on: vi.fn(),
    }

    installCustomMcpRuntime(runtime as never)
    await vi.waitFor(() => { expect(state).toBeDefined() })
    const previous = state!
    const emptyConnection = { probe: 1, state: 'connecting' as const, tools: [], checkedAt: '', message: '等待连接' }
    state = { entries: [
      { serverName: 'stdio-demo', displayName: 'stdio demo', transport: 'stdio', command: 'node', args: ['server.js'], url: '', env: [{ name: 'TOKEN', ref: 'STDIO_TOKEN' }], headers: [], enabled: true, probe: 1, connection: emptyConnection },
      { serverName: 'http-demo', displayName: 'http demo', transport: 'streamable-http', command: '', args: [], url: 'https://mcp.example/mcp', env: [], headers: [{ name: 'Authorization', ref: 'HTTP_AUTH' }], enabled: true, probe: 1, connection: emptyConnection },
    ] }
    watcher?.(state, previous)
    await vi.waitFor(() => { expect(state?.entries.every(entry => entry.connection.state === 'connected')).toBe(true) })

    expect(plugin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      serverName: 'stdio-demo', transport: 'stdio', command: 'node', args: ['server.js'], env: { TOKEN: 'STDIO_TOKEN-ONLY-IN-PLUGIN' },
    }))
    expect(plugin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      serverName: 'http-demo', transport: 'streamable-http', url: 'https://mcp.example/mcp', headers: { Authorization: 'HTTP_AUTH-ONLY-IN-PLUGIN' },
    }))
    expect(state?.entries.map(entry => entry.connection.tools)).toEqual([['mcp__stdio-demo__ping'], ['mcp__http-demo__ping']])
    expect(JSON.stringify(updates)).not.toContain('ONLY-IN-PLUGIN')
  })

  it('publishes one explicit OpenClaw mapping table and converts every supported alias for lark-mcp', async () => {
    expect(FEISHU_TOOL_MAPPINGS.map(mapping => ({
      tool: mapping.openClawTool,
      actions: mapping.actions,
      unsupported: mapping.unsupportedReason !== undefined,
    }))).toEqual([
      { tool: 'feishu_bitable_app', actions: { create: 'mcp__feishu__bitable_v1_app_create' }, unsupported: false },
      { tool: 'feishu_bitable_app_table', actions: { list: 'mcp__feishu__bitable_v1_appTable_list' }, unsupported: false },
      { tool: 'feishu_bitable_app_table_field', actions: { list: 'mcp__feishu__bitable_v1_appTableField_list' }, unsupported: false },
      { tool: 'feishu_bitable_app_table_record', actions: {
        create: 'mcp__feishu__bitable_v1_appTableRecord_create',
        list: 'mcp__feishu__bitable_v1_appTableRecord_search',
        search: 'mcp__feishu__bitable_v1_appTableRecord_search',
      }, unsupported: false },
      { tool: 'feishu_spreadsheet_sheet', actions: {}, unsupported: true },
      { tool: 'feishu_docx_import', actions: { create: 'mcp__feishu__docx_builtin_import' }, unsupported: false },
      { tool: 'feishu_docx_raw_content', actions: { read: 'mcp__feishu__docx_v1_document_rawContent' }, unsupported: false },
      { tool: 'feishu_spreadsheet_sheet_range_read', actions: {}, unsupported: true },
    ])

    interface CapturedDefinition {
      name: string
      description: string
      execute(args: unknown, exec: {
        callId: string
        rootCallId: string
        token: symbol
        signal: AbortSignal
        deferContext(context: unknown): void
        concludeTurn(): void
      }): Promise<unknown>
    }
    let state: FeishuMcpSettings | undefined
    const registered = new Map<string, CapturedDefinition>()
    const childRegistered = new Map<string, CapturedDefinition>()
    let agentCreated: ((payload: unknown) => void) | undefined
    const targetNames = new Set(FEISHU_TOOL_MAPPINGS.flatMap(mapping => Object.values(mapping.actions)))
    const executions: Array<{ name: string; arguments: unknown }> = []
    const runtime = {
      settings: {
        register: <T>(_ns: string, _schema: unknown, options: { base: T }) => {
          state = options.base as FeishuMcpSettings
          return {
            get: () => state as T,
            watch: vi.fn(() => () => {}),
            update: async (patch: Partial<T>) => {
              state = { ...state!, ...patch as Partial<FeishuMcpSettings> }
              return state as T
            },
          }
        },
      },
      credentials: { resolve: vi.fn(async (ref: string) => ({ value: `${ref}-configured`, source: 'test' })) },
      tools: {
        schemas: () => [...targetNames].map(name => ({ name })),
        register: (definition: CapturedDefinition) => {
          registered.set(definition.name, definition)
          return () => { registered.delete(definition.name) }
        },
        get: (name: string) => targetNames.has(name) ? { name } : registered.get(name),
        execute: vi.fn(async (input: { name: string; arguments: unknown }) => {
          executions.push(input)
          const value = { content: [{ type: 'text', text: 'mapped-ok' }] }
          return { isError: false, value, content: value.content }
        }),
      },
      plugin: vi.fn(async () => ({ dispose: vi.fn() })),
      effect: (setup: () => unknown) => { setup() },
      on: vi.fn((event: string, listener: (payload: unknown) => void) => {
        if (event === 'agent/created') agentCreated = listener
      }),
    }
    installFeishuMcpRuntime(runtime as never)
    expect(agentCreated).toBeDefined()
    let childMemberId = 'requirement_management'
    const childCtx = {
      agent: {},
      tools: {
        schemas: vi.fn(() => []),
        register: (definition: CapturedDefinition) => {
          childRegistered.set(definition.name, definition)
          return () => { childRegistered.delete(definition.name) }
        },
        get: vi.fn(),
        execute: vi.fn(),
      },
      systemPrompt: {
        assemble: vi.fn(async () => ({ sections: [{ name: 'deployment:persona', text: `PROMAX_MEMBER_ID:${childMemberId}\n` }] })),
      },
      effect: (setup: () => unknown) => { setup() },
    }
    agentCreated!({ agent: { session: { header: { origin: 'subagent' } }, ctx: childCtx } })
    expect([...childRegistered.keys()]).toEqual(FEISHU_TOOL_MAPPINGS.map(mapping => mapping.openClawTool))
    state = { ...state!, enabled: true, connection: { ...state!.connection, state: 'connected' } }
    const context = {
      callId: 'feishu-alias-test',
      rootCallId: 'feishu-alias-test',
      token: Symbol('feishu-alias-test'),
      agent: { id: 'requirement-management-child' },
      signal: new AbortController().signal,
      deferContext: vi.fn(),
      concludeTurn: vi.fn(),
    }

    await childRegistered.get('feishu_bitable_app')!.execute({
      action: 'create', name: '需求台账', folder_token: 'folder-demo', time_zone: 'Asia/Shanghai', useUAT: false,
    }, context)
    await childRegistered.get('feishu_bitable_app_table')!.execute({
      app_token: 'app-demo', page_token: 'page-demo', page_size: 50,
    }, context)
    await childRegistered.get('feishu_bitable_app_table_field')!.execute({
      app_token: 'app-demo', table_id: 'table-demo', view_id: 'view-demo', text_field_as_array: false,
    }, context)
    const record = childRegistered.get('feishu_bitable_app_table_record')!
    await record.execute({
      action: 'create', app_token: 'app-demo', table_id: 'table-demo', fields: { 标题: '真实写入' }, client_token: '00000000-0000-4000-8000-000000000001',
    }, context)
    await record.execute({ app_token: 'app-demo', table_id: 'table-demo', page_size: 500 }, context)
    await childRegistered.get('feishu_docx_import')!.execute({ markdown: '# 明细', file_name: '明细文档' }, context)
    await childRegistered.get('feishu_docx_raw_content')!.execute({ document_id: 'doc-demo', lang: 0 }, context)

    expect(executions.map(({ name, arguments: callArguments }) => ({ name, arguments: callArguments }))).toEqual([
      {
        name: 'mcp__feishu__bitable_v1_app_create',
        arguments: {
          data: { name: '需求台账', folder_token: 'folder-demo', time_zone: 'Asia/Shanghai' },
          useUAT: false,
        },
      },
      {
        name: 'mcp__feishu__bitable_v1_appTable_list',
        arguments: { path: { app_token: 'app-demo' }, params: { page_token: 'page-demo', page_size: 50 } },
      },
      {
        name: 'mcp__feishu__bitable_v1_appTableField_list',
        arguments: {
          path: { app_token: 'app-demo', table_id: 'table-demo' },
          params: { view_id: 'view-demo', text_field_as_array: false },
        },
      },
      {
        name: 'mcp__feishu__bitable_v1_appTableRecord_create',
        arguments: {
          data: { fields: { 标题: '真实写入' } },
          path: { app_token: 'app-demo', table_id: 'table-demo' },
          params: { client_token: '00000000-0000-4000-8000-000000000001' },
        },
      },
      {
        name: 'mcp__feishu__bitable_v1_appTableRecord_search',
        arguments: { path: { app_token: 'app-demo', table_id: 'table-demo' }, params: { page_size: 500 } },
      },
      {
        name: 'mcp__feishu__docx_builtin_import',
        arguments: { data: { markdown: '# 明细', file_name: '明细文档' } },
      },
      {
        name: 'mcp__feishu__docx_v1_document_rawContent',
        arguments: { path: { document_id: 'doc-demo' }, params: { lang: 0 } },
      },
    ])
    expect(runtime.tools.execute).not.toHaveBeenCalledWith(expect.objectContaining({ agent: expect.anything() }))
    expect([...childRegistered.values()].every(definition => definition.description.includes('身份不可得时继续执行并记为匿名 / unknown'))).toBe(true)
    childMemberId = 'solution_design'
    await expect(childRegistered.get('feishu_bitable_app')!.execute({
      action: 'create', name: '不应创建',
    }, context)).rejects.toThrow('feishu_bitable_app 仅允许 requirement_management')
  })

  it('returns actionable Chinese errors for missing credentials and capabilities absent from lark-mcp', async () => {
    interface CapturedDefinition {
      name: string
      execute(args: unknown, exec: { callId: string; rootCallId: string; token: symbol; signal: AbortSignal; deferContext(context: unknown): void; concludeTurn(): void }): Promise<unknown>
    }
    let state: FeishuMcpSettings | undefined
    const registered = new Map<string, CapturedDefinition>()
    let credentialsConfigured = false
    const runtime = {
      settings: {
        register: <T>(_ns: string, _schema: unknown, options: { base: T }) => {
          state = options.base as FeishuMcpSettings
          return {
            get: () => state as T,
            watch: vi.fn(() => () => {}),
            update: async (patch: Partial<T>) => {
              state = { ...state!, ...patch as Partial<FeishuMcpSettings> }
              return state as T
            },
          }
        },
      },
      credentials: { resolve: vi.fn(async () => credentialsConfigured ? { value: 'configured', source: 'test' } : undefined) },
      tools: {
        schemas: vi.fn(() => []),
        register: (definition: CapturedDefinition) => { registered.set(definition.name, definition); return vi.fn() },
        get: vi.fn(),
        execute: vi.fn(),
      },
      plugin: vi.fn(),
      effect: (setup: () => unknown) => { setup() },
      on: vi.fn(),
    }
    installFeishuMcpRuntime(runtime as never)
    const context = {
      callId: 'feishu-error-test', rootCallId: 'feishu-error-test', token: Symbol('feishu-error-test'), signal: new AbortController().signal,
      deferContext: vi.fn(), concludeTurn: vi.fn(),
    }

    await expect(registered.get('feishu_bitable_app_table_record')!.execute({
      action: 'create', app_token: 'app-demo', table_id: 'table-demo', fields: { 标题: '不会写入' },
    }, context)).rejects.toThrow('飞书凭据未配置：请到“设置 → 连接”展开飞书条目')

    credentialsConfigured = true
    state = { ...state!, enabled: true }
    await expect(registered.get('feishu_spreadsheet_sheet')!.execute({
      action: 'list', spreadsheet_token: 'sheet-demo',
    }, context)).rejects.toThrow('Skill pm-weekly-monitor 需要工具 feishu_spreadsheet_sheet（action=list）；当前 @larksuiteoapi/lark-mcp 0.5.1 的 tools/list 中没有飞书电子表格工作表能力，未创建伪映射。')
  })

  it('bootstraps the direct-demand workspace without draft directories', async () => {
    temporaryHome = await mkdtemp(join(tmpdir(), 'promax-bundle-test-'))
    process.env.PROMAX_GENERAL_WORKSPACE = join(temporaryHome, 'general')
    process.env.PROMAX_PRODUCT_WORKSPACE = join(temporaryHome, 'product')
    let workspaceOrdinal = 0
    const create = vi.fn(async (path: string, title?: string) => {
      workspaceOrdinal += 1
      return { id: `workspace-${workspaceOrdinal}`, path, title: title ?? 'workspace', sessionIds: [] }
    })
    const register = vi.fn(() => () => {})
    await apply({
      workspaceRegistry: { create },
      webServer: { register },
      settings: { register: <T>(_ns: string, _schema: unknown, options: { base: T; applies: 'live' | 'restart' }) => ({
        get: () => options.base,
        watch: vi.fn(() => () => {}),
        update: vi.fn(async (_patch: Partial<T>) => options.base),
      }) },
      credentials: { resolve: vi.fn(async () => undefined) },
      tools: { schemas: vi.fn(() => []), register: vi.fn(() => vi.fn()), get: vi.fn(), execute: vi.fn() },
      plugin: vi.fn(async () => ({ dispose: vi.fn() })),
      effect: setup => { setup() },
      on: (_event, _listener) => {},
      emit: vi.fn(),
    }, { apiBaseUrl: 'http://127.0.0.1:3100' })

    expect(create).toHaveBeenNthCalledWith(1, join(temporaryHome, 'general'), '通用')
    expect(create).toHaveBeenNthCalledWith(2, join(temporaryHome, 'product'), '产品')
    expect(readFileSync(join(temporaryHome, 'product', '.promax', 'source-ledger.md'), 'utf8')).toContain('来源台账')
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prefix',
      path: '/promax-api',
      handler: expect.any(Function) as (request: IncomingMessage, response: ServerResponse) => void,
    }))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prefix',
      path: '/promax-workspace-api',
      handler: expect.any(Function) as (request: IncomingMessage, response: ServerResponse) => void,
    }))
  })

  it('reads only manifest-registered artifacts and the independent Judge file from disk', async () => {
    temporaryHome = await mkdtemp(join(tmpdir(), 'promax-manifest-state-'))
    const productRoot = join(temporaryHome, 'product')
    await mkdir(productRoot, { recursive: true })
    const prepared = await prepareTaskSubmission({
      workspacePath: productRoot,
      sessionId: 'session-demo',
      demand: '为会员续费提醒生成简短 PRD',
      attachmentPaths: [],
      frozenAt: '2026-09-03T12:00:00.000Z',
    })
    await sealTaskRunManifest(productRoot, {
      sessionId: 'session-demo',
      taskKey: prepared.taskKey,
      confirmedAt: '2026-09-03T12:01:00.000Z',
      confirmedMemberIds: ['solution_design', 'quality_judge'],
      artifacts: [
        { path: `deliverables/${prepared.taskKey}/prd.md`, memberId: 'solution_design' },
        { path: `.promax/judge/${prepared.taskKey}/judge.md`, memberId: 'quality_judge' },
      ],
      teamRevision: TEAM_REVISION,
    })

    const inputManifestText = readFileSync(prepared.manifestPath, 'utf8')
    expect(inputManifestText).not.toContain('members_confirmed:')
    const manifestText = readFileSync(join(productRoot, '.promax', 'tasks', prepared.taskKey, 'task-package.yml'), 'utf8')
    expect(manifestText).toContain('members_confirmed:')
    expect(manifestText).toContain(`relative_path: deliverables/${prepared.taskKey}/prd.md`)
    expect(manifestText).toContain('validation_kind: prd')
    expect(await readdir(join(productRoot, '.promax', 'tasks', prepared.taskKey))).toEqual(['run-control.yml', 'task-package.yml'])

    await mkdir(join(productRoot, 'deliverables', prepared.taskKey), { recursive: true })
    await writeFile(join(productRoot, 'deliverables', prepared.taskKey, 'unrequested.md'), '# 不应展示\n')
    let live = await readTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: prepared.taskKey })
    expect(live.artifactStates).toEqual([{
      path: `deliverables/${prepared.taskKey}/prd.md`,
      memberId: 'solution_design',
      exists: false,
      nonEmpty: false,
    }])
    expect(live.createdAt).toBe('2026-09-03T12:00:00.000Z')
    expect(live.deliverablePath).toBe(`deliverables/${prepared.taskKey}`)
    expect(live.deliverableFiles.map(file => file.relativePath)).toEqual(['unrequested.md'])
    expect(live.judge).toMatchObject({ state: 'absent', exists: false, nonEmpty: false })

    await writeFile(join(productRoot, 'deliverables', prepared.taskKey, 'prd.md'), '# 续费提醒 PRD\n')
    await mkdir(join(productRoot, '.promax', 'judge', prepared.taskKey), { recursive: true })
    await writeFile(join(productRoot, '.promax', 'judge', prepared.taskKey, 'judge.md'), '整体 verdict=**passed（不阻断）**\n')
    live = await readTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: prepared.taskKey })
    expect(live.artifactStates[0]).toMatchObject({ exists: true, nonEmpty: true })
    expect(live.judge.state).toBe('pass')
    expect(live.deliverableFiles.map(file => file.relativePath)).toEqual(['prd.md', 'unrequested.md'])
    await expect(resolveTaskDeliverableDirectory(productRoot, { sessionId: 'session-demo', taskKey: prepared.taskKey })).resolves.toBe(join(productRoot, 'deliverables', prepared.taskKey))
    await expect(readTaskHistory(productRoot)).resolves.toMatchObject([{
      sessionId: 'session-demo',
      taskKey: prepared.taskKey,
      status: 'completed',
      fileCount: 2,
    }])

    await writeFile(join(productRoot, '.promax', 'judge', prepared.taskKey, 'judge.md'), [
      '# Judge',
      '### OUTPUT_SELF_CONTRADICTION — fail',
      '',
      '产物中的总数与明细相互矛盾。',
      '',
      '## 最终 verdict',
      '**fail**',
      '最终判定：FAIL',
    ].join('\n'))
    live = await readTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: prepared.taskKey })
    expect(live.judge).toMatchObject({ state: 'fail', reason: '产物中的总数与明细相互矛盾。' })
    await expect(readTaskHistory(productRoot)).resolves.toMatchObject([{ status: 'failed', fileCount: 2 }])
    await writeFile(join(productRoot, '.promax', 'judge', prepared.taskKey, 'judge.md'), '最终判定：PASS\n')

    await controlTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: prepared.taskKey, state: 'stop_requested', runEpoch: 1, updatedAt: '2026-09-03T12:10:00.000Z' })
    await controlTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: prepared.taskKey, state: 'draining', runEpoch: 1, updatedAt: '2026-09-03T12:10:01.000Z' })
    await controlTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: prepared.taskKey, state: 'cancelled', runEpoch: 1, updatedAt: '2026-09-03T12:10:02.000Z' })
    expect((await readTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: prepared.taskKey })).cancellation).toBe('cancelled')
  })

  it('stores demand attachments under the session source-file directory', async () => {
    temporaryHome = await mkdtemp(join(tmpdir(), 'promax-attachments-test-'))
    const paths = await saveTaskAttachments(temporaryHome, 'session-1', [{
      name: 'brief.txt',
      mediaType: 'text/plain',
      contentBase64: Buffer.from('brief body').toString('base64'),
    }])

    expect(paths).toEqual(['输入/源文件/session-1/brief.txt'])
    expect(readFileSync(join(temporaryHome, '输入', '源文件', 'session-1', 'brief.txt'), 'utf8')).toBe('brief body')
    await expect(saveTaskAttachments(temporaryHome, 'session-2', [{
      name: '../outside.txt',
      contentBase64: Buffer.from('unsafe').toString('base64'),
    }])).rejects.toThrow('附件名称格式无效')
  })

  it('suffixes repeated attachment names and rejects unsupported or oversized files in Chinese', async () => {
    temporaryHome = await mkdtemp(join(tmpdir(), 'promax-attachments-policy-'))
    const contentBase64 = Buffer.from('same name').toString('base64')
    const paths = await saveTaskAttachments(temporaryHome, 'session-repeat', [
      { name: 'brief.txt', contentBase64 },
      { name: 'brief.txt', contentBase64 },
    ])
    const third = await saveTaskAttachments(temporaryHome, 'session-repeat', [{ name: 'brief.txt', contentBase64 }])

    expect(paths).toEqual(['输入/源文件/session-repeat/brief.txt', '输入/源文件/session-repeat/brief（2）.txt'])
    expect(third).toEqual(['输入/源文件/session-repeat/brief（3）.txt'])
    await expect(saveTaskAttachments(temporaryHome, 'session-exe', [{ name: 'setup.exe', contentBase64 }])).rejects.toThrow('不支持文件“setup.exe”。支持的格式：')
    await expect(saveTaskAttachments(temporaryHome, 'session-image', [{ name: 'screen.png', contentBase64 }])).rejects.toThrow('图片请用对话框内的图片功能')
    await expect(saveTaskAttachments(temporaryHome, 'session-large', [{
      name: 'large.txt',
      contentBase64: Buffer.alloc(20 * 1024 * 1024 + 1).toString('base64'),
    }])).rejects.toThrow('附件总大小不能超过 20 MiB')
  })

})
