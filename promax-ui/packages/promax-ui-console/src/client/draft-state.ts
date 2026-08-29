import { useSyncExternalStore } from 'react'

export type DraftSectionId = 'background' | 'goal' | 'constraints' | 'open'

export interface DraftOutlineItem {
  id: string
  section: DraftSectionId
  text: string
  backfilled: boolean
}

export interface DraftMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export interface DraftSession {
  sessionId: string
  messages: DraftMessage[]
  outline: DraftOutlineItem[]
  tracking: 'live' | 'off'
  capturedUserIds: string[]
  compacted: boolean
}

export interface DraftState {
  version: 1
  enabled: boolean
  informed: boolean
  sessions: Record<string, DraftSession | undefined>
}

export const DRAFT_STORAGE_KEY = 'promax.drafts.v1'
const CHANGE_EVENT = 'promax:draft-state-change'
const DEFAULT_STATE: DraftState = { version: 1, enabled: true, informed: false, sessions: {} }
const liveSnapshots = new Map<string, { messages: DraftMessage[]; compacted: boolean }>()
let latestSessionId: string | undefined

let cachedRaw: string | null | undefined
let cachedState: DraftState = DEFAULT_STATE

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return ''
  return value.flatMap(block => {
    if (typeof block !== 'object' || block === null) return []
    const row = block as Record<string, unknown>
    const text = typeof row.text === 'string' ? row.text.trim() : ''
    return (row.type === 'text' || row.kind === 'text') && text !== '' ? [text] : []
  }).join('\n').trim()
}

function messagesOf(nodes: readonly unknown[]): { messages: DraftMessage[]; compacted: boolean } {
  const messages: DraftMessage[] = []
  let compacted = false
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue
    const row = node as Record<string, unknown>
    if (row.kind === 'compaction' || row.kind === 'compact') compacted = true
    if (row.kind !== 'user' && row.kind !== 'assistant') continue
    const role = row.kind
    const text = textOf(row.content ?? row.blocks ?? row.text)
    if (text === '') continue
    const discriminator = row.seq ?? row.messageId ?? row.turn ?? messages.length
    messages.push({ id: `${role}:${String(discriminator)}`, role, text })
  }
  return { messages, compacted }
}

function parseState(raw: string): DraftState | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null) return null
    const row = value as Record<string, unknown>
    if (row.version !== 1 || typeof row.enabled !== 'boolean' || typeof row.informed !== 'boolean') return null
    const sessions: DraftState['sessions'] = {}
    if (typeof row.sessions === 'object' && row.sessions !== null && !Array.isArray(row.sessions)) {
      for (const [sessionId, item] of Object.entries(row.sessions as Record<string, unknown>)) {
        if (typeof item !== 'object' || item === null) continue
        const session = item as Record<string, unknown>
        const messages = Array.isArray(session.messages) ? session.messages.flatMap(message => {
          if (typeof message !== 'object' || message === null) return []
          const entry = message as Record<string, unknown>
          if (typeof entry.id !== 'string' || (entry.role !== 'user' && entry.role !== 'assistant') || typeof entry.text !== 'string') return []
          return [{ id: entry.id, role: entry.role, text: entry.text } as DraftMessage]
        }) : []
        const outline = Array.isArray(session.outline) ? session.outline.flatMap(outlineItem => {
          if (typeof outlineItem !== 'object' || outlineItem === null) return []
          const entry = outlineItem as Record<string, unknown>
          if (
            typeof entry.id !== 'string' || typeof entry.text !== 'string' || typeof entry.backfilled !== 'boolean'
            || !['background', 'goal', 'constraints', 'open'].includes(String(entry.section))
          ) return []
          return [{ id: entry.id, section: entry.section, text: entry.text, backfilled: entry.backfilled } as DraftOutlineItem]
        }) : []
        sessions[sessionId] = {
          sessionId,
          messages,
          outline,
          tracking: session.tracking === 'off' ? 'off' : 'live',
          capturedUserIds: Array.isArray(session.capturedUserIds) ? session.capturedUserIds.filter((id): id is string => typeof id === 'string') : [],
          compacted: session.compacted === true,
        }
      }
    }
    return { version: 1, enabled: row.enabled, informed: row.informed, sessions }
  } catch {
    return null
  }
}

export function readDraftState(): DraftState {
  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedState = raw === null ? DEFAULT_STATE : parseState(raw) ?? DEFAULT_STATE
  }
  return cachedState
}

