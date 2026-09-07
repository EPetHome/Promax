import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

interface Header { id: string; cwd?: string; parentSession?: string; origin?: string }
interface Workspace { id: string; path: string; title: string; sessionIds: readonly string[] }
interface LiveAgent {
  id: string
  status: string
  session: { header: Header }
  inbox: { hasPending: boolean }
  runMaintenance<T>(task: () => Promise<T>): Promise<T>
}
interface AgentHandle { agent: LiveAgent; dispose(): Promise<void> }
type Rpc = (request: { rpcId?: string; payload?: Record<string, unknown> }, ...rest: unknown[]) => unknown
export interface RecycleHost {
  workspaceRegistry: { get?(id: string): Workspace | undefined; delete?(id: string): Promise<boolean> }
  sessionPersistence: { list(): Promise<Header[]>; locate(header: Header): { path: string; kind: string } | undefined }
  agents: { list(): LiveAgent[]; create(options: Record<string, unknown>): Promise<AgentHandle>; resume(options: Record<string, unknown>): Promise<AgentHandle> }
  sessions: { flush(session: LiveAgent['session']): Promise<unknown> }
  apiProxy: Record<string, Record<string, Rpc>>
}
export interface DeleteTarget { kind: 'project' | 'session'; workspaceId: string; sessionId?: string }
interface Move { from: string; to: string }
export interface DeletePreview extends DeleteTarget {
  title: string
  projectTitle: string
  sessionCount: number
  fileCount: number
  bytes: number
  revision: string
}
interface Entry extends DeletePreview {
  id: string
  deletedAt: string
  projectPath: string
  sessionIds: string[]
  moves: Move[]
  state: 'deleting' | 'trashed' | 'restoring' | 'purging' | 'purged'
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
function segment(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value === '.' || value === '..' || /[/\\\0]/u.test(value)) throw new Error('删除目标无效')
  return value
}
function within(root: string, path: string): boolean { return resolve(path).startsWith(`${resolve(root)}${sep}`) }

/** Symlinks are moved as links, never traversed; parents must be real directories. */
async function safeParents(root: string, path: string): Promise<void> {
  if (!within(root, path)) throw new Error('文件不属于目标项目')
  for (let dir = dirname(path); within(root, dir) || dir === root; dir = dirname(dir)) {
    try { if ((await lstat(dir)).isSymbolicLink()) throw new Error('目录包含符号链接，无法安全删除或恢复') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (dir === root) break
  }
}

async function inventory(paths: string[]): Promise<{ fileCount: number; bytes: number; revision: string }> {
  let fileCount = 0
  let bytes = 0
  const hash = createHash('sha256')
  async function walk(path: string): Promise<void> {
    const info = await lstat(path)
    hash.update(JSON.stringify([path, info.size, info.mtimeMs, info.ino]))
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await walk(join(path, name))
    } else { fileCount++; bytes += info.size }
  }
  for (const path of paths.sort()) await walk(path)
  return { fileCount, bytes, revision: hash.digest('hex') }
}

