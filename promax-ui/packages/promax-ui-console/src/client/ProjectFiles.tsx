import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/icons.tsx'
import { TaskFileContent, type TaskFilePreview } from './TaskOutputs.tsx'

export interface ProjectFileEntry { name: string; relativePath: string; kind: 'directory' | 'file' | 'unavailable' }
export interface ProjectFileListing { relativePath: string; items: ProjectFileEntry[]; truncated: boolean }
export interface ProjectFileActions {
  listProjectFiles(input: { workspaceId: string; relativePath: string }): Promise<ProjectFileListing>
  readProjectFile(input: { workspaceId: string; relativePath: string }): Promise<TaskFilePreview>
  revealProjectFile(input: { workspaceId: string; relativePath: string }): Promise<void>
}

function label(path: string, name: string): string {
  return ({ '输入': '输入材料', deliverables: '产物', '.promax': '项目记录', '.promax/judge': '审核记录' } as Record<string, string>)[path] ?? name
}

function Directory({ entry, root = false, target, selected, currentTaskPath, revision, list, onSelect }: {
  entry: ProjectFileEntry; root?: boolean; target: string; selected: string; currentTaskPath: string | undefined; revision: number
  list(path: string): Promise<ProjectFileListing>; onSelect(entry: ProjectFileEntry): void
}) {
  const containsTarget = target === entry.relativePath || target.startsWith(`${entry.relativePath}/`)
  const [expanded, setExpanded] = useState(root || containsTarget)
  const [result, setResult] = useState<ProjectFileListing>()
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const node = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (root || containsTarget) setExpanded(true) }, [target, root, containsTarget])
  useEffect(() => { node.current?.scrollIntoView?.({ block: 'nearest' }) }, [selected, result])
  useEffect(() => {
    if (!expanded) return
    let active = true
    setError(undefined)
    void list(entry.relativePath).then(value => { if (active) setResult(value) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [list, entry.relativePath, expanded, revision, retry])
  const row = (item: ProjectFileEntry, directory: boolean) => <button ref={selected === item.relativePath ? node : undefined} type="button" className="promax-project-file-row" aria-current={selected === item.relativePath ? 'location' : undefined} aria-expanded={directory ? expanded : undefined} disabled={item.kind === 'unavailable'} title={`${item.relativePath || item.name}${item.kind === 'unavailable' ? '（不支持链接或特殊文件）' : ''}`} onClick={() => { onSelect(item); if (directory) setExpanded(value => !value) }}>
    {directory ? <span className={expanded ? 'is-expanded' : ''}><Icon name="chevronRight" size={12} /></span> : <span className="promax-file-indent" />}
    <Icon name={directory ? 'folder' : 'artifact'} size={15} /><span className="promax-file-row-name">{label(item.relativePath, item.name)}</span>{currentTaskPath === item.relativePath ? <small>当前会话</small> : null}
  </button>
  return <li>{row(entry, true)}{!expanded ? null : <ul>
    {error !== undefined ? <li className="promax-directory-notice" role="alert">读取失败：{error}<button type="button" onClick={() => { setRetry(value => value + 1) }}>重试</button></li>
      : result === undefined ? <li className="promax-directory-notice" role="status">正在读取…</li>
        : result.items.length === 0 ? <li className="promax-directory-notice">空目录</li>
          : result.items.map(item => item.kind === 'directory'
            ? <Directory key={item.relativePath} entry={item} target={target} selected={selected} currentTaskPath={currentTaskPath} revision={revision} list={list} onSelect={onSelect} />
            : <li key={item.relativePath}>{row(item, false)}</li>)}
    {result?.truncated ? <li className="promax-directory-notice">仅显示前 1,000 项，请在系统文件管理器中查看完整目录。</li> : null}
  </ul>}</li>
}

export function ProjectFiles({ workspaceId, title, targetPath, currentTaskPath, ...actions }: ProjectFileActions & {
  workspaceId: string; title: string; targetPath: string; currentTaskPath?: string
}) {
  const [selected, setSelected] = useState<ProjectFileEntry>({ name: title, relativePath: '', kind: 'directory' })
  const [target, setTarget] = useState(targetPath)
  const [revision, setRevision] = useState(0)
  const [message, setMessage] = useState('')
  const [revealing, setRevealing] = useState(false)
  const list = useMemo(() => (relativePath: string) => actions.listProjectFiles({ workspaceId, relativePath }), [actions.listProjectFiles, workspaceId])
  const read = useMemo(() => () => actions.readProjectFile({ workspaceId, relativePath: selected.relativePath }), [actions.readProjectFile, workspaceId, selected.relativePath, revision])
  const select = (entry: ProjectFileEntry) => { setSelected(entry); setMessage('') }
  useEffect(() => {
    let active = true
    setTarget(targetPath)
    setSelected({ name: title, relativePath: '', kind: 'directory' }); setMessage('')
    if (targetPath === '') return
    const parent = targetPath.split('/').slice(0, -1).join('/')
    void list(parent).then(value => {
      if (!active) return
      const entry = value.items.find(item => item.relativePath === targetPath)
      if (entry === undefined) setMessage('定位的文件或目录尚未生成，已保留项目结构。')
      else setSelected(entry)
    }).catch(reason => { if (active) setMessage(`定位失败：${reason instanceof Error ? reason.message : String(reason)}；仍可从项目根目录浏览。`) })
    return () => { active = false }
  }, [list, targetPath, title])
  const parts = selected.relativePath === '' ? [] : selected.relativePath.split('/')
  return <section className="promax-project-files" aria-label="项目文件">
    <div className="promax-project-files-toolbar"><h1>项目文件</h1><button className="toolbar-button" type="button" onClick={() => { setRevision(value => value + 1) }}><Icon name="refresh" size={14} />刷新</button></div>
    <div className="promax-project-files-body">
      <nav className="promax-project-directory" aria-label="项目目录树"><ul><Directory entry={{ name: title, relativePath: '', kind: 'directory' }} root target={target} selected={selected.relativePath} currentTaskPath={currentTaskPath} revision={revision} list={list} onSelect={select} /></ul></nav>
      <div className="promax-project-file-detail">
        <div className="promax-project-file-location"><nav aria-label="文件位置"><button type="button" onClick={() => { select({ name: title, relativePath: '', kind: 'directory' }) }}>{title}</button>{parts.map((name, index) => {
          const path = parts.slice(0, index + 1).join('/')
          return <span key={path}><span aria-hidden="true">/</span><button type="button" aria-current={index === parts.length - 1 ? 'location' : undefined} title={path} onClick={() => { select({ name, relativePath: path, kind: index === parts.length - 1 ? selected.kind : 'directory' }); setTarget(path) }}>{label(path, name)}</button></span>
        })}</nav><details className="promax-file-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false }}><summary aria-label={`文件操作：${selected.name}`} title="文件操作"><Icon name="more" size={17} /></summary><button type="button" disabled={revealing || selected.kind === 'unavailable'} onClick={event => {
          event.currentTarget.closest('details')?.removeAttribute('open'); setRevealing(true); setMessage('')
          void actions.revealProjectFile({ workspaceId, relativePath: selected.relativePath }).then(() => { setMessage('已在系统文件管理器中打开所在目录。') }).catch(reason => { setMessage(`打开失败：${reason instanceof Error ? reason.message : String(reason)}`) }).finally(() => { setRevealing(false) })
        }}>在系统文件管理器中显示</button></details></div>
        {message === '' ? null : <p className="promax-project-file-message" role="status">{message}</p>}
        {selected.kind === 'file' ? <TaskFileContent key={selected.relativePath} relativePath={selected.name} read={read} onBack={() => { select({ name: parts.at(-2) ?? title, relativePath: parts.slice(0, -1).join('/'), kind: 'directory' }) }} />
          : <div className="promax-project-folder-empty"><Icon name="folder" size={28} /><strong>{label(selected.relativePath, selected.name)}</strong><p>在左侧展开目录，选择文件即可预览。</p>{currentTaskPath !== undefined && selected.relativePath === currentTaskPath ? <small>当前会话的产物目录</small> : null}</div>}
      </div>
    </div>
  </section>
}
