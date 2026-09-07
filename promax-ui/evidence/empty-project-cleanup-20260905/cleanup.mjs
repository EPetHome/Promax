// One-off cleanup: inspect by default; --apply moves verified empty projects to Trash.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const root = '/Users/Admin/Promax'
const runtime = '/Users/Admin/.dsh-promax'
const evidence = dirname(fileURLToPath(import.meta.url))
const names = ['通用', '脱敏联调0829', '脱敏联调复验0829', '脱敏General静态联调0829', '脱敏JudgeR2静态联调0829']
const ledgerTemplates = [
  '# 来源台账\n\n> 由 Promax 管理。正式结果写入 deliverables。\n',
  '# 来源台账\n\n> 由 Promax 管理。团队只读取“输入”，正式结果写入“产出”。\n',
]
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
async function rpc(method, payload = {}) {
  const response = await fetch(`http://127.0.0.1:3080/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload }),
    signal: AbortSignal.timeout(30_000),
  })
  assert(response.ok, `${method}: HTTP ${response.status}`)
  const result = (await response.json()).result
  assert(result.ok, `${method}: ${JSON.stringify(result.error)}`)
  return result.value
}
function inventory(path, prefix = '') {
  const files = []
  assert(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink())
  for (const name of readdirSync(path).sort()) {
    const absolute = join(path, name), relative = prefix + name, stat = lstatSync(absolute)
    assert(!stat.isSymbolicLink(), `Symlink: ${absolute}`)
    if (stat.isDirectory()) files.push(...inventory(absolute, relative + '/'))
    else {
      assert(stat.isFile() && ['project.yml', '.promax/source-ledger.md'].includes(relative), `Nonempty project: ${absolute}`)
      if (relative === '.promax/source-ledger.md') assert(ledgerTemplates.includes(readFileSync(absolute, 'utf8')), `Edited ledger: ${absolute}`)
      files.push({ relative, hash: hash(absolute) })
    }
  }
  return files
}
function inspectEmptySessions(sessions, projectPath) {
  return sessions.filter(session => session.cwd === projectPath).map(session => {
    assert(session.blank && !session.running, `Nonempty or running session: ${session.sessionId}`)
    const logs = readdirSync(join(runtime, 'sessions')).flatMap(group => {
      const path = join(runtime, 'sessions', group, session.sessionId, 'session.jsonl.zstd')
      return existsSync(path) ? [path] : []
    })
    assert.equal(logs.length, 1, `Missing/ambiguous session log: ${session.sessionId}`)
    const lines = zstdDecompressSync(readFileSync(logs[0])).toString().trim().split('\n').map(JSON.parse)
    assert.equal(lines.length, 1, `Session has events: ${session.sessionId}`)
    assert.equal(lines[0].type, 'session')
    assert.equal(lines[0].cwd, projectPath)
    return { sessionId: session.sessionId, path: logs[0], hash: hash(logs[0]) }
  })
}

const workspaces = await rpc('workspace.list'), sessions = await rpc('session.list')
const projects = names.map(name => {
  const path = join(root, name), workspace = workspaces.items.find(item => item.path === path)
  assert(workspace, `Missing registration: ${name}`)
  assert.equal(workspace.sessionIds.length, 0, `Registered sessions: ${name}`)
  return { name, path, workspace, files: inventory(path), emptySessions: inspectEmptySessions(sessions.items, path) }
})
writeFileSync(join(evidence, 'inventory.json'), JSON.stringify(projects, null, 2) + '\n')
console.log(JSON.stringify({ verifiedEmptyProjects: projects.map(project => project.name) }))
if (process.argv.includes('--apply')) {
  const trash = join('/Users/Admin/.Trash', `Promax-empty-projects-${Date.now()}`)
  mkdirSync(trash)
  copyFileSync(join(runtime, 'storages/workspace.json'), join(evidence, 'workspace-before.json'))
  const completed = []
  for (const project of projects) {
    const current = (await rpc('workspace.list')).items.find(item => item.workspaceId === project.workspace.workspaceId)
    assert(current && current.path === project.path && current.sessionIds.length === 0)
    assert.deepEqual(inspectEmptySessions((await rpc('session.list')).items, project.path), project.emptySessions)
    assert.deepEqual(inventory(project.path), project.files)
    const destination = join(trash, project.name)
    renameSync(project.path, destination)
    try {
      await rpc('workspace.delete', { workspaceId: project.workspace.workspaceId })
    } catch (error) {
      const remains = (await rpc('workspace.list')).items.some(item => item.workspaceId === project.workspace.workspaceId)
      if (remains) { renameSync(destination, project.path); throw error }
    }
    completed.push({ ...project, destination })
    writeFileSync(join(evidence, 'deleted.json'), JSON.stringify(completed, null, 2) + '\n')
  }
  const remaining = await rpc('workspace.list')
  for (const project of completed) {
    assert(!existsSync(project.path))
    assert(!remaining.items.some(item => item.workspaceId === project.workspace.workspaceId))
    assert.deepEqual(inventory(project.destination), project.files)
    for (const session of project.emptySessions) assert.equal(hash(session.path), session.hash)
  }
  console.log(JSON.stringify({ removed: completed.map(project => project.name), trash, remainingProjectCount: remaining.items.filter(item => dirname(item.path) === root).length }))
}
