#!/usr/bin/env bash
# 10c-3 调度脚本：A 组（修）Sol ⇄ Astra 来回，通过后 B 组（跑）Sol → Astra；B 不过可退回 A 一次。
# 用户 2026-09-30 定：分 A/B 两组；Sol 开发、Astra 评审；上限 A≤3、B→A 退回≤1（退回后 A≤2、B 整批重跑）。
# 规则与文件约定见 promax-eval/交接-10c3/00-说明.md。
# 中断或某次 pi 调用失败后，直接重跑本脚本：按 状态.json 与交接区已有文件从断点继续。
#
# 用法：bash docs/prompt/调度-10c3.sh
# 空跑（验证调度本身）：由 Claude 用环境变量覆盖 WORKDIR/HANDOFF/P_*/T_* 与模型。
set -uo pipefail

WORKDIR="${WORKDIR:-/Users/Admin/Desktop/Promax}"
HANDOFF="${HANDOFF:-${WORKDIR}/promax-eval/交接-10c3}"
PROMPTS="${PROMPTS:-${WORKDIR}/docs/prompt}"
P_A_SOL="${P_A_SOL:-${PROMPTS}/提示词-10c3A-流程返修.md}"
P_A_AST="${P_A_AST:-${PROMPTS}/复核-10c3A-流程返修.md}"
P_B_SOL="${P_B_SOL:-${PROMPTS}/提示词-10c3B-七场景整批跑.md}"
P_B_AST="${P_B_AST:-${PROMPTS}/复核-10c3B-七场景整批跑.md}"

SOL_MODEL="${SOL_MODEL:-openai-codex/gpt-6.1-sol}"; SOL_THINK="${SOL_THINK:-max}"
AST_MODEL="${AST_MODEL:-openai-codex/gpt-6-astra}"; AST_THINK="${AST_THINK:-xhigh}"

# 单次 pi 调用的时限（秒），超时即停止调度
T_A_SOL="${T_A_SOL:-7200}"; T_A_AST="${T_A_AST:-3600}"
T_B_SOL="${T_B_SOL:-14400}"; T_B_AST="${T_B_AST:-7200}"

A_LIMIT_FIRST=3      # A 组首段最多来回次数
A_LIMIT_AFTER_BACK=2 # B 退回后 A 组最多再来回次数
BACK_LIMIT=1         # B → A 退回次数上限

PI=/Users/Admin/.local/bin/pi
export PATH="/Users/Admin/.hermes/node/bin:${PATH}"
EXT=/Users/Admin/.pi/agent/npm/node_modules
E_PERM="${EXT}/@gotgenes/pi-permission-system/src/index.ts"
E_BG="${EXT}/pi-background-tasks/extensions/background-tasks.ts"
BASE_ARGS=(--offline -p --no-extensions --no-skills --no-prompt-templates --no-themes -e "${E_PERM}")
SOL_ARGS=(--model "${SOL_MODEL}" --thinking "${SOL_THINK}")
AST_ARGS=(--model "${AST_MODEL}" --thinking "${AST_THINK}")
T_SOL_A=read,edit,write,bash
T_SOL_B=read,edit,write,bash,bg_run,bg_status,bg_logs,bg_result,bg_kill
T_AST=read,write,bash,grep,find,ls

STATE="${HANDOFF}/状态.json"
LOG="${HANDOFF}/日志/调度.log"
mkdir -p "${HANDOFF}/A" "${HANDOFF}/B" "${HANDOFF}/回流" "${HANDOFF}/日志"

say() { local m="[$(date '+%m-%d %H:%M:%S')] $*"; echo "$m" >&2; echo "$m" >> "$LOG"; }
nn() { printf '%02d' "$1"; }

# ---------- 状态 ----------
state_get() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))' "$STATE" "$1"; }
state_set() { # state_set key value [key value ...]
  python3 - "$STATE" "$@" <<'PY'
import json, sys, os, datetime
path, kv = sys.argv[1], sys.argv[2:]
d = json.load(open(path)) if os.path.exists(path) else {}
for k, v in zip(kv[::2], kv[1::2]):
    d[k] = int(v) if v.lstrip('-').isdigit() else v
d["更新"] = datetime.datetime.now().isoformat(timespec="seconds")
json.dump(d, open(path, "w"), ensure_ascii=False, indent=2)
PY
}

