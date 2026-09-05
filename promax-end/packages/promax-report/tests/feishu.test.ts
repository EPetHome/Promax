import assert from 'node:assert/strict'
import test from 'node:test'

import { FeishuTelemetryCollector, judgeSummary, memberId, runDetailMarkdown, terminalState, type FeishuRunSnapshot } from '../src/feishu.ts'
import type { DurableReportQueue } from '../src/outbox.ts'
import type { ReportRequest } from '../src/transport.ts'

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
