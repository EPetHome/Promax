import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

/**
 * 13.1 不可变运行快照。它把“记录结构、团队修订、规则/基准、输入、实际加载组件、模型/工具配置”分开保存；
 * 未取得的信息保留 unknown 与原因，绝不用当前磁盘安装状态回填历史运行版本。
 */
export const RUNTIME_SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotComponent {
  name: string;
  version: string | null;
  /** 版本声明的证据类型：本次实际读取的字节/预置文件/宿主上报；不能只写“已安装”。 */
  evidence: string;
  /** 未知时保留原因，不回填。 */
  unknown_reason?: string;
}
export interface RuntimeSnapshot {
  schema_version: 1;
  snapshot_id: string;
  captured_at: string;
  capture_point: string;
  work_key: string;
  fields: {
    record_schema: { schema_version: number };
    team_revision: {
      team_revision_id: string | null;
      revision: number | null;
      definition_sha256: string | null;
      /** 本次实际读取的 preset 字节哈希；证明加载内容，不证明进程已使用。 */
      preset_sha256: string | null;
      source: string;
      unknown_reason?: string;
    };
    acceptance_baseline: { version: string; requirement_version: number };
    frozen_input: { task_key: string; manifest_sha256: string | null; frozen_at: string | null; source: string; unknown_reason?: string };
    loaded_components: SnapshotComponent[];
    model_tool_config: { runtime_version: string; model_route: string | null; config_source: string; config_version: string | null; unknown_reason?: string };
  };
  unknown: Array<{ field: string; reason: string }>;
  immutable: true;
}
export interface RuntimeSnapshotInput {
  work_key: string;
  task_key?: string;
  captured_at?: string;
  capture_point: string;
  baseline_version: string;
  requirement_version: number;
  runtime_version: string;
  preset?: { team_revision_id?: string | null; revision?: number | null; definition_sha256?: string | null; bytes?: Buffer | string; source?: string } | undefined;
  frozen_input?: { manifest_sha256?: string | null; frozen_at?: string | null; source: string } | undefined;
  components?: SnapshotComponent[] | undefined;
  model_route?: string | null | undefined;
  config_source?: string | undefined;
  config_version?: string | null | undefined;
  unknown?: Array<{ field: string; reason: string }> | undefined;
}
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

