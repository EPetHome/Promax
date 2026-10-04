#!/usr/bin/env python3
"""正式保存：把报告存成新版本并返回回执。只有回执 status=saved 才算交付完成。

用法：python3 tools/save.py <报告.md>
产物：交付/版本/v<N>-<文件名>、交付/保存记录.jsonl；回执 JSON 打印到 stdout。
"""
import datetime
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'judge/tools'))
from group_checks import accepted_check, append_flow, flow_counts, flow_for_file, flow_rows, save_check

ROOT = Path("交付")


def main():
    src = Path(sys.argv[1])
    receipt = {"file": str(src), "status": "failed"}
    try:
        data = src.read_bytes()
        if not data.strip():
            raise ValueError("报告为空")
        versions = ROOT / "版本"
        versions.mkdir(parents=True, exist_ok=True)
        n = len(list(versions.glob(f"v*-{src.name}"))) + 1
        dest = versions / f"v{n}-{src.name}"
        dest.write_bytes(data)
        if dest.read_bytes() != data:
            raise IOError("写入后回读不一致")
        receipt.update(
            status="saved",
            version=n,
            path=str(dest),
            sha256=hashlib.sha256(data).hexdigest(),
            chars=len(data.decode("utf-8")),
            saved_at=datetime.datetime.now().isoformat(timespec="seconds"),
        )
    except Exception as e:  # 失败也要有回执，不能让模型猜
        receipt["error"] = f"{type(e).__name__}: {e}"
    receipt['检查'] = save_check(src, receipt.get('sha256'))
    if receipt['检查'] is None:
        receipt['检查说明'] = '本文件没有已接受的检查记录'
    check = accepted_check(src)
    directory, ledger, last = check if check else (None, None, {})
    pending = flow_for_file(src)
    group = directory.name if directory else pending.get('group')
    previous = pending.get('previous', last.get('previous', []))
    counts = ({key: receipt['检查'][key] for key in ('business_revisions', 'draft_rejections')}
              if receipt['检查'] else flow_counts(flow_rows(), group, previous))
    append_flow(group, last.get('round', pending.get('round')), 'save', last.get('verdict'), previous,
                {str(src): receipt['sha256']} if receipt.get('sha256') else {},
                status=receipt['status'], file=str(src), path=receipt.get('path'), **counts)
    ROOT.mkdir(exist_ok=True)
    with (ROOT / "保存记录.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(receipt, ensure_ascii=False) + "\n")
    print(json.dumps(receipt, ensure_ascii=False))
    sys.exit(0 if receipt["status"] == "saved" else 1)


if __name__ == "__main__":
    main()
