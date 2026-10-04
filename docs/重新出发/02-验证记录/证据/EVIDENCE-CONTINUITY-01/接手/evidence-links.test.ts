import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import {
  acceptanceEvidence,
  acceptanceGateErrors,
  currentAcceptanceEvidence,
  anchorBindsConclusion,
  buildEvidenceLinksFile,
  conclusionIdentityConflicts,
  emptyEvidenceLinks,
  ensureEvidenceLinksIndex,
  linksPath,
  parseRange,
  readEvidenceLinks,
  readFrozenSources,
  recomputeNumericSpec,
  validateEvidenceLinks,
  verifyEvidenceLinks,
  type EvidenceLinkInput,
  type ReceiptWithLinks,
} from "../src/evidence-links.ts";
import type { AcceptanceBaseline } from "../../promax-ui-console/src/effective-protocol.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const baseline = (): AcceptanceBaseline => ({
  protocol: 1, version: "b1", requirement_version: 1, requirements_digest: "d1", sources: [],
  policy: { revision: "t@r1", rules: [], capabilities: { browser: "disabled", public_web: "authorized_members_only", judge_web: "disabled", availability: "not_probed" } },
  files: ["a.md"],
  items: [{ id: "D:FACTS", text: "事实依据", required: true, necessity: "required", source_refs: [], files: ["a.md"], evidence_basis: ["source_link", "numeric_recompute"] }],
});
const sourceText = "第一行：背景\n第二行：产品 A 当前价格 10 元/月。\n第三行：产品 B 当前价格 12 元/月。\n";
const artifactText = "# 比较\n\n产品 A 当前价格 10 元/月（用户材料）。\n\n产品 B 当前价格 12 元/月（用户材料）。\n\n## 注释\n\nSRC-009 出现在正文但未登记关联。\n";
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "promax-links-"));
  await mkdir(join(root, ".任务/t/输入/sources/SRC-001"), { recursive: true });
  await mkdir(join(root, ".任务/t/输入/sources/SRC-002"), { recursive: true });
  await mkdir(join(root, ".任务/t/产物快照"), { recursive: true });
  await writeFile(join(root, ".任务/t/产物快照/a.md"), artifactText);
  await writeFile(join(root, ".任务/t/输入/sources/SRC-001/a.md"), sourceText);
  await writeFile(join(root, ".任务/t/输入/sources/SRC-002/b.txt"), "搜索结果摘要：A 官网 https://a.example\n");
  await writeFile(join(root, ".任务/t/输入/manifest.yml"), YAML.stringify({
    api_version: "promax.ai/v1alpha2", kind: "EvidenceInputManifest",
    metadata: { task_key: "t", frozen: true, frozen_at: "2026-09-22T00:00:00.000Z" },
    spec: { source_root: ".任务/t/输入/sources", sources: [
      { source_id: "SRC-001", relative_path: ".任务/t/输入/sources/SRC-001/a.md", sha256: sha(sourceText), media_type: "text/markdown", origin_kind: "user-provided", use_qualification: "candidate", content_kind: "body" },
      { source_id: "SRC-002", relative_path: ".任务/t/输入/sources/SRC-002/b.txt", sha256: sha("搜索结果摘要：A 官网 https://a.example\n"), media_type: "text/plain", origin_kind: "web-snapshot", use_qualification: "lead_only", content_kind: "search_index" },
      { source_id: "SRC-009", relative_path: ".任务/t/输入/sources/SRC-009/c.txt", sha256: "0".repeat(64), media_type: "text/plain", origin_kind: "web-snapshot", use_qualification: "candidate", content_kind: "body" },
    ] },
  }));
  return root;
}
const validLink = (): EvidenceLinkInput => ({
  requirement_ids: ["D:FACTS"], conclusion: "产品 A 当前价格 10 元/月（用户材料）。", location: "产品 A 当前价格 10 元/月（用户材料）。",
  kind: "fact", evidence: [{ source_id: "SRC-001", range: "第 2 行", use: "当期价格" }],
  numeric_spec: { definition: "月费单价", unit: "元/月", formula: "月费/1", missing_rule: "缺失不计入" },
});
const receiptsOf = (links: Array<Record<string, unknown>>, over: Partial<ReceiptWithLinks> = {}): ReceiptWithLinks => ({ filename: "a.md", sha256: "hash-1", member: "product_discovery", at: "2026-09-22T00:00:00.000Z", evidence_links: links as never, ...over });

