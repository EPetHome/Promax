#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
客研管理智能体 - 贝壳图画像脚本（BEIK 客户画像骨架生成器）

职责：从客户资料/访谈记录/桌面研究文本中，按 BEIK 四要素机械初筛客户画像骨架：
  B 背景信息（Background）      E 外部环境（External Environment）
  I 内部组织（Internal Organization）  K 关键人（Key Person）

产出：贝壳图 Markdown 画像（含证据回溯、要素完整度、缺口清单），供 LLM 语义复核后形成正式画像。
      机械初筛是"候选"，不是最终结论——与 analyze_interview.py 同一哲学。

用法：
  python3 build_customer_shell.py --input profile.txt --output shell.md
  python3 build_customer_shell.py --input-dir ./profiles/ --output shell.md
  python3 build_customer_shell.py --input profile.txt --output shell.json --json
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime

# ---------------------------------------------------------------- BEIK 关键词表

SHELL = {
    "B": {
        "label": "背景信息 Background",
        "icon": "🏢",
        "kws": [
            "成立", "创立", "创办", "上市", "主营", "业务", "营收", "收入", "销售额",
            "利润", "规模", "员工", "人数", "分支机构", "分部", "门店", "网点",
            "子公司", "覆盖", "区域", "总部", "产品线", "发展历程", "历史",
            "客户数", "用户数", "市占", "排名", "行业地位", "转型升级", "多年",
        ],
    },
    "E": {
        "label": "外部环境 External Environment",
        "icon": "🌐",
        "kws": [
            "行业", "市场", "竞争", "竞品", "对手", "份额", "政策", "监管", "合规",
            "资质", "供应商", "伙伴", "渠道", "营销", "获客", "下游", "客户群",
            "趋势", "增长", "萎缩", "红利", "产业", "行情", "内卷",
        ],
    },
    "I": {
        "label": "内部组织 Internal Organization",
        "icon": "🏗️",
        "kws": [
            "组织架构", "部门", "团队", "岗位", "职责", "决策", "流程", "审批",
            "采购流程", "招投标", "商业模式", "盈利", "毛利", "系统", "ERP", "CRM",
            "信息化", "数字化", "内部管理", "预算", "KPI", "项目制", "矩阵",
            "汇报线", "总部", "三级架构", "手工", "自建",
        ],
    },
    "K": {
        "label": "关键人 Key Person",
        "icon": "👤",
        "kws": [
            "总监", "经理", "负责人", "主管", "总裁", "副总裁", "CEO", "CTO", "CFO",
            "COO", "对接人", "拍板", "决策人", "牵头", "老板", "老总", "采购",
            "选型", "落地", "最终", "上报", "审批人",
        ],
    },
}

# 人名+职位模式：姓氏白名单 + 职位，避免"供应链中心总监"被切成"链中心总"
SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦傅方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤"
NAME_TITLE_RE = re.compile(f"([{SURNAMES}])(?:总|经理|总监|负责人|主管)")
# 职位短语（带组织单位词）：供应链中心总监 / 信息部负责人 等
TITLE_RE = re.compile(r"([\u4e00-\u9fa5]{2,6}(?:中心|部|处|科|团队|办)(?:总监|经理|负责人|主管|总裁|副总裁))")

INTERVIEWER_SPEAKERS = {"问", "我", "访", "访谈者", "主持人", "记者"}
META_KEYS = ("客户", "客户名称", "来源", "资料", "资料类型", "日期", "访谈日期")


# ---------------------------------------------------------------- 解析

def iter_lines(text, source):
    """逐行遍历，返回 (行号, 原文, 是否访谈者问句)。"""
    for idx, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("---"):
            continue
        yield idx, line


def is_question_line(line):
    if line.endswith(("？", "?")):
        return True
    head = re.split(r"[：:]", line, maxsplit=1)[0].strip()
    return head in INTERVIEWER_SPEAKERS or head.startswith(("问", "访", "主持人"))


def match_shell(line):
    """返回命中要素列表 [(code, matched_kw), ...]。"""
    hits = []
    for code, conf in SHELL.items():
        for kw in conf["kws"]:
            if kw in line:
                hits.append((code, kw))
    return hits


def match_key_person(line):
    """关键人专属：姓氏+职位 / 职位短语，清洗动词前缀后去重返回。"""
    found = []
    for m in NAME_TITLE_RE.finditer(line):
        found.append(m.group(0))
    for m in TITLE_RE.finditer(line):
        t = re.sub(r"^(?:选型由|由新|最终由|最终|由|经|负责|牵头|主导|以及)", "", m.group(0))
        if t:
            found.append(t)
    # 去重（保持顺序）
    seen, out = set(), []
    for f in found:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


# ---------------------------------------------------------------- 构建画像

def build_shell(records, sources_text):
    """
    records: [{source, line_no, text, matched:[(code,kw)], persons:[...]}]
    """
    result = {code: [] for code in SHELL}
    for rec in records:
        codes = {c for c, _ in rec["matched"]}
        for code in codes:
            # K 要素：有明确人物识别时以"关键人"聚合条目为准，避免整句重复收录
            if code == "K" and rec["persons"]:
                continue
            result[code].append({
                "text": rec["text"][:120],
                "source": rec["source"],
                "line_no": rec["line_no"],
                "keywords": [kw for c, kw in rec["matched"] if c == code][:3],
            })
        # K 要素按行聚合：同一行的多个关键人合并为一条
        if rec["persons"]:
            result["K"].append({
                "text": "关键人：{}".format("、".join(rec["persons"])),
                "source": rec["source"],
                "line_no": rec["line_no"],
                "keywords": ["人物识别"],
            })
    return result


