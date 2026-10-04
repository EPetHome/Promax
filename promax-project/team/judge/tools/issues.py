#!/usr/bin/env python3
"""Judge 结论提交：程序校验结论、维护问题台账、生成简短检查报告。Judge 不手写检查报告。

用法（在运行目录执行）：
  python3 issues.py submit <草稿.json>   校验通过才写入台账与 交付/检查.md；不通过打印错误，退出码 1，改完重交
  python3 issues.py show [<检查组>]       带组名打印该组；不带列全部组摘要；无组时兼容旧台账。
  新草稿须写 kind（rubrics 节名）；target 可以是字符串数组。检查组取首文件名主体，
  台账和报告均在 交付/检查/<组名>/；PASS 要求每个文件的本轮预检 SHA 一致。

草稿格式：
{
  "target": "交付/报告.md",
  "verdict": "PASS | REVISION_REQUIRED | INCOMPLETE",
  "summary": "一句话结论",
  "program_checks": [{"tool": "check_numbers", "result": "pass|fail|not-run", "note": ""}],
  "issues": [{"severity": "high|medium|low", "kind": "defect|evidence_gap|suggestion",
              "basis": "quoted|missing_required", "quote": "被审文件里的原句（quoted 必填）",
              "location": "章节标题", "rule": "检查项或规则ID", "evidence": "依据", "fix": "修改建议"}],
  "rechecks": [{"id": "J-001", "state": "fixed|withdrawn|open|unverifiable", "evidence": "本轮读到的依据"}],
  "decisions": [{"question": "", "options": ["", ""], "location": "", "evidence": ""}],
  "incomplete_reason": ""
}
规则：
- quoted 问题的原句必须逐字存在于被审文件，否则拒收（不允许凭空指控）。
- 问题编号由程序分配（J-001 起），跨轮次稳定；Judge 只在 rechecks 里引用已有编号。
- 复查必须覆盖台账里所有未关闭的问题；漏回不关闭。withdrawn = 原判断不成立，fixed = 原问题成立且已修好。
- 阻断问题 = 未关闭的 defect/evidence_gap 且 severity 为 high/medium。有阻断问题不能 PASS；REVISION_REQUIRED 至少要有一个未关闭的 defect/evidence_gap；INCOMPLETE 必须写原因。
- PASS 必须有本轮（len(rounds)+1）的 precheck-r<轮次>.json，target 与草稿相同，target_sha256 与当前被审文件字节一致。
- PASS 的预检 quote_coverage 若 ids_available 为真、quoted > 0 且 numbered == 0，拒收：有引文却程序核对覆盖为 0。
"""
import datetime
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True

CHECK_DIR = Path("交付/检查")
LEDGER = CHECK_DIR / "ledger.json"
REPORT = Path("交付/检查.md")
VERDICTS = {"PASS", "REVISION_REQUIRED", "INCOMPLETE"}
SEVERITIES = {"high", "medium", "low"}
KINDS = {"defect", "evidence_gap", "suggestion"}
BASES = {"quoted", "missing_required"}
STATES = {"fixed", "withdrawn", "open", "unverifiable"}
CLOSED = {"fixed", "withdrawn"}


def norm(s):
    return " ".join(str(s).split())


def load_ledger():
    if LEDGER.exists():
        return json.loads(LEDGER.read_text(encoding="utf-8"))
    return {"rounds": [], "issues": {}}


def is_blocking(issue):
    return issue["status"] not in CLOSED and issue["kind"] != "suggestion" and issue["severity"] in {"high", "medium"}