it("13.2-14 结论关联：只接受程序核对过的必需项、来源与定位；仅写 SRC 编号不被当成支持关系", async () => {
  const root = await workspace();
  try {
    const frozen = await readFrozenSources(root, "t");
    const sources = "sources" in frozen ? frozen.sources : new Map();
    const base = { baseline: baseline(), sources, artifactText, filename: "a.md" };

    expect(validateEvidenceLinks([{ ...validLink(), requirement_ids: ["D:UNKNOWN"] }], base).errors).toEqual([expect.stringContaining("未知验收项")]);
    expect(validateEvidenceLinks([{ ...validLink(), evidence: [{ source_id: "SRC-999", range: "第 1 行" }] }], base).errors).toEqual([expect.stringContaining("未知来源")]);
    expect(validateEvidenceLinks([{ ...validLink(), location: "当前价格" }], base).errors).toEqual([expect.stringContaining("不唯一")]);
    expect(validateEvidenceLinks([{ ...validLink(), location: "不存在的章节标题" }], base).errors).toEqual([expect.stringContaining("未命中")]);
    expect(validateEvidenceLinks([{ ...validLink(), conclusion: "记忆中的结论" }], base).errors).toEqual([expect.stringContaining("未在 a.md")]);
    expect(validateEvidenceLinks([{ ...validLink(), evidence: [{ source_id: "SRC-001", range: "第 1 行" }], numeric_spec: { numerator: "x" } }], base).errors).toEqual([expect.stringContaining("至少给公式或定义")]);
    expect(validateEvidenceLinks([validLink()], base).errors).toEqual([]);
    expect(validateEvidenceLinks(undefined, base).errors).toEqual([]);
    expect(validateEvidenceLinks([validLink()], { ...base, baseline: undefined }).errors).toEqual(expect.arrayContaining([expect.stringContaining("没有冻结验收基准")]));
    expect(validateEvidenceLinks([validLink()], { ...base, sources: undefined }).links).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("R04 来源回读：行/片段定位契约、越界、缺失、哈希不符、符号链接与非绑定锚点都被拒收", async () => {
  const root = await workspace();
  try {
    const frozen = await readFrozenSources(root, "t");
    const sources = "sources" in frozen ? frozen.sources : new Map();
    const verify = (links: EvidenceLinkInput[]) => verifyEvidenceLinks({ workspace: root, taskKey: "t", filename: "a.md", artifactSha256: "hash-1", links, sources, conclusions: [] });

    // 合法行定位：回读片段与来源版本被保存。
    const ok = await verify([validLink()]);
    expect(ok.errors).toEqual([]);
    expect(ok.verified[0]!.source_readback[0]).toMatchObject({ source_id: "SRC-001", lines: [2, 2], relative_path: ".任务/t/输入/sources/SRC-001/a.md" });
    expect(ok.verified[0]!.source_readback[0]!.snippet).toContain("产品 A 当前价格");
    expect(ok.verified[0]!.conditional.usable_as_evidence).toBe(true);
    // 精确片段定位。
    expect((await verify([{ ...validLink(), evidence: [{ source_id: "SRC-001", range: "产品 B 当前价格 12 元/月。" }] }])).errors).toEqual([]);
    // 3 行来源引用第 999 行越界。
    expect((await verify([{ ...validLink(), evidence: [{ source_id: "SRC-001", range: "第 999 行" }] }])).errors).toEqual([expect.stringContaining("越界")]);
    // 来源缺失（SRC-009 在清单里但文件不存在）。
    expect((await verify([{ ...validLink(), evidence: [{ source_id: "SRC-009", range: "第 1 行" }] }])).errors).toEqual([expect.stringContaining("文件不存在")]);
    // 哈希不符。
    const manifestPath = join(root, ".任务/t/输入/manifest.yml");
    const manifest = YAML.parse(await readFile(manifestPath, "utf8"));
    manifest.spec.sources[0].sha256 = "f".repeat(64);
    await writeFile(manifestPath, YAML.stringify(manifest));
    const stale = await readFrozenSources(root, "t");
    expect((await verifyEvidenceLinks({ workspace: root, taskKey: "t", filename: "a.md", artifactSha256: "hash-1", links: [validLink()], sources: "sources" in stale ? stale.sources : new Map(), conclusions: [] })).errors).toEqual([expect.stringContaining("哈希不符")]);
    manifest.spec.sources[0].sha256 = sha(sourceText);
    await writeFile(manifestPath, YAML.stringify(manifest));
    // 符号链接来源拒收。
    await rm(join(root, ".任务/t/输入/sources/SRC-001/a.md"));
    await symlink(join(root, ".任务/t/产物快照/a.md"), join(root, ".任务/t/输入/sources/SRC-001/a.md"));
    expect((await verify([validLink()])).errors).toEqual([expect.stringContaining("符号链接")]);
    await rm(join(root, ".任务/t/输入/sources/SRC-001/a.md"));
    await writeFile(join(root, ".任务/t/输入/sources/SRC-001/a.md"), sourceText);
    // 结论与锚点各在一处、互不指向：不能形成已核验关联。
    const detached = { ...validLink(), location: "## 注释", conclusion: "产品 B 当前价格 12 元/月（用户材料）。" };
    expect(validateEvidenceLinks([detached], { baseline: baseline(), sources, artifactText, filename: "a.md" }).errors).toEqual([expect.stringContaining("结论未出现在定位项所在的段落")]);
    expect(anchorBindsConclusion(artifactText, "## 注释", "产品 B 当前价格 12 元/月（用户材料）。").ok).toBe(false);
    expect(parseRange("第 3-5 行")).toEqual({ kind: "lines", start: 3, end: 5 });
    expect(parseRange("随便一句话")).toEqual({ kind: "snippet", text: "随便一句话" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("R04/R01 数值：程序复算与声明不符时拒收；复算成功提供 numeric_recompute 依据", async () => {
  const root = await workspace();
  try {
    const frozen = await readFrozenSources(root, "t");
    const sources = "sources" in frozen ? frozen.sources : new Map();
    const data = JSON.stringify([{ rating: 1 }, { rating: 5 }]);
    await writeFile(join(root, ".任务/t/输入/sources/SRC-001/a.md"), data);
    sources.get("SRC-001")!.sha256 = sha(data);
    const spec = { input: "SRC-001", field: "rating", numerator: "1", denominator: "2", result: "0.5", formula: "rating_1_2_ratio", unit: "ratio", rounding: "half_up:2", filter: "all_rows_no_dedup", missing_rule: "exclude_invalid_rating", window: "frozen_input" };
    const link = { ...validLink(), evidence: [{ source_id: "SRC-001", range: "第 1 行" }], numeric_spec: spec };
    const good = await verifyEvidenceLinks({ workspace: root, taskKey: "t", filename: "a.md", artifactSha256: "hash-1", links: [link], sources, conclusions: [] });
    expect(good.errors).toEqual([]);
    expect(good.verified[0]!.numeric_check).toMatchObject({ status: "recomputed", matched: true, computed: 0.5 });
    const bad = await verifyEvidenceLinks({ workspace: root, taskKey: "t", filename: "a.md", artifactSha256: "hash-1", links: [{ ...link, numeric_spec: { ...spec, result: "0.9" } }], sources, conclusions: [] });
    expect(bad.errors).toEqual([expect.stringContaining("numeric_spec.result 收到 \"0.9\"，期望 0.5")]);
    const numerator = await verifyEvidenceLinks({ workspace: root, taskKey: "t", filename: "a.md", artifactSha256: "hash-1", links: [{ ...link, numeric_spec: { ...spec, numerator: "2" } }], sources, conclusions: [] });
    expect(numerator.errors).toEqual([expect.stringContaining("numeric_spec.numerator 收到 \"2\"，期望 1")]);
    const multiple = await verifyEvidenceLinks({ workspace: root, taskKey: "t", filename: "a.md", artifactSha256: "hash-1", links: [{ ...link, numeric_spec: { ...spec, result: "0.9", numerator: "1.0", denominator: "3" } }], sources, conclusions: [] });
    expect(multiple.errors).toHaveLength(3);
    expect(multiple.errors.join("；")).toContain("numeric_spec.result 收到 \"0.9\"，期望 0.5");
    expect(multiple.errors.join("；")).toContain("numeric_spec.numerator 收到 \"1.0\"，期望 1");
    expect(multiple.errors.join("；")).toContain("numeric_spec.denominator 收到 \"3\"，期望 2");
    const omitted = await verifyEvidenceLinks({ workspace: root, taskKey: "t", filename: "a.md", artifactSha256: "hash-1", links: [{ ...link, numeric_spec: { ...spec, numerator: undefined, denominator: undefined } as unknown as Record<string, string> }], sources, conclusions: [] });
    expect(omitted.errors).toEqual([]);
    expect(omitted.verified[0]!.numeric_check).toMatchObject({ status: "recomputed", matched: true });
    const wrongFormat = await verifyEvidenceLinks({ workspace: root, taskKey: "t", filename: "a.md", artifactSha256: "hash-1", links: [{ ...link, numeric_spec: { ...spec, unit: "percent", result: "50" } }], sources, conclusions: [] });
    expect(wrongFormat.errors).toEqual([]); // 现有 unsupported 接受语义保持，不能悄悄改为拒收
    expect(wrongFormat.verified[0]!.numeric_check).toMatchObject({ status: "unsupported", reason: expect.stringContaining("percent 必须带%") });
    expect(recomputeNumericSpec({ definition: "只有定义" })).toMatchObject({ status: "unsupported" });
    expect(recomputeNumericSpec({ numerator: "3", denominator: "6", definition: "无结果" })).toMatchObject({ status: "unsupported" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("R10 结论身份：首次由程序分配、改措辞/移动位置保持身份、未知与跨成果身份拒收", async () => {
  const root = await workspace();
  try {
    const frozen = await readFrozenSources(root, "t");
    const sources = "sources" in frozen ? frozen.sources : new Map();
    const verify = (links: EvidenceLinkInput[], conclusions: Parameters<typeof verifyEvidenceLinks>[0]["conclusions"] = []) => verifyEvidenceLinks({ workspace: root, taskKey: "t", filename: "a.md", artifactSha256: "hash-1", links, sources, conclusions });
    const first = await verify([validLink()]);
    expect(first.verified[0]!.conclusion_id).toBe(""); // stage未接受，最终身份见真实commit集成测试
    // 修订：显式引用身份，措辞与位置变化不换身份。
    const revised = await verify([{ ...validLink(), conclusion_id: "CNL-001", conclusion: "产品 A 现价 10 元/月。", location: "## 比较结论" }], []);
    // 未知身份必须拒收而不是模糊沿用。
    expect(revised.errors).toEqual([expect.stringContaining("未知结论身份")]);
    const registry = [{ conclusion_id: "CNL-001", artifact: "a.md", first_conclusion: "x", first_location: "y", created_at: "t", current: { conclusion: validLink().conclusion, location: validLink().location, artifact_sha256: "hash-1", link_id: "LNK-001", at: "t" }, revisions: [], lineage: [] }];
    const kept = await verify([{ ...validLink(), conclusion_id: "CNL-001", conclusion: "产品 A 现价 10 元/月。", location: "## 比较结论" }], registry);
    expect(kept.errors).toEqual([]);
    expect(kept.verified[0]!.conclusion_id).toBe("CNL-001");
    // 跨成果引用被拒。
    expect((await verify([{ ...validLink(), conclusion_id: "CNL-001" }], [{ ...registry[0]!, artifact: "b.md" }])).errors).toEqual([expect.stringContaining("不能跨成果引用")]);
    // 同一身份在本次提交中重复。
    expect((await verify([{ ...validLink(), conclusion_id: "CNL-001" }, { ...validLink(), conclusion: "产品 B 当前价格 12 元/月（用户材料）。", location: "产品 B 当前价格 12 元/月（用户材料）。", conclusion_id: "CNL-001" }], registry)).errors).toEqual([expect.stringContaining("重复引用")]);
    // 两个成果占用同一身份。
    expect(conclusionIdentityConflicts([receiptsOf([{ conclusion_id: "CNL-001", conclusion: "A", artifact_sha256: "hash-1" }]), receiptsOf([{ conclusion_id: "CNL-001", conclusion: "B", artifact_sha256: "hash-2" }], { filename: "b.md", sha256: "hash-2" })])).toEqual([expect.stringContaining("冲突未保存")]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("R02/R03 派生索引：只从权威回执构建、编号稳定、过期索引按回执重建、SRC 扫描不产生支持关系", async () => {
  const root = await workspace();
  try {
    const first: ReceiptWithLinks = receiptsOf([{ ...validLink(), link_id: "LNK-001", conclusion_id: "CNL-001", artifact_sha256: "hash-1", source_qualification: [{ source_id: "SRC-001", use_qualification: "candidate", content_kind: "body" }], source_readback: [], conditional: { usable_as_evidence: true, reason: "候选证据" }, matched_at: "t1" }]);
    const built = buildEvidenceLinksFile({ taskKey: "t", receipts: [first] });
    expect(built.artifacts[0]!.links[0]!.link_id).toBe("LNK-001");
    expect(built.artifacts[0]!.citation_index.map((entry) => entry.source_id)).toEqual(["SRC-001"]);
    expect(built.artifacts[0]!.citation_index.map((entry) => entry.source_id)).not.toContain("SRC-009");
    expect(built.conclusions.map((entry) => entry.conclusion_id)).toEqual(["CNL-001"]);
    // 同正文修订关联：新回执（同 hash）保留历史并重建索引，不重复编号。
    const second: ReceiptWithLinks = { ...first, evidence_links: [{ ...first.evidence_links![0]!, link_id: "LNK-001", matched_at: "t2" }] };
    const rebuilt = buildEvidenceLinksFile({ taskKey: "t", receipts: [second] });
    expect(rebuilt.artifacts[0]!.links[0]!.link_id).toBe("LNK-001");
    expect(rebuilt.receipts_digest).not.toBe(built.receipts_digest);
    // 写入派生索引 → 读回一致；把文件改成过期状态后 ensure 从回执重建。
    await ensureEvidenceLinksIndex(root, "t", [first]);
    expect((await readEvidenceLinks(root, "t")).receipts_digest).toBe(buildEvidenceLinksFile({ taskKey: "t", receipts: [first] }).receipts_digest);
    await chmod(linksPath(root, "t"), 0o644);
    await writeFile(linksPath(root, "t"), YAML.stringify({ ...emptyEvidenceLinks("t"), receipts_digest: "stale" }));
    const ensured = await ensureEvidenceLinksIndex(root, "t", [first]);
    expect(ensured.rebuilt).toBe(true);
    expect(ensured.file.artifacts[0]!.links[0]!.link_id).toBe("LNK-001");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("R01 依据索引与门禁：候选来源才算 source_link，线索来源与旧版本不计入，met 缺依据退回", async () => {
  const link = (over: Record<string, unknown>) => ({ ...validLink(), link_id: "LNK-001", conclusion_id: "CNL-001", artifact_sha256: "hash-1", source_qualification: [], source_readback: [{ source_id: "SRC-001", task_key: "t", qualification_sha256: "fixture-metadata", sha256: "fixture-source", relative_path: "source.txt", range: "第1行", snippet: "fixture", verified_at: "t" }], conditional: { usable_as_evidence: true, reason: "候选证据" }, matched_at: "t", ...over });
  const receipts: Record<string, ReceiptWithLinks> = {
    "a.md": receiptsOf([link({ numeric_check: { status: "recomputed", matched: true, computed: 0.5, input: { sha256: "fixture-input" }, spec_sha256: "fixture-spec" } }), link({ link_id: "LNK-002", conclusion_id: "CNL-002", conditional: { usable_as_evidence: false, reason: "线索" } })]),
  };
  const index = acceptanceEvidence(baseline(), receipts);
  expect(index["D:FACTS"]!.available).toEqual(expect.arrayContaining(["source_link", "numeric_recompute"]));
  expect(index["D:FACTS"]!.lead_only_links).toEqual(["LNK-002"]);
  // 历史快照缺少源版本绑定：不得按旧PASS回填新资格。
  const legacy = await currentAcceptanceEvidence("unused", { "D:FACTS": { available: ["source_link", "numeric_recompute"], links: [], lead_only_links: [] } });
  expect(legacy["D:FACTS"]!.available).toEqual([]);
  const oldReceipt = acceptanceEvidence(baseline(), { "a.md": receiptsOf([link({ source_readback: [] })]) });
  expect(oldReceipt["D:FACTS"]!.available).toEqual([]);
  // 被审版本与当前回执哈希不一致时，旧关联不计入依据。
  const stale = acceptanceEvidence(baseline(), { "a.md": receiptsOf([link({ artifact_sha256: "hash-old" })]) });
  expect(stale["D:FACTS"]!.available).toEqual([]);
  const gate = (items: Array<{ id: string; state: string }>, evidence = index) => acceptanceGateErrors(baseline(), ["D:FACTS"], { items }, evidence, () => true, { requirement_record: true });
  expect(gate([{ id: "D:FACTS", state: "met" }])).toEqual([]);
  expect(gate([{ id: "D:FACTS", state: "unverifiable" }])).toEqual([]);
  expect(gate([{ id: "D:FACTS", state: "met" }], { "D:FACTS": { available: [], links: [], lead_only_links: ["LNK-001"] } })).toEqual([expect.stringContaining("缺少必需依据")]);
  // 结构项不因没有 SRC 被误阻断；程序凭证项只看文件/版本凭证。
  const structural = baseline();
  structural.items[0]!.evidence_basis = [];
  expect(acceptanceGateErrors(structural, ["D:FACTS"], { items: [{ id: "D:FACTS", state: "met" }] }, { "D:FACTS": { available: [], links: [], lead_only_links: [] } }, () => false, { requirement_record: false })).toEqual([]);
  structural.items[0]!.evidence_basis = ["program_check"];
  expect(acceptanceGateErrors(structural, ["D:FACTS"], { items: [{ id: "D:FACTS", state: "met" }] }, {}, () => false, {})).toEqual([expect.stringContaining("当前版本文件/版本凭证")]);
  structural.items[0]!.evidence_basis = ["requirement_record"];
  expect(acceptanceGateErrors(structural, ["D:FACTS"], { items: [{ id: "D:FACTS", state: "met" }] }, {}, () => true, { requirement_record: false })).toEqual([expect.stringContaining("原始要求")]);
});
