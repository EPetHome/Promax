import { FeishuApi, FeishuDeliveryError } from '@promax/feishu-api'

export type SpreadsheetReadTool = 'feishu_spreadsheet_sheet' | 'feishu_spreadsheet_sheet_range_read'

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('飞书电子表格返回结构不完整，请稍后重试；仍失败时联系平台维护者。')
  return value as Record<string, unknown>
}

function identifier(args: Record<string, unknown>, key: string): string {
  const value = typeof args[key] === 'string' ? args[key].trim() : ''
  if (!/^[a-z0-9]{1,256}$/iu.test(value)) throw new Error(`电子表格参数 ${key} 无效：请检查 /sheets/ 链接中的表格标识，工作表标识请从工作表列表获取。`)
  return value
}

function readRange(value: unknown): string {
  const range = typeof value === 'string' ? value.trim().toUpperCase() : ''
  const match = /^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/u.exec(range)
  const column = (letters: string): number => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
  if (!match || ![column(match[1]!), Number(match[2]), column(match[3] ?? match[1]!), Number(match[4] ?? match[2])].every(Number.isSafeInteger)
    || column(match[1]!) > column(match[3] ?? match[1]!) || Number(match[2]) > Number(match[4] ?? match[2])) {
    throw new Error('电子表格读取区域无效：请使用 A1:Z500 这样的范围，行号从 1 开始，起点不能超过终点。')
  }
  return range
}

function readableError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return new Error('电子表格读取已取消。')
  if (!(error instanceof FeishuDeliveryError)) return error instanceof Error ? error : new Error('电子表格读取失败，请稍后重试。')
  if (error.message.includes('APP_ID') || error.message.includes('tenant_access_token')) {
    return new Error('飞书凭据未配置或无效：请到“设置 → 连接”检查 APP_ID 与 APP_SECRET 后重试。')
  }
  if (error.code === 99991672 || /scopes? (?:is|are) required|应用尚未开通/iu.test(error.message)) {
    return new Error('飞书应用尚未开通电子表格读取权限：请到飞书开发者后台为当前应用开通 sheets:spreadsheet:readonly，发布生效后重试。')
  }
  if (error.status === 403 || /forbidden|permission denied|access denied|无权限|没有权限/iu.test(error.message)) {
    return new Error('飞书应用无权读取这份电子表格：请在该表“分享 → 添加协作者”中添加当前机器人应用并授予阅读权限，再重试。')
  }
  if (error.code === 1310214 || error.status === 404 || /not (?:exist|found)|不存在/iu.test(error.message)) {
    return new Error('电子表格或工作表不存在：请检查链接及 spreadsheet_token，并重新获取工作表列表；若文件已删除，请从飞书回收站恢复。')
  }
  if (error.code === 90202 || /range|区域|越界/iu.test(error.message)) {
    return new Error('电子表格读取区域无效或超出允许范围：请检查 sheet_id 和 A1:Z500 格式，并缩小读取区域后重试。')
  }
  if (error.code === 1310251 || /spreadsheet_token invalid/iu.test(error.message)) {
    return new Error('电子表格链接或 token 不正确：请复制真实的飞书 /sheets/ 链接并重试。')
  }
  return new Error(error.status === 429 ? '飞书读取请求过于频繁，请稍后重试。' : '飞书电子表格读取失败：请检查网络后重试；若持续失败，请联系平台维护者。')
}

/** Only the two observed GET endpoints are exposed; this module has no write operations. */
export async function readSpreadsheet(api: FeishuApi, tool: SpreadsheetReadTool, args: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const token = identifier(args, 'spreadsheet_token')
  try {
    if (tool === 'feishu_spreadsheet_sheet') {
      const data = object((await api.json('GET', `/sheets/v3/spreadsheets/${encodeURIComponent(token)}/sheets/query`, undefined, signal)).data)
      if (!Array.isArray(data.sheets) || data.sheets.some(item => typeof object(item).sheet_id !== 'string' || typeof object(item).title !== 'string')) {
        throw new Error('飞书没有返回有效的工作表列表，请稍后重试。')
      }
      return { spreadsheet_token: token, sheets: data.sheets }
    }
    const sheetId = identifier(args, 'sheet_id')
    const range = readRange(args.range)
    const data = object((await api.json('GET', `/sheets/v2/spreadsheets/${encodeURIComponent(token)}/values/${encodeURIComponent(`${sheetId}!${range}`)}`, undefined, signal)).data)
    const valueRange = object(data.valueRange)
    if (valueRange.majorDimension !== 'ROWS' || !Array.isArray(valueRange.values) || valueRange.values.some(row => !Array.isArray(row))) {
      throw new Error('飞书没有返回有效的表格行数据，请稍后重试。')
    }
    const values = valueRange.values as unknown[][]
    const nonEmpty = (row: unknown[]): boolean => row.some(cell => cell !== null && cell !== undefined && cell !== '' && !(typeof cell === 'string' && cell.trim() === ''))
    const headers = values[0] ?? []
    const rows = values.slice(1).filter(nonEmpty)
    return {
      spreadsheet_token: token, sheet_id: sheetId, range: valueRange.range,
      revision: data.revision, headers, rows, row_count: rows.length,
      has_header: nonEmpty(headers),
      ...(!nonEmpty(headers) ? { notice: '读取区域首行为空，未识别到表头；请先提供周报表头和项目数据，当前不能进行项目偏差或风险分析。' } : {}),
    }
  } catch (error: unknown) {
    throw readableError(error, signal)
  }
}
