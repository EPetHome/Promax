import { describe, expect, it, vi } from 'vitest'
import { FeishuApi } from '@promax/feishu-api'
import { readSpreadsheet } from '../src/feishu-sheets.ts'

const signal = new AbortController().signal
const credentials = { resolve: async (ref: string) => ({ value: ref }) }
const token = 'ArDksYd25h0XNDtsFXmc7kXknqc'

describe('read-only Feishu Sheets adapter', () => {
  it('uses one token and preserves the first row, false and zero while dropping blank data rows', async () => {
    const requests: Array<{ url: string; method: string | undefined }> = []
    const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method })
      if (String(url).includes('/auth/')) return Response.json({ code: 0, tenant_access_token: 'test-token', expire: 7200 })
      if (String(url).endsWith('/sheets/query')) return Response.json({ code: 0, data: { sheets: [{ sheet_id: '8e6e12', title: 'Sheet1' }] } })
      return Response.json({ code: 0, data: { revision: 1, valueRange: { majorDimension: 'ROWS', range: '8e6e12!A1:C5', values: [['项目', '状态', '进展'], ['测试A', false, 0], [null, ' ', ''], ['测试B', '待确认', null]] } } })
    })
    const api = new FeishuApi(credentials, 5000, http as typeof fetch)
    expect(await readSpreadsheet(api, 'feishu_spreadsheet_sheet', { spreadsheet_token: token }, signal)).toEqual({ spreadsheet_token: token, sheets: [{ sheet_id: '8e6e12', title: 'Sheet1' }] })
    const result = await readSpreadsheet(api, 'feishu_spreadsheet_sheet_range_read', { spreadsheet_token: token, sheet_id: '8e6e12', range: 'a1:c5' }, signal)
    expect(result.headers).toEqual(['项目', '状态', '进展'])
    expect(result.rows).toEqual([['测试A', false, 0], ['测试B', '待确认', null]])
    expect(result.row_count).toBe(2)
    expect(requests.map(r => r.method)).toEqual(['POST', 'GET', 'GET'])
    expect(requests[2]!.url.endsWith('/values/8e6e12!A1%3AC5')).toBe(true)
    await expect(readSpreadsheet(api, 'feishu_spreadsheet_sheet_range_read', { spreadsheet_token: token, sheet_id: '8e6e12', range: 'Z500:A1' }, signal)).rejects.toThrow('起点不能超过终点')
    expect(requests).toHaveLength(3)
  })

  it('reports a real empty matrix as missing headers with zero data rows', async () => {
    const http = async (url: string | URL | Request) => Response.json(String(url).includes('/auth/')
      ? { code: 0, tenant_access_token: 'test-token', expire: 7200 }
      : { code: 0, data: { revision: 0, valueRange: { majorDimension: 'ROWS', range: '8e6e12!A1:Z500', values: Array.from({ length: 500 }, () => Array(26).fill(null)) } } })
    const result = await readSpreadsheet(new FeishuApi(credentials, 5000, http as typeof fetch), 'feishu_spreadsheet_sheet_range_read', { spreadsheet_token: token, sheet_id: '8e6e12', range: 'A1:Z500' }, signal)
    expect(result.headers).toEqual(Array(26).fill(null))
    expect(result).toMatchObject({ rows: [], row_count: 0, has_header: false })
    expect(result.notice).toContain('不能进行项目偏差或风险分析')
  })

  it('returns Chinese guidance for absent credentials, denied access, invalid targets and ranges', async () => {
    const unused = vi.fn()
    await expect(readSpreadsheet(new FeishuApi({ resolve: async () => undefined }, 5000, unused), 'feishu_spreadsheet_sheet', { spreadsheet_token: token }, signal)).rejects.toThrow('设置 → 连接')
    expect(unused).not.toHaveBeenCalled()
    for (const [status, code, msg, expected] of [
      [403, 99991672, 'Access denied', 'sheets:spreadsheet:readonly'],
      [403, 403, 'Forbidden', '分享 → 添加协作者'],
      [400, 1310214, 'Path param :spreadsheet_token is not exist', '电子表格或工作表不存在'],
      [200, 90202, 'validate RangeVal fail', '读取区域无效或超出允许范围'],
    ] as const) {
      const http = async (url: string | URL | Request) => String(url).includes('/auth/')
        ? Response.json({ code: 0, tenant_access_token: 'test-token', expire: 7200 })
        : Response.json({ code, msg }, { status })
      const api = new FeishuApi(credentials, 5000, http as typeof fetch)
      await expect(readSpreadsheet(api, 'feishu_spreadsheet_sheet', { spreadsheet_token: token }, signal)).rejects.toThrow(expected)
      await expect(readSpreadsheet(api, 'feishu_spreadsheet_sheet', { spreadsheet_token: token }, signal)).rejects.not.toThrow(String(code))
    }
  })
})
