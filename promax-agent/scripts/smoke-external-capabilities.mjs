#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const BROWSER_FIXTURE = 'scripts/fixtures/browser-evidence-smoke.html'

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const capability = option('--capability')
const revision = Number(option('--revision', '8'))
const presetId = option('--preset', `promax-team-mtcjsbcz-04tpe2-r${revision}`)
const dshHome = resolve(option('--dsh-home', process.env.DSH_HOME ?? resolve(homedir(), '.dsh-promax')))
const server = option('--server', 'http://127.0.0.1:3080').replace(/\/$/, '')
const cwd = resolve(option('--cwd', REPO_ROOT))
const timeoutMs = Number(option('--timeout-ms', '180000'))

if (!['browser', 'lark'].includes(capability)) {
  throw new Error('用法：--capability browser|lark [--revision 8]；lark 另需 --operation 和 --input-json')
}
if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('--revision 必须为正整数')
if (!existsSync(resolve(dshHome, '.agent-presets', presetId, 'team-revision.yml'))) throw new Error(`未安装 preset：${presetId}`)

let rpcSerial = 0
async function rpc(method, payload) {
  const rpcId = `promax-external-smoke-${Date.now()}-${++rpcSerial}`
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

function resultText(event) {
  return (toolResultOf(event)?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
}

async function waitForToolResult(sessionId, toolName) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const history = await rpc('session.history', { sessionId, maxMessages: 20 })
    const events = history.events.map(entry => entry.event)
    const call = events.find(event => event.type === 'tool/call' && event.data?.name === toolName)
    const result = call && events.find(event => event.type === 'tool/result' && event.data?.message?.source?.callId === call.data.callId)
    if (result) return { call, result }
    if (events.some(event => event.type === 'turn/end')) throw new Error(`${toolName} 未产生工具结果`)
    await new Promise(resolveWait => setTimeout(resolveWait, 1000))
  }
  throw new Error(`等待 ${toolName} 超时：${timeoutMs}ms`)
}

async function childSessionOf(parentSessionId) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const sessions = await rpc('session.list', {})
    const child = sessions.items.find(item => item.parentSessionId === parentSessionId && item.origin === 'subagent')
    if (child) return child.sessionId
    await new Promise(resolveWait => setTimeout(resolveWait, 500))
  }
  throw new Error('没有找到成员 child session')
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function verifyBrowserEvidence(taskKey) {
  const taskRoot = resolve(cwd, '.promax', 'browser-evidence', taskKey)
  const runs = existsSync(taskRoot) ? readdirSync(taskRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()) : []
  if (runs.length !== 1) throw new Error(`浏览器证据运行目录应为 1 个，实际 ${runs.length}`)
  const root = join(taskRoot, runs[0].name)
  const manifestFile = join(root, 'manifest.json')
  if (!existsSync(manifestFile)) throw new Error('浏览器证据缺 manifest.json')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (manifest.prototype !== BROWSER_FIXTURE || !manifest.chrome_version?.includes('Google Chrome')) throw new Error('manifest 浏览器或 prototype 不匹配')
  if (manifest.prototype_sha256 !== sha256(resolve(cwd, BROWSER_FIXTURE))) throw new Error('prototype SHA-256 不匹配')
  if (!Array.isArray(manifest.results) || manifest.results.length !== 2) throw new Error('manifest 应包含 2 个 viewport')
  for (const result of manifest.results) {
    const screenshot = resolve(cwd, result.screenshot)
    const dom = resolve(cwd, result.dom)
    if (!existsSync(screenshot) || !existsSync(dom)) throw new Error(`${result.viewport} 证据文件缺失`)
    if (result.screenshot_sha256 !== sha256(screenshot) || result.dom_sha256 !== sha256(dom)) throw new Error(`${result.viewport} 证据 SHA-256 不匹配`)
  }
  return { root, manifest }
}

const created = await rpc('session.create', { cwd, agentPreset: presetId })
const taskKey = `r${revision}-${capability}-smoke-${Date.now()}`
const scope = `<!-- PROMAX_SESSION_SCOPE session_name=${taskKey} task_key=${taskKey} deliverables_root=deliverables/${taskKey} judge_path=.promax/judge/${taskKey}/judge.md -->`
let memberTool
let externalTool
let memberTask

if (capability === 'browser') {
  if (!existsSync(resolve(cwd, BROWSER_FIXTURE))) throw new Error(`缺浏览器测试页：${BROWSER_FIXTURE}`)
  memberTool = 'solution_design'
  externalTool = 'promax_browser_evidence'
  memberTask = `这是外接能力冒烟。只调用 promax_browser_evidence 一次，参数必须逐字等价于：{"task_key":"${taskKey}","prototype_path":"${BROWSER_FIXTURE}","viewports":["390x844","1440x900"]}。不要调用其他工具，不要修改 prototype；工具返回后只转述 evidence_root。`
} else {
  const operation = option('--operation')
  const inputJson = option('--input-json')
  if (!operation || !inputJson) throw new Error('lark 冒烟需要 --operation 和 --input-json')
  const input = JSON.parse(inputJson)
  memberTool = 'requirement_management'
  externalTool = 'promax_lark_cli'
  memberTask = `这是外接能力冒烟。只调用 promax_lark_cli 一次，参数必须逐字等价于：${JSON.stringify({ operation, input })}。不要调用其他工具；工具返回后只转述 operation、cli_version、dry_run 和 stdout。`
}

await rpc('session.prompt', {
  sessionId: created.sessionId,
  mode: 'queue',
  content: [{ type: 'text', text: `${scope}\n请立即且仅调用 ${memberTool} 一次，把以下任务逐字交给它：${memberTask}` }],
  clientTimeZone: 'America/New_York',
})

const parentOutcome = await waitForToolResult(created.sessionId, memberTool)
if (toolResultOf(parentOutcome.result)?.isError === true) throw new Error(`${memberTool} 抛错：${resultText(parentOutcome.result)}`)
const childSessionId = await childSessionOf(created.sessionId)
const childOutcome = await waitForToolResult(childSessionId, externalTool)
if (toolResultOf(childOutcome.result)?.isError === true) throw new Error(`${externalTool} 抛错：${resultText(childOutcome.result)}`)

console.log(`preset id        ${presetId}`)
console.log(`成员             ${memberTool}`)
console.log(`子会话工具       ${externalTool}`)
if (capability === 'browser') {
  const { root, manifest } = verifyBrowserEvidence(taskKey)
  console.log(`取证结果         ${manifest.results.length}/2 viewport，截图/DOM/SHA-256 全部匹配`)
  console.log(`证据目录         ${root}`)
} else {
  console.log('飞书调用         返回成功（以 child session 的真实 tool/result 为准）')
  console.log(`工具结果         ${resultText(childOutcome.result)}`)
}
