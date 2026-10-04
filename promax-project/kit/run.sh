#!/usr/bin/env bash
# 用法：kit/run.sh <运行目录> <提示词文件> [标签] [会话ID]
#   标签：产物文件后缀，默认 turn1 → events-turn1.jsonl / stderr-turn1.log / timing-turn1.json
#   会话ID：续跑同一会话（追问、更新、复查）；会话 ID 在首轮 events 第一行的 sessionId
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="$(cd "$1" && pwd)"
PROMPT_FILE="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
LABEL="${3:-turn1}"
SESSION="${4:-}"
# 实验用：DSH_PROFILE 指定 profile，默认现役 headless
PROFILE="${DSH_PROFILE:-headless}"
DSH="${PROJECT}/dsh-runtime/node_modules/.bin/dsh"
export DSH_HOME="${PROJECT}/dsh-home"
export PATH="/Users/Admin/.hermes/node/bin:${PATH}"

# 密钥：优先用已导出的环境变量，其次用 dsh-home 的凭据存储；脚本不打印密钥
if [[ -z "${OPENCODE_GO_API_KEY:-}" && ! -s "${DSH_HOME}/.credentials.yaml" ]]; then
  echo "缺少 OPENCODE_GO_API_KEY：请先 export，或放入 ${DSH_HOME}/.credentials.yaml" >&2
  exit 2
fi

args=(--profile "${PROFILE}" --json)
[[ -n "${SESSION}" ]] && args+=(--session-id "${SESSION}")

cd "${RUN_DIR}"
start_ms=$(python3 -c 'import time; print(int(time.time()*1000))')
set +e
"${DSH}" "${args[@]}" - < "${PROMPT_FILE}" > "events-${LABEL}.jsonl" 2> "stderr-${LABEL}.log"
code=$?
set -e
end_ms=$(python3 -c 'import time; print(int(time.time()*1000))')
python3 - "$start_ms" "$end_ms" "$code" "$LABEL" <<'PY'
import json, sys
s, e, c = map(int, sys.argv[1:4]); label = sys.argv[4]
json.dump({"exit_code": c, "seconds": round((e - s) / 1000, 1)}, open(f"timing-{label}.json", "w"))
first = open(f"events-{label}.jsonl").readline()
sid = json.loads(first).get("sessionId") if first.strip() else None
print(f"label={label} exit={c} seconds={(e - s) / 1000:.1f} session={sid}")
PY
