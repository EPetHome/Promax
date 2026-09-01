import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type {
  ApiErrorCode,
  ApiErrorResponse,
  ArtifactCreatedResponse,
  ArtifactDuplicateResponse,
  ArtifactInitResponse,
  ArtifactUploadRequest,
  ConsoleArtifactsResponse,
  ConsoleOverviewResponse,
  ConsoleTaskStateResponse,
  ConsoleTelemetryResponse,
  ConsoleUsersResponse,
  HeartbeatPostResponse,
  LoginResponse,
  PromateArtifactRequest,
  PromateArtifactResponse,
  PromateOperationResponse,
  PromateProjectsResponse,
  PromateRequirementsResponse,
  PromateSkillResponse,
  PromateSkillsResponse,
  RefreshResponse,
  MeResponse,
  TelemetryPostResponse,
  TaskStatePostRequest,
  TaskStatePostResponse,
} from './types.ts'

interface ErrorFixture extends ApiErrorResponse {
  status: number
}

interface DownloadFixture {
  artifact_id: string
  filename: string
  media_type: string
  size: number
  content_base64: string
}

const fixtureDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url))

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${fixtureDirectory}${name}`, 'utf8')) as T
}

const responses = {
  login: fixture<LoginResponse>('auth.login.response.json'),
  refresh: fixture<RefreshResponse>('auth.refresh.response.json'),
  me: fixture<MeResponse>('me.response.json'),
  artifactCreated: fixture<ArtifactCreatedResponse>('artifacts.post.response.json'),
  artifactDuplicate: fixture<ArtifactDuplicateResponse>('artifacts.post.duplicate.response.json'),
  telemetry: fixture<TelemetryPostResponse>('telemetry.post.response.json'),
  heartbeat: fixture<HeartbeatPostResponse>('heartbeat.post.response.json'),
  overview: fixture<ConsoleOverviewResponse>('console.overview.response.json'),
  users: fixture<ConsoleUsersResponse>('console.users.response.json'),
  artifacts: fixture<ConsoleArtifactsResponse>('console.artifacts.response.json'),
  telemetrySeries: fixture<ConsoleTelemetryResponse>('console.telemetry.response.json'),
  taskState: fixture<TaskStatePostResponse>('task-state.post.response.json'),
  consoleTaskState: fixture<ConsoleTaskStateResponse>('console.task-state.response.json'),
  download: fixture<DownloadFixture>('console.artifact-download.response.json'),
  artifactInit: fixture<ArtifactInitResponse>('artifacts.init.response.json'),
  artifactComplete: fixture<ArtifactCreatedResponse>('artifacts.complete.response.json'),
  promateProjects: fixture<PromateProjectsResponse>('promate.projects.response.json'),
  promateRequirements: fixture<PromateRequirementsResponse>('promate.requirements.response.json'),
  promateSkills: fixture<PromateSkillsResponse>('promate.skills.response.json'),
  promateSkill: fixture<PromateSkillResponse>('promate.skill.response.json'),
  promateArtifactPropose: fixture<PromateArtifactResponse>('promate.artifact.propose.response.json'),
  promateArtifactCommit: fixture<PromateArtifactResponse>('promate.artifact.commit.response.json'),
  promateOperation: fixture<PromateOperationResponse>('promate.operation.response.json'),
  errors: fixture<ErrorFixture[]>('errors.json'),
}

const errorCodes = new Set<ApiErrorCode>([
  'UNAUTHORIZED', 'VALIDATION', 'CONFLICT', 'RATE_LIMIT', 'UPSTREAM_UNAVAILABLE', 'INTERNAL',
])
const seenArtifactHashes = new Set<string>()
const maximumRequestBytes = 6 * 1024 * 1024

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Mock-Error, X-Promax-Agent, X-Request-Id')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const serialized = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(serialized),
  })
  response.end(serialized)
}

function sendError(response: ServerResponse, code: ApiErrorCode): void {
  const selected = responses.errors.find((candidate) => candidate.error.code === code)
  if (!selected) throw new Error(`Missing error fixture for ${code}`)
  const { status, ...body } = selected
  sendJson(response, status, body)
}

function hasBearerToken(request: IncomingMessage): boolean {
  return /^Bearer\s+\S+$/.test(request.headers.authorization ?? '')
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maximumRequestBytes) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  return JSON.parse((await readBody(request)).toString('utf8')) as T
}

const server = createServer(async (request, response) => {
  setCorsHeaders(response)
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', 'http://localhost')
  const injectedError = request.headers['x-mock-error']
  if (typeof injectedError === 'string' && errorCodes.has(injectedError as ApiErrorCode)) {
    sendError(response, injectedError as ApiErrorCode)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/auth/login') {
    try {
      await readJson(request)
      sendJson(response, 200, responses.login)
    } catch {
      sendError(response, 'VALIDATION')
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/auth/refresh') {
    try {
      await readJson(request)
      sendJson(response, 200, responses.refresh)
    } catch {
      sendError(response, 'VALIDATION')
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
    try {
      await readJson(request)
      response.writeHead(204)
      response.end()
    } catch {
      sendError(response, 'VALIDATION')
    }
    return
  }

  if (!hasBearerToken(request)) {
    sendError(response, 'UNAUTHORIZED')
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/me') {
    sendJson(response, 200, responses.me)
    return
  }

  if (url.pathname.startsWith('/api/v1/promate/') && !request.headers['x-promax-agent']) {
    sendError(response, 'VALIDATION')
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/promate/projects') {
    sendJson(response, 200, responses.promateProjects)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/promate/requirements') {
    if (!url.searchParams.get('project_id')) sendError(response, 'VALIDATION')
    else sendJson(response, 200, responses.promateRequirements)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/promate/skills') {
    sendJson(response, 200, responses.promateSkills)
    return
  }

  if (request.method === 'GET' && /^\/api\/v1\/promate\/skills\/[^/]+$/.test(url.pathname)) {
    sendJson(response, 200, responses.promateSkill)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/promate/artifacts') {
    try {
      const body = await readJson<PromateArtifactRequest>(request)
      sendJson(response, 200, body.stage === 'commit' ? responses.promateArtifactCommit : responses.promateArtifactPropose)
    } catch {
      sendError(response, 'VALIDATION')
    }
    return
  }

  if (request.method === 'GET' && /^\/api\/v1\/promate\/operations\/[^/]+$/.test(url.pathname)) {
    sendJson(response, 200, responses.promateOperation)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/artifacts') {
    try {
      const body = await readJson<ArtifactUploadRequest>(request)
      if (seenArtifactHashes.has(body.sha256)) {
        sendJson(response, 200, responses.artifactDuplicate)
      } else {
        seenArtifactHashes.add(body.sha256)
        sendJson(response, 201, responses.artifactCreated)
      }
    } catch {
      sendError(response, 'VALIDATION')
    }
    return
  }

  if (request.method === 'GET' && /^\/api\/v1\/artifacts\/[^/]+\/download$/.test(url.pathname)) {
    const body = Buffer.from(responses.download.content_base64, 'base64')
    response.writeHead(200, {
      'Content-Type': responses.download.media_type,
      'Content-Length': body.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(responses.download.filename)}`,
    })
    response.end(body)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/telemetry') {
    await readBody(request)
    sendJson(response, 202, responses.telemetry)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/task-state') {
    try {
      await readJson<TaskStatePostRequest>(request)
      sendJson(response, 200, responses.taskState)
    } catch {
      sendError(response, 'VALIDATION')
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/heartbeat') {
    await readBody(request)
    sendJson(response, 200, responses.heartbeat)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/console/overview') {
    sendJson(response, 200, responses.overview)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/console/users') {
    sendJson(response, 200, responses.users)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/console/artifacts') {
    sendJson(response, 200, responses.artifacts)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/console/telemetry') {
    sendJson(response, 200, responses.telemetrySeries)
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/console/task-state') {
    if (!url.searchParams.get('session_id') || !url.searchParams.get('task_key')) {
      sendError(response, 'VALIDATION')
    } else {
      sendJson(response, 200, responses.consoleTaskState)
    }
    return
  }

  if (request.method === 'GET' && /^\/api\/v1\/console\/artifacts\/[^/]+\/download$/.test(url.pathname)) {
    const body = Buffer.from(responses.download.content_base64, 'base64')
    response.writeHead(200, {
      'Content-Type': responses.download.media_type,
      'Content-Length': body.length,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(responses.download.filename)}`,
    })
    response.end(body)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/artifacts/init') {
    await readBody(request)
    sendJson(response, 200, responses.artifactInit)
    return
  }

  if (request.method === 'PUT' && /^\/api\/v1\/artifacts\/[^/]+\/chunk\/\d+$/.test(url.pathname)) {
    await readBody(request)
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === 'POST' && /^\/api\/v1\/artifacts\/[^/]+\/complete$/.test(url.pathname)) {
    await readBody(request)
    sendJson(response, 201, responses.artifactComplete)
    return
  }

  sendError(response, 'VALIDATION')
})

const configuredPort = Number.parseInt(process.env.PORT ?? '3001', 10)
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

server.listen(configuredPort, '127.0.0.1', () => {
  process.stdout.write(`Promax contract mock listening on http://127.0.0.1:${configuredPort}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
