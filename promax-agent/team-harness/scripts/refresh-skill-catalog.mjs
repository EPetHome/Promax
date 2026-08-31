import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_FILE = join(ROOT, 'catalogs', 'skills.yml')
const CATALOG_DIR = dirname(CATALOG_FILE)

const current = [
  ['business-diagram-generator', 3, '业务流程图', '生成可追溯、固定区块并含边界真值表的 Mermaid 业务流程图。', '../../agents/product-solution/skills/business-diagram-generator'],
  ['interactive-prototype-generator', 3, '交互原型', '生成单文件、可追溯并可接受浏览器取证的交互原型。', '../../agents/product-solution/skills/interactive-prototype-generator'],
  ['prd-document-generator', 3, 'PRD 文档', '生成固定 0–11 节、可追溯并含边界真值表的 Markdown PRD。', '../../agents/product-solution/skills/prd-document-generator'],
  ['requirement-clarifier', 2, '需求澄清', '基于不可变输入识别阻塞缺口、冲突和可撤销假设。', '../../agents/product-solution/skills/requirement-clarifier'],
  ['interaction-design', 2, '交互设计', '生成可追溯页面地图、任务流、状态矩阵与边界真值表。', '../../agents/product-solution/skills/interaction-design'],
  ['ui-design-system', 2, 'UI 设计系统', '定义方案级 Token、组件状态、响应式、可访问性与证据映射。', '../../agents/product-solution/skills/ui-design-system'],
  ['prototype-quality-audit', 2, '原型质量审计', '执行静态、交互、边界与浏览器证据审计，未实测项诚实标记。', '../../agents/product-solution/skills/prototype-quality-audit'],
  ['rd-handoff-package', 2, '研发交接包', '建立真实文件、版本哈希、跨产物一致性和验收证据交接。', '../../agents/product-solution/skills/rd-handoff-package'],
  ['difference-panel', 2, '竞品差异面板', '根据不可变竞品输入生成固定章节、证据化差异与边界真值表。', '../../agents/product-discovery/skills/difference-panel'],
  ['report-generator', 2, '产品探索报告', '生成固定 0–9 节、可追溯且不外推数据边界的产品探索报告。', '../../agents/product-discovery/skills/report-generator'],
  ['requirement-review', 2, 'PRD 需求评审', '生成固定 0–10 节、问题可定位且含跨产物边界复算的评审报告。', '../../agents/requirement-review/skills/requirement-review'],
  ['logic-detector', 2, 'PRD 逻辑检测', '检查状态、谓词、数据流、时序与三点边界的一致性。', '../../agents/requirement-review/skills/logic-detector'],
  ['issue-tracker', 2, '评审问题追踪', '以版本哈希和复检证据跟踪问题状态与边界回归。', '../../agents/requirement-review/skills/issue-tracker'],
  ['user-feedback-processor', 2, '用户反馈结构化处理', '在样本边界内清洗、去重、分类反馈并保持原文追溯。', '../../agents/user-analysis/skills/user-feedback-processor'],
  ['core-metrics-analysis', 2, '核心业务指标分析', '按明确口径、时间窗和公式分析指标趋势、异常与替代解释。', '../../agents/user-analysis/skills/core-metrics-analysis'],
  ['app-market-sentiment', 2, '应用市场舆情', '只分析已冻结评论样本，区分个案、声量、反例与总体边界。', '../../agents/user-analysis/skills/app-market-sentiment'],
  ['data-visualization', 2, '数据可视化', '把可追溯数据转为诚实尺度、完整口径和可取证的可视化。', '../../agents/user-analysis/skills/data-visualization'],
  ['feishu-requirement-entry', 1, '飞书需求录入', '通过固定版 Lark CLI 网关执行只读字段检查和写入 dry-run。', '../../agents/requirement-management/skills/feishu-requirement-entry'],
  ['feishu-requirement-board', 1, '飞书需求看板', '通过固定版 Lark CLI 网关只读生成可追溯的需求看板摘要。', '../../agents/requirement-management/skills/feishu-requirement-board'],
  ['feishu-requirement-archive', 1, '飞书需求归档', '通过固定版 Lark CLI 网关只读生成归档统计，不执行外部写入。', '../../agents/requirement-management/skills/feishu-requirement-archive'],
  ['pm-weekly-monitor', 1, '项目周报被动分析', '被动接受后端派单，只读分析周报快照，不注册定时或主动推送。', '../../agents/requirement-management/skills/pm-weekly-monitor'],
]

const legacyMoves = new Map([
  ['business-diagram-generator@2', '../../agents/product-solution/skills-v2/business-diagram-generator'],
  ['interactive-prototype-generator@2', '../../agents/product-solution/skills-v2/interactive-prototype-generator'],
  ['prd-document-generator@2', '../../agents/product-solution/skills-v2/prd-document-generator'],
  ...['requirement-clarifier', 'interaction-design', 'ui-design-system', 'prototype-quality-audit', 'rd-handoff-package']
    .map(name => [`${name}@1`, `../../agents/product-solution/skills-v1/${name}`]),
  ...['difference-panel', 'report-generator'].map(name => [`${name}@1`, `../../agents/product-discovery/skills-v1/${name}`]),
  ...['requirement-review', 'logic-detector', 'issue-tracker'].map(name => [`${name}@1`, `../../agents/requirement-review/skills-v1/${name}`]),
  ...['user-feedback-processor', 'core-metrics-analysis', 'app-market-sentiment', 'data-visualization']
    .map(name => [`${name}@1`, `../../agents/user-analysis/skills-v1/${name}`]),
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

function treeHash(root) {
  const files = []
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push({ relative_path: relative(root, path).split(sep).join('/'), sha256: sha256(readFileSync(path)) })
      else throw new Error(`unsupported skill entry: ${path}`)
    }
  }
  visit(root)
  return sha256(JSON.stringify(canonical(files)))
}

function refresh(entry) {
  const source = resolve(CATALOG_DIR, entry.source_path)
  const skillFile = join(source, 'SKILL.md')
  return { ...entry, content_sha256: sha256(readFileSync(skillFile)), tree_sha256: treeHash(source) }
}

const existing = YAML.parse(readFileSync(CATALOG_FILE, 'utf8')).skills
  .map(entry => refresh({ ...entry, source_path: legacyMoves.get(entry.skill_ref) ?? entry.source_path }))
const additions = current.map(([skill_id, revision, display_name, description, source_path]) => refresh({
  skill_ref: `${skill_id}@${revision}`,
  skill_id,
  revision,
  display_name,
  description,
  status: 'allowed',
  source_path,
}))
const byRef = new Map([...existing, ...additions].map(entry => [entry.skill_ref, entry]))
const skills = [...byRef.values()].sort((a, b) => a.skill_id.localeCompare(b.skill_id) || a.revision - b.revision)
writeFileSync(CATALOG_FILE, YAML.stringify({ schema_version: 1, skills }, { lineWidth: 0 }))
console.log(JSON.stringify({ skills: skills.length, current: current.length }))
