#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
客研管理智能体 - 访谈分析脚本（v2）

职责：把访谈记录/转写文本整理为结构化分析结果，产出：
  1) 结构化访谈报告   2) 痛点清单（含原文证据）  3) 候选需求条目（含证据与置信度）  4) 待澄清问题列表

升级点（相对 v1）：
  - 每条痛点/需求/问题均携带「原文证据」：来源文件 + 段号 + 原话摘录，保证可回溯
  - 频次按「提及记录数 / 总记录数」口径统计，支持跨客户共识度
  - 输出 Markdown 与 JSON 双格式（--json）
  - 支持推荐记录格式（头部元信息 + 问/答正文），段号定位
  - 修正 v1 中"服务"等词的机械误分类（按语义规则顺序判定）

用法：
  python3 analyze_interview.py --input interview.txt --output report.md
  python3 analyze_interview.py --input-dir ./interviews/ --output report.md
  python3 analyze_interview.py --input-dir ./interviews/ --output report.json --json
"""

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime

# ---------------------------------------------------------------- 记录加载

HEADER_KEYS = {
    "访谈日期": "date",
    "日期": "date",
    "受访者": "interviewee",
    "客户": "customer",
    "公司": "customer",
    "访谈主题": "topic",
    "主题": "topic",
    "访谈渠道": "channel",
    "渠道": "channel",
}


def parse_record(content, source):
    """解析单条记录：头部元信息 + 分段正文（问/答/说话人行）。"""
    lines = content.splitlines()
    meta = {
        "date": "",
        "interviewee": "",
        "customer": "待确认",
        "topic": "",
        "channel": "",
        "source": source,
    }
    segments = []  # [{no, speaker, text, line}]
    in_body = False
    seg_no = 0

    for idx, raw in enumerate(lines, 1):
        line = raw.strip()
        if not line:
            continue
        # 头部字段（在 --- 分隔线之前）
        if line.startswith("---"):
            in_body = True
            continue
        if not in_body:
            matched = False
            for key, field in HEADER_KEYS.items():
                if line.startswith(key + "：") or line.startswith(key + ":"):
                    meta[field] = line.split("：", 1)[-1].split(":", 1)[-1].strip()
                    matched = True
                    break
            if matched:
                continue
            # 未识别行进入正文兜底
            in_body = True
        # 正文：问/答/说话人标注
        speaker = ""
        text = line
        m = re.match(r"^(问|答|我|客|访|受访者|[A-Za-z\u4e00-\u9fa5]{1,10}[：:])", line)
        if m:
            seg = re.split(r"[：:]", line, maxsplit=1)
            if len(seg) == 2 and len(seg[0]) <= 12:
                speaker, text = seg[0].strip(), seg[1].strip()
        seg_no += 1
        segments.append({"no": seg_no, "speaker": speaker, "text": text, "line": idx})

    return meta, segments


def load_records(input_path=None, input_dir=None):
    """加载单条或批量记录。"""
    records = []
    if input_dir:
        if not os.path.isdir(input_dir):
            print(f"❌ 目录不存在：{input_dir}")
            return records
        files = sorted(
            f for f in os.listdir(input_dir)
            if f.lower().endswith((".txt", ".md", ".csv"))
        )
        for fn in files:
            fp = os.path.join(input_dir, fn)
            try:
                with open(fp, "r", encoding="utf-8") as fh:
                    meta, segs = parse_record(fh.read(), fn)
                records.append({"meta": meta, "segments": segs})
                print(f"  ✓ 已加载 {fn}（{len(segs)} 段）")
            except Exception as e:
                print(f"  ⚠️ 加载失败 {fn}: {e}")
    elif input_path:
        with open(input_path, "r", encoding="utf-8") as fh:
            meta, segs = parse_record(fh.read(), os.path.basename(input_path))
        records.append({"meta": meta, "segments": segs})
        print(f"  ✓ 已加载 {os.path.basename(input_path)}（{len(segs)} 段）")
    return records


def iter_segments(records):
    """遍历所有记录的所有段，带记录上下文。"""
    for rec in records:
        for seg in rec["segments"]:
            yield rec, seg


# ---------------------------------------------------------------- 抽取逻辑

PAIN_PATTERNS = [
    r"(?:痛点|困难|问题|挑战|苦恼|困扰)(?:是|在于|有|就是)?[：:]?\s*([^。！？\n]{5,80})",
    r"(?:不方便|不好用|不满意|很烦|受不了)(?:的是|的地方)?\s*([^。！？\n]{5,80})",
]

# 负面语义词典：命中即视为痛点候选句（覆盖面远大于显式模式）
PAIN_WORDS = [
    "麻烦", "痛苦", "头疼", "费劲", "繁琐", "低效", "效率低", "浪费时间", "花时间", "耗时",
    "很慢", "太慢", "卡顿", "不稳定", "崩溃", "宕机",
    "成本高", "太贵", "浪费", "损耗", "多订", "积压", "隐性成本",
    "很难", "不方便", "不好用", "不友好", "不满意", "失望", "很失望",
    "对不上", "不统一", "不准确", "出错", "经常错", "缺失", "缺乏", "没有这个",
    "等到", "滞后", "延迟", "错过", "白做", "耽误", "赶不上", "跟不上",
    "焦虑", "担心", "压力大", "很怕", "特别痛苦",
    "解决不了", "响应慢", "找不到", "难找", "重复录入", "反复",
    "手工", "手动",
]

STRIP_PREFIXES = r"^(那当然好|当然好|可以的|可以|没问题|是的|对啊|对，|嗯[，,]|好的?[，,]|其实|就是说|就是说呢|就是)[，,。\s]*"

REQ_PATTERNS = [
    r"(?:需要|希望|想要|期望|要求|盼)(?:能够|可以|有个|增加|提供|支持)?\s*([^。！？\n]{5,80})",
    r"(?:建议|最好|如果能|要是|能否|能不能)(?:给|帮|加|增加|优化|开发|支持)?\s*([^。！？\n]{5,80})",
    r"(?:目前只能|现在只能|只能靠|不得不)([^。！？\n]{5,80})",
]

VAGUE_PATTERNS = [
    (r"(?:大概|大约|可能|也许)([^。！？\n]{3,30})", "量化缺失", "请确认具体数量/时间/范围"),
    (r"(?:尽快|马上|近期|尽快)([^。！？\n]{0,15})", "时间节点", "请确认具体时间节点"),
    (r"(?:预算|费用|价格|投入)(?:大概|大约)?\s*([^。！？\n]{0,15})", "预算范围", "请确认具体预算范围"),
    (r"(?:很多人|有些|部分|不少)([^。！？\n]{3,30})", "范围模糊", "请确认具体范围与比例"),
    (r"(?:优先级|重要程度|哪个更)([^。！？\n]{0,15})", "优先级排序", "请确认优先级排序"),
    (r"(?:等等|之类|什么的)", "列表缺失", "请列举完整列表"),
    (r"(?:比较|相对|稍微)([^。！？\n]{3,30})", "量化缺失", "请量化具体指标"),
]

DOMAIN_KEYWORDS = [
    ("F 功能", ["功能", "模块", "能力", "系统", "自动化", "批量", "导出", "导入", "报表", "模板"]),
    ("U 体验", ["界面", "操作", "流程", "交互", "步骤", "点击", "导航", "难找"]),
    ("P 性能", ["速度", "响应", "并发", "稳定", "卡", "慢", "崩溃", "加载", "容量"]),
    ("C 成本", ["成本", "价格", "费用", "预算", "贵", "计费", "性价比", "损耗", "浪费"]),
    ("S 服务", ["客服", "售后", "响应慢", "解决不了", "培训", "文档"]),
    ("I 集成", ["集成", "对接", "接口", "API", "同步", "兼容", "导来导去", "格式"]),
    ("R 合规", ["权限", "审计", "安全", "合规", "风控"]),
]

LOSS_KEYWORDS = [
    ("时间损失", ["时间", "小时", "分钟", "耗时", "加班", "每天", "每晚", "每周"]),
    ("金钱损失", ["钱", "成本", "损耗", "浪费", "多订", "库存积压", "赔付"]),
    ("效率损失", ["效率", "排", "延误", "赶不上", "错过", "延迟"]),
    ("情绪损失", ["叹气", "头疼", "焦虑", "烦", "担心", "怕", "崩溃", "压力"]),
    ("机会损失", ["错过", "商机", "窗口", "机会"]),
]

HIGH_SEV = ["核心", "关键", "严重", "极其", "根本", "崩溃", "中断", "每天", "每晚", "全部", "所有", "损失"]
MED_SEV = ["经常", "常常", "很", "非常", "耗时", "麻烦", "慢", "贵", "难"]
EMOTION_NEG = ["叹气", "头疼", "焦虑", "烦躁", "心烦", "担心", "压力", "崩溃", "受不了", "无奈", "苦笑"]
EMOTION_POS = ["满意", "喜欢", "不错", "很好", "方便", "省", "推荐", "认可"]
ACTION_WORDS = ["已经在用", "现在用", "替代", "买了", "付费", "准备", "计划", "采购", "预算", "明年", "下季度", "月底"]
TIME_WORDS = ["尽快", "下季度", "下月", "年底", "明年", "本季度", "Q1", "Q2", "Q3", "Q4"]
INTERVIEWER_SPEAKERS = {"问", "我", "访", "访谈者", "主持人", "记者"}


def clean_text(s):
    """去除捕获文本首尾标点/空白与客套前缀，避免残缺匹配。"""
    s = re.sub(STRIP_PREFIXES, "", s)
    return s.strip(" \t\n，,。；;：:！!？?、）（()「」\"'").strip()


def hit_pain_sentence(sent):
    """双通道判定痛点句：显式模式 or 负面词典命中，返回 (is_pain, matched_word)。"""
    for pat in PAIN_PATTERNS:
        if re.search(pat, sent):
            return True, ""
    for w in PAIN_WORDS:
        if w in sent:
            return True, w
    return False, ""


def is_interviewer_question(seg):
    """判定是否为访谈者的提问段（不抽取痛点/需求/情绪证据）。"""
    if seg["speaker"] in INTERVIEWER_SPEAKERS:
        return True
    t = seg["text"].strip()
    return t.endswith(("？", "?")) or t.startswith(("有没有", "是不是", "能否", "能不能", "您觉得", "如果"))


def _domain_of(text):
    scores = []
    for domain, kws in DOMAIN_KEYWORDS:
        s = sum(1 for kw in kws if kw in text)
        if s:
            scores.append((s, domain))
    if not scores:
        return "其他"
    # 同分时按列表顺序靠前者优先（功能 > 体验 > 性能 > 成本 > 服务 > 集成 > 合规）
    max_s = max(s for s, _ in scores)
    return next(d for s, d in scores if s == max_s)


def _loss_of(text, seg_text=""):
    combined = text + " " + seg_text
    for loss, kws in LOSS_KEYWORDS:
        if any(kw in combined for kw in kws):
            return loss
    return "未知"


def _severity_of(text, seg_text):
    s = 2
    if any(kw in text for kw in HIGH_SEV):
        s = 4
    elif any(kw in text for kw in MED_SEV):
        s = 3
    if any(w in seg_text for w in EMOTION_NEG):
        s = min(5, s + 1)
    return s


def iter_sentences(seg):
    """把段文本按句子切分，返回自洽子句列表（去除问句、语气括号前缀）。"""
    out = []
    for part in re.split(r"[。！？\n]+", seg["text"]):
        s = part.strip()
        s = re.sub(r"^[（(][^（()）]{1,8}[）)]", "", s)  # 剥离（叹气）等语气前缀
        s = s.strip()
        if len(s) >= 5:
            out.append(s)
    return out


def extract_pain_points(records, top=15):
    """提取痛点：按句匹配 + 原文证据 + 跨记录频次。"""
    hits = []  # {text, domain, loss, severity, quote, source, seg_no}
    seen_keys = set()
    for rec, seg in iter_segments(records):
        if is_interviewer_question(seg):
            continue
        for sent in iter_sentences(seg):
            is_pain, word = hit_pain_sentence(sent)
            if not is_pain:
                continue
            raw = clean_text(sent)
            if len(raw) < 5:
                continue
            key = raw[:20]
            if key in seen_keys:
                continue
            seen_keys.add(key)
            hits.append({
                "text": raw,
                "domain": _domain_of(raw),
                "loss": _loss_of(raw, seg["text"]),
                "severity": _severity_of(raw, seg["text"]),
                "quote": seg["text"][:80],
                "source": rec["meta"]["source"],
                "seg_no": seg["no"],
                "trigger": word,
            })
    # 跨记录频次（按同义 key 粗聚合）
    freq = Counter(h["text"][:20] for h in hits)
    total_records = max(1, len(records))
    for h in hits:
        h["frequency"] = freq[h["text"][:20]]
    # 去重合并
    merged, seen = [], set()
    for h in hits:
        k = h["text"][:20]
        if k in seen:
            continue
        seen.add(k)
        h["mention_rate"] = f"{h['frequency']}/{total_records}"
        merged.append(h)
    # 排序：优先级 = 严重度 x 频次
    for h in merged:
        h["priority_score"] = h["severity"] * h["frequency"]
    merged.sort(key=lambda x: (x["priority_score"], x["severity"]), reverse=True)
    return merged[:top]


def extract_requirements(records, top=15):
    """提取候选需求：证据 + 表达力 + 简化置信度。"""
    hits = []
    seen_keys = set()
    for rec, seg in iter_segments(records):
        if is_interviewer_question(seg):
            continue
        for sent in iter_sentences(seg):
            for pat in REQ_PATTERNS:
                if re.search(pat, sent):
                    raw = clean_text(sent)
                    if len(raw) < 5:
                        continue
                    key = raw[:20]
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    level = "L1" if any(w in raw for w in ["需要", "希望", "要求", "必须"]) else "L2"
                    if any(w in raw for w in ["如果能", "要是", "也许", "可能"]):
                        level = "L3"
                    has_action = any(w in seg["text"] for w in ACTION_WORDS)
                    has_time = any(w in seg["text"] for w in TIME_WORDS)
                    conf = 0.3 if level == "L3" else (0.65 if level == "L2" else 1.0)
                    conf = conf * 0.4 + (1.0 if has_action else 0.4) * 0.2 + (1.0 if has_time else 0.5) * 0.1 + 0.3 * 0.3
                    hits.append({
                        "text": raw,
                        "category": _req_category(raw),
                        "level": level,
                        "confidence": round(min(1.0, conf), 2),
                        "quote": seg["text"][:80],
                        "source": rec["meta"]["source"],
                        "seg_no": seg["no"],
                        "has_action": has_action,
                    })
                    break  # 一句只记一条
    merged, seen = [], set()
    for h in hits:
        k = h["text"][:20]
        if k in seen:
            continue
        seen.add(k)
        merged.append(h)
    merged.sort(key=lambda x: x["confidence"], reverse=True)
    return merged[:top]


def _req_category(text):
    d = _domain_of(text)
    return {"F 功能": "功能需求", "U 体验": "体验需求", "P 性能": "性能需求",
            "C 成本": "成本需求", "S 服务": "服务需求", "I 集成": "集成需求",
            "R 合规": "合规需求"}.get(d, "其他需求")


def generate_open_questions(records, top=10):
    """基于模糊表述生成待澄清问题。"""
    out, seen = [], set()
    for rec, seg in iter_segments(records):
        if is_interviewer_question(seg):
            continue
        text = seg["text"]
        for pat, qtype, qtext in VAGUE_PATTERNS:
            for m in re.finditer(pat, text):
                ctx = clean_text((m.group(1) if m.groups() else m.group(0)).strip())
                if len(ctx) < 2:
                    continue
                # 按上下文前 15 字去重，避免同句多模式重复命中
                ctx_key = ctx[:15]
                if ctx_key in seen:
                    continue
                seen.add(ctx_key)
                q = f"关于「{ctx}」，{qtext}"
                priority = "高" if qtype in ("预算范围", "时间节点") else "中"
                out.append({
                    "question": q,
                    "type": qtype,
                    "context": ctx,
                    "priority": priority,
                    "quote": text[:80],
                    "source": rec["meta"]["source"],
                    "seg_no": seg["no"],
                })
    return out[:top]


def analyze_sentiment(records):
    neg = pos = 0
    anchors = []
    for rec, seg in iter_segments(records):
        text = seg["text"]
        if is_interviewer_question(seg):
            continue
        for w in EMOTION_NEG:
            if w in text:
                neg += 1
                if len(anchors) < 3:
                    anchors.append(f"「{text[:60]}」— {rec['meta']['source']}§{seg['no']}")
                break
        for w in EMOTION_POS:
            if w in text:
                pos += 1
                break
    total = pos + neg
    score = round(pos / total, 2) if total else 0.5
    overall = "积极" if score > 0.6 else ("消极" if score < 0.4 else "中性")
    return {"overall": overall, "positive": pos, "negative": neg,
            "score": score, "anchors": anchors}


def generate_key_findings(records, pains, reqs):
    findings = []
    n_customers = len({r["meta"]["customer"] for r in records})
    n_records = len(records)
    if len(pains) >= 3:
        top_pain = pains[0]
        findings.append({
            "finding": f"识别到 {len(pains)} 个高优先级痛点，最突出为「{top_pain['text'][:30]}」",
            "evidence": top_pain["quote"] + f"（{top_pain['source']}§{top_pain['seg_no']}）",
            "confidence": "高",
        })
    if len(reqs) >= 3:
        top_req = reqs[0]
        findings.append({
            "finding": f"提取到 {len(reqs)} 条候选需求，置信度最高为「{top_req['text'][:30]}」",
            "evidence": top_req["quote"] + f"（{top_req['source']}§{top_req['seg_no']}）",
            "confidence": "高" if top_req["confidence"] >= 0.75 else "中",
        })
    if n_customers >= 2:
        findings.append({
            "finding": f"访谈覆盖 {n_customers} 家客户 / {n_records} 场记录，具备跨客户比较基础",
            "evidence": f"客户列表：{', '.join(sorted({r['meta']['customer'] for r in records}))}",
            "confidence": "高",
        })
    return findings


# ---------------------------------------------------------------- 输出

def build_report(records, pains, reqs, questions, sentiment, findings, analysis_time):
    n = len(records)
    customers = sorted({r["meta"]["customer"] for r in records})
    interviewees = sorted({r["meta"]["interviewee"] for r in records if r["meta"]["interviewee"]})
    dates = [r["meta"]["date"] for r in records if r["meta"]["date"]]

    md = [f"# 客研分析报告\n"]
    md.append("## 1 基本信息")
    md.append(f"- 分析时间：{analysis_time}")
    md.append(f"- 访谈范围：{n} 场记录 / {len(customers)} 家客户" +
              (f" / 受访者：{', '.join(interviewees)}" if interviewees else ""))
    if dates:
        md.append(f"- 时间跨度：{dates[0]} 至 {dates[-1]}")
    md.append(f"- 涉及客户：{', '.join(customers)}\n")

    md.append("## 2 访谈摘要")
    md.append(f"- 总体概述：共分析 {n} 场访谈，识别 {len(pains)} 条痛点、{len(reqs)} 条候选需求。\n")

    md.append("## 3 关键发现")
    if findings:
        for i, f in enumerate(findings, 1):
            md.append(f"### 发现 {i}：{f['finding']}")
            md.append(f"- 证据：{f['evidence']}")
            md.append(f"- 置信度：{f['confidence']}\n")
    else:
        md.append("- 暂无显著发现（样本量或信息量不足）。\n")

    md.append("## 4 情绪信号")
    md.append(f"- 整体倾向：{sentiment['overall']}（积极 {sentiment['positive']} / 消极 {sentiment['negative']}，得分 {sentiment['score']}）")
    for a in sentiment["anchors"]:
        md.append(f"- 情绪锚点：{a}")
    md.append("")

    md.append("## 5 痛点清单")
    md.append("| 编号 | 痛点描述 | 领域 | 损失类型 | 严重度 | 频次 | 提及 | 优先级 | 原文证据 |")
    md.append("|------|---------|------|---------|--------|------|------|--------|---------|")
    for i, p in enumerate(pains, 1):
        lvl = "🔴 P0" if p["priority_score"] >= 20 else ("🟠 P1" if p["priority_score"] >= 12 else ("🟡 P2" if p["priority_score"] >= 6 else "⚪ P3"))
        md.append(f"| P{i:02d} | {p['text'][:50]} | {p['domain']} | {p['loss']} | {p['severity']} | {p['frequency']} | {p['mention_rate']} | {lvl} | 「{p['quote'][:50]}」— {p['source']}§{p['seg_no']} |")
    md.append("")

    md.append("## 6 候选需求条目")
    md.append("| 编号 | 需求描述 | 类别 | 表达力 | 置信度 | 行为证据 | 原文证据 |")
    md.append("|------|---------|------|--------|--------|---------|---------|")
    for i, r in enumerate(reqs, 1):
        conf_lvl = "高" if r["confidence"] >= 0.75 else ("中" if r["confidence"] >= 0.5 else "低")
        md.append(f"| R{i:02d} | {r['text'][:50]} | {r['category']} | {r['level']} | {r['confidence']}({conf_lvl}) | {'是' if r['has_action'] else '否'} | 「{r['quote'][:50]}」— {r['source']}§{r['seg_no']} |")
    md.append("")

    md.append("## 7 待澄清问题")
    md.append("| 优先级 | 问题 | 类型 | 上下文 | 原文证据 |")
    md.append("|--------|------|------|--------|---------|")
    for q in questions:
        md.append(f"| {q['priority']} | {q['question']} | {q['type']} | {q['context'][:30]} | 「{q['quote'][:40]}」— {q['source']}§{q['seg_no']} |")
    md.append("")

    md.append("## 8 缺口与移交建议")
    md.append("- 已知缺口：模糊表述已转为待澄清问题（见 §7），未确认事项不写入结论。")
    md.append("- 建议移交：P0/P1 痛点与高置信度需求建议移交需求评估；跨客户共性痛点可作为竞品分析输入。")
    md.append(f"\n---\n*由客研管理智能体生成 · {analysis_time}*")
    return "\n".join(md)


def main():
    parser = argparse.ArgumentParser(description="客研管理智能体 - 访谈分析（v2）")
    parser.add_argument("--input", "-i", help="单次访谈记录文件")
    parser.add_argument("--input-dir", "-d", help="多次访谈记录目录")
    parser.add_argument("--output", "-o", help="输出文件路径（.md 或 --json 时为 .json）")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    parser.add_argument("--top", type=int, default=15, help="痛点/需求最大条数（默认 15）")
    args = parser.parse_args()

    if not args.input and not args.input_dir:
        print("❌ 请提供 --input 或 --input-dir")
        sys.exit(1)

    records = load_records(args.input, args.input_dir)
    if not records:
        print("❌ 未加载到有效记录")
        sys.exit(1)

    print(f"📊 开始分析 {len(records)} 场记录 ...")
    pains = extract_pain_points(records, args.top)
    reqs = extract_requirements(records, args.top)
    questions = generate_open_questions(records)
    sentiment = analyze_sentiment(records)
    findings = generate_key_findings(records, pains, reqs)
    analysis_time = datetime.now().strftime("%Y-%m-%d %H:%M")

    if args.json:
        payload = {
            "basic_info": {
                "analysis_time": analysis_time,
                "records": len(records),
                "customers": sorted({r["meta"]["customer"] for r in records}),
            },
            "pain_points": pains,
            "candidate_requirements": reqs,
            "open_questions": questions,
            "sentiment": sentiment,
            "key_findings": findings,
        }
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    else:
        text = build_report(records, pains, reqs, questions, sentiment, findings, analysis_time)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"✅ 已生成：{args.output}")
        print(f"   痛点 {len(pains)} 条 / 需求 {len(reqs)} 条 / 待澄清 {len(questions)} 条")
    else:
        print(text)


if __name__ == "__main__":
    main()
