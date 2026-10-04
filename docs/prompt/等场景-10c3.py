#!/usr/bin/env python3
"""10c-3 B 组：阻塞等待场景结束（给 pi 的 bash 工具用，Claude 2026-09-30）。

为什么需要：调度脚本用 `pi -p` 启动 Sol。Sol 一旦结束回合，pi 就关闭会话，
后台任务插件会在关闭时杀掉还在跑的任务。所以有场景在跑时不能「结束回合等通知」，
要用本脚本在一次 bash 调用里等。

用法：
  python3 docs/prompt/等场景-10c3.py --label 10c3b1 [--max-seconds 600] <运行目录> [<运行目录> ...]

行为：
  - 运行目录里出现可解析的 timing-<标签>.json 即视为该场景已结束。
  - 开始时还没结束的目录中，任何一个结束 → 立即返回（reason=finished）。
  - 开始时全部已结束 → 立即返回（reason=all_done）。
  - 到 --max-seconds 仍无新结束 → 返回（reason=timeout），再调用一次继续等。
  - 只读，不启动、不停止任何进程；退出码恒为 0（参数错误为 2）。
输出：一行 JSON，含每个目录的 done / exit_code / seconds。
"""
import argparse
import json
import sys
import time
from pathlib import Path


def read_timing(run_dir: Path, label: str):
    path = run_dir / f"timing-{label}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None  # 不存在，或正在写入
    return data if isinstance(data, dict) else None


def snapshot(dirs, label):
    rows = []
    for d in dirs:
        t = read_timing(d, label)
        rows.append({
            "run": d.name,
            "done": t is not None,
            "exit_code": None if t is None else t.get("exit_code"),
            "seconds": None if t is None else t.get("seconds"),
        })
    return rows


def main():
    ap = argparse.ArgumentParser(description="阻塞等待场景结束")
    ap.add_argument("--label", required=True, help="运行标签，例如 10c3b1")
    ap.add_argument("--max-seconds", type=int, default=600, help="单次最长等待秒数（默认 600）")
    ap.add_argument("--interval", type=float, default=5.0, help="检查间隔秒数（默认 5）")
    ap.add_argument("runs", nargs="+", help="运行目录")
    args = ap.parse_args()

    dirs = [Path(r) for r in args.runs]
    missing = [str(d) for d in dirs if not d.is_dir()]
    if missing:
        print(json.dumps({"error": "运行目录不存在", "missing": missing}, ensure_ascii=False))
        return 2

    start = time.monotonic()
    first = snapshot(dirs, args.label)
    pending = {r["run"] for r in first if not r["done"]}
    if not pending:
        print(json.dumps({"reason": "all_done", "waited_seconds": 0, "newly_done": [], "runs": first}, ensure_ascii=False))
        return 0

    while True:
        rows = snapshot(dirs, args.label)
        newly = [r["run"] for r in rows if r["done"] and r["run"] in pending]
        waited = round(time.monotonic() - start, 1)
        if newly:
            print(json.dumps({"reason": "finished", "waited_seconds": waited, "newly_done": newly, "runs": rows}, ensure_ascii=False))
            return 0
        if waited >= args.max_seconds:
            print(json.dumps({"reason": "timeout", "waited_seconds": waited, "newly_done": [], "runs": rows}, ensure_ascii=False))
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
