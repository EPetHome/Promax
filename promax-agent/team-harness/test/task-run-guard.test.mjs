import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createTaskRunGuard } from '../src/task-run-guard.mjs'

function fixture(state = 'running') {
  const root = mkdtempSync(join(tmpdir(), 'promax-task-run-guard-'))
  const sessionId = 'session-parent'
  const taskKey = 'public-demo'
  mkdirSync(join(root, '.promax', 'session-scopes'), { recursive: true })
  mkdirSync(join(root, '.promax', 'tasks', taskKey), { recursive: true })
  writeFileSync(join(root, '.promax', 'session-scopes', `${sessionId}.json`), JSON.stringify({ sessionName: taskKey, taskKey }))
  const writeState = next => writeFileSync(join(root, '.promax', 'tasks', taskKey, 'run-control.yml'), JSON.stringify({
    api_version: 'promax.ai/v1alpha2',
    kind: 'TaskRunControl',
    metadata: { task_key: taskKey, session_id: sessionId, updated_at: new Date().toISOString() },
    spec: { state: next, run_epoch: 1 },
  }))
  writeState(state)
  const execution = name => ({ name, agent: { id: sessionId, session: { header: { cwd: root } } } })
  return { writeState, execution }
}

test('任务取消闩锁在工具路由层阻止 settled 后 send_message 与新成员 child', () => {
  const { writeState, execution } = fixture()
  const guard = createTaskRunGuard(['customer_research'])
  assert.equal(guard(execution('send_message')), undefined)
  assert.equal(guard(execution('customer_research')), undefined)
  assert.equal(guard(execution('read_file')), undefined)

  for (const state of ['stop_requested', 'draining', 'cancelled', 'failed_to_stop']) {
    writeState(state)
    assert.match(guard(execution('send_message')), /禁止创建或续接子 Agent/u)
    assert.match(guard(execution('customer_research')), /禁止创建或续接子 Agent/u)
    assert.equal(guard(execution('read_file')), undefined)
  }
})

test('run-control 缺失或 task/session/run epoch 不一致时成员路由失败关闭', () => {
  const { writeState, execution } = fixture()
  const guard = createTaskRunGuard(['customer_research'])
  writeState('unknown')
  assert.match(guard(execution('customer_research')), /失败关闭/u)
})
