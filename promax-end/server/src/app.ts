import { randomUUID } from 'node:crypto'

import Fastify, { type FastifyInstance } from 'fastify'

import type {
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  MeResponse,
  PromateArtifactProposeRequest,
  PromateArtifactRequest,
  PromateArtifactType,
  RefreshRequest,
  RefreshResponse,
} from '@promax/contracts'

import { AuthService, type IssuedTokens } from './auth.ts'
import { ArtifactService, MAX_DIRECT_ARTIFACT_BYTES } from './artifacts.ts'
import { ConsoleService } from './console.ts'
import { ChunkUploadService } from './chunk-uploads.ts'
import { ApiError } from './errors.ts'
import type { PromateService } from './promate.ts'
import { ReportingService } from './reporting.ts'

export interface AppDependencies {
  auth: AuthService
  artifacts: ArtifactService
  reporting: ReportingService
  console: ConsoleService
  chunkUploads: ChunkUploadService
  promate?: PromateService
}

const promateArtifactTypes = new Set<PromateArtifactType>([
  '调研报告', '需求文档PRD', '产品方案', '原型',
  '评审记录', '技术方案', '竞品分析', '市场调研',
])
const agentIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u

function loginRequest(value: unknown): LoginRequest {
  if (!value || typeof value !== 'object') throw new ApiError('VALIDATION', '请输入工号和密码')
  const candidate = value as Record<string, unknown>
  if (typeof candidate.employee_id !== 'string' || candidate.employee_id.length === 0) {
    throw new ApiError('VALIDATION', '请输入工号', { field: 'employee_id' })
  }
  if (typeof candidate.password !== 'string' || candidate.password.length === 0) {
    throw new ApiError('VALIDATION', '请输入密码', { field: 'password' })
  }
  return { employee_id: candidate.employee_id, password: candidate.password }
}

function refreshRequest(value: unknown): RefreshRequest {
  if (!value || typeof value !== 'object') throw new ApiError('VALIDATION', '请输入 refresh_token')
  const candidate = value as Record<string, unknown>
  if (typeof candidate.refresh_token !== 'string' || candidate.refresh_token.length === 0) {
    throw new ApiError('VALIDATION', '请输入 refresh_token', { field: 'refresh_token' })
  }
  return { refresh_token: candidate.refresh_token }
}

function logoutRequest(value: unknown): LogoutRequest {
  return refreshRequest(value)
}

function tokenResponse(issued: IssuedTokens): LoginResponse {
  return {
    access_token: issued.accessToken,
    refresh_token: issued.refreshToken,
    token_type: 'Bearer',
    expires_in: issued.expiresIn,
    refresh_expires_in: issued.refreshExpiresIn,
  }
}

function promateContext(headers: Record<string, string | string[] | undefined>): { agent: string; requestId: string } {
  const agent = singleHeader(headers['x-promax-agent'])
  if (!agent || !agentIdPattern.test(agent)) {
    throw new ApiError('VALIDATION', 'X-Promax-Agent 无效', { field: 'X-Promax-Agent' })
  }
  const suppliedRequestId = singleHeader(headers['x-request-id'])
  if (suppliedRequestId !== undefined && !requestIdPattern.test(suppliedRequestId)) {
    throw new ApiError('VALIDATION', 'X-Request-Id 无效', { field: 'X-Request-Id' })
  }
  return { agent, requestId: suppliedRequestId ?? randomUUID() }
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function queryRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('VALIDATION', '查询参数无效')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new ApiError('VALIDATION', `${field} 无效`, { field })
  }
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, field)
}

function booleanQuery(value: unknown, field: string): boolean {
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new ApiError('VALIDATION', `${field} 必须是 true 或 false`, { field })
}

