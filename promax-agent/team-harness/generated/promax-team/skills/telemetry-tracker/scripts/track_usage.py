#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
track_usage.py - 智能体/技能使用数据上报脚本

职责：
    将一次 Agent / Skill / 普通对话的使用记录写入 SQLite 数据库。
    供各智能体 AGENTS.md 和技能 SKILL.md 的「使用埋点」规则隐式调用。

设计要点：
    - 数据库默认放在 ~/.openclaw/workspace/shared/telemetry/usage.db
      （跨 Agent 共享区，绕开各子 Agent workspace 隔离）
    - 首次运行自动建库建表，幂等可重复执行
    - SQLite 开启 WAL 模式 + busy_timeout，缓解多 Agent 并发写锁
    - 写入失败自动追加到同目录 failed_events.jsonl，绝不丢失、绝不向用户报错
    - user_name 为空时用 user_id 兜底，两者皆空填 unknown
    - user_query 自动截断到 500 字

用法：
    python3 track_usage.py \
        --event-type agent \
        --target-name product_discovery \
        --target-label "产品探索智能体" \
        --user-query "帮我做腾讯 WorkBuddy 竞品分析" \
        --user-id zhangsan \
        --user-name "张三"

    # 普通对话（未触发任何 Agent/Skill）
    python3 track_usage.py --event-type chat --target-name "-"
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime

# ============================================================
# 路径常量
# ============================================================

# 跨 Agent 共享的数据目录（OpenClaw workspace 约定的 shared 公共区）
DEFAULT_DB_DIR = os.path.expanduser("~/.openclaw/workspace/shared/telemetry")
DEFAULT_DB_PATH = os.path.join(DEFAULT_DB_DIR, "usage.db")
FAILED_LOG_PATH = os.path.join(DEFAULT_DB_DIR, "failed_events.jsonl")

# user_query 最大保留长度，避免单条记录过大
MAX_QUERY_LEN = 500


# ============================================================
# 数据库初始化（幂等）
# ============================================================

def get_connection(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """获取数据库连接，首次运行自动建库建表、开 WAL、设超时。"""
    db_dir = os.path.dirname(db_path)
    os.makedirs(db_dir, exist_ok=True)

    conn = sqlite3.connect(db_path, timeout=5.0)
    # 开启 WAL：多读单写，显著降低并发写锁冲突
    conn.execute("PRAGMA journal_mode=WAL")
    # 写入遇锁时等待 5 秒而非立即报错
    conn.execute("PRAGMA busy_timeout=5000")
    conn.row_factory = sqlite3.Row

    _init_schema(conn)
    # 自动回灌之前失败的兜底记录（建表成功后立即补回统计）
    try:
        _replay_fallback(conn, db_path)
    except Exception:
        # 回灌失败不影响主流程
        pass
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    """建表 + 建索引，IF NOT EXISTS 保证幂等；并对旧库做自动迁移（加 session_key 列）。"""
    # ---- 1. 建表（新库直接建成最新结构）----
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS usage_events (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type    TEXT    NOT NULL,   -- agent / skill / chat
            target_name   TEXT    NOT NULL,   -- 智能体或技能 ID
            target_label  TEXT,               -- 中文名，便于汇报展示
            user_query    TEXT,               -- 用户原始输入（已截断）
            user_id       TEXT,               -- 渠道用户标识（如 ou_xxx / wo_xxx）
            user_name     TEXT,               -- 真实姓名；取不到则回退 user_id / unknown
            session_key   TEXT,               -- 完整会话标识（如 agent:main:wecom:direct:wo_xxx）
            invoke_count  INTEGER DEFAULT 1,  -- 本次触发子调用次数
            turn_no       INTEGER DEFAULT 1,  -- 交互轮次（已弃用，恒为 1）
            output_files  TEXT,               -- 产出文件链接，JSON 数组字符串
            status        TEXT    DEFAULT 'success',  -- success / failed
            source        TEXT    DEFAULT 'llm',      -- 数据来源：llm（智能体上报）/ hook（消息到达钩子）
            created_at    TEXT    NOT NULL    -- 上报时间 ISO 格式
        )
        """
    )

    # ---- 2. 自动迁移：旧库补列（幂等，每列独立判断后统一建索引）----
    cols = [r[1] for r in conn.execute("PRAGMA table_info(usage_events)").fetchall()]
    if "session_key" not in cols:
        conn.execute("ALTER TABLE usage_events ADD COLUMN session_key TEXT")
    if "source" not in cols:
        conn.execute("ALTER TABLE usage_events ADD COLUMN source TEXT DEFAULT 'llm'")

    # ---- 3. 建索引（迁移完成后，确保列都存在再建索引）----
    conn.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_name ON usage_events(target_name);
        CREATE INDEX IF NOT EXISTS idx_type ON usage_events(event_type);
        CREATE INDEX IF NOT EXISTS idx_time ON usage_events(created_at);
        CREATE INDEX IF NOT EXISTS idx_user ON usage_events(user_id);
        CREATE INDEX IF NOT EXISTS idx_session ON usage_events(session_key);
        """
    )
    conn.commit()


