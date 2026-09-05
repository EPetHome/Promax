#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
客研管理智能体 - 轻量痛点提取脚本（v2）

职责：快速从单份访谈文本中提取痛点候选清单（含原文证据）。
完整分析（报告/需求/澄清/情绪）请使用 analyze_interview.py。

用法：
  python3 extract_pain_points.py --input interview.txt --output pain_points.md
  python3 extract_pain_points.py --input interview.txt --output pain_points.json --json
"""

import argparse
import json
import re
import sys
from datetime import datetime

PAIN_PATTERNS = [
    r"(?:痛点|困难|问题|挑战|麻烦|苦恼|困扰)(?:是|在于|有|就是)?[：:]?\s*([^。！？\n]{5,80})",
    r"(?:不方便|不好用|不满意|很烦|受不了)(?:的是|的地方)?\s*([^。！？\n]{5,80})",
    r"(?:耗时|费力|费时|浪费|花.{0,4}时间)(?:的是|在|于)?\s*([^。！？\n]{5,80})",
    r"(?:缺乏|不足|不够|缺失|没有|缺)([^。！？\n]{5,80})",
    r"([^。！？\n]{5,60})(?:太|很|非常|极其)(?:麻烦|复杂|困难|痛苦|慢|差|贵)",
]

DOMAIN_KEYWORDS = [
    ("功能缺失", ["功能", "模块", "能力", "系统", "自动化", "批量", "导出", "导入", "报表生成"]),
    ("体验问题", ["界面", "操作", "流程", "交互", "步骤", "点击", "导航", "难找"]),
    ("性能问题", ["速度", "响应", "并发", "稳定", "卡", "慢", "崩溃", "加载", "容量"]),
    ("成本问题", ["成本", "价格", "费用", "预算", "贵", "计费", "性价比", "损耗", "浪费"]),
    ("服务问题", ["客服", "售后", "响应慢", "解决不了", "培训", "文档"]),
    ("集成问题", ["集成", "对接", "接口", "API", "同步", "兼容", "导来导去", "格式"]),
    ("合规问题", ["权限", "审计", "安全", "合规", "风控"]),
]

HIGH_SEV = ["核心", "关键", "严重", "极其", "根本", "崩溃", "中断", "每天", "每晚", "全部", "所有", "损失"]


def classify(text):
    scores = []
    for domain, kws in DOMAIN_KEYWORDS:
        s = sum(1 for kw in kws if kw in text)
        if s:
            scores.append((s, domain))
    if not scores:
        return "其他"
    max_s = max(s for s, _ in scores)
    return next(d for s, d in scores if s == max_s)


def severity(text):
    if any(kw in text for kw in HIGH_SEV):
        return "高"
    if any(kw in text for kw in ["经常", "很", "非常", "耗时", "麻烦", "慢", "贵", "难"]):
        return "中"
    return "低"


def extract(input_path, top=20):
    with open(input_path, "r", encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    hits, seen = [], set()
    for line_no, raw in enumerate(lines, 1):
        text = raw.strip()
        if not text or text.startswith(("---", "访谈", "受访", "客户", "日期", "主题", "渠道")):
            continue
        # 跳过访谈者提问行（问：...）
        if re.match(r"^问[：:]", text) or text.endswith(("？", "?")):
            continue
        for pat in PAIN_PATTERNS:
            for m in re.finditer(pat, text):
                raw_m = m.group(1).strip() if m.groups() else m.group(0).strip()
                raw_m = raw_m.strip(" \t\n，,。；;：:！!？?、）（()「」\"'")
                if len(raw_m) < 5:
                    continue
                key = raw_m[:20]
                if key in seen:
                    continue
                seen.add(key)
                hits.append({
                    "description": raw_m,
                    "category": classify(raw_m),
                    "severity": severity(raw_m),
                    "quote": text[:80],
                    "source": input_path.split("/")[-1],
                    "line": line_no,
                })
    hits.sort(key=lambda x: {"高": 3, "中": 2, "低": 1}[x["severity"]], reverse=True)
    return hits[:top]


def format_md(hits, input_path, now):
    md = [f"# ⚠️ 痛点清单（轻量提取）\n", f"- 来源：{input_path}（{now}）\n",
          "| 序号 | 痛点描述 | 类别 | 严重程度 | 原文证据 |",
          "|------|---------|------|---------|---------|"]
    for i, h in enumerate(hits, 1):
        md.append(f"| {i} | {h['description'][:50]} | {h['category']} | {h['severity']} | 「{h['quote'][:50]}」— {h['source']}:{h['line']} |")
    md.append(f"\n**总计**：{len(hits)} 条痛点候选（需经语义分析复核）")
    return "\n".join(md)


def main():
    parser = argparse.ArgumentParser(description="客研管理智能体 - 轻量痛点提取（v2）")
    parser.add_argument("--input", "-i", required=True, help="输入文件路径")
    parser.add_argument("--output", "-o", help="输出文件路径")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    parser.add_argument("--top", type=int, default=20, help="最大条数（默认 20）")
    args = parser.parse_args()

    hits = extract(args.input, args.top)
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    if args.json:
        text = json.dumps({"source": args.input, "generated_at": now, "pain_points": hits},
                          ensure_ascii=False, indent=2)
    else:
        text = format_md(hits, args.input, now)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"✅ 已生成：{args.output}（{len(hits)} 条候选）")
    else:
        print(text)


if __name__ == "__main__":
    main()
