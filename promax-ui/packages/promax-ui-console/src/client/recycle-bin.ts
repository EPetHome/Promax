import type { DeletePreview, DeleteTarget } from '../../../promax-bundle/src/recycle-bin.ts'
export type { DeletePreview, DeleteTarget }
export interface RecycleEntry extends DeletePreview { id: string; deletedAt: string }

async function request<T>(operation: string, input: object): Promise<T> {
  const response = await fetch(`/promax-workspace-api/recycle/${operation}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  })
  const value = await response.json() as { error?: string }
  if (!response.ok) throw new Error(value.error ?? '回收站操作失败')
  return value as T
}

export const recycleBinApi = {
  preview: (target: DeleteTarget) => request<DeletePreview>('preview', target),
  remove: (preview: DeletePreview) => request<{ id: string }>('delete', preview),
  list: () => request<{ items: RecycleEntry[] }>('list', {}),
  restore: (id: string) => request<{ workspaceId: string }>('restore', { id }),
  purge: (id: string) => request<object>('purge', { id }),
  refresh: () => { window.location.reload() },
}
