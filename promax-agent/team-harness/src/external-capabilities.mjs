import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { defineTool } from '@deepseek-ai/dsh-tools'

const execFileAsync = promisify(execFile)
const MEMBER_RE = /(?:^|\n)PROMAX_MEMBER_ID:([a-z][a-z0-9_]{2,47})(?:\n|$)/g
const CHILD_TOOL_INSTALLATIONS = new WeakMap()
const SAFE_TASK_KEY = /^(?!\.{1,2}$)[^<>:"/\\|?*\u0000-\u001F\u007F]{1,40}$/u
const LARK_OPERATIONS = new Set([
  'base-url-resolve',
  'base-table-list',
  'base-field-list',
  'base-record-list',
  'base-record-upsert-dry-run',
  'sheets-workbook-info',
  'sheets-cells-get',
])

export const name = 'promax-external-capabilities'
export const inject = ['subagents', 'tools', 'systemPrompt']

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

async function memberIdOf(childCtx) {
  const assembly = await childCtx.systemPrompt.assemble({ scope: childCtx.agent })
  const persona = assembly.sections.find(section => section.name === 'deployment:persona')?.text ?? ''
  const matches = [...persona.matchAll(MEMBER_RE)]
  if (matches.length !== 1) throw new Error('Promax external capability 无法唯一识别 member_id')
  return matches[0][1]
}

function exactKeys(value, allowed, operation) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${operation} 的 input 必须是对象`)
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown) throw new Error(`${operation} 不允许参数 ${unknown}`)
}

function requiredString(input, key) {
  const value = input[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`缺少 ${key}`)
  return value
}

function optionalInteger(input, key, fallback, min, max) {
  const value = input[key] ?? fallback
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} 必须为 ${min}–${max} 的整数`)
  return value
}

function larkArgs(operation, input) {
  switch (operation) {
    case 'base-url-resolve':
      exactKeys(input, ['url'], operation)
      return ['base', '+url-resolve', '--url', requiredString(input, 'url'), '--format', 'json']
    case 'base-table-list':
      exactKeys(input, ['base_token', 'limit', 'offset'], operation)
      return ['base', '+table-list', '--base-token', requiredString(input, 'base_token'), '--limit', String(optionalInteger(input, 'limit', 100, 1, 100)), '--offset', String(optionalInteger(input, 'offset', 0, 0, 1000000)), '--format', 'json']
    case 'base-field-list':
      exactKeys(input, ['base_token', 'table_id', 'limit', 'offset'], operation)
      return ['base', '+field-list', '--base-token', requiredString(input, 'base_token'), '--table-id', requiredString(input, 'table_id'), '--limit', String(optionalInteger(input, 'limit', 200, 1, 200)), '--offset', String(optionalInteger(input, 'offset', 0, 0, 1000000)), '--format', 'json']
    case 'base-record-list':
      exactKeys(input, ['base_token', 'table_id', 'limit', 'offset'], operation)
      return ['base', '+record-list', '--base-token', requiredString(input, 'base_token'), '--table-id', requiredString(input, 'table_id'), '--limit', String(optionalInteger(input, 'limit', 200, 1, 200)), '--offset', String(optionalInteger(input, 'offset', 0, 0, 1000000)), '--format', 'json']
    case 'base-record-upsert-dry-run':
      exactKeys(input, ['base_token', 'table_id', 'record_id', 'fields'], operation)
      if (!input.fields || typeof input.fields !== 'object' || Array.isArray(input.fields)) throw new Error('fields 必须是字段对象')
      return ['base', '+record-upsert', '--base-token', requiredString(input, 'base_token'), '--table-id', requiredString(input, 'table_id'), ...(input.record_id ? ['--record-id', requiredString(input, 'record_id')] : []), '--json', JSON.stringify(input.fields), '--dry-run', '--format', 'json']
    case 'sheets-workbook-info':
      exactKeys(input, ['url'], operation)
      return ['sheets', '+workbook-info', '--url', requiredString(input, 'url'), '--format', 'json']
    case 'sheets-cells-get':
      exactKeys(input, ['url', 'sheet_id', 'range'], operation)
      return ['sheets', '+cells-get', '--url', requiredString(input, 'url'), '--sheet-id', requiredString(input, 'sheet_id'), '--range', requiredString(input, 'range'), '--format', 'json']
    default:
      throw new Error(`不允许的 Lark operation：${operation}`)
  }
}

function containedFile(cwd, relativePath, extension) {
  if (typeof relativePath !== 'string' || relativePath.startsWith('/') || relativePath.includes('\\')) throw new Error('path 必须是工作区相对路径')
  const root = resolve(cwd)
  const file = resolve(root, relativePath)
  const rel = relative(root, file)
  if (rel === '..' || rel.startsWith(`..${sep}`) || file.split('.').at(-1)?.toLowerCase() !== extension) throw new Error('path 越界或文件类型不符')
  if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('目标必须是已存在的普通文件')
  return file
}

