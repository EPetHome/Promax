#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
PROMAX_RUNTIME_HOME="${PROMAX_RUNTIME_HOME:-/Users/Admin/.dsh-promax}"
PROMAX_HARNESS_REPO="${PROMAX_HARNESS_REPO:-/Users/Admin/Desktop/Promax/promax-agent/deepseek-harness}"
PROMAX_PROFILE="${PROMAX_PROFILE:-web}"
REFRESH_RUNTIME=0

if [ "${1:-}" = "--refresh" ]; then
  REFRESH_RUNTIME=1
  shift
fi
if [ "$#" -ne 0 ]; then
  echo "usage: $0 [--refresh]" >&2
  exit 2
fi

if [ ! -f "$PROMAX_HARNESS_REPO/package.json" ]; then
  echo "Promax harness repository not found: $PROMAX_HARNESS_REPO" >&2
  exit 1
fi

if curl -fsS http://127.0.0.1:3080/ >/dev/null 2>&1; then
  echo "Promax is already running: http://127.0.0.1:3080"
  echo "Stop that process before using --refresh; this script never kills an unknown process."
  exit 0
fi

PROFILE_MANIFEST="$PROMAX_RUNTIME_HOME/profiles/$PROMAX_PROFILE/package.json"
if [ "$REFRESH_RUNTIME" -eq 1 ] || [ ! -f "$PROFILE_MANIFEST" ]; then
  echo "Refreshing the isolated Promax runtime and fixed preset set..."
  DSH_HOME="$PROMAX_RUNTIME_HOME" PROMAX_DSH_REPO="$PROMAX_HARNESS_REPO" "$REPO_ROOT/release/install-promax.sh" "$PROMAX_PROFILE"
fi

node - "$PROMAX_RUNTIME_HOME" "$PROMAX_PROFILE" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [runtimeHome, profile] = process.argv.slice(2)
const packageRoot = path.join(runtimeHome, 'profiles', profile, 'node_modules', '@promax')
const versions = {}
for (const name of ['promax-ui-console', 'team-harness']) {
  const manifest = path.join(packageRoot, name, 'package.json')
  if (!fs.existsSync(manifest)) throw new Error(`Missing installed package: ${manifest}`)
  const value = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  versions[value.name] = value.version
}
process.stdout.write(`Promax runtime: ${JSON.stringify(versions)}\n`)
NODE

echo "The local web profile has no separate login step; model access uses its existing runtime configuration."
echo "Starting Promax: http://127.0.0.1:3080"
exec env DSH_HOME="$PROMAX_RUNTIME_HOME" PROMAX_DSH_REPO="$PROMAX_HARNESS_REPO" "$REPO_ROOT/release/start-promax-dsh.sh" "$PROMAX_PROFILE"