/** Pure builder; callers pass only facts they actually observed at this capture point. */
export function buildRuntimeSnapshot(input: RuntimeSnapshotInput): RuntimeSnapshot {
  const unknown: Array<{ field: string; reason: string }> = [...(input.unknown ?? [])];
  const team = input.preset;
  const revision = {
    team_revision_id: team?.team_revision_id ?? null,
    revision: team?.revision ?? null,
    definition_sha256: team?.definition_sha256 ?? null,
    preset_sha256: team?.bytes ? digest(team.bytes) : null,
    source: team?.source ?? "未知来源",
  };
  if (!team || (!team.team_revision_id && !team.bytes)) {
    unknown.push({ field: "team_revision", reason: "任务启动时未取得实际读取的团队修订内容" });
  } else if (!team.bytes) {
    unknown.push({ field: "team_revision.preset_sha256", reason: "只取得修订元数据，未取得本次读取的预设字节" });
  }
  const frozenInput = {
    task_key: input.task_key ?? "unknown",
    manifest_sha256: input.frozen_input?.manifest_sha256 ?? null,
    frozen_at: input.frozen_input?.frozen_at ?? null,
    source: input.frozen_input?.source ?? "未知来源",
  };
  if (!input.task_key) unknown.push({ field: "frozen_input.task_key", reason: "尚未开始执行，无冻结输入包" });
  else if (!frozenInput.manifest_sha256) unknown.push({ field: "frozen_input.manifest_sha256", reason: `${frozenInput.source} 未取得可读 manifest.yml` });
  if (!input.model_route) unknown.push({ field: "model_tool_config.model_route", reason: "本捕获点未上报实际模型路由；不从磁盘安装声明推断" });
  const fields = {
    record_schema: { schema_version: RUNTIME_SNAPSHOT_SCHEMA_VERSION },
    team_revision: revision,
    acceptance_baseline: { version: input.baseline_version, requirement_version: input.requirement_version },
    frozen_input: frozenInput,
    loaded_components: input.components ?? [{ name: "promax-bundle", version: input.runtime_version, evidence: "本次运行上报的 bundle 版本常量" }],
    model_tool_config: {
      runtime_version: input.runtime_version,
      model_route: input.model_route ?? null,
      config_source: input.config_source ?? "未知来源",
      config_version: input.config_version ?? null,
      ...(input.model_route ? {} : { unknown_reason: "本捕获点未上报实际模型路由" }),
    },
  };
  const body = {
    schema_version: 1 as const,
    captured_at: input.captured_at ?? new Date().toISOString(),
    capture_point: input.capture_point,
    work_key: input.work_key,
    fields,
    unknown,
    immutable: true as const,
  };
  return { ...body, snapshot_id: `snapshot:${digest(JSON.stringify(body)).slice(0, 24)}` };
}
/** Read-side check: a snapshot only proves what it recorded; it never promotes an unknown to a known value. */
export function verifyRuntimeSnapshot(snapshot: RuntimeSnapshot, expected: { work_key?: string; baseline_version?: string } = {}) {
  const errors: string[] = [];
  if (snapshot.schema_version !== RUNTIME_SNAPSHOT_SCHEMA_VERSION) errors.push("快照 schema_version 不兼容");
  if (expected.work_key && snapshot.work_key !== expected.work_key) errors.push("快照不属于当前工作");
  if (expected.baseline_version && snapshot.fields.acceptance_baseline.version !== expected.baseline_version) errors.push("快照基准版本与当前判定不一致");
  if (snapshot.immutable !== true) errors.push("快照缺少不可变标记");
  return { valid: errors.length === 0, errors };
}
/** 历史记录没有快照时明确记未知；不依据当前磁盘状态补写，也不把旧样本归入新版成绩。 */
export function resolveRuntimeSnapshot(round: { runtime_snapshot?: RuntimeSnapshot; snapshot_ids?: string[] } | undefined): { status: "present" | "reference_only" | "legacy_unknown"; snapshot?: RuntimeSnapshot; snapshot_id?: string; reason?: string } {
  if (round?.runtime_snapshot) return { status: "present", snapshot: round.runtime_snapshot };
  const latest = round?.snapshot_ids?.at(-1);
  if (latest) return { status: "reference_only", snapshot_id: latest, reason: "回合只保留快照引用；按身份从 .工作/<key>/运行快照/ 读取，不用当前磁盘内容回填" };
  return { status: "legacy_unknown", reason: "该回合早于运行快照协议；加载版本与规则身份未知，不参与版本分组成绩" };
}
/** R07：快照按身份不可变留存；同一身份重复写入必须字节一致，否则拒绝。 */
export function runtimeSnapshotDir(workspace: string, workKey: string) {
  return join(workspace, ".工作", workKey, "运行快照");
}
export function runtimeSnapshotFile(snapshotId: string) {
  return `${snapshotId.replace(/[^A-Za-z0-9._-]/gu, "_")}.yml`;
}
export async function persistRuntimeSnapshot(workspace: string, workKey: string, snapshot: RuntimeSnapshot) {
  const directory = runtimeSnapshotDir(workspace, workKey);
  await mkdir(directory, { recursive: true });
  const path = join(directory, runtimeSnapshotFile(snapshot.snapshot_id));
  const payload = YAML.stringify(snapshot);
  if (existsSync(path)) {
    if (await readFile(path, "utf8") !== payload) throw new Error(`运行快照 ${snapshot.snapshot_id} 已存在且字节不同；不覆盖历史快照`);
    return { path, created: false };
  }
  const staging = `${path}.staging-${process.pid}`;
  try {
    await writeFile(staging, payload, { flag: "wx", mode: 0o444 });
    try { await writeFile(path, payload, { flag: "wx", mode: 0o444 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  } finally {
    await rm(staging, { force: true });
  }
  if (await readFile(path, "utf8") !== payload) throw new Error(`运行快照 ${snapshot.snapshot_id} 写入后校验不一致`);
  return { path, created: true };
}
export async function loadRuntimeSnapshot(workspace: string, workKey: string, snapshotId: string): Promise<RuntimeSnapshot | undefined> {
  const path = join(runtimeSnapshotDir(workspace, workKey), runtimeSnapshotFile(snapshotId));
  if (!existsSync(path)) return undefined;
  const parsed = YAML.parse(await readFile(path, "utf8")) as RuntimeSnapshot;
  if (parsed?.snapshot_id !== snapshotId) throw new Error(`运行快照 ${snapshotId} 内容与身份不符`);
  return parsed;
}
