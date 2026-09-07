import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { archiveJudgeReport, defectFields, FeishuTelemetryCollector, judgeSummary, memberId, runDetailMarkdown, terminalState, readDispatchTelemetry, runFields, type FeishuRunSnapshot } from '../src/feishu.ts'
import { createHash } from 'node:crypto'
import { parseJudgeDefects } from '../src/judge-defects.ts'
import type { DurableReportQueue } from '../src/outbox.ts'
import type { ReportRequest } from '../src/transport.ts'

test('dispatch telemetry compares the frozen model recommendation and treats missing plans as unknown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'promax-dispatch-telemetry-'))
  try {
    const actual = ['solution_design', 'quality_judge']
    assert.deepEqual(await readDispatchTelemetry(root, 'session', 'task', actual), { plannedMembers: [], dispatchChanged: null })
    const source = 'committed model reply'
    const control = { metadata: { session_id: 'session', task_key: 'task', plan_id: 'plan' }, spec: {
      state: 'confirmed', confirmed_member_ids: actual, model_plan: {
        source_text: source, source_message_sha256: createHash('sha256').update(source).digest('hex'),
        plan: { protocol: 'promax.dispatch-plan/v1', planId: 'plan', members: [{ memberId: 'solution_design', selected: false }, { memberId: 'quality_judge', selected: true }] },
      },
    } }
    writeFileSync(join(root, 'session.confirmed.json'), JSON.stringify(control))
    assert.deepEqual(await readDispatchTelemetry(root, 'session', 'task', actual), { plannedMembers: ['quality_judge'], dispatchChanged: true })
    control.spec.model_plan.plan.members[0]!.selected = true
    writeFileSync(join(root, 'session.confirmed.json'), JSON.stringify(control))
    assert.equal((await readDispatchTelemetry(root, 'session', 'task', actual)).dispatchChanged, false)
    await assert.rejects(readDispatchTelemetry(root, 'session', 'other-task', actual), /与当前确认记录不一致/)
    const missing = { plannedMembers: [], actualMembers: actual, dispatchChanged: false, demand: '', artifacts: [], judgeRuleIds: [], skillCalls: [] } as unknown as FeishuRunSnapshot
    const fields = runFields(missing, 'https://example.test/doc', false)
    assert.equal(fields['派工被改'], null)
    assert.equal(fields['计划状态'], '缺少已保存模型计划，无法判断')
    assert.equal(fields['_待复盘'], true)
    assert.match(runDetailMarkdown(missing), /无法判断/)
    assert.ok(!('是否已跟进' in fields) && !('跟进结论' in fields))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('member id comes from the child request persona when descriptor omits persona', () => {
  assert.equal(memberId({
    id: 'child-1',
    header: { agentPreset: 'promax-team', origin: 'subagent' },
    events: [
      { type: 'subagent/descriptor', data: { version: 2, provider: 'spawn', label: '客研' } },
      { type: 'request/header', data: { header: { system: 'persona\n\nPROMAX_MEMBER_ID:customer_research\nend' } } },
    ],
  }), 'customer_research')
})

test('archives each real Judge call and extracts only explicit defects without human fields', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'promax-judge-history-'))
  try {
    mkdirSync(join(cwd, '.promax/session-scopes'), { recursive: true })
    mkdirSync(join(cwd, '.promax/judge/task'), { recursive: true })
    writeFileSync(join(cwd, '.promax/session-scopes/session.json'), JSON.stringify({ taskKey: 'task' }))
    const first = '# Judge\n整体 verdict：FAIL\n## prd.md — FAIL\n| rule_id | verdict | reason |\n| MISLABELED | fail | 错标事实 |\n### MISLABELED — FAIL\nowner: solution_design\n原文 L3：把推断写成事实。\n### PRD_TRACEABILITY_TABLE — FAIL\nprd-document-generator 的输出格式缺少追溯表。\n## business-diagram.md — PASS\n上轮 OUTPUT_SELF_CONTRADICTION fail 已修复。\n最终判定：FAIL\n'
    const events = [{ type: 'request/header', data: { header: { system: 'PROMAX_MEMBER_ID:quality_judge\n' } } }]
    const agent = { id: 'judge-child', session: { id: 'judge-child', header: { cwd, parentSession: 'session', origin: 'subagent' }, events } }
    const current = join(cwd, '.promax/judge/task/judge.md')
    writeFileSync(current, first)
    archiveJudgeReport(agent, 1)
    archiveJudgeReport(agent, 1)
    const second = '# 第 2 轮\n最终判定：PASS\n'
    writeFileSync(current, second)
    archiveJudgeReport(agent, 2)
    assert.deepEqual(readdirSync(join(cwd, '.promax/judge/task')).sort(), ['judge-history.json', 'judge-r1.md', 'judge-r2.md', 'judge.md'])
    assert.equal(readFileSync(join(cwd, '.promax/judge/task/judge-r1.md'), 'utf8'), first)
    assert.equal(readFileSync(join(cwd, '.promax/judge/task/judge-r2.md'), 'utf8'), readFileSync(current, 'utf8'))
    const defects = parseJudgeDefects({ text: first, time: 1000, round: 1,
      artifacts: [{ relative_path: 'deliverables/task/prd.md', produced_by: 'solution_design' }, { relative_path: 'deliverables/task/business-diagram.md', produced_by: 'solution_design' }],
      ruleIds: ['PRD_TRACEABILITY_TABLE'], skillNames: ['prd-document-generator'] })
    assert.deepEqual(defects.map(row => [row.artifact, row.ruleId, row.ownerType, row.ownerName]), [
      ['prd.md', 'MISLABELED', 'agent', 'solution_design'],
      ['prd.md', 'PRD_TRACEABILITY_TABLE', 'skill', 'prd-document-generator'],
    ])
    assert.deepEqual(Object.keys(defectFields('task', { ...defects[0]!, 我的判断: 'Judge判对了' } as never)).sort(),
      ['时间', '任务名', '轮次', '产物', '责任对象类型', '责任对象名', '缺陷类型', 'Judge 理由'].sort())
    assert.equal(judgeSummary(second).verdict, 'pass')
    const unknown = parseJudgeDefects({ text: '### FABRICATED — FAIL\n原文缺少依据。', time: 1000, round: 1, artifacts: [], ruleIds: [], skillNames: [] })
    assert.equal(unknown[0]?.ownerName, '未判定')
    assert.equal(unknown[0]?.ownerType, '未判定')
    const withReports = runDetailMarkdown({ artifacts: [], judgeRuleIds: [], plannedMembers: [], actualMembers: [], judgeReports: [{ round: 1, time: 1000, path: current, text: first }, { round: 2, time: 2000, path: current, text: second }] } as unknown as FeishuRunSnapshot)
    assert.ok(withReports.includes(first) && withReports.includes(second))
    assert.ok(!withReports.includes('Judge 全文未上传'))
  } finally { rmSync(cwd, { recursive: true, force: true }) }
})

