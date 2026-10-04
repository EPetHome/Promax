#!/usr/bin/env python3
"""引文核对（新口径）：带编号的引文逐字硬核；不带编号的引号内容只作提示。

用法：python3 check_quotes.py <报告.md> <材料文件>...
材料支持 JSON（记录数组，自动识别以 id 结尾的字段作编号）与任意文本文件。

口径：
- 带编号引文 = 引号紧跟的括号以来源编号开头，编号后可有星级等说明。
  来源仅限括号开头连续编号，遇说明文字即停止；任一来源编号对应的记录包含引文即可。
  要求逐字存在于材料中；找不到 = missing，所有编号都对不上 = mismatched —— 两类都是硬问题。
- 不带编号引文 = 引号后没有编号。在材料里找得到记入 `unnumbered.found`（不算问题）；
  找不到只作提示记入 `unnumbered.hints`，不算问题（可能只是报告自己的概括或路径名）。
- 退出码只由带编号的 `missing` + `mismatched` 决定：0=通过，1=有问题。

输出 JSON：
{
  "checked": 引号总数,
  "ids_available": 材料里是否识别到了记录编号,
  "citations": {"checked": n, "ok": n, "missing": [{"line", "quote", "id", "ids"}], "mismatched": [...]},
  "unnumbered": {"checked": n, "found": n, "hints": [{"line", "quote"}]}
}
"""
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True

# 带编号：括号第一个词是编号，后面允许分隔的编号及说明文字。
SOURCE_ID = r'[A-Za-z]+[-_]?\d{2,}'
SEPARATOR = r'[\s、，,；;]'
NUMBERED = re.compile(
    rf'[“"「『]([^”"」』\n]{{6,400}})[”"」』]\s*[（(]\s*'
    rf'({SOURCE_ID}(?:{SEPARATOR}[^）)\n]*)?)[）)]'
)
class LeadingIDs:
    """Only the uninterrupted ID prefix belongs to the citation."""
    def findall(self, text):
        prefix = re.match(rf'{SOURCE_ID}(?:{SEPARATOR}+{SOURCE_ID})*(?=$|{SEPARATOR})', text)
        return re.findall(SOURCE_ID, prefix.group(0)) if prefix else []


IDS = LeadingIDs()
# 不带编号：任何引号内容
BARE = re.compile(r'[“"「『]([^”"」』\n]{6,400})[”"」』]')


def load_sources(paths):
    corpus, by_id = [], {}
    for p in map(Path, paths):
        text = p.read_text(encoding="utf-8")
        corpus.append(text)
        if p.suffix.lower() == ".json":
            try:
                data = json.loads(text)
            except ValueError:
                continue
            for rec in data if isinstance(data, list) else []:
                if not isinstance(rec, dict):
                    continue
                blob = " ".join(str(v) for v in rec.values() if isinstance(v, str))
                for k, v in rec.items():
                    if k.lower().endswith("id") and isinstance(v, str):
                        by_id.setdefault(v, []).append(blob)
    return "\n".join(corpus), by_id


def main():
    if "--kind" in sys.argv:
        import argparse
        from source_checks import check_quotes
        ap = argparse.ArgumentParser()
        ap.add_argument("report")
        ap.add_argument("sources", nargs="+")
        ap.add_argument("--kind", required=True)
        a = ap.parse_args()
        result = check_quotes(Path(a.report), [Path(p) for p in a.sources], a.kind)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(bool(result["citations"]["missing"] or result["citations"]["mismatched"]))
    report = Path(sys.argv[1])
    corpus, by_id = load_sources(sys.argv[2:])
    result = {
        "checked": 0,
        "ids_available": bool(by_id),
        "citations": {"checked": 0, "ok": 0, "missing": [], "mismatched": []},
        "unnumbered": {"checked": 0, "found": 0, "hints": []},
    }
    for no, line in enumerate(report.read_text(encoding="utf-8").splitlines(), 1):
        numbered = list(NUMBERED.finditer(line))
        numbered_starts = {m.start() for m in numbered}
        for m in numbered:
            quote = m.group(1)
            ids = IDS.findall(m.group(2))
            result["checked"] += 1
            result["citations"]["checked"] += 1
            item = {"line": no, "quote": quote, "id": ids[0], "ids": ids}
            if quote not in corpus:
                result["citations"]["missing"].append(item)
            elif by_id and not any(quote in blob for rid in ids for blob in by_id.get(rid, [])):
                result["citations"]["mismatched"].append(item)
            else:
                result["citations"]["ok"] += 1
        for m in BARE.finditer(line):
            if m.start() in numbered_starts:
                continue
            quote = m.group(1)
            result["checked"] += 1
            result["unnumbered"]["checked"] += 1
            if quote in corpus:
                result["unnumbered"]["found"] += 1
            else:
                result["unnumbered"]["hints"].append({"line": no, "quote": quote})
    print(json.dumps(result, ensure_ascii=False, indent=2))
    hard = result["citations"]["missing"] or result["citations"]["mismatched"]
    sys.exit(1 if hard else 0)


if __name__ == "__main__":
    main()
