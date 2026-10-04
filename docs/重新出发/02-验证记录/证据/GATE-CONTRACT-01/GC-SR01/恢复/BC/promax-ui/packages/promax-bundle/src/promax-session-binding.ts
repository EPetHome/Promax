import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { WorkStore } from "./work-store.ts";

/** Published r4–r9 remain immutable. r10 is the first new, independently named entry. */
export const CURRENT_PRODUCT_PRESET = "promax-team-r10";
const LEGACY_PRODUCT_PRESET = "promax-team";
const LEGACY_REVISION = /^promax-product-team@r([4-9])$/u;
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

type Identity = { id: string; cwd?: string; parentSession?: string; agentPreset?: string };
type Binding = { session_id: string; cwd: string; recorded_preset: string; preset: string; team_revision_id: string; revision_sha256: string; resources_sha256?: string; source: string };
const bindingPath = (home: string, id: string) => join(home, "promax", "preset-bindings", `${id}.json`);
const alias = (revision: string) => `promax-team-r${LEGACY_REVISION.exec(revision)![1]}-legacy`;
const revisionPath = (home: string, preset: string) => join(home, ".agent-presets", preset, "team-revision.yml");
const LEGACY_ALIAS = /^promax-team-r([4-9])-legacy$/u;

/** The installed published revision is the authority, not the writable alias or its manifest.
 * Verify every manifested resource including the actual mounted agent.cordis.yml. */
async function publishedResources(home: string, preset: string): Promise<string> {
  const n = LEGACY_ALIAS.exec(preset)?.[1] ?? (preset === CURRENT_PRODUCT_PRESET ? "10" : undefined);
  if (!n) throw new Error(`团队preset ${preset} 没有可核对的发布资源`);
  const root = join(home, ".agent-presets", preset);
  const published = join(home, "profiles", "web", "node_modules", "@promax", "team-harness", "generated", `r${n}`, n === "10" ? CURRENT_PRODUCT_PRESET : "promax-team");
  const trusted = await readFile(join(published, "manifest.sha256"));
  const manifest = await readFile(join(root, "manifest.sha256"));
  if (!manifest.equals(trusted)) throw new Error(`团队preset ${preset} 的已发布资源清单已变化，拒绝载入`);
  const paths = trusted.toString("utf8").trim().split("\n");
  if (!paths.some(line => line.endsWith("  agent.cordis.yml")) || !paths.some(line => line.endsWith("  team-revision.yml")))
    throw new Error(`团队preset ${preset} 的发布清单缺少模板或合同`);
  for (const line of paths) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    const expected = match?.[1], path = match?.[2];
    if (!expected || !path || path.startsWith("/") || /[\\\u0000-\u001f]/u.test(path) || path.split("/").some(part => part === ".." || part === "." || !part))
      throw new Error(`团队preset ${preset} 的发布清单含非法资源路径`);
    const [actual, original] = await Promise.all([readFile(join(root, path)), readFile(join(published, path))]);
    if (sha256(actual) !== expected || !actual.equals(original))
      throw new Error(`团队preset ${preset} 的已发布资源 ${path} 字节已变化，拒绝载入`);
  }
  return sha256(manifest);
}

function validateRevision(bytes: Buffer, preset: string, legacy: boolean): string {
  const parsed = YAML.parse(bytes.toString("utf8"));
  const id = parsed?.metadata?.team_revision_id;
  const expected = legacy ? LEGACY_REVISION : /^promax-product-team@r10$/u;
  if (typeof id !== "string" || !expected.test(id) || parsed?.spec?.preset_id !== (legacy ? LEGACY_PRODUCT_PRESET : preset))
    throw new Error(`团队preset ${preset} 的身份与团队修订不一致，拒绝载入`);
  if (legacy && alias(id) !== preset) throw new Error(`团队preset ${preset} 不对应 ${id}`);
  return id;
}

async function evidence(workspace: string, sessionId: string): Promise<{ revision: string; source: string } | undefined> {
  const store = new WorkStore(workspace);
  const card = await store.forSession(sessionId);
  if (!card) return undefined;
  const policy = card.requirement_policy?.revision;
  const frozen = (await store.round(card.work_key))?.runtime_snapshot?.fields.team_revision.team_revision_id ?? undefined;
  if (policy && frozen && policy !== frozen) throw new Error(`会话 ${sessionId} 的工作卡版本与冻结运行快照冲突，拒绝猜测`);
  const revision = policy ?? frozen;
  return revision ? { revision, source: policy ? "work-card/requirement-policy" : "round/runtime-snapshot" } : undefined;
}

