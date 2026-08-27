export interface PromateToolCall {
  token: string
  requestId: string
  tool: string
  arguments: Record<string, unknown>
}

export interface PromateGateway {
  callTool(call: PromateToolCall): Promise<unknown>
}

export class PromateGatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'PromateGatewayError'
  }
}

export class DisabledPromateGateway implements PromateGateway {
  async callTool(): Promise<never> {
    throw new PromateGatewayError('Promate MCP 未配置', 'PROMATE_NOT_CONFIGURED', true)
  }
}

interface RpcExchange {
  payload: unknown
  sessionId?: string
}

export class McpPromateGateway implements PromateGateway {
  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs: number,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async callTool(call: PromateToolCall): Promise<unknown> {
    let sessionId: string | undefined
    try {
      const initialized = await this.exchange(call, {
        jsonrpc: '2.0',
        id: `${call.requestId}:initialize`,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'promax', version: '0.1.0' },
        },
      })
      sessionId = initialized.sessionId
      rpcResult(initialized.payload)

      await this.exchange(call, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }, sessionId, true)

      const response = await this.exchange(call, {
        jsonrpc: '2.0',
        id: `${call.requestId}:tool`,
        method: 'tools/call',
        params: { name: call.tool, arguments: call.arguments },
      }, sessionId)
      return toolPayload(rpcResult(response.payload))
    } finally {
      if (sessionId !== undefined) await this.closeSession(call, sessionId)
    }
  }

  private async exchange(
    call: PromateToolCall,
    payload: unknown,
    sessionId?: string,
    allowEmpty = false,
  ): Promise<RpcExchange> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: 'POST',
        headers: this.headers(call, sessionId),
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!response.ok) throw httpError(response.status)
      const body = await response.text()
      const nextSessionId = response.headers.get('mcp-session-id') ?? sessionId
      if (body.trim().length === 0 && allowEmpty) {
        return { payload: {}, ...(nextSessionId === undefined ? {} : { sessionId: nextSessionId }) }
      }
      if (body.trim().length === 0) {
        throw new PromateGatewayError('Promate MCP 返回空响应', 'PROMATE_EMPTY_RESPONSE', false)
      }
      const parsed = response.headers.get('content-type')?.includes('text/event-stream')
        ? parseEventStream(body)
        : parseJson(body)
      return { payload: parsed, ...(nextSessionId === undefined ? {} : { sessionId: nextSessionId }) }
    } catch (error: unknown) {
      if (error instanceof PromateGatewayError) throw error
      if ((error as Error).name === 'AbortError') {
        throw new PromateGatewayError('Promate MCP 请求超时', 'PROMATE_TIMEOUT', true)
      }
      throw new PromateGatewayError('无法连接 Promate MCP', 'PROMATE_NETWORK', true)
    } finally {
      clearTimeout(timer)
    }
  }

  private headers(call: PromateToolCall, sessionId?: string): Record<string, string> {
    return {
      authorization: `Bearer ${call.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-promax-request-id': call.requestId,
      ...(sessionId === undefined ? {} : { 'mcp-session-id': sessionId }),
    }
  }

  private async closeSession(call: PromateToolCall, sessionId: string): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      await this.fetchImplementation(this.endpoint, {
        method: 'DELETE',
        headers: this.headers(call, sessionId),
        signal: controller.signal,
      })
    } catch {
      // Session cleanup is best-effort and never changes the business result.
    } finally {
      clearTimeout(timer)
    }
  }
}

function httpError(status: number): PromateGatewayError {
  if (status === 401 || status === 403) {
    return new PromateGatewayError('Promate 凭证无效或已失效', 'PROMATE_CREDENTIAL_REJECTED', false)
  }
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500
  return new PromateGatewayError(
    retryable ? 'Promate MCP 暂时不可用' : 'Promate MCP 拒绝请求',
    `PROMATE_HTTP_${status}`,
    retryable,
  )
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new PromateGatewayError('Promate MCP 返回无效 JSON', 'PROMATE_INVALID_JSON', false)
  }
}

function parseEventStream(body: string): unknown {
  const messages: unknown[] = []
  for (const event of body.split(/\r?\n\r?\n/u)) {
    const data = event.split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (data.length === 0) continue
    messages.push(parseJson(data))
  }
  const response = messages.findLast((message) => isRecord(message) && ('result' in message || 'error' in message))
  if (response === undefined) {
    throw new PromateGatewayError('Promate MCP 事件流缺少响应', 'PROMATE_INVALID_SSE', false)
  }
  return response
}

function rpcResult(payload: unknown): unknown {
  if (!isRecord(payload)) throw new PromateGatewayError('Promate MCP 响应格式无效', 'PROMATE_INVALID_RPC', false)
  if ('error' in payload) throw new PromateGatewayError('Promate MCP 返回协议错误', 'PROMATE_RPC_ERROR', false)
  if (!('result' in payload)) {
    if (Object.keys(payload).length === 0) return payload
    throw new PromateGatewayError('Promate MCP 响应缺少 result', 'PROMATE_INVALID_RPC', false)
  }
  return payload.result
}

function toolPayload(result: unknown): unknown {
  if (!isRecord(result)) throw new PromateGatewayError('Promate 工具响应格式无效', 'PROMATE_INVALID_TOOL_RESULT', false)
  if (result.isError === true) throw new PromateGatewayError('Promate 工具执行失败', 'PROMATE_TOOL_ERROR', false)
  if ('structuredContent' in result && result.structuredContent !== undefined) {
    return structuredPayload(result.structuredContent)
  }
  if (!Array.isArray(result.content)) {
    throw new PromateGatewayError('Promate 工具响应缺少 content', 'PROMATE_INVALID_TOOL_RESULT', false)
  }
  const text = result.content.find((item) => isRecord(item) && item.type === 'text' && typeof item.text === 'string')
  if (!isRecord(text) || typeof text.text !== 'string') {
    throw new PromateGatewayError('Promate 工具响应缺少文本内容', 'PROMATE_INVALID_TOOL_RESULT', false)
  }
  return parseJson(text.text)
}

function structuredPayload(value: unknown): unknown {
  if (isRecord(value) && Object.keys(value).length === 1 && typeof value.result === 'string') {
    return parseJson(value.result)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