test('Judge verdict reads the declared value instead of a later explanatory word', () => {
  const summary = judgeSummary('## 整体 verdict\n- 整体 verdict：**pass**（无任一 artifact fail，不阻断）')
  assert.equal(summary.verdict, 'pass')
})

test('Judge rule ids are limited to the task package rubric allowlist', () => {
  const summary = judgeSummary(
    '命中 CUSTOMER_RESEARCH_EVIDENCE_TRACE；结论 BLOCK；状态 HUMAN_REQUIRED。',
    ['CUSTOMER_RESEARCH_EVIDENCE_TRACE', 'CUSTOMER_RESEARCH_SAMPLE_BOUNDARY'],
  )
  assert.deepEqual(summary.ruleIds, ['CUSTOMER_RESEARCH_EVIDENCE_TRACE'])
})

test('Feishu final status follows run-control instead of inferring from Judge files', () => {
  const control = (state: string) => ({ spec: { state } })
  assert.equal(terminalState(control('running'), { spec: { state: 'passed' } }), undefined)
  assert.deepEqual(terminalState(control('completed'), undefined), { finalStatus: '完成', repairRounds: 0, failureReason: '' })
  assert.deepEqual(terminalState(control('failed'), { spec: { round: 2, reasons: ['仍未通过'] } }), {
    finalStatus: '失败', repairRounds: 2, failureReason: '仍未通过',
  })
})

test('Feishu observation retries until run-control reaches a terminal state', async () => {
  const submitted: ReportRequest[] = []
  const collector = new FeishuTelemetryCollector(
    () => ({ appToken: 'app', folderToken: 'folder' }),
    { submit: (request: ReportRequest) => { submitted.push(request) }, async idle() {} } as unknown as DurableReportQueue,
    { debug() {}, warn() {} },
    '/unused-dispatch-plans',
  )
  let attempts = 0
  const snapshot = { sessionId: 'session-1' } as FeishuRunSnapshot
  ;(collector as unknown as { snapshot(): Promise<FeishuRunSnapshot | undefined> }).snapshot = async () => {
    attempts += 1
    return attempts === 1 ? undefined : snapshot
  }
  collector.observeTurn({ id: 'session-1', session: { id: 'session-1', header: { cwd: '/tmp' }, events: [] } })
  await collector.idle()
  assert.equal(attempts, 2)
  assert.deepEqual(submitted, [{ path: '/feishu/v1/run', body: snapshot }])
})

test('Feishu detail contains summaries and local paths but not Judge or artifact bodies', () => {
  const snapshot: FeishuRunSnapshot = {
    startedAt: 1,
    observedAt: 2,
    taskName: '验收任务',
    demand: '请生成一份简短方案',
    inputType: '内联',
    plannedMembers: ['solution_design', 'quality_judge'],
    actualMembers: ['solution_design', 'quality_judge'],
    dispatchChanged: false,
    artifacts: ['deliverables/验收任务/prd.md'],
    judgeVerdict: 'block',
    judgeRuleIds: ['PRD_REQUIRED_SECTIONS'],
    judgePath: '/workspace/.promax/judge/验收任务/judge.md',
    repairRounds: 2,
    finalStatus: '失败',
    failureReason: '缺少验收规则',
    durationSeconds: 23,
    tokenCount: 456,
    sessionId: 'session-1',
    skillCalls: [],
  }
  const markdown = runDetailMarkdown(snapshot)
  assert.match(markdown, /请生成一份简短方案/u)
  assert.match(markdown, /PRD_REQUIRED_SECTIONS/u)
  assert.match(markdown, /deliverables\/验收任务\/prd\.md/u)
  assert.match(markdown, /\.promax\/judge\/验收任务\/judge\.md/u)
  assert.match(markdown, /Judge 全文未上传/u)
  assert.doesNotMatch(markdown, /这里是 Judge 全文/u)
})
