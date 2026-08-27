#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
BACKEND_ROOT="$(dirname "$SCRIPT_DIR")"
PROMAX_ROOT="$(dirname "$BACKEND_ROOT")"
MODE="implementation"

if test "$#" -gt 0; then
  MODE="$1"
fi

case "$MODE" in
  implementation|contract) ;;
  *)
    printf 'ERROR|invalid_mode=%s|allowed=implementation,contract\n' "$MODE" >&2
    exit 2
    ;;
esac

dsh_changes="$(git -C "$PROMAX_ROOT/promax-agent/deepseek-harness" status --porcelain -- packages/)"
if test -n "$dsh_changes"; then
  printf 'BLOCKED|dsh_packages_dirty=true\n%s\n' "$dsh_changes" >&2
  exit 1
fi

if test "$MODE" = "implementation"; then
  contract_changes="$(git -C "$BACKEND_ROOT" status --porcelain -- contracts/)"
  if test -n "$contract_changes"; then
    printf 'BLOCKED|contracts_dirty_in_implementation=true\n%s\n' "$contract_changes" >&2
    exit 1
  fi
fi

printf 'GUARDRAILS|mode=%s|dsh_packages_clean=true|contracts_policy=ok\n' "$MODE"
