import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(root, 'release')
const stageRoot = await mkdtemp(join(tmpdir(), 'promax-distribution-'))
const archivesByPackage = new Map()

const packageSpecs = [
  { source: join(root, 'packages', 'promax-ui-brand') },
  { source: join(root, 'packages', 'promax-ui-console') },
  { source: resolve(root, '../promax-end/packages/promax-report') },
  { source: resolve(root, '../promax-agent/team-harness') },
  {
    source: join(root, 'packages', 'promax-bundle'),
    dependencies: {},
  },
]

try {
  await rm(releaseDir, { recursive: true, force: true })
  await mkdir(releaseDir, { recursive: true })

  for (const spec of packageSpecs) {
    const stageDir = join(stageRoot, basename(spec.source))
    await cp(spec.source, stageDir, {
      recursive: true,
      filter: path => !path.includes(`${join('', 'node_modules')}`),
    })
    const manifestPath = join(stageDir, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.private
    delete manifest.devDependencies
    if (spec.dependencies !== undefined) manifest.dependencies = spec.dependencies
    if (manifest.name === '@promax/team-harness') {
      manifest.version = `${manifest.version}-dist.1`
      await cp(
        resolve(root, '../promax-agent/agents/team-configurator'),
        join(stageDir, 'agents', 'team-configurator'),
        { recursive: true },
      )
      await cp(
        resolve(root, '../promax-agent/agents/product-solution/skills'),
        join(stageDir, 'agents', 'product-solution', 'skills'),
        { recursive: true },
      )
      const skillCatalogPath = join(stageDir, 'catalogs', 'skills.yml')
      const skillCatalog = await readFile(skillCatalogPath, 'utf8')
      await writeFile(skillCatalogPath, skillCatalog.replaceAll('../../agents/', '../agents/'))
      manifest.files = [...new Set([...(manifest.files ?? []), 'agents'])]
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    run('pnpm', ['pack', '--pack-destination', releaseDir], stageDir)
    archivesByPackage.set(manifest.name, archiveFor(manifest.name, manifest.version))
  }

  await cp(join(root, 'packages', 'promax-ui-console', 'dist'), join(releaseDir, 'console-web'), { recursive: true })
  const archives = (await readdir(releaseDir)).filter(name => name.endsWith('.tgz')).sort()
  const dshRunner = `COREPACK_ENABLE_PROJECT_SPEC="\${COREPACK_ENABLE_PROJECT_SPEC:-0}"
PNPM_CONFIG_PM_ON_FAIL="\${PNPM_CONFIG_PM_ON_FAIL:-ignore}"
export COREPACK_ENABLE_PROJECT_SPEC PNPM_CONFIG_PM_ON_FAIL

run_dsh() {
  if command -v dsh >/dev/null 2>&1; then
    dsh "$@"
    return
  fi
  if [ -n "\${PROMAX_DSH_REPO:-}" ] && [ -f "\${PROMAX_DSH_REPO}/package.json" ]; then
    (cd "\${PROMAX_DSH_REPO}" && pnpm dsh "$@")
    return
  fi
  echo "Promax: dsh command not found. Set PROMAX_DSH_REPO to the DeepSeek Harness source directory." >&2
  exit 1
}
`
  const installer = `#!/bin/sh
set -eu
PROFILE="\${1:-web}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
DSH_ROOT="\${DSH_HOME:-\${HOME}/.dsh}"
PROFILE_MANIFEST="$DSH_ROOT/profiles/$PROFILE/package.json"
REPORT_ARCHIVE="$SCRIPT_DIR/${requiredArchive('@promax/promax-report')}"
TEAM_HARNESS_ARCHIVE="$SCRIPT_DIR/${requiredArchive('@promax/team-harness')}"
BRAND_ARCHIVE="$SCRIPT_DIR/${requiredArchive('@promax/promax-ui-brand')}"
CONSOLE_ARCHIVE="$SCRIPT_DIR/${requiredArchive('@promax/promax-ui-console')}"
BUNDLE_ARCHIVE="$SCRIPT_DIR/${requiredArchive('@promax/promax-bundle')}"
${dshRunner}if [ -f "$PROFILE_MANIFEST" ]; then
  node - "$PROFILE_MANIFEST" \\
    "@promax/promax-report=$REPORT_ARCHIVE" \\
    "@promax/team-harness=$TEAM_HARNESS_ARCHIVE" \\
    "@promax/promax-ui-brand=$BRAND_ARCHIVE" \\
    "@promax/promax-ui-console=$CONSOLE_ARCHIVE" \\
    "@promax/promax-bundle=$BUNDLE_ARCHIVE" <<'NODE'
const fs = require('node:fs')
const [manifestPath, ...specs] = process.argv.slice(2)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const dependencies = { ...(manifest.dependencies ?? {}) }
for (const spec of specs) {
  const separator = spec.indexOf('=')
  dependencies[spec.slice(0, separator)] = 'file:' + spec.slice(separator + 1)
}
manifest.dependencies = dependencies
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n')
NODE
  run_dsh plugin --profile "$PROFILE" install
else
  run_dsh plugin --profile "$PROFILE" add \\
    "$REPORT_ARCHIVE" \\
    "$TEAM_HARNESS_ARCHIVE" \\
    "$BRAND_ARCHIVE" \\
    "$CONSOLE_ARCHIVE" \\
    "$BUNDLE_ARCHIVE"
fi
CONFIGURATOR_SOURCE="$DSH_ROOT/profiles/$PROFILE/node_modules/@promax/team-harness/agents/team-configurator"
CONFIGURATOR_TARGET="$DSH_ROOT/.agent-presets/promax-team-configurator"
node - "$CONFIGURATOR_SOURCE" "$CONFIGURATOR_TARGET" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [source, target] = process.argv.slice(2)
fs.mkdirSync(target, { recursive: true })
for (const name of ['agent.cordis.yml', 'preset.yml']) {
  const sourceFile = path.join(source, name)
  if (!fs.existsSync(sourceFile)) throw new Error('Missing configurator preset file: ' + name)
  fs.copyFileSync(sourceFile, path.join(target, name))
}
NODE
`
  const installerPath = join(releaseDir, 'install-promax.sh')
  await writeFile(installerPath, installer)
  await chmod(installerPath, 0o755)

  const consoleLauncher = `#!/bin/sh
set -eu
PROFILE="\${1:-web}"
DSH_ROOT="\${DSH_HOME:-\${HOME}/.dsh}"
exec node "$DSH_ROOT/profiles/$PROFILE/node_modules/@promax/promax-ui-console/lib/server.mjs"
`
  const consoleLauncherPath = join(releaseDir, 'start-console.sh')
  await writeFile(consoleLauncherPath, consoleLauncher)
  await chmod(consoleLauncherPath, 0o755)

  const dshLauncher = `#!/bin/sh
set -eu
PROFILE="\${1:-web}"
${dshRunner}run_dsh --profile "$PROFILE" --no-open
`
  const dshLauncherPath = join(releaseDir, 'start-promax-dsh.sh')
  await writeFile(dshLauncherPath, dshLauncher)
  await chmod(dshLauncherPath, 0o755)

  const checksumTargets = [...archives, 'install-promax.sh', 'start-console.sh', 'start-promax-dsh.sh']
  const checksumLines = []
  for (const name of checksumTargets) {
    const digest = createHash('sha256').update(await readFile(join(releaseDir, name))).digest('hex')
    checksumLines.push(`${digest}  ${name}`)
  }
  await writeFile(join(releaseDir, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`)
  process.stdout.write(`Promax distribution created at ${releaseDir}\n${[...archives, 'console-web/', 'install-promax.sh', 'start-console.sh', 'start-promax-dsh.sh', 'SHA256SUMS'].join('\n')}\n`)
} finally {
  await rm(stageRoot, { recursive: true, force: true })
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`)
}

function archiveFor(name, version) {
  return `${name.replace(/^@/u, '').replace('/', '-')}-${version}.tgz`
}

function requiredArchive(name) {
  const archive = archivesByPackage.get(name)
  if (archive === undefined) throw new Error(`Missing packed archive for ${name}`)
  return archive
}
