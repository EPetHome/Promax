// @vitest-environment node
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createRecycleBin, type RecycleHost } from '../src/recycle-bin.ts'

it('recycles only owned data, restores original identities, rejects unsafe operations and survives restarts', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'promax-recycle-'))
  const root = join(temp, 'projects')
  const home = join(temp, 'dsh')
  const project = { id: 'project-a', path: join(root, '产品'), title: '产品', sessionIds: ['s1', 's2'] }
  const headers = [{ id: 's1', cwd: project.path }, { id: 's2', cwd: project.path }, { id: 'child', cwd: project.path, origin: 'subagent', parentSession: 's1' }]
  const logs = (id: string): string => join(home, 'sessions', 'encoded', id, 'session.jsonl')
  const files = new Map<string, string>([
    [join(project.path, '.promax/session-scopes/s1.json'), JSON.stringify({ sessionId: 's1', taskKey: '任务甲', sessionName: '任务甲' })],
    [join(project.path, '.promax/session-scopes/s2.json'), JSON.stringify({ sessionId: 's2', taskKey: '任务乙', sessionName: '任务乙' })],
    [join(project.path, 'deliverables/任务甲/result.md'), '甲产出'],
    [join(project.path, '.promax/input/任务甲/source.txt'), '冻结输入'],
    [join(project.path, '.promax/tasks/任务甲/manifest.yml'), '任务清单'],
    [join(project.path, '.promax/judge/任务甲/judge.md'), 'Judge'],
    [join(project.path, '输入/源文件/s1/input.txt'), '专属附件'],
    [join(project.path, '输入/源文件/共享.txt'), '共享附件保留'],
    [join(project.path, 'deliverables/任务乙/result.md'), '乙产出保留'],
    [join(home, '.promax/dispatch-plans/s1.planning.json'), '计划'],
    ...headers.map(header => [logs(header.id), JSON.stringify(header)] as [string, string]),
  ])
  for (const [path, content] of files) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content) }
  const live: ReturnType<RecycleHost['agents']['list']> = []
  const host: RecycleHost = {
    workspaceRegistry: { get: id => id === project.id ? project : undefined, delete: vi.fn(async () => true) },
    sessionPersistence: { list: async () => headers.filter(header => files.has(logs(header.id))), locate: header => ({ kind: 'jsonl', path: logs(header.id) }) },
    agents: {
      list: () => live,
      create: async options => {
        const agent = { id: String(options.sessionId), session: { header: headers.find(header => header.id === options.sessionId)! }, status: 'idle', inbox: { hasPending: false }, runMaintenance: async <T>(task: () => Promise<T>) => task() }
        live.push(agent)
        return { agent, dispose: async () => { live.splice(live.indexOf(agent), 1) } }
      },
      resume: vi.fn(),
    },
    sessions: { flush: async () => {} },
    apiProxy: { sessions: { prompt: vi.fn(async () => ({ accepted: true })), list: async () => ({ result: { ok: true, value: { items: headers.map(header => ({ sessionId: header.id })) } } }) } },
  }
  let bin = await createRecycleBin(host, root, home)
  try {
    const handle = await host.agents.create({ sessionId: 's1' })
    handle.agent.status = 'running'
    const target = { kind: 'session' as const, workspaceId: project.id, sessionId: 's1' }
    await expect(bin.preview(target)).rejects.toThrow('先停止')
    handle.agent.status = 'idle'
    let preview = await bin.preview(target)
    expect(preview).toMatchObject({ title: '任务甲', sessionCount: 1, fileCount: 9 })
    await writeFile(join(project.path, 'deliverables/任务甲/result.md'), '改过的甲产出')
    await expect(bin.remove(target, preview.revision)).rejects.toThrow('内容已变化')
    expect(bin.list().items).toHaveLength(0)
    preview = await bin.preview(target)
    const deleted = await bin.remove(target, preview.revision)
    expect(live).toHaveLength(0)
    await expect(host.apiProxy.sessions!.prompt!({ payload: { sessionId: 's1' } })).resolves.toMatchObject({ result: { ok: false, error: { message: expect.stringContaining('已删除') } } })
    expect(() => bin.beginRequest({ sessionId: 'child' })).toThrow('已删除')
    await expect(readFile(logs('s1'))).rejects.toThrow()
    await expect(readFile(join(project.path, 'deliverables/任务甲/result.md'))).rejects.toThrow()
    expect(await readFile(join(project.path, '输入/源文件/共享.txt'), 'utf8')).toBe('共享附件保留')
    expect(await readFile(join(project.path, 'deliverables/任务乙/result.md'), 'utf8')).toBe('乙产出保留')
    const nestedPreview = await bin.preview({ kind: 'project', workspaceId: project.id })
    expect(nestedPreview.sessionCount).toBe(2)
    const nestedDeletion = await bin.remove(nestedPreview, nestedPreview.revision)
    expect(bin.list().items).toHaveLength(1)
    await bin.restore(nestedDeletion.id)
    expect(bin.list().items.map(item => item.id)).toEqual([deleted.id])
    await mkdir(join(project.path, 'deliverables/任务甲'), { recursive: true })
    await expect(bin.restore(deleted.id)).rejects.toThrow('同名文件')
    await rm(join(project.path, 'deliverables/任务甲'), { recursive: true })
    bin.dispose()
    bin = await createRecycleBin(host, root, home)
    await bin.restore(deleted.id)
    expect(bin.list().items).toHaveLength(0)
    expect(await readFile(logs('s1'), 'utf8')).toBe(files.get(logs('s1')))
    expect(await readFile(join(project.path, 'deliverables/任务甲/result.md'), 'utf8')).toBe('改过的甲产出')
    expect(project.id).toBe('project-a')
    await expect(bin.preview({ kind: 'session', workspaceId: project.id, sessionId: '../s1' })).rejects.toThrow()
    await expect(bin.preview({ kind: 'session', workspaceId: 'wrong-project', sessionId: 's1' })).rejects.toThrow()
    const external = join(temp, 'external.txt')
    await writeFile(external, '外部文件')
    await symlink(external, join(project.path, '外部链接'))
    const projectPreview = await bin.preview({ kind: 'project', workspaceId: project.id })
    const removedProject = await bin.remove(projectPreview, projectPreview.revision)
    expect(bin.wasDeleted(project.path)).toBe(true)
    expect(await readFile(external, 'utf8')).toBe('外部文件')
    await bin.restore(removedProject.id)
    const nextPreview = await bin.preview(projectPreview)
    const again = await bin.remove(nextPreview, nextPreview.revision)
    await bin.purge(again.id)
    expect(host.workspaceRegistry.delete).toHaveBeenCalledWith(project.id)
    expect(bin.list().items).toHaveLength(0)
    await expect(readdir(join(home, 'promax/recycle-bin', again.id, 'files'))).rejects.toThrow()
    await expect(bin.restore(again.id)).rejects.toThrow('不存在')
    bin.dispose()
    bin = await createRecycleBin(host, root, home)
    expect(() => bin.assertAllowed({ sessionId: 's1' })).toThrow('已删除')
    expect(bin.wasDeleted(project.path)).toBe(true)
  } finally { bin.dispose(); await rm(temp, { recursive: true, force: true }) }
})
