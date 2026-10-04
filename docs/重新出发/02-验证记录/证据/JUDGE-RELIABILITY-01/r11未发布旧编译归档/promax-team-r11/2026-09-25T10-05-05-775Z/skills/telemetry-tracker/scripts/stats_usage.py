#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stats_usage.py - 智能体/技能使用数据统计脚本

职责：
    从 SQLite 数据库读取使用记录，输出结构化文本统计结果，
    供 main 智能体在用户询问"使用情况"时组织成中文汇报。

支持的查询模式：
    --summary              总览（总调用、Agent/Skill TOP、按天趋势、活跃用户）
    --by-agent             按智能体维度统计
    --by-skill             按技能维度统计
    --daily --days N       近 N 天每日明细
    --since/--until        自定义日期区间

用法示例：
    python3 stats_usage.py --summary
    python3 stats_usage.py --by-agent --days 7
    python3 stats_usage.py --daily --days 14
    python3 stats_usage.py --summary --since 2026-06-01 --until 2026-06-24
"""

import argparse
import os
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta

DEFAULT_DB_PATH = os.path.expanduser("~/.openclaw/workspace/shared/telemetry/usage.db")


# ============================================================
# 连接
# ============================================================

def get_connection(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    if not os.path.exists(db_path):
        # 库不存在时打印友好提示而非崩溃
        print(f"[提示] 数据库尚未创建：{db_path}")
        print("[提示] 说明还没有任何使用记录。等智能体/技能被调用并完成首次埋点后，数据会自动生成。")
        raise SystemExit(0)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _build_where(args) -> tuple:
    """构造时间过滤 SQL 片段与参数。返回 (where_sql, params)。"""
    conditions = []
    params = []

    if args.since:
        conditions.append("created_at >= ?")
        params.append(f"{args.since}T00:00:00")

    if args.until:
        conditions.append("created_at <= ?")
        params.append(f"{args.until}T23:59:59")

    if args.days and not (args.since or args.until):
        cutoff = (datetime.now() - timedelta(days=args.days)).isoformat(timespec="seconds")
        conditions.append("created_at >= ?")
        params.append(cutoff)

    where_sql = (" WHERE " + " AND ".join(conditions)) if conditions else ""
    return where_sql, params


def _append_cond(where_sql: str, params: list, cond_sql: str) -> tuple:
    """
    在已有 WHERE 子句基础上追加一个条件。
    - 已有 WHERE：用 AND 拼接
    - 无 WHERE：以 WHERE 开头
    cond_sql 应为不含占位符的字面条件（如 "status='success'"）。
    """
    if where_sql:
        return where_sql + " AND " + cond_sql, params
    return " WHERE " + cond_sql, params


# ============================================================
# 各查询实现
# ============================================================

def query_summary(conn, args) -> None:
    where_sql, params = _build_where(args)

    # 总量按来源分口径统计，避免 hook（对话轮次）与 llm（能力调用）混算成虚高总数
    # 对话轮次：source='hook'（每条用户消息到达即记录一次，~100% 覆盖）
    hook_sql, hook_params = _append_cond(where_sql, params, "source='hook'")
    chat_turns = conn.execute(
        f"SELECT COUNT(*) AS c FROM usage_events{hook_sql}", hook_params
    ).fetchone()["c"]

    # 能力调用次数：source='llm' 且 event_type 为 agent/skill（智能体上报，70-90% 下限）
    capability_sql, capability_params = _append_cond(
        where_sql, params, "source='llm' AND event_type IN ('agent','skill')"
    )
    capability_calls = conn.execute(
        f"SELECT COUNT(*) AS c FROM usage_events{capability_sql}", capability_params
    ).fetchone()["c"]

    total = chat_turns + capability_calls

    # status 过滤需正确拼接 WHERE/AND，统一走 _append_cond 避免空 where 时语法错误
    success_sql, success_params = _append_cond(where_sql, params, "status='success'")
    success = conn.execute(
        f"SELECT COUNT(*) AS c FROM usage_events{success_sql}", success_params
    ).fetchone()["c"]
    # 失败数仍以全表为分母（含所有来源），反映系统稳定性
    full_total = conn.execute(
        f"SELECT COUNT(*) AS c FROM usage_events{where_sql}", params
    ).fetchone()["c"]
    fail = full_total - success

    # 按 event_type 分布
    type_rows = conn.execute(
        f"""
        SELECT event_type, COUNT(*) AS c, COUNT(DISTINCT user_id) AS users
        FROM usage_events{where_sql}
        GROUP BY event_type ORDER BY c DESC
        """,
        params,
    ).fetchall()

    # 活跃目标 TOP10（仅 agent + skill，排除 chat 的 target_name='-' 对话轮次）
    top_sql, top_params = _append_cond(where_sql, params, "event_type IN ('agent','skill')")
    top_rows = conn.execute(
        f"""
        SELECT target_name, target_label, event_type, COUNT(*) AS c,
               COUNT(DISTINCT user_id) AS users,
               MAX(created_at) AS last_at
        FROM usage_events{top_sql}
        GROUP BY target_name
        ORDER BY c DESC
        LIMIT 10
        """,
        top_params,
    ).fetchall()

    # 按天趋势
    daily_rows = conn.execute(
        f"""
        SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c
        FROM usage_events{where_sql}
        GROUP BY day ORDER BY day
        """,
        params,
    ).fetchall()

    # 活跃用户 TOP10（按 user_id 去重，匿名用户单独成行）
    user_rows = conn.execute(
        f"""
        SELECT user_id, user_name, COUNT(*) AS c, MAX(created_at) AS last_at
        FROM usage_events{where_sql}
        GROUP BY user_id ORDER BY c DESC LIMIT 10
        """,
        params,
    ).fetchall()

    # ---- 输出 ----
    print("=" * 56)
    print("📊 使用情况总览")
    print("=" * 56)
    print(f"统计区间：{_range_label(args)}")
    # 双口径：对话轮次（hook 确定性）+ 能力调用（智能体上报下限），不相加为虚高总数
    print(f"对话轮次（hook 采集）：{chat_turns}")
    print(f"能力调用（智能体上报）：{capability_calls}")
    print(f"  —— 两者为不同口径，不简单相加；成功 {success}，失败 {fail}")
    print()
    print("口径说明：对话轮次由 message:received 钩子确定性采集（~100%）；")
    print("         能力调用由智能体轮末上报（覆盖率 70-90%，为下限值）。")
    print()

    print("【按类型分布】")
    for r in type_rows:
        label = {"agent": "智能体", "skill": "技能", "chat": "普通对话"}.get(r["event_type"], r["event_type"])
        print(f"  - {label}：{r['c']} 次，涉及 {r['users']} 位用户")
    print()

    print("【最常使用的能力 TOP10】")
    if not top_rows:
        print("  （暂无数据）")
    else:
        for i, r in enumerate(top_rows, 1):
            label = r["target_label"] or r["target_name"]
            print(f"  {i:2d}. {label}（{r['target_name']}）"
                  f"  {r['c']} 次 / {r['users']} 人 / 最近 {r['last_at']}")
    print()

    print("【活跃用户 TOP10】")
    if not user_rows:
        print("  （暂无数据）")
    else:
        for i, r in enumerate(user_rows, 1):
            # 匿名用户（anon-xxx）显示脱敏，已知用户显示姓名
            is_anon = r["user_id"].startswith("anon-") if r["user_id"] else False
            tag = "（匿名）" if is_anon else ""
            # GROUP BY user_id 后，user_name 取该 user_id 下任一非空姓名（库内已归一）
            display_name = r["user_name"] or r["user_id"]
            print(f"  {i:2d}. {display_name}{tag}  {r['c']} 次 / 最近 {r['last_at']}")
    print()

    print("【每日趋势】")
    if not daily_rows:
        print("  （暂无数据）")
    else:
        max_c = max(d["c"] for d in daily_rows) or 1
        for d in daily_rows:
            bar_len = max(1, int(d["c"] / max_c * 30))
            print(f"  {d['day']}  {'█' * bar_len} {d['c']}")


def query_by_target(conn, args, event_type: str) -> None:
    where_sql, params = _build_where(args)
    rows = conn.execute(
        f"""
        SELECT target_name, target_label, COUNT(*) AS c,
               COUNT(DISTINCT user_id) AS users,
               MIN(created_at) AS first_at,
               MAX(created_at) AS last_at
        FROM usage_events{where_sql}{' AND' if where_sql else ' WHERE'} event_type=?
        GROUP BY target_name ORDER BY c DESC
        """,
        params + [event_type],
    ).fetchall()

    title = "智能体" if event_type == "agent" else "技能"
    print("=" * 56)
    print(f"📈 按{title}维度统计")
    print("=" * 56)
    print(f"统计区间：{_range_label(args)}")
    print()

    if not rows:
        print(f"（暂无{title}调用数据）")
        return

    print(f"{'名称':<28}{'调用次数':>8}{'用户数':>8}  最近调用")
    print("-" * 72)
    for r in rows:
        label = r["target_label"] or r["target_name"]
        name_display = f"{label}({r['target_name']})"
        if len(name_display) > 26:
            name_display = name_display[:24] + ".."
        print(f"{name_display:<28}{r['c']:>8}{r['users']:>8}  {r['last_at']}")


def query_daily(conn, args) -> None:
    where_sql, params = _build_where(args)
    rows = conn.execute(
        f"""
        SELECT substr(created_at, 1, 10) AS day,
               event_type,
               COUNT(*) AS c
        FROM usage_events{where_sql}
        GROUP BY day, event_type ORDER BY day
        """,
        params,
    ).fetchall()

    print("=" * 56)
    print("📅 每日明细")
    print("=" * 56)
    print(f"统计区间：{_range_label(args)}")
    print()

    if not rows:
        print("（暂无数据）")
        return

    # 按天聚合
    daily_map = defaultdict(lambda: {"agent": 0, "skill": 0, "chat": 0, "total": 0})
    for r in rows:
        daily_map[r["day"]][r["event_type"]] = r["c"]
        daily_map[r["day"]]["total"] += r["c"]

    print(f"{'日期':<14}{'智能体':>8}{'技能':>8}{'对话':>8}{'合计':>8}")
    print("-" * 50)
    for day in sorted(daily_map.keys()):
        d = daily_map[day]
        print(f"{day:<14}{d['agent']:>8}{d['skill']:>8}{d['chat']:>8}{d['total']:>8}")


# ============================================================
# 辅助
# ============================================================

def _range_label(args) -> str:
    if args.since and args.until:
        return f"{args.since} ~ {args.until}"
    if args.since:
        return f"{args.since} 至今"
    if args.until:
        return f"截至 {args.until}"
    if args.days:
        return f"近 {args.days} 天"
    return "全部历史"


def query_export(conn, args) -> None:
    """导出原始明细为 JSONL，便于进一步分析。"""
    import json
    where_sql, params = _build_where(args)
    rows = conn.execute(
        f"""
        SELECT event_type, target_name, target_label, user_query, user_id, user_name,
               invoke_count, turn_no, output_files, status, source, created_at
        FROM usage_events{where_sql}
        ORDER BY created_at DESC
        """,
        params,
    ).fetchall()
    out_path = os.path.abspath(args.export)
    with open(out_path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(dict(r), ensure_ascii=False) + "\n")
    print(f"已导出 {len(rows)} 条记录到：{out_path}")


# ============================================================
# 入口
# ============================================================

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stats_usage.py",
        description="智能体/技能使用数据统计。读取使用记录库，输出结构化文本，供 main 智能体汇报使用。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_argument_group("查询模式（至少选一个）")
    mode.add_argument("--summary", action="store_true", help="总览：总调用、TOP 能力、趋势、活跃用户")
    mode.add_argument("--by-agent", action="store_true", help="按智能体维度统计")
    mode.add_argument("--by-skill", action="store_true", help="按技能维度统计")
    mode.add_argument("--daily", action="store_true", help="每日明细")
    mode.add_argument("--export", metavar="PATH", help="导出原始明细为 JSONL 文件")

    rng = parser.add_argument_group("时间区间（可选，默认全部历史）")
    rng.add_argument("--days", type=int, help="统计近 N 天")
    rng.add_argument("--since", help="起始日期 YYYY-MM-DD")
    rng.add_argument("--until", help="结束日期 YYYY-MM-DD")
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH, help=argparse.SUPPRESS)
    return parser


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)

    has_mode = any([args.summary, args.by_agent, args.by_skill, args.daily, args.export])
    if not has_mode:
        build_arg_parser().print_help()
        return 1

    conn = get_connection(args.db_path)
    try:
        if args.export:
            query_export(conn, args)
            return 0
        if args.summary:
            query_summary(conn, args)
        if args.by_agent:
            query_by_target(conn, args, "agent")
        if args.by_skill:
            query_by_target(conn, args, "skill")
        if args.daily:
            query_daily(conn, args)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
