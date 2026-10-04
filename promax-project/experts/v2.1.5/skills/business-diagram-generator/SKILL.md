---
name: business-diagram-generator
description: Generate traceable Mermaid diagrams for product solutions, including
  user flows, swimlanes, state diagrams, page maps, decision flows, and product-level
  sequences. Use when roles, transitions, branches, page relationships, or lifecycle
  states are easier to review visually than in prose.
---

# 业务图生成｜内联执行

加载后在当前上下文执行，不启动子模型。先读 `references/inline-execution.md` 与 `references/diagram-rules.md`。

读取本次原始要求、已确认规则和已有方案，直接生成用户需要的业务图；保留来源、冲突、未决项和实际渲染状态。不要要求先重新生成完整 PRD，不调用其它生成 Skill。

保存后 checkpoint 并展示实际路径，必要检查完成或明确未验证后 complete。复用本次 Hook 编号，不把仅加载规范当成已完成。

## 本次任务输入

$ARGUMENTS
