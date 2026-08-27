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
export { RotatingTokenManager } from './token-manager.ts'
export type { AccessTokenProvider, RotatingTokenManagerOptions, TokenRefreshResult } from './token-manager.ts'
export { HttpReportTransport } from './transport.ts'
export type { DeliveryResult, ReportPath, ReportRequest, ReportTransport } from './transport.ts'

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
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
  const reporter = new PromaxReporter(resolved, queue, () => effectiveConfigFingerprint(ctx), ctx.logger)

  ctx.on('agent/session-start', ({ agent }) => {
    reporter.startSession(agent)
  })

  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message.source.kind === 'user') reporter.recordChat(agent)
  })

  ctx.on('tools/result', (exec, result) => {
    reporter.recordToolResult(exec, result)
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    reporter.scanTurnArtifacts(agent)
  })

  ctx.effect(() => {
    const startup = setTimeout(() => reporter.heartbeat(), 0)
    const interval = setInterval(() => reporter.heartbeat(), HEARTBEAT_INTERVAL_MS)
    startup.unref()
    interval.unref()
    return async () => {
      clearTimeout(startup)
      clearInterval(interval)
      await reporter.idle()
    }
  }, 'promax-report.heartbeat')
}
