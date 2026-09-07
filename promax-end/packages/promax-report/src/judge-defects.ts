import { basename } from 'node:path'

export interface JudgeArtifactOwner {
  relative_path: string
  produced_by: string
}

export interface JudgeDefect {
  time: number
  round: number
  artifact: string
  ownerType: 'skill' | 'agent' | 'judge' | '输入' | '未判定'
  ownerName: string
  ruleId: string
  reason: string
}

const clean = (text: string): string => text.replace(/[*`]/gu, '').trim()
const verdict = (text: string): string | undefined => /\b(pass|fail|block)\b/iu.exec(clean(text))?.[1]?.toLowerCase()

/** Only explicit current FAIL decisions qualify; historical mentions and PASS rows do not. */
// ponytail: parses explicit Markdown headings/rows; add a versioned structured Judge format if its prose changes.
export function parseJudgeDefects(input: {
  text: string
  time: number
  round: number
  artifacts: readonly JudgeArtifactOwner[]
  ruleIds: readonly string[]
  skillNames: readonly string[]
}): JudgeDefect[] {
  const lines = input.text.split(/\r?\n/u)
  const rules = new Set(['FABRICATED', 'MISLABELED', 'DROPPED', 'INPUT_CONTRADICTION_UNHANDLED', 'OUTPUT_SELF_CONTRADICTION', ...input.ruleIds])
  const candidates: Array<JudgeDefect & { detailed: boolean }> = []
  let artifact = input.artifacts.length === 1 ? input.artifacts[0] : undefined
  let artifactVerdict: string | undefined
  let artifactDepth = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = clean(lines[index]!)
    const heading = /^(#{1,6})\s/u.exec(line)
    const named = input.artifacts.filter(item => line.includes(item.relative_path) || line.includes(basename(item.relative_path)))
    if (heading && artifactDepth > 0 && heading[1]!.length <= artifactDepth) {
      artifact = input.artifacts.length === 1 ? input.artifacts[0] : undefined
      artifactVerdict = undefined
      artifactDepth = 0
    }
    if (named.length === 1 && (heading || /产物路径|artifact_path/u.test(line))) {
      artifact = named[0]
      artifactVerdict = heading ? verdict(line) : undefined
      artifactDepth = heading?.[1]?.length ?? 0
    }
    if (artifactVerdict === 'pass') continue
    const ids = [...line.matchAll(/\b[A-Z][A-Z0-9_]+\b/gu)].map(match => match[0]).filter(id => rules.has(id))
    if (ids.length !== 1) continue
    const ruleId = ids[0]!
    let reason = ''
    let detailed = false
    if (heading) {
      if (verdict(line.slice(line.indexOf(ruleId) + ruleId.length)) !== 'fail') continue
      let end = index + 1
      while (end < lines.length) {
        const next = /^(#{1,6})\s/u.exec(lines[end]!)
        if (next && next[1]!.length <= heading[1]!.length) break
        end += 1
      }
      reason = lines.slice(index, end).join('\n')
      detailed = true
    } else if (line.startsWith('|')) {
      const cells = line.split(/(?<!\\)\|/u).map(clean)
      if (!cells.some(cell => /^(?:fail|block)$/iu.test(cell))) continue
      reason = lines[index]!
    } else if (/^(?:[-+]\s*)?(?:rule_id|规则)\s*[:：]/iu.test(line)) {
      let end = index + 1
      while (end < lines.length && !/^#{1,6}\s/u.test(lines[end]!)) end += 1
      const block = lines.slice(index, end).join('\n')
      if (!/(?:verdict|判定|结论)\s*[:：=]\s*\**(?:fail|block)\b/iu.test(block)) continue
      reason = block
      detailed = true
    } else continue
    const explicitArtifacts = input.artifacts.filter(item => reason.includes(item.relative_path) || reason.includes(basename(item.relative_path)))
    const owner = explicitArtifacts.length === 1 ? explicitArtifacts[0] : artifact
    const explicitOwner = /(?:owner|责任成员|产物负责人)\s*[:：=]\s*`?([a-z][a-z0-9_]+)/iu.exec(reason)?.[1]
    const knownOwner = explicitOwner && (explicitOwner === 'quality_judge' || input.artifacts.some(item => item.produced_by === explicitOwner)) ? explicitOwner : undefined
    const ownerName = knownOwner ?? owner?.produced_by ?? '未判定'
    // A skill is blamed only when Judge explicitly names it beside a format defect.
    const skills = [...new Set(input.skillNames)].filter(name => reason.split(/\n|[。；]/u).some(sentence =>
      sentence.includes(name) && /(?:格式|章节|结构|模板|输出规范)/u.test(sentence)
      && /(?:缺少|缺失|不符合|错误|未满足|未包含|不完整)/u.test(sentence)
      && !/(?:不是|并非|不归因于|无关)/u.test(sentence)))
    candidates.push({
      time: input.time, round: input.round,
      artifact: owner ? basename(owner.relative_path) : '未判定',
      ownerType: skills.length === 1 ? 'skill' : ownerName === '未判定' ? '未判定' : ownerName === 'quality_judge' ? 'judge' : 'agent',
      ownerName: skills.length === 1 ? skills[0]! : ownerName,
      ruleId, reason: reason.trim().slice(0, 3000), detailed,
    })
  }
  // A summary table and its detailed section describe the same decision.
  const detailKeys = new Set(candidates.filter(row => row.detailed).map(row => `${row.artifact}\0${row.ruleId}`))
  const seen = new Set<string>()
  return candidates.filter(row => {
    if (!row.detailed && detailKeys.has(`${row.artifact}\0${row.ruleId}`)) return false
    const key = `${row.artifact}\0${row.ruleId}\0${row.reason}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(({ detailed: _, ...row }) => row)
}
