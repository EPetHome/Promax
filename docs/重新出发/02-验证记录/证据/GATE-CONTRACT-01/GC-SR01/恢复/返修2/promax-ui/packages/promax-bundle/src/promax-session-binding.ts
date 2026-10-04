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
type Binding = { session_id: string; cwd: string; recorded_preset: string; preset: string; team_revision_id: string; revision_sha256: string; source: string };
const bindingPath = (home: string, id: string) => join(home, "promax", "preset-bindings", `${id}.json`);
const alias = (revision: string) => `promax-team-r${LEGACY_REVISION.exec(revision)![1]}-legacy`;
const revisionPath = (home: string, preset: string) => join(home, ".agent-presets", preset, "team-revision.yml");

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
  if (header.agentPreset !== LEGACY_PRODUCT_PRESET || !header.cwd || !/^[A-Za-z0-9_-]{1,120}$/u.test(header.id))
    throw new Error("旧团队会话缺少可核对的身份或工作区");
  const prior = await readBinding(home, header.id);
  const sourceSession = header.parentSession ?? header.id;
  const found = await evidence(header.cwd, sourceSession);
  if (!prior && (!found || !LEGACY_REVISION.test(found.revision)))
    throw new Error(`会话 ${header.id} 没有可核对的原团队revision；保持未绑定，不能以当前preset代替`);
  if (prior && (prior.session_id !== header.id || prior.cwd !== header.cwd || prior.recorded_preset !== LEGACY_PRODUCT_PRESET || !LEGACY_REVISION.test(prior.team_revision_id) || prior.preset !== alias(prior.team_revision_id)))
    throw new Error(`会话 ${header.id} 的固定绑定身份无效`);
  if (prior && found && found.revision !== prior.team_revision_id)
    throw new Error(`会话 ${header.id} 的固定revision与工作记录冲突，不能静默换版`);
  const revision = prior?.team_revision_id ?? found!.revision;
  const preset = alias(revision);
  const bytes = await readFile(revisionPath(home, preset));
  if (validateRevision(bytes, preset, true) !== revision || (prior && prior.revision_sha256 !== sha256(bytes)))
    throw new Error(`会话 ${header.id} 的团队模板字节已变化，不能继续原绑定`);
  const record: Binding = { session_id: header.id, cwd: header.cwd, recorded_preset: LEGACY_PRODUCT_PRESET, preset, team_revision_id: revision, revision_sha256: sha256(bytes), source: found?.source ?? prior!.source };
  if (!prior) {
    await mkdir(join(home, "promax", "preset-bindings"), { recursive: true });
    try { await writeFile(bindingPath(home, header.id), `${JSON.stringify(record)}\n`, { flag: "wx" }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const current = await readBinding(home, header.id);
    if (!current || current.team_revision_id !== record.team_revision_id || current.revision_sha256 !== record.revision_sha256 || current.cwd !== record.cwd)
      throw new Error(`会话 ${header.id} 的并发绑定冲突`);
  }
  return preset;
}

/** Used by submission, task authorization and frozen contracts, not the global latest preset. */
export async function productRevisionForSession(home: string, header: Identity): Promise<{ preset: string; revision: unknown; bytes: Buffer }> {
  if (!header.cwd) throw new Error("团队合同缺少工作区");
  const preset = header.agentPreset === LEGACY_PRODUCT_PRESET
    ? await resolveLegacyProductPreset(home, header)
    : header.agentPreset;
  if (!preset || (preset !== CURRENT_PRODUCT_PRESET && !/^promax-team-r[4-9]-legacy$/u.test(preset)))
    throw new Error(`未绑定产品团队preset：${String(preset)}`);
  const bytes = await readFile(revisionPath(home, preset));
  validateRevision(bytes, preset, preset !== CURRENT_PRODUCT_PRESET);
  const revision = YAML.parse(bytes.toString("utf8"));
  // The native mount and this contract must resolve the same immutable revision.
  if (preset !== CURRENT_PRODUCT_PRESET) {
    const pin = await readBinding(home, header.id);
    const inherited = !pin && header.parentSession ? await readBinding(home, header.parentSession) : undefined;
    if ((!pin && !inherited) || (pin ?? inherited)!.preset !== preset || (pin ?? inherited)!.revision_sha256 !== sha256(bytes) || (pin ?? inherited)!.cwd !== header.cwd)
      throw new Error(`会话 ${header.id} 的团队合同与已挂载模板绑定不一致`);
  }
  return { preset, revision, bytes };
}