finish() { # finish <结果> <说明>
  state_set 阶段 "$1" 说明 "$2"
  say "==== 调度结束：$1 —— $2"
  say "交接区：${HANDOFF}　状态：${STATE}"
  [[ "$1" == "完成" ]] && exit 0 || exit 3
}

# ---------- 评审结论 ----------
verdict() { # verdict <json> <组> <次> → 通过 / 返修 / 停止 / 无效:原因
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
path, group, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    d = json.load(open(path, encoding="utf-8"))
except Exception as e:
    print(f"无效:{type(e).__name__}"); sys.exit()
v = d.get("结论")
try:
    same = int(str(d.get("次"))) == n
except ValueError:
    same = False
if d.get("组") != group or not same:
    print(f"无效:组或次不符({d.get('组')},{d.get('次')})")
elif v not in ("通过", "返修", "停止"):
    print(f"无效:结论={v}")
elif v == "返修" and not d.get("修复清单"):
    print("无效:返修但修复清单为空")
else:
    print(v)
PY
}

# ---------- 调用 pi（带时限、可中断） ----------
CHILD=""; WATCH=""
kill_tree() { # 连同 pi 起的子进程（如 B 组的 dsh）一起停
  local p c; for p in "$@"; do
    for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done
    kill -TERM "$p" 2>/dev/null
  done
}
on_int() {
  say "收到中断，停止当前 pi 调用及其子进程"
  [[ -n "$WATCH" ]] && kill_tree "$WATCH"
  [[ -n "$CHILD" ]] && kill_tree "$CHILD"
  [[ "$(state_get 阶段)" == B ]] && say "B 组的场景由后台任务启动，可能不在上面的进程树里：用 pgrep -fl '[.]bin/dsh --profile' 检查，确认后再手动停"
  state_set 阶段 中断 说明 "用户中断；重跑本脚本从断点继续"
  exit 130
}
trap on_int INT TERM

run_pi() { # run_pi <标签> <时限秒> <角色参数名> <工具> [额外 -e] -- <消息...>
  local label="$1" limit="$2" role="$3" tools="$4"; shift 4
  local extra=(); while [[ "$1" != "--" ]]; do extra+=("$1"); shift; done; shift
  local out="${HANDOFF}/日志/${label}.log"
  local -a role_args; if [[ "$role" == SOL ]]; then role_args=("${SOL_ARGS[@]}"); else role_args=("${AST_ARGS[@]}"); fi
  say "▶ ${label} 开始（时限 $((limit/60)) 分钟）；输出：${out}"
  local t0=$SECONDS
  ( cd "$WORKDIR" && exec "$PI" "${BASE_ARGS[@]}" ${extra[@]+"${extra[@]}"} "${role_args[@]}" \
      --tools "$tools" --name "10c3-${label}" "$@" ) > "$out" 2>&1 &
  CHILD=$!
  ( sleep "$limit"; kill_tree "$CHILD"; sleep 15; kill -KILL "$CHILD" 2>/dev/null ) &
  WATCH=$!
  wait "$CHILD"; local rc=$?
  kill_tree "$WATCH"; wait "$WATCH" 2>/dev/null
  CHILD=""; WATCH=""
  local secs=$((SECONDS - t0))
  say "■ ${label} 结束：退出码 ${rc}，用时 $((secs/60)) 分 $((secs%60)) 秒"
  (( secs >= limit )) && { say "  已到时限，被调度脚本停止"; return 124; }
  return "$rc"
}

