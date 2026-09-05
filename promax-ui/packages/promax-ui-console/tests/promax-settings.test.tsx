import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  FEISHU_MCP_PACKAGE,
  PromaxSettingsError,
  PromaxSettingsPanel,
  connectionTypeLabel,
  createPromaxSettingsService,
  credentialRefForProvider,
  validateProviderId,
  validateWriteOnlySecret,
  type PromaxSettingsConnection,
  type PromaxSettingsService,
  type PromaxSettingsSnapshot,
  type SettingsNamespaceView,
} from '../src/client/PromaxSettings.tsx'

function namespace(ns: string, value: unknown, revision: number): SettingsNamespaceView {
  return { ns, value, revision, schema: {}, applies: 'live', secrets: [] }
}

const baseNamespaces = (): SettingsNamespaceView[] => [
  namespace('llm-deepseek', {
    displayName: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseURL: 'https://api.deepseek.com',
    models: [{ id: 'deepseek-chat' }],
  }, 3),
  namespace('llm-pi-ai', {
    providers: {
      'configured-gateway': {
        displayName: 'Configured Gateway',
        apiKeyEnv: 'CONFIGURED_GATEWAY_API_KEY',
        baseURL: 'https://gateway.example/v1',
        api: 'openai-completions',
        models: [{ id: 'public-demo-model' }],
      },
    },
  }, 7),
  namespace('promax-feishu-mcp', {
    enabled: false,
    probe: 0,
    connection: { probe: 0, state: 'disabled', tools: [], checkedAt: '', message: '飞书 MCP 未启用' },
  }, 4),
  namespace('promax-feishu-telemetry', {
    appToken: 'base_demo_token',
    folderToken: 'folder_demo_token',
  }, 6),
  namespace('promax-connections', { entries: [] }, 2),
]

function connection(overrides: {
  mutate?: PromaxSettingsConnection['api']['settings']['mutate']
  credentialSet?: PromaxSettingsConnection['api']['credentials']['set']
  namespaces?: SettingsNamespaceView[]
} = {}): PromaxSettingsConnection {
  const namespaces = overrides.namespaces ?? baseNamespaces()
  return {
    api: {
      settings: {
        describe: vi.fn(async () => ({ result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces } } })),
        mutate: overrides.mutate ?? vi.fn(async () => ({ result: { ok: true as const, value: namespaces[1]! } })),
      },
      credentials: {
        describe: vi.fn(async ({ refs }: { refs: string[] }) => ({
          result: {
            ok: true as const,
            value: { credentials: Object.fromEntries(refs.map(ref => [ref, { configured: ref !== 'APP_SECRET', source: 'file', writable: true }])) },
          },
        })),
        set: overrides.credentialSet ?? vi.fn(async () => ({ result: { ok: true as const, value: {} } })),
      },
    },
  }
}

function snapshot(): PromaxSettingsSnapshot {
  const feishu = {
    enabled: true,
    revision: 4,
    connection: { probe: 12, state: 'connected' as const, tools: ['mcp__feishu__search_docs'], checkedAt: '2026-09-02T12:00:00.000Z', message: '已注册 1 个飞书工具' },
    credentials: {
      APP_ID: { configured: true, source: 'file', writable: true },
      APP_SECRET: { configured: false, writable: true },
    },
    telemetry: { appToken: 'base_demo_token', folderToken: 'folder_demo_token', revision: 6 },
  }
  const customConnection = {
    serverName: 'demo', displayName: 'Demo MCP', transport: 'stdio' as const, command: 'node', args: ['server.js'], url: '', env: [], headers: [], enabled: true, probe: 8,
    connection: { probe: 8, state: 'connected' as const, tools: ['mcp__demo__ping'], checkedAt: '2026-09-02T12:01:00.000Z', message: '已注册 1 个 MCP 工具' },
  }
  return {
    writable: true,
    providers: [
      { id: 'deepseek', displayName: 'DeepSeek', adapter: 'llm-deepseek', apiKeyEnv: 'DEEPSEEK_API_KEY', models: ['deepseek-chat'] },
    ],
    piAiRevision: 7,
    providerCredentialStates: { DEEPSEEK_API_KEY: { configured: true, source: 'env', writable: false } },
    feishu,
    connectionsRevision: 2,
    customConnections: [customConnection],
    connections: [
      {
        id: 'builtin:feishu', displayName: '飞书', type: 'builtin-adapter', serverName: 'feishu', enabled: true, revision: 4, probe: 12, connection: feishu.connection,
        credentials: [{ name: 'APP_ID', configured: true, source: 'file', writable: true }, { name: 'APP_SECRET', configured: false, writable: true }],
        definition: [{ label: 'serverName', value: 'feishu' }, { label: '包名', value: FEISHU_MCP_PACKAGE }, { label: 'transport', value: 'stdio' }, { label: 'command', value: `npx -y ${FEISHU_MCP_PACKAGE} mcp` }], builtin: true,
      },
      {
        id: 'mcp:demo', displayName: 'Demo MCP', type: 'mcp-stdio', serverName: 'demo', enabled: true, revision: 2, probe: 8, connection: customConnection.connection,
        credentials: [], definition: [{ label: 'serverName', value: 'demo' }, { label: 'transport', value: 'stdio' }, { label: 'command', value: 'node' }, { label: 'args', value: 'server.js' }], builtin: false,
      },
    ],
  }
}

