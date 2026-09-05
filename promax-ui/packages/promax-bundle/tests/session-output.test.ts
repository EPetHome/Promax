import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import YAML from 'yaml'

import { beginDispatchPlan, confirmDispatchPlan, enforceConfirmedDispatchCompleteness, enforceDispatchPlanTool, ensureSessionOutputDirectory, prepareDispatchEvidenceInput, prepareTaskAttachmentsForPlanning, prepareTaskSubmission, prepareTaskSubmissionInput, readTaskRunFiles, saveTaskAttachments, sealTaskRunManifest, taskKeyFromSubmission } from '../src/index.ts'

const temporaryRoots: string[] = []

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

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'promax-session-output-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function judgeRepairFixture(sessionId: string, taskKey: string) {
  const root = await temporaryRoot()
  const prepared = await prepareTaskSubmission({ workspacePath: root, sessionId, demand: taskKey, attachmentPaths: [], frozenAt: '2026-09-03T12:00:00.000Z' })
  const opened = await beginDispatchPlan(root, { sessionId, taskKey: prepared.taskKey, rosterMemberIds: ['solution_design', 'quality_judge'] })
  const confirmed = await confirmDispatchPlan(root, { sessionId, planId: opened.planId, confirmedMemberIds: ['solution_design', 'quality_judge'] })
  await sealTaskRunManifest(root, {
    sessionId,
    taskKey: prepared.taskKey,
    confirmedAt: confirmed.confirmedAt,
    confirmedMemberIds: confirmed.confirmedMemberIds,
    artifacts: [
      { path: `deliverables/${taskKey}/prd.md`, memberId: 'solution_design' },
      { path: `.promax/judge/${taskKey}/judge.md`, memberId: 'quality_judge' },
    ],
    teamRevision: TEAM_REVISION,
  })
  await mkdir(join(root, 'deliverables', taskKey), { recursive: true })
  await mkdir(join(root, '.promax', 'judge', taskKey), { recursive: true })
  await writeFile(join(root, 'deliverables', taskKey, 'prd.md'), '# 初稿\n越出冻结输入范围。\n')
  await writeFile(join(root, '.promax', 'judge', taskKey, 'judge.md'), '# Judge\n阻断原因：产物越出冻结输入范围。\n最终判定：FAIL\n')
  const executionMessage = `PROMAX_DISPATCH_EXECUTE_V1\n${JSON.stringify({
    plan_id: opened.planId,
    task_key: taskKey,
    demand: taskKey,
    attachment_paths: [],
    confirmed_member_ids: confirmed.confirmedMemberIds,
    assignments: [],
  })}`
  const steered: unknown[] = []
  const events: Array<{ type: string; data: unknown }> = [
    { type: 'user/message', data: { content: [{ type: 'text', text: executionMessage }] } },
    { type: 'tool/call', data: { turn: 2, name: 'solution_design' } },
    { type: 'tool/call', data: { turn: 2, name: 'quality_judge' } },
  ]
  const payload = {
    agent: {
      session: { header: { id: sessionId, cwd: root }, events },
      steer: (message: unknown) => { steered.push(message) },
    },
    turn: 3,
    signal: new AbortController().signal,
  }
  return { root, taskKey, sessionId, payload, steered }
}

describe('per-session output directories', () => {
  it('uses the visible Chinese session name and suffixes duplicate folders', async () => {
    const root = await temporaryRoot()
    const first = await ensureSessionOutputDirectory(root, 'session-1', '图书馆座位预约')
    const duplicate = await ensureSessionOutputDirectory(root, 'session-2', '图书馆座位预约')
    const repeated = await ensureSessionOutputDirectory(root, 'session-1', '会被已有映射忽略')

    expect(first).toEqual({ sessionName: '图书馆座位预约', taskKey: '图书馆座位预约', relativePath: 'deliverables/图书馆座位预约' })
    expect(duplicate.sessionName).toBe('图书馆座位预约-2')
    expect(repeated).toEqual(first)
    expect(await readdir(join(root, 'deliverables'))).toEqual(['图书馆座位预约', '图书馆座位预约-2'])
    expect(JSON.parse(await readFile(join(root, '.promax', 'session-scopes', 'session-1.json'), 'utf8'))).toMatchObject({ sessionName: '图书馆座位预约', taskKey: '图书馆座位预约' })
  })

  it('rejects names that could escape or break a cross-platform project directory', async () => {
    const root = await temporaryRoot()
    await expect(ensureSessionOutputDirectory(root, 'session-1', '../越界')).rejects.toThrow('会话名称不能安全地用作产出目录')
  })

  it('derives a safe content topic for text-only and pure-file submissions', () => {
    expect(taskKeyFromSubmission('请整理会员续费提醒的验收方案', [])).toBe('请整理会员续费提醒的验收方案')
    expect(taskKeyFromSubmission('brief.txt', [{ name: 'brief.txt', text: '# 文件转换说明\n会员流失预警看板\n按渠道拆解流失原因' }])).toBe('会员流失预警看板')
    expect(taskKeyFromSubmission('', [{ name: '输入.md', text: '门店巡检异常闭环：按区域分派' }])).toBe('门店巡检异常闭环-按区域分派')
  })
})