def completeness(n):
    if n >= 4:
        return "高"
    if n >= 2:
        return "中"
    return "低"


def render_md(shell, meta, stats):
    lines = []
    lines.append("# 客户画像贝壳图（BEIK）")
    lines.append("")
    lines.append(f"- 客户名称：{meta.get('customer', '待确认')}")
    lines.append(f"- 画像来源：{meta.get('source', '')}（{meta.get('material', '')}）")
    lines.append(f"- 画像时间：{meta['time']}")
    lines.append(f"- 信息来源条数：{stats['total_lines']} 条（按句/行初筛，需 LLM 语义复核）")
    lines.append(f"- 完整度：B {stats['B']} / E {stats['E']} / I {stats['I']} / K {stats['K']}")
    lines.append("")
    lines.append("> ⚠️ 本画像由关键词机械初筛生成，是**候选骨架**；请对照 customer_shell.md 方法论进行语义复核、补全与证据校验后再对外使用。")
    lines.append("")
    for code, conf in SHELL.items():
        items = shell[code]
        lines.append(f"## {conf['icon']} {conf['label']}（完整度：{stats[code]}）")
        lines.append("")
        if not items:
            lines.append("- _（暂无命中信息，待补充）_\n")
            continue
        for i, it in enumerate(items, 1):
            lines.append(f"{i}. {it['text']}  — 《{it['source']}》§{it['line_no']}（触发：{'、'.join(it['keywords'])}）")
        lines.append("")
    lines.append("## 🎯 应用建议（由 LLM 复核后填写）")
    lines.append("")
    lines.append("- 共鸣话题：基于 B 要素生成 1-2 个开场话题")
    lines.append("- 关键人策略：基于 K 要素定位决策者/使用者/预算影响者，预判关切")
    lines.append("- 待验证假设：画像中的未知项转待澄清清单")
    lines.append("- 机会点：结合痛点需求分析，输出「画像 × 需求」机会解读（见 customer_shell.md §8）")
    lines.append("")
    lines.append("## 🕳️ 缺口清单（完整度为低/中的要素）")
    lines.append("")
    gaps = 0
    for code, conf in SHELL.items():
        if stats[code] in ("低", "中"):
            gaps += 1
            lines.append(f"- [{code} {conf['label']}]：命中仅 {len(shell[code])} 条，建议通过桌面研究或下轮访谈补全")
    if not gaps:
        lines.append("- 四要素均有基础覆盖；仍建议对照 customer_shell.md 检查子项完整性。")
    lines.append("")
    lines.append(f"\n---\n*由客研管理智能体 · 贝壳图脚本生成（机械初筛版）· {meta['time']}*")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="客研管理智能体 - 贝壳图画像（BEIK）骨架生成")
    parser.add_argument("--input", "-i", help="客户资料/桌面研究文本文件")
    parser.add_argument("--input-dir", "-d", help="客户资料目录（批量）")
    parser.add_argument("--output", "-o", help="输出文件路径（.md 或 --json 时 .json）")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    args = parser.parse_args()

    if not args.input and not args.input_dir:
        print("❌ 请提供 --input 或 --input-dir")
        sys.exit(1)

    files = []
    if args.input_dir:
        if not os.path.isdir(args.input_dir):
            print(f"❌ 目录不存在：{args.input_dir}")
            sys.exit(1)
        files = sorted(
            f for f in os.listdir(args.input_dir)
            if f.lower().endswith((".txt", ".md"))
        )
        files = [os.path.join(args.input_dir, f) for f in files]
    else:
        files = [args.input]

    meta = {"customer": "待确认", "source": "", "material": "桌面研究/访谈资料", "time": datetime.now().strftime("%Y-%m-%d %H:%M")}
    records = []
    for fp in files:
        try:
            with open(fp, "r", encoding="utf-8") as fh:
                content = fh.read()
        except Exception as e:
            print(f"  ⚠️ 读取失败 {fp}: {e}")
            continue
        source = os.path.basename(fp)
        for idx, line in iter_lines(content, source):
            if is_question_line(line):
                continue
            # 头部元信息（客户/来源/资料）——提取 meta 但不作为画像信息收录
            is_meta = False
            for key in META_KEYS:
                if line.startswith(key + "：") or line.startswith(key + ":"):
                    val = line.split("：", 1)[-1].split(":", 1)[-1].strip()
                    if val:
                        meta["customer" if key.startswith("客户") else ("source" if key == "来源" else "material")] = val
                    is_meta = True
                    break
            if is_meta:
                continue
            matched = match_shell(line)
            persons = match_key_person(line)
            if matched or persons:
                records.append({"source": source, "line_no": idx, "text": line, "matched": matched, "persons": persons})

    if not records:
        print("⚠️ 未在资料中命中任何 BEIK 要素，请检查输入内容。")
        sys.exit(1)

    shell = build_shell(records, None)
    stats = {"total_lines": len(records)}
    for code in SHELL:
        stats[code] = completeness(len(shell[code]))

    print(f"📊 画像初筛完成：来源 {len(files)} 个文件 / 命中 {len(records)} 条信息")
    for code, conf in SHELL.items():
        print(f"   {conf['icon']} {code} {conf['label']}: {len(shell[code])} 条（完整度 {stats[code]}）")

    if args.json:
        payload = {
            "meta": meta,
            "stats": stats,
            "shell": {code: {"label": SHELL[code]["label"], "items": shell[code]} for code in SHELL},
        }
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    else:
        text = render_md(shell, meta, stats)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"✅ 已生成：{args.output}")
    else:
        print(text)


if __name__ == "__main__":
    main()
