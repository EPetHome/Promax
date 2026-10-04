#!/usr/bin/env python3
"""Judge 一键预检：一条命令跑完数字核对 + 引文核对，产出程序结果、预检报告和草稿骨架。

用法（在运行目录执行）：
  python3 precheck.py <被审文件...> --kind <成果类型> [--facts <facts>] [--previous <上一版文件...>] --sources <材料...>
  带 --kind：交付/检查/<首文件名主体>/；多文件同组，K1—K10 和逐文件 SHA。
  显式带 --legacy：以下 10a 单文件兼容行为不变；否则必须带 --kind。

做什么：
1. 调用同目录的 check_numbers.py（有 --facts 时）和新口径 check_quotes.py，不调用模型；
2. 读 交付/检查/ledger.json（有的话）算出本轮轮次 r，并检查台账每个未关闭问题的原句
   在当前被审文件里是否还在（只作提示，不自动判 fixed）；
3. 写 交付/检查/precheck-r<r>.json：两个程序的完整结果 + 上述台账提示，
   以及被审文件字节的 target_sha256、引文 quote_coverage（quoted / numbered / ids_available）；
   摘要显示覆盖，材料有编号且有引文但带编号覆盖为 0 时提示不能 PASS；
4. 写 交付/检查/draft-r<r>.json：按 issues.py 文件头的草稿格式预填，
   target / program_checks / 带编号引文问题 / rechecks 预留项；verdict、summary 留空给 Judge 填；
   check_numbers 的 mismatches 不自动写成问题，列进 precheck 结果交 Judge 确认。

预检不写台账、不生成 交付/检查.md，不替 Judge 下结论。Judge 填完草稿后用：
  python3 <tools>/issues.py submit 交付/检查/draft-r<r>.json
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

# Judge tools are shared read-only code; never write interpreter caches here.
sys.dont_write_bytecode = True

TOOLS = Path(__file__).resolve().parent
CHECK_DIR = Path("交付/检查")
LEDGER = CHECK_DIR / "ledger.json"


def norm(s):
    return " ".join(str(s).split())


def run_tool(script, args):
    """跑同目录的核对脚本，返回 (结果 dict 或 None, 退出码)。"""
    proc = subprocess.run(['env', '-u', 'DSH_PROFILE', sys.executable, str(TOOLS / script), *args],
                          capture_output=True, text=True)
    try:
        return json.loads(proc.stdout), proc.returncode
    except ValueError:
        return None, proc.returncode


def heading_of(lines, no):
    for i in range(no - 1, -1, -1):
        s = lines[i].strip()
        if s.startswith("#"):
            return s.lstrip("#").strip() or "（无标题）"
    return "（文首）"


def quote_issue(item, kind, heading, lines):
    if kind == "missing":
        rule = "引文逐字核对（带编号）"
        evidence = f"check_quotes 判定该引文在材料中找不到（第 {item['line']} 行，编号 {item['id']}）"
        fix = "回到原始材料逐字核对：改写为原文，或删掉引号与编号"
    else:
        rule = "引文与编号对应（带编号）"
        evidence = f"check_quotes 判定编号 {item['id']} 对应的记录不含该引文（第 {item['line']} 行）"
        fix = "把编号改为确实包含该引文的记录，或把引文换成所标记录的原文"
    return {
        "severity": "high",
        "kind": "defect",
        "basis": "quoted",
        "quote": item["quote"],
        "location": heading,
        "rule": rule,
        "evidence": evidence,
        "fix": fix,
    }


def main():
    if "--legacy" in sys.argv:
        sys.argv.remove("--legacy")
        if "--kind" in sys.argv:
            print("--legacy 不能与 --kind 同时使用", file=sys.stderr)
            sys.exit(2)
    elif "--kind" in sys.argv:
        from group_checks import precheck_main
        precheck_main(run_tool, quote_issue)
        return
    else:
        from source_checks import KINDS
        print("缺少 --kind：请按 team/AGENTS.md 第 3 节第 5 步写成果类型；可选："
              + ", ".join(KINDS), file=sys.stderr)
        sys.exit(2)
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("target")
    ap.add_argument("--facts", default=None)
    ap.add_argument("--sources", nargs="+", required=True)
    a = ap.parse_args()

    target = Path(a.target)
    data = target.read_bytes()
    text = data.decode("utf-8")
    lines = text.splitlines()

    # 1) 两个程序
    numbers, n_ec = (run_tool("check_numbers.py", [str(target), a.facts]) if a.facts else (None, None))
    quotes, q_ec = run_tool("check_quotes.py", [str(target), *a.sources])

    # 2) 台账
    ledger = json.loads(LEDGER.read_text(encoding="utf-8")) if LEDGER.exists() else {"rounds": [], "issues": {}}
    rnd = len(ledger["rounds"]) + 1
    closed = {"fixed", "withdrawn"}
    open_ids = [k for k, v in ledger["issues"].items() if v["status"] not in closed]
    flat = norm(text)
    open_items = []
    for iid in open_ids:
        it = ledger["issues"][iid]
        q = it.get("quote", "")
        open_items.append({
            "id": iid,
            "quote": q,
            "still_present": (norm(q) in flat) if norm(q) else None,
            "last_status": it["status"],
            "location": it.get("location", ""),
        })

    # 3) 预检报告
    quote_coverage = {
        "quoted": quotes["checked"],
        "numbered": quotes["citations"]["checked"],
        "ids_available": quotes["ids_available"],
    }
    precheck = {
        "target": str(target),
        "target_sha256": hashlib.sha256(data).hexdigest(),
        "quote_coverage": quote_coverage,
        "round": rnd,
        "number_check": numbers,
        "number_check_exit": n_ec,
        "quote_check": quotes,
        "quote_check_exit": q_ec,
        "ledger_open_issues": open_items,
        "confirm_numbers": (numbers or {}).get("mismatches", []),
    }
    CHECK_DIR.mkdir(parents=True, exist_ok=True)
    (CHECK_DIR / f"precheck-r{rnd}.json").write_text(
        json.dumps(precheck, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # 4) 草稿骨架
    issues = []
    if quotes:
        for it in quotes["citations"]["missing"]:
            issues.append(quote_issue(it, "missing", heading_of(lines, it["line"]), lines))
        for it in quotes["citations"]["mismatched"]:
            issues.append(quote_issue(it, "mismatched", heading_of(lines, it["line"]), lines))
    program_checks = []
    if numbers is not None:
        program_checks.append({
            "tool": "check_numbers",
            "result": "pass" if not numbers["mismatches"] and not numbers["unknown_refs"] else "fail",
            "note": f"tagged_lines={numbers['tagged_lines']}，mismatches={len(numbers['mismatches'])}，"
                    f"unknown_refs={len(numbers['unknown_refs'])}，untagged={len(numbers['untagged'])}",
        })
    if quotes:
        c = quotes["citations"]
        program_checks.append({
            "tool": "check_quotes",
            "result": "pass" if not c["missing"] and not c["mismatched"] else "fail",
            "note": f"numbered/quoted={c['checked']}/{quotes['checked']}；"
                    f"带编号 ok={c['ok']}，missing={len(c['missing'])}，mismatched={len(c['mismatched'])}；"
                    f"不带编号提示 {len(quotes['unnumbered']['hints'])} 条",
        })
    draft = {
        "target": str(target),
        "verdict": "",
        "summary": "",
        "program_checks": program_checks,
        "issues": issues,
        "rechecks": [{"id": x["id"], "state": "", "evidence": ""} for x in open_items],
        "decisions": [],
        "incomplete_reason": "",
    }
    draft_path = CHECK_DIR / f"draft-r{rnd}.json"
    draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # 5) 终端摘要（<=30 行）
    out = [f"precheck r{rnd}：{target}"]
    coverage_note = ("；引文程序核对覆盖为 0，不能判 PASS"
                     if quote_coverage["ids_available"] and quote_coverage["quoted"] > 0
                     and quote_coverage["numbered"] == 0 else "")
    out.append(f"- 引文覆盖 numbered/quoted={quote_coverage['numbered']}/{quote_coverage['quoted']}；"
               f"ids_available={quote_coverage['ids_available']}{coverage_note}")
    if numbers is not None:
        out.append(f"- check_numbers：{'pass' if program_checks[0]['result'] == 'pass' else 'fail'}；"
                   f"mismatches {len(numbers['mismatches'])}、unknown_refs {len(numbers['unknown_refs'])}、"
                   f"untagged {len(numbers['untagged'])}")
        for m in numbers["mismatches"]:
            out.append(f"    · 待确认 第{m['line']}行（{','.join(m['refs'])}）{m['text'][:60]}")
        for u in numbers["unknown_refs"]:
            out.append(f"    · 未知编号 第{u['line']}行 {u['ref']}")
    else:
        out.append("- check_numbers：未运行（没给 --facts）")
    c = quotes["citations"]
    u = quotes["unnumbered"]
    out.append(f"- check_quotes：带编号 ok={c['ok']}、missing={len(c['missing'])}、"
               f"mismatched={len(c['mismatched'])}；不带编号提示 {len(u['hints'])} 条")
    for h in u["hints"]:
        out.append(f"    · 提示 第{h['line']}行 “{h['quote'][:40]}”")
    out.append(f"- 草稿已预填 {len(issues)} 个问题（带编号引文）；数字 mismatch 未自动写成问题，见上方待确认行")
    if open_items:
        out.append(f"- 台账待复查：{'、'.join(x['id'] for x in open_items)}")
        for x in open_items:
            mark = "原句仍在" if x["still_present"] else ("原句已不在" if x["still_present"] is False else "无原句")
            out.append(f"    · {x['id']}（{x['last_status']}）：{mark}，位置 {x['location'] or '—'}")
    else:
        out.append("- 台账：无未关闭问题")
    out.append(f"- 报告：{CHECK_DIR}/precheck-r{rnd}.json")
    out.append(f"- 草稿：{draft_path}（填 verdict / summary / rechecks 后 submit）")
    print("\n".join(out[:30]))


if __name__ == "__main__":
    main()
