import { AuthService } from './auth.ts'
import { buildApp } from './app.ts'
import { SqliteArtifactRepository } from './artifact-repository.ts'
import { ArtifactService } from './artifacts.ts'
import { SqliteConsoleRepository } from './console-repository.ts'
import { ConsoleService } from './console.ts'
import { SqliteChunkUploadRepository } from './chunk-upload-repository.ts'
import { ChunkUploadService } from './chunk-uploads.ts'
import { loadServerConfig } from './config.ts'
import { openDatabase } from './database.ts'
import { SqliteRefreshTokenRepository } from './refresh-token-repository.ts'
import { SqliteReportingRepository } from './reporting-repository.ts'
import { ReportingService } from './reporting.ts'
import { RawGitBatcher } from './raw-git.ts'
import { StaticPromateCredentialProvider } from './promate-credentials.ts'
import { DisabledPromateGateway, McpPromateGateway } from './promate-gateway.ts'
import { SqlitePromateOperationRepository } from './promate-operation-repository.ts'
import { PromateRetryWorker, PromateService } from './promate.ts'
import { SqliteUserRepository } from './user-repository.ts'

const config = loadServerConfig()
const rawGit = new RawGitBatcher(config.rawDirectory, {
  batchSize: config.rawGitBatchSize,
  intervalMs: config.rawGitIntervalMs,
  onError: (error) => console.error('raw/ Git batch commit failed', error),
})
await rawGit.start()
const database = openDatabase(config.databasePath)
const users = new SqliteUserRepository(database)
const auth = new AuthService(
  users,
  new SqliteRefreshTokenRepository(database),
  config.jwtSecret,
  config.accessTtlSeconds,
  config.refreshTtlSeconds,
)
const artifacts = new ArtifactService(
  new SqliteArtifactRepository(database),
  config.rawDirectory,
  undefined,
  undefined,
  () => rawGit.noteArtifact(),
)
const reporting = new ReportingService(new SqliteReportingRepository(database))
const consoleService = new ConsoleService(
  new SqliteConsoleRepository(database),
  new SqliteArtifactRepository(database),
  config.dataDirectory,
  config.staleAfterDays,
)
const chunkUploads = new ChunkUploadService(
  new SqliteChunkUploadRepository(database),
  new SqliteArtifactRepository(database),
  artifacts,
  config.uploadsDirectory,
  config.maxArtifactBytes,
)
const promateGateway = config.promateMcpUrl === undefined
  ? new DisabledPromateGateway()
  : new McpPromateGateway(config.promateMcpUrl, config.promateTimeoutMs)
const promate = new PromateService(
  promateGateway,
  new StaticPromateCredentialProvider(config.promateUserTokens),
  new SqlitePromateOperationRepository(database),
  new SqliteArtifactRepository(database),
  {
    orgId: config.promateOrgId,
    publicBaseUrl: config.publicBaseUrl,
    maxAttempts: config.promateRetryAttempts,
    requirementsTool: config.promateRequirementsTool,
  },
)
const promateRetry = new PromateRetryWorker(
  promate,
  config.promateRetryIntervalMs,
  (error) => console.error('Promate compensation retry failed', error),
)
promateRetry.start()

const app = buildApp({ auth, artifacts, reporting, console: consoleService, chunkUploads, promate })
app.addHook('onClose', async () => {
  try {
    await promateRetry.close()
  } finally {
    try {
      await rawGit.close()
    } finally {
      database.close()
    }
  }
})

let closing = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return
    closing = true
    void app.close()
  })
}

await app.listen({ host: config.host, port: config.port })
