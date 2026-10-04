#!/usr/bin/env python3
"""Reproducible rating counts for a frozen JSON array; stdout is the calculation evidence.

No sampling, clock filtering, deduplication, sentiment inference, network or source writes.
Missing/invalid ratings are excluded from the rating denominator and reported by row.
"""
import argparse
import hashlib
import json
from pathlib import Path


def calculate(raw, source, field="rating"):
    rows = json.loads(raw)
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("输入必须为评论对象的 JSON 数组")
    counts = {str(n): 0 for n in range(1, 6)}
    missing = []
    evidence = []
    for index, row in enumerate(rows, 1):
        value = row.get(field)
        # bool and permissive numeric coercion must not manufacture a rating.
        rating = int(value) if type(value) in (int, float) and value in (1, 2, 3, 4, 5) else None
        if rating is None:
            missing.append(index)
        else:
            counts[str(rating)] += 1
        evidence.append({"row": index, "id": row.get("id"), "rating": rating})
    denominator = sum(counts.values())
    return {
        "rule_version": "STD-v0.1/rating-counts-1", "source": str(source),
        "input_sha256": hashlib.sha256(raw).hexdigest(), "field": field,
        "rows": len(rows), "denominator": denominator, "missing_rows": missing,
        "missing_rule": "排除缺失、非数字、非整数及1—5范围外评分；不去重、不抽样、不补值",
        "counts": counts,
        "rating_1_2_ratio": (counts["1"] + counts["2"]) / denominator if denominator else None,
        "rating_4_5_ratio": (counts["4"] + counts["5"]) / denominator if denominator else None,
        "status": "observed" if denominator else "not_applicable",
        "semantic_classification": "未执行；星级分组不等于语义情感标签，模型主题分类另标模型来源",
        "evidence": evidence,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--field", default="rating")
    args = parser.parse_args()
    path = Path(args.input)
    print(json.dumps(calculate(path.read_bytes(), path, args.field), ensure_ascii=False, indent=2))
