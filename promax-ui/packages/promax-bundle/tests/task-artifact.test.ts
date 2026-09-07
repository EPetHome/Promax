import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { listProjectFiles, readTaskArtifact, resolveProjectFile } from '../src/task-artifact.ts'
import { resolveTaskDeliverableDirectory } from '../src/index.ts'

it('reads only this session output, rejects traversal and symlinks, and bounds previews', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promax-artifact-'))
  const output = join(root, 'deliverables', '需求 A')
  try {
    await mkdir(output, { recursive: true })
    await mkdir(join(root, '.promax', 'session-scopes'), { recursive: true })
    await writeFile(join(root, '.promax', 'session-scopes', 'session-a.json'), JSON.stringify({ sessionName: '需求 A', taskKey: '需求 A' }))
    await writeFile(join(output, 'prd.md'), '# 需求 A\n| 名称 | 内容 |\n|---|---|\n| 项目 | 验证 |')
    const directory = await resolveTaskDeliverableDirectory(root, { sessionId: 'session-a', taskKey: '需求 A' })
    await expect(readTaskArtifact(root, directory, 'prd.md')).resolves.toMatchObject({ kind: 'markdown', content: expect.stringContaining('# 需求 A') })
    await expect(resolveTaskDeliverableDirectory(root, { sessionId: 'session-a', taskKey: '需求 B' })).rejects.toThrow('不一致')
    for (const path of ['../../private.txt', '/etc/passwd', 'nested/../prd.md', 'nested\\prd.md']) await expect(readTaskArtifact(root, output, path)).rejects.toThrow('路径无效')
    await writeFile(join(root, 'private.txt'), 'private')
    await symlink(join(root, 'private.txt'), join(output, 'link.txt'))
    await symlink(root, join(output, 'outside'))
    await expect(readTaskArtifact(root, output, 'link.txt')).rejects.toThrow('符号链接')
    await expect(readTaskArtifact(root, output, 'outside/private.txt')).rejects.toThrow('符号链接')
    await expect(readTaskArtifact(root, output, 'missing.md')).rejects.toThrow()
    await writeFile(join(output, 'large.md'), 'x'.repeat(2 * 1024 * 1024 + 1))
    await expect(readTaskArtifact(root, output, 'large.md')).resolves.toMatchObject({ kind: 'unsupported', content: '' })
    await writeFile(join(output, 'report.pdf'), 'binary')
    await expect(readTaskArtifact(root, output, 'report.pdf')).resolves.toMatchObject({ kind: 'unsupported', content: '' })
    // The project browser can reach inputs, review records and other sessions, but never leave its root.
    await mkdir(join(root, '输入'), { recursive: true })
    await writeFile(join(root, '输入', '材料.txt'), '输入材料')
    await expect(readTaskArtifact(root, root, '输入/材料.txt')).resolves.toMatchObject({ content: '输入材料' })
    await expect(listProjectFiles(root, '')).resolves.toMatchObject({ relativePath: '', items: expect.arrayContaining([{ name: '输入', relativePath: '输入', kind: 'directory' }, { name: 'deliverables', relativePath: 'deliverables', kind: 'directory' }]), truncated: false })
    await expect(listProjectFiles(root, 'deliverables/需求 A')).resolves.toMatchObject({ items: expect.arrayContaining([{ name: 'link.txt', relativePath: 'deliverables/需求 A/link.txt', kind: 'unavailable' }]) })
    for (const invalid of ['../', '/etc', '输入/../../', '输入\\材料.txt']) await expect(listProjectFiles(root, invalid)).rejects.toThrow('路径无效')
    await expect(resolveProjectFile(root, 'deliverables/需求 A/outside/private.txt')).rejects.toThrow('符号链接')
    await expect(resolveProjectFile(root, '输入/材料.txt')).resolves.toContain('输入/材料.txt')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