def validate(draft, ledger, target_text):
    errors = []
    if draft.get("verdict") not in VERDICTS:
        errors.append(f"verdict 只能是 {sorted(VERDICTS)}")
    flat = norm(target_text)
    for i, it in enumerate(draft.get("issues", []), 1):
        tag = f"issues[{i}]"
        for field, allowed in (("severity", SEVERITIES), ("kind", KINDS), ("basis", BASES)):
            if it.get(field) not in allowed:
                errors.append(f"{tag}.{field} 只能是 {sorted(allowed)}")
        for field in ("location", "rule", "evidence", "fix"):
            if not str(it.get(field, "")).strip():
                errors.append(f"{tag}.{field} 不能为空")
        if it.get("basis") == "quoted":
            q = norm(it.get("quote", ""))
            if len(q) < 4:
                errors.append(f"{tag}: quoted 问题必须给出被审文件里的原句")
            elif q not in flat:
                errors.append(f"{tag}: 原句在被审文件中不存在，不能据此指控：{q[:80]}")
        if it.get("basis") == "missing_required" and it.get("quote"):
            errors.append(f"{tag}: missing_required 是缺失类问题，不要伪造原句")
    open_ids = {k for k, v in ledger["issues"].items() if v["status"] not in CLOSED}
    seen = set()
    for r in draft.get("rechecks", []):
        rid = r.get("id")
        if rid not in ledger["issues"]:
            errors.append(f"rechecks: 台账里没有 {rid}")
            continue
        if r.get("state") not in STATES:
            errors.append(f"rechecks {rid}.state 只能是 {sorted(STATES)}")
        if not str(r.get("evidence", "")).strip():
            errors.append(f"rechecks {rid}: 必须写本轮读到的依据")
        seen.add(rid)
    missing = sorted(open_ids - seen)
    if missing:
        errors.append(f"rechecks 漏回未关闭的问题：{missing}（漏回不会关闭问题）")
    if draft.get("verdict") == "INCOMPLETE" and not str(draft.get("incomplete_reason", "")).strip():
        errors.append("INCOMPLETE 必须写 incomplete_reason")
    return errors


def apply(draft, ledger, sha, at):
    rnd = len(ledger["rounds"]) + 1
    for r in draft.get("rechecks", []):
        it = ledger["issues"][r["id"]]
        it["status"] = r["state"]
        it["history"].append({"round": rnd, "state": r["state"], "evidence": r["evidence"]})
    for it in draft.get("issues", []):
        iid = f"J-{len(ledger['issues']) + 1:03d}"
        ledger["issues"][iid] = {**{k: it.get(k, "") for k in ("severity", "kind", "basis", "quote", "location", "rule", "evidence", "fix")},
                                 "status": "open", "opened_round": rnd,
                                 "history": [{"round": rnd, "state": "open", "evidence": it.get("evidence", "")}]}
    ledger["rounds"].append({"round": rnd, "target": draft["target"], "sha256": sha, "verdict": draft["verdict"],
                             "summary": draft.get("summary", ""), "program_checks": draft.get("program_checks", []),
                             "decisions": draft.get("decisions", []), "incomplete_reason": draft.get("incomplete_reason", ""), "at": at})
    return rnd


def consistency(draft, ledger):
    blocking = [k for k, v in ledger["issues"].items() if is_blocking(v)]
    open_defects = [k for k, v in ledger["issues"].items() if v["status"] not in CLOSED and v["kind"] != "suggestion"]
    v = draft["verdict"]
    if v == "PASS" and blocking:
        return f"仍有阻断问题 {blocking}，不能 PASS"
    if v == "REVISION_REQUIRED" and not open_defects:
        return "没有未关闭的 defect/evidence_gap，不应判 REVISION_REQUIRED"
    return None