def parse_identity(session_key: str) -> dict:
    """
    从 sessionKey 中解析渠道与用户标识（渠道无关）。

    OpenClaw 的 sessionKey 统一格式为：agent:<agentId>:<渠道>:<chatType>:<用户标识>
    示例：
      agent:main:feishu:direct:ou_00beb6896485dbac9c92249d87a04534
      agent:main:wecom:direct:wo1rsbeqaaua2k6c03rsqzhwk7uhejqg

    返回 {"channel": ..., "user_id": ..., "raw": session_key}。
    解析失败时 channel 与 user_id 为空字符串。
    """
    if not session_key:
        return {"channel": "", "user_id": "", "raw": ""}
    parts = session_key.split(":")
    # 期望格式 agent:<agentId>:<channel>:<chatType>:<userId>
    if len(parts) >= 5:
        return {"channel": parts[2], "user_id": parts[4], "raw": session_key}
    return {"channel": "", "user_id": "", "raw": session_key}


def resolve_anon_id(session_key: str = "", anon_id: str = "") -> str:
    """
    生成匿名用户标识（当拿不到真实 user_id 时使用）。

    优先级：
      1. 调用方显式传入 anon_id -> 直接复用（同一会话内稳定）
      2. 有 session_key -> 用其短哈希（同一会话稳定，可聚合）
      3. 都没有 -> 随机 anon-uuid（每条独立，至少计入次数）

    返回形如 anon-3f2a1b 或 anon-<uuid> 的字符串。
    """
    if anon_id:
        return anon_id if anon_id.startswith("anon-") else f"anon-{anon_id}"
    if session_key:
        digest = hashlib.md5(session_key.encode("utf-8")).hexdigest()[:6]
        return f"anon-{digest}"
    return f"anon-{uuid.uuid4().hex[:8]}"


# 已知渠道用户标识前缀（飞书 ou_ / 企业微信 wo_ 等真实用户 ID）。
# session_key 末段只有匹配这些前缀，才视为真实身份；否则视为匿名。
# 显式通过 --user-id 传入的不受此限制（调用方保证其真实性）。
REAL_USER_ID_PREFIXES = ("ou_", "wo_", "wm_", "on_", "u_")

# 非渠道前缀但显式传入时视为真实的命名约定（调用方自定义的稳定 ID）。
# 这里不穷举，只做宽松判断：调用方显式传 --user-id 时直接信任。


def _looks_like_real_user_id(candidate: str) -> bool:
    """判断从 session_key 解析出的 user_id 是否像真实渠道用户标识。

    仅对 session_key 解析结果生效；显式 --user_id 由调用方保证，无需校验。
    真实渠道用户标识有固定前缀（ou_/wo_ 等），webchat 等渠道的随机串不匹配。
    """
    if not candidate:
        return False
    return candidate.startswith(REAL_USER_ID_PREFIXES)


def normalize_identity(
    user_id: str,
    session_key: str = "",
    anon_id: str = "",
) -> str:
    """
    身份归一化（治本）：避免同一真实用户在库中产生 ou_xxx 与 anon-xxx 两套碎片记录。

    归一规则（与 merge_users.py 历史合并脚本保持一致）：
        1. user_id 已是真实渠道用户标识（ou_/wo_/wm_/on_/u_ 前缀）-> 原样返回
        2. user_id 为空或 anon- 系列，但能从 session_key 解析出真实渠道标识 -> 用真实 ID
        3. 仍拿不到真实身份 -> 返回匿名 ID（anon-xxx），保证至少计入次数

    本函数供 record_event 写入时调用，从源头减少新碎片；
    merge_users.py 负责治理历史库中已存在的碎片。
    """
    # 已是真实身份：直接返回（含调用方显式传入的非前缀命名 ID 也信任）
    if user_id and not user_id.startswith("anon-"):
        return user_id

    # 尝试从 session_key 解析真实渠道标识
    real_id = ""
    if session_key:
        identity = parse_identity(session_key)
        candidate = identity.get("user_id", "")
        if candidate and _looks_like_real_user_id(candidate):
            real_id = candidate

    if real_id:
        return real_id

    # 仍无真实身份：生成稳定匿名 ID（同 session_key 稳定聚合）
    return resolve_anon_id(session_key=session_key, anon_id=anon_id)


