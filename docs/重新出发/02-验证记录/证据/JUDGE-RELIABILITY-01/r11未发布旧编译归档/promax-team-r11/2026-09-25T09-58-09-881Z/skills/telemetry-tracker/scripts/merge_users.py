#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
merge_users.py - 历史用户身份碎片合并脚本

职责：
    治理历史 usage_events 库中同一真实用户的多条碎片记录（ou_xxx + anon-<sessionKey哈希>
    + anon-<uuid> + unknown），把它们归并到统一的规范身份，使按 user_id 的统计准确。

为什么需要它：
    track_usage.py 现已做写入时归一化（normalize_identity），从源头减少新碎片。
    但库里已有的历史碎片需要一次性治理，本脚本负责这件事。

判定规则（与 track_usage.normalize_identity 完全一致，请勿分叉）：
    1. 真实渠道用户标识（前缀 ou_/wo_/wm_/on_/u_）= 权威身份
    2. anon- 系列若其 session_key 能解析出真实渠道标识 -> 归并到该真实 ID
    3. 解析不出真实身份的 anon -> 保留不强行合并（避免误并不同匿名用户）
    4. unknown -> 不与任何合并（来源不可信）

安全约束：
    - 默认 --dry-run，仅打印映射，不改库
    - 必须 --apply 才执行实际合并
    - 执行前自动备份库到 <db>.backup-YYYYMMDDHHMMSS
    - 全程单事务，任何异常回滚
    - 幂等：重复执行对已合并库不产生新变化

用法：
    # 预览将要合并的映射（不修改数据库）
    python3 merge_users.py --dry-run

    # 执行合并（先自动备份）
    python3 merge_users.py --apply

    # 指定数据库路径
    python3 merge_users.py --apply --db-path /path/to/usage.db