describe('dispatch confirmation gate', () => {
  it('blocks all planning tools and then enforces the immutable confirmed member list', async () => {
    const root = await temporaryRoot()
    const opened = await beginDispatchPlan(root, {
      sessionId: 'session-plan',
      taskKey: '登录流程',
      rosterMemberIds: ['solution_design', 'quality_judge'],
    })
    let dispatched = 0
    const next = async () => { dispatched += 1; return { kind: 'allow' } }
    const executionMessage = `PROMAX_DISPATCH_EXECUTE_V1\n${JSON.stringify({
      plan_id: opened.planId,
      task_key: '登录流程',
      demand: '为移动端设计登录流程',
      attachment_paths: [],
      confirmed_member_ids: ['solution_design', 'quality_judge'],
      assignments: [],
    })}`
    const execution = (name: string) => ({ name, agent: { session: {
      header: { id: 'session-plan', cwd: root },
      events: [{ type: 'user/message', data: { content: [{ type: 'text', text: executionMessage }] } }],
    } } })

    await expect(enforceDispatchPlanTool(root, execution('solution_design'), next)).resolves.toEqual({
      kind: 'deny',
      reason: '调度计划尚未由用户确认；规划阶段禁止调用任何工具或启动成员',
    })
    await expect(enforceDispatchPlanTool(root, execution('bash'), next)).resolves.toEqual(expect.objectContaining({ kind: 'deny' }))
    expect(dispatched).toBe(0)

    const confirmed = await confirmDispatchPlan(root, {
      sessionId: 'session-plan',
      planId: opened.planId,
      confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    expect(confirmed.confirmedMemberIds).toEqual(['solution_design', 'quality_judge'])
    await expect(enforceDispatchPlanTool(root, execution('solution_design'), next)).resolves.toEqual({ kind: 'allow' })
    await expect(enforceDispatchPlanTool(root, execution('quality_judge'), next)).resolves.toEqual({ kind: 'allow' })
    expect(dispatched).toBe(2)
    const manifest = YAML.parse(await readFile(join(root, '.promax', 'input', '登录流程', 'manifest.yml'), 'utf8'))
    expect(manifest).toMatchObject({
      api_version: 'promax.ai/v1alpha2',
      kind: 'EvidenceInputManifest',
      metadata: { task_key: '登录流程', frozen: true },
      inputs: { src_files: [] },
      spec: { sources: [{ source_id: 'SRC-001', relative_path: '.promax/input/登录流程/sources/SRC-001/demand.md' }] },
    })

    await expect(confirmDispatchPlan(root, {
      sessionId: 'session-plan',
      planId: opened.planId,
      confirmedMemberIds: ['quality_judge', 'solution_design'],
    })).rejects.toThrow('调度名单已经确认，不能再次修改')
  })

  it('keeps the platform-owned frozen input tree read-only for parent and child agent tools', async () => {
    const workspace = await temporaryRoot()
    const next = async () => ({ kind: 'allow' as const })
    const execution = (name: string, args: Record<string, unknown>, origin?: 'subagent') => ({
      name,
      arguments: args,
      agent: { session: { header: { id: origin === 'subagent' ? 'child-session' : 'parent-session', cwd: workspace, ...(origin === undefined ? {} : { origin }) }, events: [] } },
    })

    await expect(enforceDispatchPlanTool(workspace, execution('write', {
      file_path: '.promax/input/调研任务/manifest.yml',
      content: 'tampered',
    }, 'subagent'), next)).resolves.toMatchObject({ kind: 'deny', reason: expect.stringContaining('冻结输入由 Promax 平台管理') })
    await expect(enforceDispatchPlanTool(workspace, execution('edit', {
      file_path: join(workspace, '.promax', 'input', '调研任务', 'sources', 'SRC-001', 'demand.md'),
      old_string: 'a',
      new_string: 'b',
    }), next)).resolves.toMatchObject({ kind: 'deny', reason: expect.stringContaining('只能读取 .promax/input') })
    await expect(enforceDispatchPlanTool(workspace, execution('bash', {
      command: 'sed -i.bak s/a/b/ .promax/input/调研任务/manifest.yml',
    }, 'subagent'), next)).resolves.toMatchObject({ kind: 'deny', reason: expect.stringContaining('禁止通过 shell 修改') })

    await expect(enforceDispatchPlanTool(workspace, execution('bash', {
      command: 'shasum -a 256 .promax/input/调研任务/manifest.yml',
    }, 'subagent'), next)).resolves.toEqual({ kind: 'allow' })
    await expect(enforceDispatchPlanTool(workspace, execution('write', {
      file_path: 'deliverables/调研任务/customer_research.md',
      content: '# report',
    }, 'subagent'), next)).resolves.toEqual({ kind: 'allow' })
  })

  it('quarantines a malformed coordinator manifest and installs verified demand and attachment sources before dispatch', async () => {
    const root = await temporaryRoot()
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const attachmentPaths = await saveTaskAttachments(workspace, 'session-evidence', [{
      name: 'brief.txt',
      contentBase64: Buffer.from('only-in-attachment').toString('base64'),
    }])
    const opened = await beginDispatchPlan(root, {
      sessionId: 'session-evidence',
      taskKey: '续费提醒',
      rosterMemberIds: ['solution_design', 'quality_judge'],
    })
    await confirmDispatchPlan(root, {
      sessionId: 'session-evidence',
      planId: opened.planId,
      confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    const invalidRoot = join(workspace, '.promax', 'input', '续费提醒')
    await mkdir(invalidRoot, { recursive: true })
    await writeFile(join(invalidRoot, 'manifest.yml'), 'schema: promax.manifest/v1\ninputs:\n  src_files: []\n')

    const executionMessage = `PROMAX_DISPATCH_EXECUTE_V1\n${JSON.stringify({
      plan_id: opened.planId,
      task_key: '续费提醒',
      demand: '设计会员续费提醒功能',
      attachment_paths: attachmentPaths,
      confirmed_member_ids: ['solution_design', 'quality_judge'],
      assignments: [],
    })}`
    const session = {
      header: { id: 'session-evidence', cwd: workspace },
      events: [{ type: 'user/message', data: { content: [{ type: 'text', text: executionMessage }] } }],
    }
    let dispatched = 0
    const next = async () => { dispatched += 1; return { kind: 'allow' } }
    await expect(enforceDispatchPlanTool(root, { name: 'solution_design', agent: { session } }, next)).resolves.toEqual({ kind: 'allow' })

    const manifestPath = join(workspace, '.promax', 'input', '续费提醒', 'manifest.yml')
    const manifestText = await readFile(manifestPath, 'utf8')
    const manifest = YAML.parse(manifestText)
    expect(manifestText).toContain('# 已冻结 1 个上传文件登记项')
    expect(manifest).toMatchObject({
      api_version: 'promax.ai/v1alpha2',
      kind: 'EvidenceInputManifest',
      metadata: { task_key: '续费提醒', frozen: true },
      inputs: { src_files: [{ source_id: 'SRC-001', original_filename: 'brief.txt', relative_path: '.promax/input/续费提醒/sources/SRC-001/SRC-001.txt', bytes: 18, agent_readable: true }] },
      spec: {
        source_root: '.promax/input/续费提醒/sources',
        sources: [
          { source_id: 'SRC-001', relative_path: '.promax/input/续费提醒/sources/SRC-001/SRC-001.txt', media_type: 'text/plain' },
          { source_id: 'SRC-002', relative_path: '.promax/input/续费提醒/sources/SRC-002/demand.md', media_type: 'text/markdown' },
        ],
      },
    })
    expect(await readFile(join(workspace, '.promax', 'input', '续费提醒', 'sources', 'SRC-001', 'SRC-001.txt'), 'utf8')).toBe('only-in-attachment')
    const entriesAfterFirstCall = await readdir(join(workspace, '.promax', 'input'))
    expect(entriesAfterFirstCall.filter(name => name.startsWith('.rejected-session-evidence-'))).toHaveLength(1)

    await expect(enforceDispatchPlanTool(root, { name: 'quality_judge', agent: { session } }, next)).resolves.toEqual({ kind: 'allow' })
    expect(dispatched).toBe(2)
    const entriesAfterJudge = await readdir(join(workspace, '.promax', 'input'))
    expect(entriesAfterJudge.filter(name => name.startsWith('.rejected-session-evidence-'))).toHaveLength(1)
  })

  it('freezes an xlsx original plus an agent-readable CSV with converter metadata', async () => {
    const workspace = await temporaryRoot()
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('会员')
    sheet.addRow(['用户', '续费日'])
    sheet.addRow(['唯一用户-XL-408', '2026-09-30'])
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer())
    const attachmentPaths = await saveTaskAttachments(workspace, 'session-xlsx', [{
      name: 'members.xlsx',
      contentBase64: xlsx.toString('base64'),
    }])

    const planningContext = await prepareTaskAttachmentsForPlanning(workspace, 'session-xlsx', attachmentPaths)
    expect(planningContext).toMatchObject([{
      name: 'members.xlsx',
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      textCharacters: expect.any(Number),
      converter: 'exceljs 4.4.0',
      truncated: false,
    }])
    expect(planningContext[0]?.excerpt).toContain('唯一用户-XL-408')
    expect(await readFile(join(workspace, planningContext[0]!.readablePath), 'utf8')).toContain('唯一用户-XL-408')

    await prepareDispatchEvidenceInput({
      workspacePath: workspace,
      sessionId: 'session-xlsx',
      taskKey: '表格输入测试',
      demand: '根据附件生成方案',
      attachmentPaths,
      frozenAt: '2026-09-03T12:00:00.000Z',
    })

    const manifest = YAML.parse(await readFile(join(workspace, '.promax', 'input', '表格输入测试', 'manifest.yml'), 'utf8'))
    expect(manifest.inputs.src_files).toMatchObject([
      { source_id: 'SRC-001', original_filename: 'members.xlsx', agent_readable: false },
      { source_id: 'SRC-002', original_filename: 'members.xlsx', agent_readable: true, conversion: { tool: 'exceljs', version: '4.4.0', from_source_id: 'SRC-001' } },
    ])
    expect(await readFile(join(workspace, '.promax', 'input', '表格输入测试', 'sources', 'SRC-002', 'SRC-002.csv'), 'utf8')).toContain('唯一用户-XL-408')
  })

  it('freezes Chinese upload names as source-id paths while preserving the UI names', async () => {
    const workspace = await temporaryRoot()
    const attachmentPaths = await saveTaskAttachments(workspace, 'session-submit', [
      { name: '测试-访谈记录.txt', contentBase64: Buffer.from('unique-first').toString('base64') },
      { name: '测试-访谈记录.txt', contentBase64: Buffer.from('unique-second').toString('base64') },
    ])

    const prepared = await prepareTaskSubmissionInput({
      workspacePath: workspace,
      sessionId: 'session-submit',
      taskKey: '提交即冻结',
      demand: '严格依据两个附件输出结果',
      attachmentPaths,
      frozenAt: '2026-09-03T13:00:00.000Z',
    })

    expect(prepared.manifestPath).toBe(join(workspace, '.promax', 'input', '提交即冻结', 'manifest.yml'))
    expect(prepared.attachments.map(item => item.name)).toEqual(['测试-访谈记录.txt', '测试-访谈记录（2）.txt'])
    expect(prepared.attachments.map(item => item.readablePath)).toEqual([
      '.promax/input/提交即冻结/sources/SRC-001/SRC-001.txt',
      '.promax/input/提交即冻结/sources/SRC-002/SRC-002.txt',
    ])
    const manifest = YAML.parse(await readFile(prepared.manifestPath, 'utf8'))
    expect(manifest.inputs.src_files.map((item: { original_filename: string; relative_path: string }) => [item.original_filename, item.relative_path])).toEqual([
      ['测试-访谈记录.txt', '.promax/input/提交即冻结/sources/SRC-001/SRC-001.txt'],
      ['测试-访谈记录（2）.txt', '.promax/input/提交即冻结/sources/SRC-002/SRC-002.txt'],
    ])
    expect(await readFile(join(workspace, '.promax', 'input', '提交即冻结', 'sources', 'SRC-002', 'SRC-002.txt'), 'utf8')).toBe('unique-second')
  })

  it('keeps a confirmed turn open until the frozen member set has all been dispatched', async () => {
    const root = await temporaryRoot()
    const prepared = await prepareTaskSubmission({
      workspacePath: root,
      sessionId: 'session-complete',
      demand: '登录流程',
      attachmentPaths: [],
      frozenAt: '2026-09-03T12:00:00.000Z',
    })
    const opened = await beginDispatchPlan(root, {
      sessionId: 'session-complete',
      taskKey: prepared.taskKey,
      rosterMemberIds: ['solution_design', 'quality_judge'],
    })
    const confirmed = await confirmDispatchPlan(root, {
      sessionId: 'session-complete',
      planId: opened.planId,
      confirmedMemberIds: ['solution_design', 'quality_judge'],
    })
    await sealTaskRunManifest(root, {
      sessionId: 'session-complete',
      taskKey: prepared.taskKey,
      confirmedAt: confirmed.confirmedAt,
      confirmedMemberIds: confirmed.confirmedMemberIds,
      artifacts: [
        { path: 'deliverables/登录流程/prd.md', memberId: 'solution_design' },
        { path: '.promax/judge/登录流程/judge.md', memberId: 'quality_judge' },
      ],
      teamRevision: TEAM_REVISION,
    })
    const executionMessage = `PROMAX_DISPATCH_EXECUTE_V1\n${JSON.stringify({
      plan_id: opened.planId,
      task_key: prepared.taskKey,
      demand: '登录流程',
      attachment_paths: [],
      confirmed_member_ids: confirmed.confirmedMemberIds,
      assignments: [],
    })}`
    const steered: unknown[] = []
    const events: Array<{ type: string; data: unknown }> = [
      { type: 'user/message', data: { content: [{ type: 'text', text: executionMessage }] } },
    ]
    const payload = {
      agent: {
        session: { header: { id: 'session-complete', cwd: root }, events },
        steer: (message: unknown) => { steered.push(message) },
      },
      turn: 2,
      signal: new AbortController().signal,
    }

    await enforceConfirmedDispatchCompleteness(root, payload as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    expect(steered).toHaveLength(1)
    expect(JSON.stringify(steered[0])).toContain('solution_design')

    events.push({ type: 'tool/call', data: { turn: 2, name: 'solution_design' } })
    await enforceConfirmedDispatchCompleteness(root, payload as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    expect(steered).toHaveLength(1)

    await mkdir(join(root, 'deliverables', '登录流程'), { recursive: true })
    await writeFile(join(root, 'deliverables', '登录流程', 'prd.md'), '# 登录流程 PRD\n')
    await enforceConfirmedDispatchCompleteness(root, payload as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    expect(steered).toHaveLength(2)
    expect(JSON.stringify(steered[1])).toContain('quality_judge')
    expect(JSON.stringify(steered[1])).toContain('最终判定：PASS')
    expect(JSON.stringify(steered[1])).toContain('最终判定：FAIL')

    events.push({ type: 'tool/call', data: { turn: 2, name: 'quality_judge' } })
    await enforceConfirmedDispatchCompleteness(root, payload as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    expect(steered).toHaveLength(2)

    await mkdir(join(root, '.promax', 'judge', '登录流程'), { recursive: true })
    await writeFile(join(root, '.promax', 'judge', '登录流程', 'judge.md'), '# Judge\n最终判定：PASS\n')
    await enforceConfirmedDispatchCompleteness(root, { ...payload, turn: 3 } as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    expect(steered).toHaveLength(2)
    await expect(readTaskRunFiles(root, { sessionId: 'session-complete', taskKey: '登录流程' })).resolves.toMatchObject({
      cancellation: 'completed',
      manifestPath: '.promax/tasks/登录流程/task-package.yml',
      inputManifestPath: '.promax/input/登录流程/manifest.yml',
      artifactStates: [{ path: 'deliverables/登录流程/prd.md', exists: true, nonEmpty: true }],
      judge: { path: '.promax/judge/登录流程/judge.md', state: 'pass', exists: true, nonEmpty: true },
    })

    await writeFile(join(root, '.promax', 'judge', '登录流程', 'judge.md'), '# Judge\n复核判定：PASS\n')
    await expect(readTaskRunFiles(root, { sessionId: 'session-complete', taskKey: '登录流程' })).resolves.toMatchObject({
      judge: { state: 'pass' },
    })
  })

  it('closes Judge block through repair, regenerated artifact, and a passing recheck without mutating frozen input', async () => {
    const fixture = await judgeRepairFixture('session-repair-pass', '返修后通过')
    const manifestPath = join(fixture.root, '.promax', 'input', fixture.taskKey, 'manifest.yml')
    const frozenBefore = await readFile(manifestPath, 'utf8')

    await enforceConfirmedDispatchCompleteness(fixture.root, fixture.payload as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    expect(fixture.steered).toHaveLength(1)
    expect(JSON.stringify(fixture.steered[0])).toContain('第 1/2 轮返修开始')
    expect(JSON.stringify(fixture.steered[0])).toContain('不得修改')

    await writeFile(join(fixture.root, 'deliverables', fixture.taskKey, 'prd.md'), '# 返修稿\n严格遵循冻结输入。\n')
    await enforceConfirmedDispatchCompleteness(fixture.root, { ...fixture.payload, turn: 4 } as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    expect(fixture.steered).toHaveLength(2)
    expect(JSON.stringify(fixture.steered[1])).toContain('第 1/2 轮业务成员已重新产出')

    await writeFile(join(fixture.root, '.promax', 'judge', fixture.taskKey, 'judge.md'), '# Judge\n最终判定：PASS\n')
    await enforceConfirmedDispatchCompleteness(fixture.root, { ...fixture.payload, turn: 5 } as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    await expect(readTaskRunFiles(fixture.root, { sessionId: fixture.sessionId, taskKey: fixture.taskKey })).resolves.toMatchObject({
      cancellation: 'completed',
      judge: { state: 'pass' },
      repair: { state: 'passed', round: 1, maxRounds: 2 },
    })
    expect(await readFile(manifestPath, 'utf8')).toBe(frozenBefore)
  })

  it('stops after two failed repair rounds and exposes every final Judge reason', async () => {
    const fixture = await judgeRepairFixture('session-repair-exhausted', '返修两轮仍失败')

    await enforceConfirmedDispatchCompleteness(fixture.root, fixture.payload as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    await writeFile(join(fixture.root, 'deliverables', fixture.taskKey, 'prd.md'), '# 第一轮返修\n仍有越界 A。\n')
    await enforceConfirmedDispatchCompleteness(fixture.root, { ...fixture.payload, turn: 4 } as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    await writeFile(join(fixture.root, '.promax', 'judge', fixture.taskKey, 'judge.md'), '# Judge\n阻断原因：第一轮仍有越界 A。\n最终判定：FAIL\n')
    await enforceConfirmedDispatchCompleteness(fixture.root, { ...fixture.payload, turn: 5 } as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    expect(JSON.stringify(fixture.steered.at(-1))).toContain('第 2/2 轮返修开始')

    await writeFile(join(fixture.root, 'deliverables', fixture.taskKey, 'prd.md'), '# 第二轮返修\n仍有越界 B。\n')
    await enforceConfirmedDispatchCompleteness(fixture.root, { ...fixture.payload, turn: 6 } as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])
    expect(JSON.stringify(fixture.steered.at(-1))).toContain('第 2/2 轮业务成员已重新产出')
    await writeFile(join(fixture.root, '.promax', 'judge', fixture.taskKey, 'judge.md'), '# Judge\n阻断原因：第二轮仍有越界 B。\n最终判定：FAIL\n')
    await enforceConfirmedDispatchCompleteness(fixture.root, { ...fixture.payload, turn: 7 } as Parameters<typeof enforceConfirmedDispatchCompleteness>[1])

    const files = await readTaskRunFiles(fixture.root, { sessionId: fixture.sessionId, taskKey: fixture.taskKey })
    expect(files.cancellation).toBe('failed')
    expect(files.repair).toMatchObject({ state: 'exhausted', round: 2, maxRounds: 2 })
    expect(files.judge.reason).toContain('多次返修后仍未通过（2/2）')
    expect(files.judge.reason).toContain('第二轮仍有越界 B')
    expect(fixture.steered).toHaveLength(4)
  })
})