# ============================================================
# 核心写入逻辑
# ============================================================

def record_event(
    event_type: str,
    target_name: str,
    target_label: str = "",
    user_query: str = "",
    user_id: str = "",
    user_name: str = "",
    session_key: str = "",
    anon_id: str = "",
    invoke_count: int = 1,
    turn_no: int = 1,
    output_files=None,
    status: str = "success",
    source: str = "llm",
    db_path: str = DEFAULT_DB_PATH,
) -> bool:
    """
    写入一条使用记录。

    source：数据来源标记。llm=智能体轮末上报（能力调用），hook=message:received 钩子上报（对话轮次）。
            用于 stats_usage 双口径统计，避免重复计数。

    身份解析优先级（尽力获取，缺失也正常埋点）：
        1. 显式传入的 user_id 非空 -> 直接用（已知用户）
        2. 否则从 session_key 解析出渠道用户标识（ou_xxx / wo_xxx 等）
        3. 都拿不到 -> 生成匿名 ID（anon-xxx），保证匿名访问也能计入人数
           - 有 session_key -> 用其短哈希（同一会话稳定聚合）
           - 都没有 -> 随机 anon-uuid（至少计入次数）

    姓名兜底链路：
        user_name 非空 -> 直接用
        user_name 空   -> 用 user_id
        两者皆空       -> 填 "匿名用户"

    返回 True 表示成功落库，False 表示失败（已写本地兜底日志）。
    """
    # ---- 字段清洗 ----
    event_type = (event_type or "chat").strip().lower()
    target_name = (target_name or "-").strip() or "-"

    # 身份解析 + 归一化：显式真实 user_id 优先；否则从 session_key 解析真实渠道标识；
    # 都拿不到则匿名。统一走 normalize_identity，与 merge_users.py 保持一致，
    # 避免同一真实用户在库中产生 ou_xxx 与 anon-xxx 两套碎片。
    user_id = normalize_identity(user_id, session_key=session_key, anon_id=anon_id)

    # 姓名兜底：有真实身份用 user_id，否则标记为匿名用户
    if not user_name:
        user_name = user_id if not user_id.startswith("anon-") else "匿名用户"

    # query 截断
    if user_query and len(user_query) > MAX_QUERY_LEN:
        user_query = user_query[:MAX_QUERY_LEN]

    # output_files 统一存 JSON 数组字符串
    if output_files is None:
        output_files_json = ""
    elif isinstance(output_files, (list, tuple)):
        output_files_json = json.dumps(list(output_files), ensure_ascii=False)
    else:
        # 已是字符串则原样保留
        output_files_json = str(output_files)

    created_at = datetime.now().isoformat(timespec="seconds")

    row = {
        "event_type": event_type,
        "target_name": target_name,
        "target_label": target_label,
        "user_query": user_query,
        "user_id": user_id,
        "user_name": user_name,
        "session_key": session_key,
        "invoke_count": int(invoke_count) if invoke_count else 1,
        "turn_no": int(turn_no) if turn_no else 1,
        "output_files": output_files_json,
        "status": status or "success",
        "source": (source or "llm").strip().lower(),
        "created_at": created_at,
    }

    # ---- 尝试写入数据库 ----
    try:
        conn = get_connection(db_path)
        try:
            conn.execute(
                """
                INSERT INTO usage_events
                    (event_type, target_name, target_label, user_query, user_id,
                     user_name, session_key, invoke_count, turn_no, output_files, status, source, created_at)
                VALUES
                    (:event_type, :target_name, :target_label, :user_query, :user_id,
                     :user_name, :session_key, :invoke_count, :turn_no, :output_files, :status, :source, :created_at)
                """,
                row,
            )
            conn.commit()
            return True
        finally:
            conn.close()
    except Exception:
        # ---- 兜底：写本地日志，绝不抛错、绝不打扰用户 ----
        _write_fallback(row, db_path)
        return False


def _write_fallback(row: dict, db_path: str = DEFAULT_DB_PATH) -> None:
    """数据库写入失败时，把记录追加到与 db 同目录的 failed_events.jsonl。"""
    try:
        log_path = os.path.join(os.path.dirname(db_path), "failed_events.jsonl")
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        # 连兜底日志都写不进去（如磁盘满），静默放弃
        pass


