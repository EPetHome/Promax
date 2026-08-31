#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from '../team-harness/node_modules/yaml/dist/index.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const TASK = '回复 ok 后立即停止，不要做任何其他事，不要写文件。'

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const revision = Number(option('--revision'))
if (!Number.isSafeInteger(revision) || revision < 1) {
  throw new Error('用法：node scripts/smoke-team-revision.mjs --revision <正整数> [--server http://127.0.0.1:3080]')
}

const presetId = option('--preset', `promax-team-mtcjsbcz-04tpe2-r${revision}`)
const dshHome = resolve(option('--dsh-home', process.env.DSH_HOME ?? resolve(homedir(), '.dsh-promax')))
const presetDir = resolve(dshHome, '.agent-presets', presetId)
const revisionFile = resolve(presetDir, 'team-revision.yml')
const server = option('--server', 'http://127.0.0.1:3080').replace(/\/$/, '')
const cwd = resolve(option('--cwd', REPO_ROOT))
const timeoutMs = Number(option('--timeout-ms', '180000'))

if (!existsSync(revisionFile)) throw new Error(`未安装 preset：${presetDir}`)
const teamRevision = YAML.parse(readFileSync(revisionFile, 'utf8'))
if (teamRevision?.spec?.preset_id !== presetId) throw new Error(`preset id 不一致：${revisionFile}`)
const memberTools = teamRevision.spec.runtime_mapping.workers.map(worker => worker.runtime_tool_id)
if (memberTools.length !== 7 || new Set(memberTools).size !== 7) {
  throw new Error(`成员工具必须恰好 7 个，实际为：${memberTools.join(', ')}`)
}

let rpcSerial = 0
async function rpc(method, payload) {
  const rpcId = `promax-r${revision}-smoke-${Date.now()}-${++rpcSerial}`
  const response = await fetch(`${server}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}: ${await response.text()}`)
  const body = await response.json()
  if (!body.result?.ok) throw new Error(`${method}: ${JSON.stringify(body.result?.error ?? body)}`)
  return body.result.value
}

function toolResultOf(event) {
  return event.data?.message?.content?.find(block => block.type === 'tool-result')
}

function textOf(toolResult) {
  return (toolResult?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
}

async function waitForDispatches(sessionId) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const history = await rpc('session.history', { sessionId, maxMessages: 20 })
    const events = history.events.map(entry => entry.event)
    const calls = events.filter(event => event.type === 'tool/call' && memberTools.includes(event.data?.name))
    const callById = new Map(calls.map(event => [event.data.callId, event.data.name]))
    const results = events.filter(event => event.type === 'tool/result' && callById.has(event.data?.message?.source?.callId))
    if (results.length === memberTools.length) return { calls, results }
    if (events.some(event => event.type === 'turn/end')) return { calls, results }
    await new Promise(resolveWait => setTimeout(resolveWait, 1000))
  }
  throw new Error(`等待逐成员派单超时：${timeoutMs}ms`)
}

const created = await rpc('session.create', { cwd, agentPreset: presetId })
const taskKey = `r${revision}-smoke-${Date.now()}`
const scope = `<!-- PROMAX_SESSION_SCOPE session_name=${taskKey} task_key=${taskKey} deliverables_root=deliverables/${taskKey} judge_path=.promax/judge/${taskKey}/judge.md -->`
const prompt = `${scope}\n这是安装冒烟，不是业务任务。请立即且仅调用以下 7 个成员工具各一次：${memberTools.join('、')}。每个工具的任务必须逐字为：${TASK} 不要调用 list_agents，不要检查回复内容；只要每次工具调用返回且未抛错即可。7 个都返回后只回复 smoke done。`
await rpc('session.prompt', {
  sessionId: created.sessionId,
  mode: 'queue',
  content: [{ type: 'text', text: prompt }],
  clientTimeZone: 'America/New_York',
})

const { calls, results } = await waitForDispatches(created.sessionId)
const callNames = calls.map(event => event.data.name)
const duplicateOrMissing = memberTools.filter(name => callNames.filter(actual => actual === name).length !== 1)
const outcomes = new Map(results.map(event => {
  const name = calls.find(call => call.data.callId === event.data.message.source.callId)?.data.name
  return [name, toolResultOf(event)]
}))
const thrown = memberTools.filter(name => !outcomes.has(name) || outcomes.get(name)?.isError === true)
const restrictErrors = memberTools.filter(name => /tools\.restrict\(|unknown global tool|TOOL_FILTER_UNKNOWN_NAME/.test(textOf(outcomes.get(name))))
const returned = memberTools.filter(name => outcomes.has(name)).length
const judgeCallable = outcomes.has('quality_judge') && outcomes.get('quality_judge')?.isError !== true
const passed = returned === 7 && duplicateOrMissing.length === 0 && thrown.length === 0 && restrictErrors.length === 0 && judgeCallable

console.log(`preset id        ${presetId}`)
console.log(`成员工具         ${memberTools.length} 个（${memberTools.join('、')}）`)
console.log(`逐成员派单       ${returned}/7 返回，${passed ? '无 restrict 报错（只看没抛错，不看内容）' : '未通过'}`)
console.log(`Judge 可调       ${judgeCallable ? '是' : '否'}`)

if (!passed) {
  if (duplicateOrMissing.length) console.error(`调用次数异常：${duplicateOrMissing.join('、')}`)
  if (thrown.length) console.error(`工具抛错：${thrown.map(name => `${name}=${textOf(outcomes.get(name)) || 'missing result'}`).join('；')}`)
  if (restrictErrors.length) console.error(`restrict 报错：${restrictErrors.join('、')}`)
  console.error(`smoke session：${created.sessionId}`)
  process.exitCode = 1
}
