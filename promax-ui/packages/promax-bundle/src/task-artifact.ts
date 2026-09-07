import { constants } from 'node:fs'
import { open, opendir, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, resolve, sep } from 'node:path'

/** The caller has already verified the session's output directory. */
export async function resolveProjectFile(workspace: string, relativePath: string) {
  if (isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.includes('\0') || (relativePath !== '' && relativePath.split('/').some(part => part === '' || part === '.' || part === '..'))) throw new Error('文件路径无效')
  const root = await realpath(workspace)
  const path = resolve(root, relativePath)
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error('文件越出项目')
  if (await realpath(path) !== path) throw new Error('文件不得是符号链接')
  const info = await stat(path)
  if (!info.isFile() && !info.isDirectory()) throw new Error('不支持此文件类型')
  return path
}

export async function listProjectFiles(workspace: string, relativePath: string) {
  const path = await resolveProjectFile(workspace, relativePath)
  const items: Array<{ name: string; relativePath: string; kind: 'directory' | 'file' | 'unavailable' }> = []
  let truncated = false
  // ponytail: bound each directory to 1,000 entries; add pagination when real projects exceed it.
  for await (const entry of await opendir(path)) {
    if (entry.name === '.DS_Store') continue
    if (items.length === 1000) { truncated = true; break }
    items.push({ name: entry.name, relativePath: relativePath === '' ? entry.name : `${relativePath}/${entry.name}`, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'unavailable' })
  }
  items.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  return { relativePath, items, truncated }
}

export async function readTaskArtifact(workspace: string, directory: string, relativePath: string) {
  if (relativePath === '') throw new Error('文件路径无效')
  const root = await realpath(workspace)
  const output = await realpath(directory)
  if (output !== root && !output.startsWith(`${root}${sep}`)) throw new Error('文件目录越出项目')
  const path = await resolveProjectFile(output, relativePath)
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('产物不是普通文件')
    const extension = extname(path).toLowerCase()
    const kind = extension === '.md' ? 'markdown' : ['.txt', '.csv', '.json', '.yml', '.yaml', '.html', '.css', '.js', '.ts', '.xml', '.svg'].includes(extension) ? 'text' : 'unsupported'
    // Keep large/binary documents in their native application; bound the read itself.
    if (kind === 'unsupported' || info.size > 2 * 1024 * 1024) return { relativePath, kind: 'unsupported' as const, content: '', reason: info.size > 2 * 1024 * 1024 ? '文件超过 2 MiB，请通过“…”在系统文件管理器中查看。' : '此格式暂不支持预览，请通过“…”在系统文件管理器中查看。' }
    const buffer = Buffer.alloc(2 * 1024 * 1024 + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length > 2 * 1024 * 1024) throw new Error('文件过大，请在系统文件管理器中查看')
    return { relativePath, kind, content: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)) }
  } finally {
    await file.close()
  }
}
