/**
 * Promax's native Cordis reporting plugin.
 *
 * It observes committed dsh runtime events and never adds model-visible prompt
 * text. Event listeners only schedule asynchronous work; network and file I/O
 * cannot block or change an Agent tool result.
 *
 * @module @promax/promax-report
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'

import { Config, HEARTBEAT_INTERVAL_MS, resolveConfig } from './config.ts'
import { effectiveConfigFingerprint } from './fingerprint.ts'
import {
  FEISHU_TELEMETRY_SETTINGS_NS,
  FeishuReportTransport,
  FeishuTelemetryCollector,
  FeishuTelemetrySettingsSchema,
  type CredentialsService,
  type FeishuTelemetrySettings,
  type SettingsScope,
} from './feishu.ts'
import { DurableReportQueue } from './outbox.ts'
import { PromaxReporter } from './reporter.ts'
import { RotatingTokenManager } from './token-manager.ts'
import { HttpReportTransport } from './transport.ts'

export const name = 'promax-report'
export const inject = ['loader']
export { Config }
export type { Config as ConfigShape, ResolvedConfig } from './config.ts'
export { CLIENT_VERSION, DEFAULT_DSH_VERSION, HEARTBEAT_INTERVAL_MS, MAX_DIRECT_ARTIFACT_BYTES, resolveConfig } from './config.ts'
export { canonicalJson, effectiveConfigFingerprint } from './fingerprint.ts'
export { DurableReportQueue } from './outbox.ts'
export { artifactKind, extractMutationPath, isMutationTool, PromaxReporter, resolveAgentPreset } from './reporter.ts'
export { isJudgeReportPath, loadTeamRevisionArtifactCatalog } from './team-revision-artifacts.ts'
export type { TeamRevisionArtifactCatalog } from './team-revision-artifacts.ts'
export { RotatingTokenManager } from './token-manager.ts'
export type { AccessTokenProvider, RotatingTokenManagerOptions, TokenRefreshResult } from './token-manager.ts'
export { HttpReportTransport } from './transport.ts'
export type { DeliveryResult, ReportPath, ReportRequest, ReportTransport } from './transport.ts'
export {
  FEISHU_TELEMETRY_SETTINGS_NS,
  FeishuReportTransport,
  FeishuTelemetryCollector,
  FeishuTelemetrySettingsSchema,
  judgeSummary,
  provisionFeishuTelemetry,
  runDetailMarkdown,
} from './feishu.ts'
export type { FeishuRunSnapshot, FeishuSkillCall, FeishuTelemetrySettings } from './feishu.ts'

interface SettingsService {
  register<T>(ns: string, schema: unknown, options: { base: T; applies: 'live' | 'restart' }): SettingsScope<T>
}

function backendConfigured(config: Config): boolean {
  return [config.baseUrl, config.accessToken, config.refreshToken, config.employeeId]
    .every(value => value.trim() !== '' && value.trim() !== 'not-configured')
}

function installFeishuSink(ctx: Context, resolved: ReturnType<typeof resolveConfig>): void {
  let activeCollector: FeishuTelemetryCollector | undefined
  let installed = false
  // Child session/tool/root turn events need global visibility across scopes.
  ctx.on('agent/session-start', ({ agent }) => { activeCollector?.startSession(agent) }, { global: true })
  ctx.on('tools/result', (exec, result) => { activeCollector?.recordToolResult(exec, result) }, { global: true })
  ctx.on('agent/turn-stopping', ({ agent }) => { activeCollector?.observeTurn(agent) }, { global: true })
  const mount = (sinkContext: Context, services: { settings: SettingsService; credentials: CredentialsService }): void => {
    if (installed) return
    installed = true
    const scope = services.settings.register<FeishuTelemetrySettings>(
      FEISHU_TELEMETRY_SETTINGS_NS,
      FeishuTelemetrySettingsSchema,
      { base: { appToken: '', folderToken: '' }, applies: 'live' },
    )
    const collector = new FeishuTelemetryCollector(
      () => scope.get(),
      new DurableReportQueue(
        resolved.dshHome,
        new FeishuReportTransport(() => scope.get(), services.credentials, resolved.requestTimeoutMs),
        sinkContext.logger,
        'feishu-outbox',
      ),
      sinkContext.logger,
    )
    activeCollector = collector
    sinkContext.effect(() => {
      const startup = setTimeout(() => { collector.flush() }, 0)
      const interval = setInterval(() => { collector.flush() }, HEARTBEAT_INTERVAL_MS)
      const unwatch = scope.watch((next, previous) => {
        if (next.appToken !== previous.appToken || next.folderToken !== previous.folderToken) collector.retryDead()
      })
      startup.unref()
      interval.unref()
      return async () => {
        clearTimeout(startup)
        clearInterval(interval)
        unwatch()
        await collector.idle()
        if (activeCollector === collector) activeCollector = undefined
      }
    }, 'promax-report.feishu')
  }
  const settings = ctx.get('settings') as SettingsService | undefined
  const credentials = ctx.get('credentials') as CredentialsService | undefined
  if (settings && credentials) mount(ctx, { settings, credentials })
  else ctx.inject(['settings', 'credentials'] as never, (sinkContext: Context) => {
    const services = sinkContext as unknown as { settings: SettingsService; credentials: CredentialsService }
    mount(sinkContext, services)
  })
}

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  let reporter: PromaxReporter | undefined
  if (backendConfigured(config)) {
    const tokens = new RotatingTokenManager({
      baseUrl: resolved.baseUrl,
      employeeId: resolved.employeeId,
      accessToken: resolved.accessToken,
      refreshToken: resolved.refreshToken,
      storePath: resolved.tokenStorePath,
      timeoutMs: resolved.requestTimeoutMs,
    }, ctx.logger)
    const transport = new HttpReportTransport(resolved.baseUrl, tokens, resolved.requestTimeoutMs)
    const queue = new DurableReportQueue(resolved.dshHome, transport, ctx.logger)
    reporter = new PromaxReporter(resolved, queue, () => effectiveConfigFingerprint(ctx), ctx.logger)
  } else {
    ctx.logger.debug('promax-report internal backend sink is disabled because its credentials are not configured')
  }

  installFeishuSink(ctx, resolved)
  const runtimeEvents = ctx as unknown as {
    on(event: 'promax/decision', listener: (payload: {
      sessionId: string
      target: Parameters<PromaxReporter['recordDecisionForSession']>[1]
      decision: Parameters<PromaxReporter['recordDecisionForSession']>[2]
    }) => void): void
    on(event: 'promax/task-state', listener: (payload: Parameters<PromaxReporter['recordTaskState']>[0]) => void): void
  }

  runtimeEvents.on('promax/decision', payload => {
    reporter?.recordDecisionForSession(payload.sessionId, payload.target, payload.decision)
  })
  runtimeEvents.on('promax/task-state', payload => {
    reporter?.recordTaskState(payload)
  })

  ctx.on('agent/session-start', ({ agent }) => {
    reporter?.startSession(agent)
  })

  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message.source.kind === 'user') reporter?.recordChat(agent)
  })

  ctx.on('tools/result', (exec, result) => {
    reporter?.recordToolResult(exec, result)
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    reporter?.scanTurnArtifacts(agent)
  })

  ctx.effect(() => {
    const startup = setTimeout(() => {
      reporter?.heartbeat()
    }, 0)
    const interval = setInterval(() => {
      reporter?.heartbeat()
    }, HEARTBEAT_INTERVAL_MS)
    startup.unref()
    interval.unref()
    return async () => {
      clearTimeout(startup)
      clearInterval(interval)
      await reporter?.idle()
    }
  }, 'promax-report.heartbeat')
}