def _replay_fallback(conn: sqlite3.Connection, db_path: str) -> int:
    """
    回灌兜底日志：把 failed_events.jsonl 里的失败记录补写回数据库。

    在每次 get_connection 成功后自动调用。回灌完成后清空日志文件，避免重复回灌。
    返回成功回灌的记录数。
    """
    log_path = os.path.join(os.path.dirname(db_path), "failed_events.jsonl")
    if not os.path.exists(log_path):
        return 0
    try:
        with open(log_path, "r", encoding="utf-8") as f:
            lines = [ln.strip() for ln in f if ln.strip()]
    except Exception:
        return 0
    if not lines:
        return 0

    replayed = 0
    for line in lines:
        try:
            row = json.loads(line)
            # 兜底记录可能缺字段（旧版本），补默认值
            row.setdefault("session_key", "")
            row.setdefault("turn_no", 1)
            row.setdefault("source", "llm")  # 旧兜底日志缺 source，默认视为 llm 来源
            # 回灌记录身份走归一化（与正常写入一致，避免历史兜底记录继续制造碎片）
            row["user_id"] = normalize_identity(
                row.get("user_id", ""), session_key=row.get("session_key", "")
            )
            if not row.get("user_name"):
                row["user_name"] = "匿名用户" if row["user_id"].startswith("anon-") else row["user_id"]
            conn.execute(
                """
                INSERT INTO usage_events
                    (event_type, target_name, target_label, user_query, user_id,
                     user_name, session_key, invoke_count, turn_no, output_files, status, source, created_at)
                VALUES
                    (:event_type, :target_name, :target_label, :user_query, :user_id,
                     :user_name, :session_key, :invoke_count, :turn_no, :output_files, :status, :source, :created_at)
                """,
                row,
            )
            replayed += 1
        except Exception:
            # 单条回灌失败不影响其他记录
            continue

    if replayed > 0:
        try:
            conn.commit()
            # 回灌成功后清空日志文件
            with open(log_path, "w", encoding="utf-8") as f:
                pass
        except Exception:
            pass
    return replayed


# ============================================================
# 命令行入口
# ============================================================

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="track_usage.py",
        description="智能体/技能使用数据上报。每次任务结束后由埋点规则隐式调用，静默执行。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--event-type",
        required=True,
        choices=["agent", "skill", "chat"],
        help="事件类型：agent（智能体）/ skill（技能）/ chat（普通对话，未触发 Agent/Skill）",
    )
    parser.add_argument(
        "--target-name",
        required=True,
        help='目标名称（智能体或技能的 ID，如 product_discovery、prd-document-generator）；普通对话填 "-"',
    )
    parser.add_argument("--target-label", default="", help="目标中文名，便于汇报展示（如「产品探索智能体」）")
    parser.add_argument("--user-query", default="", help="用户原始输入文本（会自动截断到 500 字）")
    parser.add_argument("--user-id", default="", help="当前用户标识（ou_xxx / wo_xxx 等）。为空时脚本会从 --session-key 解析")
    parser.add_argument("--user-name", default="", help="当前用户真实姓名；为空时脚本用 user_id 兜底")
    parser.add_argument(
        "--session-key",
        default="",
        help="当前会话标识（如 agent:main:wecom:direct:wo_xxx）。脚本会从中解析渠道用户 ID",
    )
    parser.add_argument(
        "--anon-id",
        default="",
        help="匿名标识（可选）。当拿不到真实身份时，调用方可传入本会话内复用的临时 ID，脚本优先用它作匿名 user_id",
    )
    parser.add_argument(
        "--invoke-count",
        type=int,
        default=1,
        help="本次交互触发的 Agent/Skill 调用总次数（含子任务调度），默认 1",
    )
    parser.add_argument(
        "--output-files",
        default="",
        help='产出文件链接，多个用逗号分隔；无产出留空',
    )
    parser.add_argument(
        "--status",
        default="success",
        choices=["success", "failed"],
        help="本次执行状态，默认 success",
    )
    parser.add_argument(
        "--source",
        default="llm",
        choices=["llm", "hook"],
        help="数据来源：llm=智能体轮末上报（能力调用），hook=message:received 钩子上报（对话轮次）。默认 llm",
    )
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH, help=argparse.SUPPRESS)
    return parser


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)

    # output_files 逗号分隔 -> 列表
    output_files = []
    if args.output_files:
        output_files = [s.strip() for s in args.output_files.split(",") if s.strip()]

    ok = record_event(
        event_type=args.event_type,
        target_name=args.target_name,
        target_label=args.target_label,
        user_query=args.user_query,
        user_id=args.user_id,
        user_name=args.user_name,
        session_key=args.session_key,
        anon_id=args.anon_id,
        invoke_count=args.invoke_count,
        output_files=output_files,
        status=args.status,
        source=args.source,
        db_path=args.db_path,
    )

    # 静默退出：无论成败都不打印（埋点不应打扰用户）
    # 仅在显式调试时可通过环境变量 TELEMETRY_DEBUG=1 查看结果
    if os.environ.get("TELEMETRY_DEBUG"):
        print("上报成功" if ok else "上报失败（已写兜底日志）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
