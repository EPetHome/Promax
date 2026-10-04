import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, cp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { WorkStore } from "../src/work-store.ts";
import { CURRENT_PRODUCT_PRESET, productRevisionForSession, resolveLegacyProductPreset } from "../src/promax-session-binding.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const published = (n: number) => resolve(import.meta.dirname, `../../../../promax-agent/team-harness/generated/r${n}/${n >= 10 ? "promax-team-r10" : "promax-team"}`);
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "promax-preset-binding-")); roots.push(root);
  const home = join(root, "runtime"), workspace = join(root, "project");
  await mkdir(workspace, { recursive: true });
  for (const n of [4, 5, 7, 8, 9, 10]) {
    const id = n === 10 ? CURRENT_PRODUCT_PRESET : `promax-team-r${n}-legacy`;
    await cp(published(n), join(home, ".agent-presets", id), { recursive: true });
  }
  const publishedRoot = join(home, "profiles", "web", "node_modules", "@promax", "team-harness", "generated");
  for (const n of [4, 5, 7, 8, 9, 10])
    await cp(published(n), join(publishedRoot, `r${n}`, n === 10 ? CURRENT_PRODUCT_PRESET : "promax-team"), { recursive: true });
  const store = new WorkStore(workspace);
  const bind = async (id: string, revision?: number) => {
    const card = await store.create({ session_id: id, project_id: "local:test", title: id, shortname: id });
    if (revision !== undefined) {
      const file = join(workspace, ".工作", card.work_key, "工作卡.yml");
      const value = YAML.parse(await readFile(file, "utf8"));
      value.requirement_policy = { revision: `promax-product-team@r${revision}`, rules: [] };
      await writeFile(file, YAML.stringify(value));
    }
    return card;
  };
  return { home, workspace, bind };
}
const legacy = (id: string, cwd: string, parentSession?: string) => ({ id, cwd, agentPreset: "promax-team", ...(parentSession ? { parentSession } : {}) });

it("GC-SR01 binds old r8 and subagent to published bytes, not the mutable current r9 name", async () => {
  const f = await setup(); await f.bind("old", 8);
  const header = legacy("old", f.workspace);
  expect(await resolveLegacyProductPreset(f.home, header)).toBe("promax-team-r8-legacy");
  const child = legacy("child", f.workspace, "old");
  expect(await resolveLegacyProductPreset(f.home, child)).toBe("promax-team-r8-legacy");
  const mounted = await readFile(join(f.home, ".agent-presets", "promax-team-r8-legacy", "agent.cordis.yml"), "utf8");
  const { revision } = await productRevisionForSession(f.home, child);
  expect(mounted).toContain("promax-product-team@r8");
  expect(mounted).not.toContain("gate 必填且只能是");
  expect((revision as { metadata: { team_revision_id: string } }).metadata.team_revision_id).toBe("promax-product-team@r8");
});

it("GC-SR01 new sessions select r10, and an already r9-bound same-name session cold-resumes as r9", async () => {
  const f = await setup(); await f.bind("r9-before-upgrade", 9); await f.bind("old", 8);
  const before = legacy("r9-before-upgrade", f.workspace), old = legacy("old", f.workspace);
  expect(await resolveLegacyProductPreset(f.home, before)).toBe("promax-team-r9-legacy");
  const newSession = { id: "fresh", cwd: f.workspace, agentPreset: CURRENT_PRODUCT_PRESET };
  const current = await productRevisionForSession(f.home, newSession);
  expect(current.preset).toBe(CURRENT_PRODUCT_PRESET);
  expect((current.revision as { metadata: { team_revision_id: string }; spec: { preset_id: string } })).toMatchObject({ metadata: { team_revision_id: "promax-product-team@r10" }, spec: { preset_id: CURRENT_PRODUCT_PRESET } });
  const prompt = await readFile(join(f.home, ".agent-presets", CURRENT_PRODUCT_PRESET, "agent.cordis.yml"), "utf8");
  expect(prompt).toContain("promax-product-team@r10");
  expect(prompt).toContain("gate 必填且只能是");
  expect(await resolveLegacyProductPreset(f.home, old)).toBe("promax-team-r8-legacy");
  // Cold path reads the persisted pin, not a mutable default or creation-time guess.
  expect(await resolveLegacyProductPreset(f.home, before)).toBe("promax-team-r9-legacy");
  const followup = await productRevisionForSession(f.home, before);
  expect((followup.revision as { metadata: { team_revision_id: string } }).metadata.team_revision_id).toBe("promax-product-team@r9");
  expect((await productRevisionForSession(f.home, old)).preset).toBe("promax-team-r8-legacy");
  await f.bind("early-r5", 5);
  expect(await resolveLegacyProductPreset(f.home, legacy("early-r5", f.workspace))).toBe("promax-team-r5-legacy");
  expect((await productRevisionForSession(f.home, legacy("early-r5", f.workspace))).revision).toMatchObject({ metadata: { team_revision_id: "promax-product-team@r5" } });
});

it("GC-SR01 rejects changed mounted template while the revision description stays identical", async () => {
  const f = await setup(); await f.bind("old", 8);
  const h = legacy("old", f.workspace);
  await resolveLegacyProductPreset(f.home, h);
  const file = join(f.home, ".agent-presets", "promax-team-r8-legacy", "agent.cordis.yml");
  await writeFile(file, `${await readFile(file, "utf8")}\n# changed template\n`);
  await expect(resolveLegacyProductPreset(f.home, h)).rejects.toThrow(/字节|资源|模板/);
  await expect(productRevisionForSession(f.home, { ...h, agentPreset: "promax-team-r8-legacy" })).rejects.toThrow(/字节|资源|模板/);
});

it("GC-SR01 preserves the contract across two generations of alias descendants", async () => {
  const f = await setup(); await f.bind("old", 8);
  const owner = legacy("old", f.workspace);
  const alias = "promax-team-r8-legacy";
  await resolveLegacyProductPreset(f.home, owner);
  const child = { id: "child", cwd: f.workspace, parentSession: owner.id, agentPreset: alias };
  const grandchild = { id: "grandchild", cwd: f.workspace, parentSession: child.id, agentPreset: alias };
  await productRevisionForSession(f.home, child);
  expect((await productRevisionForSession(f.home, grandchild)).preset).toBe(alias);
});

it("GC-SR01 missing/contradictory/changed evidence never silently selects r8, r9 or r10", async () => {
  const f = await setup(); await f.bind("unknown");
  await expect(resolveLegacyProductPreset(f.home, legacy("unknown", f.workspace))).rejects.toThrow("没有可核对的原团队revision");
  const card = await f.bind("old", 8); const h = legacy("old", f.workspace);
  await resolveLegacyProductPreset(f.home, h);
  const path = join(f.workspace, ".工作", card.work_key, "工作卡.yml");
  const stored = YAML.parse(await readFile(path, "utf8"));
  stored.requirement_policy.revision = "promax-product-team@r9";
  await writeFile(path, YAML.stringify(stored));
  await expect(resolveLegacyProductPreset(f.home, h)).rejects.toThrow("固定revision与工作记录冲突");
  expect((await readFile(join(f.home, "promax", "preset-bindings", "old.json"), "utf8"))).toContain("promax-product-team@r8");
});
