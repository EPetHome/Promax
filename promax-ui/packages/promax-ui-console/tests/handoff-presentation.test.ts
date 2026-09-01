import { describe, expect, it } from 'vitest'

import { artifactPresentationOf, inferCoverageInformationKeys, recommendArtifactPaths } from '../src/client/handoff-presentation.ts'

const artifacts = [
  { relativePath: 'deliverables/{task_key}/customer_research.md', producedBy: 'customer_research', required: true },
  { relativePath: 'deliverables/{task_key}/prd.md', producedBy: 'solution_design', required: true },
  { relativePath: 'deliverables/{task_key}/prototype.html', producedBy: 'solution_design', required: false },
]

describe('plain-language handoff presentation', () => {
  it('recommends the customer report for a research task instead of blindly defaulting to PRD', () => {
    expect(recommendArtifactPaths('模拟一份用户调研数据', artifacts)).toEqual([
      'deliverables/{task_key}/customer_research.md',
    ])
    expect(artifactPresentationOf('deliverables/{task_key}/customer_research.md')).toMatchObject({
      label: '客户调研报告',
      recommendationReason: '任务涉及用户调研、客户需求或访谈',
    })
  })

  it('falls back to PRD for a generic product task and recognizes only explicit draft information', () => {
    expect(recommendArtifactPaths('做一个云盘方案', artifacts)).toEqual(['deliverables/{task_key}/prd.md'])
    expect(inferCoverageInformationKeys(`
## 背景

- 暂无

## 要解决什么

- 做一个云盘方案

## 已知约束

- 暂无
`)).toEqual(['goal'])
    expect(inferCoverageInformationKeys('目标：设计预约流程；目标用户：社区居民；成功标准：完成率达到 80%')).toEqual([
      'goal', 'target_user', 'success_criteria',
    ])
  })
})
