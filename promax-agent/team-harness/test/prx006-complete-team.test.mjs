import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import YAML from 'yaml'
import {
  appendWebEvidence,
  captureWebSnapshot,
  compileTeam,
  ContractError,
  HARNESS_DIR,
  loadAndValidate,
  loadSkillCatalog,
  parseGeneratedCordis,
  readYaml,
  sha256,
  validateEvidenceInput,
  validateBeforeJudgeExecution,
  verifyCompiledRevision,
} from '../src/harness.mjs'
import { TelemetryStore } from '../src/telemetry-store.mjs'

const completeDefinition = resolve(HARNESS_DIR, 'definitions/promax-product-team.yml')

function temporaryRoot() {
  return mkdtempSync(join(tmpdir(), 'prx-006-complete-'))
}

test('完全体 catalog 只有 28 个原版目录和 revision 1，loader 逐条复算内容与树哈希', () => {
  const catalog = loadSkillCatalog()
  assert.equal(catalog.skills.size, 28)
  assert.equal(catalog.ids.size, 28)
  assert.deepEqual([...new Set([...catalog.skills.values()].map(skill => skill.revision))], [1])
  for (const skill of catalog.skills.values()) {
    assert.equal(skill.skill_id, skill.sourcePath.split('/').at(-1))
    assert.equal(skill.status, 'allowed')
  }
})

