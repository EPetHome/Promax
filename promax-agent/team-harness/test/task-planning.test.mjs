import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  calculateTaskPlan,
  compileTeam,
  ContractError,
  deriveInformationVocabulary,
  freezeEvidenceInput,
  HARNESS_DIR,
  INFORMATION_KEYS,
  readYaml,
  validateCoverageDecision,
  validators,
  writeTaskPackage,
} from '../src/harness.mjs'

const definitionFile = resolve(HARNESS_DIR, 'definitions/team-mtcjsbcz-04tpe2.yml')

function temporaryRoot() {
  return mkdtempSync(join(tmpdir(), 'promax-task-planning-'))
}

function coverage(taskKey, revision, keys, relativePath = `.promax/input/${taskKey}/sources/SRC-001/public-input.md`) {
  return {
    api_version: 'promax.ai/v1alpha2',
    kind: 'CoverageDecision',
    metadata: {
      task_key: taskKey,
      revision,
      confirmed_at: `2026-08-31T12:0${revision}:00-04:00`,
    },
    spec: {
      input_manifest_path: `.promax/input/${taskKey}/manifest.yml`,
      sources: keys.length === 0 ? [] : [{
        source_id: 'SRC-001',
        covers: keys.map((informationKey, index) => ({
          information_key: informationKey,
          locator: {
            relative_path: relativePath,
            location_type: 'line',
            value: `${index + 1}-${index + 1}`,
          },
        })),
      }],
    },
  }
}

function compileProductTeam(root) {
  const compiled = compileTeam({ definitionFile, revision: 10, outputDir: root })
  return readYaml(join(compiled.outputPath, 'team-revision.yml'))
}

function artifactPath(revision, filename) {
  return revision.spec.artifacts.find(artifact => artifact.relative_path.endsWith(`/${filename}`)).relative_path
}