function writeDraftState(next: DraftState): void {
  const raw = JSON.stringify(next)
  window.localStorage.setItem(DRAFT_STORAGE_KEY, raw)
  cachedRaw = raw
  cachedState = next
  window.dispatchEvent(new Event(CHANGE_EVENT))
  void fetch('/promax-workspace-api/draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  }).catch(() => undefined)
}

function updateDraftState(change: (current: DraftState) => DraftState): void {
  const current = readDraftState()
  const next = change(current)
  if (JSON.stringify(next) !== JSON.stringify(current)) writeDraftState(next)
}

export function subscribeDraftState(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== DRAFT_STORAGE_KEY) return
    cachedRaw = undefined
    listener()
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useDraftState(): DraftState {
  return useSyncExternalStore(subscribeDraftState, readDraftState, () => DEFAULT_STATE)
}

export function markDraftNoticeSeen(): void {
  updateDraftState(current => ({ ...current, informed: true }))
}

export function setDraftTrackingEnabled(enabled: boolean): void {
  updateDraftState(current => ({
    ...current,
    enabled,
    sessions: Object.fromEntries(Object.entries(current.sessions).map(([id, session]) => [
      id,
      session === undefined ? undefined : { ...session, tracking: enabled ? session.tracking : 'off' },
    ])),
  }))
}

export function startDraftSession(sessionId: string): void {
  latestSessionId = sessionId
  const state = readDraftState()
  if (state.sessions[sessionId] !== undefined) return
  const session: DraftSession = {
    sessionId,
    messages: [],
    outline: [],
    tracking: state.enabled ? 'live' : 'off',
    capturedUserIds: [],
    compacted: false,
  }
  updateDraftState(current => ({ ...current, sessions: { ...current.sessions, [sessionId]: session } }))
}

function mergeMessages(previous: readonly DraftMessage[], latest: readonly DraftMessage[]): DraftMessage[] {
  const merged = new Map(previous.map(message => [message.id, message]))
  for (const message of latest) merged.set(message.id, message)
  return [...merged.values()]
}

export function observeDraftConversation(sessionId: string, nodes: readonly unknown[]): void {
  latestSessionId = sessionId
  const snapshot = messagesOf(nodes)
  liveSnapshots.set(sessionId, snapshot)
  const state = readDraftState()
  const current = state.sessions[sessionId]
  if (!state.enabled || current?.tracking === 'off') return
  const base = current ?? {
    sessionId,
    messages: [],
    outline: [],
    tracking: 'live' as const,
    capturedUserIds: [],
    compacted: false,
  }
  const messages = mergeMessages(base.messages, snapshot.messages)
  const captured = new Set(base.capturedUserIds)
  const outline = [...base.outline]
  const allUsers = messages.filter(message => message.role === 'user')
  for (const message of allUsers) {
    if (captured.has(message.id)) continue
    outline.push({
      id: `outline:${message.id}`,
      section: outline.length === 0 ? 'goal' : 'background',
      text: message.text,
      backfilled: false,
    })
    captured.add(message.id)
  }
  updateDraftState(value => ({
    ...value,
    sessions: {
      ...value.sessions,
      [sessionId]: {
        ...base,
        messages,
        outline,
        capturedUserIds: [...captured],
        compacted: base.compacted || snapshot.compacted,
      },
    },
  }))
}

export function enableDraftTracking(sessionId: string, mode: 'backfill' | 'now'): void {
  const snapshot = liveSnapshots.get(sessionId) ?? { messages: [], compacted: false }
  updateDraftState(current => {
    const previous = current.sessions[sessionId]
    const messages = mergeMessages(previous?.messages ?? [], snapshot.messages)
    const captured = new Set(previous?.capturedUserIds ?? [])
    const outline = [...(previous?.outline ?? [])]
    if (mode === 'backfill') {
      for (const message of messages.filter(item => item.role === 'user')) {
        if (captured.has(message.id)) continue
        outline.push({
          id: `outline:${message.id}`,
          section: outline.length === 0 ? 'goal' : 'background',
          text: message.text,
          backfilled: true,
        })
        captured.add(message.id)
      }
    } else {
      for (const message of messages.filter(item => item.role === 'user')) captured.add(message.id)
    }
    return {
      ...current,
      enabled: true,
      sessions: {
        ...current.sessions,
        [sessionId]: {
          sessionId,
          messages,
          outline,
          tracking: 'live',
          capturedUserIds: [...captured],
          compacted: (previous?.compacted ?? false) || snapshot.compacted,
        },
      },
    }
  })
}

export function draftSessionView(sessionId: string): DraftSession {
  const state = readDraftState()
  const current = state.sessions[sessionId]
  const snapshot = liveSnapshots.get(sessionId) ?? { messages: [], compacted: false }
  if (current !== undefined) {
    return {
      ...current,
      messages: mergeMessages(current.messages, snapshot.messages),
      compacted: current.compacted || snapshot.compacted,
    }
  }
  return {
    sessionId,
    messages: snapshot.messages,
    outline: [],
    tracking: 'off',
    capturedUserIds: [],
    compacted: snapshot.compacted,
  }
}

const SECTION_LABELS: Array<[DraftSectionId, string]> = [
  ['background', '背景'],
  ['goal', '要解决什么'],
  ['constraints', '已知约束'],
  ['open', '还没定的'],
]

export function handoffMarkdown(sessionId: string, onsite = false): string {
  const session = draftSessionView(sessionId)
  const fallback = onsite
    ? session.messages.filter(message => message.role === 'user').map((message, index) => ({
      id: `onsite:${message.id}`,
      section: index === 0 ? 'goal' as const : 'background' as const,
      text: message.text,
      backfilled: true,
    }))
    : []
  const outline = session.outline.length > 0 ? session.outline : fallback
  return SECTION_LABELS.map(([section, label]) => {
    const rows = outline.filter(item => item.section === section)
    const body = rows.length === 0 ? '- 暂无' : rows.map(item => `- ${item.backfilled ? '⟲ 补整理 · ' : ''}${item.text}`).join('\n')
    return `## ${label}\n\n${body}`
  }).join('\n\n')
}

export function transcriptMarkdown(sessionId: string): string {
  const session = draftSessionView(sessionId)
  return session.messages.map(message => `## ${message.role === 'user' ? '用户' : 'Agent'}\n\n${message.text}`).join('\n\n')
}

export function draftUserTurnCount(sessionId: string): number {
  return draftSessionView(sessionId).messages.filter(message => message.role === 'user').length
}

export function latestDraftSessionId(): string | undefined {
  return latestSessionId
}

export function resetDraftStateForTests(): void {
  cachedRaw = undefined
  cachedState = DEFAULT_STATE
  liveSnapshots.clear()
  latestSessionId = undefined
}
