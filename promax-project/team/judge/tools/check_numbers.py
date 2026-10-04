#!/usr/bin/env python3
"""数字核对：报告里标了事实编号（如 F9）的行，行内每个数字都必须能在所引事实的值里找到。

用法：python3 check_numbers.py <报告.md> <facts.json>
只机械核对"标了编号的行"；没标编号却含统计数字的行列入 untagged，交给 Judge 人工判断。
输出 JSON；退出码 0=无不一致，1=有不一致。
"""
import json
import re
import sys
from pathlib import Path

FACT_REF = re.compile(r"F\d+")
NUMBER = re.compile(r"(?<![A-Za-z\d.])\d+(?:\.\d+)?")
# 编号、日期、列表序号、区间（1—5、4—5 星）、星级名不是统计数字
NOISE = re.compile(
    r"[A-Za-z]+[-_]?\d{2,}|F\d+|\d{4}-\d{2}-\d{2}|^\s*\d+[.、]\s*"
    r"|\d+\s*[—–~～至到-]\s*\d+\s*星?|\d+\s*星"
)


def values_of(value, out):
    if isinstance(value, bool):
        return
    if isinstance(value, (int, float)):
        out.add(float(value))
        out.add(round(float(value), 1))
        out.add(round(float(value)))
    elif isinstance(value, dict):
        for v in value.values():
            values_of(v, out)
        counts = [v["count"] for v in value.values() if isinstance(v, dict) and isinstance(v.get("count"), int)]
        if counts:  # 分类计数的合计（如 F12 各类无效评分之和）
            out.add(float(sum(counts)))
    elif isinstance(value, list):
        for v in value:
            values_of(v, out)


def main():
    report = Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
    facts = {f["id"]: f["value"] for f in json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))["facts"]}
    result = {"tagged_lines": 0, "mismatches": [], "unknown_refs": [], "untagged": []}
    for no, line in enumerate(report, 1):
        refs = FACT_REF.findall(line)
        cleaned = NOISE.sub(" ", line)
        numbers = [float(n) for n in NUMBER.findall(cleaned)]
        if not refs:
            if numbers and re.search(r"\d+\s*(条|%|个|次|人)", line):
                result["untagged"].append({"line": no, "text": line.strip()[:200]})
            continue
        result["tagged_lines"] += 1
        allowed = set()
        for r in refs:
            if r not in facts:
                result["unknown_refs"].append({"line": no, "ref": r})
                continue
            values_of(facts[r], allowed)
        bad = [n for n in numbers if n not in allowed]
        if bad:
            result["mismatches"].append({"line": no, "refs": refs, "numbers_not_in_facts": bad, "text": line.strip()[:200]})
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(1 if result["mismatches"] or result["unknown_refs"] else 0)


if __name__ == "__main__":
    main()