async function readBinding(home: string, id: string): Promise<Binding | undefined> {
  try { return JSON.parse(await readFile(bindingPath(home, id), "utf8")) as Binding; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Main/child legacy sessions use a verified WorkCard or their first immutable local binding.
 *  No creation time, current alias, or product default is ever an authority for an old session. */
export async function resolveLegacyProductPreset(home: string, header: Identity): Promise<string> {
  const recorded = header.agentPreset;
  if ((recorded !== LEGACY_PRODUCT_PRESET && !LEGACY_ALIAS.test(recorded ?? "")) || !header.cwd || !/^[A-Za-z0-9_-]{1,120}$/u.test(header.id))
    throw new Error("旧团队会话缺少可核对的身份或工作区");
  const prior = await readBinding(home, header.id);
  const parent = header.parentSession ? await readBinding(home, header.parentSession) : undefined;
  const sourceSession = header.parentSession ?? header.id;
  const found = await evidence(header.cwd, sourceSession);
  if (parent && (parent.session_id !== header.parentSession || parent.cwd !== header.cwd || (recorded !== LEGACY_PRODUCT_PRESET && parent.preset !== recorded) || !LEGACY_REVISION.test(parent.team_revision_id)))
    throw new Error(`会话 ${header.id} 的父会话绑定身份不一致`);
  if (!prior && !parent && (!found || !LEGACY_REVISION.test(found.revision)))
    throw new Error(`会话 ${header.id} 没有可核对的原团队revision；保持未绑定，不能以当前preset代替`);
  if (prior && (prior.session_id !== header.id || prior.cwd !== header.cwd || (prior.recorded_preset !== recorded && !(recorded === prior.preset && prior.recorded_preset === LEGACY_PRODUCT_PRESET)) || !LEGACY_REVISION.test(prior.team_revision_id) || prior.preset !== alias(prior.team_revision_id)))
    throw new Error(`会话 ${header.id} 的固定绑定身份无效`);
  if (prior && parent && parent.team_revision_id !== prior.team_revision_id)
    throw new Error(`会话 ${header.id} 的固定revision与父会话冲突`);
  const revision = prior?.team_revision_id ?? parent?.team_revision_id ?? found!.revision;
  if (found && found.revision !== revision) throw new Error(`会话 ${header.id} 的固定revision与工作记录冲突，不能静默换版`);
  if (!LEGACY_REVISION.test(revision)) throw new Error(`会话 ${header.id} 没有可核对的原团队revision`);
  const preset = alias(revision);
  if (recorded !== LEGACY_PRODUCT_PRESET && recorded !== preset) throw new Error(`会话 ${header.id} 的别名与原版本不一致`);
  const resources = await publishedResources(home, preset);
  const bytes = await readFile(revisionPath(home, preset));
  if (validateRevision(bytes, preset, true) !== revision || (prior && (prior.revision_sha256 !== sha256(bytes) || (prior.resources_sha256 && prior.resources_sha256 !== resources))))
    throw new Error(`会话 ${header.id} 的团队模板字节已变化，不能继续原绑定`);
  const record: Binding = { session_id: header.id, cwd: header.cwd, recorded_preset: recorded!, preset, team_revision_id: revision, revision_sha256: sha256(bytes), resources_sha256: resources, source: found?.source ?? parent?.source ?? prior!.source };
  if (!prior) {
    await mkdir(join(home, "promax", "preset-bindings"), { recursive: true });
    try { await writeFile(bindingPath(home, header.id), `${JSON.stringify(record)}\n`, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const current = await readBinding(home, header.id);
    if (!current || current.team_revision_id !== record.team_revision_id || current.revision_sha256 !== record.revision_sha256 || current.cwd !== record.cwd || current.recorded_preset !== record.recorded_preset || (current.resources_sha256 && current.resources_sha256 !== resources))
      throw new Error(`会话 ${header.id} 的并发绑定冲突`);
  }
  return preset;
}

/** Product binding adapter for the native resolver: the effective selection is
 * in the persisted event log, not necessarily in the creation header. */
export function resolveProductSessionPreset(home: string, session: { header: Identity; events?: readonly unknown[] }): Promise<string> {
  const selected = [...(session.events ?? [])].reverse().find((event) =>
    typeof event === "object" && event !== null && "type" in event && event.type === "agent-preset/selected"
  ) as { data?: { agentPreset?: unknown } } | undefined;
  const preset = selected?.data?.agentPreset;
  if (selected && typeof preset !== "string") throw new Error(`会话 ${session.header.id} 的团队选择事件无效`);
  return resolveLegacyProductPreset(home, {
    ...session.header,
    ...(typeof preset === "string" ? { agentPreset: preset } : {}),
  });
}

/** Used by submission, task authorization and frozen contracts, not the global latest preset. */
export async function productRevisionForSession(home: string, header: Identity): Promise<{ preset: string; revision: unknown; bytes: Buffer }> {
  if (!header.cwd) throw new Error("团队合同缺少工作区");
  const preset = header.agentPreset === LEGACY_PRODUCT_PRESET || LEGACY_ALIAS.test(header.agentPreset ?? "")
    ? await resolveLegacyProductPreset(home, header)
    : header.agentPreset;
  if (!preset || (preset !== CURRENT_PRODUCT_PRESET && !/^promax-team-r[4-9]-legacy$/u.test(preset)))
    throw new Error(`未绑定产品团队preset：${String(preset)}`);
  const resources = await publishedResources(home, preset);
  const bytes = await readFile(revisionPath(home, preset));
  validateRevision(bytes, preset, preset !== CURRENT_PRODUCT_PRESET);
  const revision = YAML.parse(bytes.toString("utf8"));
  // The native mount and the contract both read the same verified published resources.
  if (preset !== CURRENT_PRODUCT_PRESET) {
    const pin = await readBinding(home, header.id);
    if (!pin || pin.preset !== preset || pin.revision_sha256 !== sha256(bytes) || (pin.resources_sha256 && pin.resources_sha256 !== resources) || pin.cwd !== header.cwd)
      throw new Error(`会话 ${header.id} 的团队合同与已挂载模板绑定不一致`);
  }
  return { preset, revision, bytes };
}
