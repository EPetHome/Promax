/** M4：仅组装 1.4 的公开模块入口，依赖与副作用由启用的子插件拥有。 */
import * as team from './team/index.mjs';
import * as skill from './skill/index.mjs';
import * as runtime from './runtime/index.mjs';

export const name = 'promax-wb-host';
// 不把关闭模块的依赖提到父级，也不把可选 wbRuntime 变成硬依赖。
export const inject = [];

export async function apply(ctx, config = {}) {
  const modules = { team: true, skill: true, runtime: true, ...config.modules };
  for (const key of ['team', 'skill', 'runtime']) {
    if (typeof modules[key] !== 'boolean') throw new Error(`modules.${key} must be a boolean`);
  }
  const options = { ...config, modules, maxConcurrentForks: config.maxConcurrentForks ?? 16 };
  // 等待服务 fiber 激活后再装 M2；M2 仍只通过 wbRuntime 三方法交互。
  if (modules.runtime) await ctx.plugin(runtime, options);
  if (modules.team) await ctx.plugin(team, options);
  if (modules.skill) await ctx.plugin(skill, options);
}
