import type { ArtifactKind, UserReportStatus } from '@promax/contracts'

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDateTime(value: string | null): string {
  if (value === null) return '从未上报'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date)
}

export function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value * 100)}%`
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export const statusLabels: Record<UserReportStatus, string> = {
  never: '从未上报',
  stale: '已超期',
  ok: '正常',
}

export const kindLabels: Record<ArtifactKind, string> = {
  prd: 'PRD',
  diagram: '图表',
  prototype: '原型',
  other: '其他',
}

export function inputDateToIso(value: string, endOfDay = false): string | undefined {
  if (value === '') return undefined
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}
