import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  draftSessionView,
  enableDraftTracking,
  handoffMarkdown,
  observeDraftConversation,
  resetDraftStateForTests,
  setDraftTrackingEnabled,
  startDraftSession,
  transcriptMarkdown,
} from '../src/client/draft-state.ts'

const nodes = [
  { kind: 'user', seq: 1, content: [{ type: 'text', text: '做一个云盘权限方案' }] },
  { kind: 'assistant', messageId: 'a1', turn: 1, blocks: [{ kind: 'text', text: '先确认使用对象。' }] },
  { kind: 'user', seq: 2, content: [{ type: 'text', text: '面向企业管理员' }] },
  { kind: 'user', seq: 3, content: [{ type: 'text', text: '一期不做外链分享' }] },
]

describe('incremental draft handoff state', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetDraftStateForTests()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('tracks visible turns incrementally and emits the fixed four-section handoff', () => {
    startDraftSession('draft-1')
    observeDraftConversation('draft-1', nodes)
    const session = draftSessionView('draft-1')
    expect(session.outline).toHaveLength(3)
    expect(session.outline[0]).toMatchObject({ section: 'goal', backfilled: false })
    expect(handoffMarkdown('draft-1')).toContain('## 背景')
    expect(handoffMarkdown('draft-1')).toContain('## 要解决什么')
    expect(handoffMarkdown('draft-1')).toContain('## 已知约束')
    expect(handoffMarkdown('draft-1')).toContain('## 还没定的')
    expect(transcriptMarkdown('draft-1')).toContain('先确认使用对象。')
  })

  it('stops persistent capture when disabled and explicitly marks later backfill', () => {
    setDraftTrackingEnabled(false)
    startDraftSession('draft-2')
    observeDraftConversation('draft-2', nodes)
    expect(draftSessionView('draft-2').outline).toEqual([])
    expect(handoffMarkdown('draft-2', true)).toContain('⟲ 补整理')

    enableDraftTracking('draft-2', 'backfill')
    expect(draftSessionView('draft-2').outline.every(item => item.backfilled)).toBe(true)
  })
})
