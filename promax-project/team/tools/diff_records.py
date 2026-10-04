#!/usr/bin/env python3
"""变更清单：按记录编号对比新旧两份评分/记录 JSON，输出新增、删除、字段变化三类。

用法：python3 diff_records.py <旧材料JSON> <新材料JSON> <输出文件>
记录编号自动识别：每条记录中字段名以 id 结尾的第一个字符串字段（不区分大小写）。
输出文件为纯文本 Markdown；终端只打印总数。

例：python3 diff_records.py 附件/评分样本-v1.json 附件/评分样本-v2.json 交付/变更清单-v1-v2.txt
"""
import json
import sys
from pathlib import Path


def load(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit(f"{path} 不是记录数组")
    return data


def id_field(rec):
    ids = [k for k, v in rec.items() if k.lower().endswith("id") and isinstance(v, str)]
    if not ids:
        raise SystemExit("识别不到以 id 结尾的字段")
    return sorted(ids, key=len)[0]


def pick(rec):
    code = id_field(rec)
    return code, rec[code]


def fmt(value):
    s = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    s = " ".join(s.split())
    return s if len(s) <= 400 else s[:400] + "…"


def main():
    old_path, new_path, out_path = sys.argv[1:4]
    old, new = load(old_path), load(new_path)
    old_map, new_map = {}, {}
    for rec in old:
        k, v = pick(rec)
        old_map.setdefault(v, rec)
    for rec in new:
        k, v = pick(rec)
        new_map.setdefault(v, rec)

    added = [k for k in new_map if k not in old_map]
    removed = [k for k in old_map if k not in new_map]
    changes = []
    for k in new_map:
        if k not in old_map:
            continue
        o, n = old_map[k], new_map[k]
        code = id_field(n)
        for field in n:
            if field == code:
                continue
            if field in o and o[field] != n[field]:
                changes.append((k, field, o[field], n[field]))
        for field in o:
            if field != code and field not in n:
                changes.append((k, field, o[field], "<字段已删除>"))

    lines = [f"# 变更清单：{Path(old_path).name} → {Path(new_path).name}", "",
             f"- 旧材料：`{old_path}`（{len(old_map)} 条记录）",
             f"- 新材料：`{new_path}`（{len(new_map)} 条记录）", "",
             f"## 新增记录（{len(added)}）", ""]
    lines += [f"- {k}" for k in added] or ["- （无）"]
    lines += ["", f"## 删除记录（{len(removed)}）", ""]
    lines += [f"- {k}" for k in removed] or ["- （无）"]
    lines += ["", f"## 字段变化（{len(changes)}）", ""]
    lines += [f"- {k} · {f}：{fmt(a)} → {fmt(b)}" for k, f, a, b in changes] or ["- （无）"]
    Path(out_path).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"新增 {len(added)} · 删除 {len(removed)} · 字段变化 {len(changes)} → {out_path}")


if __name__ == "__main__":
    main()