test('完全体固定 promax-team、六业务 Skill 数、全员 web 与 Judge 闭集边界', () => {
  const root = temporaryRoot()
  try {
    const loaded = loadAndValidate({ definitionFile: completeDefinition })
    assert.deepEqual(loaded.resolvedMembers.slice(0, 6).map(member => member.resolvedSkills.length), [2, 7, 5, 9, 4, 6])
    assert.equal(loaded.resolvedMembers.at(-1).resolvedSkills.length, 0)

    const result = compileTeam({ definitionFile: completeDefinition, revision: 1, outputDir: root })
    assert.equal(result.presetId, 'promax-team')
    assert.equal(result.outputPath.endsWith('/promax-team'), true)
    assert.equal(/-r[0-9]+$/.test(result.presetId), false)
    assert.ok(verifyCompiledRevision(result.outputPath).files > 28)

    const revision = readYaml(join(result.outputPath, 'team-revision.yml'))
    assert.equal(revision.spec.skills.length, 28)
    assert.equal(revision.spec.members.length, 7)
    const plugins = parseGeneratedCordis(join(result.outputPath, 'agent.cordis.yml'))
    const coordinatorPersona = plugins.find(plugin => plugin.id === 'persona').config.text
    for (const marker of ['精确 `.promax/tasks/{task_key}/task-package.yml`', '严禁使用 `**/manifest.yml`', '不得回退读取任何历史任务']) {
      assert.ok(coordinatorPersona.includes(marker), marker)
    }
    assert.ok(plugins.some(plugin => plugin.name === '@deepseek-ai/dsh-tool-web'))
    for (const packageName of ['@deepseek-ai/dsh-web-fetch-http', '@deepseek-ai/dsh-web-search-deepseek']) {
      assert.equal(plugins.some(plugin => plugin.name === packageName), false, `${packageName} 必须由 Promax 全局 bundle 唯一注册，preset 不得重复挂载`)
    }
    const workers = new Map(plugins.find(plugin => plugin.id === 'delegation').config
      .filter(plugin => plugin.name === '@deepseek-ai/dsh-tool-subagent')
      .map(plugin => [plugin.config.toolName, plugin.config.toolFilter]))
    for (const memberId of ['customer_research', 'product_discovery', 'requirement_management', 'solution_design', 'requirement_review', 'user_analysis']) {
      const filter = workers.get(memberId)
      if (filter.allow) {
        assert.ok(filter.allow.includes('web_search'), memberId)
        assert.ok(filter.allow.includes('web_fetch'), memberId)
      } else {
        assert.ok(!filter.deny.includes('web_search'), memberId)
        assert.ok(!filter.deny.includes('web_fetch'), memberId)
      }
    }
    assert.deepEqual(workers.get('quality_judge').allow, ['glob', 'grep', 'read', 'write'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('只保留 9 个顶层模块且没有 v1/2 历史模块目录', () => {
  const modules = readdirSync(resolve(HARNESS_DIR, 'modules'), { withFileTypes: true }).filter(entry => entry.isDirectory())
  assert.equal(modules.length, 9)
  for (const module of modules) {
    const nested = readdirSync(resolve(HARNESS_DIR, 'modules', module.name), { withFileTypes: true }).filter(entry => entry.isDirectory() && ['v1', '2'].includes(entry.name))
    assert.deepEqual(nested, [])
  }
})

test('web 成功与仅摘要失败 SRC 必须由业务产物回指后才能进入 Judge', async () => {
  const root = temporaryRoot()
  const server = createServer((request, response) => {
    if (request.url === '/ok') {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('public fixture body')
    } else {
      response.writeHead(503, { 'content-type': 'text/plain' })
      response.end('unavailable')
    }
  })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  try {
    const address = server.address()
    const source = join(root, 'user.txt')
    writeFileSync(source, 'public user fixture')
    const { freezeEvidenceInput } = await import('../src/harness.mjs')
    const frozen = freezeEvidenceInput({
      workspaceRoot: root,
      taskKey: '公开竞品案例',
      sources: [{ source_id: 'SRC-001', path: source, media_type: 'text/plain', origin_kind: 'user-provided' }],
    })
    const success = await captureWebSnapshot({ url: `http://127.0.0.1:${address.port}/ok`, outputFile: join(root, 'success.txt') })
    const failed = await captureWebSnapshot({
      url: `http://127.0.0.1:${address.port}/missing`,
      outputFile: join(root, 'failed.txt'),
      fallbackSummary: '公开测试搜索摘要',
    })
    assert.equal(success.fetch_status, 'success')
    assert.equal(success.http_status, 200)
    assert.equal(failed.fetch_status, 'failed')
    assert.equal(failed.http_status, 503)
    assert.match(readFileSync(failed.output_file, 'utf8'), /仅搜索摘要，未取得正文/)

    const successRecord = appendWebEvidence({
      workspaceRoot: root,
      taskKey: '公开竞品案例',
      url: success.original_url,
      capturedAt: success.captured_at,
      fetchStatus: success.fetch_status,
      httpStatus: success.http_status,
      content: readFileSync(success.output_file),
    })
    const failedRecord = appendWebEvidence({
      workspaceRoot: root,
      taskKey: '公开竞品案例',
      url: failed.original_url,
      capturedAt: failed.captured_at,
      fetchStatus: failed.fetch_status,
      httpStatus: failed.http_status,
      content: readFileSync(failed.output_file),
    })
    assert.equal(validateEvidenceInput(frozen.manifest).sources, 3)
    const manifest = readYaml(frozen.manifest)
    assert.deepEqual(manifest.spec.sources.slice(1).map(item => [item.source_id, item.fetch_status, item.http_status]), [
      ['SRC-002', 'success', 200],
      ['SRC-003', 'failed', 503],
    ])
    assert.ok(manifest.spec.sources.slice(1).every(item => item.original_url && item.captured_at && item.sha256))
    assert.equal(successRecord.source_id, 'SRC-002')
    assert.equal(failedRecord.source_id, 'SRC-003')

    const deliverableRoot = join(root, 'deliverables', '公开竞品案例')
    const discovery = join(deliverableRoot, 'product_discovery.md')
    mkdirSync(deliverableRoot, { recursive: true })
    const completeReferences = '# 公开竞品探索\n\n成功抓取事实回指 [SRC-002]。\n\n仅摘要失败边界回指 [SRC-003]。\n'
    writeFileSync(discovery, completeReferences)
    const session = {
      header: { cwd: root },
      events: [{ type: 'user/message', data: { content: [{ type: 'text', text: '{"task_key":"公开竞品案例"}' }] } }],
    }
    const runtimeHook = readFileSync(resolve(HARNESS_DIR, 'src/external-capabilities.mjs'), 'utf8')
    assert.match(runtimeHook, /ctx\.on\('tools\/pre-execute', validateBeforeJudgeExecution\)/)
    let dispatched = 0
    const enterJudge = () => validateBeforeJudgeExecution(
      { name: 'quality_judge', agent: { session } },
      async () => { dispatched += 1; return 'allow' },
    )
    assert.equal(await enterJudge(), 'allow')
    assert.equal(dispatched, 1)

    writeFileSync(discovery, completeReferences.replace('[SRC-003]', ''))
    await assert.rejects(
      enterJudge,
      error => error instanceof ContractError
        && error.details.some(detail => detail.code === 'EVIDENCE_SOURCE_REFERENCE_MISSING' && detail.message.includes('SRC-003')),
    )
    assert.equal(dispatched, 1)

    writeFileSync(discovery, completeReferences.replace('[SRC-002]', ''))
    await assert.rejects(
      enterJudge,
      error => error instanceof ContractError
        && error.details.some(detail => detail.code === 'EVIDENCE_SOURCE_REFERENCE_MISSING' && detail.message.includes('SRC-002')),
    )
    assert.equal(dispatched, 1)

    writeFileSync(discovery, completeReferences)
    writeFileSync(join(root, successRecord.record.relative_path), 'tampered')
    assert.throws(
      () => validateEvidenceInput(frozen.manifest),
      error => error instanceof ContractError && error.details.some(detail => detail.code === 'EVIDENCE_SOURCE_HASH_MISMATCH'),
    )
  } finally {
    server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('历史中文冻结路径只拦 Judge，并给出可操作的中文错误且不改磁盘', async () => {
  const root = temporaryRoot()
  try {
    const taskKey = '历史中文冻结包'
    const inputRoot = join(root, '.promax', 'input', taskKey)
    const sourcePath = join(inputRoot, 'sources', 'SRC-001', '测试-访谈记录.txt')
    mkdirSync(join(inputRoot, 'sources', 'SRC-001'), { recursive: true })
    writeFileSync(sourcePath, 'legacy fixture')
    const manifestPath = join(inputRoot, 'manifest.yml')
    const relativePath = `.promax/input/${taskKey}/sources/SRC-001/测试-访谈记录.txt`
    writeFileSync(manifestPath, YAML.stringify({
      api_version: 'promax.ai/v1alpha2',
      kind: 'EvidenceInputManifest',
      metadata: { task_key: taskKey, frozen: true, frozen_at: '2026-09-04T12:00:00.000Z' },
      inputs: { src_files: [{ source_id: 'SRC-001', original_filename: '测试-访谈记录.txt', relative_path: relativePath, bytes: 14, sha256: sha256('legacy fixture'), agent_readable: true }] },
      spec: { source_root: `.promax/input/${taskKey}/sources`, sources: [{ source_id: 'SRC-001', relative_path: relativePath, sha256: sha256('legacy fixture'), media_type: 'text/plain', origin_kind: 'user-provided' }] },
    }))
    const beforeManifest = readFileSync(manifestPath, 'utf8')
    const beforeSource = readFileSync(sourcePath, 'utf8')
    const session = { header: { cwd: root }, events: [{ type: 'user/message', data: { content: [{ type: 'text', text: JSON.stringify({ task_key: taskKey }) }] } }] }
    let dispatched = 0
    const next = async () => { dispatched += 1; return 'allow' }

    assert.equal(await validateBeforeJudgeExecution({ name: 'solution_design', agent: { session } }, next), 'allow')
    await assert.rejects(
      validateBeforeJudgeExecution({ name: 'quality_judge', agent: { session } }, next),
      error => error instanceof ContractError && error.message === '冻结输入不合规：SRC-001 的 relative_path 文件名含非 ASCII 字符（实际值：测试-访谈记录.txt）。该冻结包由旧版本生成，请重新提交任务。',
    )
    assert.equal(dispatched, 1)
    assert.equal(readFileSync(manifestPath, 'utf8'), beforeManifest)
    assert.equal(readFileSync(sourcePath, 'utf8'), beforeSource)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Judge 二元闭集语义未放宽，telemetry 使用 dsh session hook 与本机 SQLite', () => {
  const judge = readFileSync(resolve(HARNESS_DIR, 'modules/independent-judge/agent-module.yml'), 'utf8')
  for (const marker of ['FABRICATED', 'pass 或 fail', '最多两轮', '申诉', '人工强制放行']) assert.ok(judge.includes(marker), marker)
  assert.match(judge, /skill_refs: \[\]/)

  const telemetryDoc = readFileSync(resolve(HARNESS_DIR, 'docs/TELEMETRY-LIMITATIONS.md'), 'utf8')
  assert.match(telemetryDoc, /OpenClaw hook 格式/)
  assert.match(telemetryDoc, /session\/event/)
  assert.match(telemetryDoc, /负责人仍需在人验环境确认/)

  const root = temporaryRoot()
  try {
    const store = new TelemetryStore(join(root, 'telemetry.sqlite'))
    store.record({ sessionId: 'public-fixture', turn: 1, eventType: 'conversation-turn', capability: 'conversation', source: 'hook' })
    store.record({ sessionId: 'public-fixture', turn: 1, eventType: 'tool-call', capability: 'web_search', source: 'runtime' })
    assert.deepEqual(store.summary(), [
      { capability: 'conversation', source: 'hook', calls: 1 },
      { capability: 'web_search', source: 'runtime', calls: 1 },
    ])
    store.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