def render(ledger):
    last = ledger["rounds"][-1]
    label = {"PASS": "🟢 检查通过（限定范围）", "REVISION_REQUIRED": "🔴 需要修改", "INCOMPLETE": "🟡 无法完整判定"}[last["verdict"]]
    lines = [f"# 检查结论：{label}", "",
             f"- 被审：`{last['target']}`（sha256 `{last['sha256'][:12]}…`，第 {last['round']} 轮，{last['at']}）",
             f"- 结论：{last['summary']}"]
    if last["decisions"]:
        lines.append(f"- 🟡 有 {len(last['decisions'])} 项业务取舍需要你决定（不是缺陷）")
    if last["incomplete_reason"]:
        lines.append(f"- 无法判定原因：{last['incomplete_reason']}")
    if last["program_checks"]:
        lines += ["", "## 程序核对", "", "| 工具 | 结果 | 说明 |", "|---|---|---|"]
        lines += [f"| {c.get('tool')} | {c.get('result')} | {c.get('note', '')} |" for c in last["program_checks"]]
    icon = {"open": "🔴 未关闭", "fixed": "🟢 已修复", "withdrawn": "⚪ 撤回（原判断不成立）", "unverifiable": "🟡 无法验证"}
    if ledger["issues"]:
        lines += ["", "## 问题台账", "", "| 编号 | 状态 | 严重度 | 类型 | 位置 | 原句 / 缺失项 | 修改建议 |", "|---|---|---|---|---|---|---|"]
        for iid, it in ledger["issues"].items():
            what = it["quote"] or f"缺：{it['rule']}"
            lines.append(f"| {iid} | {icon[it['status']]} | {it['severity']} | {it['kind']} | {it['location']} | {what[:60]} | {it['fix'][:60]} |")
    if last["decisions"]:
        lines += ["", "## 待你决定", ""]
        lines += [f"- {d.get('question')}（选项：{' / '.join(d.get('options', []))}；位置：{d.get('location', '')}）" for d in last["decisions"]]
    return "\n".join(lines) + "\n"


def submit(path):
    from group_submit import draft_context, submit_path
    if draft_context(path):
        result = submit_path(path, sys.modules[__name__])
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(0 if result['accepted'] else 1)
    draft = json.loads(Path(path).read_text(encoding="utf-8"))
    if draft.get("kind") or isinstance(draft.get("target"), list):
        from group_submit import submit as submit_group
        result = submit_group(draft, sys.modules[__name__])
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(0 if result['accepted'] else 1)
    target = Path(draft.get("target", ""))
    if not target.is_file():
        print(json.dumps({"accepted": False, "errors": [f"被审文件不存在：{target}"]}, ensure_ascii=False))
        sys.exit(1)
    data = target.read_bytes()
    ledger = load_ledger()
    errors = validate(draft, ledger, data.decode("utf-8"))
    if draft.get("verdict") == "PASS":
        rnd = len(ledger["rounds"]) + 1
        try:
            precheck = json.loads((CHECK_DIR / f"precheck-r{rnd}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            precheck = None
        if (not isinstance(precheck, dict) or precheck.get("target") != draft["target"]
                or precheck.get("target_sha256") != hashlib.sha256(data).hexdigest()):
            errors.append("本轮没有对当前文件的预检，不能 PASS")
        else:
            coverage = precheck.get("quote_coverage", {})
            if (coverage.get("ids_available") and coverage.get("quoted", 0) > 0
                    and coverage.get("numbered") == 0):
                errors.append(f"有 {coverage['quoted']} 处引文，程序核对覆盖为 0，不能 PASS："
                              "请让写手按『原文』（编号）格式引用，或判 REVISION_REQUIRED")
    if not errors:
        trial = json.loads(json.dumps(ledger))
        at = datetime.datetime.now().isoformat(timespec="seconds")
        apply(draft, trial, hashlib.sha256(data).hexdigest(), at)
        problem = consistency(draft, trial)
        if problem:
            errors.append(problem)
    if errors:
        print(json.dumps({"accepted": False, "errors": errors}, ensure_ascii=False, indent=2))
        sys.exit(1)
    CHECK_DIR.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(trial, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    REPORT.write_text(render(trial), encoding="utf-8")
    last = trial["rounds"][-1]
    blocking = [k for k, v in trial["issues"].items() if is_blocking(v)]
    print(json.dumps({"accepted": True, "round": last["round"], "verdict": last["verdict"], "blocking": blocking,
                      "report": str(REPORT), "ledger": str(LEDGER)}, ensure_ascii=False))


def show():
    ledger = load_ledger()
    if not ledger["rounds"]:
        print("尚无检查记录")
        return
    print(render(ledger))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "submit" and len(sys.argv) == 3:
        submit(sys.argv[2])
    elif cmd == "show" and len(sys.argv) <= 3:
        from group_submit import show as show_groups
        show_groups(sys.argv[2] if len(sys.argv) == 3 else None, sys.modules[__name__])
    else:
        print(__doc__)
        sys.exit(2)
