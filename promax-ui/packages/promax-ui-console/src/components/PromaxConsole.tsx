import type {
  ArtifactKind,
  ConsoleArtifact,
  ConsoleArtifactsQuery,
  ConsoleArtifactsResponse,
  ConsoleOverviewResponse,
  ConsoleTelemetryResponse,
  ConsoleTelemetrySeriesPoint,
  ConsoleUser,
  ConsoleUsersResponse,
  MeResponse,
  TelemetryEventType,
  TelemetryGroupBy,
  TelemetrySource,
  UserReportStatus,
} from '@promax/contracts'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { PromaxApiClient } from '../data/api-client.ts'
import {
  AUTH_SESSION_EVENT,
  BrowserTokenStore,
  type AuthSession,
} from '../data/token-store.ts'
import { installPromaxConsoleStyles } from '../styles.ts'
import { formatBytes, formatDateTime, formatPercent, inputDateToIso, kindLabels, statusLabels } from './format.ts'
import { Icon, type IconName } from './icons.tsx'

type ConsoleView = 'overview' | 'users' | 'artifacts' | 'telemetry'

export interface PromaxConsoleProps {
  apiBaseUrl?: string
  standalone?: boolean
}

const viewMeta: Record<ConsoleView, { label: string; description: string; icon: IconName }> = {
  overview: { label: '总览', description: '团队接入、上报覆盖和产出概况', icon: 'grid' },
  users: { label: '人员', description: '优先发现从未上报和长期未上报人员', icon: 'users' },
  artifacts: { label: '产出物', description: '检索并下载团队 Agent 产出', icon: 'artifact' },
  telemetry: { label: '用量', description: 'hook 轨与 llm 轨分开观察，不做虚高合计', icon: 'activity' },
}

