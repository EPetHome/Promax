import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { ContentObjectStore } from "@promax/promax-report";
import type { WorkCard } from "../../promax-ui-console/src/work-protocol.ts";
import { taskCompletion } from "../../promax-ui-console/src/effective-protocol.ts";
import type { DeliveryReceipt } from "../../promax-ui-console/src/delivery-protocol.ts";
import type { WorkRound } from "./work-store.ts";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
/** Coordinates callers only. The work record, CAS and original version store own durable facts. */
const settlements = new Map<string, Promise<unknown>>();
export function deliveryKey(workspace: string, key: string, task: string) { return JSON.stringify([workspace, key, task]); }
export function settlementInFlight(key: string) { return settlements.has(key); }
export function singleSettlement<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prior = settlements.get(key);
  if (prior) return prior as Promise<T>;
  const pending = Promise.resolve().then(run);
  settlements.set(key, pending);
  void pending.finally(() => { if (settlements.get(key) === pending) settlements.delete(key); }).catch(() => {});
  return pending;
}
/** A cancelled waiter leaves the shared settlement intact; it does not cancel someone else's accepted commit. */
export async function waitForSettlement(key: string, signal?: AbortSignal): Promise<void> {
  const pending = settlements.get(key);
  if (!pending) return;
  signal?.throwIfAborted();
  let abort!: () => void, timer: ReturnType<typeof setTimeout> | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal?.reason ?? new Error("等待已取消"));
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => reject(new Error("保存结果待核：等待结算超时；未重复提交")), 30_000);
  });
  try { await Promise.race([pending, cancelled]); } finally { signal?.removeEventListener("abort", abort); clearTimeout(timer); }
}

