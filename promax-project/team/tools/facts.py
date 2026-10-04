#!/usr/bin/env python3
"""评分事实计算：数字只由本程序算，模型只引用事实编号。

用法：python3 tools/facts.py <评分JSON> [输出facts.json]
口径：只接受原始数值类型的 1—5 整数；数字字符串、布尔值、非整数、越界、缺失均为无效。
比例以有效评分为分母，不去重，不按日期过滤。
"""
import hashlib
import json
import sys
from pathlib import Path


def classify(value):
    if isinstance(value, bool):
        return "布尔值"
    if isinstance(value, int):
        return "有效" if 1 <= value <= 5 else "越界整数"
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return "非有限数"
        if value.is_integer():
            return "有效" if 1 <= value <= 5 else "越界整数"
        return "非整数"
    if value is None:
        return "缺失"
    if isinstance(value, str):
        return "字符串"
    return "其他类型"


def ratio(n, d):
    return {"numerator": n, "denominator": d, "percent": round(n * 100 / d, 2) if d else None}


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("facts.json")
    raw = src.read_bytes()
    records = json.loads(raw)
    stars = {s: 0 for s in range(1, 6)}
    invalid = {}
    for r in records:
        kind = classify(r.get("rating")) if "rating" in r else "缺失"
        if kind == "有效":
            stars[int(r["rating"])] += 1
        else:
            invalid.setdefault(kind, []).append(r.get("record_id"))
    valid = sum(stars.values())
    facts = [
        ("F1", "总记录数", len(records)),
        ("F2", "有效评分数", valid),
        ("F3", "无效评分数", len(records) - valid),
        *[(f"F{3 + s}", f"{s}星数量", stars[s]) for s in range(1, 6)],
        ("F9", "低星比例（1—2星/有效）", ratio(stars[1] + stars[2], valid)),
        ("F10", "中评比例（3星/有效）", ratio(stars[3], valid)),
        ("F11", "高星比例（4—5星/有效）", ratio(stars[4] + stars[5], valid)),
        ("F12", "无效评分按类型", {k: {"count": len(v), "record_ids": v} for k, v in sorted(invalid.items())}),
    ]
    result = {
        "source": {"file": src.name, "sha256": hashlib.sha256(raw).hexdigest()},
        "rule": "有效=原始数值类型的1—5整数；比例分母=有效评分数；不去重、不按日期过滤",
        "facts": [{"id": i, "name": n, "value": v} for i, n, v in facts],
    }
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for i, n, v in facts:
        if i == "F12":
            v = {k: x["count"] for k, x in v.items()}
        print(f"{i} {n}: {json.dumps(v, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