test('九项词表由当前 TeamRevision 的 provides 去重生成，kind 与 validation_kind 保持独立', () => {
  const root = temporaryRoot()
  try {
    const revision = compileProductTeam(root)
    assert.deepEqual(revision.spec.information_vocabulary, INFORMATION_KEYS)
    assert.deepEqual(
      deriveInformationVocabulary([revision.spec.coordinator, ...revision.spec.members]),
      INFORMATION_KEYS,
    )
    const prd = revision.spec.artifacts.find(artifact => artifact.relative_path.endsWith('/prd.md'))
    assert.equal(prd.kind, 'prd')
    assert.equal(prd.validation_kind, 'prd')
    assert.ok(Object.keys(revision.spec.domain_rubrics).length > 0)
    const judge = revision.spec.members.find(member => member.member_id === 'quality_judge')
    assert.deepEqual(judge.provides, [])
    assert.deepEqual(judge.requires, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('AgentModule requires 引用九项受控词表外条目时 Schema 拒绝', () => {
  const module = readYaml(resolve(HARNESS_DIR, 'modules/customer-research/agent-module.yml'))
  module.spec.requires.push('uncontrolled_key')
  const validate = validators().AgentModule
  assert.equal(validate(module), false)
  assert.ok(validate.errors.some(error => error.instancePath.endsWith('/requires/1') && error.keyword === 'enum'))
})

test('覆盖登记缺少文件与行号/段落/页码定位时拒绝', () => {
  const decision = coverage('public-demo', 1, ['goal'])
  delete decision.spec.sources[0].covers[0].locator
  assert.throws(
    () => validateCoverageDecision(decision),
    error => error instanceof ContractError
      && error.details.some(detail => detail.field_path.includes('/spec/sources/0/covers/0')),
  )
})

test('机械差集覆盖 draft/single/team、五种槽位状态与动态成员产物数', () => {
  const root = temporaryRoot()
  try {
    const revision = compileProductTeam(root)
    const prd = artifactPath(revision, 'prd.md')
    const research = artifactPath(revision, 'customer_research.md')
    const management = artifactPath(revision, 'requirement_management.md')

    const draft = calculateTaskPlan({
      teamRevision: revision,
      coverage: coverage('public-demo', 1, []),
      requestedArtifactPaths: [],
    })
    assert.equal(draft.tier, 'draft')
    assert.deepEqual(draft.member_ids, [])
    assert.deepEqual(draft.artifacts, [])

    const single = calculateTaskPlan({
      teamRevision: revision,
      coverage: coverage('public-demo', 1, ['goal']),
      requestedArtifactPaths: [research],
    })
    assert.equal(single.tier, 'single')
    assert.equal(single.member_ids.length, 1)
    assert.equal(single.artifacts.length, 1)

    const team = calculateTaskPlan({
      teamRevision: revision,
      coverage: coverage('public-demo', 1, ['goal']),
      requestedArtifactPaths: [prd],
      producedArtifactPaths: [management],
    })
    assert.equal(team.tier, 'team')
    assert.deepEqual(team.member_ids, ['customer_research', 'requirement_management', 'solution_design'])
    assert.deepEqual(team.artifacts, [
      'deliverables/public-demo/prd.md',
      'deliverables/public-demo/customer_research.md',
      'deliverables/public-demo/requirement_management.md',
    ])
    assert.notEqual(team.member_ids.length, 7)
    assert.notEqual(team.artifacts.length, 8)
    assert.equal(team.slots.find(slot => slot.member_id === 'requirement_management').status, 'produced')
    assert.equal(team.slots.find(slot => slot.member_id === 'solution_design').status, 'pending')
    assert.equal(team.slots.find(slot => slot.member_id === 'product_discovery').status, 'empty_non_blocking')

    const covered = calculateTaskPlan({
      teamRevision: revision,
      coverage: coverage('public-demo', 1, ['goal', 'target_user', 'scenario', 'pain_point', 'competitive_difference']),
      requestedArtifactPaths: [prd],
    })
    assert.equal(covered.slots.find(slot => slot.member_id === 'product_discovery').status, 'provided')

    const gap = calculateTaskPlan({
      teamRevision: revision,
      coverage: coverage('public-demo', 1, ['target_user', 'scenario', 'pain_point', 'constraint', 'requirements_priority']),
      requestedArtifactPaths: [prd],
    })
    const solutionGap = gap.slots.find(slot => slot.member_id === 'solution_design')
    assert.equal(solutionGap.status, 'gap')
    assert.deepEqual(solutionGap.missing, ['goal'])

    const statuses = new Set([
      ...draft.slots.map(slot => slot.status),
      ...single.slots.map(slot => slot.status),
      ...team.slots.map(slot => slot.status),
      ...covered.slots.map(slot => slot.status),
      ...gap.slots.map(slot => slot.status),
    ])
    assert.deepEqual([...statuses].sort(), ['empty_non_blocking', 'gap', 'pending', 'produced', 'provided'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('B2 任务文件分离落盘且 coverage revision 必须逐次递增', () => {
  const root = temporaryRoot()
  const compiledRoot = temporaryRoot()
  try {
    const source = join(root, 'public-input.md')
    writeFileSync(source, '# Public demo\nGoal: summarize a public library booking flow.\n')
    freezeEvidenceInput({
      workspaceRoot: root,
      taskKey: 'public-demo',
      sources: [{ source_id: 'SRC-001', path: source, media_type: 'text/markdown', origin_kind: 'user-provided' }],
    })
    const manifestFile = join(root, '.promax/input/public-demo/manifest.yml')
    const manifest = readYaml(manifestFile)
    const revision = compileProductTeam(compiledRoot)
    const research = artifactPath(revision, 'customer_research.md')
    const decision = coverage('public-demo', 1, ['goal'], manifest.spec.sources[0].relative_path)
    const handoff = {
      wanted: '基于公开示例整理一份脱敏客研报告',
      available: [{ source_id: 'SRC-001', information_keys: ['goal'] }],
      starting_point: ['customer_research'],
      known_gaps: [],
    }
    const written = writeTaskPackage({
      workspaceRoot: root,
      parentSessionId: 'parent-session',
      teamRevision: revision,
      inputManifest: manifest,
      coverage: decision,
      requestedArtifactPaths: [research],
      handoff,
      computedAt: '2026-08-31T12:01:00-04:00',
    })
    assert.equal(written.tier, 'single')
    assert.equal(written.task_package, '.promax/tasks/public-demo/task-package.yml')
    assert.ok(existsSync(join(root, written.task_package)))
    assert.ok(existsSync(join(root, written.coverage)))
    assert.ok(existsSync(join(root, written.slots)))
    const taskPackageText = readFileSync(join(root, written.task_package), 'utf8')
    assert.ok(taskPackageText.includes('.promax/input/public-demo/manifest.yml'))
    assert.ok(!taskPackageText.includes('draft_messages'))
    assert.deepEqual(readYaml(join(root, written.task_package)).spec.requested_artifacts, [research.replaceAll('{task_key}', 'public-demo')])

    assert.throws(
      () => writeTaskPackage({
        workspaceRoot: root,
        parentSessionId: 'parent-session',
        teamRevision: revision,
        inputManifest: manifest,
        coverage: decision,
        requestedArtifactPaths: [research],
        handoff,
      }),
      error => error instanceof ContractError && error.details.some(detail => detail.code === 'COVERAGE_REVISION_SEQUENCE'),
    )

    const revisionTwo = structuredClone(decision)
    revisionTwo.metadata.revision = 2
    revisionTwo.metadata.confirmed_at = '2026-08-31T12:02:00-04:00'
    writeTaskPackage({
      workspaceRoot: root,
      parentSessionId: 'parent-session',
      teamRevision: revision,
      inputManifest: manifest,
      coverage: revisionTwo,
      requestedArtifactPaths: [research],
      handoff,
      computedAt: '2026-08-31T12:02:00-04:00',
    })
    assert.equal(readYaml(join(root, written.coverage)).metadata.revision, 2)
    assert.equal(readYaml(join(root, written.slots)).metadata.coverage_revision, 2)
    assert.deepEqual(readYaml(join(root, written.run_control)).spec, { state: 'running', run_epoch: 1 })
    assert.deepEqual(readYaml(join(root, written.task_package)).spec.requested_artifacts, [research.replaceAll('{task_key}', 'public-demo')])
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(compiledRoot, { recursive: true, force: true })
  }
})

test('内部差集补跑产物不改写用户请求产物集合', () => {
  const root = temporaryRoot()
  const compiledRoot = temporaryRoot()
  try {
    const source = join(root, 'public-input.md')
    writeFileSync(source, '# Public demo\nGoal: design a public library booking flow.\n')
    freezeEvidenceInput({
      workspaceRoot: root,
      taskKey: 'public-demo',
      sources: [{ source_id: 'SRC-001', path: source, media_type: 'text/markdown', origin_kind: 'user-provided' }],
    })
    const manifest = readYaml(join(root, '.promax/input/public-demo/manifest.yml'))
    const revision = compileProductTeam(compiledRoot)
    const prd = artifactPath(revision, 'prd.md')
    const written = writeTaskPackage({
      workspaceRoot: root,
      parentSessionId: 'parent-session',
      teamRevision: revision,
      inputManifest: manifest,
      coverage: coverage('public-demo', 1, ['goal'], manifest.spec.sources[0].relative_path),
      requestedArtifactPaths: [prd],
      handoff: { wanted: '生成一份脱敏 PRD', available: [], starting_point: ['solution_design'], known_gaps: [] },
      computedAt: '2026-08-31T12:01:00-04:00',
    })
    assert.equal(written.tier, 'team')
    assert.ok(readYaml(join(root, written.slots)).spec.slots.filter(slot => slot.status === 'pending').length > 1)
    assert.deepEqual(readYaml(join(root, written.task_package)).spec.requested_artifacts, [prd.replaceAll('{task_key}', 'public-demo')])
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(compiledRoot, { recursive: true, force: true })
  }
})
