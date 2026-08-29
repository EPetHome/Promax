import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { finalizeConfigurationSession } from './configuration.mjs'
import { HARNESS_DIR } from './harness.mjs'

export const name = 'promax-team-configurator-tool'
export const inject = ['tools']

function resolvedConfig(config = {}) {
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const contentRoot = resolve(config.contentRoot ?? HARNESS_DIR)
  return {
    stateRoot: resolve(config.stateRoot ?? join(dshHome, '.promax', 'configuration-sessions')),
    presetRoot: resolve(config.presetRoot ?? join(dshHome, '.agent-presets')),
    modulesDir: resolve(contentRoot, 'modules'),
    recipesDir: resolve(contentRoot, 'recipes'),
    skillCatalogFile: resolve(contentRoot, 'catalogs/skills.yml'),
    toolProfilesFile: resolve(contentRoot, 'catalogs/tool-profiles.yml'),
    skillSourceRoot: resolve(config.skillSourceRoot ?? resolve(contentRoot, '..')),
  }
}

const participantProperties = {
  display_name: { type: 'string', description: '面向用户的中文或自然语言角色名。' },
  role_instructions: { type: 'string', description: '该角色的职责、输入、输出和协作边界；不能包含系统权限或安全覆盖。' },
  persona_fragment: { type: 'string', description: '可选的表达风格或领域语境补充。' },
  skill_refs: {
    type: 'array',
    description: '只填写配置上下文明确列出的允许 Skill 精确引用；没有就留空。',
    items: { type: 'string' },
  },
}

export function createConfiguratorTool(config = {}) {
  const resolved = resolvedConfig(config)
  return {
    name: 'finalize_team_configuration',
    description: '当团队角色、分工和能力已经明确时，提交受限团队蓝图。Harness 会校验允许模块与 Skill，并原子冻结为新团队的首个运行版本。信息不足时不要调用，直接向用户追问。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'coordinator', 'workers'],
      properties: {
        summary: { type: 'string', description: '一句话概括团队分工。' },
        coordinator: {
          type: 'object',
          additionalProperties: false,
          required: ['display_name', 'role_instructions'],
          properties: participantProperties,
        },
        workers: {
          type: 'array',
          description: '1-12 名稳定 worker；职责应尽量互斥，member_id 使用小写字母、数字和下划线。',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['member_id', 'display_name', 'role_instructions', 'capability_profile'],
            properties: {
              member_id: { type: 'string', description: '稳定成员 id，例如 fact_checker。' },
              ...participantProperties,
              capability_profile: {
                type: 'string',
                enum: ['general', 'prd', 'diagram', 'prototype'],
                description: '底层允许能力类型；不确定时使用 general。',
              },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['status', 'message', 'team'],
        properties: {
          status: { type: 'string' },
          message: { type: 'string' },
          team: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('配置工具只能在 dsh Agent 会话内调用。')
      const result = finalizeConfigurationSession({
        ...resolved,
        sessionId: String(exec.agent.id),
        blueprint: args,
      })
      exec.concludeTurn()
      return result
    },
  }
}

export function apply(ctx, config = {}) {
  ctx.tools.register(createConfiguratorTool(config))
}
