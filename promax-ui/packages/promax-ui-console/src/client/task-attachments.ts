export const MAX_TASK_ATTACHMENT_COUNT = 20
export const MAX_TASK_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const TASK_ATTACHMENT_ACCEPT = '.md,.txt,.csv,.json,.yml,.yaml,.docx,.pdf,.xlsx'

export interface TaskAttachmentContext {
  path: string
  name: string
  mediaType: string
  bytes: number
  readablePath: string
  textCharacters: number
  excerpt: string
  truncated: boolean
  converter?: string
  pageCount?: number
}

const SUPPORTED_EXTENSIONS = new Set(TASK_ATTACHMENT_ACCEPT.split(','))
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const SUPPORTED_FORMATS_MESSAGE = '支持的格式：.md、.txt、.csv、.json、.yml、.yaml、.docx、.pdf、.xlsx'

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Validates the server-produced, prompt-safe description of one prepared attachment. */
export function taskAttachmentContextOf(value: unknown): TaskAttachmentContext | undefined {
  const row = recordOf(value)
  if (row === undefined) return undefined
  const path = typeof row.path === 'string' ? row.path : ''
  const name = typeof row.name === 'string' ? row.name : ''
  const mediaType = typeof row.mediaType === 'string' ? row.mediaType : ''
  const readablePath = typeof row.readablePath === 'string' ? row.readablePath : ''
  const bytes = row.bytes
  const textCharacters = row.textCharacters
  const excerpt = typeof row.excerpt === 'string' ? row.excerpt : ''
  const converter = typeof row.converter === 'string' && row.converter !== '' ? row.converter : undefined
  const pageCount = typeof row.pageCount === 'number' && Number.isSafeInteger(row.pageCount) && row.pageCount > 0 ? row.pageCount : undefined
  if (
    path === '' || path.startsWith('/') || path.includes('..') || path.includes('\\')
    || name === '' || name.includes('/') || name.includes('\\')
    || mediaType === ''
    || readablePath === '' || readablePath.startsWith('/') || readablePath.includes('..') || readablePath.includes('\\')
    || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0
    || typeof textCharacters !== 'number' || !Number.isSafeInteger(textCharacters) || textCharacters <= 0
    || excerpt.trim() === '' || excerpt.length > 50_000
    || typeof row.truncated !== 'boolean'
  ) return undefined
  return {
    path,
    name,
    mediaType,
    bytes,
    readablePath,
    textCharacters,
    excerpt,
    truncated: row.truncated,
    ...(converter === undefined ? {} : { converter }),
    ...(pageCount === undefined ? {} : { pageCount }),
  }
}

export function uniqueTaskAttachmentName(name: string, used: Set<string>): string {
  const extension = extensionOf(name)
  const stem = extension === '' ? name : name.slice(0, -extension.length)
  for (let ordinal = 1; ordinal <= 10_000; ordinal += 1) {
    const candidate = ordinal === 1 ? name : `${stem}（${String(ordinal)}）${name.slice(stem.length)}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  throw new Error(`文件“${name}”的同名副本过多`)
}

export function taskAttachmentSelectionError(files: readonly Pick<File, 'name' | 'size'>[]): string | null {
  if (files.length > MAX_TASK_ATTACHMENT_COUNT) return `附件数量不能超过 ${String(MAX_TASK_ATTACHMENT_COUNT)} 个`
  for (const file of files) {
    const extension = extensionOf(file.name)
    if (IMAGE_EXTENSIONS.has(extension)) return '图片请用对话框内的图片功能'
    if (!SUPPORTED_EXTENSIONS.has(extension)) return `不支持文件“${file.name}”。${SUPPORTED_FORMATS_MESSAGE}`
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0)
  return totalBytes > MAX_TASK_ATTACHMENT_BYTES ? '附件总大小不能超过 20 MiB，请移除部分文件后重试' : null
}
