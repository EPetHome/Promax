import { readFileSync } from 'node:fs'
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply, controlTaskRunFiles, readTaskRunFiles, writeTaskPackageFiles, type TaskPackageWriteInput } from '../../promax-bundle/src/index.ts'

let temporaryHome: string | undefined

afterEach(async () => {
  if (temporaryHome !== undefined) await rm(temporaryHome, { recursive: true, force: true })
  temporaryHome = undefined
  delete process.env.PROMAX_GENERAL_WORKSPACE
  delete process.env.PROMAX_PRODUCT_WORKSPACE
})

describe('Promax bundle config policy', () => {
  it('packages the current r12 product preset and a tool-free 0-artifact draft preset', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/package-distribution.mjs'), 'utf8')
    const packageManifest = readFileSync(resolve(process.cwd(), 'packages/promax-bundle/package.json'), 'utf8')
    const draftPreset = readFileSync(resolve(process.cwd(), 'packages/promax-bundle/presets/general/agent.cordis.yml'), 'utf8')
    expect(source).toContain('promax-team-mtcjsbcz-04tpe2-r12')
    expect(source).not.toContain('promax-team-mtcjsbcz-04tpe2-r7')
    expect(source).toContain('promax-bundle/presets/general')
    expect(JSON.parse(packageManifest).files).toContain('presets')
    expect(draftPreset).toContain('草稿阶段产生 0 份正式产物')
    expect(draftPreset).not.toMatch(/dsh-tool-(?:fs|bash)|subagent|team-harness/u)
  })

  it('disables only the approved shell rows and inserts only Promax-owned rows', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/promax-bundle/cordis.patch.yml'), 'utf8')
    const topLevelOperations = source.split('\n').filter(line => /^-\s/u.test(line))
    const insertedIds = [...source.matchAll(/^[ \t]+- id:\s+(\S+)\s*$/gmu)].map(match => match[1])

    expect(topLevelOperations).toEqual(['- id: ui-layout', '- id: ui-sidebar', '- id: ui-brand-official', '- insert:'])
    expect(insertedIds).toEqual([
      'promax-workspace-bootstrap',
      'promax-team-harness',
      'promax-ui-console',
      'promax-ui-layout',
      'promax-ui-brand',
      'promax-report',
    ])
    expect(insertedIds.every(id => id?.startsWith('promax-'))).toBe(true)
    const targetedDshIds = [...source.matchAll(/^- id:\s+(\S+)\s*$/gmu)].map(match => match[1])
    expect(targetedDshIds).toEqual(['ui-layout', 'ui-sidebar', 'ui-brand-official'])
    expect(source.match(/^\s+disabled:\s+true$/gmu)).toHaveLength(3)
  })

  it('bootstraps the draft boundary and a standard product project tree', async () => {
    temporaryHome = await mkdtemp(join(tmpdir(), 'promax-bundle-test-'))
    process.env.PROMAX_GENERAL_WORKSPACE = join(temporaryHome, 'general')
    process.env.PROMAX_PRODUCT_WORKSPACE = join(temporaryHome, 'product')
    let workspaceOrdinal = 0
    const create = vi.fn(async (path: string, title?: string) => {
      workspaceOrdinal += 1
      return { id: `workspace-${workspaceOrdinal}`, path, title: title ?? 'workspace', sessionIds: [] }
    })
    const register = vi.fn(() => () => {})

    await apply({
      workspaceRegistry: { create },
      webServer: { register },
      effect: setup => { setup() },
      on: (_event, _listener) => {},
      emit: vi.fn(),
    }, { apiBaseUrl: 'http://127.0.0.1:3100' })

    expect(create).toHaveBeenNthCalledWith(1, join(temporaryHome, 'general'), '草稿')
    expect(create).toHaveBeenNthCalledWith(2, join(temporaryHome, 'product'), '产品')
    expect(readFileSync(join(temporaryHome, 'product', '.promax', 'source-ledger.md'), 'utf8')).toContain('来源台账')
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prefix',
      path: '/promax-api',
      handler: expect.any(Function) as (request: IncomingMessage, response: ServerResponse) => void,
    }))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prefix',
      path: '/promax-workspace-api',
      handler: expect.any(Function) as (request: IncomingMessage, response: ServerResponse) => void,
    }))

    const writeInput: TaskPackageWriteInput = {
      sessionId: 'session-demo',
      project: '脱敏演示',
      taskKey: '脱敏任务',
      teamRevisionId: 'team-mtcjsbcz-04tpe2@r12',
      confirmedAt: '2026-08-31T12:00:00.000Z',
      confirmedHandoff: '## 要什么\n脱敏目标\n\n## 手上有什么\n公开材料\n\n## 从哪儿接\nPRD\n\n## 已知缺口\n无',
      handoffEdited: false,
      requestedArtifactPaths: ['deliverables/{task_key}/prd.md'],
      coverageInformationKeys: ['goal', 'target_user', 'scenario', 'pain_point', 'constraint', 'requirements_priority'],
      coverageWasOverridden: false,
      members: [{
        memberId: 'solution_design', label: '方案设计',
        provides: ['goal', 'target_user', 'scenario', 'pain_point', 'scope', 'constraint', 'success_criteria', 'competitive_difference', 'requirements_priority'],
        requires: ['goal', 'target_user', 'scenario', 'pain_point', 'constraint', 'requirements_priority'],
      }],
      artifacts: [{ relativePath: 'deliverables/{task_key}/prd.md', producedBy: 'solution_design', required: true }],
    }
    const first = await writeTaskPackageFiles(join(temporaryHome, 'product'), writeInput)
    const second = await writeTaskPackageFiles(join(temporaryHome, 'product'), {
      ...writeInput,
      confirmedAt: '2026-08-31T12:05:00.000Z',
      coverageInformationKeys: [...writeInput.coverageInformationKeys, 'scope'],
      coverageWasOverridden: true,
    })
    expect(first).toMatchObject({ tier: 'single', coverageRevision: 1, taskPackagePath: '.promax/tasks/脱敏任务/task-package.yml' })
    expect(second.coverageRevision).toBe(2)
    expect(await readdir(join(temporaryHome, 'product', '输入', '草稿'))).toHaveLength(0)
    expect(JSON.parse(readFileSync(join(temporaryHome, 'product', '.promax', 'input', '脱敏任务', 'manifest.yml'), 'utf8'))).toMatchObject({
      metadata: { frozen: true, frozen_at: '2026-08-31T12:00:00.000Z' },
      spec: { sources: [{ source_id: 'SRC-001' }] },
    })
    const revisedCoverage = JSON.parse(readFileSync(join(temporaryHome, 'product', '.promax', 'tasks', '脱敏任务', 'coverage.yml'), 'utf8'))
    expect(revisedCoverage.metadata).toMatchObject({ revision: 2, confirmed_at: '2026-08-31T12:05:00.000Z' })
    expect(revisedCoverage.spec.sources[0].covers).toEqual(expect.arrayContaining([
      expect.objectContaining({ information_key: 'scope' }),
    ]))
    expect(JSON.parse(readFileSync(join(temporaryHome, 'product', '.promax', 'tasks', '脱敏任务', 'task-package.yml'), 'utf8')).spec.requested_artifacts).toEqual([
      'deliverables/脱敏任务/prd.md',
    ])
    expect(await readdir(join(temporaryHome, 'product', '.promax', 'tasks', '脱敏任务'))).toEqual(['coverage.yml', 'run-control.yml', 'slots.yml', 'task-package.yml'])

    const productRoot = join(temporaryHome, 'product')
    await mkdir(join(productRoot, '.promax', 'session-scopes'), { recursive: true })
    await writeFile(join(productRoot, '.promax', 'session-scopes', 'session-demo.json'), JSON.stringify({ sessionName: '脱敏任务', taskKey: '脱敏任务' }))
    await mkdir(join(productRoot, '.promax', 'judge', '旧任务'), { recursive: true })
    await writeFile(join(productRoot, '.promax', 'judge', '旧任务', 'judge.md'), '整体 verdict：PASS\n产物 deliverables/旧任务/prd.md\n')
    let live = await readTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: '脱敏任务', artifactPaths: ['deliverables/脱敏任务/prd.md'] })
    expect(live).toMatchObject({ cancellation: 'running', runEpoch: 1, judge: { state: 'absent', exists: false } })
    expect(live.artifactStates).toEqual([{ path: 'deliverables/脱敏任务/prd.md', exists: false, nonEmpty: false }])

    await mkdir(join(productRoot, 'deliverables', '脱敏任务'), { recursive: true })
    await writeFile(join(productRoot, 'deliverables', '脱敏任务', 'prd.md'), '# 脱敏 PRD\n')
    await mkdir(join(productRoot, '.promax', 'judge', '脱敏任务'), { recursive: true })
    for (const [report, expected] of [
      ['整体 verdict：PASS\n', 'pass'],
      ['整体 verdict：FAIL\n', 'fail'],
      ['整体 verdict：APPEALED\n', 'appealed'],
      ['整体 verdict：HUMAN_REQUIRED\n', 'human_required'],
      ['整体 verdict：FAIL\n| 人工处理 | 人工强制放行 |\n', 'force_released'],
    ] as const) {
      await writeFile(join(productRoot, '.promax', 'judge', '脱敏任务', 'judge.md'), report)
      live = await readTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: '脱敏任务', artifactPaths: ['deliverables/脱敏任务/prd.md'] })
      expect(live.judge.state).toBe(expected)
      expect(live.artifactStates[0]).toMatchObject({ exists: true, nonEmpty: true })
    }

    await controlTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: '脱敏任务', state: 'stop_requested', runEpoch: 1, updatedAt: '2026-08-31T12:10:00.000Z' })
    await controlTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: '脱敏任务', state: 'failed_to_stop', runEpoch: 1, updatedAt: '2026-08-31T12:10:01.000Z' })
    await expect(controlTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: '脱敏任务', state: 'stop_requested', runEpoch: 1, updatedAt: '2026-08-31T12:10:02.000Z' })).resolves.toMatchObject({ state: 'stop_requested', runEpoch: 1, changed: true })
    await controlTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: '脱敏任务', state: 'draining', runEpoch: 1, updatedAt: '2026-08-31T12:10:03.000Z' })
    await controlTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: '脱敏任务', state: 'cancelled', runEpoch: 1, updatedAt: '2026-08-31T12:10:04.000Z' })
    await expect(controlTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: '脱敏任务', state: 'stop_requested', runEpoch: 1, updatedAt: '2026-08-31T12:10:05.000Z' })).resolves.toMatchObject({ state: 'cancelled', runEpoch: 1 })
    expect((await readTaskRunFiles(productRoot, { sessionId: 'session-demo', taskKey: '脱敏任务', artifactPaths: ['deliverables/脱敏任务/prd.md'] })).cancellation).toBe('cancelled')
  })

  it('keeps internal difference-run outputs out of requested_artifacts', async () => {
    temporaryHome = await mkdtemp(join(tmpdir(), 'promax-bundle-support-'))
    const result = await writeTaskPackageFiles(temporaryHome, {
      sessionId: 'session-support', project: '脱敏演示', taskKey: '单产物任务',
      teamRevisionId: 'team-mtcjsbcz-04tpe2@r12', confirmedAt: '2026-08-31T12:00:00.000Z',
      confirmedHandoff: '## 要什么\nPRD\n\n## 手上有什么\n公开材料\n\n## 从哪儿接\nPRD\n\n## 已知缺口\n约束待补跑',
      handoffEdited: false,
      requestedArtifactPaths: ['deliverables/{task_key}/prd.md'],
      coverageInformationKeys: ['goal'], coverageWasOverridden: false,
      members: [
        { memberId: 'support', label: '支撑', provides: ['constraint'], requires: ['goal'] },
        { memberId: 'final', label: '最终', provides: ['scope'], requires: ['goal', 'constraint'] },
      ],
      artifacts: [
        { relativePath: 'deliverables/{task_key}/support.md', producedBy: 'support', required: true },
        { relativePath: 'deliverables/{task_key}/prd.md', producedBy: 'final', required: true },
      ],
    })
    expect(result).toMatchObject({
      tier: 'team',
      artifactPaths: ['deliverables/单产物任务/prd.md', 'deliverables/单产物任务/support.md'],
    })
    const taskPackage = JSON.parse(readFileSync(join(temporaryHome, '.promax', 'tasks', '单产物任务', 'task-package.yml'), 'utf8'))
    expect(taskPackage.spec.requested_artifacts).toEqual(['deliverables/单产物任务/prd.md'])
  })

  it('does not create any task-package or input path for the 0-artifact draft tier', async () => {
    temporaryHome = await mkdtemp(join(tmpdir(), 'promax-bundle-zero-'))
    const input: TaskPackageWriteInput = {
      sessionId: 'session-zero',
      project: '脱敏演示',
      taskKey: '仅保留草稿',
      teamRevisionId: 'team-mtcjsbcz-04tpe2@r12',
      confirmedAt: '2026-08-31T12:00:00.000Z',
      confirmedHandoff: '## 要什么\n继续澄清\n\n## 手上有什么\n暂无\n\n## 从哪儿接\n0\n\n## 已知缺口\n待定',
      handoffEdited: false,
      requestedArtifactPaths: [],
      coverageInformationKeys: ['goal'],
      coverageWasOverridden: false,
      members: [{ memberId: 'solution_design', label: '方案设计', provides: ['goal'], requires: ['goal'] }],
      artifacts: [{ relativePath: 'deliverables/{task_key}/prd.md', producedBy: 'solution_design', required: true }],
    }
    await expect(writeTaskPackageFiles(temporaryHome, input)).rejects.toThrow('0 产物草稿不得写入任务包')
    await expect(access(join(temporaryHome, '.promax'))).rejects.toThrow()
  })
})