function panelService(overrides: Partial<PromaxSettingsService> = {}): PromaxSettingsService {
  return {
    load: vi.fn(async () => snapshot()),
    createProvider: vi.fn(),
    createConnection: vi.fn(async () => namespace('promax-connections', { entries: [] }, 3)),
    setFeishuCredentials: vi.fn(),
    setFeishuTelemetry: vi.fn(async () => namespace('promax-feishu-telemetry', {}, 7)),
    setConnectionEnabled: vi.fn(async () => namespace('promax-connections', { entries: [] }, 3)),
    testConnection: vi.fn(async entry => entry.connection),
    ...overrides,
  }
}

describe('Promax self-owned settings', () => {
  it('lists only configured providers and preserves the existing DeepSeek route', async () => {
    const service = createPromaxSettingsService(connection())
    const loaded = await service.load()
    expect(loaded.providers.map(provider => provider.id)).toEqual(['deepseek', 'configured-gateway'])
    expect(loaded.providers[0]).toMatchObject({ id: 'deepseek', adapter: 'llm-deepseek', models: ['deepseek-chat'] })
    expect(loaded.providers.some(provider => provider.id === 'unconfigured-catalog-route')).toBe(false)
  })

  it('rejects invalid provider ids and unsafe pasted API keys before any write', () => {
    expect(validateProviderId('gateway-1')).toBe('gateway-1')
    for (const invalid of ['1gateway', 'Gateway', 'gateway_name', '']) expect(() => validateProviderId(invalid)).toThrow()
    expect(validateWriteOnlySecret('  sk-safe_123  ')).toBe('sk-safe_123')
    for (const invalid of ['', 'API_KEY=sk-demo', '"sk-demo"', "'sk-demo'", 'sk demo', 'sk\ndemo']) {
      expect(() => validateWriteOnlySecret(invalid)).toThrow()
    }
  })

  it('writes the provider with its revision and sends the secret only through credentials.set', async () => {
    window.localStorage.clear()
    const sentinel = 'sk-ONLY-WRITE-TO-CREDENTIALS'
    const mutate = vi.fn(async () => ({ result: { ok: true as const, value: namespace('llm-pi-ai', {}, 8) } }))
    const credentialSet = vi.fn(async () => ({ result: { ok: true as const, value: {} } }))
    const api = connection({ mutate, credentialSet })
    const service = createPromaxSettingsService(api)
    await service.createProvider({
      providerId: 'acme-gateway', displayName: 'Acme', baseURL: 'https://gateway.example/v1/',
      api: 'openai-responses', models: 'model-a\nmodel-b', apiKey: sentinel,
    }, 7)

    expect(mutate).toHaveBeenCalledWith({
      ns: 'llm-pi-ai',
      ops: [{
        op: 'set', path: ['providers', 'acme-gateway'], value: {
          displayName: 'Acme', baseURL: 'https://gateway.example/v1', api: 'openai-responses',
          apiKeyEnv: credentialRefForProvider('acme-gateway'), models: [{ id: 'model-a' }, { id: 'model-b' }],
        },
      }],
      expectedRevision: 7,
    })
    expect(JSON.stringify(mutate.mock.calls)).not.toContain(sentinel)
    expect(credentialSet).toHaveBeenCalledWith({ ref: 'ACME_GATEWAY_API_KEY', value: sentinel })
    expect(JSON.stringify(window.localStorage)).not.toContain(sentinel)
  })

  it('removes a half-created provider when its write-only credential cannot be saved', async () => {
    const mutate = vi.fn()
      .mockResolvedValueOnce({ result: { ok: true as const, value: namespace('llm-pi-ai', {}, 8) } })
      .mockResolvedValueOnce({ result: { ok: true as const, value: namespace('llm-pi-ai', {}, 9) } })
    const credentialSet = vi.fn(async () => ({
      result: { ok: false as const, error: { message: 'third-party response containing secret material' } },
    }))
    const service = createPromaxSettingsService(connection({ mutate, credentialSet }))

    await expect(service.createProvider({
      providerId: 'acme', displayName: 'Acme', baseURL: 'https://example.com/v1',
      api: 'openai-completions', models: 'model-a', apiKey: 'sk-safe',
    }, 7)).rejects.toThrow('Provider 创建已撤回')

    expect(mutate).toHaveBeenNthCalledWith(2, {
      ns: 'llm-pi-ai',
      ops: [{ op: 'unset', path: ['providers', 'acme'] }],
      expectedRevision: 8,
    })
    expect(JSON.stringify(mutate.mock.calls)).not.toContain('third-party response containing secret material')
  })

  it('surfaces settings-conflict instead of silently overwriting', async () => {
    const mutate = vi.fn(async () => ({ result: { ok: false as const, error: { code: 'settings-conflict', message: 'conflict', details: { expected: 7, actual: 8 } } } }))
    const service = createPromaxSettingsService(connection({ mutate }))
    await expect(service.createProvider({
      providerId: 'acme', displayName: 'Acme', baseURL: 'https://example.com/v1',
      api: 'openai-completions', models: 'model-a', apiKey: 'sk-safe',
    }, 7)).rejects.toMatchObject({ code: 'settings-conflict' })
  })

  it('opens Feishu on a dedicated connection detail page and returns to the list', async () => {
    const service = panelService()
    render(<PromaxSettingsPanel service={service} preferences={<p>偏好内容</p>} />)
    await screen.findByRole('heading', { name: '已配置模型' })
    const nav = screen.getByRole('navigation', { name: 'Promax 设置分类' })
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['模型', '连接', '偏好'])
    expect(within(nav).queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: '飞书' })).not.toBeInTheDocument()

    fireEvent.click(within(nav).getByRole('button', { name: '连接' }))
    const feishuCard = document.querySelector('[data-connection-id="builtin:feishu"]') as HTMLElement
    expect(within(feishuCard).getByText('feishu · 内置适配')).toBeVisible()
    expect(within(feishuCard).queryByText(FEISHU_MCP_PACKAGE)).not.toBeInTheDocument()
    expect(within(feishuCard).queryByRole('button', { name: /展开/u })).not.toBeInTheDocument()

    fireEvent.click(within(feishuCard).getByRole('button', { name: '查看详情：飞书' }))
    const detail = document.querySelector('[data-connection-detail-id="builtin:feishu"]') as HTMLElement
    expect(within(detail).getByRole('heading', { name: '飞书' })).toBeVisible()
    expect(within(detail).getByText(FEISHU_MCP_PACKAGE)).toBeVisible()
    expect(within(detail).getByText('mcp__feishu__search_docs')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Promax 设置分类' })).not.toBeInTheDocument()
    fireEvent.click(within(detail).getByRole('button', { name: '连接测试：飞书' }))
    await waitFor(() => { expect(service.testConnection).toHaveBeenCalledWith(snapshot().connections[0], expect.anything()) })
    fireEvent.click(within(detail).getByRole('button', { name: '返回连接列表' }))
    expect(screen.getByRole('navigation', { name: 'Promax 设置分类' })).toBeVisible()
    expect(document.querySelector('[data-connection-id="builtin:feishu"]')).toBeVisible()
  })

  it('uses the same list-to-detail path for Feishu and a custom MCP server', async () => {
    const service = panelService()
    render(<PromaxSettingsPanel service={service} preferences={<p>偏好内容</p>} />)
    await screen.findByRole('heading', { name: '已配置模型' })
    fireEvent.click(screen.getByRole('button', { name: '连接' }))
    const cards = document.querySelectorAll('[data-connection-component="connection-card"]')
    expect(cards).toHaveLength(2)
    expect(within(cards[0] as HTMLElement).getByText(/feishu · 内置适配/u)).toBeVisible()
    expect(within(cards[1] as HTMLElement).getByText(/demo · MCP stdio/u)).toBeVisible()
    fireEvent.click(within(cards[0] as HTMLElement).getByRole('button', { name: '查看详情：飞书' }))
    fireEvent.click(screen.getByRole('button', { name: '连接测试：飞书' }))
    await waitFor(() => { expect(service.testConnection).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: '返回连接列表' }))
    const demoCard = document.querySelector('[data-connection-id="mcp:demo"]') as HTMLElement
    fireEvent.click(within(demoCard).getByRole('button', { name: '查看详情：Demo MCP' }))
    fireEvent.click(screen.getByRole('button', { name: '连接测试：Demo MCP' }))
    await waitFor(() => { expect(service.testConnection).toHaveBeenCalledTimes(2) })
  })

  it('submits a custom MCP server from the generic + Add form', async () => {
    const service = panelService()
    render(<PromaxSettingsPanel service={service} preferences={<p>偏好内容</p>} />)
    await screen.findByRole('heading', { name: '已配置模型' })
    fireEvent.click(screen.getByRole('button', { name: '连接' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 添加' }))
    fireEvent.change(screen.getByLabelText('serverName'), { target: { value: 'new-server' } })
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: 'New Server' } })
    fireEvent.change(screen.getByLabelText('command'), { target: { value: 'npx' } })
    fireEvent.change(screen.getByLabelText('args（每行一个参数）'), { target: { value: '-y\n@scope/server' } })
    fireEvent.click(screen.getByRole('button', { name: '创建连接' }))
    await waitFor(() => { expect(service.createConnection).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'new-server', displayName: 'New Server', transport: 'stdio', command: 'npx' }), expect.anything()) })
  })

  it('adds a generic MCP server and keeps secret values out of settings', async () => {
    const sentinel = 'ONLY-WRITE-CUSTOM-SECRET'
    const mutate = vi.fn(async () => ({ result: { ok: true as const, value: namespace('promax-connections', { entries: [] }, 3) } }))
    const credentialSet = vi.fn(async () => ({ result: { ok: true as const, value: {} } }))
    const service = createPromaxSettingsService(connection({ mutate, credentialSet }))
    await service.createConnection({
      serverName: 'custom-tools', displayName: 'Custom Tools', transport: 'stdio', command: 'npx', args: '-y\n@scope/server', url: '', environment: `TOKEN=${sentinel}`, headers: '', enabled: true,
    }, snapshot())
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ ns: 'promax-connections', expectedRevision: 2 }))
    expect(JSON.stringify(mutate.mock.calls)).not.toContain(sentinel)
    expect(credentialSet).toHaveBeenCalledWith({ ref: 'PROMAX_MCP_CUSTOM_TOOLS_ENV_TOKEN', value: sentinel })
  })

  it('keeps Feishu credential inputs empty and writes only the fields the user entered', async () => {
    const service = panelService({ setFeishuCredentials: vi.fn(async () => {}) })
    render(<PromaxSettingsPanel service={service} preferences={<p>偏好内容</p>} />)
    await screen.findByRole('heading', { name: '已配置模型' })
    fireEvent.click(screen.getByRole('button', { name: '连接' }))
    fireEvent.click(screen.getByRole('button', { name: '查看详情：飞书' }))
    expect(screen.getByLabelText('APP_ID（只写）')).toHaveValue('')
    expect(screen.getByLabelText('APP_SECRET（只写）')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('APP_ID（只写）'), { target: { value: 'cli_demo_app_id' } })
    fireEvent.click(screen.getByRole('button', { name: '安全保存凭据' }))
    await waitFor(() => { expect(service.setFeishuCredentials).toHaveBeenCalledWith({ appId: 'cli_demo_app_id', appSecret: '' }) })
    expect(screen.getByLabelText('APP_ID（只写）')).toHaveValue('')
  })

  it('renders a readable conflict message and reloads before retry', async () => {
    const service = panelService({
      createProvider: vi.fn(async () => { throw new PromaxSettingsError({ code: 'settings-conflict', message: 'raw conflict' }) }),
    })
    render(<PromaxSettingsPanel service={service} preferences={<p>偏好内容</p>} />)
    await screen.findByRole('heading', { name: '新增自定义 Provider' })
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://example.com/v1' } })
    fireEvent.change(screen.getByLabelText('API Key（只写）'), { target: { value: 'sk-safe' } })
    fireEvent.change(screen.getByLabelText('模型 ID 列表'), { target: { value: 'model-a' } })
    fireEvent.click(screen.getByRole('button', { name: '创建 Provider' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('设置已在另一窗口更新')
    await waitFor(() => { expect(service.load).toHaveBeenCalledTimes(2) })
  })

  it('labels reserved and unknown connection types safely', () => {
    expect(connectionTypeLabel('mcp-stdio')).toBe('MCP stdio')
    expect(connectionTypeLabel('mcp-streamable-http')).toBe('MCP streamable-http')
    expect(connectionTypeLabel('builtin-adapter')).toBe('内置适配')
    expect(connectionTypeLabel('cli')).toBe('CLI')
    expect(connectionTypeLabel('future-transport')).toBe('future-transport')
    expect(connectionTypeLabel('')).toBe('未知类型')
  })
})