# ---------- A 组一次来回 ----------
RESULT=""
a_round() { # a_round <n>；结果放 RESULT：通过/返修/停止…/无效…
  local n="$1" N; N=$(nn "$1")
  local deliver="${HANDOFF}/A/${N}-交付.md" review="${HANDOFF}/A/${N}-评审.json"
  local back_n; back_n=$(state_get 退回后首次)
  if [[ ! -s "$deliver" ]]; then
    local msg
    if (( n == 1 )); then
      msg="调度消息：你是 A 组 Sol，本次是第 ${N} 次（首次）。交接区 ${HANDOFF}。做完写 ${deliver} 后结束会话。"
    elif [[ -n "$back_n" && "$n" == "$back_n" ]]; then
      msg="调度消息：你是 A 组 Sol，本次是第 ${N} 次（B 组退回后的续修）。不要重做 9.0 基线。先读 B 组退回单 ${HANDOFF}/回流/01-B退回.md（修复清单）和 A 组上次的交付 ${HANDOFF}/A/$(nn $((n-1)))-交付.md，只修退回单里的问题，重跑受影响用例与全部回归，写 ${deliver} 后结束会话。"
    else
      msg="调度消息：你是 A 组 Sol，本次是第 ${N} 次（续修）。不要重做 9.0 基线。先读 ${HANDOFF}/A/$(nn $((n-1)))-评审.md（修复清单）和你上次的交付 ${HANDOFF}/A/$(nn $((n-1)))-交付.md，只修清单里的问题，重跑受影响用例与全部回归，写 ${deliver} 后结束会话。"
    fi
    run_pi "A${N}-sol" "$T_A_SOL" SOL "$T_SOL_A" -- "@${P_A_SOL}" "$msg"
    local rc=$?
    [[ -s "$deliver" ]] || { RESULT="停止:A 组第 ${N} 次 Sol 未写交付（pi 退出码 ${rc}）；可直接重跑本脚本"; return; }
  fi
  if [[ ! -s "$review" ]]; then
    local note=""
    if [[ -n "$back_n" && "$n" == "$back_n" ]]; then
      note="本次续修来自 B 组退回单 ${HANDOFF}/回流/01-B退回.md：核对退回单里的问题是否修好，并确认没有改坏其他项。"
    elif (( n > 1 )); then
      note="上次评审是 ${HANDOFF}/A/$(nn $((n-1)))-评审.md：重点核对修复清单是否修好。"
    fi
    run_pi "A${N}-astra" "$T_A_AST" AST "$T_AST" -- "@${P_A_AST}" \
      "调度消息：你是 A 组评审，本次是第 ${N} 次评审（NN=${N}）。Sol 的交付：${deliver}。${note}写 ${HANDOFF}/A/${N}-评审.md 与 ${review} 后结束会话。"
    local rc=$?
    [[ -s "$review" ]] || { RESULT="停止:A 组第 ${N} 次 Astra 未写评审 JSON（pi 退出码 ${rc}）；可直接重跑本脚本"; return; }
  fi
  RESULT=$(verdict "$review" A "$n")
}

# ---------- B 组一批 ----------
b_round() { # b_round <k> <是否最后一次>；结果放 RESULT
  local k="$1" last="$2" K; K=$(nn "$1")
  local deliver="${HANDOFF}/B/${K}-交付.md" review="${HANDOFF}/B/${K}-评审.json"
  if [[ ! -s "$deliver" ]]; then
    local more=""
    (( k > 1 )) && more="上一批的退回单是 ${HANDOFF}/回流/01-B退回.md；之后 A 组的交付见 ${HANDOFF}/A/ 序号最大的文件。"
    [[ -f "${HANDOFF}/日志/B${K}-sol.log" ]] && more="${more}本批之前中断过：已有的本批运行目录保留不动、在交付里说明，从 runs/ 现有最大编号 +1 整批重跑。"
    run_pi "B${K}-sol" "$T_B_SOL" SOL "$T_SOL_B" -e "$E_BG" -- "@${P_B_SOL}" \
      "调度消息：你是 B 组 Sol，第 ${k} 批，交付序号 NN=${K}，标签 10c3b${k}。交接区 ${HANDOFF}。${more}跑完写 ${deliver} 后结束会话。"
    local rc=$?
    [[ -s "$deliver" ]] || { RESULT="停止:B 组第 ${k} 批 Sol 未写交付（pi 退出码 ${rc}）；本批可能已留下运行目录，重跑前请先看日志"; return; }
  fi
  if [[ ! -s "$review" ]]; then
    run_pi "B${K}-astra" "$T_B_AST" AST "$T_AST" -- "@${P_B_AST}" \
      "调度消息：你是 B 组复核（节点轮），第 ${k} 批，交付序号 NN=${K}，最后一次评审：${last}。Sol 的交付：${deliver}。写 ${HANDOFF}/B/${K}-评审.md 与 ${review} 后结束会话。"
    local rc=$?
    [[ -s "$review" ]] || { RESULT="停止:B 组第 ${k} 批 Astra 未写评审 JSON（pi 退出码 ${rc}）；可直接重跑本脚本"; return; }
  fi
  RESULT=$(verdict "$review" B "$k")
}

