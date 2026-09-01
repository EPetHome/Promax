import { INFORMATION_KEYS, type InformationKey, type TaskPlanningArtifact } from './task-planning.ts'

export interface ArtifactPresentation {
  label: string
  description: string
  recommendationReason: string
  keywords: readonly string[]
}

const ARTIFACT_PRESENTATIONS: Array<{ suffix: string; presentation: ArtifactPresentation }> = [
  { suffix: '/customer_research.md', presentation: { label: '客户调研报告', description: '整理客户需求、访谈发现和调研结论', recommendationReason: '任务涉及用户调研、客户需求或访谈', keywords: ['用户调研', '客户调研', '市场调研', '访谈', '问卷', '调研数据'] } },
  { suffix: '/product_discovery.md', presentation: { label: '产品探索报告', description: '分析产品机会、竞品和方向选择', recommendationReason: '任务涉及产品机会、竞品或方向探索', keywords: ['产品探索', '产品机会', '市场机会', '竞品', '竞争分析', '产品方向'] } },
  { suffix: '/requirement_management.md', presentation: { label: '需求管理清单', description: '整理需求条目、范围和优先级', recommendationReason: '任务需要梳理需求清单、范围或优先级', keywords: ['需求管理', '需求清单', '需求池', '优先级', '需求梳理'] } },
  { suffix: '/prd.md', presentation: { label: '产品需求文档（PRD）', description: '形成可评审、可实施的产品需求方案', recommendationReason: '任务需要形成产品需求或完整产品方案', keywords: ['PRD', '产品需求', '需求文档', '产品方案', '功能方案', '产品设计'] } },
  { suffix: '/business-diagram.md', presentation: { label: '业务流程图', description: '呈现角色、步骤和业务流转关系', recommendationReason: '任务需要说明业务流程或角色协作', keywords: ['业务流程', '流程图', '流程设计', '业务流转'] } },
  { suffix: '/prototype.html', presentation: { label: '交互原型', description: '生成可打开、可操作的页面原型', recommendationReason: '任务需要页面、交互或可视化原型', keywords: ['原型', '交互', '页面设计', '界面设计', 'UI'] } },
  { suffix: '/requirement_review.md', presentation: { label: '需求评审报告', description: '检查需求完整性、冲突和实施风险', recommendationReason: '任务需要评审、审查或风险检查', keywords: ['需求评审', '评审报告', '需求审查', '风险检查'] } },
  { suffix: '/user_analysis.md', presentation: { label: '用户分析报告', description: '分析用户画像、行为、分群和特征', recommendationReason: '任务涉及用户画像、行为或人群分析', keywords: ['用户分析', '用户画像', '用户行为', '用户分群', '人群分析'] } },
]

const FALLBACK_PRESENTATION: ArtifactPresentation = {
  label: '交付结果',
  description: '由团队生成的任务交付物',
  recommendationReason: '与当前任务目标直接相关',
  keywords: [],
}

export function artifactPresentationOf(path: string): ArtifactPresentation {
  return ARTIFACT_PRESENTATIONS.find(item => path.endsWith(item.suffix))?.presentation ?? FALLBACK_PRESENTATION
}

/** Suggests user-facing deliverables only; runtime member planning remains deterministic elsewhere. */
export function recommendArtifactPaths(wanted: string, artifacts: readonly TaskPlanningArtifact[]): string[] {
  const matches = artifacts.filter(artifact => {
    const presentation = artifactPresentationOf(artifact.relativePath)
    return presentation.keywords.some(keyword => wanted.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()))
  }).map(artifact => artifact.relativePath)
  if (matches.length > 0) return [...new Set(matches)]
  const prd = artifacts.find(artifact => artifact.relativePath.endsWith('/prd.md'))
  return prd === undefined ? artifacts.slice(0, 1).map(artifact => artifact.relativePath) : [prd.relativePath]
}

function sectionHasContent(markdown: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'u').exec(markdown)
  if (match === null) return false
  return match[1]!.split('\n').some(line => {
    const value = line.replace(/^[-*]\s*/u, '').replace(/^⟲\s*补整理\s*·\s*/u, '').trim()
    return value !== '' && value !== '暂无'
  })
}

/** Conservative, deterministic recognition: only explicit wording is marked as present. */
export function inferCoverageInformationKeys(wanted: string): InformationKey[] {
  const patterns: Partial<Record<InformationKey, RegExp>> = {
    target_user: /目标用户|目标客户|目标人群|面向.{0,16}(?:用户|客户|人群)|服务于.{0,16}(?:用户|客户|人群)/u,
    scenario: /使用场景|业务场景|应用场景|场景[：:]|在.{1,20}(?:时|情况下)/u,
    pain_point: /痛点|当前问题|问题在于|困难|不便|不足/u,
    scope: /范围|本期|一期|MVP|不包括|不包含/u,
    constraint: /约束|限制|必须遵守|不能使用|不得使用/u,
    success_criteria: /成功标准|验收标准|验收条件|衡量指标|成功指标/u,
    competitive_difference: /竞品|竞争对手|差异化|竞品对比/u,
    requirements_priority: /需求条目|需求清单|优先级|P0|P1|P2/u,
  }
  const found = new Set<InformationKey>()
  const searchable = wanted.replace(/^##\s+.*$/gmu, '').replace(/^\s*[-*]\s*暂无\s*$/gmu, '')
  if (sectionHasContent(wanted, '要解决什么') || wanted.replace(/[#>*_`\-\s]|暂无/gu, '') !== '') found.add('goal')
  if (sectionHasContent(wanted, '已知约束')) found.add('constraint')
  for (const key of INFORMATION_KEYS) {
    if (patterns[key]?.test(searchable) === true) found.add(key)
  }
  return INFORMATION_KEYS.filter(key => found.has(key))
}
