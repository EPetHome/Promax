import { defineTool } from '@deepseek-ai/dsh-tools'
import { TelemetryStore } from './telemetry-store.mjs'

export const name = 'promax-telemetry-runtime'
export const inject = ['tools']

function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function turnOf(session, event) {
  if (event.type === 'turn/start') return event.data.turn
  const start = [...session.events].reverse().find(candidate => candidate.type === 'turn/start')
  return start?.type === 'turn/start' ? start.data.turn : 0
}

export function apply(ctx, config = {}) {
  const databaseFile = String(config.databaseFile ?? '')
  if (!databaseFile) throw new Error('promax telemetry databaseFile 未配置')
  const store = new TelemetryStore(databaseFile)

  const stopEvents = ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      store.record({ sessionId: session.id, turn: event.data.turn, eventType: 'conversation-turn', capability: 'conversation', source: 'hook' })
      return
    }
    if (event.type === 'tool/call') {
      store.record({ sessionId: session.id, turn: turnOf(session, event), eventType: 'tool-call', capability: event.data.name, source: 'runtime' })
    }
  })

  const disposeTool = ctx.tools.register(defineTool({
    name: 'promax_usage_report',
    description: '读取 Promax 本机 SQLite 中的匿名能力调用计数；仅在用户询问使用情况、调用统计或哪个能力用得多时调用。',
    parameters: {},
    output: { schema: { type: 'json' }, render: renderJson },
    async execute() {
      return { database: 'local-sqlite', includes_content: false, rows: store.summary() }
    },
  }))

  ctx.effect(() => () => {
    disposeTool()
    stopEvents()
    store.close()
  }, 'promax-telemetry-runtime')
}
