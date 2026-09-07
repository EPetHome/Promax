import { useEffect, useMemo, useRef, useState } from 'react'
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'

export interface TaskFilePreview {
  relativePath: string
  kind: 'markdown' | 'text' | 'unsupported'
  content: string
  reason?: string
}

export function showTaskOutputs(sessionId: string, relativePath?: string): void {
  window.dispatchEvent(new CustomEvent('promax:show-outputs', { detail: { sessionId, relativePath } }))
}

export function TaskFileContent({ relativePath, read, onBack }: { relativePath: string; read(): Promise<TaskFilePreview>; onBack(): void }) {
  const [result, setResult] = useState<TaskFilePreview>()
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  useEffect(() => {
    let active = true
    setResult(undefined); setError(undefined)
    void read().then(value => { if (active) setResult(value) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [read, retry])
  const rendered = useMemo(() => result?.kind === 'markdown' ? micromark(result.content, { extensions: [gfm()], htmlExtensions: [gfmHtml()] }) : undefined, [result])
  return <section className="promax-file-preview" aria-label="文件预览">
    <header><button type="button" className="toolbar-button" onClick={onBack}>返回文件列表</button><h2 ref={heading} tabIndex={-1} title={relativePath}>{relativePath}</h2></header>
    {error !== undefined ? <div className="promax-output-empty" role="alert"><p>文件读取失败：{error}</p><button type="button" className="toolbar-button" onClick={() => { setRetry(value => value + 1) }}>重试</button></div>
      : result === undefined ? <div className="promax-output-empty" role="status">正在读取文件…</div>
        : result.kind === 'unsupported' ? <div className="promax-output-empty">{result.reason}</div>
          : rendered !== undefined ? <iframe title={`预览 ${relativePath}`} sandbox="" referrerPolicy="no-referrer" srcDoc={`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"><style>body{margin:24px;font:14px/1.85 system-ui,sans-serif;color:CanvasText;background:Canvas;overflow-wrap:anywhere}h1,h2,h3{line-height:1.5;margin:1.5em 0 .6em}h1{font-size:24px}h2{font-size:20px}h3{font-size:16px}body>:first-child{margin-top:0}table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}td,th{border:1px solid GrayText;padding:8px 10px;text-align:left}pre{overflow:auto;padding:12px;border:1px solid GrayText;border-radius:8px}code{font-family:ui-monospace,monospace}blockquote{margin-left:0;padding-left:16px;border-left:3px solid GrayText}img{max-width:100%}</style></head><body>${rendered}</body></html>`} />
            : <pre className="promax-file-text">{result.content || '文件内容为空。'}</pre>}
  </section>
}
