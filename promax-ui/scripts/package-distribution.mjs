import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(root, 'release')
const stageRoot = await mkdtemp(join(tmpdir(), 'promax-distribution-'))
const archivesByPackage = new Map()

const packageSpecs = [
  { source: join(root, 'packages', 'promax-ui-brand') },
  { source: join(root, 'packages', 'promax-ui-layout') },
  { source: join(root, 'packages', 'promax-ui-console') },
  { source: resolve(root, '../promax-end/packages/promax-report') },
  { source: resolve(root, '../promax-agent/team-harness') },
  { source: join(root, 'packages', 'promax-bundle') },
]

try {
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
      const agentPayloads = [
        ['team-configurator'],
        ['product-solution', 'skills'],
        ['customer-research', 'skills'],
        ['product-discovery', 'skills'],
        ['requirement-management', 'skills'],
        ['requirement-review', 'skills'],
        ['user-analysis', 'skills'],
        ['shared', 'skills'],
      ]
      for (const segments of agentPayloads) {
        await cp(
          resolve(root, '../promax-agent/agents', ...segments),
          join(stageDir, 'agents', ...segments),
          { recursive: true },
        )
      }
      const skillCatalogPath = join(stageDir, 'catalogs', 'skills.yml')
      const skillCatalog = await readFile(skillCatalogPath, 'utf8')
      await writeFile(skillCatalogPath, skillCatalog.replaceAll('../../agents/', '../agents/'))
      manifest.files = [...new Set([...(manifest.files ?? []), 'agents'])]
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const archiveName = archiveFor(manifest.name, manifest.version)
    try {
      await access(join(releaseDir, archiveName))
      process.stdout.write(`Preserving existing release package: ${archiveName}\n`)
    } catch {
      run('pnpm', ['pack', '--pack-destination', releaseDir], stageDir)
    }
    archivesByPackage.set(manifest.name, archiveName)
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
LAYOUT_ARCHIVE="$SCRIPT_DIR/${requiredArchive('@promax/promax-ui-layout')}"
CONSOLE_ARCHIVE="$SCRIPT_DIR/${requiredArchive('@promax/promax-ui-console')}"
BUNDLE_ARCHIVE="$SCRIPT_DIR/${requiredArchive('@promax/promax-bundle')}"
${dshRunner}if [ -f "$PROFILE_MANIFEST" ]; then
  node - "$PROFILE_MANIFEST" \\
    "@promax/promax-report=$REPORT_ARCHIVE" \\
    "@promax/team-harness=$TEAM_HARNESS_ARCHIVE" \\
    "@promax/promax-ui-brand=$BRAND_ARCHIVE" \\
    "@promax/promax-ui-layout=$LAYOUT_ARCHIVE" \\
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
    "$LAYOUT_ARCHIVE" \\
    "$CONSOLE_ARCHIVE" \\
    "$BUNDLE_ARCHIVE"
fi
HARNESS_ROOT="$DSH_ROOT/profiles/$PROFILE/node_modules/@promax/team-harness"
CONFIGURATOR_SOURCE="$HARNESS_ROOT/agents/team-configurator"
PRODUCT_SOURCE="$HARNESS_ROOT/generated/promax-team"
GENERAL_SOURCE="$DSH_ROOT/profiles/$PROFILE/node_modules/@promax/promax-bundle/presets/general"
PRESET_ROOT="$DSH_ROOT/.agent-presets"
ARCHIVE_BASE="/Users/Admin/Desktop/Promax/.archive"
INSTALL_STAGE="$(mktemp -d "$DSH_ROOT/.promax-install-stage.XXXXXX")"
ARCHIVE_REPORT="$INSTALL_STAGE/archive-report.json"
cleanup_stage() {
  node - "$INSTALL_STAGE" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const target = path.resolve(process.argv[2])
if (!path.basename(target).startsWith('.promax-install-stage.')) throw new Error('Refusing to remove an unexpected install-stage path')
fs.rmSync(target, { recursive: true, force: true })
NODE
}
trap cleanup_stage EXIT INT TERM

node "$HARNESS_ROOT/src/cli.mjs" verify --revision "$PRODUCT_SOURCE"

node - "$PRESET_ROOT" "$ARCHIVE_BASE" "$CONFIGURATOR_SOURCE" "$PRODUCT_SOURCE" "$GENERAL_SOURCE" "$INSTALL_STAGE" "$ARCHIVE_REPORT" <<'NODE'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const [presetRoot, archiveBase, configuratorSource, productSource, generalSource, stageRoot, reportPath] = process.argv.slice(2).map(value => path.resolve(value))
const allowed = ['general', 'promax-team', 'promax-team-configurator']

function timestamp() {
  const now = new Date()
  const part = value => String(value).padStart(2, '0')
  return String(now.getFullYear()) + part(now.getMonth() + 1) + part(now.getDate()) + '-' + part(now.getHours()) + part(now.getMinutes()) + part(now.getSeconds())
}

function inventory(root) {
  const rows = []
  function walk(current, relative) {
    for (const name of fs.readdirSync(current).sort()) {
      const absolute = path.join(current, name)
      const child = relative === '' ? name : path.join(relative, name)
      const stat = fs.lstatSync(absolute)
      if (stat.isDirectory()) {
        rows.push('d ' + child)
        walk(absolute, child)
      } else if (stat.isSymbolicLink()) {
        rows.push('l ' + child + ' ' + fs.readlinkSync(absolute))
      } else if (stat.isFile()) {
        rows.push('f ' + child + ' ' + stat.size + ' ' + crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'))
      } else {
        throw new Error('Unsupported preset entry: ' + absolute)
      }
    }
  }
  walk(root, '')
  return { count: rows.length, digest: crypto.createHash('sha256').update(rows.join('\\n')).digest('hex') }
}

for (const source of [configuratorSource, productSource, generalSource]) {
  if (!fs.statSync(source).isDirectory()) throw new Error('Missing preset source: ' + source)
}
fs.mkdirSync(presetRoot, { recursive: true })
const existing = fs.readdirSync(presetRoot).sort()
if (existing.length === 0) throw new Error('Historical preset archive prerequisite failed: install state is empty')
const firstInstall = !existing.includes('promax-team') || existing.some(name => !allowed.includes(name))
const archivePath = path.join(archiveBase, (firstInstall ? 'pre-promax-team-' : 'promax-team-') + timestamp())
if (fs.existsSync(archivePath)) throw new Error('Archive target already exists: ' + archivePath)
fs.mkdirSync(archiveBase, { recursive: true })
const archiveSource = firstInstall ? presetRoot : path.join(presetRoot, 'promax-team')
if (!fs.existsSync(archiveSource)) throw new Error('Preset archive source is missing: ' + archiveSource)
const archiveTarget = firstInstall ? archivePath : path.join(archivePath, 'promax-team')
fs.cpSync(archiveSource, archiveTarget, { recursive: true, errorOnExist: true, force: false })
const sourceInventory = inventory(archiveSource)
const archiveInventory = inventory(archiveTarget)
if (sourceInventory.count === 0 || sourceInventory.count !== archiveInventory.count || sourceInventory.digest !== archiveInventory.digest) {
  throw new Error('Historical preset archive verification failed; refusing installation cleanup')
}

const configuratorStage = path.join(stageRoot, 'promax-team-configurator')
fs.mkdirSync(configuratorStage)
for (const name of ['agent.cordis.yml', 'preset.yml']) {
  const sourceFile = path.join(configuratorSource, name)
  if (!fs.existsSync(sourceFile)) throw new Error('Missing configurator preset file: ' + name)
  fs.copyFileSync(sourceFile, path.join(configuratorStage, name))
}
fs.cpSync(productSource, path.join(stageRoot, 'promax-team'), { recursive: true, errorOnExist: true, force: false })
const generalStage = path.join(stageRoot, 'general')
fs.mkdirSync(generalStage)
for (const name of ['agent.cordis.yml', 'preset.yml']) {
  const sourceFile = path.join(generalSource, name)
  if (!fs.existsSync(sourceFile)) throw new Error('Missing Promax general preset file: ' + name)
  fs.copyFileSync(sourceFile, path.join(generalStage, name))
}
fs.writeFileSync(reportPath, JSON.stringify({ archivePath, fileCount: archiveInventory.count, digest: archiveInventory.digest }) + '\\n')
NODE

node "$HARNESS_ROOT/src/cli.mjs" verify --revision "$INSTALL_STAGE/promax-team"

node - "$PRESET_ROOT" "$INSTALL_STAGE" "$ARCHIVE_REPORT" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const [presetRoot, stageRoot, reportPath] = process.argv.slice(2).map(value => path.resolve(value))
const allowed = ['general', 'promax-team', 'promax-team-configurator']
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
if (!Number.isSafeInteger(report.fileCount) || report.fileCount < 1 || typeof report.archivePath !== 'string' || !fs.statSync(report.archivePath).isDirectory()) {
  throw new Error('Verified non-empty archive report is required before preset cleanup')
}
for (const name of allowed) {
  const staged = path.join(stageRoot, name)
  if (!fs.statSync(staged).isDirectory()) throw new Error('Missing staged preset: ' + name)
}
for (const name of allowed) {
  const target = path.join(presetRoot, name)
  fs.rmSync(target, { recursive: true, force: true })
  fs.renameSync(path.join(stageRoot, name), target)
}
for (const name of fs.readdirSync(presetRoot)) {
  if (!allowed.includes(name)) fs.rmSync(path.join(presetRoot, name), { recursive: true, force: true })
}
const finalNames = fs.readdirSync(presetRoot).sort()
if (JSON.stringify(finalNames) !== JSON.stringify(allowed)) throw new Error('Installed preset set is not the required fixed three')
process.stdout.write('PROMAX_ARCHIVE_PATH=' + report.archivePath + '\\nPROMAX_ARCHIVE_FILES=' + report.fileCount + '\\n')
NODE

node "$HARNESS_ROOT/src/cli.mjs" verify --revision "$PRESET_ROOT/promax-team"
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