function promateArtifactRequest(value: unknown): PromateArtifactRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('VALIDATION', 'Promate 产出关联请求无效')
  }
  const candidate = value as Record<string, unknown>
  if (candidate.stage === 'commit') {
    return { stage: 'commit', request_id: requiredString(candidate.request_id, 'request_id') }
  }
  if (candidate.stage !== 'propose') throw new ApiError('VALIDATION', 'stage 无效', { field: 'stage' })
  const type = requiredString(candidate.type, 'type') as PromateArtifactType
  if (!promateArtifactTypes.has(type)) throw new ApiError('VALIDATION', 'type 无效', { field: 'type' })
  const summary = optionalString(candidate.summary, 'summary')
  const request: PromateArtifactProposeRequest = {
    stage: 'propose',
    artifact_id: requiredString(candidate.artifact_id, 'artifact_id'),
    project_id: requiredString(candidate.project_id, 'project_id'),
    requirement_id: requiredString(candidate.requirement_id, 'requirement_id'),
    type,
    ...(summary === undefined ? {} : { summary }),
  }
  return request
}

function requiredPromate(dependencies: AppDependencies): PromateService {
  if (!dependencies.promate) {
    throw new ApiError('UPSTREAM_UNAVAILABLE', 'Promate Adapter 未配置', { capability: 'promate' })
  }
  return dependencies.promate
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: Math.ceil(MAX_DIRECT_ARTIFACT_BYTES * 4 / 3) + 65_536 })

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body)
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.status).send(error.toResponse())
      return
    }

    if (typeof error === 'object' && error !== null && 'code' in error
      && (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
        || error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE')) {
      const message = error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
        ? '请求体超过允许大小'
        : error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'Content-Type 无效' : '请求体不是有效的 JSON'
      const validation = new ApiError('VALIDATION', message)
      void reply.status(validation.status).send(validation.toResponse())
      return
    }

    app.log.error(error)
    const internal = new ApiError('INTERNAL', '服务暂时不可用，请稍后重试')
    void reply.status(internal.status).send(internal.toResponse())
  })

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = loginRequest(request.body)
    const issued = await dependencies.auth.login(body.employee_id, body.password)
    return reply.status(200).send(tokenResponse(issued))
  })

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const body = refreshRequest(request.body)
    const response: RefreshResponse = tokenResponse(await dependencies.auth.refresh(body.refresh_token))
    return reply.status(200).send(response)
  })

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const body = logoutRequest(request.body)
    dependencies.auth.logout(body.refresh_token)
    return reply.status(204).send()
  })

  app.get('/api/v1/me', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const response: MeResponse = {
      employee_id: user.employeeId,
      name: user.name,
      dept: user.dept,
      role: user.role,
    }
    return reply.status(200).send(response)
  })

  app.get('/api/v1/promate/projects', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const context = promateContext(request.headers)
    return reply.status(200).send(await requiredPromate(dependencies).projects(user, context.agent, context.requestId))
  })

  app.get('/api/v1/promate/requirements', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const context = promateContext(request.headers)
    const query = queryRecord(request.query)
    const projectId = requiredString(query.project_id, 'project_id')
    const search = optionalString(query.query, 'query')
    return reply.status(200).send(await requiredPromate(dependencies).requirements(user, context.agent, context.requestId, {
      projectId,
      includeDone: booleanQuery(query.include_done, 'include_done'),
      ...(search === undefined ? {} : { query: search }),
    }))
  })

  app.get('/api/v1/promate/skills', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const context = promateContext(request.headers)
    const query = queryRecord(request.query)
    const search = optionalString(query.query, 'query')
    const category = optionalString(query.category, 'category')
    return reply.status(200).send(await requiredPromate(dependencies).skills(user, context.agent, context.requestId, {
      ...(search === undefined ? {} : { query: search }),
      ...(category === undefined ? {} : { category }),
    }))
  })

  app.get('/api/v1/promate/skills/:id', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const context = promateContext(request.headers)
    const parameters = request.params as { id?: unknown }
    const id = requiredString(parameters.id, 'id')
    return reply.status(200).send(await requiredPromate(dependencies).skill(user, context.agent, context.requestId, id))
  })

  app.post('/api/v1/promate/artifacts', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const context = promateContext(request.headers)
    const body = promateArtifactRequest(request.body)
    if (body.stage === 'propose') {
      return reply.status(200).send(
        await requiredPromate(dependencies).proposeArtifact(user, context.agent, context.requestId, body),
      )
    }
    if (singleHeader(request.headers['x-request-id']) !== undefined && context.requestId !== body.request_id) {
      throw new ApiError('CONFLICT', 'X-Request-Id 必须与 propose 返回的 request_id 一致', { field: 'X-Request-Id' })
    }
    const result = await requiredPromate(dependencies).commitArtifact(user, context.agent, body.request_id)
    return reply.status(result.statusCode).send(result.response)
  })

  app.get('/api/v1/promate/operations/:requestId', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const context = promateContext(request.headers)
    const parameters = request.params as { requestId?: unknown }
    const requestId = requiredString(parameters.requestId, 'request_id')
    return reply.status(200).send(requiredPromate(dependencies).operation(user, context.agent, requestId))
  })

  app.post('/api/v1/artifacts', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const response = dependencies.artifacts.upload(user.employeeId, request.body)
    return reply.status('duplicate' in response ? 200 : 201).send(response)
  })

  app.get('/api/v1/artifacts/:id/download', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const parameters = request.params as { id?: unknown }
    const id = requiredString(parameters.id, 'id')
    const download = await dependencies.console.downloadOwned(user, id)
    return reply
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`)
      .header('content-length', download.content.byteLength)
      .type('application/octet-stream')
      .status(200)
      .send(download.content)
  })

  app.post('/api/v1/telemetry', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const response = dependencies.reporting.telemetry(user.employeeId, request.body)
    return reply.status(202).send(response)
  })

  app.post('/api/v1/heartbeat', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const response = dependencies.reporting.heartbeat(user.employeeId, request.body)
    return reply.status(200).send(response)
  })

  app.post('/api/v1/artifacts/init', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    return reply.status(200).send(dependencies.chunkUploads.init(user.employeeId, request.body))
  })

  app.put('/api/v1/artifacts/:uploadId/chunk/:n', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const parameters = request.params as { uploadId?: unknown; n?: unknown }
    if (typeof parameters.uploadId !== 'string' || typeof parameters.n !== 'string') {
      throw new ApiError('VALIDATION', '分片路径参数无效')
    }
    await dependencies.chunkUploads.putChunk(user.employeeId, parameters.uploadId, parameters.n, request.body)
    return reply.status(204).send()
  })

  app.post('/api/v1/artifacts/:uploadId/complete', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const parameters = request.params as { uploadId?: unknown }
    if (typeof parameters.uploadId !== 'string') throw new ApiError('VALIDATION', 'upload_id 无效', { field: 'upload_id' })
    const response = await dependencies.chunkUploads.complete(user.employeeId, parameters.uploadId)
    return reply.status('duplicate' in response ? 200 : 201).send(response)
  })

  app.get('/api/v1/console/overview', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    return reply.status(200).send(dependencies.console.overview(user))
  })

  app.get('/api/v1/console/users', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    return reply.status(200).send(dependencies.console.users(user))
  })

  app.get('/api/v1/console/artifacts', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    return reply.status(200).send(dependencies.console.artifactList(user, request.query))
  })

  app.get('/api/v1/console/telemetry', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    return reply.status(200).send(dependencies.console.telemetry(user, request.query))
  })

  app.get('/api/v1/console/artifacts/:id/download', async (request, reply) => {
    const user = await dependencies.auth.authenticate(request.headers.authorization)
    const parameters = request.params as { id?: unknown }
    if (typeof parameters.id !== 'string') throw new ApiError('VALIDATION', 'artifact id 无效', { field: 'id' })
    const download = await dependencies.console.download(user, parameters.id)
    return reply
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`)
      .header('content-length', download.content.byteLength)
      .type('application/octet-stream')
      .status(200)
      .send(download.content)
  })

  return app
}
