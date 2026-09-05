#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
客研管理智能体 - 多源证据矩阵脚本（Triangulation，v4）

职责：把访谈分析结果（analyze_interview.py --json 输出）与「舆情/客服/社群反馈证据」
与「业务指标」做交叉对表，输出每条洞察的证据矩阵与综合证据级别（S/A/B/C）。

方法论：见 resources/references/triangulation_guide.md
  - S 级：访谈 + 外部证据 + 指标 三方一致
  - A 级：两方一致（含跨记录/跨客户访谈共识）
  - B 级：仅一方直接证据
  - C 级：无直接证据（推断/待验证）

定位：机械初筛 + 证据对表；指标方向是否构成"佐证/矛盾"需 LLM 语义复核。

用法：
  python3 triangulate_insights.py --interviews report.json --output matrix.md
  python3 triangulate_insights.py --interviews report.json --evidence evidence.json --metrics metrics.csv --output matrix.md
  python3 triangulate_insights.py --interviews report.json --evidence evidence.json --output matrix.json --json
"""

import argparse
import csv
import json
import os
import re
import sys
from datetime import datetime

# ---------------------------------------------------------------- 关键词抽取

# 停用字（单字，仅纯虚字；保留"不对账/月底/周末/特别"等业务 2-gram 的关键字）
STOP_CHARS = set("的了呢吧啊吗哦呀么什怎这那着把被让与及或就都也很还是不但然而且其之")
# 完全停用词（整词，用于直接剔除）
STOP_WORDS = {"这个", "那个", "什么", "怎么", "我们", "你们", "他们", "咱们", "一个", "一下", "一些", "有点", "然后", "就是", "其实", "觉得", "知道", "问题", "情况", "东西", "时候", "现在", "目前", "感觉", "比较", "非常", "特别", "真的", "的话", "因为", "所以", "但是", "而且", "如果", "没有", "可以", "需要", "应该", "可能"}


def keywords_of(text, n=2):
    """抽取文本特征词集合：中文 n-gram（过滤停用）+ 英文单词（≥3 字母）。"""
    out = set()
    for zh in re.findall(r"[\u4e00-\u9fa5]+", text):
        if len(zh) >= n and zh not in STOP_WORDS:
            for i in range(len(zh) - n + 1):
                gram = zh[i:i + n]
                if all(c not in STOP_CHARS for c in gram):
                    out.add(gram)
    for en in re.findall(r"[A-Za-z]{3,}", text):
        out.add(en.lower())
    return out


def overlap_ratio(a_text, b_text, n=2):
    """两个文本的特征词重合度（0-1）。"""
    ka, kb = keywords_of(a_text, n), keywords_of(b_text, n)
    if not ka or not kb:
        return 0.0
    return len(ka & kb) / min(len(ka), len(kb))


# ---------------------------------------------------------------- 数据加载

def load_interviews(path):
    """加载 analyze_interview.py --json 输出。"""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    pains = data.get("pain_points", [])
    reqs = data.get("candidate_requirements", [])
    basic = data.get("basic_info", {})
    return pains, reqs, basic


def load_evidence(path):
    """加载外部证据清单：[{text, count?, channel?}, ...]。"""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        data = data.get("evidence", data.get("items", []))
    return data


def load_metrics(path):
    """加载指标数据：CSV（metric,value,period,trend,note）或 JSON 数组。"""
    items = []
    if path.lower().endswith(".csv"):
        with open(path, "r", encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                items.append({k.strip(): (v.strip() if v else "") for k, v in row.items()})
    else:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        items = data if isinstance(data, list) else data.get("metrics", [])
    return items


# 指标主题映射：访谈关键词 → 指标主题（用于机械匹配指标行）
METRIC_TOPIC_MAP = [
    (["耗时", "时间", "分钟", "小时", "加班"], "耗时/效率"),
    (["多订", "少订", "损耗", "浪费", "库存", "积压"], "损耗/库存"),
    (["对账", "出错", "误差", "不准", "对不上"], "差错率"),
    (["客服", "响应", "工单", "售后"], "客服响应/工单"),
    (["导出", "导入", "批量", "自动化", "报表"], "导入导出/自动化"),
    (["留存", "流失", "活跃", "回访"], "活跃/留存"),
    (["慢", "卡", "崩溃", "稳定"], "性能"),
    (["贵", "成本", "价格", "费用", "预算"], "成本"),
]


def match_metrics(insight_text, metrics):
    """机械匹配关联指标行：优先按指标自带 topic 列，其次按关键词映射。"""
    hits = []
    for item in metrics:
        name = item.get("metric", "") + item.get("name", "") + item.get("指标", "")
        trend = item.get("trend", item.get("方向", ""))
        topic_col = item.get("topic", item.get("主题", "")).strip()
        if topic_col:
            # 指标自带主题标注：洞察含对应主题关键词即关联
            topic_kws = [w for w, t in METRIC_TOPIC_MAP if t == topic_col]
            if topic_kws and any(kw in insight_text for kw in topic_kws[0]):
                hits.append({"metric": item.get("metric", item.get("name", "")),
                             "trend": trend, "topic": topic_col})
                continue
        for kws, topic in METRIC_TOPIC_MAP:
            if any(kw in insight_text for kw in kws) and (topic in name or any(kw in name for kw in kws)):
                hits.append({"metric": item.get("metric", item.get("name", "")),
                             "trend": trend, "topic": topic})
                break
    return hits


# ---------------------------------------------------------------- 互证计算

def triangulate(pains, reqs, evidence, metrics):
    """对每条洞察计算证据矩阵。"""
    insights = [{"type": "痛点", "key": f"P{i+1:02d}", **p} for i, p in enumerate(pains)]
    insights += [{"type": "需求", "key": f"R{i+1:02d}", **r} for i, r in enumerate(reqs)]

    rows = []
    for ins in insights:
        text = ins.get("text", "")
        # 1) 访谈内证据
        freq = ins.get("frequency", 1)
        records_total = int(ins.get("mention_rate", "1/1").split("/")[-1] or 1)
        interview_level = "multi" if freq >= 2 else "single"
        # 2) 外部证据匹配（2-gram 重合度 ≥0.15 且交集 ≥2 视为关联）
        ev_hits = []
        for ev in evidence:
            ev_text = ev.get("text", "")
            if not ev_text:
                continue
            r = overlap_ratio(text, ev_text)
            inter = len(keywords_of(text) & keywords_of(ev_text))
            if r >= 0.15 and inter >= 2:
                ev_hits.append({"text": ev_text[:60], "count": ev.get("count", 1),
                                "channel": ev.get("channel", ""), "ratio": round(r, 2)})
        # 3) 指标匹配
        metric_hits = match_metrics(text, metrics)

        # 证据级别
        n_sources = 0
        if interview_level == "multi":
            n_sources = 1
        if ev_hits:
            n_sources += 1
        if metric_hits:
            n_sources += 1
        if n_sources >= 3:
            level = "S"
        elif n_sources == 2:
            level = "A"
        elif n_sources == 1:
            level = "B"
        else:
            level = "C"
        # 矛盾预警：指标命中但方向为 down（如"耗时下降"与"耗时是痛点"矛盾，需复核）
        warn = []
        for m in metric_hits:
            if m["trend"] in ("down", "下降", "↓"):
                warn.append(f"指标「{m['metric']}」方向为下降，与痛点方向需复核是否矛盾")
        rows.append({
            "key": ins["key"], "type": ins["type"], "text": text[:80],
            "interview_mentions": freq, "interview_records_total": records_total,
            "evidence_hits": ev_hits[:3], "metric_hits": metric_hits,
            "evidence_level": level, "warnings": warn,
        })
    # 排序：证据级别 S > A > B > C，同级按访谈提及数
    order = {"S": 0, "A": 1, "B": 2, "C": 3}
    rows.sort(key=lambda r: (order.get(r["evidence_level"], 9), -r["interview_mentions"]))
    return rows


# ---------------------------------------------------------------- 输出

def build_md(rows, basic, evidence_src, metrics_src, analysis_time):
    md = [f"# 多源证据矩阵（Triangulation）\n"]
    md.append("## 1 基本信息")
    md.append(f"- 分析时间：{analysis_time}")
    md.append(f"- 访谈来源：{basic.get('records', '?')} 场记录 / {len(basic.get('customers', []))} 家客户")
    md.append(f"- 外部证据：{evidence_src or '未提供'}")
    md.append(f"- 指标数据：{metrics_src or '未提供'}\n")

    md.append("## 2 证据级别说明")
    md.append("- **S 级**：访谈（跨记录/跨客户）+ 外部证据 + 指标 三方一致")
    md.append("- **A 级**：两方证据一致（含多记录访谈共识 + 任一外部源）")
    md.append("- **B 级**：仅一方直接证据（如单记录访谈，或仅数据侧信号）")
    md.append("- **C 级**：无直接证据，属推断，须标注\"待验证\"\n")

    md.append("## 3 证据矩阵")
    md.append("| 编号 | 类型 | 洞察 | 访谈提及 | 外部证据 | 指标佐证 | 证据级别 | 预警 |")
    md.append("|------|------|------|---------|---------|---------|---------|------|")
    for r in rows:
        ev = "、".join(f"{h['channel'] or '外部'}×{h['count']}" for h in r["evidence_hits"]) or "—"
        mt = "、".join(f"{m['metric']}({m['trend'] or '?'})" for m in r["metric_hits"]) or "—"
        warn = "⚠️ " + "; ".join(r["warnings"][:1]) if r["warnings"] else "—"
        md.append(f"| {r['key']} | {r['type']} | {r['text'][:40]} | {r['interview_mentions']}条/{r['interview_records_total']}场 | {ev} | {mt} | **{r['evidence_level']}** | {warn} |")
    md.append("")

    md.append("## 4 明细（S/A 级洞察的证据原文）")
    for r in rows:
        if r["evidence_level"] not in ("S", "A"):
            continue
        md.append(f"### {r['key']} {r['text'][:50]}")
        for h in r["evidence_hits"]:
            md.append(f"- 外部证据：「{h['text']}」（{h['channel'] or '未标注渠道'}，出现 {h['count']} 次）")
        for m in r["metric_hits"]:
            md.append(f"- 指标佐证：{m['metric']} 趋势 {m['trend'] or '未知'}（主题：{m['topic']}）")
        if r["warnings"]:
            for w in r["warnings"]:
                md.append(f"- ⚠️ {w}")
        md.append("")

    md.append("## 5 矛盾与缺口")
    n_warn = sum(len(r["warnings"]) for r in rows)
    n_c = sum(1 for r in rows if r["evidence_level"] == "C")
    md.append(f"- 指标方向预警 {n_warn} 处：需按 triangulation_guide.md §6 排查（口径/细分群/样本/指标定义）。")
    md.append(f"- 待验证洞察（C 级）{n_c} 条：无外部数据佐证，建议移交数据侧做定量验证（见 user_metrics_framework.md §四）。")
    md.append(f"- 指标方向是否构成\"佐证\"需 LLM 语义复核；本矩阵为机械初筛。")
    md.append(f"\n---\n*由客研管理智能体生成 · {analysis_time}*")
    return "\n".join(md)


def main():
    parser = argparse.ArgumentParser(description="客研管理智能体 - 多源证据矩阵（v4）")
    parser.add_argument("--interviews", "-i", required=True, help="analyze_interview.py --json 输出路径")
    parser.add_argument("--evidence", "-e", help="外部证据 JSON（[{text,count,channel},...]）")
    parser.add_argument("--metrics", "-m", help="指标数据 CSV（metric,value,period,trend,note）或 JSON")
    parser.add_argument("--output", "-o", help="输出文件路径（.md 或 --json 时为 .json）")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    args = parser.parse_args()

    pains, reqs, basic = load_interviews(args.interviews)
    evidence = load_evidence(args.evidence) if args.evidence else []
    metrics = load_metrics(args.metrics) if args.metrics else []
    print(f"📊 访谈 {len(pains)} 痛点 / {len(reqs)} 需求 | 外部证据 {len(evidence)} 条 | 指标 {len(metrics)} 行")

    rows = triangulate(pains, reqs, evidence, metrics)
    analysis_time = datetime.now().strftime("%Y-%m-%d %H:%M")
    lvl_count = {}
    for r in rows:
        lvl_count[r["evidence_level"]] = lvl_count.get(r["evidence_level"], 0) + 1
    print(f"✅ 证据级别分布：{dict(sorted(lvl_count.items()))}")

    if args.json:
        payload = {
            "analysis_time": analysis_time,
            "basic_info": basic,
            "evidence_sources": args.evidence or "",
            "metrics_sources": args.metrics or "",
            "rows": rows,
        }
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    else:
        text = build_md(rows, basic, args.evidence or "", args.metrics or "", analysis_time)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"✅ 已生成：{args.output}")
    else:
        print(text)


if __name__ == "__main__":
    main()