"""

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime

# 复用 track_usage.py 的归一逻辑，确保历史合并与写入时归一化规则一致
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
from track_usage import (  # noqa: E402
    parse_identity,
    _looks_like_real_user_id,
    REAL_USER_ID_PREFIXES,
)

DEFAULT_DB_PATH = os.path.expanduser("~/.openclaw/workspace/shared/telemetry/usage.db")


# ============================================================
# 合并映射构建
# ============================================================

def build_merge_map(conn: sqlite3.Connection) -> dict:
    """
    扫描全表，构建"待合并 user_id -> 规范 user_id"的映射。

    返回 dict，键为需要被改写的原 user_id（如 anon-xxx），值为目标规范 user_id（如 ou_yyy）。
    已经是规范身份的 user_id 不会出现在键里。

    算法：
      a) 收集所有真实渠道 ID（前缀 ou_/wo_/...），建立"已存在的真实身份集合"
      b) 遍历所有非真实身份的 user_id（anon-xxx）：
         - 从其 session_key 解析候选真实 ID
         - 若候选真实 ID 确实存在于库中（或虽不存在但符合真实前缀），归并到它
         - 否则保留
      c) unknown / 解析不出的 anon 不进映射
    """
    # a) 收集库内所有出现过的真实渠道身份
    real_ids = set()
    anon_rows = []  # [(user_id, session_key, name), ...]
    for r in conn.execute(
        "SELECT DISTINCT user_id, session_key, user_name FROM usage_events"
    ).fetchall():
        uid = r["user_id"] or ""
        if not uid:
            continue
        if uid.startswith("anon-"):
            anon_rows.append((uid, r["session_key"] or "", r["user_name"] or ""))
        elif uid.startswith(REAL_USER_ID_PREFIXES):
            real_ids.add(uid)
        # unknown 与其他自定义 ID 不参与合并

    # b) 为每个 anon user_id 计算目标真实身份
    merge_map: dict[str, str] = {}
    for anon_uid, session_key, _name in anon_rows:
        if not session_key:
            continue
        identity = parse_identity(session_key)
        candidate = identity.get("user_id", "")
        # 候选必须是真实渠道标识；且最好库内已存在该真实身份（更稳妥）
        # 若候选符合真实前缀但库内尚无该真实身份行，仍允许归并（合并后即存在）
        if candidate and _looks_like_real_user_id(candidate):
            merge_map[anon_uid] = candidate

    return merge_map


# ============================================================
# 合并执行
# ============================================================

def apply_merge(conn: sqlite3.Connection, merge_map: dict) -> dict:
    """
    在单事务内执行合并：把 merge_map 中的原 user_id 改写为目标 user_id，
    并合并 user_name（保留真实 ID 下已有的非"匿名用户"姓名）。

    返回统计 {total_updated, target_users}。
    任何异常由调用方捕获并回滚。
    """
    total_updated = 0
    affected_targets = set()

    for src_uid, dst_uid in merge_map.items():
        # 1. 确定合并后的 user_name：优先用目标真实 ID 已有的非匿名姓名
        name_row = conn.execute(
            "SELECT user_name FROM usage_events "
            "WHERE user_id = ? AND user_name NOT IN ('', '匿名用户') "
            "LIMIT 1",
            (dst_uid,),
        ).fetchone()
        dst_name = name_row["user_name"] if name_row else dst_uid

        # 2. 更新所有碎片行的 user_id 和 user_name
        cur = conn.execute(
            "UPDATE usage_events SET user_id = ?, user_name = ? WHERE user_id = ?",
            (dst_uid, dst_name, src_uid),
        )
        if cur.rowcount > 0:
            total_updated += cur.rowcount
            affected_targets.add(dst_uid)

    conn.commit()
    return {"total_updated": total_updated, "target_users": len(affected_targets)}


# ============================================================
# 备份
# ============================================================

def backup_database(db_path: str, backup_dir: str) -> str:
    """
    复制数据库到备份目录，文件名 usage.db.backup-YYYYMMDDHHMMSS。
    同时复制 WAL/SHM 文件（若存在），保证备份一致性。
    返回备份文件主路径。
    """
    os.makedirs(backup_dir, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    backup_main = os.path.join(
        backup_dir,
        f"{os.path.basename(db_path)}.backup-{ts}",
    )
    shutil.copy2(db_path, backup_main)

    # 尽力复制 WAL/SHM（不存在则跳过）
    for suffix in ("-wal", "-shm"):
        sidecar = db_path + suffix
        if os.path.exists(sidecar):
            shutil.copy2(sidecar, backup_main + suffix)

    return backup_main


# ============================================================
# 报告输出
# ============================================================

def print_report(merge_map: dict, conn: sqlite3.Connection) -> None:
    """以人类可读格式打印合并映射，含每个 anon->真实ID 的记录条数。"""
    print("=" * 56)
    print("🧹 用户身份碎片合并预览（dry-run，未修改数据库）")
    print("=" * 56)
    print(f"待合并的碎片 user_id 数：{len(merge_map)}")
    print()

    if not merge_map:
        print("（库中无需合并的碎片，或已全部归一化）")
        return

    print(f"{'匿名碎片':<24}{'归并目标':<32}{'条数':>6}")
    print("-" * 64)
    for src_uid, dst_uid in sorted(merge_map.items()):
        # 统计该碎片有多少条记录将被合并
        row = conn.execute(
            "SELECT COUNT(*) AS c, MAX(user_name) AS n FROM usage_events WHERE user_id = ?",
            (src_uid,),
        ).fetchone()
        count = row["c"] if row else 0
        name = row["n"] if row and row["n"] and row["n"] != "匿名用户" else ""
        target_disp = f"{dst_uid}({name})" if name else dst_uid
        print(f"{src_uid:<24}{target_disp:<32}{count:>6}")

    # 合并前后用户数对比
    distinct_before = conn.execute(
        "SELECT COUNT(DISTINCT user_id) AS c FROM usage_events"
    ).fetchone()["c"]
    distinct_after = distinct_before - len(merge_map)
    print()
    print(f"合并前 distinct user_id：{distinct_before}")
    print(f"合并后预计 distinct user_id：{distinct_after}（减少 {len(merge_map)}）")
    print()
    print("如确认无误，请用 --apply 执行实际合并。")


# ============================================================
# 入口
# ============================================================

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="merge_users.py",
        description="历史用户身份碎片合并。把同一真实用户的 anon-xxx 碎片归并到规范渠道 ID。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="仅预览合并映射，不修改数据库（默认推荐先跑）")
    mode.add_argument("--apply", action="store_true", help="执行实际合并（执行前自动备份数据库）")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH, help=f"数据库路径（默认 {DEFAULT_DB_PATH}）")
    parser.add_argument(
        "--backup-dir",
        default="",
        help="备份目录（默认与数据库同目录）。仅 --apply 时生效",
    )
    return parser


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)

    if not os.path.exists(args.db_path):
        print(f"[错误] 数据库不存在：{args.db_path}")
        print("[提示] 还没有任何使用记录，无需合并。")
        return 1

    conn = sqlite3.connect(args.db_path)
    conn.row_factory = sqlite3.Row
    try:
        merge_map = build_merge_map(conn)

        if args.dry_run:
            print_report(merge_map, conn)
            return 0

        # --apply 分支
        if not merge_map:
            print("库中无需合并的碎片，已是最优状态，跳过。")
            return 0

        # 执行前自动备份
        backup_dir = args.backup_dir or os.path.dirname(os.path.abspath(args.db_path))
        backup_path = backup_database(args.db_path, backup_dir)
        print(f"[备份] 已备份数据库到：{backup_path}")

        try:
            stats = apply_merge(conn, merge_map)
        except Exception as e:
            # 合并过程异常：事务已由 sqlite3 自动回滚（未 commit）
            print(f"[错误] 合并过程异常，已回滚，数据库未被修改：{e}")
            return 1

        print("=" * 56)
        print("✅ 用户身份碎片合并完成")
        print("=" * 56)
        print(f"已更新记录数：{stats['total_updated']}")
        print(f"涉及规范用户数：{stats['target_users']}")
        print(f"备份文件：{backup_path}")
        print()
        print("提示：合并是幂等的，重复执行不会产生新变化。")
        print("      若需回滚，可用备份文件覆盖 usage.db。")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
