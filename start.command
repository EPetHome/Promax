#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PORT="3080"
PROFILE="web"
URL="http://127.0.0.1:${PORT}/"
DSH_HOME_DIR="${HOME}/.dsh-promax"
DSH_REPO="${SCRIPT_DIR}/promax-agent/deepseek-harness"
RELEASE_DIR="${SCRIPT_DIR}/promax-ui/release"
INSTALLER="${RELEASE_DIR}/install-promax.sh"
STATE_DIR="${DSH_HOME_DIR}/run"
PID_FILE="${STATE_DIR}/promax-${PORT}.pid"
LOG_FILE="${STATE_DIR}/promax-${PORT}.log"
RELEASE_MARKER="${DSH_HOME_DIR}/.installed-release-sha256"

listener_pid() {
  lsof -nP -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | head -n 1
}

is_our_dsh_process() {
  local pid="$1"
  local command cwd
  command="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  cwd="$(lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  [[ "${command}" == *"apps/cli/src/bin.ts"* && "${cwd}" == "${DSH_REPO}" ]]
}

stop_promax() {
  local pid
  pid="$(listener_pid || true)"

  if [[ -z "${pid}" ]]; then
    rm -f "${PID_FILE}"
    echo "Promax 已关闭（端口 ${PORT} 空闲）。"
    return 0
  fi

  if ! is_our_dsh_process "${pid}"; then
    echo "端口 ${PORT} 被其他程序占用，未自动终止："
    ps -p "${pid}" -o pid=,command=
    return 1
  fi

  kill -TERM "${pid}"
  for _ in {1..40}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f "${PID_FILE}"
      echo "Promax 已关闭。"
      return 0
    fi
    sleep 0.25
  done

  kill -KILL "${pid}"
  rm -f "${PID_FILE}"
  echo "Promax 已强制关闭。"
}

release_signature() {
  shasum -a 256 "${RELEASE_DIR}/SHA256SUMS" | awk '{print $1}'
}

ensure_installed() {
  local current_signature installed_signature

  if [[ ! -f "${INSTALLER}" || ! -f "${RELEASE_DIR}/SHA256SUMS" ]]; then
    echo "缺少 Promax 发布文件：${RELEASE_DIR}"
    return 1
  fi
  if [[ ! -f "${DSH_REPO}/package.json" ]]; then
    echo "缺少 DeepSeek Harness：${DSH_REPO}"
    return 1
  fi

  current_signature="$(release_signature)"
  installed_signature="$(sed -n '1p' "${RELEASE_MARKER}" 2>/dev/null || true)"

  if [[ ! -f "${DSH_HOME_DIR}/profiles/${PROFILE}/package.json" || "${current_signature}" != "${installed_signature}" ]]; then
    echo "正在安装当前 Promax 发布包……"
    env DSH_HOME="${DSH_HOME_DIR}" PROMAX_DSH_REPO="${DSH_REPO}" \
      sh "${INSTALLER}" "${PROFILE}"
    printf '%s\n' "${current_signature}" > "${RELEASE_MARKER}"
  fi
}

start_promax() {
  local pid starter_pid
  pid="$(listener_pid || true)"

  if [[ -n "${pid}" ]]; then
    if is_our_dsh_process "${pid}"; then
      echo "Promax 已在运行：${URL}"
      open "${URL}"
      return 0
    fi
    echo "端口 ${PORT} 被其他程序占用，Promax 未启动："
    ps -p "${pid}" -o pid=,command=
    return 1
  fi

  ensure_installed
  mkdir -p "${STATE_DIR}"

  (
    cd "${DSH_REPO}"
    exec env DSH_HOME="${DSH_HOME_DIR}" \
      pnpm dsh --profile "${PROFILE}" --port "${PORT}" --no-open
  ) >> "${LOG_FILE}" 2>&1 &
  starter_pid="$!"

  for _ in {1..80}; do
    pid="$(listener_pid || true)"
    if [[ -n "${pid}" ]] && curl --max-time 1 -fsS "${URL}" >/dev/null 2>&1; then
      printf '%s\n' "${pid}" > "${PID_FILE}"
      echo "Promax 已启动：${URL}"
      echo "日志：${LOG_FILE}"
      open "${URL}"
      return 0
    fi
    if ! kill -0 "${starter_pid}" 2>/dev/null; then
      echo "Promax 启动失败，日志如下："
      tail -n 40 "${LOG_FILE}" 2>/dev/null || true
      return 1
    fi
    sleep 0.25
  done

  echo "Promax 启动超时，日志如下："
  tail -n 40 "${LOG_FILE}" 2>/dev/null || true
  return 1
}

show_status() {
  local pid
  pid="$(listener_pid || true)"
  if [[ -z "${pid}" ]]; then
    echo "Promax 未运行；固定端口 ${PORT} 空闲。"
  elif is_our_dsh_process "${pid}"; then
    echo "Promax 正在运行：${URL}（PID ${pid}）"
  else
    echo "端口 ${PORT} 被其他程序占用（PID ${pid}）。"
    return 1
  fi
}

ACTION="${1:-start}"
case "${ACTION}" in
  start)
    start_promax
    ;;
  stop)
    stop_promax
    ;;
  restart)
    stop_promax
    start_promax
    ;;
  status)
    show_status
    ;;
  *)
    echo "用法：$0 [start|stop|restart|status]"
    exit 2
    ;;
esac
