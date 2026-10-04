#!/usr/bin/env bash
# 用法：kit/new-run.sh <运行名> <提示词文件> <材料文件>...
# 建一个干净的运行目录：附件/、交付/、prompt.txt，并 git init 作为项目根标记。
# 团队规则与技能来自 dsh-home 的全局 AGENTS.md 与 skills，运行目录里不放任何其他文件。
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="$1"; PROMPT="$2"; shift 2
RUN="${PROJECT}/runs/${NAME}"
[[ -e "${RUN}" ]] && { echo "已存在：${RUN}" >&2; exit 1; }

mkdir -p "${RUN}/附件" "${RUN}/交付"
cp "${PROMPT}" "${RUN}/prompt.txt"
for f in "$@"; do cp "$f" "${RUN}/附件/"; done
cd "${RUN}"
git init -q
printf '交付/\nevents.jsonl\nstderr.log\ntiming.json\n' > .gitignore
git add -A
git -c user.name=promax -c user.email=promax@local commit -qm "run baseline: ${NAME}"
echo "${RUN}"