export function PromaxConsole({ apiBaseUrl, standalone = false }: PromaxConsoleProps) {
  const tokenStore = useMemo(() => new BrowserTokenStore(), [])
  const api = useMemo(() => new PromaxApiClient(apiBaseUrl, tokenStore), [apiBaseUrl, tokenStore])
  const [session, setSession] = useState<AuthSession | undefined>(() => tokenStore.read())
  const [view, setView] = useState<ConsoleView>('overview')
  const [refreshKey, setRefreshKey] = useState(0)
  const [bootError, setBootError] = useState<string>()

  useEffect(() => installPromaxConsoleStyles(), [])
  useEffect(() => {
    const sync = (): void => { setSession(tokenStore.read()) }
    window.addEventListener(AUTH_SESSION_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(AUTH_SESSION_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [tokenStore])

  useEffect(() => {
    if (session === undefined || session.user !== undefined) return
    let cancelled = false
    setBootError(undefined)
    api.me().then((user) => {
      if (cancelled) return
      const latest = tokenStore.read()
      if (latest !== undefined) tokenStore.write({ tokens: latest.tokens, user })
    }).catch((error: unknown) => {
      if (!cancelled) setBootError(errorMessage(error))
    })
    return () => { cancelled = true }
  }, [api, session, tokenStore])

  const rootClassName = `promax-console${standalone ? ' promax-console--standalone' : ''}`
  if (session === undefined) return <Login api={api} className={rootClassName} />
  if (session.user === undefined) {
    return (
      <main className={`${rootClassName} promax-login`} aria-label="Promax 管理控制台">
        <StatePanel
          title={bootError === undefined ? '正在确认登录状态' : '登录状态校验失败'}
          message={bootError ?? '正在连接 Promax 服务…'}
          action={bootError === undefined ? undefined : (
            <button className="promax-button" type="button" onClick={() => { tokenStore.clear() }}>返回登录</button>
          )}
        />
      </main>
    )
  }
  if (session.user.role !== 'admin') {
    return <Forbidden api={api} className={rootClassName} user={session.user} />
  }

  const meta = viewMeta[view]
  return (
    <main className={rootClassName} aria-label="Promax 管理控制台">
      <aside className="promax-console-rail">
        <div className="promax-console-brand">
          <span className="promax-console-brand-mark"><PromaxGlyph /></span>
          <span>Promax</span>
        </div>
        <nav className="promax-console-nav" aria-label="控制台页面">
          {(Object.keys(viewMeta) as ConsoleView[]).map((item) => (
            <button
              className="promax-nav-button"
              type="button"
              aria-current={item === view ? 'page' : undefined}
              aria-label={viewMeta[item].label}
              key={item}
              onClick={() => { setView(item) }}
            >
              <Icon name={viewMeta[item].icon} />
              <span>{viewMeta[item].label}</span>
            </button>
          ))}
        </nav>
        <div className="promax-console-account">
          <div className="promax-account-name">{session.user.name}</div>
          <div className="promax-account-meta">{session.user.dept} · {session.user.employee_id}</div>
        </div>
      </aside>
      <section className="promax-console-content">
        <header className="promax-console-header">
          <div className="promax-console-heading">
            <h1>{meta.label}</h1>
            <p>{meta.description}</p>
          </div>
          <div className="promax-header-actions">
            <button
              className="promax-icon-button"
              type="button"
              aria-label="刷新当前页面"
              title="刷新"
              onClick={() => { setRefreshKey(value => value + 1) }}
            >
              <Icon name="refresh" />
            </button>
            <button className="promax-button" type="button" onClick={() => { void api.logout() }}>
              <Icon name="logout" />
              退出
            </button>
          </div>
        </header>
        {view === 'overview' && <OverviewPage api={api} refreshKey={refreshKey} />}
        {view === 'users' && <UsersPage api={api} refreshKey={refreshKey} />}
        {view === 'artifacts' && <ArtifactsPage api={api} refreshKey={refreshKey} />}
        {view === 'telemetry' && <TelemetryPage api={api} refreshKey={refreshKey} />}
      </section>
    </main>
  )
}

function Login({ api, className }: { api: PromaxApiClient; className: string }) {
  const [employeeId, setEmployeeId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api.login({ employee_id: employeeId.trim(), password })
    } catch (reason: unknown) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className={`${className} promax-login`} aria-label="Promax 登录">
      <section className="promax-login-card">
        <div className="promax-login-mark"><PromaxGlyph /></div>
        <h1>登录 Promax</h1>
        <p className="promax-login-intro">使用员工账号进入管理控制台。管理员可以查看团队接入、产出与分轨用量。</p>
        {error === undefined ? null : <div className="promax-alert" role="alert">{error}</div>}
        <form className="promax-login-form" onSubmit={(event) => { void submit(event) }}>
          <div className="promax-field">
            <label htmlFor="promax-employee-id">工号</label>
            <input
              id="promax-employee-id"
              className="promax-input"
              autoComplete="username"
              value={employeeId}
              required
              onChange={(event) => { setEmployeeId(event.target.value) }}
            />
          </div>
          <div className="promax-field">
            <label htmlFor="promax-password">密码</label>
            <input
              id="promax-password"
              className="promax-input"
              type="password"
              autoComplete="current-password"
              value={password}
              required
              onChange={(event) => { setPassword(event.target.value) }}
            />
          </div>
          <button className="promax-button promax-button--primary" type="submit" disabled={busy}>
            {busy ? '正在登录…' : '登录'}
          </button>
        </form>
        <p className="promax-login-foot">Promax · Agent 工作平台</p>
      </section>
    </main>
  )
}

function Forbidden({ api, className, user }: { api: PromaxApiClient; className: string; user: MeResponse }) {
  return (
    <main className={`${className} promax-login`} aria-label="Promax 管理控制台">
      <StatePanel
        title="当前账号没有管理权限"
        message={`${user.name}（${user.employee_id}）已登录，但控制台数据仅管理员可见。`}
        action={<button className="promax-button" type="button" onClick={() => { void api.logout() }}>退出登录</button>}
      />
    </main>
  )
}

function OverviewPage({ api, refreshKey }: PageProps) {
  const [data, setData] = useState<{ overview: ConsoleOverviewResponse; users: ConsoleUsersResponse }>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    setError(undefined)
    Promise.all([api.overview(), api.users()]).then(([overview, users]) => {
      if (!cancelled) setData({ overview, users })
    }).catch((reason: unknown) => { if (!cancelled) setError(errorMessage(reason)) })
    return () => { cancelled = true }
  }, [api, refreshKey])
  if (error !== undefined) return <PageError message={error} />
  if (data === undefined) return <PageLoading />
  const attention = sortedUsers(data.users).filter(user => user.status !== 'ok')
  const coverageNote = data.overview.users_total === 0
    ? '暂无人员接入'
    : attention.length === 0
      ? '全部人员正常上报'
      : `${attention.length} 人需要关注`
  const metrics = [
    ['团队人数', data.overview.users_total, '已纳入 Promax 的人员'],
    ['近 7 天活跃', data.overview.users_active_7d, '存在有效上报'],
    ['产出物总数', data.overview.artifacts_total, '全部 Agent 产出'],
    ['近 7 天产出', data.overview.artifacts_7d, '本周新增产出'],
    ['上报覆盖率', formatPercent(data.overview.coverage_rate), coverageNote],
  ] as const
  return (
    <div className="promax-page">
      <section className="promax-metrics" aria-label="关键指标">
        {metrics.map(([label, value, note]) => (
          <article className="promax-metric" key={label}>
            <div className="promax-metric-label">{label}</div>
            <div className="promax-metric-value promax-number">{value}</div>
            <div className="promax-metric-note">{note}</div>
          </article>
        ))}
      </section>
      <section className="promax-section">
        <SectionHeading title="需要关注" description="never 优先于 stale；状态阈值由服务端判断" />
        <div className="promax-card promax-attention-list">
          {attention.length === 0 ? <div className="promax-empty">目前没有未上报或超期人员</div> : attention.map(user => (
            <div className="promax-attention-item" key={user.employee_id}>
              <div>
                <div className="promax-attention-title">{user.name} · {user.employee_id}</div>
                <div className="promax-attention-meta">{user.dept} · 最近上报：{formatDateTime(user.last_report_at)}</div>
              </div>
              <StatusBadge status={user.status} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function UsersPage({ api, refreshKey }: PageProps) {
  const [users, setUsers] = useState<ConsoleUsersResponse>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    setError(undefined)
    api.users().then(value => { if (!cancelled) setUsers(sortedUsers(value)) })
      .catch((reason: unknown) => { if (!cancelled) setError(errorMessage(reason)) })
    return () => { cancelled = true }
  }, [api, refreshKey])
  if (error !== undefined) return <PageError message={error} />
  if (users === undefined) return <PageLoading />
  const never = users.filter(user => user.status === 'never').length
  const stale = users.filter(user => user.status === 'stale').length
  return (
    <div className="promax-page">
      <div className="promax-section-heading">
        <div>
          <h2>人员上报状态</h2>
          <p><strong>{never}</strong> 人从未上报，<strong>{stale}</strong> 人已超期；异常始终排在前面。</p>
        </div>
      </div>
      <div className="promax-table-wrap">
        <table className="promax-table">
          <thead><tr><th>人员</th><th>状态</th><th>最近上报</th><th>产出物</th></tr></thead>
          <tbody>
            {users.map(user => (
              <tr key={user.employee_id}>
                <td><div className="promax-primary-cell">{user.name}</div><div className="promax-secondary-line">{user.employee_id} · {user.dept}</div></td>
                <td><StatusBadge status={user.status} /></td>
                <td className="promax-number">{formatDateTime(user.last_report_at)}</td>
                <td className="promax-number">{user.artifacts_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface ArtifactFilters {
  employeeId: string
  project: string
  kind: '' | ArtifactKind
  from: string
  to: string
}

const emptyArtifactFilters: ArtifactFilters = { employeeId: '', project: '', kind: '', from: '', to: '' }

function ArtifactsPage({ api, refreshKey }: PageProps) {
  const [draft, setDraft] = useState<ArtifactFilters>(emptyArtifactFilters)
  const [filters, setFilters] = useState<ArtifactFilters>(emptyArtifactFilters)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ConsoleArtifactsResponse>()
  const [error, setError] = useState<string>()
  const [downloading, setDownloading] = useState<string>()
  const size = 50
  useEffect(() => {
    let cancelled = false
    setError(undefined)
    const from = inputDateToIso(filters.from)
    const to = inputDateToIso(filters.to, true)
    const query: ConsoleArtifactsQuery = {
      ...(filters.employeeId === '' ? {} : { employee_id: filters.employeeId }),
      ...(filters.project === '' ? {} : { project: filters.project }),
      ...(filters.kind === '' ? {} : { kind: filters.kind }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      page,
      size,
    }
    api.artifacts(query).then(value => { if (!cancelled) setData(value) })
      .catch((reason: unknown) => { if (!cancelled) setError(errorMessage(reason)) })
    return () => { cancelled = true }
  }, [api, filters, page, refreshKey])

  const download = async (artifact: ConsoleArtifact): Promise<void> => {
    setDownloading(artifact.artifact_id)
    setError(undefined)
    try {
      const response = await api.download(artifact.artifact_id)
      const objectUrl = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = artifact.filename
      anchor.click()
      URL.revokeObjectURL(objectUrl)
    } catch (reason: unknown) {
      setError(errorMessage(reason))
    } finally {
      setDownloading(undefined)
    }
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setPage(1)
    setFilters(draft)
  }
  return (
    <div className="promax-page">
      <form className="promax-filter-bar" onSubmit={submit}>
        <FilterField label="工号"><input className="promax-input" value={draft.employeeId} onChange={event => { setDraft(value => ({ ...value, employeeId: event.target.value })) }} /></FilterField>
        <FilterField label="项目"><input className="promax-input" value={draft.project} onChange={event => { setDraft(value => ({ ...value, project: event.target.value })) }} /></FilterField>
        <FilterField label="类型">
          <select className="promax-select" value={draft.kind} onChange={event => { setDraft(value => ({ ...value, kind: event.target.value as ArtifactFilters['kind'] })) }}>
            <option value="">全部</option>
            {(Object.keys(kindLabels) as ArtifactKind[]).map(kind => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
          </select>
        </FilterField>
        <FilterField label="开始日期"><input className="promax-input" type="date" value={draft.from} onChange={event => { setDraft(value => ({ ...value, from: event.target.value })) }} /></FilterField>
        <FilterField label="结束日期"><input className="promax-input" type="date" value={draft.to} onChange={event => { setDraft(value => ({ ...value, to: event.target.value })) }} /></FilterField>
        <button className="promax-button" type="submit"><Icon name="search" />筛选</button>
      </form>
      {error === undefined ? null : <div className="promax-alert" role="alert">{error}</div>}
      {data === undefined ? <PageLoading /> : (
        <>
          <SectionHeading title={`产出物（${data.total}）`} description="文件由服务端鉴权下载；页面不暴露本地文件内容" />
          <div className="promax-table-wrap">
            <table className="promax-table">
              <thead><tr><th>文件</th><th>人员</th><th>项目 / Agent</th><th>类型</th><th>创建时间</th><th>大小</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {data.items.map(item => (
                  <tr key={item.artifact_id}>
                    <td className="promax-primary-cell">{item.filename}</td>
                    <td className="promax-number">{item.employee_id}</td>
                    <td><div>{item.project}</div><div className="promax-secondary-line">{item.agent}</div></td>
                    <td>{kindLabels[item.kind]}</td>
                    <td className="promax-number">{formatDateTime(item.created_at)}</td>
                    <td className="promax-number">{formatBytes(item.size)}</td>
                    <td><button className="promax-icon-button" type="button" aria-label={`下载 ${item.filename}`} disabled={downloading === item.artifact_id} onClick={() => { void download(item) }}><Icon name="download" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.items.length === 0 ? <div className="promax-empty">没有符合条件的产出物</div> : null}
          </div>
          {data.total > size ? (
            <div className="promax-section-heading promax-section">
              <p>第 {page} 页，共 {Math.ceil(data.total / size)} 页</p>
              <div className="promax-header-actions">
                <button className="promax-icon-button" type="button" aria-label="上一页" disabled={page === 1} onClick={() => { setPage(value => Math.max(1, value - 1)) }}><Icon name="chevronLeft" /></button>
                <button className="promax-icon-button" type="button" aria-label="下一页" disabled={page * size >= data.total} onClick={() => { setPage(value => value + 1) }}><Icon name="chevronRight" /></button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function TelemetryPage({ api, refreshKey }: PageProps) {
  const [groupBy, setGroupBy] = useState<TelemetryGroupBy>('day')
  const [eventType, setEventType] = useState<'' | TelemetryEventType>('')
  const [data, setData] = useState<ConsoleTelemetryResponse>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    setError(undefined)
    api.telemetry({ group_by: groupBy, ...(eventType === '' ? {} : { event_type: eventType }) })
      .then(value => { if (!cancelled) setData(value) })
      .catch((reason: unknown) => { if (!cancelled) setError(errorMessage(reason)) })
    return () => { cancelled = true }
  }, [api, eventType, groupBy, refreshKey])
  return (
    <div className="promax-page">
      <div className="promax-filter-bar">
        <FilterField label="分组方式">
          <select className="promax-select" value={groupBy} onChange={event => { setGroupBy(event.target.value as TelemetryGroupBy) }}>
            <option value="day">按日期</option><option value="user">按人员</option><option value="target">按目标</option>
          </select>
        </FilterField>
        <FilterField label="事件类型">
          <select className="promax-select" value={eventType} onChange={event => { setEventType(event.target.value as '' | TelemetryEventType) }}>
            <option value="">全部</option><option value="agent">Agent</option><option value="skill">Skill</option><option value="chat">Chat</option>
          </select>
        </FilterField>
      </div>
      {error !== undefined ? <div className="promax-alert" role="alert">{error}</div> : null}
      {data === undefined ? <PageLoading /> : (
        <div className="promax-tracks" aria-label="用量分轨">
          <TelemetryTrack source="hook" points={data.series.filter(point => point.source === 'hook')} />
          <TelemetryTrack source="llm" points={data.series.filter(point => point.source === 'llm')} />
        </div>
      )}
    </div>
  )
}

function TelemetryTrack({ source, points }: { source: TelemetrySource; points: ConsoleTelemetrySeriesPoint[] }) {
  const total = points.reduce((sum, point) => sum + point.count, 0)
  const max = Math.max(1, ...points.map(point => point.count))
  const description = source === 'hook' ? '确定性生命周期调用' : '模型推断与对话观测'
  return (
    <section className={`promax-track promax-track--${source}`} aria-label={`${source} 轨用量`}>
      <header className="promax-track-header">
        <div><div className="promax-track-name"><span className="promax-track-dot" />{source} 轨</div><div className="promax-secondary-line">{description}</div></div>
        <div><div className="promax-track-total">{total}</div><div className="promax-track-caption">本轨合计</div></div>
      </header>
      <div className="promax-series">
        {points.length === 0 ? <div className="promax-empty">本轨暂无数据</div> : points.map((point, index) => (
          <div key={`${point.key}-${point.event_type}-${index}`}>
            <div className="promax-bar-label"><span>{point.key} · {eventTypeLabel(point.event_type)}</span><strong>{point.count}</strong></div>
            <div className="promax-bar-track"><div className="promax-bar-fill" style={{ width: `${(point.count / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </section>
  )
}

interface PageProps { api: PromaxApiClient; refreshKey: number }

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div className="promax-section-heading"><div><h2>{title}</h2><p>{description}</p></div></div>
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="promax-field"><span>{label}</span>{children}</label>
}

function StatusBadge({ status }: { status: UserReportStatus }) {
  return <span className={`promax-status promax-status--${status}`}>{statusLabels[status]}</span>
}

function StatePanel({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return <div className="promax-state-panel"><div><strong>{title}</strong><div>{message}</div>{action === undefined ? null : <div className="promax-section">{action}</div>}</div></div>
}

function PageLoading() { return <div className="promax-state-panel" role="status" aria-live="polite">正在加载…</div> }
function PageError({ message }: { message: string }) { return <div className="promax-state-panel" role="alert"><div><strong>页面加载失败</strong><div>{message}</div></div></div> }

function PromaxGlyph() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 5.5h8.25a5.25 5.25 0 0 1 0 10.5H9v3H5V5.5Zm4 4v2.5h4.25a1.25 1.25 0 1 0 0-2.5H9Z" /><path d="m16.9 15.2 2.6 3.8h-4.2l-2.4-3.8h4Z" opacity=".56" /></svg>
}

function sortedUsers(users: ConsoleUsersResponse): ConsoleUser[] {
  const rank: Record<UserReportStatus, number> = { never: 0, stale: 1, ok: 2 }
  return [...users].sort((left, right) => rank[left.status] - rank[right.status] || left.employee_id.localeCompare(right.employee_id))
}

function eventTypeLabel(value: TelemetryEventType): string {
  return value === 'agent' ? 'Agent' : value === 'skill' ? 'Skill' : 'Chat'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误，请稍后重试'
}
