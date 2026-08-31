import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { HARNESS_DIR } from '../src/harness.mjs'
import { validateCustomerResearchReport } from '../src/customer-research-validation.mjs'

const validReport = `# 客户研究报告：公开虚构案例

## 0 交付状态
已完成生产侧自检，不等于 Judge 通过。
## 1 输入证据清单
| 来源 | 路径 | 限制 |
|---|---|---|
| SRC-001 | input.md:1-4 | 仅 2 个虚构样本 |
## 2 样本与场景
S-001 与 S-002，共 2 个虚构样本。
## 3 样本边界与外推限制
| 结论编号 | observed_count | sample_size | 计算式 | 允许表述 | 禁止表述 |
|---|---:|---:|---|---|---|
| F-001 | 1 | 2 | 1/2 | 本批样本中的个案 | 总体偏好 |
## 4 访谈摘要
E-001（SRC-001，input.md:2）：S-001 需要减少重复录入。
## 5 关键发现
| 编号 | 发现 | 证据 |
|---|---|---|
| F-001 | 本批样本中 S-001 提到重复录入 | E-001 |
## 6 痛点与候选需求
| 编号 | 类型 | 内容 | 证据 |
|---|---|---|---|
| P-001 | 痛点 | S-001 重复录入 | E-001 |
| N-001 | 候选需求 | 待验证的减少录入建议 | E-001 |
## 7 证据追溯矩阵
| 结论编号 | E | SRC | 输入原文与位置 | 分类 | 适用样本 | 限制 |
|---|---|---|---|---|---|---|
| F-001 | E-001 | SRC-001 | input.md:2 | 事实 | S-001 | 个案 |
| P-001 | E-001 | SRC-001 | input.md:2 | 推断 | S-001 | 个案 |
| N-001 | E-001 | SRC-001 | input.md:2 | 建议 | S-001 | 待验证 |
## 8 矛盾、缺口与未验证项
未提供总体样本，不能外推。
## 9 下游移交
仅移交候选需求 N-001，不代表批准。
## 10 逐项自检
CR-01 pass；CR-02 pass；CR-03 pass；CR-04 pass；CR-05 pass；CR-06 pass；CR-07 pass；CR-08 pass；CR-09 pass。
`

test('customer-research r4 固定章节、证据矩阵与样本边界通过确定性校验', () => {
  assert.deepEqual(validateCustomerResearchReport(validReport), { valid: true, issues: [] })
})

test('customer-research r4 拒绝 observed_count 大于 sample_size', () => {
  const invalid = validReport.replace('| F-001 | 1 | 2 | 1/2 |', '| F-001 | 3 | 2 | 3/2 |')
  const result = validateCustomerResearchReport(invalid)
  assert.equal(result.valid, false)
  assert.ok(result.issues.some(item => item.code === 'CUSTOMER_RESEARCH_SAMPLE_OVERFLOW'))
})

test('customer-research r4 拒绝结论缺证据与总体外推', () => {
  const invalid = validReport
    .replace('| F-001 | 本批样本中 S-001 提到重复录入 | E-001 |', '| F-001 | 大多数客户偏好自动处理 | 无 |')
    .replace('| F-001 | E-001 | SRC-001 |', '| F-001 | 无 | SRC-001 |')
  const result = validateCustomerResearchReport(invalid)
  assert.equal(result.valid, false)
  assert.ok(result.issues.some(item => item.code === 'CUSTOMER_RESEARCH_CONCLUSION_EVIDENCE_MISSING'))
  assert.ok(result.issues.some(item => item.code === 'CUSTOMER_RESEARCH_TRACE_UNMAPPED'))
  assert.ok(result.issues.some(item => item.code === 'CUSTOMER_RESEARCH_POPULATION_EXTRAPOLATION'))
})

test('步骤一真实产物作为静态 calibration fixture，不伪装成 r4 合格样本', () => {
  const legacy = readFileSync(resolve(HARNESS_DIR, 'fixtures/customer-research/step1-legacy/artifact.md'), 'utf8')
  const result = validateCustomerResearchReport(legacy)
  assert.equal(result.valid, false)
  assert.ok(result.issues.some(item => item.code === 'CUSTOMER_RESEARCH_HEADING_MISSING'))
})
