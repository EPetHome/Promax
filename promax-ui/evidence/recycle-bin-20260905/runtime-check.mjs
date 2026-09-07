import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const evidence = new URL('.', import.meta.url)
const endpoint = 'http://127.0.0.1:3080'
const results = []
async function post(path, payload) {
  const response = await fetch(endpoint + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? JSON.stringify(body))
  return body
}
async function rpc(method, payload = {}) {
  const body = await post(`/api/${method}`, { type: 'client-request', rpcId: randomUUID(), method, payload })
  if (!body.result.ok) throw new Error(body.result.error.message)
  return body.result.value
}
async function remove(target) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const preview = await post('/promax-workspace-api/recycle/preview', target)
      const result = await post('/promax-workspace-api/recycle/delete', preview)
      return { ...result, preview }
    } catch (error) {
      if (!String(error).includes('有操作正在处理') && !String(error).includes('内容已变化')) throw error
    }
  }
  throw new Error('项目持续繁忙')
}
let project
let sessions
if (process.argv.includes('--resume-fixture')) {
  ({ project, sessions } = JSON.parse(await readFile(new URL('runtime-fixture.json', evidence), 'utf8')))
  for (const item of (await post('/promax-workspace-api/recycle/list', {})).items.filter(item => item.workspaceId === project.workspaceId)) await post('/promax-workspace-api/recycle/restore', { id: item.id })
} else {
project = await post('/promax-workspace-api/project', { projectName: `删除功能验收-${Date.now()}` })
await writeFile(new URL('runtime-fixture.json', evidence), JSON.stringify({ project }, null, 2))
sessions = []
for (const name of ['待删除会话', '保留会话']) {
  const { sessionId } = await rpc('session.create', { workspaceId: project.workspaceId, agentPreset: 'promax-team' })
  await rpc('session.rename', { sessionId, title: name })
  const { paths } = await post('/promax-workspace-api/attachments', { workspaceId: project.workspaceId, projectPath: project.path, sessionId, files: [{ name: '专属附件.txt', mediaType: 'text/plain', contentBase64: Buffer.from(`${name}附件`).toString('base64') }] })
  const frozen = await post('/promax-workspace-api/attachments/freeze', { workspaceId: project.workspaceId, projectPath: project.path, sessionId, demand: name, paths })
  const output = join(project.path, 'deliverables', frozen.taskKey, 'result.txt')
  await mkdir(join(project.path, 'deliverables', frozen.taskKey), { recursive: true })
  await writeFile(output, name)
  sessions.push({ sessionId, taskKey: frozen.taskKey, output })
}
const fixture = { project, sessions }
await writeFile(new URL('runtime-fixture.json', evidence), JSON.stringify(fixture, null, 2))

}
const fixture = { project, sessions }
const shared = join(project.path, '输入/源文件/共享.txt')
await writeFile(shared, '这份共享资料必须保留')
const target = { kind: 'session', workspaceId: project.workspaceId, sessionId: sessions[0].sessionId }
const deleted = await remove(target)
assert.equal(deleted.preview.title, '待删除会话')
assert.equal(deleted.preview.sessionCount, 1)
await assert.rejects(access(sessions[0].output))
assert.equal(await readFile(shared, 'utf8'), '这份共享资料必须保留')
assert.equal(await readFile(sessions[1].output, 'utf8'), '保留会话')
assert(!(await rpc('session.list')).items.some(item => item.sessionId === target.sessionId))
await assert.rejects(rpc('session.prompt', { sessionId: target.sessionId, mode: 'queue', content: [{ type: 'text', text: '不会执行' }] }), /已删除/u)
results.push({ check: 'session-delete-isolated-and-stale-rpc-blocked', preview: deleted.preview, passed: true })
await post('/promax-workspace-api/recycle/restore', { id: deleted.id })
assert.equal(await readFile(sessions[0].output, 'utf8'), '待删除会话')
assert((await rpc('session.list')).items.some(item => item.sessionId === target.sessionId))
// Resume the same identity after restore: verifies that live owners were disposed and can reopen safely.
await rpc('session.create', { workspaceId: project.workspaceId, sessionId: target.sessionId, agentPreset: 'promax-team' })
await rpc('session.rename', { sessionId: target.sessionId, title: '待删除会话' })
results.push({ check: 'restore-original-session-and-resume', passed: true })
const projectDeletion = await remove({ kind: 'project', workspaceId: project.workspaceId })
await assert.rejects(access(project.path))
assert(!(await rpc('workspace.list')).items.some(item => item.workspaceId === project.workspaceId))
await post('/promax-workspace-api/recycle/restore', { id: projectDeletion.id })
assert((await rpc('workspace.list')).items.some(item => item.workspaceId === project.workspaceId))
assert.equal(await readFile(shared, 'utf8'), '这份共享资料必须保留')
results.push({ check: 'project-delete-restore-stable-id', preview: projectDeletion.preview, passed: true })
const secondDeletion = await remove(target)
await post('/promax-workspace-api/recycle/purge', { id: secondDeletion.id })
await assert.rejects(post('/promax-workspace-api/recycle/restore', { id: secondDeletion.id }), /不存在/u)
await assert.rejects(access(sessions[0].output))
results.push({ check: 'permanent-delete', passed: true })
const files = async path => {
  const rows = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name)
    if (entry.isDirectory()) rows.push(...await files(file))
    else rows.push({ file, sha256: createHash('sha256').update(await readFile(file)).digest('hex') })
  }
  return rows
}
await writeFile(new URL('runtime-results.json', evidence), JSON.stringify({ fixture, results, survivingFiles: await files(project.path) }, null, 2))
console.log(JSON.stringify({ results, project, session: sessions[1] }, null, 2))
