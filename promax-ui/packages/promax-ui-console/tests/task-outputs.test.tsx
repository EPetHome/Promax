import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { TaskFileContent, type TaskFilePreview } from '../src/client/TaskOutputs.tsx'

it('retries a failed file and ignores an old response after switching previews', async () => {
  let finishOld!: (value: TaskFilePreview) => void
  const oldRead = vi.fn(() => new Promise<TaskFilePreview>(resolve => { finishOld = resolve }))
  const newRead = vi.fn<() => Promise<TaskFilePreview>>().mockRejectedValueOnce(new Error('文件暂不可读')).mockResolvedValueOnce({ relativePath: '新文件.txt', kind: 'text', content: '当前会话的内容' })
  const view = render(<TaskFileContent relativePath="旧文件.txt" read={oldRead} onBack={() => {}} />)
  view.rerender(<TaskFileContent relativePath="新文件.txt" read={newRead} onBack={() => {}} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('文件暂不可读')
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('当前会话的内容')).toBeVisible()
  await act(async () => { finishOld({ relativePath: '旧文件.txt', kind: 'text', content: '旧会话的内容' }) })
  expect(screen.queryByText('旧会话的内容')).not.toBeInTheDocument()
})