function browserRunId() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function registerChildTools(childCtx, config) {
  const lark = defineTool({
    name: 'promax_lark_cli',
    description: 'Requirement-management-only fixed Lark CLI gateway. It exposes approved read operations and record-upsert dry-run only; no live write operation exists.',
    parameters: {
      operation: { type: 'string', required: true, enum: [...LARK_OPERATIONS] },
      input: { type: 'json', required: true },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      if (await memberIdOf(childCtx) !== 'requirement_management') throw new Error('promax_lark_cli 仅允许 requirement_management')
      const binary = resolve(config.larkCliPath)
      if (!existsSync(binary) || !lstatSync(binary).isFile()) throw new Error('固定版 lark-cli 未安装')
      const { stdout: version } = await execFileAsync(binary, ['--version'], { timeout: 5000, maxBuffer: 1024 * 1024 })
      if (!version.includes('1.0.92')) throw new Error('lark-cli 版本不是 1.0.92')
      if (!LARK_OPERATIONS.has(args.operation)) throw new Error('Lark operation 不在白名单')
      const argv = larkArgs(args.operation, args.input)
      if (argv.includes('--yes')) throw new Error('禁止 --yes')
      const { stdout, stderr } = await execFileAsync(binary, argv, { cwd: childCtx.agent.session.header.cwd, timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
      return { operation: args.operation, cli_version: '1.0.92', dry_run: args.operation.endsWith('dry-run'), stdout, stderr }
    },
  })

  const browser = defineTool({
    name: 'promax_browser_evidence',
    description: 'Solution-design-only local prototype evidence capture. Opens one workspace HTML file in fixed local Chrome, records screenshots, DOM and SHA256 by viewport.',
    parameters: {
      task_key: { type: 'string', required: true },
      prototype_path: { type: 'string', required: true },
      viewports: { type: 'array', required: true, items: { type: 'string' } },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args) {
      if (await memberIdOf(childCtx) !== 'solution_design') throw new Error('promax_browser_evidence 仅允许 solution_design')
      if (typeof args.task_key !== 'string' || args.task_key !== args.task_key.normalize('NFC') || args.task_key !== args.task_key.trim() || !SAFE_TASK_KEY.test(args.task_key)) throw new Error('task_key 无效')
      const cwd = childCtx.agent.session.header.cwd
      const prototype = containedFile(cwd, args.prototype_path, 'html')
      const viewports = [...new Set(args.viewports)]
      if (viewports.length < 1 || viewports.length > 4 || viewports.some(value => !/^[1-9][0-9]{2,3}x[1-9][0-9]{2,3}$/.test(value))) throw new Error('viewports 必须为 1–4 个 WxH')
      const chrome = resolve(config.chromeExecutable)
      if (!existsSync(chrome)) throw new Error('固定 Chrome 不存在')
      const { stdout: chromeVersion } = await execFileAsync(chrome, ['--version'], { timeout: 5000, maxBuffer: 1024 * 1024 })
      const root = join(resolve(cwd), '.promax', 'browser-evidence', args.task_key, browserRunId())
      mkdirSync(root, { recursive: true })
      const results = []
      for (const viewport of viewports) {
        const [width, height] = viewport.split('x').map(Number)
        const screenshot = join(root, `${viewport}.png`)
        const { stdout: dom, stderr } = await execFileAsync(chrome, [
          '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
          `--window-size=${width},${height}`, `--screenshot=${screenshot}`, '--dump-dom', `file://${prototype}`,
        ], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 })
        const domFile = join(root, `${viewport}.dom.html`)
        writeFileSync(domFile, dom)
        results.push({
          viewport,
          screenshot: relative(cwd, screenshot),
          screenshot_sha256: sha256(readFileSync(screenshot)),
          dom: relative(cwd, domFile),
          dom_sha256: sha256(readFileSync(domFile)),
          stderr,
        })
      }
      const manifest = { chrome_version: chromeVersion.trim(), prototype: args.prototype_path, prototype_sha256: sha256(readFileSync(prototype)), results }
      writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      return { evidence_root: relative(cwd, root), ...manifest }
    },
  })
  return [childCtx.tools.register(lark), childCtx.tools.register(browser)]
}

function retainChildTools(childCtx, config) {
  const configKey = JSON.stringify(config)
  const current = CHILD_TOOL_INSTALLATIONS.get(childCtx)
  if (current) {
    if (current.configKey !== configKey) throw new Error('Promax external capability 子会话配置冲突')
    current.references += 1
    return () => releaseChildTools(childCtx, current)
  }
  const disposers = registerChildTools(childCtx, config)
  const installation = { configKey, disposers, references: 1 }
  CHILD_TOOL_INSTALLATIONS.set(childCtx, installation)
  return () => releaseChildTools(childCtx, installation)
}

function releaseChildTools(childCtx, installation) {
  if (CHILD_TOOL_INSTALLATIONS.get(childCtx) !== installation || installation.references === 0) return
  installation.references -= 1
  if (installation.references > 0) return
  CHILD_TOOL_INSTALLATIONS.delete(childCtx)
  for (const dispose of installation.disposers.reverse()) dispose()
}

export function apply(ctx, config = {}) {
  const resolved = {
    larkCliPath: String(config.larkCliPath ?? ''),
    chromeExecutable: String(config.chromeExecutable ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  }
  ctx.subagents.registerContinuableSetup((childCtx) => {
    return retainChildTools(childCtx, resolved)
  })
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.origin !== 'subagent' || CHILD_TOOL_INSTALLATIONS.has(agent.ctx)) return
    agent.ctx.effect(
      () => retainChildTools(agent.ctx, resolved),
      'promax-external-capabilities.one-shot-child',
    )
  })
}