/** Local single-host recycle bin; registry identities stay stable until permanent removal. */
export async function createRecycleBin(host: RecycleHost, projectRoot: string, dshHome: string) {
  if (host.workspaceRegistry.delete === undefined) throw new Error('当前运行环境不支持项目回收')
  const root = join(dshHome, 'promax', 'recycle-bin')
  const statePath = join(root, 'state.json')
  const sessionRoot = join(dshHome, 'sessions')
  await mkdir(root, { recursive: true, mode: 0o700 })
  let entries: Entry[] = await exists(statePath) ? JSON.parse(await readFile(statePath, 'utf8')) as Entry[] : []
  // ponytail: one local host serializes mutations; use a filesystem lock if multiple hosts share this store.
  let busy = false
  let activeRequests = 0
  const lockedPaths = new Set<string>()
  let headers = new Map<string, Header>()
  const handles = new Map<string, AgentHandle>()
  const blocked = (id: string): boolean => entries.some(entry => entry.sessionIds.includes(id))
  const blockedWorkspace = (id: string): boolean => entries.some(entry => entry.kind === 'project' && entry.workspaceId === id)
  const blockedPath = (path: string): boolean => [...lockedPaths].some(root => path === root || within(root, path))
    || entries.some(entry => entry.kind === 'project' && entry.state !== 'purged' && (path === entry.projectPath || within(entry.projectPath, path)))
  async function save(): Promise<void> {
    const temp = `${statePath}.tmp`
    await writeFile(temp, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, statePath)
  }
  async function refreshHeaders(): Promise<void> {
    headers = new Map((await host.sessionPersistence.list()).map(header => [header.id, header]))
    for (const agent of host.agents.list()) headers.set(agent.id, agent.session.header)
  }
  function assertAllowed(input: Record<string, unknown>): void {
    for (const key of ['sessionId', 'parentSessionId', 'childSessionId', 'sourceSessionId']) {
      const id = input[key]
      if (typeof id === 'string' && (blocked(id) || (headers.get(id)?.cwd !== undefined && blockedPath(resolve(headers.get(id)!.cwd!))))) throw new Error('该会话已删除或正在删除，请先从回收站恢复')
    }
    const workspaceId = input.workspaceId
    if (typeof workspaceId === 'string') {
      if (blockedWorkspace(workspaceId)) throw new Error('该项目已删除，请先从回收站恢复')
      const workspace = host.workspaceRegistry.get?.(workspaceId)
      if (workspace !== undefined && blockedPath(resolve(workspace.path))) throw new Error('项目正在删除，请稍后重试')
    }
    for (const key of ['path', 'cwd', 'projectPath']) {
      if (typeof input[key] === 'string' && blockedPath(resolve(input[key]))) throw new Error('该项目已在回收站，请先恢复或永久删除')
    }
  }
  async function rollback(entry: Entry): Promise<void> {
    for (const move of [...entry.moves].reverse()) {
      if (!await exists(move.to)) continue
      if (await exists(move.from)) throw new Error(`恢复位置已有文件，已保留回收站副本：${move.from}`)
      await safeParents(within(projectRoot, move.from) ? projectRoot : dshHome, move.from)
      await mkdir(dirname(move.from), { recursive: true })
      await rename(move.to, move.from)
    }
  }
  async function finishPurge(entry: Entry): Promise<void> {
    if (entry.kind === 'project') {
      for (const child of entries.filter(item => item.kind === 'session' && item.workspaceId === entry.workspaceId && item.state !== 'purged')) {
        child.state = 'purging'
        await save()
        await finishPurge(child)
      }
    }
    await rm(join(root, entry.id, 'files'), { recursive: true, force: true })
    if (entry.kind === 'project') await host.workspaceRegistry.delete!(entry.workspaceId)
    // Keep only identity tombstones: stale tabs must not recreate a deleted conversation.
    entry.state = 'purged'
    entry.title = ''
    entry.projectTitle = ''
    entry.moves = []
    await save()
  }
  // Complete or roll back an interrupted filesystem transaction before exposing the app.
  for (const entry of [...entries]) {
    if (entry.state === 'deleting' || entry.state === 'restoring') {
      await rollback(entry)
      entries = entries.filter(item => item.id !== entry.id)
      await save()
    } else if (entry.state === 'purging') await finishPurge(entry)
  }
  await refreshHeaders()

  async function scope(target: DeleteTarget): Promise<DeletePreview & { projectPath: string; sessionIds: string[]; paths: string[]; fileRevision: string }> {
    assertAllowed(target as unknown as Record<string, unknown>)
    const workspace = host.workspaceRegistry.get?.(segment(target.workspaceId))
    if (workspace === undefined || dirname(resolve(workspace.path)) !== resolve(projectRoot)) throw new Error('只能删除已登记的 Promax 项目')
    const projectPath = resolve(workspace.path)
    if ((await lstat(projectPath)).isSymbolicLink()) throw new Error('不能删除符号链接项目')
    await refreshHeaders()
    const owned = [...headers.values()].filter(header => !blocked(header.id) && header.cwd !== undefined && (resolve(header.cwd) === projectPath || within(projectPath, header.cwd)))
    let ids: Set<string>
    let title = workspace.title
    const paths: string[] = []
    const nested = target.kind === 'project' ? entries.filter(entry => entry.kind === 'session' && entry.workspaceId === workspace.id && entry.state === 'trashed') : []
    if (target.kind === 'project') {
      ids = new Set([...owned.map(header => header.id), ...workspace.sessionIds.filter(id => !blocked(id))])
      paths.push(projectPath)
    } else if (target.kind === 'session') {
      const id = segment(target.sessionId)
      if (!owned.some(header => header.id === id) && !workspace.sessionIds.includes(id)) throw new Error('会话不属于该项目')
      ids = new Set([id])
      const scopePath = join(projectPath, '.promax', 'session-scopes', `${id}.json`)
      await safeParents(projectRoot, scopePath)
      title = id
      if (await exists(scopePath)) {
        if ((await lstat(scopePath)).isSymbolicLink()) throw new Error('会话范围文件不能是符号链接')
        const mapping = JSON.parse(await readFile(scopePath, 'utf8')) as Record<string, unknown>
        const key = segment(mapping.taskKey)
        if (mapping.sessionId !== id || mapping.sessionName !== key) throw new Error('会话范围文件不一致，未删除任何文件')
        for (const name of await readdir(dirname(scopePath))) {
          if (name === `${id}.json` || !name.endsWith('.json')) continue
          const other = JSON.parse(await readFile(join(dirname(scopePath), name), 'utf8')) as Record<string, unknown>
          if (other.taskKey === key) throw new Error('该产出目录由多个会话共享，请先整理关联后再删除')
        }
        title = key
        paths.push(scopePath, join(projectPath, 'deliverables', key), ...['input', 'tasks', 'judge'].map(dir => join(projectPath, '.promax', dir, key)))
      }
    } else throw new Error('删除类型无效')
    // Include delegated descendants even with a distinct cwd, but retain independent forks.
    let added = true
    while (added) {
      added = false
      for (const header of headers.values()) if (header.origin === 'subagent' && header.parentSession !== undefined && ids.has(header.parentSession) && !ids.has(header.id)) { ids.add(header.id); added = true }
    }
    for (const id of ids) {
      if (target.kind === 'session') paths.push(join(projectPath, '输入', '源文件', segment(id)))
      const header = headers.get(id)
      if (header !== undefined) {
        const location = host.sessionPersistence.locate(header)
        if (location?.kind !== 'jsonl' || !within(sessionRoot, location.path)) throw new Error('当前会话存储不支持安全回收')
        paths.push(dirname(location.path))
      }
      for (const suffix of ['planning', 'confirmed']) paths.push(join(dshHome, '.promax', 'dispatch-plans', `${segment(id)}.${suffix}.json`))
    }
    const present: string[] = []
    for (const path of [...new Set(paths)]) {
      await safeParents(within(projectRoot, path) ? projectRoot : dshHome, path)
      if (await exists(path)) present.push(path)
    }
    const live = host.agents.list().filter(agent => ids.has(agent.id) || (target.kind === 'project' && agent.session.header.cwd !== undefined && resolve(agent.session.header.cwd) === projectPath))
    if (live.some(agent => agent.status !== 'idle' || agent.inbox.hasPending)) throw new Error('有任务正在运行或等待执行，请先停止任务再删除')
    if (live.some(agent => handles.get(agent.id)?.agent !== agent)) throw new Error('会话来自旧运行环境，请重启 Promax 后再删除')
    const counts = await inventory(present)
    return { ...target, title, projectTitle: workspace.title, projectPath, sessionIds: [...new Set([...ids, ...nested.flatMap(entry => entry.sessionIds)])], paths: present,
      sessionCount: [...ids].filter(id => headers.get(id)?.origin !== 'subagent').length + nested.reduce((sum, entry) => sum + entry.sessionCount, 0),
      fileCount: counts.fileCount + nested.reduce((sum, entry) => sum + entry.fileCount, 0), bytes: counts.bytes + nested.reduce((sum, entry) => sum + entry.bytes, 0),
      fileRevision: counts.revision, revision: createHash('sha256').update(JSON.stringify([counts.revision, nested.map(entry => [entry.id, entry.revision])])).digest('hex'),
    }
  }
  async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (busy || activeRequests > 0) throw new Error('有操作正在处理，请稍后重试')
    busy = true
    try { return await fn() } finally { busy = false; lockedPaths.clear() }
  }
  async function holdingAgents<T>(ids: string[], operation: () => Promise<T>): Promise<T> {
    const agents = host.agents.list().filter(agent => ids.includes(agent.id))
    const enter = (index: number): Promise<T> => {
      const agent = agents[index]
      if (agent === undefined) return operation()
      if (agent.status !== 'idle' || agent.inbox.hasPending) throw new Error('任务仍在运行，请先停止任务再删除')
      return agent.runMaintenance(async () => { await host.sessions.flush(agent.session); return enter(index + 1) })
    }
    return enter(0)
  }
  function list() {
    return { items: entries.filter(entry => entry.state === 'trashed' && (entry.kind === 'project' || !blockedWorkspace(entry.workspaceId))).map(({ moves: _moves, sessionIds: _ids, projectPath: _path, state: _state, ...entry }) => entry) }
  }
  const disposers: Array<() => void> = []
  // Retain the public lifecycle capability returned to each creator; never tear down a bare Agent.
  for (const method of ['create', 'resume'] as const) {
    const original = host.agents[method]
    host.agents[method] = async function (options) {
      if (busy) throw new Error('回收站正在处理，请稍后重试')
      assertAllowed({ ...options, sessionId: options.sessionId ?? options.resumeSessionId, ...(options.meta as object | undefined) })
      activeRequests++
      try {
        const handle = await original.call(this, options)
        handles.set(handle.agent.id, handle)
        headers.set(handle.agent.id, handle.agent.session.header)
        return handle
      } finally { activeRequests-- }
    }
    disposers.push(() => { host.agents[method] = original })
  }
  // Reuse the native gateway. This also rejects stale tabs, direct RPC calls and queued submissions.
  for (const group of ['sessions', 'workspace', 'subagents', 'goals']) {
    const methods = host.apiProxy[group]
    if (methods === undefined) continue
    for (const [name, original] of Object.entries(methods)) {
      methods[name] = (request, ...rest) => {
        try {
          if (busy) throw new Error('回收站正在处理，请稍后重试')
          assertAllowed(request.payload ?? {})
        } catch (error) {
          return Promise.resolve({ rpcId: request.rpcId, result: { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } } })
        }
        const result = original(request, ...rest)
        if (!(result instanceof Promise)) return result
        activeRequests++
        return result.then(value => {
          if ((name === 'list' || name === 'search') && value?.result?.ok) {
            const items = value.result.value.items
            if (Array.isArray(items)) value.result.value.items = items.filter((item: { workspaceId?: string; sessionId?: string }) => group === 'workspace' ? !blockedWorkspace(item.workspaceId ?? '') : !blocked(item.sessionId ?? ''))
          }
          return value
        }).finally(() => { activeRequests-- })
      }
      disposers.push(() => { methods[name] = original })
    }
  }
  return {
    list,
    assertAllowed,
    beginRequest: (input: Record<string, unknown>) => {
      if (busy) throw new Error('回收站正在处理，请稍后重试')
      assertAllowed(input)
      activeRequests++
      return () => { activeRequests-- }
    },
    // A tombstone prevents bootstrap from silently recreating a deleted default project.
    wasDeleted: (path: string) => entries.some(entry => entry.kind === 'project' && entry.projectPath === resolve(path)),
    dispose: () => { for (const dispose of disposers) dispose() },
    preview: async (target: DeleteTarget): Promise<DeletePreview> => {
      const { paths: _paths, projectPath: _path, sessionIds: _ids, fileRevision: _revision, ...preview } = await scope(target)
      return preview
    },
    remove: (target: DeleteTarget, revision: string) => exclusive(async () => {
      const plan = await scope(target)
      lockedPaths.add(plan.projectPath)
      const entry = await holdingAgents(plan.sessionIds, async () => {
        if (plan.revision !== revision || (await inventory(plan.paths)).revision !== plan.fileRevision) throw new Error('内容已变化，请关闭弹窗后重新确认删除范围')
        const id = randomUUID()
        const { paths, fileRevision: _revision, ...data } = plan
        const entry: Entry = { ...data, id, deletedAt: new Date().toISOString(), state: 'deleting', moves: paths.map((from, index) => ({ from, to: join(root, id, 'files', String(index)) })) }
        entries.push(entry)
        try { await save() } catch (error) { entries = entries.filter(item => item.id !== id); throw error }
        return entry
      })
      try {
        // Release idle maintenance before disposing: disposal itself waits for maintenance to drain.
        for (const id of [...entry.sessionIds].reverse()) {
          const handle = handles.get(id)
          if (handle === undefined) continue
          await handle.dispose()
          handles.delete(id)
        }
        await mkdir(join(root, entry.id, 'files'), { recursive: true })
        for (const move of entry.moves) await rename(move.from, move.to)
        entry.state = 'trashed'
        await save()
        return { id: entry.id, ...list() }
      } catch (error) {
        await rollback(entry)
        entries = entries.filter(item => item.id !== entry.id)
        await save()
        throw error
      }
    }),
    restore: (id: string) => exclusive(async () => {
      const entry = entries.find(entry => entry.id === segment(id) && entry.state === 'trashed')
      if (entry === undefined) throw new Error('回收记录不存在')
      if (entry.kind === 'session' && blockedWorkspace(entry.workspaceId)) throw new Error('请先恢复所属项目，再恢复会话')
      if (await Promise.all(entry.moves.map(move => exists(move.from))).then(flags => flags.some(Boolean))) throw new Error('原位置已有同名文件，请先处理冲突；回收站内容仍保留')
      entry.state = 'restoring'
      await save()
      await rollback(entry)
      entries = entries.filter(item => item.id !== id)
      await save()
      await refreshHeaders()
      return { workspaceId: entry.workspaceId, ...list() }
    }),
    purge: (id: string) => exclusive(async () => {
      const entry = entries.find(entry => entry.id === segment(id) && (entry.state === 'trashed' || entry.state === 'purging'))
      if (entry === undefined) throw new Error('回收记录不存在')
      entry.state = 'purging'
      await save()
      await finishPurge(entry)
      return list()
    }),
  }
}
