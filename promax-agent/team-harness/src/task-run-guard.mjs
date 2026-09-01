import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import YAML from 'yaml'

export const name = 'promax-task-run-guard'
export const inject = ['tools']

const MEMBER_ID = /^[a-z][a-z0-9_]{2,47}$/
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const BLOCKING_STATES = new Set(['stop_requested', 'draining', 'cancelled', 'failed_to_stop'])

function taskKeyOf(value) {
  const taskKey = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  if (taskKey === '' || Array.from(taskKey).length > 40 || taskKey === '.' || taskKey === '..'
    || /[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(taskKey) || /[. ]$/u.test(taskKey)) return undefined
  return taskKey
}

function recordOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function cancellationForExecution(execution) {
  const agent = execution.agent
  const sessionId = String(agent?.id ?? '')
  const cwd = agent?.session?.header?.cwd
  if (!SESSION_ID.test(sessionId) || typeof cwd !== 'string' || cwd.trim() === '') return undefined
  const workspace = resolve(cwd)
  let scope
  try {
    scope = recordOf(JSON.parse(readFileSync(join(workspace, '.promax', 'session-scopes', `${sessionId}.json`), 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    return { state: 'failed_to_stop', reason: '当前 Promax session-scope 无法读取；成员路由已按失败关闭。' }
  }
  const taskKey = taskKeyOf(scope?.sessionName)
  if (taskKey === undefined || scope?.taskKey !== undefined && scope.taskKey !== taskKey || scope?.sessionId !== undefined && scope.sessionId !== sessionId) {
    return { state: 'failed_to_stop', reason: '当前 Promax session-scope 与 task_key 不一致；成员路由已按失败关闭。' }
  }
  let control
  try {
    control = recordOf(YAML.parse(readFileSync(join(workspace, '.promax', 'tasks', taskKey, 'run-control.yml'), 'utf8')))
  } catch {
    return { state: 'failed_to_stop', reason: '当前任务的 run-control.yml 无法读取；成员路由已按失败关闭。' }
  }
  const metadata = recordOf(control?.metadata)
  const spec = recordOf(control?.spec)
  const state = typeof spec?.state === 'string' ? spec.state : ''
  if (control?.kind !== 'TaskRunControl' || metadata?.task_key !== taskKey || metadata?.session_id !== sessionId || !Number.isSafeInteger(spec?.run_epoch) || spec.run_epoch < 1) {
    return { state: 'failed_to_stop', reason: '当前任务的 run-control.yml 与 task/session/run epoch 不一致；成员路由已按失败关闭。' }
  }
  if (state !== 'running' && !BLOCKING_STATES.has(state)) {
    return { state: 'failed_to_stop', reason: '当前任务的取消状态无效；成员路由已按失败关闭。' }
  }
  return { state, taskKey, sessionId, runEpoch: spec.run_epoch }
}

export function createTaskRunGuard(memberToolNames = []) {
  const guardedTools = new Set(['send_message'])
  for (const memberToolName of memberToolNames) {
    if (!MEMBER_ID.test(memberToolName)) throw new Error(`Promax task-run guard 成员工具名无效：${String(memberToolName)}`)
    guardedTools.add(memberToolName)
  }
  return execution => {
    if (!guardedTools.has(execution.name)) return undefined
    const cancellation = cancellationForExecution(execution)
    if (cancellation === undefined || cancellation.state === 'running') return undefined
    return cancellation.reason ?? `Promax 任务 ${cancellation.taskKey} 已进入 ${cancellation.state}；run epoch ${String(cancellation.runEpoch)} 禁止创建或续接子 Agent。`
  }
}

export function apply(ctx, config = {}) {
  const memberToolNames = Array.isArray(config.memberToolNames) ? config.memberToolNames : []
  return ctx.tools.guard(createTaskRunGuard(memberToolNames))
}
