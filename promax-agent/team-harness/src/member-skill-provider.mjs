import { lstatSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import YAML from 'yaml'

export const name = 'promax-member-skill-provider'
export const inject = ['skills', 'subagents', 'systemPrompt']

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MEMBER_ID = /^[a-z][a-z0-9_]{2,47}$/

function parseSkill(path, expectedName) {
  const text = readFileSync(path, 'utf8')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error(`Promax member skill ${expectedName} 缺少 YAML frontmatter`)
  const metadata = YAML.parse(match[1]) ?? {}
  if (metadata.name !== expectedName || typeof metadata.description !== 'string' || metadata.description.trim() === '') {
    throw new Error(`Promax member skill ${expectedName} 的 name/description 无效`)
  }
  return { metadata, content: text.slice(match[0].length) }
}

function checkedSkillDir(root, skillName) {
  if (!SKILL_NAME.test(skillName)) throw new Error(`Promax member skill name 无效：${skillName}`)
  const directory = resolve(root, skillName)
  if (directory !== root && !directory.startsWith(`${root}/`)) throw new Error(`Promax member skill 路径越界：${skillName}`)
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Promax member skill 目录无效：${skillName}`)
  const skillFile = join(directory, 'SKILL.md')
  const fileStat = lstatSync(skillFile)
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error(`Promax member skill 缺少普通文件 SKILL.md：${skillName}`)
  return { directory, skillFile }
}

async function memberIdOf(childCtx, allowedMembers) {
  const assembly = await childCtx.systemPrompt.assemble({ scope: childCtx.agent })
  const persona = assembly.sections.find(section => section.name === 'deployment:persona')?.text ?? ''
  const matches = [...persona.matchAll(/(?:^|\n)PROMAX_MEMBER_ID:([a-z][a-z0-9_]{2,47})(?:\n|$)/g)]
  if (matches.length !== 1) throw new Error('Promax member skill provider 无法唯一识别 member_id')
  const memberId = matches[0][1]
  if (!allowedMembers.has(memberId)) throw new Error(`Promax member skill provider 拒绝未知 member_id：${memberId}`)
  return memberId
}

export function apply(ctx, config = {}) {
  const providerName = String(config.providerName ?? 'promax-member-skills')
  const skillDir = resolve(String(config.skillDir ?? ''))
  const memberSkills = new Map(Object.entries(config.memberSkills ?? {}).map(([memberId, names]) => {
    if (!MEMBER_ID.test(memberId) || !Array.isArray(names) || names.some(skillName => typeof skillName !== 'string' || !SKILL_NAME.test(skillName))) {
      throw new Error(`Promax member skill provider 配置无效：${memberId}`)
    }
    return [memberId, [...new Set(names)].sort()]
  }))

  ctx.subagents.registerContinuableSetup((childCtx) => {
    const skills = childCtx.get('skills')
    if (!skills) throw new Error('Promax member skill provider 缺少 skills service')
    return skills.registerProvider(() => {
      const parsed = new Map()
      return {
        name: providerName,
        async list() {
          const memberId = await memberIdOf(childCtx, memberSkills)
          return memberSkills.get(memberId).map((skillName) => {
            const paths = checkedSkillDir(skillDir, skillName)
            const skill = parseSkill(paths.skillFile, skillName)
            parsed.set(skillName, { ...paths, ...skill })
            return {
              name: skillName,
              description: skill.metadata.description,
              invocation: { modelInvocable: true, userInvocable: true },
              source: 'custom',
              provider: providerName,
              resourceBase: { kind: 'directory', path: paths.directory },
              rank: 50,
              locator: skillName,
              path: paths.skillFile,
              metadata: skill.metadata,
            }
          })
        },
        async get(candidate) {
          const memberId = await memberIdOf(childCtx, memberSkills)
          if (!memberSkills.get(memberId).includes(candidate.name)) return undefined
          const loaded = parsed.get(candidate.name) ?? (() => {
            const paths = checkedSkillDir(skillDir, candidate.name)
            return { ...paths, ...parseSkill(paths.skillFile, candidate.name) }
          })()
          return {
            name: candidate.name,
            description: loaded.metadata.description,
            invocation: { modelInvocable: true, userInvocable: true },
            source: 'custom',
            provider: providerName,
            resourceBase: { kind: 'directory', path: loaded.directory },
            path: loaded.skillFile,
            metadata: loaded.metadata,
            content: loaded.content,
          }
        },
      }
    })
  })
}