# ---------- 开跑前检查 ----------
WAIT_PY="${WAIT_PY:-${PROMPTS}/等场景-10c3.py}" # B 组 Sol 等场景用（09-30 晚补：pi -p 下不能结束回合等通知）
for f in "$P_A_SOL" "$P_A_AST" "$P_B_SOL" "$P_B_AST" "$E_PERM" "$E_BG" "$WAIT_PY"; do
  [[ -f "$f" ]] || { echo "缺文件：$f" >&2; exit 2; }
done
[[ "$("$PI" auth check --provider openai-codex 2>/dev/null | head -1)" == ready ]] || { echo "openai-codex 凭据未就绪（pi auth check）" >&2; exit 2; }
free_gb=$(df -g "$WORKDIR" | awk 'NR==2{print $4}')
(( free_gb >= 2 )) || { echo "磁盘剩余 ${free_gb} GB，不足 2 GB" >&2; exit 2; }

if [[ ! -f "$STATE" ]]; then
  state_set 阶段 A A次 1 A上限 "$A_LIMIT_FIRST" B批 1 退回次数 0 退回后首次 ""
  say "==== 10c-3 调度开始（Sol=${SOL_MODEL}/${SOL_THINK}，Astra=${AST_MODEL}/${AST_THINK}）"
else
  phase=$(state_get 阶段)
  case "$phase" in
    完成) say "状态已是「完成」，不再运行。要重来请先人工处理 ${STATE}"; exit 0 ;;
    停止|中断|A|B) say "==== 从断点继续：上次阶段=${phase}（$(state_get 说明)）"
       [[ "$phase" == 停止 || "$phase" == 中断 ]] && state_set 阶段 "$(state_get 恢复阶段)" ;;
  esac
fi

# ---------- 主循环 ----------
while true; do
  phase=$(state_get 阶段)
  if [[ "$phase" == A ]]; then
    n=$(state_get A次); lim=$(state_get A上限)
    (( n > lim )) && { state_set 恢复阶段 A; finish 停止 "A 组已来回 $((n-1)) 次，到上限仍未通过"; }
    state_set 恢复阶段 A
    a_round "$n"; v="$RESULT"
    say "A 组第 $(nn "$n") 次评审结论：${v}"
    case "$v" in
      通过) state_set 阶段 B ;;
      返修) state_set A次 $((n+1)) ;;
      停止:*) finish 停止 "${v#停止:}" ;;
      停止) finish 停止 "评审要求停止：$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("需要用户",""))' "${HANDOFF}/A/$(nn "$n")-评审.json")；见 ${HANDOFF}/A/$(nn "$n")-评审.md" ;;
      *) finish 停止 "A 组第 $(nn "$n") 次评审 JSON ${v}" ;;
    esac
  elif [[ "$phase" == B ]]; then
    k=$(state_get B批); back=$(state_get 退回次数)
    last=否; (( back >= BACK_LIMIT )) && last=是
    state_set 恢复阶段 B
    b_round "$k" "$last"; v="$RESULT"
    say "B 组第 ${k} 批复核结论：${v}"
    case "$v" in
      通过) finish 完成 "B 组第 ${k} 批 7/7 通过（待 Claude 汇报、用户宣布是否过节点）" ;;
      返修)
        if (( back >= BACK_LIMIT )); then
          finish 停止 "B 组第 ${k} 批仍有流程问题，已退回过 ${back} 次，到上限"
        fi
        K=$(nn "$k")
        cp "${HANDOFF}/B/${K}-评审.md" "${HANDOFF}/回流/01-B退回.md"
        cp "${HANDOFF}/B/${K}-评审.json" "${HANDOFF}/回流/01-B退回.json"
        n=$(( $(state_get A次) + 1 ))
        state_set 阶段 A A次 "$n" A上限 $((n + A_LIMIT_AFTER_BACK - 1)) 退回次数 $((back+1)) 退回后首次 "$n" B批 $((k+1))
        say "B 组退回 A 组：退回单 ${HANDOFF}/回流/01-B退回.md；A 组从第 $(nn "$n") 次起最多再来回 ${A_LIMIT_AFTER_BACK} 次" ;;
      停止:*) finish 停止 "${v#停止:}" ;;
      停止) finish 停止 "复核要求停止：$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("需要用户",""))' "${HANDOFF}/B/$(nn "$k")-评审.json")；见 ${HANDOFF}/B/$(nn "$k")-评审.md" ;;
      *) finish 停止 "B 组第 ${k} 批复核 JSON ${v}" ;;
    esac
  else
    finish 停止 "未知阶段：${phase}"
  fi
done