/** Read before retry: a lost response never causes another commit, or rolls a later current version backwards. */
export function deliveryFacts(workspace: string, card: WorkCard, round: WorkRound, saving = false) {
  const attempt = round.delivery;
  if (!attempt) return undefined; // Historical sessions are not retroactively rewritten.
  const targets: DeliveryReceipt["targets"] = [];
  const current: Record<string, string> = {};
  let saved = true, error = attempt.error ?? "";
  try {
    const store = new ContentObjectStore(workspace);
    const entries = store.index().artifacts.filter(a => a.work_key === card.work_key);
    for (const entry of entries) current[entry.filename] = entry.current_sha256;
    // Historical check-only attempts predate DeliveryAttempt.check_only. Their immutable
    // task association (not a display receipt) is the compatibility authority.
    let legacyCheck = false;
    if (!attempt.check_only && !round.check_only && attempt.task_key !== "." && attempt.task_key !== ".." &&
      !/[/\\\0]/u.test(attempt.task_key)) {
      try {
        const association = YAML.parse(readFileSync(join(workspace, ".任务", attempt.task_key, "工作关联.yml"), "utf8"));
        legacyCheck = association?.work_key === card.work_key && association.check_only === true;
      } catch { /* No task evidence: leave the delivery unverified. */ }
    }
    for (const [filename, sha] of Object.entries(attempt.reviewed_hashes)) {
      const entry = entries.find(a => a.filename === filename);
      // Ordinary commits must retain their exact task/trace even when bytes are identical.
      const version = entry?.versions.find(v => v.sha256 === sha && v.task_key === attempt.task_key && v.trace_id === attempt.trace_id) ??
        ((attempt.check_only || (round.check_only && round.task_key === attempt.task_key) || legacyCheck)
          ? entry?.versions.find(v => v.sha256 === sha) : undefined);
      if (version) {
        store.readVersion(card.work_key, filename, sha); // Verifies immutable bytes, not just the index.
        if (entry!.current_sha256 === sha) {
          try {
            if (hash(readFileSync(join(workspace, "产物", card.work_key, filename))) !== sha) throw new Error("入口字节与版本不一致");
          } catch (e) {
            // Immutable version saved, but the current entry failed to refresh. Do not roll back storage truth.
            delete current[filename];
            error = `正式版本已保存，当前入口待修复：${filename}（${e instanceof Error ? e.message : String(e)}）`;
          }
        }
        targets.push({ kind: "formal", filename, sha256: sha, ...(version.task_key ? { task_key: version.task_key } : {}), path: `产物/${card.work_key}/${filename}` });
      } else saved = false;
      const previous = entry?.versions.findLast(v => v.sha256 !== sha);
      if (previous) {
        store.readVersion(card.work_key, filename, previous.sha256);
        targets.push({ kind: "previous", filename, sha256: previous.sha256, path: `产物/${card.work_key}/${filename}` });
      }
      if (!version) {
        const path = `.任务/${attempt.task_key}/产物快照/${filename}`;
        if (existsSync(join(workspace, path)) && hash(readFileSync(join(workspace, path))) === sha) {
          const snapshot = `.工作/${card.work_key}/草稿快照/${sha}`;
          targets.push({ kind: "draft", filename, sha256: sha, task_key: attempt.task_key, path: existsSync(join(workspace, snapshot)) && hash(readFileSync(join(workspace, snapshot))) === sha ? snapshot : path });
        }
      }
    }
    if (!Object.keys(attempt.reviewed_hashes).length) saved = false;
  } catch (e) {
    saved = false;
    error = e instanceof Error ? e.message : String(e);
  }
  const state: "saved" | "saving" | "failed" | "unknown" = saved ? "saved" : saving ? "saving" : existsSync(join(workspace, "产物/.commit-lock")) || !attempt.failure || error !== (attempt.error ?? "") ? "unknown" : attempt.failure;
  return { state, error, current, targets };
}
export function deliveryReceipt(workspace: string, card: WorkCard, round: WorkRound, saving = false): DeliveryReceipt | undefined {
  const facts = deliveryFacts(workspace, card, round, saving), attempt = round.delivery;
  if (!facts || !attempt) return;
  const completion = taskCompletion(card, round.last_check?.acceptance_baseline, round.last_check ? { ...round.last_check, delivery_saved: facts.state === "saved" } : undefined, facts.current);
  const state: DeliveryReceipt["state"] = facts.state === "saved" ? completion.state === "complete" ? "complete" : "saved_partial" : facts.state;
  const sameVersion = (r: DeliveryReceipt) => r.task_key === attempt.task_key && JSON.stringify(r.reviewed_hashes) === JSON.stringify(attempt.reviewed_hashes);
  const id = `delivery:${hash(JSON.stringify([card.work_key, attempt.task_key, attempt.reviewed_hashes, state, facts.current, facts.targets, completion.gaps]))}`;
  const prior = card.delivery_receipts?.find(r => r.id === id);
  if (prior) return prior;
  const correction = ["failed", "unknown"].includes(state) && !!card.delivery_receipts?.some(r => sameVersion(r) && r.state === "complete") && !card.delivery_receipts?.some(r => sameVersion(r) && r.correction);
  const text = {
    saving: "正在保存正式版本；可以查看草稿，尚未正式交付。",
    complete: "正式交付已完成。当前版本已保存，必要检查已满足；业务变化详见成果。",
    saved_partial: `部分完成：成果已保存，${round.halted ? "未检查 · 自动恢复耗尽，待修复；" : ""}仍有未满足或未核实事项：${completion.gaps.join("；") || completion.label}。${facts.error ? `${facts.error}。` : ""}不代表业务全部通过。`,
    failed: `部分完成：正式保存失败。草稿与旧正式版保留。${facts.error}`,
    unknown: `保存结果待核：不宣称正式完成，不自动重复提交。${facts.error}`,
  }[state];
  return { id, at: new Date().toISOString(), task_key: attempt.task_key, reviewed_hashes: attempt.reviewed_hashes, state, correction, text: `${correction ? "更正：此前完成说明不准确。" : ""}${text}`, targets: facts.targets };
}
