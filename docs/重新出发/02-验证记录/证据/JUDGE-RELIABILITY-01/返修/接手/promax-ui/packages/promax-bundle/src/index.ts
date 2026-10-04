import {
  browserCommandReason,
  checkOutcome,
  parseJudgeReport,
  repairOwners,
  type JudgeReport,
} from "./judge-report.ts";
import { bindRuntimeRole, installRequestHealth } from "./request-health.ts";
import { executionFactsBrief, hasDispatchRecord, installDispatchControl, reusedDispatch } from "./dispatch-control.ts";
import { selectRequestProgress } from "../../promax-ui-console/src/request-progress.ts";
import { installContextBudget } from "./context-budget.ts";
import { ratingFactsTool, RATING_FACTS_TOOL } from "./rating-facts.ts";
import { workMetrics } from "./chain-metrics.ts";
import { knownToolFailure, recordToolHealth, recordPolicyDenial } from "./tool-health.ts";
import { WorkStore, serializeWork, frozenInput, type WorkRound } from "./work-store.ts";
import { productRevisionForSession, resolveProductSessionPreset } from "./promax-session-binding.ts";
import { confirmedWords, effectiveRequirements, requirementsBrief, taskCompletion } from "../../promax-ui-console/src/effective-protocol.ts";
import { policyFromRevision } from "./acceptance-baseline.ts";
import { buildRuntimeSnapshot } from "./runtime-snapshot.ts";
import { uploadedJudgeReport } from "./report-adapter.ts";
import {
  CHECK_RESULT_TOOL,
  REPAIR_PLAN_TOOL,
  MEMBER_RECEIPT_TOOL,
  STRUCTURED_TOOLS,
  WORK_PROPOSAL_TOOL,
  commitStructuredSubmission,
  settleStructuredCommits,
  structuredToolDefinitions,
  type StructuredDeps,
} from "./structured-results.ts";
import {
  CONTROL_LABEL,
  RECOVERY_LIMIT,
  activeDecisions,
  deriveAgentStatus,
  openFaults,
  unprocessedEvents,
  type AgentStatus,
  type FaultClass,
  type FaultRecord,
} from "../../promax-ui-console/src/work-control.ts";
import { createRequire } from "node:module";
import { deliveryFacts, deliveryKey, settlementInFlight, singleSettlement, waitForSettlement } from "./delivery.ts";
import {
  artifactOperation,
  decisionUpdate,
  outsideAnchorChanges,
} from "./artifact-operations.ts";
import {
  ArtifactConflictError,
  artifactVersionId,
  reportKeys,
  workId,
  type TraceUploader,
} from "@promax/promax-report";
import {
  WORK_SYSTEM_PROMPT,
  hasWorkBlock,
  workMembers,
  type PendingItem,
  type WorkCard,
} from "../../promax-ui-console/src/work-protocol.ts";
/** The installed bundle version; recorded with faults and defects as the version they occurred in. */
export const BUNDLE_VERSION: string = (() => {
  try {
    return String((createRequire(import.meta.url)("../package.json") as { version?: string }).version ?? "unknown");
  } catch {
    return "unknown";
  }
})();
import {
  collaborationContext,
  isReturnIntent,
} from "../../promax-ui-console/src/work-spine.ts";
import { installCompanyConnection } from "./company-connection.ts";
import { installCompanyFeishu } from "./feishu-bridge.ts";
import { readTaskTraces } from "./task-trace.ts";
import type {
  RotatingTokenManager,
  PromateProject,
} from "@promax/promax-report";
import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { chmodSync, existsSync, readFileSync, type Dirent } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { FeishuApi } from "@promax/feishu-api";
import {
  ContentObjectStore,
  PromateError,
  taskLayoutPaths,
  taskPaths,
  taskPathFromTemplate,
} from "@promax/promax-report";
import { readSpreadsheet } from "./feishu-sheets.ts";
import {
  listProjectFiles,
  readTaskArtifact,
  resolveProjectFile,
} from "./task-artifact.ts";
import {
  createRecycleBin,
  type DeleteTarget,
  type RecycleHost,
} from "./recycle-bin.ts";
import z from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import YAML from "yaml";
import { createApiProxy } from "../../promax-ui-console/src/host/api-proxy.ts";
import {
  parseDispatchPlan,
  type DispatchPlan,
  type DispatchPlanTeam,
} from "../../promax-ui-console/src/client/dispatch-planning.ts";

interface WorkspaceRecord {
  id: string;
  path: string;
  title: string;
  sessionIds: readonly string[];
}

interface WorkspaceRegistry {
  create(path: string, title?: string): Promise<WorkspaceRecord>;
  get?(workspaceId: string): WorkspaceRecord | undefined;
  delete?(workspaceId: string): Promise<boolean>;
}

interface WebServer {
  register(route: {
    kind: "prefix";
    path: string;
    handler: (
      request: IncomingMessage,
      response: ServerResponse,
    ) => void | Promise<void>;
  }): () => void;
}

interface SettingsScope<T> {
  get(): T;
  watch(listener: (next: T, previous: T) => void | Promise<void>): () => void;
  update(patch: Partial<T>): Promise<T>;
}

interface SettingsService {
  register<T>(
    ns: string,
    schema: unknown,
    options: { base: T; applies: "live" | "restart" },
  ): SettingsScope<T>;
}

interface CredentialsService {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
}

interface MappedToolRunContext {
  callId: string;
  rootCallId: string;
  token: symbol;
  agent?: unknown;
  signal: AbortSignal;
  deferContext(context: unknown): void;
  concludeTurn(): void;
}

interface MappedToolResult {
  isError: boolean;
  value?: unknown;
  content: readonly unknown[];
  error?: { message?: string };
  additionalContexts?: readonly unknown[];
  concludesTurn?: true;
}

interface MappedToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: Record<string, unknown>;
    render(
      args: unknown,
      value: unknown,
    ): Array<{ type: "text"; text: string }>;
  };
  execute(args: unknown, exec: MappedToolRunContext): Promise<unknown>;
}

interface ToolsService {
  schemas(): Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
  register(definition: MappedToolDefinition): () => void;
  get(name: string, scope?: unknown): MappedToolDefinition | undefined;
  execute(exec: {
    callId: string;
    rootCallId: string;
    parent: symbol;
    name: string;
    arguments: unknown;
    agent?: unknown;
    signal: AbortSignal;
  }): Promise<MappedToolResult>;
}

interface PluginFiber {
  dispose(): void | Promise<void>;
}

interface ChildAgentContext {
  agent: unknown;
  tools: ToolsService;
  systemPrompt: {
    assemble(input: {
      scope: unknown;
    }): Promise<{ sections: Array<{ name: string; text?: string }> }>;
  };
  effect(setup: () => void | (() => void), label?: string): void;
}

interface CreatedAgentPayload {
  agent: {
    session: { header: { origin?: string } };
    ctx: ChildAgentContext;
  };
}

interface LocalTelemetry {
  admit(sessionId: string, workspace: string): Promise<void>;
  observation(sessionId: string, attributes: Record<string, unknown>): string;
  traceId(sessionId: string): string;
}

interface HostContext extends Omit<RecycleHost, "workspaceRegistry"> {
  promaxAuth: RotatingTokenManager;
  llm: unknown;
  workspaceRegistry: WorkspaceRegistry;
  webServer: WebServer;
  settings: SettingsService;
  credentials: CredentialsService;
  tools: ToolsService;
  effect(setup: () => void | (() => void), label?: string): void;
  provide(name: string, service: unknown): void;
  on(
    event: "webserver/index-inject",
    listener: (table: Array<Record<string, unknown>>) => void,
  ): void;
  on(
    event: "credentials/reference-updated",
    listener: (ref: string) => void,
  ): void;
  on(event: "tools/change", listener: () => void): void;
  on(
    event: "tools/pre-execute",
    listener: (
      exec: DispatchToolExecution,
      next: () => Promise<unknown>,
    ) => Promise<unknown>,
  ): void;
  on(
    event: "agent/turn-stopping",
    listener: (payload: DispatchTurnStopping) => void | Promise<void>,
  ): void;
  on(
    event: "agent/created",
    listener: (payload: CreatedAgentPayload) => void,
  ): void;
  plugin(
    plugin: unknown,
    config: Record<string, unknown>,
  ): Promise<PluginFiber>;
  get?(name: "promaxTelemetry"): LocalTelemetry | undefined;
  get?(name: "promaxUploader"): TraceUploader | undefined;
  emit(event: "promax/decision", payload: Record<string, unknown>): void;
}

/** Captured once by the executing module; never re-read installation bytes at HTTP request time. */
export const BUNDLE_LOAD_IDENTITY = Object.freeze({ component: "promax-bundle", version: BUNDLE_VERSION, evaluated_at: new Date().toISOString(), ...(() => {
  try { return { module_sha256: createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex") }; }
  catch (error) { return { module_sha256: null, unknown_reason: error instanceof Error ? error.message : String(error) }; }
})() });
export const name = "promax-workspace-bootstrap";
export const inject = [
  "workspaceRegistry",
  "webServer",
  "settings",
  "credentials",
  "tools",
  "apiProxy",
  "sessionPersistence",
  "agents",
  "sessions",
  "llm",
  "promaxAuth",
];

export interface Config {
  /** STD-v0.1 Promax-only runtime health and context policy; unrelated sessions are untouched. */
  chainContext?: { enabled: boolean; toolConfigVersion?: string; capacity?: { provider: string; model: string; contextWindow: number; outputReserve: number; evidence: string } };
  apiBaseUrl: string;
  feishuMcpUrl?: string;
}

export type TaskRunCancellationState =
  | "running"
  | "stop_requested"
  | "draining"
  | "cancelled"
  | "completed"
  | "failed";
export type TaskRunJudgeState =
  | "absent"
  | "pass"
  | "fail"
  | "appealed"
  | "human_required"
  | "force_released"
  | "unverified";
export type TaskJudgeRepairState =
  | "repairing"
  | "judging"
  | "passed"
  | "exhausted";

export interface TaskJudgeRepairSnapshot {
  state: TaskJudgeRepairState;
  round: number;
  maxRounds: number;
  reasons: string[];
  updatedAt: string;
}

export interface TaskDeliverableFile {
  name: string;
  relativePath: string;
  path: string;
  bytes: number;
  modifiedAt: string;
}

export type TaskHistoryStatus = "running" | "completed" | "failed";

export interface TaskRunFileSnapshot {
  taskKey: string;
  parentSessionId: string;
  createdAt: string;
  cancellation: TaskRunCancellationState;
  runEpoch: number;
  manifestPath: string;
  inputManifestPath: string;
  confirmedMemberIds: string[];
  artifactStates: Array<{
    path: string;
    memberId: string;
    exists: boolean;
    nonEmpty: boolean;
  }>;
  deliverablePath: string;
  deliverableFiles: TaskDeliverableFile[];
  judge: {
    path: string;
    memberId: "quality_judge";
    state: TaskRunJudgeState;
    exists: boolean;
    nonEmpty: boolean;
    reason?: string;
  };
  repair?: TaskJudgeRepairSnapshot;
  observedAt: string;
}

export interface TaskHistoryItem {
  sessionId: string;
  taskKey: string;
  createdAt: string;
  status: TaskHistoryStatus;
  fileCount: number;
  deliverablePath: string;
  deliverableFiles: TaskDeliverableFile[];
  judge: TaskRunFileSnapshot["judge"];
  observedAt: string;
  error?: string;
}

interface DispatchToolExecution {
  callId?: string;
  name: string;
  arguments?: unknown;
  agent?: {
    session: {
      header: {
        id: string;
        origin?: string;
        cwd?: string;
        parentSession?: string;
      };
      events?: readonly DispatchSessionEvent[];
    };
  };
}

function isPathInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function shellCommandMayWrite(command: string): boolean {
  return (
    /(?:^|[\s;&|])(?:rm|mv|cp|install|mkdir|rmdir|touch|truncate|chmod|chown|chflags|ln|dd|patch|rsync|tar|unzip|ed|ex)\b/iu.test(
      command,
    ) ||
    /(?:^|[\s;&|])(?:sed|perl)\b[^\n;&|]*\s-i[^\s;&|]*(?:\s|$)/iu.test(
      command,
    ) ||
    /(?:^|[\s;&|])(?:python(?:3(?:\.\d+)?)?|ruby|node)\b/iu.test(command) ||
    /(?:^|[\s;&|])tee\b/iu.test(command) ||
    /(?:^|[^<])>{1,2}(?![>&])/u.test(command)
  );
}

/**
 * The frozen input tree is platform-owned after submission. This guard keeps
 * every agent tool on the read side of that boundary; platform internals write
 * the tree directly and therefore do not pass through the tool pipeline.
 */
function executionTask(
  exec: DispatchToolExecution,
): { cwd: string; taskKey: string } | undefined {
  const header = exec.agent?.session.header;
  if (!header?.cwd) return undefined;
  const sessionId = header.parentSession ?? header.id;
  try {
    const scope = JSON.parse(
      readFileSync(
        join(header.cwd, ".promax/session-scopes", `${sessionId}.json`),
        "utf8",
      ),
    ) as { taskKey: string };
    return { cwd: header.cwd, taskKey: taskKeyOf(scope.taskKey) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function frozenInputMutationReason(
  exec: DispatchToolExecution,
): string | undefined {
  const cwd = exec.agent?.session.header.cwd;
  if (!cwd) return undefined;
  const args =
    typeof exec.arguments === "object" && exec.arguments !== null
      ? (exec.arguments as Record<string, unknown>)
      : {};
  const paths = [
    "file_path",
    "path",
    "source",
    "destination",
    "target",
    "old_path",
    "new_path",
  ].flatMap((key) =>
    typeof args[key] === "string" ? [resolve(cwd, args[key])] : [],
  );
  const mutation =
    ["write", "edit", "delete", "move", "rename", "copy"].includes(exec.name) ||
    (exec.name === "str_replace_editor" && args.command !== "view");
  const scope = executionTask(exec);
  const layout = scope ? taskPaths(cwd, scope.taskKey) : undefined;
  const protectedRoots = [
    ".工作",
    ".promax/session-scopes",
    ".promax/input",
    ".promax/tasks",
    ".promax/judge",
    "deliverables",
    ".对象库",
    "产物",
  ].map((path) => resolve(cwd, path));
  if (
    paths.some(
      (path) => isPathInside(dirname(cwd), path) && !isPathInside(cwd, path),
    )
  )
    return "其他项目的文件不可访问";
  if (
    paths.some(
      (path) =>
        !isPathInside(cwd, path) &&
        /(?:^|\/)(?:产物|\.对象库|\.任务)(?:\/|$)/u.test(path),
    )
  )
    return "其他项目的产物、任务与对象库不可访问";
  if (mutation) {
    if (
      paths.some((path) =>
        protectedRoots.some((root) => isPathInside(root, path)),
      )
    )
      return "历史记录、冻结输入与内容对象只读；新产物只写本次任务包登记的产物快照路径";
    if (paths.some((path) => isPathInside(resolve(cwd, ".任务"), path))) {
      if (!scope || !layout?.modern) return "没有可写的新任务范围";
      const ended = (() => {
        try {
          return (
            JSON.parse(readFileSync(join(cwd, layout.control), "utf8")).spec
              .state !== "running"
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
          throw error;
        }
      })();
      if (ended) return "该任务已结束，只读归档；请新建任务修改产物";
      if (
        paths.some(
          (path) =>
            !isPathInside(resolve(cwd, layout.artifacts), path) &&
            path !== resolve(cwd, layout.judge) &&
            !(
              dirname(path) === resolve(cwd, layout.task) &&
              /^判定-r[0-9]+\.md$/u.test(basename(path))
            ),
        )
      )
        return "输入、任务包和产物基线由平台封存，Agent 只能写本次任务的产物快照与判定";
    }
  }
  if (exec.name === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    const workdir =
      typeof args.workdir === "string" ? resolve(cwd, args.workdir) : cwd;
    if (
      layout?.modern &&
      (!isPathInside(cwd, workdir) ||
        /(?:^|[\s/])\.\.(?:[\s/]|$)/u.test(command) ||
        command.replaceAll(cwd, "").includes(dirname(cwd)))
    )
      return "其他项目的文件不可访问";
    if (
      shellCommandMayWrite(command) &&
      (layout?.modern ||
        protectedRoots.some(
          (root) => command.includes(root) || isPathInside(root, workdir),
        ) ||
        /\.promax\/(?:input|tasks|judge)|deliverables|产物|\.对象库|\.任务|\.工作/u.test(
          command,
        ))
    )
      return "归档与对象内容只读；请通过文件工具写本次任务包登记的产物，不通过 shell 改写";
  }
  return undefined;
}

interface DispatchSessionEvent {
  type: string;
  data: unknown;
  seq?: number;
  time?: number;
}

interface DispatchAgent {
  session: {
    header: {
      id: string;
      origin?: string;
      cwd?: string;
      parentSession?: string;
    };
    events: readonly DispatchSessionEvent[];
  };
  steer(message: ReturnType<typeof createUserMessage>): void;
}

interface DispatchTurnStopping {
  agent: DispatchAgent;
  turn: number;
  signal: AbortSignal;
}

interface DispatchPlanControl {
  api_version: "promax.ai/v1alpha2";
  kind: "DispatchPlanControl";
  metadata: {
    session_id: string;
    plan_id: string;
    task_key: string;
    created_at: string;
  };
  spec: {
    state: "planning" | "confirmed";
    roster_member_ids: string[];
    confirmed_member_ids?: string[];
    confirmed_at?: string;
    team_revision?: unknown;
    model_plan?: GeneratedDispatchPlan;
  };
}

interface GeneratedDispatchPlan {
  plan: DispatchPlan;
  source_text: string;
  source_event_seq: number;
  source_message_sha256: string;
  generated_at: string;
}

const API_PROXY_PREFIX = "/promax-api";
const WORKSPACE_API_PREFIX = "/promax-workspace-api";

export const PROMAX_FEISHU_MCP_SETTINGS_NS = "promax-feishu-mcp";
export const PROMAX_CONNECTIONS_SETTINGS_NS = "promax-connections";
export const FEISHU_MCP_SERVER_NAME = "feishu";
export const FEISHU_MCP_PACKAGE = "@larksuiteoapi/lark-mcp";
export const FEISHU_MCP_TRANSPORT = "stdio";
export const FEISHU_MCP_CREDENTIAL_REFS = ["APP_ID", "APP_SECRET"] as const;

export type FeishuMcpConnectionState =
  | "disabled"
  | "credentials-required"
  | "connecting"
  | "connected"
  | "error";

export interface FeishuMcpSettings {
  enabled: boolean;
  probe: number;
  connection: {
    probe: number;
    state: FeishuMcpConnectionState;
    tools: string[];
    checkedAt: string;
    message: string;
  };
}

const EMPTY_FEISHU_CONNECTION: FeishuMcpSettings["connection"] = {
  probe: 0,
  state: "disabled",
  tools: [],
  checkedAt: "",
  message: "飞书 MCP 未启用",
};

const FeishuMcpSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  probe: z.number().step(1).min(0).default(0),
  connection: z
    .object({
      probe: z.number().step(1).min(0).default(0),
      state: z
        .union([
          z.const("disabled"),
          z.const("credentials-required"),
          z.const("connecting"),
          z.const("connected"),
          z.const("error"),
        ])
        .default("disabled"),
      tools: z.array(String).default([]),
      checkedAt: z.string().default(""),
      message: z.string().default("飞书 MCP 未启用"),
    })
    .default(EMPTY_FEISHU_CONNECTION),
});

export type CustomMcpTransport = "stdio" | "streamable-http";
export type CustomMcpConnectionState = FeishuMcpConnectionState;

export interface CustomMcpCredentialBinding {
  name: string;
  ref: string;
}

export interface CustomMcpConnectionSettings {
  serverName: string;
  displayName: string;
  transport: CustomMcpTransport;
  command: string;
  args: string[];
  url: string;
  env: CustomMcpCredentialBinding[];
  headers: CustomMcpCredentialBinding[];
  enabled: boolean;
  probe: number;
  connection: FeishuMcpSettings["connection"];
}

export interface CustomMcpSettings {
  entries: CustomMcpConnectionSettings[];
}

const CustomMcpCredentialBindingSchema = z.object({
  name: z.string().required(),
  ref: z.string().required(),
});

const CustomMcpConnectionSchema = z.object({
  serverName: z
    .string()
    .required()
    .pattern(/^[A-Za-z0-9_-]{1,32}$/u),
  displayName: z.string().required(),
  transport: z.union([z.const("stdio"), z.const("streamable-http")]),
  command: z.string().default(""),
  args: z.array(String).default([]),
  url: z.string().default(""),
  env: z.array(CustomMcpCredentialBindingSchema).default([]),
  headers: z.array(CustomMcpCredentialBindingSchema).default([]),
  enabled: z.boolean().default(true),
  probe: z.number().step(1).min(0).default(0),
  connection: z
    .object({
      probe: z.number().step(1).min(0).default(0),
      state: z
        .union([
          z.const("disabled"),
          z.const("credentials-required"),
          z.const("connecting"),
          z.const("connected"),
          z.const("error"),
        ])
        .default("disabled"),
      tools: z.array(String).default([]),
      checkedAt: z.string().default(""),
      message: z.string().default("MCP 未启用"),
    })
    .default({ ...EMPTY_FEISHU_CONNECTION, message: "MCP 未启用" }),
});

const CustomMcpSettingsSchema = z.object({
  entries: z.array(CustomMcpConnectionSchema).default([]),
});

type FeishuOpenClawToolName =
  | "feishu_bitable_app"
  | "feishu_bitable_app_table"
  | "feishu_bitable_app_table_field"
  | "feishu_bitable_app_table_record"
  | "feishu_docx_import"
  | "feishu_docx_raw_content"
  | "feishu_spreadsheet_sheet"
  | "feishu_spreadsheet_sheet_range_read";

export interface FeishuToolMapping {
  openClawTool: FeishuOpenClawToolName;
  skillIds: readonly string[];
  defaultAction?: string;
  actions: Readonly<Record<string, string>>;
  parameters: Record<string, unknown>;
  unsupportedReason?: string;
  transport?: "open-api";
}

const FEISHU_STRING_PROPERTY = { type: "string" } as const;
const FEISHU_BOOLEAN_PROPERTY = { type: "boolean" } as const;
const FEISHU_NUMBER_PROPERTY = { type: "number" } as const;
const FEISHU_JSON_OBJECT_PROPERTY = {
  type: "object",
  additionalProperties: true,
} as const;
const FEISHU_JSON_ARRAY_PROPERTY = { type: "array", items: {} } as const;

function feishuAliasParameters(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: false,
  };
}

/**
 * OpenClaw aliases route to the observed lark-mcp tools or the two read-only Sheets APIs. Targets are the exact public names
 * registered by dsh-mcp-client for @larksuiteoapi/lark-mcp 0.5.1. An empty
 * action table is intentional evidence that the current MCP has no equivalent;
 * those aliases remain callable only so they can fail with an actionable error.
 */
export const FEISHU_TOOL_MAPPINGS: readonly FeishuToolMapping[] = [
  {
    openClawTool: "feishu_bitable_app",
    skillIds: ["feishu-requirement-entry"],
    actions: { create: "mcp__feishu__bitable_v1_app_create" },
    parameters: feishuAliasParameters(
      {
        action: { type: "string", enum: ["create"] },
        name: FEISHU_STRING_PROPERTY,
        folder_token: FEISHU_STRING_PROPERTY,
        time_zone: FEISHU_STRING_PROPERTY,
        useUAT: FEISHU_BOOLEAN_PROPERTY,
      },
      ["action", "name"],
    ),
  },
  {
    openClawTool: "feishu_bitable_app_table",
    skillIds: ["feishu-requirement-board"],
    defaultAction: "list",
    actions: {
      list: "mcp__feishu__bitable_v1_appTable_list",
      create: "mcp__feishu__bitable_v1_appTable_create",
    },
    parameters: feishuAliasParameters(
      {
        action: { type: "string", enum: ["list", "create"] },
        app_token: FEISHU_STRING_PROPERTY,
        name: FEISHU_STRING_PROPERTY,
        default_view_name: FEISHU_STRING_PROPERTY,
        fields: { type: "array", items: FEISHU_JSON_OBJECT_PROPERTY },
        page_token: FEISHU_STRING_PROPERTY,
        page_size: FEISHU_NUMBER_PROPERTY,
        useUAT: FEISHU_BOOLEAN_PROPERTY,
      },
      ["app_token"],
    ),
  },
  {
    openClawTool: "feishu_bitable_app_table_field",
    skillIds: [
      "feishu-requirement-entry",
      "feishu-requirement-board",
      "feishu-requirement-archive",
    ],
    defaultAction: "list",
    actions: { list: "mcp__feishu__bitable_v1_appTableField_list" },
    parameters: feishuAliasParameters(
      {
        action: { type: "string", enum: ["list"] },
        app_token: FEISHU_STRING_PROPERTY,
        table_id: FEISHU_STRING_PROPERTY,
        view_id: FEISHU_STRING_PROPERTY,
        text_field_as_array: FEISHU_BOOLEAN_PROPERTY,
        page_token: FEISHU_STRING_PROPERTY,
        page_size: FEISHU_NUMBER_PROPERTY,
        useUAT: FEISHU_BOOLEAN_PROPERTY,
      },
      ["app_token", "table_id"],
    ),
  },
  {
    openClawTool: "feishu_bitable_app_table_record",
    skillIds: [
      "feishu-requirement-entry",
      "feishu-requirement-board",
      "feishu-requirement-archive",
    ],
    defaultAction: "list",
    actions: {
      create: "mcp__feishu__bitable_v1_appTableRecord_create",
      list: "mcp__feishu__bitable_v1_appTableRecord_search",
      search: "mcp__feishu__bitable_v1_appTableRecord_search",
    },
    parameters: feishuAliasParameters(
      {
        action: { type: "string", enum: ["create", "list", "search"] },
        app_token: FEISHU_STRING_PROPERTY,
        table_id: FEISHU_STRING_PROPERTY,
        fields: FEISHU_JSON_OBJECT_PROPERTY,
        view_id: FEISHU_STRING_PROPERTY,
        field_names: { type: "array", items: { type: "string" } },
        sort: FEISHU_JSON_ARRAY_PROPERTY,
        filter: FEISHU_JSON_OBJECT_PROPERTY,
        automatic_fields: FEISHU_BOOLEAN_PROPERTY,
        user_id_type: {
          type: "string",
          enum: ["open_id", "union_id", "user_id"],
        },
        client_token: FEISHU_STRING_PROPERTY,
        ignore_consistency_check: FEISHU_BOOLEAN_PROPERTY,
        page_token: FEISHU_STRING_PROPERTY,
        page_size: FEISHU_NUMBER_PROPERTY,
        useUAT: FEISHU_BOOLEAN_PROPERTY,
      },
      ["app_token", "table_id"],
    ),
  },
  {
    openClawTool: "feishu_spreadsheet_sheet",
    skillIds: ["pm-weekly-monitor"],
    defaultAction: "list",
    transport: "open-api",
    actions: {
      list: "GET /sheets/v3/spreadsheets/{spreadsheet_token}/sheets/query",
    },
    parameters: feishuAliasParameters(
      {
        action: { type: "string", enum: ["list"] },
        spreadsheet_token: FEISHU_STRING_PROPERTY,
      },
      ["spreadsheet_token"],
    ),
  },
  {
    openClawTool: "feishu_docx_import",
    skillIds: [
      "feishu-requirement-entry",
      "feishu-requirement-board",
      "feishu-requirement-archive",
    ],
    defaultAction: "create",
    actions: { create: "mcp__feishu__docx_builtin_import" },
    parameters: feishuAliasParameters(
      {
        action: { type: "string", enum: ["create"] },
        markdown: FEISHU_STRING_PROPERTY,
        file_name: FEISHU_STRING_PROPERTY,
        useUAT: FEISHU_BOOLEAN_PROPERTY,
      },
      ["markdown"],
    ),
  },
  {
    openClawTool: "feishu_docx_raw_content",
    skillIds: [
      "feishu-requirement-entry",
      "feishu-requirement-board",
      "feishu-requirement-archive",
    ],
    defaultAction: "read",
    actions: { read: "mcp__feishu__docx_v1_document_rawContent" },
    parameters: feishuAliasParameters(
      {
        action: { type: "string", enum: ["read"] },
        document_id: FEISHU_STRING_PROPERTY,
        lang: FEISHU_NUMBER_PROPERTY,
        useUAT: FEISHU_BOOLEAN_PROPERTY,
      },
      ["document_id"],
    ),
  },
  {
    openClawTool: "feishu_spreadsheet_sheet_range_read",
    skillIds: ["pm-weekly-monitor"],
    defaultAction: "read",
    transport: "open-api",
    actions: {
      read: "GET /sheets/v2/spreadsheets/{spreadsheet_token}/values/{sheet_id}!{range}",
    },
    parameters: feishuAliasParameters(
      {
        spreadsheet_token: FEISHU_STRING_PROPERTY,
        sheet_id: FEISHU_STRING_PROPERTY,
        range: FEISHU_STRING_PROPERTY,
      },
      ["spreadsheet_token", "sheet_id", "range"],
    ),
  },
] as const;

const FEISHU_IDENTITY_FALLBACK_NOTICE =
  "Promax 未移植 OpenClaw 的 session_status、Relationships.md 与 wecom-cli 身份链路；身份不可得时继续执行并记为匿名 / unknown，不得伪造姓名，不得因此中止业务操作。";

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label}必须是对象`);
  return value as Record<string, unknown>;
}

function requiredFeishuString(
  args: Record<string, unknown>,
  name: string,
): string {
  const value = typeof args[name] === "string" ? args[name].trim() : "";
  if (value === "") throw new Error(`飞书工具参数 ${name} 不能为空`);
  return value;
}

function copyDefined(
  source: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  );
}

function convertedFeishuArguments(
  mapping: FeishuToolMapping,
  action: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const appToken = (): string => requiredFeishuString(args, "app_token");
  const tableId = (): string => requiredFeishuString(args, "table_id");
  const useUAT = args.useUAT === undefined ? {} : { useUAT: args.useUAT };
  switch (mapping.openClawTool) {
    case "feishu_bitable_app":
      return {
        data: {
          name: requiredFeishuString(args, "name"),
          ...copyDefined(args, ["folder_token", "time_zone"]),
        },
        ...useUAT,
      };
    case "feishu_bitable_app_table":
      if (action === "create") {
        if (
          args.fields !== undefined &&
          (!Array.isArray(args.fields) ||
            args.fields.some((field) => {
              const row = recordValue(field, "飞书字段");
              return (
                typeof row.field_name !== "string" ||
                row.field_name.trim() === "" ||
                !Number.isInteger(row.type)
              );
            }))
        )
          throw new Error("飞书建表 fields 必须包含有效的字段名和数字类型");
        return {
          path: { app_token: appToken() },
          data: {
            table: {
              name: requiredFeishuString(args, "name"),
              ...copyDefined(args, ["default_view_name", "fields"]),
            },
          },
          ...useUAT,
        };
      }
      return {
        path: { app_token: appToken() },
        ...(Object.keys(copyDefined(args, ["page_token", "page_size"]))
          .length === 0
          ? {}
          : { params: copyDefined(args, ["page_token", "page_size"]) }),
        ...useUAT,
      };
    case "feishu_bitable_app_table_field":
      return {
        path: { app_token: appToken(), table_id: tableId() },
        ...(Object.keys(
          copyDefined(args, [
            "view_id",
            "text_field_as_array",
            "page_token",
            "page_size",
          ]),
        ).length === 0
          ? {}
          : {
              params: copyDefined(args, [
                "view_id",
                "text_field_as_array",
                "page_token",
                "page_size",
              ]),
            }),
        ...useUAT,
      };
    case "feishu_bitable_app_table_record":
      if (action === "create") {
        return {
          data: { fields: recordValue(args.fields, "飞书记录 fields") },
          path: { app_token: appToken(), table_id: tableId() },
          ...(Object.keys(
            copyDefined(args, [
              "user_id_type",
              "client_token",
              "ignore_consistency_check",
            ]),
          ).length === 0
            ? {}
            : {
                params: copyDefined(args, [
                  "user_id_type",
                  "client_token",
                  "ignore_consistency_check",
                ]),
              }),
          ...useUAT,
        };
      }
      return {
        path: { app_token: appToken(), table_id: tableId() },
        ...(Object.keys(
          copyDefined(args, [
            "view_id",
            "field_names",
            "sort",
            "filter",
            "automatic_fields",
          ]),
        ).length === 0
          ? {}
          : {
              data: copyDefined(args, [
                "view_id",
                "field_names",
                "sort",
                "filter",
                "automatic_fields",
              ]),
            }),
        ...(Object.keys(
          copyDefined(args, ["user_id_type", "page_token", "page_size"]),
        ).length === 0
          ? {}
          : {
              params: copyDefined(args, [
                "user_id_type",
                "page_token",
                "page_size",
              ]),
            }),
        ...useUAT,
      };
    case "feishu_docx_import":
      return {
        data: {
          markdown: requiredFeishuString(args, "markdown"),
          ...copyDefined(args, ["file_name"]),
        },
        ...useUAT,
      };
    case "feishu_docx_raw_content":
      return {
        path: { document_id: requiredFeishuString(args, "document_id") },
        ...(args.lang === undefined ? {} : { params: { lang: args.lang } }),
        ...useUAT,
      };
    case "feishu_spreadsheet_sheet":
    case "feishu_spreadsheet_sheet_range_read":
      throw new Error("电子表格读取应通过开放平台只读适配器执行");
    default:
      throw new Error(`未知飞书映射工具：${String(mapping.openClawTool)}`);
  }
}

function mappedFeishuText(value: unknown): string {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const content = (value as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .flatMap((block) =>
          typeof block === "object" &&
          block !== null &&
          !Array.isArray(block) &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
            ? [(block as { text: string }).text]
            : [],
        )
        .join("\n");
      if (text !== "") return text;
    }
  }
  try {
    return JSON.stringify(value, null, 2) ?? "飞书工具已执行，但没有文本结果";
  } catch {
    return "飞书工具已执行，但结果无法序列化为文本";
  }
}

function mappedFeishuError(result: MappedToolResult): string {
  const direct = result.error?.message?.trim();
  if (direct) return direct;
  const content = result.content
    .flatMap((block) =>
      typeof block === "object" &&
      block !== null &&
      !Array.isArray(block) &&
      typeof (block as { text?: unknown }).text === "string"
        ? [(block as { text: string }).text]
        : [],
    )
    .join("\n")
    .trim();
  return content || "飞书 MCP 返回了未说明原因的失败";
}

function mappingSkillLabel(mapping: FeishuToolMapping): string {
  return mapping.skillIds.map((skillId) => `Skill ${skillId}`).join("、");
}

async function assertFeishuCredentials(ctx: HostContext): Promise<void> {
  let credentials: Array<Awaited<ReturnType<CredentialsService["resolve"]>>>;
  try {
    credentials = await Promise.all(
      FEISHU_MCP_CREDENTIAL_REFS.map((ref) => ctx.credentials.resolve(ref)),
    );
  } catch {
    throw new Error(
      "飞书凭据状态读取失败；请到“设置 → 连接”展开飞书条目，重新填写 APP_ID 与 APP_SECRET 后重试。凭据只写入，不会在页面回填。",
    );
  }
  if (credentials.some((value) => value === undefined)) {
    throw new Error(
      "飞书凭据未配置：请到“设置 → 连接”展开飞书条目，填写 APP_ID 与 APP_SECRET 后重试。凭据只写入，不会在页面回填。",
    );
  }
}

function feishuMappingDefinition(
  ctx: HostContext,
  scope: SettingsScope<FeishuMcpSettings>,
  mapping: FeishuToolMapping,
  api: FeishuApi,
): MappedToolDefinition {
  return {
    name: mapping.openClawTool,
    description: `${mappingSkillLabel(mapping)} 使用的 OpenClaw 兼容入口。${FEISHU_IDENTITY_FALLBACK_NOTICE}`,
    parameters: mapping.parameters,
    output: {
      schema: {},
      render: (_args, value) => [
        { type: "text", text: mappedFeishuText(value) },
      ],
    },
    async execute(value, exec) {
      const args = recordValue(value, `工具 ${mapping.openClawTool} 的参数`);
      await assertFeishuCredentials(ctx);
      const actionValue =
        typeof args.action === "string" ? args.action.trim() : "";
      const action = actionValue || mapping.defaultAction;
      if (action === undefined)
        throw new Error(
          `${mappingSkillLabel(mapping)} 调用 ${mapping.openClawTool} 时必须提供 action`,
        );
      const targetName = mapping.actions[action];
      if (targetName === undefined) {
        if (mapping.transport === "open-api")
          throw new Error(
            "电子表格仅支持列出工作表和读取区域，不支持写入或其他操作。",
          );
        throw new Error(
          `${mappingSkillLabel(mapping)} 需要工具 ${mapping.openClawTool}${action === "" ? "" : `（action=${action}）`}；${mapping.unsupportedReason ?? `当前 MCP 没有与该 action 对应的工具`}，未创建伪映射。`,
        );
      }
      if (!scope.get().enabled)
        throw new Error(
          "飞书连接未启用：请到“设置 → 连接”启用飞书条目后重试。",
        );
      if (
        mapping.openClawTool === "feishu_spreadsheet_sheet" ||
        mapping.openClawTool === "feishu_spreadsheet_sheet_range_read"
      ) {
        return readSpreadsheet(api, mapping.openClawTool, args, exec.signal);
      }
      if (ctx.tools.get(targetName) === undefined) {
        throw new Error(
          `${mappingSkillLabel(mapping)} 需要工具 ${mapping.openClawTool}，映射目标 ${targetName} 当前未注册；请到“设置 → 连接”对飞书条目运行连接测试并检查权限。`,
        );
      }
      const converted = convertedFeishuArguments(mapping, action, args);
      const result = await ctx.tools.execute({
        callId: `${exec.callId}:feishu-map:${randomUUID()}`,
        rootCallId: exec.rootCallId,
        parent: exec.token,
        name: targetName,
        arguments: converted,
        signal: exec.signal,
      });
      if (result.isError || result.value === undefined) {
        throw new Error(
          `飞书工具调用失败（${mapping.openClawTool} → ${targetName}）：${mappedFeishuError(result)}`,
        );
      }
      for (const context of result.additionalContexts ?? [])
        exec.deferContext(context);
      if (result.concludesTurn) exec.concludeTurn();
      return result.value;
    },
  };
}

function installFeishuToolMappings(
  ctx: HostContext,
  scope: SettingsScope<FeishuMcpSettings>,
): () => void {
  const api = new FeishuApi(ctx.credentials, 30_000, fetch);
  const disposers: Array<() => void> = [];
  try {
    for (const mapping of FEISHU_TOOL_MAPPINGS)
      disposers.push(
        ctx.tools.register(feishuMappingDefinition(ctx, scope, mapping, api)),
      );
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

const PROMAX_MEMBER_ID_RE =
  /(?:^|\n)PROMAX_MEMBER_ID:([a-z][a-z0-9_]{2,47})(?:\n|$)/g;

async function childPromaxMemberId(
  childCtx: ChildAgentContext,
): Promise<string> {
  const assembly = await childCtx.systemPrompt.assemble({
    scope: childCtx.agent,
  });
  const persona =
    assembly.sections.find((section) => section.name === "deployment:persona")
      ?.text ?? "";
  const matches = [...persona.matchAll(PROMAX_MEMBER_ID_RE)];
  if (matches.length !== 1)
    throw new Error("飞书映射工具无法唯一识别 member_id");
  return matches[0]![1]!;
}

function registerFeishuToolMappingsForChild(
  ctx: HostContext,
  scope: SettingsScope<FeishuMcpSettings>,
  childCtx: ChildAgentContext,
): () => void {
  const api = new FeishuApi(ctx.credentials, 30_000, fetch);
  const disposers: Array<() => void> = [];
  try {
    for (const mapping of FEISHU_TOOL_MAPPINGS) {
      const rootDefinition = feishuMappingDefinition(ctx, scope, mapping, api);
      disposers.push(
        childCtx.tools.register({
          ...rootDefinition,
          async execute(args, exec) {
            if (
              (await childPromaxMemberId(childCtx)) !== "requirement_management"
            ) {
              throw new Error(
                `${mapping.openClawTool} 仅允许 requirement_management`,
              );
            }
            return rootDefinition.execute(args, exec);
          },
        }),
      );
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose();
  };
}

function installFeishuToolMappingsInChildren(
  ctx: HostContext,
  scope: SettingsScope<FeishuMcpSettings>,
): void {
  const installed = new WeakSet<object>();
  ctx.on("agent/created", ({ agent }) => {
    if (agent.session.header.origin !== "subagent" || installed.has(agent.ctx))
      return;
    installed.add(agent.ctx);
    agent.ctx.effect(() => {
      try {
        const dispose = registerFeishuToolMappingsForChild(
          ctx,
          scope,
          agent.ctx,
        );
        return () => {
          dispose();
          installed.delete(agent.ctx);
        };
      } catch (error) {
        installed.delete(agent.ctx);
        throw error;
      }
    }, "promax-feishu-mappings.one-shot-child");
  });
}

function mcpToolNames(tools: ToolsService, serverName: string): string[] {
  return tools
    .schemas()
    .map((schema) => schema.name)
    .filter((toolName) => toolName.startsWith(`mcp__${serverName}__`))
    .sort((left, right) => left.localeCompare(right));
}

function feishuToolNames(tools: ToolsService): string[] {
  return mcpToolNames(tools, FEISHU_MCP_SERVER_NAME);
}

async function waitForFeishuTools(
  tools: ToolsService,
  isStopped: () => boolean,
): Promise<string[]> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const current = feishuToolNames(tools);
    if (current.length > 0 || isStopped()) return current;
    await new Promise<void>((resolveTimer) => {
      setTimeout(resolveTimer, 250);
    });
  }
  return [];
}

/**
 * Owns the built-in Feishu connection without creating a Promax-specific
 * HTTP/RPC contract. The settings page writes only the generic settings and
 * credentials seams; secret values are resolved only for the child process
 * operation and are never copied into settings, tool status, or diagnostics.
 */
export function installFeishuMcpRuntime(ctx: HostContext): void {
  const initial: FeishuMcpSettings = {
    enabled: false,
    probe: 0,
    connection: { ...EMPTY_FEISHU_CONNECTION },
  };
  const scope = ctx.settings.register<FeishuMcpSettings>(
    PROMAX_FEISHU_MCP_SETTINGS_NS,
    FeishuMcpSettingsSchema,
    { base: initial, applies: "live" },
  );
  const disposeMappings = installFeishuToolMappings(ctx, scope);
  installFeishuToolMappingsInChildren(ctx, scope);
  let activeFiber: PluginFiber | undefined;
  let stopped = false;
  let queue = Promise.resolve();

  const publish = async (
    connection: FeishuMcpSettings["connection"],
  ): Promise<void> => {
    if (stopped) return;
    await scope.update({ connection });
  };

  const disposeActive = async (): Promise<void> => {
    const fiber = activeFiber;
    activeFiber = undefined;
    if (fiber !== undefined) await fiber.dispose();
  };

  const reconcile = async (): Promise<void> => {
    const settings = scope.get();
    if (!settings.enabled) {
      await disposeActive();
      const current = settings.connection;
      if (
        current.probe === settings.probe &&
        current.state === EMPTY_FEISHU_CONNECTION.state &&
        current.tools.length === 0 &&
        current.checkedAt === EMPTY_FEISHU_CONNECTION.checkedAt &&
        current.message === EMPTY_FEISHU_CONNECTION.message
      )
        return;
      await publish({ ...EMPTY_FEISHU_CONNECTION, probe: settings.probe });
      return;
    }

    let appId: Awaited<ReturnType<CredentialsService["resolve"]>>;
    let appSecret: Awaited<ReturnType<CredentialsService["resolve"]>>;
    try {
      [appId, appSecret] = await Promise.all(
        FEISHU_MCP_CREDENTIAL_REFS.map((ref) => ctx.credentials.resolve(ref)),
      );
    } catch {
      await disposeActive();
      await publish({
        probe: settings.probe,
        state: "error",
        tools: [],
        checkedAt: new Date().toISOString(),
        message:
          "飞书 MCP 凭据状态读取失败；未记录错误正文，避免凭据进入日志或设置",
      });
      return;
    }
    if (appId === undefined || appSecret === undefined) {
      await disposeActive();
      await publish({
        probe: settings.probe,
        state: "credentials-required",
        tools: [],
        checkedAt: new Date().toISOString(),
        message: "请先配置 APP_ID 与 APP_SECRET",
      });
      return;
    }

    await disposeActive();
    await publish({
      probe: settings.probe,
      state: "connecting",
      tools: [],
      checkedAt: new Date().toISOString(),
      message: "正在连接飞书 MCP",
    });
    try {
      const McpClient = await import("@deepseek-ai/dsh-mcp-client");
      activeFiber = await ctx.plugin(McpClient, {
        serverName: FEISHU_MCP_SERVER_NAME,
        transport: FEISHU_MCP_TRANSPORT,
        command: "npx",
        args: ["-y", FEISHU_MCP_PACKAGE, "mcp"],
        env: { APP_ID: appId.value, APP_SECRET: appSecret.value },
        cwd: "",
        toolCallTimeoutMs: 60_000,
        failOnStartupError: false,
      });
      const tools = await waitForFeishuTools(ctx.tools, () => stopped);
      await publish({
        probe: settings.probe,
        state: tools.length > 0 ? "connected" : "error",
        tools,
        checkedAt: new Date().toISOString(),
        message:
          tools.length > 0
            ? `已注册 ${String(tools.length)} 个飞书工具`
            : "未发现飞书 MCP 工具，请检查专用测试凭据与网络",
      });
    } catch {
      await disposeActive();
      await publish({
        probe: settings.probe,
        state: "error",
        tools: [],
        checkedAt: new Date().toISOString(),
        message:
          "飞书 MCP 连接失败；未记录服务端错误正文，避免凭据进入日志或设置",
      });
    }
  };

  const refreshToolSnapshot = async (): Promise<void> => {
    if (activeFiber === undefined || !scope.get().enabled) return;
    const tools = feishuToolNames(ctx.tools);
    if (tools.length === 0 && scope.get().connection.state === "connecting")
      return;
    await publish({
      probe: scope.get().probe,
      state: tools.length > 0 ? "connected" : "error",
      tools,
      checkedAt: new Date().toISOString(),
      message:
        tools.length > 0
          ? `已注册 ${String(tools.length)} 个飞书工具`
          : "飞书 MCP 当前没有已注册工具",
    });
  };

  const schedule = (operation: () => Promise<void>): void => {
    queue = queue.then(operation, operation).then(
      () => undefined,
      () => undefined,
    );
  };

  scope.watch((next, previous) => {
    if (next.enabled !== previous.enabled || next.probe !== previous.probe)
      schedule(reconcile);
  });
  ctx.on("credentials/reference-updated", (ref) => {
    if (FEISHU_MCP_CREDENTIAL_REFS.some((expected) => expected === ref))
      schedule(reconcile);
  });
  ctx.on("tools/change", () => {
    schedule(refreshToolSnapshot);
  });
  schedule(reconcile);
  ctx.effect(
    () => async () => {
      stopped = true;
      await queue;
      await disposeActive();
      disposeMappings();
    },
    "promax-feishu-mcp-runtime",
  );
}

function customMcpRuntimeKey(entry: CustomMcpConnectionSettings): string {
  return JSON.stringify({
    serverName: entry.serverName,
    displayName: entry.displayName,
    transport: entry.transport,
    command: entry.command,
    args: entry.args,
    url: entry.url,
    env: entry.env,
    headers: entry.headers,
    enabled: entry.enabled,
    probe: entry.probe,
  });
}

function customMcpSettingsKey(settings: CustomMcpSettings): string {
  return JSON.stringify(
    settings.entries.map((entry) => customMcpRuntimeKey(entry)),
  );
}

function customConnectionState(
  entry: CustomMcpConnectionSettings,
  state: CustomMcpConnectionState,
  message: string,
  tools: string[] = [],
): CustomMcpConnectionSettings["connection"] {
  return {
    probe: entry.probe,
    state,
    tools,
    checkedAt: new Date().toISOString(),
    message,
  };
}

/**
 * Owns user-created MCP entries from the generic connection namespace. Secret
 * values are resolved only while constructing one live plugin instance; the
 * settings document stores credential references and key names, never values.
 */
export function installCustomMcpRuntime(ctx: HostContext): void {
  const scope = ctx.settings.register<CustomMcpSettings>(
    PROMAX_CONNECTIONS_SETTINGS_NS,
    CustomMcpSettingsSchema,
    { base: { entries: [] }, applies: "live" },
  );
  const active = new Map<string, { fiber: PluginFiber; key: string }>();
  let stopped = false;
  let queue = Promise.resolve();

  const schedule = (operation: () => Promise<void>): void => {
    queue = queue.then(operation, operation).then(
      () => undefined,
      () => undefined,
    );
  };

  const publish = async (
    serverName: string,
    connection: CustomMcpConnectionSettings["connection"],
  ): Promise<void> => {
    if (stopped) return;
    const current = scope.get();
    const index = current.entries.findIndex(
      (entry) => entry.serverName === serverName,
    );
    if (
      index < 0 ||
      JSON.stringify(current.entries[index]?.connection) ===
        JSON.stringify(connection)
    )
      return;
    const entries = current.entries.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, connection } : entry,
    );
    await scope.update({ entries });
  };

  const dispose = async (serverName: string): Promise<void> => {
    const running = active.get(serverName);
    active.delete(serverName);
    if (running !== undefined) await running.fiber.dispose();
  };

  const credentialValues = async (
    bindings: readonly CustomMcpCredentialBinding[],
  ): Promise<{ values?: Record<string, string>; missing: string[] }> => {
    const resolved = await Promise.all(
      bindings.map(async (binding) => ({
        binding,
        credential: await ctx.credentials.resolve(binding.ref),
      })),
    );
    return {
      ...(resolved.every((item) => item.credential !== undefined)
        ? {
            values: Object.fromEntries(
              resolved.map((item) => [
                item.binding.name,
                item.credential!.value,
              ]),
            ),
          }
        : {}),
      missing: resolved.flatMap((item) =>
        item.credential === undefined ? [item.binding.name] : [],
      ),
    };
  };

  const reconcileEntry = async (
    candidate: CustomMcpConnectionSettings,
  ): Promise<void> => {
    const entry = scope
      .get()
      .entries.find((item) => item.serverName === candidate.serverName);
    if (entry === undefined) return;
    const key = customMcpRuntimeKey(entry);
    const running = active.get(entry.serverName);
    if (running !== undefined && running.key !== key)
      await dispose(entry.serverName);
    if (!entry.enabled) {
      await dispose(entry.serverName);
      await publish(
        entry.serverName,
        customConnectionState(entry, "disabled", "MCP 未启用"),
      );
      return;
    }
    if (
      entry.serverName === FEISHU_MCP_SERVER_NAME ||
      entry.serverName === "promax_feishu"
    ) {
      await dispose(entry.serverName);
      await publish(
        entry.serverName,
        customConnectionState(
          entry,
          "error",
          `serverName “${entry.serverName}” 已被飞书连接占用，请为个人租户使用独立命名空间`,
        ),
      );
      return;
    }
    if (active.get(entry.serverName)?.key === key) {
      const tools = mcpToolNames(ctx.tools, entry.serverName);
      await publish(
        entry.serverName,
        customConnectionState(
          entry,
          tools.length > 0 ? "connected" : "error",
          tools.length > 0
            ? `已注册 ${String(tools.length)} 个 MCP 工具`
            : "MCP 当前没有已注册工具",
          tools,
        ),
      );
      return;
    }
    if (entry.transport === "stdio" && entry.command.trim() === "") {
      await publish(
        entry.serverName,
        customConnectionState(entry, "error", "stdio 连接缺少 command"),
      );
      return;
    }
    if (entry.transport === "streamable-http") {
      try {
        const parsed = new URL(entry.url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
          throw new Error("protocol");
      } catch {
        await publish(
          entry.serverName,
          customConnectionState(
            entry,
            "error",
            "streamable-http 连接需要有效的 http(s) URL",
          ),
        );
        return;
      }
    }
    let environment: Awaited<ReturnType<typeof credentialValues>>;
    let headers: Awaited<ReturnType<typeof credentialValues>>;
    try {
      [environment, headers] = await Promise.all([
        credentialValues(entry.env),
        credentialValues(entry.headers),
      ]);
    } catch {
      await publish(
        entry.serverName,
        customConnectionState(
          entry,
          "error",
          "MCP 凭据状态读取失败；未记录错误正文，避免凭据进入日志或设置",
        ),
      );
      return;
    }
    const missing = [...environment.missing, ...headers.missing];
    if (missing.length > 0) {
      await publish(
        entry.serverName,
        customConnectionState(
          entry,
          "credentials-required",
          `请配置只写凭据：${missing.join("、")}`,
        ),
      );
      return;
    }
    await publish(
      entry.serverName,
      customConnectionState(entry, "connecting", "正在连接 MCP server"),
    );
    try {
      const McpClient = await import("@deepseek-ai/dsh-mcp-client");
      const config =
        entry.transport === "stdio"
          ? {
              serverName: entry.serverName,
              transport: "stdio",
              command: entry.command,
              args: entry.args,
              env: environment.values ?? {},
              cwd: "",
              toolCallTimeoutMs: 60_000,
              failOnStartupError: false,
            }
          : {
              serverName: entry.serverName,
              transport: "streamable-http",
              url: entry.url,
              headers: headers.values ?? {},
              toolCallTimeoutMs: 60_000,
              failOnStartupError: false,
            };
      const fiber = await ctx.plugin(McpClient, config);
      active.set(entry.serverName, { fiber, key });
      let tools: string[] = [];
      for (let attempt = 0; attempt < 60; attempt += 1) {
        tools = mcpToolNames(ctx.tools, entry.serverName);
        if (tools.length > 0 || stopped) break;
        await new Promise<void>((resolveTimer) => {
          setTimeout(resolveTimer, 250);
        });
      }
      await publish(
        entry.serverName,
        customConnectionState(
          entry,
          tools.length > 0 ? "connected" : "error",
          tools.length > 0
            ? `已注册 ${String(tools.length)} 个 MCP 工具`
            : "未发现 MCP 工具，请检查配置与网络",
          tools,
        ),
      );
    } catch {
      await dispose(entry.serverName);
      await publish(
        entry.serverName,
        customConnectionState(
          entry,
          "error",
          "MCP 连接失败；未记录服务端错误正文，避免凭据进入日志或设置",
        ),
      );
    }
  };

  const reconcile = async (): Promise<void> => {
    const entries = scope.get().entries;
    const wanted = new Set(entries.map((entry) => entry.serverName));
    for (const serverName of [...active.keys()])
      if (!wanted.has(serverName)) await dispose(serverName);
    for (const entry of entries) await reconcileEntry(entry);
  };

  const refreshToolSnapshots = async (): Promise<void> => {
    for (const entry of scope.get().entries) {
      if (!entry.enabled || !active.has(entry.serverName)) continue;
      const tools = mcpToolNames(ctx.tools, entry.serverName);
      if (tools.length === 0 && entry.connection.state === "connecting")
        continue;
      await publish(
        entry.serverName,
        customConnectionState(
          entry,
          tools.length > 0 ? "connected" : "error",
          tools.length > 0
            ? `已注册 ${String(tools.length)} 个 MCP 工具`
            : "MCP 当前没有已注册工具",
          tools,
        ),
      );
    }
  };

  scope.watch((next, previous) => {
    if (customMcpSettingsKey(next) !== customMcpSettingsKey(previous))
      schedule(reconcile);
  });
  ctx.on("credentials/reference-updated", (ref) => {
    const affected = scope
      .get()
      .entries.filter((entry) =>
        [...entry.env, ...entry.headers].some((binding) => binding.ref === ref),
      )
      .map((entry) => entry.serverName);
    if (affected.length > 0)
      schedule(async () => {
        for (const serverName of affected) await dispose(serverName);
        await reconcile();
      });
  });
  ctx.on("tools/change", () => {
    schedule(refreshToolSnapshots);
  });
  schedule(reconcile);
  ctx.effect(
    () => async () => {
      stopped = true;
      await queue;
      for (const serverName of [...active.keys()]) await dispose(serverName);
    },
    "promax-custom-mcp-runtime",
  );
}

async function readJson(
  request: IncomingMessage,
  maximumBytes = 1024 * 1024,
  overflowMessage = "请求体过大",
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new Error(overflowMessage);
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("请求体不是有效的 JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("请求体必须是 JSON 对象");
  return value as Record<string, unknown>;
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.byteLength,
    "cache-control": "no-store",
  });
  response.end(body);
}

function projectNameOf(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (
    name === "" ||
    name.length > 80 ||
    name.startsWith(".") ||
    /[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(name) ||
    /[. ]$/u.test(name)
  ) {
    throw new Error("项目组名称格式无效");
  }
  return name;
}

const SESSION_SCOPE_MAX_LENGTH = 40;
const NEW_TASK_KEY_PATTERN =
  /^[\p{Script=Han}A-Za-z0-9]+(?:-[\p{Script=Han}A-Za-z0-9]+)*$/u;
const TASK_KEY_FILE_EXTENSION = /\.(?:md|txt|csv|json|ya?ml|docx|pdf|xlsx)$/iu;

function sessionScopeNameOf(value: unknown): string {
  const name = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (
    name === "" ||
    Array.from(name).length > SESSION_SCOPE_MAX_LENGTH ||
    name === "." ||
    name === ".." ||
    /[<>:"/\\|?*\u0000-\u001F\u007F]/u.test(name) ||
    /[. ]$/u.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(name)
  )
    throw new Error("会话名称不能安全地用作产出目录");
  return name;
}

function newTaskKeyOf(value: unknown): string {
  const taskKey = sessionScopeNameOf(value);
  if (
    !NEW_TASK_KEY_PATTERN.test(taskKey) ||
    TASK_KEY_FILE_EXTENSION.test(taskKey)
  ) {
    throw new Error(
      "新任务 task_key 只能包含中文、字母、数字和连字符，且不能带扩展名",
    );
  }
  return taskKey;
}

function firstTopicLine(value: string): string {
  const lines = value
    .normalize("NFC")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const usable =
    lines.find(
      (line) => !/^#{1,6}\s*(?:从\s+.+\s+转换|文件转换说明)\s*$/u.test(line),
    ) ?? "";
  return usable
    .replace(/^(?:@[a-z][a-z0-9_]*\s+)+/u, "")
    .replace(/^(?:#{1,6}|[-*+])\s*/u, "")
    .replace(/^(?:主题|标题|项目|需求|功能)\s*[：:]\s*/u, "")
    .split(/[。！？!?；;]/u)[0]!
    .trim();
}

function normalizedTaskKey(value: string): string {
  const topic = firstTopicLine(value).replace(TASK_KEY_FILE_EXTENSION, "");
  const safe = topic
    .replace(/[_\s]+/gu, "-")
    .replace(/[^\p{Script=Han}A-Za-z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  const base =
    safe === "" || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(safe)
      ? "产品任务"
      : safe;
  const characters = Array.from(base);
  if (characters.length <= SESSION_SCOPE_MAX_LENGTH) return newTaskKeyOf(base);
  const suffix = createHash("sha256").update(base).digest("hex").slice(0, 8);
  return newTaskKeyOf(
    `${characters
      .slice(0, SESSION_SCOPE_MAX_LENGTH - suffix.length - 1)
      .join("")
      .replace(/-+$/u, "")}-${suffix}`,
  );
}

function demandLooksLikeFileReference(
  demand: string,
  attachmentNames: readonly string[],
): boolean {
  const normalized = demand.normalize("NFC").trim();
  if (normalized === "") return true;
  if (/[/\\~]/u.test(normalized)) return true;
  return attachmentNames.some(
    (name) =>
      normalized === name ||
      normalized === name.replace(TASK_KEY_FILE_EXTENSION, ""),
  );
}

/** Derives a bounded filesystem key from the demand, or from attachment content for file-only input. */
export function taskKeyFromSubmission(
  demand: string,
  attachments: readonly { name: string; text: string }[],
): string {
  const source = demandLooksLikeFileReference(
    demand,
    attachments.map((attachment) => attachment.name),
  )
    ? (attachments
        .map((attachment) => firstTopicLine(attachment.text))
        .find(Boolean) ?? demand)
    : demand;
  return normalizedTaskKey(source);
}

function sessionIdOf(value: unknown): string {
  const sessionId = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(sessionId))
    throw new Error("会话标识格式无效");
  return sessionId;
}

const MAX_ATTACHMENT_COUNT = 20;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_REQUEST_BYTES =
  Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 64 * 1024;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".yml",
  ".yaml",
]);
const OFFICE_ATTACHMENT_EXTENSIONS = new Set([".docx", ".pdf", ".xlsx"]);
const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);
const SUPPORTED_ATTACHMENT_FORMATS =
  ".md、.txt、.csv、.json、.yml、.yaml、.docx、.pdf、.xlsx";

function attachmentNameOf(value: unknown): string {
  const name = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (
    name === "" ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    basename(name) !== name ||
    /[/\\\0]/u.test(name)
  ) {
    throw new Error("附件名称格式无效");
  }
  return name;
}

function attachmentBytesOf(value: unknown): Buffer {
  const encoded = typeof value === "string" ? value : "";
  const paddingAt = encoded.indexOf("=");
  const padding = paddingAt < 0 ? "" : encoded.slice(paddingAt);
  if (
    encoded === "" ||
    encoded.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/u.test(encoded) ||
    (paddingAt >= 0 &&
      (paddingAt < encoded.length - 2 || (padding !== "=" && padding !== "==")))
  ) {
    throw new Error("附件内容不是有效的 base64");
  }
  return Buffer.from(encoded, "base64");
}

function attachmentExtensionOf(name: string): string {
  const extension = extname(name).toLowerCase();
  if (IMAGE_ATTACHMENT_EXTENSIONS.has(extension))
    throw new Error("图片请用对话框内的图片功能");
  if (
    !TEXT_ATTACHMENT_EXTENSIONS.has(extension) &&
    !OFFICE_ATTACHMENT_EXTENSIONS.has(extension)
  ) {
    throw new Error(
      `不支持文件“${name}”。支持的格式：${SUPPORTED_ATTACHMENT_FORMATS}`,
    );
  }
  return extension;
}

function isSafeAttachmentLeaf(name: string): boolean {
  try {
    return attachmentNameOf(name) === name;
  } catch {
    return false;
  }
}

function numberedAttachmentName(name: string, ordinal: number): string {
  if (ordinal === 1) return name;
  const extension = extname(name);
  const stem = extension === "" ? name : name.slice(0, -extension.length);
  return `${stem}（${String(ordinal)}）${extension}`;
}

async function writeUniquely(
  directory: string,
  name: string,
  bytes: Buffer,
): Promise<string> {
  for (let ordinal = 1; ordinal <= 10_000; ordinal += 1) {
    const candidate = numberedAttachmentName(name, ordinal);
    try {
      await writeFile(join(directory, candidate), bytes, { flag: "wx" });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new Error(`附件“${name}”保存失败，请重试`);
    }
  }
  throw new Error(`附件“${name}”同名副本过多，请修改文件名后重试`);
}

/** Stores user-picked files under the current product workspace and returns prompt-safe relative paths. */
export async function saveTaskAttachments(
  workspacePath: string,
  sessionIdValue: string,
  values: unknown,
): Promise<string[]> {
  const workspace = resolve(workspacePath);
  const sessionId = sessionIdOf(sessionIdValue);
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > MAX_ATTACHMENT_COUNT
  )
    throw new Error("附件数量必须为 1 到 20 个");
  let totalBytes = 0;
  const files = values.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("附件信息格式无效");
    const row = value as Record<string, unknown>;
    const name = attachmentNameOf(row.name);
    attachmentExtensionOf(name);
    const bytes = attachmentBytesOf(row.contentBase64);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_ATTACHMENT_BYTES)
      throw new Error("附件总大小不能超过 20 MiB");
    return { name, bytes };
  });
  const directory = resolve(workspace, "输入", "源文件", sessionId);
  if (!directory.startsWith(`${workspace}${sep}`))
    throw new Error("附件目录越界");
  try {
    await mkdir(directory, { recursive: true });
  } catch {
    throw new Error("附件保存目录创建失败，请检查工作目录后重试");
  }
  const storedNames: string[] = [];
  try {
    for (const file of files)
      storedNames.push(await writeUniquely(directory, file.name, file.bytes));
  } catch (error) {
    await Promise.allSettled(
      storedNames.map((name) => rm(join(directory, name), { force: true })),
    );
    throw error;
  }
  return storedNames.map((name) =>
    join("输入", "源文件", sessionId, name).split(sep).join("/"),
  );
}

function numberedSessionScopeName(base: string, ordinal: number): string {
  if (ordinal === 1) return base;
  const suffix = `-${String(ordinal)}`;
  const available = SESSION_SCOPE_MAX_LENGTH - Array.from(suffix).length;
  return `${Array.from(base).slice(0, available).join("").replace(/-+$/u, "")}${suffix}`;
}

/** Claims a new task workspace without guessing identities for historical deliverables. */
export async function ensureSessionOutputDirectory(
  workspacePath: string,
  sessionIdValue: string,
  requestedNameValue: string,
): Promise<{ sessionName: string; taskKey: string; relativePath: string }> {
  const root = resolve(workspacePath);
  const sessionId = sessionIdOf(sessionIdValue);
  const mappingDirectory = join(root, ".promax", "session-scopes");
  const mappingPath = join(mappingDirectory, `${sessionId}.json`);
  await mkdir(mappingDirectory, { recursive: true });
  try {
    const stored = JSON.parse(await readFile(mappingPath, "utf8")) as {
      sessionName?: unknown;
    };
    const sessionName = sessionScopeNameOf(stored.sessionName);
    return {
      sessionName,
      taskKey: sessionName,
      relativePath: taskPaths(root, sessionName).artifacts,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const requestedName = newTaskKeyOf(requestedNameValue);
  await mkdir(join(root, ".任务"), { recursive: true });
  for (let ordinal = 1; ordinal <= 999; ordinal++) {
    const sessionName = numberedSessionScopeName(requestedName, ordinal);
    if (
      existsSync(join(root, "deliverables", sessionName)) ||
      existsSync(join(root, ".promax", "tasks", sessionName))
    )
      continue;
    const layout = taskLayoutPaths(sessionName, true);
    try {
      await mkdir(join(root, layout.task));
      await mkdir(join(root, layout.artifacts));
      await writeFile(
        mappingPath,
        `${JSON.stringify({ sessionId, sessionName, taskKey: sessionName, layout: "artifacts-v1" }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
      return {
        sessionName,
        taskKey: sessionName,
        relativePath: layout.artifacts,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("同名任务数量超过上限");
}

async function scaffoldProject(path: string): Promise<void> {
  await Promise.all([
    mkdir(join(path, "输入", "源文件"), { recursive: true }),
    mkdir(join(path, "产物"), { recursive: true }),
    mkdir(join(path, ".promax"), { recursive: true }),
  ]);
  try {
    await writeFile(
      join(path, ".promax", "source-ledger.md"),
      "# 来源台账\n\n> 由 Promax 管理。正式结果写入产物；历史任务保持原路径。\n",
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export async function ensureProjectWorkspace(
  workspaceRegistry: WorkspaceRegistry,
  root: string,
  projectName: string,
  owner: { employee_id: string; name: string; role: "owner" },
  mapping?: { project_id: string; name: string },
): Promise<WorkspaceRecord> {
  const trimmedName = projectNameOf(projectName);
  const normalizedRoot = resolve(root);
  const workspacePath = resolve(normalizedRoot, trimmedName);
  if (!workspacePath.startsWith(`${normalizedRoot}${sep}`))
    throw new Error("项目组路径越界");
  try {
    if (!(await lstat(workspacePath)).isDirectory())
      throw new Error("项目路径必须是独立目录，不能是文件或符号链接");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await scaffoldProject(workspacePath);
  try {
    await writeFile(
      join(workspacePath, "project.yml"),
      YAML.stringify({
        api_version: "promax.ai/v1alpha2",
        kind: "Project",
        metadata: {
          project_id:
            mapping?.project_id ??
            `local:${createHash("sha256").update(workspacePath).digest("hex")}`,
          name: mapping?.name ?? trimmedName,
          created_at: new Date().toISOString(),
          ...(mapping ? { identity_source: "promate" } : {}),
        },
        spec: { members: [owner] },
      }),
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return workspaceRegistry.create(workspacePath, mapping?.name ?? trimmedName);
}

export async function registerProjectWorkspaces(
  registry: WorkspaceRegistry,
  root: string,
  _owner: { employee_id: string; name: string; role: "owner" },
): Promise<WorkspaceRecord[]> {
  await mkdir(root, { recursive: true });
  const directories = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  );
  const projects: WorkspaceRecord[] = [];
  for (const directory of directories) {
    // Existing directories are registered as-is; login never claims or scaffolds them.
    let config: any;
    try {
      config = YAML.parse(
        await readFile(join(root, directory.name, "project.yml"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (config?.metadata?.identity_source === "promate") continue;
    projects.push(
      await registry.create(join(root, directory.name), directory.name),
    );
  }
  return projects;
}

async function companyWorkspaces(
  root: string,
): Promise<Array<{ path: string; projectId: string }>> {
  const result: Array<{ path: string; projectId: string }> = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      const data = YAML.parse(
        await readFile(join(root, entry.name, "project.yml"), "utf8"),
      );
      if (data?.metadata?.identity_source === "promate")
        result.push({
          path: join(root, entry.name),
          projectId: String(data.metadata.project_id),
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return result;
}

export async function openCompanyProject(
  registry: WorkspaceRegistry,
  root: string,
  project: PromateProject,
  employeeId: string,
  recycle?: Pick<Awaited<ReturnType<typeof createRecycleBin>>, "beginRequest">,
): Promise<WorkspaceRecord> {
  await mkdir(root, { recursive: true });
  let mappedPath: string | undefined;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try {
      const data = YAML.parse(
        await readFile(join(root, entry.name, "project.yml"), "utf8"),
      );
      if (
        data?.metadata?.identity_source === "promate" &&
        data.metadata.project_id === project.project_id
      ) {
        mappedPath = join(root, entry.name);
        break;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // Deterministic ID-derived directory: a matching display name never claims a local project.
  const directory = `企业-${createHash("sha256").update(project.project_id).digest("hex").slice(0, 16)}`;
  // Guard before scaffolding, and keep deletion excluded until native registration finishes.
  const release = recycle?.beginRequest({
    path: mappedPath ?? join(root, directory),
  });
  try {
    if (mappedPath) return await registry.create(mappedPath, project.name);
    if (existsSync(join(root, directory)))
      throw new Error("企业项目目录存在但未建立此 ID 映射，请人工核对");
    return await ensureProjectWorkspace(
      registry,
      root,
      directory,
      { employee_id: employeeId, name: employeeId, role: "owner" },
      project,
    );
  } finally {
    release?.();
  }
}

function taskKeyOf(value: unknown): string {
  return sessionScopeNameOf(value);
}

function dispatchMemberIds(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (item) =>
        typeof item !== "string" || !/^[a-z][a-z0-9_]{2,47}$/u.test(item),
    )
  ) {
    throw new Error(`${label}无效`);
  }
  const memberIds = value as string[];
  if (new Set(memberIds).size !== memberIds.length)
    throw new Error(`${label}不得重复`);
  return memberIds;
}

function dispatchPlanIdOf(value: unknown): string {
  const planId = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(planId))
    throw new Error("调度计划标识无效");
  return planId;
}

function dispatchPlanPath(
  root: string,
  sessionId: string,
  state: "planning" | "confirmed",
): string {
  return join(resolve(root), `${sessionId}.${state}.json`);
}

export function dispatchTeamFromRevision(value: unknown): DispatchPlanTeam {
  const row = objectRow(value, "TeamRevision");
  const metadata = objectRow(row.metadata, "TeamRevision.metadata");
  const spec = objectRow(row.spec, "TeamRevision.spec");
  if (
    row.api_version !== "promax.ai/v1alpha2" ||
    row.kind !== "TeamRevision" ||
    metadata.status !== "published" ||
    typeof metadata.team_revision_id !== "string" ||
    !Array.isArray(spec.members) ||
    !Array.isArray(spec.artifacts)
  ) {
    throw new Error("调度计划缺少已发布团队版本");
  }
  const members = spec.members.map((value) => {
    const member = objectRow(value, "TeamRevision 成员");
    if (
      typeof member.member_id !== "string" ||
      typeof member.display_name !== "string"
    )
      throw new Error("团队成员无效");
    return {
      memberId: member.member_id,
      displayName: member.display_name,
      objective:
        typeof member.objective === "string"
          ? member.objective
          : `负责 ${member.display_name} 的专业工作`,
    };
  });
  dispatchMemberIds(
    members.map((member) => member.memberId),
    "已发布团队名单",
  );
  const artifacts = spec.artifacts.map((value) => {
    const artifact = objectRow(value, "TeamRevision 产物");
    if (
      typeof artifact.relative_path !== "string" ||
      typeof artifact.produced_by !== "string"
    )
      throw new Error("团队产物无效");
    return {
      relativePath: artifact.relative_path,
      producedBy: artifact.produced_by,
    };
  });
  return { members, artifacts };
}

function generatedDispatchPlanOf(
  value: unknown,
  teamRevision: unknown,
  planId: string,
  taskKey: string,
): GeneratedDispatchPlan {
  const row = objectRow(value, "模型计划记录");
  if (
    typeof row.source_text !== "string" ||
    !Number.isSafeInteger(row.source_event_seq) ||
    Number(row.source_event_seq) < 0 ||
    typeof row.generated_at !== "string" ||
    Number.isNaN(Date.parse(row.generated_at)) ||
    row.source_message_sha256 !==
      createHash("sha256").update(row.source_text).digest("hex")
  )
    throw new Error("模型计划来源记录无效");
  const plan = parseDispatchPlan(
    row.source_text,
    dispatchTeamFromRevision(teamRevision),
    planId,
    taskKey,
  );
  if (!isDeepStrictEqual(row.plan, plan))
    throw new Error("保存的计划与模型原文不一致");
  return {
    plan,
    source_text: row.source_text,
    source_event_seq: Number(row.source_event_seq),
    source_message_sha256: String(row.source_message_sha256),
    generated_at: row.generated_at,
  };
}

function dispatchPlanControlOf(
  value: unknown,
  expectedState: "planning" | "confirmed",
): DispatchPlanControl {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("调度计划控制文件无效");
  const row = value as Record<string, unknown>;
  const metadata =
    typeof row.metadata === "object" &&
    row.metadata !== null &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : undefined;
  const spec =
    typeof row.spec === "object" &&
    row.spec !== null &&
    !Array.isArray(row.spec)
      ? (row.spec as Record<string, unknown>)
      : undefined;
  const sessionId = sessionIdOf(metadata?.session_id);
  const planId = dispatchPlanIdOf(metadata?.plan_id);
  const taskKey = taskKeyOf(metadata?.task_key);
  const createdAt =
    typeof metadata?.created_at === "string" &&
    !Number.isNaN(Date.parse(metadata.created_at))
      ? metadata.created_at
      : "";
  if (
    row.api_version !== "promax.ai/v1alpha2" ||
    row.kind !== "DispatchPlanControl" ||
    createdAt === "" ||
    spec?.state !== expectedState
  ) {
    throw new Error("调度计划控制文件格式无效");
  }
  const rosterMemberIds = dispatchMemberIds(
    spec.roster_member_ids,
    "调度计划团队名单",
  );
  const teamRevision = spec.team_revision;
  if (
    teamRevision !== undefined &&
    dispatchTeamFromRevision(teamRevision)
      .members.map((member) => member.memberId)
      .join("\0") !== rosterMemberIds.join("\0")
  ) {
    throw new Error("调度团队名单与已发布版本不一致");
  }
  const modelPlan =
    spec.model_plan === undefined
      ? undefined
      : generatedDispatchPlanOf(spec.model_plan, teamRevision, planId, taskKey);
  const generated = {
    ...(teamRevision === undefined ? {} : { team_revision: teamRevision }),
    ...(modelPlan === undefined ? {} : { model_plan: modelPlan }),
  };
  if (expectedState === "planning") {
    return {
      api_version: "promax.ai/v1alpha2",
      kind: "DispatchPlanControl",
      metadata: {
        session_id: sessionId,
        plan_id: planId,
        task_key: taskKey,
        created_at: createdAt,
      },
      spec: {
        state: "planning",
        roster_member_ids: rosterMemberIds,
        ...generated,
      },
    };
  }
  const confirmedMemberIds = dispatchMemberIds(
    spec.confirmed_member_ids,
    "已确认成员名单",
  );
  if (
    confirmedMemberIds.some((memberId) => !rosterMemberIds.includes(memberId))
  )
    throw new Error("已确认成员不属于当前团队名单");
  const confirmedAt =
    typeof spec.confirmed_at === "string" &&
    !Number.isNaN(Date.parse(spec.confirmed_at))
      ? spec.confirmed_at
      : "";
  if (confirmedAt === "") throw new Error("调度计划确认时间无效");
  return {
    api_version: "promax.ai/v1alpha2",
    kind: "DispatchPlanControl",
    metadata: {
      session_id: sessionId,
      plan_id: planId,
      task_key: taskKey,
      created_at: createdAt,
    },
    spec: {
      state: "confirmed",
      roster_member_ids: rosterMemberIds,
      confirmed_member_ids: confirmedMemberIds,
      confirmed_at: confirmedAt,
      ...generated,
    },
  };
}

async function optionalDispatchPlanControl(
  path: string,
  state: "planning" | "confirmed",
): Promise<DispatchPlanControl | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("调度计划控制文件必须是普通文件");
    return dispatchPlanControlOf(
      JSON.parse(await readFile(path, "utf8")) as unknown,
      state,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Opens a server-owned planning gate before the model sees the demand. */
export async function beginDispatchPlan(
  root: string,
  input: {
    sessionId: string;
    taskKey: string;
    rosterMemberIds: string[];
    teamRevision: unknown;
  },
): Promise<{ planId: string; taskKey: string }> {
  const sessionId = sessionIdOf(input.sessionId);
  const taskKey = taskKeyOf(input.taskKey);
  const rosterMemberIds = dispatchMemberIds(
    input.rosterMemberIds,
    "调度计划团队名单",
  );
  const team = dispatchTeamFromRevision(input.teamRevision);
  if (
    team.members.map((member) => member.memberId).join("\0") !==
    rosterMemberIds.join("\0")
  )
    throw new Error("调度团队名单与已发布版本不一致");
  const directory = resolve(root);
  await mkdir(directory, { recursive: true });
  const existing = await optionalDispatchPlanControl(
    dispatchPlanPath(directory, sessionId, "planning"),
    "planning",
  );
  if (existing !== undefined) {
    if (
      existing.metadata.task_key !== taskKey ||
      !isDeepStrictEqual(existing.spec.team_revision, input.teamRevision)
    )
      throw new Error("当前会话已有另一份调度计划，请新建需求");
    return { planId: existing.metadata.plan_id, taskKey };
  }
  const planId = `dispatch-${randomUUID()}`;
  const control: DispatchPlanControl = {
    api_version: "promax.ai/v1alpha2",
    kind: "DispatchPlanControl",
    metadata: {
      session_id: sessionId,
      plan_id: planId,
      task_key: taskKey,
      created_at: new Date().toISOString(),
    },
    spec: {
      state: "planning",
      roster_member_ids: rosterMemberIds,
      team_revision: input.teamRevision,
    },
  };
  await writeFile(
    dispatchPlanPath(directory, sessionId, "planning"),
    `${JSON.stringify(control, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  return { planId, taskKey };
}

/** Only the native turn hook supplies these committed events; no HTTP route accepts a generated plan. */
export async function saveGeneratedDispatchPlan(
  root: string,
  session: DispatchAgent["session"],
): Promise<void> {
  if (session.header.origin === "subagent") return;
  const sessionId = sessionIdOf(session.header.id);
  if (
    await optionalDispatchPlanControl(
      dispatchPlanPath(root, sessionId, "confirmed"),
      "confirmed",
    )
  )
    return;
  const path = dispatchPlanPath(root, sessionId, "planning");
  const control = await optionalDispatchPlanControl(path, "planning");
  if (control?.spec.team_revision === undefined) return;
  const team = dispatchTeamFromRevision(control.spec.team_revision);
  for (const event of [...session.events].reverse()) {
    if (
      event.type !== "assistant/message" ||
      !Number.isSafeInteger(event.seq) ||
      Number(event.seq) < 0 ||
      typeof event.time !== "number" ||
      event.time < Date.parse(control.metadata.created_at)
    )
      continue;
    const message = objectRow(
      objectRow(event.data, "会话事件").message,
      "模型回复",
    );
    if (!Array.isArray(message.content)) continue;
    const text = message.content
      .flatMap((value) => {
        const block = objectRow(value, "模型内容");
        return block.type === "text" && typeof block.text === "string"
          ? [block.text]
          : [];
      })
      .join("");
    let plan: DispatchPlan;
    try {
      plan = parseDispatchPlan(
        text,
        team,
        control.metadata.plan_id,
        control.metadata.task_key,
      );
    } catch {
      continue;
    }
    if (control.spec.model_plan?.source_event_seq === event.seq) return;
    control.spec.model_plan = {
      plan,
      source_text: text,
      source_event_seq: Number(event.seq),
      source_message_sha256: createHash("sha256").update(text).digest("hex"),
      generated_at: new Date(event.time).toISOString(),
    };
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(control, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return;
  }
}

export async function readGeneratedDispatchPlan(
  root: string,
  input: { sessionId: string; planId: string },
): Promise<DispatchPlan | undefined> {
  const control = await optionalDispatchPlanControl(
    dispatchPlanPath(root, sessionIdOf(input.sessionId), "planning"),
    "planning",
  );
  if (!control || control.metadata.plan_id !== dispatchPlanIdOf(input.planId))
    throw new Error("找不到当前待确认的调度计划");
  return control.spec.model_plan?.plan;
}

/** Freezes the user-picked member ids once; a different retry cannot replace them. */
export async function confirmDispatchPlan(
  root: string,
  input: {
    sessionId: string;
    planId: string;
    confirmedMemberIds: string[];
    plan?: unknown;
  },
): Promise<{
  planId: string;
  taskKey: string;
  confirmedMemberIds: string[];
  confirmedAt: string;
}> {
  const sessionId = sessionIdOf(input.sessionId);
  const planId = dispatchPlanIdOf(input.planId);
  const confirmedMemberIds = dispatchMemberIds(
    input.confirmedMemberIds,
    "已确认成员名单",
  );
  if (!confirmedMemberIds.some((memberId) => memberId !== "quality_judge"))
    throw new Error("已确认名单必须包含至少一名业务成员");
  const directory = resolve(root);
  const confirmedPath = dispatchPlanPath(directory, sessionId, "confirmed");
  const existing = await optionalDispatchPlanControl(
    confirmedPath,
    "confirmed",
  );
  const planning =
    existing ??
    (await optionalDispatchPlanControl(
      dispatchPlanPath(directory, sessionId, "planning"),
      "planning",
    ));
  if (planning === undefined || planning.metadata.plan_id !== planId)
    throw new Error("找不到当前待确认的调度计划");
  if (planning.spec.team_revision === undefined)
    throw new Error("历史计划缺少团队版本快照，请新建需求并重新规划");
  if (planning.spec.model_plan === undefined)
    throw new Error("模型计划尚未生成并保存，不能确认派工；请先完成模型规划");
  if (!isDeepStrictEqual(input.plan, planning.spec.model_plan.plan))
    throw new Error("确认的计划与服务端保存的模型计划不一致，请刷新计划后确认");
  if (existing !== undefined) {
    if (
      existing.metadata.plan_id !== planId ||
      existing.spec.confirmed_member_ids?.join("\0") !==
        confirmedMemberIds.join("\0")
    ) {
      throw new Error("调度名单已经确认，不能再次修改");
    }
    return {
      planId,
      taskKey: existing.metadata.task_key,
      confirmedMemberIds,
      confirmedAt: existing.spec.confirmed_at!,
    };
  }
  if (
    confirmedMemberIds.some(
      (memberId) => !planning.spec.roster_member_ids.includes(memberId),
    )
  )
    throw new Error("已确认成员不属于当前团队名单");
  const confirmedAt = new Date().toISOString();
  const control: DispatchPlanControl = {
    ...planning,
    spec: {
      state: "confirmed",
      roster_member_ids: planning.spec.roster_member_ids,
      confirmed_member_ids: confirmedMemberIds,
      confirmed_at: confirmedAt,
      team_revision: planning.spec.team_revision,
      model_plan: planning.spec.model_plan,
    },
  };
  try {
    await writeFile(confirmedPath, `${JSON.stringify(control, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return confirmDispatchPlan(directory, input);
  }
  return {
    planId,
    taskKey: planning.metadata.task_key,
    confirmedMemberIds,
    confirmedAt,
  };
}

interface DispatchExecutionInput {
  planId: string;
  taskKey: string;
  demand: string;
  attachmentPaths: string[];
  confirmedMemberIds: string[];
}

interface EvidenceInputSource {
  source_id: string;
  relative_path: string;
  sha256: string;
  media_type: string;
  origin_kind: "user-provided" | "web-snapshot";
  original_url?: string;
  captured_at?: string;
  fetch_status?: "success" | "failed";
  http_status?: number;
}

interface EvidenceInputFile {
  source_id: string;
  original_filename: string;
  relative_path: string;
  bytes: number;
  sha256: string;
  agent_readable: boolean;
  conversion?: { tool: string; version: string; from_source_id: string };
}

interface TaskManifestArtifact {
  artifact_kind: string;
  validation_kind: string;
  relative_path: string;
  produced_by: string;
  domain_rubric?: unknown;
}

interface TaskExecutionManifest {
  api_version: "promax.ai/v1alpha2";
  kind: "TaskPackage";
  metadata: {
    task_key: string;
    team_revision_id: string;
    confirmed_at: string;
  };
  spec: {
    input_manifest_path: string;
    members_confirmed: string[];
    artifacts: TaskManifestArtifact[];
    judge: { relative_path: string; produced_by: "quality_judge" };
  };
}

interface TaskManifestContract {
  confirmed_at: string;
  members_confirmed: string[];
  deliverables: TaskManifestArtifact[];
  judge: { relative_path: string; produced_by: "quality_judge" };
}

interface EvidenceInputManifest {
  api_version: "promax.ai/v1alpha2";
  kind: "EvidenceInputManifest";
  metadata: { task_key: string; frozen: true; frozen_at: string };
  inputs: { src_files: EvidenceInputFile[] };
  spec: { source_root: string; sources: EvidenceInputSource[] };
}

function objectRow(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label}格式无效`);
  return value as Record<string, unknown>;
}

function exactKeys(
  row: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(row).find((key) => !allowed.includes(key));
  if (unexpected !== undefined)
    throw new Error(`${label}包含未知字段 ${unexpected}`);
}

function assistantEventText(event: DispatchSessionEvent): string {
  if (event.type !== "assistant/message") return "";
  const data = objectRow(event.data, "会话事件");
  const message = data.message;
  if (typeof message !== "object" || message === null || Array.isArray(message))
    return "";
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) =>
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>).type === "text" &&
      typeof (block as Record<string, unknown>).text === "string"
        ? [(block as Record<string, unknown>).text as string]
        : [],
    )
    .join("");
}

function eventText(event: DispatchSessionEvent): string | undefined {
  if (event.type !== "user/message") return undefined;
  const data = objectRow(event.data, "会话消息");
  if (!Array.isArray(data.content)) return undefined;
  return data.content
    .flatMap((block) => {
      if (typeof block !== "object" || block === null || Array.isArray(block))
        return [];
      const row = block as Record<string, unknown>;
      return row.type === "text" && typeof row.text === "string"
        ? [row.text]
        : [];
    })
    .join("\n");
}

function firstJsonObject(
  text: string,
  offset: number,
): Record<string, unknown> {
  const start = text.indexOf("{", offset);
  if (start < 0) throw new Error("执行请求缺少 JSON 数据");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return objectRow(
            JSON.parse(text.slice(start, index + 1)) as unknown,
            "执行请求",
          );
        } catch (error) {
          throw new Error(
            `执行请求 JSON 无效：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }
  throw new Error("执行请求 JSON 未闭合");
}

function executionInputOf(
  events: readonly DispatchSessionEvent[],
  control: DispatchPlanControl,
): DispatchExecutionInput {
  const marker = "PROMAX_DISPATCH_EXECUTE_V1";
  let text: string | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = eventText(events[index]!);
    if (candidate?.includes(marker)) {
      text = candidate;
      break;
    }
  }
  if (text === undefined)
    throw new Error("会话缺少 PROMAX_DISPATCH_EXECUTE_V1 执行请求");
  const row = firstJsonObject(text, text.indexOf(marker) + marker.length);
  const planId = dispatchPlanIdOf(row.plan_id);
  const taskKey = taskKeyOf(row.task_key);
  const demand =
    typeof row.demand === "string" ? row.demand.normalize("NFC").trim() : "";
  const attachmentPaths =
    Array.isArray(row.attachment_paths) &&
    row.attachment_paths.every((path) => typeof path === "string")
      ? row.attachment_paths.map((path) => path.normalize("NFC"))
      : undefined;
  const confirmedMemberIds = dispatchMemberIds(
    row.confirmed_member_ids,
    "执行请求成员名单",
  );
  if (
    planId !== control.metadata.plan_id ||
    taskKey !== control.metadata.task_key
  )
    throw new Error("执行请求与已确认调度计划不一致");
  if (demand === "") throw new Error("执行请求需求不能为空");
  if (
    attachmentPaths === undefined ||
    new Set(attachmentPaths).size !== attachmentPaths.length
  )
    throw new Error("执行请求附件路径无效或重复");
  if (
    confirmedMemberIds.join("\0") !==
    control.spec.confirmed_member_ids?.join("\0")
  )
    throw new Error("执行请求成员名单与已确认名单不一致");
  return { planId, taskKey, demand, attachmentPaths, confirmedMemberIds };
}

const ATTACHMENT_MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".yml": "application/yaml",
  ".yaml": "application/yaml",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const CONVERTERS = {
  ".docx": {
    tool: "mammoth",
    version: "1.12.2",
    extension: ".md",
    mediaType: "text/markdown",
  },
  ".pdf": {
    tool: "pdf-parse",
    version: "2.4.5",
    extension: ".md",
    mediaType: "text/markdown",
  },
  ".xlsx": {
    tool: "exceljs",
    version: "4.4.0",
    extension: ".csv",
    mediaType: "text/csv",
  },
} as const;

interface UploadedAttachment {
  bytes: Buffer;
  filename: string;
  originalFilename: string;
  extension: string;
  mediaType: string;
}

interface MaterializedAttachment extends UploadedAttachment {
  sourceId: string;
  agentReadable: boolean;
  conversion?: EvidenceInputFile["conversion"];
  pageCount?: number;
}

function frozenSourceFilename(
  file: Pick<MaterializedAttachment, "sourceId" | "extension">,
): string {
  const extension = /^\.[A-Za-z0-9_-]+$/u.test(file.extension)
    ? file.extension
    : ".bin";
  return `${file.sourceId}${extension}`;
}

function sourceFilename(path: string): string {
  const original = basename(path);
  const checked = attachmentNameOf(original);
  if (checked !== original)
    throw new Error(`附件“${original}”的名称与上传时不一致，请重新选择文件`);
  return original;
}

async function uploadedAttachment(
  workspace: string,
  sessionId: string,
  path: string,
): Promise<UploadedAttachment> {
  const prefix = `输入/源文件/${sessionId}/`;
  if (
    !path.startsWith(prefix) ||
    path.slice(prefix.length) === "" ||
    path.slice(prefix.length).includes("/") ||
    path.includes("\\") ||
    path.includes("..")
  ) {
    throw new Error(`附件路径不属于当前会话：${path}`);
  }
  const file = resolve(workspace, ...path.split("/"));
  const attachmentRoot = resolve(workspace, "输入", "源文件", sessionId);
  if (!file.startsWith(`${attachmentRoot}${sep}`))
    throw new Error(`附件路径越出当前会话目录：${path}`);
  let info;
  let bytes: Buffer;
  try {
    let parent = workspace;
    for (const part of ["输入", "源文件", sessionId]) {
      parent = join(parent, part);
      const directory = await lstat(parent);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("附件必须位于本会话的真实目录");
    }
    info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`附件必须是普通文件：${path}`);
    bytes = await readFile(file);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("附件必须"))
      throw error;
    throw new Error(`附件“${basename(path)}”读取失败，请重新上传`);
  }
  const extension = extname(file).toLowerCase();
  attachmentExtensionOf(file);
  return {
    bytes,
    filename: sourceFilename(file),
    originalFilename: basename(file),
    extension,
    mediaType: ATTACHMENT_MEDIA_TYPES[extension]!,
  };
}

function markdownConversion(filename: string, text: string): Buffer {
  const content = text.trim();
  if (content === "") throw new Error(`文档“${filename}”没有可转换的文本内容`);
  return Buffer.from(`# 从 ${filename} 转换\n\n${content}\n`, "utf8");
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function convertOfficeAttachment(file: UploadedAttachment): Promise<{
  bytes: Buffer;
  filename: string;
  mediaType: string;
  tool: string;
  version: string;
  pageCount?: number;
}> {
  const converter = CONVERTERS[file.extension as keyof typeof CONVERTERS];
  if (converter === undefined)
    throw new Error(`文档“${file.originalFilename}”没有可用的转换器`);
  try {
    if (file.extension === ".docx") {
      const result = await mammoth.extractRawText({ buffer: file.bytes });
      return {
        bytes: markdownConversion(file.originalFilename, result.value),
        filename: "agent-readable.md",
        mediaType: converter.mediaType,
        tool: converter.tool,
        version: converter.version,
      };
    }
    if (file.extension === ".pdf") {
      const parser = new PDFParse({ data: file.bytes });
      try {
        const result = await parser.getText();
        if (result.text.trim() === "")
          throw new Error(
            "PDF 中没有可搜索文字，可能是扫描件；请先进行 OCR 或上传可搜索 PDF",
          );
        return {
          bytes: markdownConversion(file.originalFilename, result.text),
          filename: "agent-readable.md",
          mediaType: converter.mediaType,
          tool: converter.tool,
          version: converter.version,
          pageCount: result.total,
        };
      } finally {
        await parser.destroy();
      }
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(file.bytes).buffer);
    if (workbook.worksheets.length === 0) throw new Error("工作簿没有工作表");
    const lines: string[] = [];
    for (const [sheetIndex, worksheet] of workbook.worksheets.entries()) {
      if (sheetIndex > 0) lines.push("");
      lines.push(["__sheet__", worksheet.name].map(csvCell).join(","));
      for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        const values = Array.from(
          { length: Math.max(worksheet.columnCount, row.cellCount) },
          (_unused, index) => row.getCell(index + 1).text,
        );
        lines.push(values.map(csvCell).join(","));
      }
    }
    return {
      bytes: Buffer.from(`${lines.join("\n")}\n`, "utf8"),
      filename: "agent-readable.csv",
      mediaType: converter.mediaType,
      tool: converter.tool,
      version: converter.version,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    if (
      file.extension === ".pdf" &&
      /password|encrypted|encryption/iu.test(detail)
    ) {
      throw new Error(`PDF“${file.originalFilename}”已加密，解除密码后再上传`);
    }
    if (/没有可搜索文字|没有可转换的文本内容|工作簿没有工作表/u.test(detail)) {
      throw new Error(`文档“${file.originalFilename}”转换失败：${detail}`);
    }
    throw new Error(
      `文档“${file.originalFilename}”转换失败，请确认文件未损坏且内容可读取后重试（${converter.tool} ${converter.version}）`,
    );
  }
}

/** Conversion cache is keyed by original bytes and converter version, not upload order. */
async function cachedOfficeAttachment(workspace: string, file: UploadedAttachment) {
  const converter = CONVERTERS[file.extension as keyof typeof CONVERTERS];
  const id = sha256(`${sha256(file.bytes)}:${file.originalFilename}:${converter.tool}:${converter.version}`);
  const root = join(workspace, ".promax", "material-cache", id);
  const metaPath = join(root, "result.json");
  return serializeWork(root, async () => {
  let directory = workspace;
  for (const part of [".promax", "material-cache", id]) {
    directory = join(directory, part);
    try { await mkdir(directory); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("材料缓存目录不得是符号链接");
  }
  try {
    if ((await lstat(metaPath)).isSymbolicLink()) throw new Error("材料缓存不得是符号链接");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as Omit<Awaited<ReturnType<typeof convertOfficeAttachment>>, "bytes"> & { hash: string };
    if (!["agent-readable.md", "agent-readable.csv"].includes(meta.filename)) throw new Error("可读缓存路径无效");
    if ((await lstat(join(root, meta.filename))).isSymbolicLink()) throw new Error("材料缓存不得是符号链接");
    const bytes = await readFile(join(root, meta.filename));
    if (sha256(bytes) !== meta.hash) throw new Error("可读缓存损坏，请恢复原件后重新解析");
    return { ...meta, bytes };
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const result = await convertOfficeAttachment(file);
  for (const file of [metaPath, join(root, result.filename)]) {
    const info = await lstat(file).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return undefined; throw e; });
    if (info?.isSymbolicLink()) throw new Error("材料缓存不得是符号链接");
  }
  await writeFile(join(root, result.filename), result.bytes, { mode: 0o600 });
  const { bytes, ...metadata } = result;
  await writeFile(metaPath, JSON.stringify({ ...metadata, hash: sha256(bytes) }), { mode: 0o600 });
  return result;
  });
}
export interface PlanningAttachmentContext {
  path: string;
  name: string;
  mediaType: string;
  bytes: number;
  readablePath: string;
  textCharacters: number;
  excerpt: string;
  truncated: boolean;
  converter?: string;
  pageCount?: number;
}

const PLANNING_ATTACHMENT_EXCERPT_PER_FILE = 12_000;
const PLANNING_ATTACHMENT_EXCERPT_TOTAL = 40_000;

function codePointSlice(
  value: string,
  limit: number,
): { text: string; characters: number; truncated: boolean } {
  const characters = Array.from(value.trim());
  return {
    text: characters.slice(0, limit).join(""),
    characters: characters.length,
    truncated: characters.length > limit,
  };
}

async function installPlanningReadableFile(
  workspace: string,
  sessionId: string,
  sourceId: string,
  filename: string,
  bytes: Buffer,
): Promise<string> {
  const relativePath = `.promax/planning-input/${sessionId}/${sourceId}/${filename}`;
  const target = resolve(workspace, ...relativePath.split("/"));
  const directory = resolve(
    workspace,
    ".promax",
    "planning-input",
    sessionId,
    sourceId,
  );
  if (!target.startsWith(`${directory}${sep}`))
    throw new Error("附件预解析路径越界");
  let checked = workspace;
  for (const part of [".promax", "planning-input", sessionId, sourceId]) {
    checked = join(checked, part);
    try { await mkdir(checked); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    const info = await lstat(checked);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("材料可读目录不得是符号链接");
  }
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await lstat(target)).isSymbolicLink()) throw new Error("材料可读文件不得是符号链接");
    const existing = await readFile(target);
    if (sha256(existing) !== sha256(bytes))
      throw new Error(`附件“${filename}”的预解析结果发生冲突，请重新创建需求`);
  }
  return relativePath;
}

/** Converts uploaded documents before planning and returns a bounded, model-readable context. */
export async function prepareTaskAttachmentsForPlanning(
  workspacePath: string,
  sessionIdValue: string,
  paths: readonly string[],
): Promise<PlanningAttachmentContext[]> {
  const workspace = resolve(workspacePath);
  const sessionId = sessionIdOf(sessionIdValue);
  if (
    paths.length > MAX_ATTACHMENT_COUNT ||
    new Set(paths).size !== paths.length
  )
    throw new Error("待解析附件数量无效或重复");
  const uploaded = await Promise.all(
    paths.map((path) => uploadedAttachment(workspace, sessionId, path)),
  );
  const contexts: PlanningAttachmentContext[] = [];
  let remaining = PLANNING_ATTACHMENT_EXCERPT_TOTAL;
  for (const [index, file] of uploaded.entries()) {
    const converted = OFFICE_ATTACHMENT_EXTENSIONS.has(file.extension)
      ? await cachedOfficeAttachment(workspace, file)
      : undefined;
    const readableBytes = converted?.bytes ?? file.bytes;
    const readableName = converted?.filename ?? file.filename;
    const readablePath =
      converted === undefined
        ? paths[index]!
        : await installPlanningReadableFile(
            workspace,
            sessionId,
            sha256(readableBytes),
            readableName,
            readableBytes,
          );
    const text = readableBytes.toString("utf8").replaceAll("\u0000", "").trim();
    if (text === "")
      throw new Error(`文档“${file.originalFilename}”没有可供智能体阅读的文字`);
    const filesLeft = uploaded.length - index;
    const limit = Math.min(
      PLANNING_ATTACHMENT_EXCERPT_PER_FILE,
      Math.max(1, Math.floor(remaining / filesLeft)),
    );
    const excerpt = codePointSlice(text, limit);
    remaining -= Array.from(excerpt.text).length;
    contexts.push({
      path: paths[index]!,
      name: file.originalFilename,
      mediaType: file.mediaType,
      bytes: file.bytes.byteLength,
      readablePath,
      textCharacters: excerpt.characters,
      excerpt: "", // body is read on demand, not automatically injected
      truncated: excerpt.characters > 0,
      ...(converted === undefined
        ? {}
        : { converter: `${converted.tool} ${converted.version}` }),
      ...(converted?.pageCount === undefined
        ? {}
        : { pageCount: converted.pageCount }),
    });
  }
  return contexts;
}

async function materializeAttachments(
  workspace: string,
  sessionId: string,
  paths: readonly string[],
): Promise<MaterializedAttachment[]> {
  const uploaded = await Promise.all(
    paths.map((path) => uploadedAttachment(workspace, sessionId, path)),
  );
  const materialized: MaterializedAttachment[] = [];
  let ordinal = 1;
  for (const file of uploaded) {
    const sourceId = `SRC-${String(ordinal).padStart(3, "0")}`;
    ordinal += 1;
    materialized.push({
      ...file,
      sourceId,
      agentReadable: TEXT_ATTACHMENT_EXTENSIONS.has(file.extension),
    });
    if (OFFICE_ATTACHMENT_EXTENSIONS.has(file.extension)) {
      const converted = await cachedOfficeAttachment(workspace, file);
      const convertedSourceId = `SRC-${String(ordinal).padStart(3, "0")}`;
      ordinal += 1;
      materialized.push({
        bytes: converted.bytes,
        filename: converted.filename,
        originalFilename: file.originalFilename,
        extension: extname(converted.filename),
        mediaType: converted.mediaType,
        sourceId: convertedSourceId,
        agentReadable: true,
        conversion: {
          tool: converted.tool,
          version: converted.version,
          from_source_id: sourceId,
        },
        ...(converted.pageCount === undefined
          ? {}
          : { pageCount: converted.pageCount }),
      });
    }
  }
  return materialized;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function evidenceManifestOf(
  value: unknown,
  taskKey: string,
): EvidenceInputManifest {
  const row = objectRow(value, "EvidenceInputManifest");
  exactKeys(
    row,
    ["api_version", "kind", "metadata", "inputs", "spec"],
    "EvidenceInputManifest",
  );
  const metadata = objectRow(row.metadata, "EvidenceInputManifest.metadata");
  const inputs =
    row.inputs === undefined
      ? { src_files: [] }
      : objectRow(row.inputs, "EvidenceInputManifest.inputs");
  const spec = objectRow(row.spec, "EvidenceInputManifest.spec");
  const sourceRoot = `${taskLayoutPaths(taskKey, spec.source_root === `.任务/${taskKey}/输入/sources`).input}/sources`;
  exactKeys(
    metadata,
    ["task_key", "frozen", "frozen_at"],
    "EvidenceInputManifest.metadata",
  );
  exactKeys(inputs, ["src_files"], "EvidenceInputManifest.inputs");
  exactKeys(spec, ["source_root", "sources"], "EvidenceInputManifest.spec");
  if (
    row.api_version !== "promax.ai/v1alpha2" ||
    row.kind !== "EvidenceInputManifest" ||
    metadata.task_key !== taskKey ||
    metadata.frozen !== true ||
    typeof metadata.frozen_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
      metadata.frozen_at,
    ) ||
    !Array.isArray(inputs.src_files) ||
    inputs.src_files.length > 256 ||
    spec.source_root !== sourceRoot ||
    !Array.isArray(spec.sources) ||
    spec.sources.length < 1 ||
    spec.sources.length > 256
  ) {
    throw new Error("EvidenceInputManifest Schema 校验失败");
  }
  const ids = new Set<string>();
  const sources = spec.sources.map((value, index) => {
    const source = objectRow(
      value,
      `EvidenceInputManifest.spec.sources[${String(index)}]`,
    );
    exactKeys(
      source,
      [
        "source_id",
        "relative_path",
        "sha256",
        "media_type",
        "origin_kind",
        "original_url",
        "captured_at",
        "fetch_status",
        "http_status",
      ],
      `EvidenceInputManifest.spec.sources[${String(index)}]`,
    );
    const sourceId =
      typeof source.source_id === "string" ? source.source_id : "";
    const relativePath =
      typeof source.relative_path === "string" ? source.relative_path : "";
    const mediaType =
      typeof source.media_type === "string" ? source.media_type : "";
    const originKind = source.origin_kind;
    const sourcePathPrefix = `${sourceRoot}/${sourceId}/`;
    const sourceLeaf = relativePath.startsWith(sourcePathPrefix)
      ? relativePath.slice(sourcePathPrefix.length)
      : "";
    if (
      !/^SRC-[0-9]{3,6}$/u.test(sourceId) ||
      ids.has(sourceId) ||
      sourceLeaf === "" ||
      sourceLeaf.includes("/") ||
      !isSafeAttachmentLeaf(sourceLeaf) ||
      typeof source.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(source.sha256) ||
      !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType) ||
      (originKind !== "user-provided" && originKind !== "web-snapshot")
    ) {
      throw new Error(
        `EvidenceInputManifest source ${String(index + 1)} Schema 校验失败`,
      );
    }
    if (
      originKind === "web-snapshot" &&
      (typeof source.original_url !== "string" ||
        !/^https?:\/\//u.test(source.original_url) ||
        typeof source.captured_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(
          source.captured_at,
        ) ||
        (source.fetch_status !== "success" &&
          source.fetch_status !== "failed") ||
        typeof source.http_status !== "number" ||
        !Number.isSafeInteger(source.http_status) ||
        source.http_status < 0 ||
        source.http_status > 599)
    )
      throw new Error(
        `EvidenceInputManifest web source ${String(index + 1)} Schema 校验失败`,
      );
    ids.add(sourceId);
    // SAFETY: the preceding field validation establishes the immutable evidence source schema.
    return source as unknown as EvidenceInputSource;
  });
  const srcFiles = inputs.src_files.map((value, index) => {
    const file = objectRow(
      value,
      `EvidenceInputManifest.inputs.src_files[${String(index)}]`,
    );
    exactKeys(
      file,
      [
        "source_id",
        "original_filename",
        "relative_path",
        "bytes",
        "sha256",
        "agent_readable",
        "conversion",
      ],
      `EvidenceInputManifest.inputs.src_files[${String(index)}]`,
    );
    const conversion =
      file.conversion === undefined
        ? undefined
        : objectRow(
            file.conversion,
            `EvidenceInputManifest.inputs.src_files[${String(index)}].conversion`,
          );
    if (conversion !== undefined)
      exactKeys(
        conversion,
        ["tool", "version", "from_source_id"],
        `EvidenceInputManifest.inputs.src_files[${String(index)}].conversion`,
      );
    if (
      typeof file.source_id !== "string" ||
      !/^SRC-[0-9]{3,6}$/u.test(file.source_id) ||
      typeof file.original_filename !== "string" ||
      file.original_filename === "" ||
      file.original_filename.length > 255 ||
      typeof file.relative_path !== "string" ||
      !file.relative_path.startsWith(`${sourceRoot}/${file.source_id}/`) ||
      typeof file.bytes !== "number" ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      typeof file.agent_readable !== "boolean" ||
      (conversion !== undefined &&
        (typeof conversion.tool !== "string" ||
          conversion.tool === "" ||
          typeof conversion.version !== "string" ||
          conversion.version === "" ||
          typeof conversion.from_source_id !== "string" ||
          !/^SRC-[0-9]{3,6}$/u.test(conversion.from_source_id)))
    )
      throw new Error(
        `EvidenceInputManifest src_file ${String(index + 1)} Schema 校验失败`,
      );
    return {
      source_id: file.source_id,
      original_filename: file.original_filename,
      relative_path: file.relative_path,
      bytes: file.bytes,
      sha256: file.sha256,
      agent_readable: file.agent_readable,
      ...(conversion === undefined
        ? {}
        : {
            conversion: {
              tool: conversion.tool as string,
              version: conversion.version as string,
              from_source_id: conversion.from_source_id as string,
            },
          }),
    };
  });
  return {
    api_version: "promax.ai/v1alpha2",
    kind: "EvidenceInputManifest",
    metadata: {
      task_key: taskKey,
      frozen: true,
      frozen_at: metadata.frozen_at,
    },
    inputs: { src_files: srcFiles },
    spec: { source_root: spec.source_root, sources },
  };
}

async function validateEvidenceManifestFiles(
  workspace: string,
  manifest: EvidenceInputManifest,
): Promise<void> {
  const sources = new Map(
    manifest.spec.sources.map((source) => [source.source_id, source]),
  );
  for (const source of manifest.spec.sources) {
    const path = resolve(workspace, ...source.relative_path.split("/"));
    if (!path.startsWith(`${workspace}${sep}`))
      throw new Error(`输入源路径越出工作区：${source.relative_path}`);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`输入源必须是普通文件：${source.relative_path}`);
    const bytes = await readFile(path);
    if (sha256(bytes) !== source.sha256)
      throw new Error(`输入源 sha256 不匹配：${source.source_id}`);
  }
  for (const file of manifest.inputs.src_files) {
    const source = sources.get(file.source_id);
    if (
      source === undefined ||
      source.relative_path !== file.relative_path ||
      source.sha256 !== file.sha256
    ) {
      throw new Error(`src_files 与证据源登记不一致：${file.source_id}`);
    }
    const path = resolve(workspace, ...file.relative_path.split("/"));
    const bytes = await readFile(path);
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256)
      throw new Error(`src_files 写后校验失败：${file.source_id}`);
  }
}

function sameBaseSources(
  current: EvidenceInputManifest,
  expected: EvidenceInputManifest,
): boolean {
  if (current.spec.sources.length < expected.spec.sources.length) return false;
  return (
    expected.spec.sources.every(
      (source, index) =>
        JSON.stringify(current.spec.sources[index]) === JSON.stringify(source),
    ) &&
    JSON.stringify(current.inputs.src_files) ===
      JSON.stringify(expected.inputs.src_files)
  );
}

type DispatchEvidencePreparationResult = {
  manifestPath: string;
  sources: number;
  replacedInvalidManifest: boolean;
};

const dispatchEvidencePreparations = new Map<
  string,
  Promise<DispatchEvidencePreparationResult>
>();

function artifactSources(
  workspace: string,
  taskKey: string,
  demand: string,
  uploaded: readonly MaterializedAttachment[],
  workKey?: string,
): MaterializedAttachment[] {
  if (!taskPaths(workspace, taskKey).modern) return [...uploaded];
  const store = new ContentObjectStore(workspace);
  const baseline = store.freezeBaseline(taskKey);
  const files = [...uploaded];
  let ordinal =
    Math.max(0, ...files.map((file) => Number(file.sourceId.slice(4)))) + 1;
  for (const artifact of baseline.artifacts) {
    if (
      !demand.includes(artifact.filename) ||
      (workKey !== undefined && artifact.work_key !== workKey)
    )
      continue;
    files.push({
      bytes: readFileSync(store.verifyObject(artifact.current_sha256)),
      filename: artifact.filename,
      originalFilename: artifact.filename,
      extension: extname(artifact.filename),
      mediaType:
        extname(artifact.filename) === ".md" ? "text/markdown" : "text/plain",
      sourceId: `SRC-${String(ordinal++).padStart(3, "0")}`,
      agentReadable: true,
    });
  }
  return files;
}

async function prepareDispatchEvidenceInputOnce(
  input: {
    workspacePath: string;
    sessionId: string;
    taskKey: string;
    demand: string;
    attachmentPaths: string[];
    frozenAt: string;
    telemetry?: LocalTelemetry;
  },
  preparedAttachments?: readonly MaterializedAttachment[],
): Promise<DispatchEvidencePreparationResult> {
  const workspace = resolve(input.workspacePath);
  const sessionId = sessionIdOf(input.sessionId);
  const taskKey = taskKeyOf(input.taskKey);
  if (input.demand.trim() === "") throw new Error("冻结输入需求不能为空");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.frozenAt))
    throw new Error("冻结输入时间无效");
  if (new Set(input.attachmentPaths).size !== input.attachmentPaths.length)
    throw new Error("冻结输入附件路径不得重复");

  const attachments =
    preparedAttachments === undefined
      ? artifactSources(
          workspace,
          taskKey,
          input.demand,
          await materializeAttachments(
            workspace,
            sessionId,
            input.attachmentPaths,
          ),
          (await new WorkStore(workspace).forSession(sessionId))?.work_key,
        )
      : [...preparedAttachments];
  const layout = taskPaths(workspace, taskKey);
  const sourceRoot = `${layout.input}/sources`;
  const demandContent = `${input.demand.trim()}\n`;
  const attachmentSources: EvidenceInputSource[] = attachments.map((file) => ({
    source_id: file.sourceId,
    relative_path: `${sourceRoot}/${file.sourceId}/${frozenSourceFilename(file)}`,
    sha256: sha256(file.bytes),
    media_type: file.mediaType,
    origin_kind: "user-provided" as const,
  }));
  const demandSourceId = `SRC-${String(attachments.length + 1).padStart(3, "0")}`;
  const sources: EvidenceInputSource[] = [
    ...attachmentSources,
    {
      source_id: demandSourceId,
      relative_path: `${sourceRoot}/${demandSourceId}/demand.md`,
      sha256: sha256(demandContent),
      media_type: "text/markdown",
      origin_kind: "user-provided",
    },
  ];
  const srcFiles: EvidenceInputFile[] = attachments.map((file) => ({
    source_id: file.sourceId,
    original_filename: file.originalFilename,
    relative_path: `${sourceRoot}/${file.sourceId}/${frozenSourceFilename(file)}`,
    bytes: file.bytes.byteLength,
    sha256: sha256(file.bytes),
    agent_readable: file.agentReadable,
    ...(file.conversion === undefined ? {} : { conversion: file.conversion }),
  }));
  const manifest: EvidenceInputManifest = {
    api_version: "promax.ai/v1alpha2",
    kind: "EvidenceInputManifest",
    metadata: { task_key: taskKey, frozen: true, frozen_at: input.frozenAt },
    inputs: { src_files: srcFiles },
    spec: { source_root: sourceRoot, sources },
  };
  evidenceManifestOf(manifest, taskKey);

  const target = join(workspace, layout.input);
  const inputParent = resolve(target, "..");
  const manifestPath = join(target, "manifest.yml");
  const freezeObjects = (value: EvidenceInputManifest): void => {
    if (!layout.modern) return;
    const store = new ContentObjectStore(workspace, (attributes) =>
      input.telemetry?.observation(sessionId, attributes),
    );
    for (const source of value.spec.sources) {
      const object = store.put(
        readFileSync(join(workspace, source.relative_path)),
      );
      store.reference(source.relative_path, object.sha256);
      const attachmentIndex = attachments
        .filter((file) => file.conversion === undefined)
        .findIndex((file) => file.sourceId === source.source_id);
      const uploadedPath =
        attachmentIndex < 0
          ? undefined
          : input.attachmentPaths[attachmentIndex];
      if (uploadedPath !== undefined)
        store.reference(uploadedPath, object.sha256);
    }
    chmodSync(manifestPath, 0o444);
  };
  const lock = join(inputParent, `.freeze-${sessionId}.lock`);
  const staging = join(inputParent, `.staging-${sessionId}-${randomUUID()}`);
  await mkdir(inputParent, { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("当前会话的冻结输入正在准备，请稍后重试");
    throw error;
  }
  try {
    for (const attachment of attachments) {
      const sourceDirectory = join(staging, "sources", attachment.sourceId);
      await mkdir(sourceDirectory, { recursive: true });
      await writeFile(
        join(sourceDirectory, frozenSourceFilename(attachment)),
        attachment.bytes,
        { flag: "wx" },
      );
    }
    await mkdir(join(staging, "sources", demandSourceId), { recursive: true });
    await writeFile(
      join(staging, "sources", demandSourceId, "demand.md"),
      demandContent,
      { flag: "wx" },
    );
    await writeFile(
      join(staging, "manifest.yml"),
      evidenceManifestYaml(manifest),
      { encoding: "utf8", flag: "wx" },
    );
    for (const source of sources) {
      const stagedPath = join(
        staging,
        ...source.relative_path.split("/").slice(-3),
      );
      const bytes = await readFile(stagedPath);
      if (bytes.byteLength === 0 || sha256(bytes) !== source.sha256)
        throw new Error(`冻结输入写后校验失败：${source.source_id}`);
    }

    let current: EvidenceInputManifest | undefined;
    let targetExists = false;
    try {
      const info = await lstat(target);
      targetExists = true;
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("既有冻结输入路径不是普通目录");
      current = evidenceManifestOf(
        YAML.parse(await readFile(manifestPath, "utf8")) as unknown,
        taskKey,
      );
      await validateEvidenceManifestFiles(workspace, current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !targetExists)
        current = undefined;
      else if (!targetExists) throw error;
    }

    if (current !== undefined) {
      if (!sameBaseSources(current, manifest))
        throw new Error(
          `不可变输入已经冻结且与当前执行请求不一致：${manifestPath}`,
        );
      freezeObjects(current);
      await rm(staging, { recursive: true, force: true });
      return {
        manifestPath,
        sources: current.spec.sources.length,
        replacedInvalidManifest: false,
      };
    }

    let replacedInvalidManifest = false;
    let quarantine: string | undefined;
    if (targetExists && !layout.modern)
      throw new Error("历史冻结输入只读，拒绝修复或迁移");
    if (targetExists) {
      quarantine = join(
        inputParent,
        `.rejected-${sessionId}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      );
      await rename(target, quarantine);
      replacedInvalidManifest = true;
    }
    try {
      await rename(staging, target);
    } catch (error) {
      if (quarantine !== undefined) await rename(quarantine, target);
      throw error;
    }
    const installed = evidenceManifestOf(
      YAML.parse(await readFile(manifestPath, "utf8")) as unknown,
      taskKey,
    );
    await validateEvidenceManifestFiles(workspace, installed);
    freezeObjects(installed);
    return {
      manifestPath,
      sources: installed.spec.sources.length,
      replacedInvalidManifest,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

/** Materializes the server-owned immutable input before any confirmed member can start. */
export async function prepareDispatchEvidenceInput(input: {
  workspacePath: string;
  sessionId: string;
  taskKey: string;
  demand: string;
  attachmentPaths: string[];
  frozenAt: string;
  telemetry?: LocalTelemetry;
}): Promise<DispatchEvidencePreparationResult> {
  return prepareDispatchEvidenceInputCoordinated(input);
}

async function prepareDispatchEvidenceInputCoordinated(
  input: {
    workspacePath: string;
    sessionId: string;
    taskKey: string;
    demand: string;
    attachmentPaths: string[];
    frozenAt: string;
    telemetry?: LocalTelemetry;
  },
  preparedAttachments?: readonly MaterializedAttachment[],
): Promise<DispatchEvidencePreparationResult> {
  const key = `${resolve(input.workspacePath)}\0${sessionIdOf(input.sessionId)}\0${taskKeyOf(input.taskKey)}`;
  const active = dispatchEvidencePreparations.get(key);
  if (active !== undefined) return active;
  const pending = prepareDispatchEvidenceInputOnce(input, preparedAttachments);
  dispatchEvidencePreparations.set(key, pending);
  try {
    return await pending;
  } finally {
    if (dispatchEvidencePreparations.get(key) === pending)
      dispatchEvidencePreparations.delete(key);
  }
}

function planningContextsFromMaterialized(
  workspace: string,
  taskKey: string,
  paths: readonly string[],
  materialized: readonly MaterializedAttachment[],
): PlanningAttachmentContext[] {
  const sourceRoot = `${taskPaths(workspace, taskKeyOf(taskKey)).input}/sources`;
  const originals = materialized.filter(
    (file) => file.conversion === undefined,
  );
  if (originals.length < paths.length)
    throw new Error("附件解析结果与上传文件数量不一致");
  let remaining = PLANNING_ATTACHMENT_EXCERPT_TOTAL;
  return originals.map((file, index) => {
    const readable = file.agentReadable
      ? file
      : materialized.find(
          (candidate) => candidate.conversion?.from_source_id === file.sourceId,
        );
    if (readable === undefined)
      throw new Error(
        `文档“${file.originalFilename}”没有可供智能体阅读的转换结果`,
      );
    const text = readable.bytes
      .toString("utf8")
      .replaceAll("\u0000", "")
      .trim();
    if (text === "")
      throw new Error(`文档“${file.originalFilename}”没有可供智能体阅读的文字`);
    const filesLeft = originals.length - index;
    const limit = Math.min(
      PLANNING_ATTACHMENT_EXCERPT_PER_FILE,
      Math.max(1, Math.floor(remaining / filesLeft)),
    );
    const excerpt = codePointSlice(text, limit);
    remaining -= Array.from(excerpt.text).length;
    return {
      path:
        paths[index] ??
        `${sourceRoot}/${file.sourceId}/${frozenSourceFilename(file)}`,
      name: file.originalFilename,
      mediaType: file.mediaType,
      bytes: file.bytes.byteLength,
      readablePath: `${sourceRoot}/${readable.sourceId}/${frozenSourceFilename(readable)}`,
      textCharacters: excerpt.characters,
      excerpt: "", // body is read on demand, not automatically injected
      truncated: excerpt.characters > 0,
      ...(readable.conversion === undefined
        ? {}
        : {
            converter: `${readable.conversion.tool} ${readable.conversion.version}`,
          }),
      ...(readable.pageCount === undefined
        ? {}
        : { pageCount: readable.pageCount }),
    };
  });
}

function topicAttachmentsFromMaterialized(
  materialized: readonly MaterializedAttachment[],
): Array<{ name: string; text: string }> {
  return materialized
    .filter((file) => file.conversion === undefined)
    .map((file) => {
      const readable = file.agentReadable
        ? file
        : materialized.find(
            (candidate) =>
              candidate.conversion?.from_source_id === file.sourceId,
          );
      if (readable === undefined)
        throw new Error(
          `文档“${file.originalFilename}”没有可供智能体读取的正文`,
        );
      return {
        name: file.originalFilename,
        text: readable.bytes.toString("utf8").replaceAll("\u0000", "").trim(),
      };
    });
}

/** Derives the final task key, claims its output directory, and freezes the exact input package. */
export async function prepareTaskSubmission(input: {
  workspacePath: string;
  sessionId: string;
  demand: string;
  attachmentPaths: string[];
  frozenAt: string;
  telemetry?: LocalTelemetry;
}): Promise<
  DispatchEvidencePreparationResult & {
    taskKey: string;
    sessionName: string;
    attachments: PlanningAttachmentContext[];
  }
> {
  const workspace = resolve(input.workspacePath);
  const sessionId = sessionIdOf(input.sessionId);
  if (
    input.attachmentPaths.length > MAX_ATTACHMENT_COUNT ||
    new Set(input.attachmentPaths).size !== input.attachmentPaths.length
  ) {
    throw new Error("冻结输入附件数量无效或存在重复");
  }
  let materialized = await materializeAttachments(
    workspace,
    sessionId,
    input.attachmentPaths,
  );
  const taskKeyCandidate = taskKeyFromSubmission(
    input.demand,
    topicAttachmentsFromMaterialized(materialized),
  );
  const scope = await ensureSessionOutputDirectory(
    workspace,
    sessionId,
    taskKeyCandidate,
  );
  materialized = artifactSources(
    workspace,
    scope.taskKey,
    input.demand,
    materialized,
    (await new WorkStore(workspace).forSession(sessionId))?.work_key,
  );
  const effectiveDemand =
    input.demand.trim() === "" ? scope.taskKey : input.demand;
  const attachments = planningContextsFromMaterialized(
    workspace,
    scope.taskKey,
    input.attachmentPaths,
    materialized,
  );
  const result = await prepareDispatchEvidenceInputCoordinated(
    {
      ...input,
      workspacePath: workspace,
      sessionId,
      taskKey: scope.taskKey,
      demand: effectiveDemand,
    },
    materialized,
  );
  return {
    ...result,
    taskKey: scope.taskKey,
    sessionName: scope.sessionName,
    attachments,
  };
}

/** Converts once, freezes the verified package, and returns the same readable content used for planning. */
export async function prepareTaskSubmissionInput(input: {
  workspacePath: string;
  sessionId: string;
  taskKey: string;
  demand: string;
  attachmentPaths: string[];
  frozenAt: string;
  telemetry?: LocalTelemetry;
}): Promise<
  DispatchEvidencePreparationResult & {
    attachments: PlanningAttachmentContext[];
  }
> {
  const workspace = resolve(input.workspacePath);
  const sessionId = sessionIdOf(input.sessionId);
  if (
    input.attachmentPaths.length > MAX_ATTACHMENT_COUNT ||
    new Set(input.attachmentPaths).size !== input.attachmentPaths.length
  ) {
    throw new Error("冻结输入附件数量无效或存在重复");
  }
  const materialized = await materializeAttachments(
    workspace,
    sessionId,
    input.attachmentPaths,
  );
  const attachments = planningContextsFromMaterialized(
    workspace,
    input.taskKey,
    input.attachmentPaths,
    materialized,
  );
  const result = await prepareDispatchEvidenceInputCoordinated(
    input,
    materialized,
  );
  return { ...result, attachments };
}

const childWorkBindings = new Map<string, { workspace: string; key: string }>();
/** Only user-readable summaries; injection blocks, URL queries and credentials never enter the detail journal. */
function executionSummary(text: string) {
  return text.replace(/<promax-work>[\s\S]*?(?:<\/promax-work>|$)/gu, "")
    .replace(/Bearer\s+\S+|(?:sk-|sk_)[\w-]+/giu, "[redacted]")
    .replace(/((?:api[_-]?key|token|secret|password|authorization)["']?\s*[=:]\s*["']?)[^\s,;"']+/giu, "$1[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/gu, (value) => { try { const u = new URL(value); u.username = ""; u.password = ""; u.search = ""; u.hash = ""; return u.href; } catch { return "[URL]"; } })
    .replace(/运行时完整性闸门[^\n]*/gu, "")
    .slice(0, 4000);
}
const activeWorkChildren = new Set<string>();
const pendingWorkContinuations = new Set<string>();
const pendingJudgeDispatches = new Map<string, string>();
const endedWorkChildren = new Set<string>();
/**
 * A coordinator continuation temporarily reserves its child while the dispatch runs. Only the call that made the
 * reservation may release it, and only when that call did not really deliver a turn: reading a stored result or a
 * blocked/unknown outcome must not keep an ended member "running" nor clear a member that is genuinely working.
 */
interface ContinuationReservation {
  id: string; wasEnded: boolean; parent: string; workspace: string; key: string; accepted?: string;
  ready: Promise<void>; admit: () => void; authority?: string;
}
const continuationAuthority = (round: WorkRound | undefined) => JSON.stringify([round?.task_key, round?.revision, round?.phase, round?.execution_version, round?.member_seq]);
const continuationReservations = new Map<string, ContinuationReservation>();
const continuationOwners = new Map<string, ContinuationReservation>();
// Native residency epoch, not a tool call: a late end from an earlier activation cannot end its successor.
const childRunIds = new Map<string, string>();
const continuationReservationKey = (exec: { callId?: string; arguments?: unknown; agent?: unknown }) => {
  const header = (exec.agent as { session?: { header?: { id?: string } } } | undefined)?.session?.header;
  if (!header?.id) return undefined;
  const callId = typeof exec.callId === "string" && exec.callId ? exec.callId : undefined;
  const target = (exec.arguments as { subagent_id?: unknown } | undefined)?.subagent_id;
  return callId ? `${header.id}\u0000${callId}` : `${header.id}\u0000unkeyed:${typeof target === "string" ? target : ""}`;
};
const releaseContinuationReservation = (reservation: ContinuationReservation) => {
  if (continuationOwners.get(reservation.id) !== reservation) return;
  continuationOwners.delete(reservation.id);
  reservation.admit();
  if (reservation.accepted) return; // Inbox acceptance belongs to the child, even when the caller was cancelled.
  activeWorkChildren.delete(reservation.id);
  if (reservation.wasEnded) endedWorkChildren.add(reservation.id);
};
const takeContinuationReservation = (exec: unknown) => {
  const key = continuationReservationKey(exec as { callId?: string });
  if (!key) return undefined;
  const reservation = continuationReservations.get(key);
  if (reservation) continuationReservations.delete(key);
  return reservation;
};
/** Accepts canonical tool values only, never assistant text claiming a child identity. */
export async function recordWorkChild(
  exec: DispatchToolExecution,
  result: { isError: boolean; value?: unknown },
) {
  const header = exec.agent?.session.header;
  if (!header?.cwd || header.origin === "subagent" || result.isError) return;
  const value = result.value;
  if (
    !value ||
    typeof value !== "object" ||
    !("kind" in value) ||
    value.kind !== "continuable" ||
    !("subagentId" in value) ||
    typeof value.subagentId !== "string"
  )
    return;
  const childId = value.subagentId;
  const store = new WorkStore(header.cwd),
    work = await store.forSession(header.id);
  if (!work) return;
  childWorkBindings.set(childId, { workspace: store.workspace, key: work.work_key });
  await serializeWork(store.workspace, async () => {
    const round = await store.round(work.work_key);
    if (
      !round?.task_key ||
      round.source === "proposal" ||
      round.phase === "ended" ||
      (!work.deliverables.some((d) => d.member_id === exec.name) &&
        exec.name !== "quality_judge")
    )
      return;
    await store.writeRound(work.work_key, {
      ...round,
      children: { ...round.children, [childId]: exec.name },
    });
    if (exec.name === "quality_judge") await store.bindJudge(work.work_key, childId);
    if (!endedWorkChildren.has(childId)) activeWorkChildren.add(childId);
  });
  await store.executionEvent(work.work_key, childId, { id: `dispatch:${childId}`, at: new Date().toISOString(), kind: "dispatch", text: `${ROLE_NAMES[exec.name] ?? exec.name} · ${(await store.round(work.work_key))?.turn.deliverables.join("、") ?? "本次授权任务"}` });
}
const READ_ONLY_TOOLS = ["read", "glob", "grep", "ls", "find", "promax_read_context", RATING_FACTS_TOOL];
/** Business members granted retrieval by the published team (PRX-006 “全员 web”); fetched results are frozen as SRC-* before use. The Judge never researches. */
const WEB_MEMBERS: ReadonlySet<string> = new Set(["customer_research", "product_discovery", "requirement_management", "solution_design", "requirement_review", "user_analysis"]);
const MEMBER_WORK_TOOLS = ["report", "skill", "todo_write", "promax_usage_report", "bash", "write", "edit"];
/**
 * Role- and phase-specific tool authorization for a bound member. Retrieval, skills and structured submission are
 * explicitly allowed by duty; sibling dispatch, direct employee questions and cross-role submissions stay denied.
 * Write paths are still checked separately against the authorized snapshot closure.
 */
export function memberToolDenial(
  member: string,
  round: Pick<WorkRound, "phase" | "protocol">,
  name: string,
): string | undefined {
  const role = ROLE_NAMES[member] ?? member;
  if (name in ROLE_NAMES || ["send_message", "interrupt_agent", "list_agents", "ask_user_question"].includes(name))
    return "业务成员不得调用同级成员、直接询问员工或绕过父工作授权；阶段回报仅用原生 report";
  if (name === WORK_PROPOSAL_TOOL || name === REPAIR_PLAN_TOOL) return "行动提议和返修安排只由主 Agent 提交";
  if (READ_ONLY_TOOLS.includes(name)) return undefined;
  if (member === "quality_judge") {
    if (name === CHECK_RESULT_TOOL)
      return round.phase === "checking" ? undefined : "当前不是检查阶段，不能提交检查结果";
    if (name === "write" || name === "edit")
      return round.protocol === 2 ? "检查结果只通过 promax_check_result 提交，报告由程序渲染" : undefined;
    if (name === "report") return undefined;
    return `独立检查只允许读取被审材料并提交检查结果，不允许调用 ${name}`;
  }
  if (name === CHECK_RESULT_TOOL) return "检查结果只由独立检查提交";
  if (name === MEMBER_RECEIPT_TOOL)
    return round.phase === "checking" ? "检查阶段不能提交成果回执" : undefined;
  if (MEMBER_WORK_TOOLS.includes(name)) return undefined;
  if (name === "web_search" || name === "web_fetch")
    return WEB_MEMBERS.has(member) ? undefined : `${role}的职责不包含联网检索或抓取`;
  if (member === "requirement_management" && (name === "promax_lark_cli" || FEISHU_TOOL_MAPPINGS.some((m) => m.openClawTool === name)))
    return undefined;
  return `工具 ${name} 不在${role}当前阶段的许可范围内`;
}
function blockedFiles(card: WorkCard, round: WorkRound) {
  return new Set(card.pending.filter((p) => p.blocking === true).flatMap((p) => p.artifact ? [p.artifact] : p.node_id ? card.spine?.nodes.filter((n) => n.id === p.node_id || n.depends_on?.includes(p.node_id!)).flatMap((n) => n.filenames) ?? [] : round.turn.deliverables));
}
/** Blocks every planning-stage tool and enforces the immutable confirmed member allowlist during execution. */
export async function enforceDispatchPlanTool(
  root: string,
  exec: DispatchToolExecution,
  next: () => Promise<unknown>,
  policyVersion = BUNDLE_VERSION,
): Promise<unknown> {
  const browserDenial = browserCommandReason(exec.name, exec.arguments);
  if (browserDenial) {
    const header = exec.agent?.session.header;
    if (header?.cwd) {
      const store = new WorkStore(header.cwd),
        work = await store.forSession(header.parentSession ?? header.id);
      if (work) {
        const round = await store.round(work.work_key);
        if (round)
          await store.writeRound(work.work_key, {
            ...round,
            unverified: [
              ...round.unverified,
              { item: exec.name, reason: browserDenial },
            ],
          });
      }
    }
    return { kind: "deny", reason: browserDenial };
  }
  const frozenInputDenial = frozenInputMutationReason(exec);
  if (frozenInputDenial !== undefined) {
    await recordPolicyDenial(exec, frozenInputDenial, policyVersion);
    return { kind: "deny", reason: frozenInputDenial };
  }
  if (exec.agent === undefined) return next();
  if (exec.agent.session.header.origin === "subagent") {
    const header = exec.agent.session.header;
    if (!header.cwd || !header.parentSession)
      return { kind: "deny", reason: "成员缺少真实父工作绑定" };
    const store = new WorkStore(header.cwd),
      work = await store.forSession(header.parentSession);
    if (work) {
      const round = await store.round(work.work_key);
      if (
        !round?.task_key ||
        round.source === "proposal" ||
        round.phase === "ended"
      )
        return { kind: "deny", reason: "父工作当前没有执行授权" };
      let member = round.children?.[header.id];
      const childCtx = (exec.agent as unknown as { ctx?: ChildAgentContext })
        .ctx;
      if (!member && childCtx) {
        // The child's first tool call can precede the parent's dispatch result; bind from the program-assembled persona.
        try {
          const resolved = await childPromaxMemberId(childCtx);
          await serializeWork(store.workspace, async () => {
            const latest = await store.round(work.work_key);
            if (!latest || latest.task_key !== round.task_key) return;
            await store.writeRound(work.work_key, {
              ...latest,
              children: { ...latest.children, [header.id]: resolved },
            });
          });
          if (!endedWorkChildren.has(header.id))
            activeWorkChildren.add(header.id);
          member = resolved;
        } catch {
          member = undefined;
        }
      }
      if (
        !member ||
        !(
          round.allowed_members ??
          workMembers(round.turn.deliverables, {
            artifacts: work.deliverables.map((d) => ({
              relativePath: d.filename,
              producedBy: d.member_id,
            })),
          })
        ).includes(member)
      )
        return {
          kind: "deny",
          reason: "子会话不是当前执行阶段获准的真实责任成员",
        };
      const denial = memberToolDenial(member, round, exec.name);
      if (denial) return { kind: "deny", reason: denial };
      const args = objectRow(exec.arguments ?? {}, "成员工具参数");
      if (["write", "edit"].includes(exec.name)) {
        const path = String(args.path ?? args.file_path ?? "");
        const target = resolve(header.cwd, path);
        if (
          round.phase === "checking" &&
          target !==
            resolve(
              header.cwd,
              `.任务/${round.task_key}/判定-r${round.judge_round ?? 1}.md`,
            )
        )
          return { kind: "deny", reason: "检查阶段只允许本轮判定报告写路径" };
        if (
          round.phase !== "checking" &&
          !(round.phase === "repairing" && round.repair_plan ? round.repair_plan.assignments.filter((a) => a.member === member).flatMap((a) => a.files) : round.turn.deliverables).some(
            (filename) =>
              work.deliverables.some(
                (d) => d.filename === filename && d.member_id === member,
              ) &&
              target ===
                resolve(
                  header.cwd!,
                  `.任务/${round.task_key}/产物快照/${filename}`,
                ),
          )
        )
          return { kind: "deny", reason: "业务成果只能写授权成果快照闭集" };
      }
    }
    return next();
  }
  const sessionId = sessionIdOf(exec.agent.session.header.id);
  const cwd = exec.agent.session.header.cwd;
  if (cwd) {
    const store = new WorkStore(cwd),
      work = await store.forSession(sessionId);
    if (work) {
      await settleStructuredCommits(store.workspace);
      const round = await store.round(work.work_key);
      if (
        !round ||
        round.source === "proposal" ||
        !round.task_key ||
        round.phase === "ended"
      ) {
        if (READ_ONLY_TOOLS.includes(exec.name) || exec.name === WORK_PROPOSAL_TOOL) return next();
        if (exec.name === MEMBER_RECEIPT_TOOL || exec.name === CHECK_RESULT_TOOL)
          return { kind: "deny", reason: "成果回执和检查结果只由执行中的成员提交" };
        return {
          kind: "deny",
          reason:
            "现在是讨论阶段，还没有开始执行。若员工要的是明确成果，在结构块中用 intent=execute 提出，程序会显示倒计时并自动开始；不要对员工说被拒绝或请求授权。",
        };
      }
      const manifest = taskExecutionManifestOf(
        YAML.parse(
          await readFile(
            join(cwd, taskPaths(cwd, round.task_key).manifest),
            "utf8",
          ),
        ),
        round.task_key,
      );
      const allowed =
        round.allowed_members ??
        manifest.spec.members_confirmed.filter((m) => m !== "quality_judge");
      const blocked = blockedFiles(work, round);
      const dispatchId = String((exec as { callId?: string }).callId ?? `${exec.name}:${exec.agent.session.events?.at(-1)?.seq ?? 0}`);
      const dispatch = async () => {
        const reservation = `${cwd}:${work.work_key}`;
        if (exec.name === "quality_judge") {
          // Admission may just have moved generating -> checking and restored the prior group binding.
          const current = await store.round(work.work_key);
          const existing = current?.review_group ? (await store.reviews(work.work_key)).bindings[current.review_group]?.session_id : undefined;
          if (existing && !(await hasDispatchRecord(exec, policyVersion))) return { kind: "deny", reason: `该成果组已有Judge，请用 send_message 续接 ${existing}，请求 ${current?.review_request}；不新建会话` };
          // The durable tools/execute reservation shares an equivalent concurrent dispatch.
          pendingJudgeDispatches.set(reservation, dispatchId);
        }
        try {
          await store.observe(work.work_key, { id: `admitted:${dispatchId}`, kind: "dispatch_admitted", at: new Date().toISOString(), task_key: round.task_key, call_id: dispatchId, member: exec.name === "send_message" ? round.children?.[String((exec.arguments as { subagent_id?: string })?.subagent_id)] : exec.name });
          const decision = await next();
          if (exec.name === "quality_judge" && (decision as { kind?: string } | undefined)?.kind === "deny") pendingJudgeDispatches.delete(reservation);
          return decision;
        } catch (error) {
          if (exec.name === "quality_judge") pendingJudgeDispatches.delete(reservation);
          throw error;
        }
      };
      const requestedMember = exec.name === "send_message" ? round.children?.[String((exec.arguments as { subagent_id?: string })?.subagent_id)] : exec.name;
      const requestBlock = (await store.status(work.work_key)).faults.find((fault) => fault.task_key === round.task_key && fault.step === `request:${requestedMember}` && fault.class === "request_exhausted" && fault.state !== "resolved");
      if (requestBlock) return { kind: "deny", reason: requestBlock.history.at(-1)?.reason ?? "该成员请求恢复已耗尽，等待用户明确重试" };
      if (requestedMember && (manifest.spec.members_confirmed.includes(requestedMember) || requestedMember === "quality_judge"))
        await store.observe(work.work_key, { id: `decision:${dispatchId}`, kind: "dispatch_decided", at: new Date().toISOString(), task_key: round.task_key, call_id: dispatchId, member: requestedMember });
      // dsh deep-freezes tool arguments before this hook. Preserve prompt/message compatibility;
      // authoritative requirements are injected by system-prompt/assemble on every child turn,
      // including send_message continuations, never by rewriting a model's tool arguments.
      if (work.deliverables.some((d) => d.member_id === requestedMember && blocked.has(d.filename))) return { kind: "deny", reason: "该成果依赖尚未回答的决定性问题；等待回答，不自动采纳默认，不影响其他成员" };
      if (exec.name === REPAIR_PLAN_TOOL) return next();
      if (exec.name === "quality_judge" && round.review_group) {
        const binding = (await store.reviews(work.work_key)).bindings[round.review_group];
        if (binding?.session_id && !(await hasDispatchRecord(exec, policyVersion))) return { kind: "deny", reason: `该组已有独立检查会话，请用 send_message 续接 ${binding.session_id}，请求 ${round.review_request}` };
      }
      if (exec.name === "send_message") {
        const args = objectRow(exec.arguments ?? {}, "成员续接参数");
        const member =
          typeof args.subagent_id === "string"
            ? round.children?.[args.subagent_id]
            : undefined;
        const boundJudge = round.review_group ? (await store.reviews(work.work_key)).bindings[round.review_group]?.session_id : undefined;
        if (!member || (member === "quality_judge" ? args.subagent_id !== boundJudge : !manifest.spec.members_confirmed.includes(member)))
          return { kind: "deny", reason: "续接目标不是当前冻结任务中获准的真实子成员" };
        const id = String(args.subagent_id);
        if (activeWorkChildren.has(id) || pendingWorkContinuations.has(id)) {
          const owner = continuationOwners.get(id);
          if (owner) {
            await owner.ready; // Share only after the first call has completed normal admission.
            if (owner.authority && owner.authority === continuationAuthority(await store.round(work.work_key))) return next();
          }
          if (await hasDispatchRecord(exec, policyVersion)) return next();
          return { kind: "deny", reason: "该子会话仍在执行，等当前请求结束后续接，不能并发覆盖版本" };
        }
        pendingWorkContinuations.add(id);
        const reservationKey = continuationReservationKey(exec);
        let admit!: () => void;
        const ready = new Promise<void>((resolve) => { admit = resolve; });
        const reservation: ContinuationReservation = { id, wasEnded: endedWorkChildren.has(id), parent: exec.agent.session.header.id, workspace: cwd, key: work.work_key, ready, admit };
        if (reservationKey) {
          continuationReservations.set(reservationKey, reservation);
          continuationOwners.set(id, reservation);
        }
        const release = () => { if (reservationKey) continuationReservations.delete(reservationKey); releaseContinuationReservation(reservation); };
        try {
          if (member === "quality_judge" || !allowed.includes(member)) {
            const admission = await admitNextWorkMember(store, work.work_key, sessionId, exec.agent.session.events ?? [], member);
            if (!admission.admitted) {
              await store.observe(work.work_key, { id: `wait:${dispatchId}`, kind: "dispatch_wait", at: new Date().toISOString(), task_key: round.task_key, call_id: dispatchId, reason: admission.reason });
              release();
              return { kind: "deny", reason: admission.reason };
            }
          }
          reservation.authority = continuationAuthority(await store.round(work.work_key));
          endedWorkChildren.delete(id);
          activeWorkChildren.add(id);
          reservation.admit();
          try {
            const decision = await dispatch();
            if ((decision as { kind?: string } | undefined)?.kind === "deny") release();
            return decision;
          } catch (error) {
            release();
            throw error;
          }
        } finally { pendingWorkContinuations.delete(id); }
      }
      if (READ_ONLY_TOOLS.includes(exec.name) || exec.name === WORK_PROPOSAL_TOOL) return next();
      if (allowed.includes(exec.name)) return dispatch();
      if (
        exec.name === "quality_judge" ||
        manifest.spec.members_confirmed.includes(exec.name)
      ) {
        const admission = await admitNextWorkMember(
          store,
          work.work_key,
          sessionId,
          exec.agent.session.events ?? [],
          exec.name,
        );
        if (admission.admitted) return dispatch();
        await store.observe(work.work_key, { id: `wait:${dispatchId}`, kind: "dispatch_wait", at: new Date().toISOString(), task_key: round.task_key, call_id: dispatchId, reason: admission.reason });
        return { kind: "deny", reason: admission.reason };
      }
      return {
        kind: "deny",
        reason:
          "执行期间主 Agent 只调用程序通知的成员；不需要运行命令、计算哈希或直接写成果，这些由程序和成员完成。",
      };
    }
  }
  const confirmed = await optionalDispatchPlanControl(
    dispatchPlanPath(root, sessionId, "confirmed"),
    "confirmed",
  );
  if (confirmed !== undefined) {
    const roster = confirmed.spec.roster_member_ids;
    const allowed = confirmed.spec.confirmed_member_ids ?? [];
    if (roster.includes(exec.name) && !allowed.includes(exec.name)) {
      return {
        kind: "deny",
        reason: `成员 ${exec.name} 不在用户已确认的调度名单中`,
      };
    }
    if (roster.includes(exec.name)) {
      try {
        const cwd = exec.agent.session.header.cwd;
        const events = exec.agent.session.events;
        if (
          typeof cwd !== "string" ||
          cwd.trim() === "" ||
          events === undefined
        )
          throw new Error("成员派发缺少当前工作区或执行消息");
        const execution = executionInputOf(events, confirmed);
        await prepareDispatchEvidenceInput({
          workspacePath: cwd,
          sessionId,
          taskKey: execution.taskKey,
          demand: execution.demand,
          attachmentPaths: execution.attachmentPaths,
          frozenAt: confirmed.spec.confirmed_at!,
        });
      } catch (error) {
        return {
          kind: "deny",
          reason: `成员派发前输入准备失败：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    return next();
  }
  const planning = await optionalDispatchPlanControl(
    dispatchPlanPath(root, sessionId, "planning"),
    "planning",
  );
  if (planning !== undefined)
    return {
      kind: "deny",
      reason: "调度计划尚未由用户确认；规划阶段禁止调用任何工具或启动成员",
    };
  return next();
}

const dispatchCompletionAttempts = new Map<string, number>();

function dispatchedMemberName(event: DispatchSessionEvent, children: Record<string, string> = {}): string | undefined {
  if (
    event.type !== "tool/call" ||
    typeof event.data !== "object" ||
    event.data === null ||
    Array.isArray(event.data)
  )
    return undefined;
  const data = event.data as Record<string, unknown>;
  if (data.name === "send_message") {
    const args = data.arguments as { subagent_id?: string } | undefined;
    return args?.subagent_id ? children[args.subagent_id] : undefined;
  }
  return typeof data.name === "string" ? data.name : undefined;
}

/** Prevents settlement until the manifest's business files and independent Judge report exist on disk. */
export async function enforceConfirmedDispatchCompleteness(
  root: string,
  payload: DispatchTurnStopping,
  telemetry?: LocalTelemetry,
  uploader?: TraceUploader,
): Promise<void> {
  const { agent, turn, signal } = payload;
  if (agent.session.header.origin === "subagent") return;
  signal.throwIfAborted();
  const sessionId = sessionIdOf(agent.session.header.id);
  const confirmed = await optionalDispatchPlanControl(
    dispatchPlanPath(root, sessionId, "confirmed"),
    "confirmed",
  );
  if (agent.session.header.cwd) {
    const store = new WorkStore(agent.session.header.cwd),
      work = await store.forSession(sessionId);
    if (work) {
      await completeWorkExecution(payload, store, work.work_key, telemetry, uploader);
      return;
    }
  }
  if (confirmed === undefined) return;
  const required = confirmed.spec.confirmed_member_ids ?? [];
  // Planning is runtime-tool-locked, so a matching call anywhere in this
  // session belongs to the confirmed execution. Once complete, later chat
  // turns must not re-dispatch the team.
  const dispatched = new Set(
    agent.session.events
      .map((event) => dispatchedMemberName(event))
      .filter((name): name is string => name !== undefined),
  );
  const missingBusiness = required.filter(
    (memberId) => memberId !== "quality_judge" && !dispatched.has(memberId),
  );
  const attemptKey = `${sessionId}\0${String(turn)}`;
  let instruction =
    missingBusiness.length === 0
      ? ""
      : `用户确认的业务成员尚有 ${missingBusiness.join("、")} 未派单。现在只调用这些遗漏成员；不得调用名单外成员，也不得直接结束。`;
  const cwd = agent.session.header.cwd;
  if (typeof cwd !== "string" || cwd.trim() === "")
    throw new Error("运行完整性检查缺少当前工作区");
  const execution = executionInputOf(agent.session.events, confirmed);
  const files = await readTaskRunFiles(cwd, {
    sessionId,
    taskKey: execution.taskKey,
  });
  if (!taskPaths(cwd, execution.taskKey).modern) return;
  if (files.cancellation !== "running") {
    dispatchCompletionAttempts.delete(attemptKey);
    return;
  }
  const missingFiles = files.artifactStates.filter((file) => !file.nonEmpty);
  if (instruction === "" && missingFiles.length > 0) {
    // A background member call may settle after the coordinator's current
    // turn. Keep the task open on disk and let that settlement wake the
    // coordinator instead of prematurely dispatching Judge or duplicating work.
    dispatchCompletionAttempts.delete(attemptKey);
    return;
  }
  const businessMemberIds = required.filter(
    (memberId) => memberId !== "quality_judge",
  );
  const artifactPaths = files.artifactStates.map((file) => file.path);
  const repair = await optionalTaskJudgeRepairControl(
    cwd,
    execution.taskKey,
    sessionId,
  );
  if (instruction === "" && repair?.state === "passed") {
    await settleTaskRun(cwd, files, "completed", telemetry);
    dispatchCompletionAttempts.delete(attemptKey);
    return;
  } else if (instruction === "" && repair?.state === "exhausted") {
    await settleTaskRun(cwd, files, "failed", telemetry);
    dispatchCompletionAttempts.delete(attemptKey);
    return;
  } else if (
    instruction === "" &&
    repair === undefined &&
    ["pass", "force_released"].includes(files.judge.state)
  ) {
    await settleTaskRun(cwd, files, "completed", telemetry);
    dispatchCompletionAttempts.delete(attemptKey);
    return;
  } else if (
    instruction === "" &&
    repair === undefined &&
    ["appealed", "human_required"].includes(files.judge.state)
  ) {
    await settleTaskRun(cwd, files, "failed", telemetry);
    dispatchCompletionAttempts.delete(attemptKey);
    return;
  } else if (instruction === "" && repair?.state === "repairing") {
    const currentArtifacts = await artifactFingerprints(cwd, artifactPaths);
    const everyArtifactRegenerated = artifactPaths.every(
      (path) => currentArtifacts[path] !== repair.artifactFingerprints[path],
    );
    if (!everyArtifactRegenerated) {
      dispatchCompletionAttempts.delete(attemptKey);
      return;
    }
    const judging: TaskJudgeRepairControl = {
      ...repair,
      state: "judging",
      artifactFingerprints: currentArtifacts,
      judgeFingerprint: await pathFingerprint(cwd, files.judge.path),
      updatedAt: new Date().toISOString(),
    };
    await writeTaskJudgeRepairControl(cwd, judging);
    instruction = `第 ${String(judging.round)}/${String(judging.maxRounds)} 轮业务成员已重新产出。现在调用 quality_judge 只从 ${files.manifestPath} 进入，复判登记产物并覆盖 ${files.judge.path}；报告最后一行必须逐字使用“最终判定：PASS”或“最终判定：FAIL”。`;
  } else if (instruction === "" && repair?.state === "judging") {
    const currentJudgeFingerprint = await pathFingerprint(
      cwd,
      files.judge.path,
    );
    if (currentJudgeFingerprint === repair.judgeFingerprint) {
      dispatchCompletionAttempts.delete(attemptKey);
      return;
    }
    if (files.judge.state === "pass") {
      await writeTaskJudgeRepairControl(cwd, {
        ...repair,
        state: "passed",
        judgeFingerprint: currentJudgeFingerprint,
        updatedAt: new Date().toISOString(),
      });
      await settleTaskRun(cwd, files, "completed", telemetry);
      dispatchCompletionAttempts.delete(attemptKey);
      return;
    }
    const reason =
      files.judge.reason ?? "Judge 复判仍未通过，报告未提供可识别的具体理由。";
    const reasons = [...repair.reasons, reason].slice(-MAX_JUDGE_REPAIR_ROUNDS);
    if (repair.round >= repair.maxRounds) {
      await writeTaskJudgeRepairControl(cwd, {
        ...repair,
        state: "exhausted",
        reasons,
        judgeFingerprint: currentJudgeFingerprint,
        updatedAt: new Date().toISOString(),
      });
      await settleTaskRun(cwd, files, "failed", telemetry);
      dispatchCompletionAttempts.delete(attemptKey);
      return;
    }
    const nextRepair: TaskJudgeRepairControl = {
      ...repair,
      state: "repairing",
      round: repair.round + 1,
      reasons,
      artifactFingerprints: await artifactFingerprints(cwd, artifactPaths),
      judgeFingerprint: currentJudgeFingerprint,
      updatedAt: new Date().toISOString(),
    };
    await writeTaskJudgeRepairControl(cwd, nextRepair);
    instruction = `第 ${String(nextRepair.round)}/${String(nextRepair.maxRounds)} 轮返修开始。Judge 理由：${reason}。现在只让业务成员 ${businessMemberIds.join("、")} 基于冻结输入与该理由重写各自产物；不得修改 ${files.inputManifestPath} 或其 sources。完成后等待成员结算，不得提前调用 Judge。`;
  } else if (instruction === "" && files.judge.state === "fail") {
    const reason =
      files.judge.reason ??
      "Judge 首次判定未通过，报告未提供可识别的具体理由。";
    const firstRepair: TaskJudgeRepairControl = {
      taskKey: execution.taskKey,
      sessionId,
      state: "repairing",
      round: 1,
      maxRounds: MAX_JUDGE_REPAIR_ROUNDS,
      reasons: [reason],
      artifactFingerprints: await artifactFingerprints(cwd, artifactPaths),
      judgeFingerprint: await pathFingerprint(cwd, files.judge.path),
      updatedAt: new Date().toISOString(),
    };
    await writeTaskJudgeRepairControl(cwd, firstRepair);
    instruction = `第 1/${String(firstRepair.maxRounds)} 轮返修开始。Judge 理由：${reason}。现在只让业务成员 ${businessMemberIds.join("、")} 基于冻结输入与该理由重写各自产物；不得修改 ${files.inputManifestPath} 或其 sources。完成后等待成员结算，不得提前调用 Judge。`;
  } else if (instruction === "" && !dispatched.has("quality_judge")) {
    instruction = `业务产物已全部落盘。现在让 quality_judge 只从 ${files.manifestPath} 进入，独立检查登记产物并写入 ${files.judge.path}；报告最后一行必须逐字使用“最终判定：PASS”或“最终判定：FAIL”。`;
  } else if (
    instruction === "" &&
    (!files.judge.nonEmpty || files.judge.state === "unverified")
  ) {
    if (!files.judge.nonEmpty) {
      dispatchCompletionAttempts.delete(attemptKey);
      return;
    }
    instruction = files.judge.nonEmpty
      ? `固定 Judge 报告 ${files.judge.path} 没有可识别的最终 verdict。现在调用 quality_judge 独立复核；报告最后一行必须逐字使用“最终判定：PASS”或“最终判定：FAIL”。`
      : `业务产物已落盘，但固定 Judge 报告 ${files.judge.path} 尚未产生。现在调用 quality_judge 独立检查 manifest 登记的产物并写入该文件。`;
  } else if (instruction === "") {
    dispatchCompletionAttempts.delete(attemptKey);
    return;
  }
  const attempts = (dispatchCompletionAttempts.get(attemptKey) ?? 0) + 1;
  dispatchCompletionAttempts.set(attemptKey, attempts);
  if (attempts > 2) {
    throw new Error(
      `任务磁盘产物或固定 Judge 仍未齐备，拒绝结束本轮：${instruction}`,
    );
  }
  agent.steer(
    createUserMessage({
      content: [
        {
          type: "text",
          text: `运行时完整性闸门：${instruction}`,
        },
      ],
      source: { kind: "plugin", plugin: "@promax/promax-bundle" },
    }),
  );
}

const ROLE_NAMES: Record<string, string> = {
  customer_research: "客户研究员",
  product_discovery: "竞品分析师",
  requirement_management: "需求管理员",
  solution_design: "方案设计师",
  requirement_review: "需求评审员",
  user_analysis: "数据分析师",
  quality_judge: "检查",
};

function employeeMessagesOf(events: readonly DispatchSessionEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type !== "user/message") return [];
    const data = event.data as {
      content?: Array<{ type?: string; text?: string }>;
      source?: { kind?: string };
    };
    if (data?.source?.kind !== "user") return [];
    return [
      (data.content ?? [])
        .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
        .join(""),
    ];
  });
}

/** Members get their own bounded brief; they never receive the coordinator's protocol. */
export function memberWorkContext(
  card: WorkCard,
  round: WorkRound | undefined,
  member: string | undefined,
): string {
  const role = member ? (ROLE_NAMES[member] ?? member) : "业务成员";
  const lines = [
    `## 本次工作简报（程序提供）`,
    `你是本次工作中的「${role}」，不是主 Agent：不输出 <promax-work> 结构块，不维护工作卡，不替员工确认任何事项。`,
    requirementsBrief(round?.effective_requirements ?? effectiveRequirements(card), round?.acceptance_baseline, round?.acceptance_scope),
    `主 Agent 理解的目标（非用户原话）：${card.goal || card.title}`,
    `材料索引（只表示已上传/解析，不等于已读或采用；正文按任务用 read 按需读取）：${JSON.stringify(card.materials.map(({ reads: _r, summary: _s, ...m }) => m))}`,
    `最小信息交接（成员声明、文件版本已核对；语义充分性仍须判断，来源正文按需读取）：${JSON.stringify(Object.values(round?.receipts ?? {}).filter((r) => r.handoff).map((r) => ({ member: r.member, filename: r.filename, sha256: r.sha256, input_version: r.input_version, ...r.handoff })))}`,
    `泛市场事实、样本统计可独立准备；依赖用户证据的段落只等待对应最小证据。共享索引/口径/计算证据，不群发完整报告。后到证据由主 Agent 安排受影响部分更新，不自行改变职责或跳过 Judge。`,
    `本次所属业务节点：${card.spine?.nodes.find((n) => n.id === round?.node_id)?.title ?? card.spine?.nodes.find((n) => n.filenames.some((f) => round?.turn.deliverables.includes(f)))?.title ?? "按本次工作目标"}`,
    `既有员工决定（当前有效；不重复提问；确有新版本/新情况写明原因）：${JSON.stringify(activeDecisions(card).map((d) => ({ question: d.question, answer: d.answer, artifact: d.artifact, location: d.location, decision_key: d.decision_key })))}`,
    `原话补充（历史摘要无原话时不作授权）：${card.confirmed.map(confirmedWords).join("；") || "无"}`,
    `本轮已采纳的跟进建议（计划口径，不代表已经执行；例如建议访谈不等于访谈已完成）：${(round?.task_key ? round.followed_suggestions ?? [] : card.suggestions?.filter((s) => s.state === "accepted").map((s) => s.text) ?? []).join("；") || "无"}。未采纳建议不作为硬条件；原始明确要求仍有效。`,
    `尚待员工决定（不得写成已确认）：${
      card.pending
        .filter((p) => p.timing !== "later")
        .map((p) => p.question)
        .join("；") || "无"
    }`,
  ];
  const protocol = round?.protocol === 2;
  if (round?.task_key)
    lines.push(
      `任务包：.任务/${round.task_key}/任务包.yml。来源只使用输入清单中程序编号的 SRC-*；工作卡摘要、任务书转述不是独立来源，不另编 SRC 编号。`,
    );
  if (protocol) lines.push(`输入版本（input_version）：${round!.execution_version ?? 0}`,
    "冻结评分材料：写首稿前调用 promax_rating_facts({source_id:清单SRC}) 取得程序计数、有效/无效定位及同源numeric_specs，用返回口径登记关键数值；不运行Python/bash或逐行心算。Judge使用同一只读入口核对程序事实，不因自己没有shell就否定程序已完成的哈希/复算。来源不足则保留缺口。版本替换时用 previous_source_id 比较清单内旧版，只改受影响统计、结论及必要交叉影响；不是趋势，不新增模板构成统计。",
    "简洁评分报告按用户原目标：评分分布与数据质量、主要反馈及来源举例、3条待验证建议、必要限制和查看入口；不强制长目录/全量record_id/真值表/额外趋势或模板统计。追溯和计算明细用已有结论关联/工具结果入口，不复制进正文。完整分析模式仍按适用规则。",
    "局部改文的evidence_links默认为patch：只提交受影响关联，未变项由程序校验正文依赖/来源/规格后续绑，不继承语义PASS。整组替换显式evidence_update={mode:'replace'}；撤回用{mode:'patch',withdraw:['CNL-...']}，空数组不表示清空。依赖失效项须定向补登记，不整篇返修。"
  );
  const hashes = round?.reviewed_hashes ?? {};
  if (member === "quality_judge" && round?.task_key && round.judge_round) {
    const scope = round.check_scope ?? "本次授权成果与工作卡已确认规则";
    if (protocol)
      lines.push(
        `本轮检查：第 ${round.judge_round} 轮；被审版本（程序计算）：${JSON.stringify(hashes)}；被审文件在 .任务/${round.task_key}/产物快照/。范围：${scope}。`,
        `本轮 review_request：${round.review_request ?? "旧协议未提供"}。必须原样提交；旧请求不得用于新回合。`,
        "有验收基准时同时提交 acceptance:{baseline_version,items:[{id,state:met|unmet|unverifiable,evidence}]}，严格覆盖程序给出的 scope IDs；unverified 给 requirement_ids 与 impact=blocking|non_blocking。必需项不可豁免，局部 PASS 不等于全任务完成。对照用户原始目标核查计划新增限制、基准遗漏与业务证据充分性；需求 SRC、模型 KB、编号和哈希不是产品事实的充分证据。",
        `先完成本轮全部适用必需项、旧问题及必要跨成果检查，再一次集中提交问题清单；不要发现一条就提前结束、让主Agent反复派修。建议项单列，不自动变成整篇返修；主Agent安排受影响修改，由原Judge逐项回查。检查结果只调用 promax_check_result 提交（verdict、issues、rechecks、review_request、unverified、decisions、input_version）。Judge 只评审，不分配成员、不决定返修次数。对旧问题逐项给出 rechecks（id/state=open|verified|unverifiable/evidence）；漏回不会关闭。${round.runtime_snapshot?.fields.team_revision.judge_contract === "citations-resolution-v1" ? "新合同：每条issue必须给basis=quoted并给本轮被审文件citations（file/version=current/line_start/line_end/quote），或basis=missing_required并给本次scope的requirement_ids及checked_artifacts；verified回查必须给resolution=fixed|false_positive及当前或原问题提出时issue_origin版本的citations。不得传路径/哈希；缺旧版保持unverifiable，历史旧合同不补填。" : "旧团队合同不要求新依据/关闭原因字段，不使用新字段自行升级。"}轮次、范围与被审版本由程序绑定，阅读报告由程序根据你提交的数据渲染；不要写报告文件，也不要手写 YAML。提交返回错误时按错误逐项修正后重新提交。`,
        `结论关联（如已登记）：.任务/${round.task_key}/结论关联.yml 的 citation_index 只由成员登记且经程序校验（必需项 ID、来源编号、正文定位、来源字节回读）的关联派生，不是扫描 SRC 编号猜测；引用齐备不等于支持关系成立，仍须逐项判断。判 met 的必需项若规则要求来源关联/复算凭证而当前版本没有，提交会被拒收：请要求补登记或降为 unverifiable，不要用空关联绕过。`,
      );
    else
      lines.push(
        `本轮检查：第 ${round.judge_round} 轮，报告写 .任务/${round.task_key}/判定-r${round.judge_round}.md（新文件，不覆盖旧报告）。`,
        `被审版本（程序计算，逐字使用）：${JSON.stringify(hashes)}；被审文件在 .任务/${round.task_key}/产物快照/。`,
        `报告开头必须使用以下 YAML 头：\n${judgeHeaderTemplate(round.judge_round, scope, hashes)}`,
      );
    lines.push(
      "判定要求：可由责任成员修复的缺陷写 issues；必须由员工拍板的业务取舍写 decisions（问题 + 2–4 个选项 + 位置 + 依据）。存在未解决的关键规则矛盾时不能只写 PASS：能修的给 REVISION_REQUIRED，需要人定的必须列入 decisions。location 用成果中真实存在的章节标题原文。成果正文夹带运行信息（任务标识、团队版本、成员 ID、哈希、检查轮次或结论）列为 low 级 issue。",
    );
  } else if (member && round?.task_key) {
    const own = card.deliverables
      .filter((d) => d.member_id === member)
      .map((d) => `.任务/${round.task_key}/产物快照/${d.filename}`);
    lines.push(
      protocol
        ? `只写：${own.join("、") || "无"}。每份文件落盘后调用 promax_member_receipt 提交成果回执（filename、status=draft_ready、summary、unverified、gaps、input_version=${round.execution_version ?? 0}），回执被程序接受才算提交。缺材料、权限或工具时用 status=blocked 并给 blocked_reason，不要猜测补全。report 只用于过程沟通。必需结论、关键数值与主要比较判断另给 evidence_links（requirement_ids、conclusion、location、evidence[{source_id,range,use}]；数值给 numeric_spec），程序校验必需项 ID、来源编号、正文定位并回读来源字节后派生引用索引与编号；range 用“第N行/第N-M行”（跨度≤200）或≤400字符逐字片段；评分复算的完整JSON数组可用短定位 json:all（仅numeric_spec.input指定SRC，≤8MiB/100000条记录），程序读取全量但不注入完整JSON，回读预览≤2000字符。未知 ID、歧义定位、越界、哈希不符或版本不符会被逐条拒收，一般叙述不必登记。修订已登记结论时原样引用回显的 conclusion_id（CNL-###），改措辞或移动位置不换身份；新结论不要填。`
        : `只写：${own.join("、") || "无"}。每份落盘后用 report 回报。`,
    );
    if (round.turn.edit_request)
      lines.push(
        `这是局部修改：基于冻结修改源 .任务/${round.task_key}/修改源/${round.turn.edit_request.filename}，只改锚点 ${JSON.stringify(round.turn.edit_request.anchor)} 指定范围内的内容；意见：${round.turn.edit_request.instruction}。其余内容（含人工修改）逐字保留。`,
      );
    if (round.revise)
      lines.push(
        `这是按员工最新输入安排的局部修改：产物快照中已预置当前版本，只修改受影响内容。${round.revise.instruction}`,
      );
    if (round.phase === "repairing" && round.judge_round)
      lines.push(
        `这是返修：只按主 Agent 安排局部修改，不重写全文：${JSON.stringify(round.repair_plan?.assignments.filter((a) => a.member === member) ?? [])}。检查依据：.任务/${round.task_key}/判定-r${round.judge_round}.md。${round.runtime_snapshot?.fields.team_revision.judge_contract === "citations-resolution-v1" ? "若原问题是误读且成果原文已正确，不为完成返修改错正文；用回执/最小交接给出原被审版反证与范围，交同组Judge复查。其它成立问题照常修改。" : ""}`, 
      );
    if (WEB_MEMBERS.has(member))
      lines.push(
        "联网检索或抓取的结果由运行时冻结为 SRC-* 后才能引用；工具不可用时在成果中如实写未验证，不把运行错误原文写进正文。",
      );
    lines.push(
      "成果正文面向业务读者：不写任务标识、团队版本、成员 ID、哈希、检查轮次或检查结论等运行信息，这些由程序记录在检查区。员工要简版或只要要点时控制篇幅：目标、范围、关键规则与流程、验收要点、待决定事项即可，不机械填满完整模板。",
    );
  }
  return lines.join("\n");
}

type WorkStep =
  | { kind: "wait"; reason: string }
  | {
      kind: "finish";
      progress: string;
      status: string;
      pending: PendingItem[];
      verdict?: JudgeReport["verdict"];
    }
  | {
      kind: "call";
      members: string[];
      next: WorkRound;
      progress: string;
      instruction: string;
    }
  | {
      kind: "halt";
      progress: string;
      status: string;
      pending: PendingItem[];
      step: string;
      reason: string;
    };
interface MemberFailure {
  seq: number;
  evidence: string;
  kind: "failed" | "declined" | "cancelled";
  reason: string;
}

function judgeHeaderTemplate(
  judgeRound: number,
  scope: string,
  hashes: Record<string, string>,
) {
  return `---\nreviewer: quality_judge\nround: ${judgeRound}\nverdict: <PASS|REVISION_REQUIRED|INCOMPLETE>\nscope: ${scope}\nreviewed_artifacts:\n${Object.entries(
    hashes,
  )
    .map(
      ([filename, sha256]) =>
        `  - filename: ${filename}\n    sha256: ${sha256}`,
    )
    .join(
      "\n",
    )}\nissues:\n  - id: <编号>\n    severity: <high|medium|low>\n    artifact: <文件名>\n    location: <成果中的真实章节标题或页面名>\n    evidence: <原始要求或证据>\n    impact: <影响>\n    owner_member_id: <责任成员>\n    fix: <修改要求>\nunverified:\n  - item: <未验证项>\n    reason: <原因>\ndecisions:\n  - id: <编号>\n    decision_key: <沿用已有业务决定标识或给出稳定标识>\n    node_id: <所属业务节点ID>\n    artifact: <受影响的成果文件名>\n    current_content: <对应原文摘录>\n    effect: <选择后修改的内容>\n    timing: <now或later>\n    question: <需要员工拍板的业务选择>\n    options: [<选项A>, <选项B>]\n    location: <位置>\n    evidence: <依据>\n---\n无问题时 issues: []；无未验证项 unverified: []；无待决定 decisions: []。`;
}

/**
 * The single program authority for what the running work may do next. Failures go through the persisted recovery
 * budget; nothing here finishes a run because an output could not be read.
 * `mode=admit` evaluates a coordinator call that is being made right now, so it never counts a missing result.
 */
async function planWorkStep(
  store: WorkStore,
  key: string,
  round: WorkRound,
  files: TaskRunFileSnapshot,
  calls: Set<string | undefined>,
  latestSeq: number,
  hashes: Record<string, string>,
  failed: ReadonlyMap<string, MemberFailure> = new Map(),
  lastCalls: ReadonlyMap<string, number> = new Map(),
  mode: "admit" | "settle" = "settle",
): Promise<WorkStep> {
  if (
    Object.keys(round.children ?? {}).some((id) => activeWorkChildren.has(id))
  )
    return { kind: "wait", reason: "成员仍在进行，完成后程序会通知下一步" };
  const role = (m: string) => ROLE_NAMES[m] ?? m;
  const at = new Date().toISOString();
  const protocol = round.protocol === 2;
  const phase = round.phase ?? "generating";
  const status = await store.status(key);
  const blockedRequest = status.faults.find((f) => f.task_key === round.task_key && f.class === "request_exhausted" && f.state !== "resolved");
  if (blockedRequest) return { kind: "wait", reason: blockedRequest.history.at(-1)?.reason ?? "请求恢复已耗尽，等待用户明确重试；已有草稿保留" };
  const blocking = blockedFiles(await store.read(key), round);
  const note = (step: string, cls: FaultClass, evidence: string, reason: string, strategy: string) =>
    store.noteFailure(key, {
      step,
      class: cls,
      evidence,
      reason,
      strategy,
      at,
      ...(round.task_key ? { task_key: round.task_key } : {}),
      resume: `${phase}${round.judge_round ? ` · 第 ${round.judge_round} 轮检查` : ""}${round.repair_round ? ` · 第 ${round.repair_round} 轮返修` : ""}`,
      runtime_version: BUNDLE_VERSION,
    });
  const recoverSeq = (members: string[]) => ({
    ...round.member_seq,
    ...Object.fromEntries(members.map((m) => [m, latestSeq])),
  });
  const retry = (id: string, question: string, basis: string): PendingItem => ({
    id,
    question,
    options: ["再试一次", "先保留现状，我来判断"],
    basis,
    source: "check",
  });
  const registered = Object.fromEntries(
    files.artifactStates.map((a) => [basename(a.path), a.memberId]),
  );
  const receiptFor = (filename: string) => {
    const r = round.receipts?.[filename];
    return r && r.phase === phase && r.repair_round === (round.repair_round ?? 0) ? r : undefined;
  };
  // Outputs paused by a high-impact correction, or blocked on the employee, never enter checking or become current.
  const excluded = new Set([
    ...blocking,
    ...(round.stale_files ?? []),
    ...status.alignments.filter((a) => a.state === "active").flatMap((a) => a.affects),
    ...files.artifactStates.map((a) => basename(a.path)).filter((f) => receiptFor(f)?.status === "blocked"),
  ]);
  if (phase === "generating" || phase === "repairing") {
    const owners =
      phase === "repairing"
        ? (round.allowed_members ?? [])
        : [...new Set(files.artifactStates.map((a) => a.memberId))];
    const scope = files.artifactStates.filter(
      (a) => owners.includes(a.memberId) && !excluded.has(basename(a.path)) && (phase !== "repairing" || !round.repair_plan || round.repair_plan.assignments.some((p) => p.member === a.memberId && p.files.includes(basename(a.path)))),
    );
    const retrying = new Map<string, string>();
    const broken = new Map<string, string>();
    const waiting: PendingItem[] = [];
    for (const [member, failure] of failed) {
      const own = scope.filter((a) => a.memberId === member).map((a) => basename(a.path));
      if (!own.length || failure.kind === "cancelled") continue;
      const cls: FaultClass = failure.kind === "declined" ? "member_declined" : "member_run_failed";
      let decision: "retry" | "wait" | "exhausted" = "retry";
      for (const f of own)
        decision = (await note(`file:${f}`, cls, failure.evidence, `${role(member)}${failure.kind === "declined" ? "没有接受任务" : "运行失败"}：${failure.reason}`, "带失败原因重新派给原责任成员，已落盘草稿保留")).decision;
      if (decision === "retry") retrying.set(member, `运行失败（${failure.reason}）`);
      else if (decision === "exhausted") broken.set(member, `运行失败：${failure.reason}`);
      else
        waiting.push(
          retry(`run-failed-${member}`, `${role(member)}没有完成本次成果（${failure.kind === "declined" ? "未接受任务" : "运行失败"}），要再试一次吗？`, failure.reason),
        );
    }
    const waitingMembers = new Set(waiting.map((w) => w.id.replace(/^run-failed-/u, "")));
    const incomplete = round.check_only
      ? []
      : scope.filter((a) => {
          const f = basename(a.path);
          if (!a.nonEmpty || !calls.has(a.memberId)) return !(protocol && receiptFor(f)?.status === "draft_ready" && receiptFor(f)?.sha256 === hashes[f]);
          if (!protocol) return false;
          const r = receiptFor(f);
          return !r || r.status !== "draft_ready" || r.sha256 !== hashes[f];
        });
    const toCall: string[] = [];
    const recovered: string[] = [];
    const notes: string[] = [];
    for (const member of [...new Set(incomplete.map((a) => a.memberId))]) {
      if (broken.has(member) || waitingMembers.has(member)) continue;
      if (retrying.has(member)) {
        toCall.push(member);
        recovered.push(member);
        notes.push(`${role(member)}上次${retrying.get(member)}`);
        continue;
      }
      const own = incomplete.filter((a) => a.memberId === member).map((a) => basename(a.path));
      if (!calls.has(member)) {
        // First dispatch, or a dispatch the coordinator was told about but never made.
        const told = round.notified?.[member];
        if (mode === "admit" || told === undefined || told >= latestSeq) {
          toCall.push(member);
          continue;
        }
        const decision = (await Promise.all(own.map((f) => note(`file:${f}`, "member_output_missing", `notcalled:${member}:${told}`, `已通知调用${role(member)}，但没有实际派发`, "再次要求主 Agent 按程序通知调用原责任成员")))).at(-1)!.decision;
        if (decision === "exhausted") broken.set(member, "多次通知后仍未派发");
        else {
          toCall.push(member);
          notes.push(`${role(member)}尚未派发`);
        }
        continue;
      }
      if (mode === "admit") continue;
      const missingFile = own.some((f) => !hashes[f]);
      const cls: FaultClass = missingFile ? "member_output_missing" : "member_receipt_missing";
      const reason = missingFile
        ? `${role(member)}已结束，但 ${own.filter((f) => !hashes[f]).join("、")} 没有落盘`
        : `${role(member)}已结束，但没有提交与当前文件一致的成果回执（${own.join("、")}）`;
      let decision: "retry" | "wait" | "exhausted" = "retry";
      for (const f of own)
        decision = (await note(`file:${f}`, cls, `${cls}:${member}:${lastCalls.get(member) ?? latestSeq}`, reason, missingFile ? "重新派给原责任成员完成落盘并提交回执" : "请原责任成员核对文件后调用 promax_member_receipt")).decision;
      if (decision === "exhausted") broken.set(member, reason);
      else {
        toCall.push(member);
        recovered.push(member);
        notes.push(reason);
      }
    }
    if (toCall.length)
      return {
        kind: "call",
        members: toCall,
        next: {
          ...round,
          phase,
          allowed_members: phase === "repairing" ? (round.allowed_members ?? toCall) : toCall,
          ...(recovered.length ? { member_seq: recoverSeq(recovered) } : {}),
        },
        progress: phase === "repairing" ? `返修中（${round.repair_round ?? 1}/2）` : "生成中",
        instruction: `${notes.length ? `自动恢复（同一故障最多 ${RECOVERY_LIMIT} 次）：${notes.join("；")}。` : ""}按已授权成果调用 ${toCall.join("、")}；只写本次成果快照，${protocol ? "文件落盘后由成员提交成果回执，" : "文件落盘即回报，"}不调用浏览器。`,
      };
    const inProgress = incomplete.some((a) => !broken.has(a.memberId) && !waitingMembers.has(a.memberId));
    if (inProgress)
      return { kind: "wait", reason: phase === "repairing" ? "返修成员尚未完成" : "成员尚未完成" };
    if (broken.size) {
      const touched = Object.entries(hashes).some(([f, sha]) => round.reviewed_hashes?.[f] !== undefined && round.reviewed_hashes[f] !== sha);
      return {
        kind: "halt",
        step: `file:${scope.find((a) => broken.has(a.memberId)) ? basename(scope.find((a) => broken.has(a.memberId))!.path) : "unknown"}`,
        reason: [...broken].map(([m, r]) => `${role(m)}：${r}`).join("；"),
        progress: `待修复 · ${[...broken.keys()].map(role).join("、")}已自动恢复 ${RECOVERY_LIMIT} 次仍未完成${phase === "repairing" ? ` · ${touched ? "草稿在返修中途有改动" : "保留上一版草稿"}` : ""} · 已有草稿保留 · 未检查`,
        status: "草稿 · 待修复 · 未检查",
        pending: waiting,
      };
    }
    if (waiting.length)
      return {
        kind: "finish",
        progress: `部分完成 · ${[...waitingMembers].map(role).join("、")}需要你决定是否重试 · 已有草稿保留 · 未检查`,
        status: "草稿 · 未检查",
        pending: waiting,
      };
  }
  if (blocking.size) return { kind: "wait", reason: "独立工作已推进；其余成果等待决定性问题回答，不自动采纳默认" };
  if (round.acceptance_baseline && round.execution_digest !== await store.requirements(key)) return { kind: "finish", progress: "部分完成 · 执行期间要求已变化 · 原版草稿保留，需按新基准复核", status: "草稿 · 要求已变化", pending: [] };
  const scopeText = round.check_scope ?? "本次授权成果与工作卡已确认规则";
  const checkable = Object.fromEntries(Object.entries(hashes).filter(([f]) => !excluded.has(f)));
  if (phase === "checking" && round.check_results?.[String(round.judge_round)] &&
    Object.entries(round.reviewed_hashes ?? {}).some(([file, sha]) => hashes[file] !== sha)) {
    const { reviewed_hashes: _obsoleteHashes, ...redo } = round;
    return { kind: "call", members: [], next: { ...redo, phase: "generating", allowed_members: [] },
      progress: "被审草稿已变化 · 旧检查不适用于当前版本，继续生成或复查", instruction: "被审草稿在检查结果接收后变化。旧结论仅作历史；按当前授权成果回执继续工作，变化的草稿必须重新独立检查，不得交付旧版。" };
  }
  if (round.phase !== "checking") {
    if (!Object.keys(checkable).length)
      return {
        kind: "finish",
        progress: excluded.size ? "部分完成 · 受影响或待补充的成果暂停，未检查" : "部分完成 · 部分成果未产出 · 未检查",
        status: "草稿 · 未检查",
        pending: [],
      };
    const judgeRound = (round.judge_round ?? 0) + 1;
    const reportPath = taskPathFromTemplate(
      ".任务/{task_key}/判定-r{round}.md",
      round.task_key!,
      true,
      judgeRound,
    );
    return {
      kind: "call",
      members: ["quality_judge"],
      next: {
        ...round,
        phase: "checking",
        allowed_members: ["quality_judge"],
        judge_round: judgeRound,
        reviewed_hashes: checkable,
        check_scope: scopeText,
        requirements_digest: round.execution_digest ?? await store.requirements(key),
        event_seq: latestSeq,
      },
      progress: "检查中 · 草稿可查看",
      instruction: protocol
        ? `业务草稿已落盘并回执。现在调用 quality_judge 独立检查一次（第 ${judgeRound} 轮）；检查成员用 promax_check_result 提交结果，被审版本由程序绑定：${JSON.stringify(checkable)}。复查上轮未关闭问题、实际变更及相关成果一致性。`
        : `业务草稿已落盘。现在调用 quality_judge 独立检查一次，报告写 ${reportPath}；round=${judgeRound}；scope=${scopeText}；被审版本哈希由程序计算：${JSON.stringify(checkable)}。复查上轮未关闭问题、实际变更及相关成果一致性。报告开头使用以下 YAML 头结构（填写实际值；新情况重开已答问题时另加 reopen_reason，不能重复问已答事项）：\n${judgeHeaderTemplate(judgeRound, scopeText, checkable)}`,
    };
  }
  const judgeRound = round.judge_round ?? 1;
  const reportPath = taskPathFromTemplate(
    ".任务/{task_key}/判定-r{round}.md",
    round.task_key!,
    true,
    judgeRound,
  );
  const reviewed = round.reviewed_hashes ?? {};
  const judgeFailure = round.check_results?.[String(judgeRound)] ? undefined : failed.get("quality_judge");
  if (judgeFailure && judgeFailure.kind !== "cancelled" && mode === "settle") {
    const decision = (await note("check", judgeFailure.kind === "declined" ? "member_declined" : "check_run_failed", judgeFailure.evidence, `独立检查${judgeFailure.kind === "declined" ? "没有接受任务" : "运行失败"}：${judgeFailure.reason}`, "重新派独立检查核对同一版本")).decision;
    if (decision === "retry")
      return {
        kind: "call",
        members: ["quality_judge"],
        next: { ...round, member_seq: recoverSeq(["quality_judge"]) },
        progress: "检查中 · 自动恢复",
        instruction: `自动恢复（同一故障最多 ${RECOVERY_LIMIT} 次）：独立检查上次运行失败（${judgeFailure.reason}）。重新调用 quality_judge 检查第 ${judgeRound} 轮的同一版本。`,
      };
    if (decision === "wait")
      return {
        kind: "finish",
        progress: "部分完成 · 检查未完成 · 草稿保留 · 未检查",
        status: "草稿 · 未检查",
        pending: [retry(`check-failed-${judgeRound}`, "独立检查没有完成，要重新检查吗？", judgeFailure.reason)],
      };
    return {
      kind: "halt",
      step: "check",
      reason: `独立检查连续运行失败：${judgeFailure.reason}`,
      progress: `待修复 · 独立检查已自动恢复 ${RECOVERY_LIMIT} 次仍失败 · 草稿保留 · 未检查`,
      status: "草稿 · 待修复 · 未检查",
      pending: [],
    };
  }
  let report: JudgeReport | undefined;
  let problem = "";
  let reportText = "";
  const accepted = round.check_results?.[String(judgeRound)];
  if (accepted)
    report = {
      reviewer: "quality_judge",
      round: judgeRound,
      verdict: accepted.verdict,
      ...(accepted.acceptance ? { acceptance: accepted.acceptance } : {}),
      scope: accepted.scope,
      reviewed_artifacts: Object.entries(accepted.reviewed_hashes).map(([filename, sha256]) => ({ filename, sha256 })),
      issues: accepted.issues,
      unverified: accepted.unverified,
      decisions: accepted.decisions,
    };
  else if (!protocol) {
    try {
      reportText = await readFile(join(store.workspace, reportPath), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const parsed = parseJudgeReport(reportText, { hashes: reviewed, scope: scopeText, round: judgeRound });
    if (
      parsed.report &&
      parsed.report.reviewed_artifacts.length === Object.keys(hashes).length &&
      parsed.report.reviewed_artifacts.every((a) => hashes[a.filename] === a.sha256)
    ) {
      report = parsed.report;
      await store.resolveStep(key, "check", ["check_run_failed", "check_output_invalid"]);
    } else problem = reportText ? (parsed.error ?? "检查报告与被审版本不一致") : "检查报告未产生";
  } else problem = "独立检查没有通过 promax_check_result 提交可接受的结果";
  if (!report) {
    if (mode === "admit") return { kind: "call", members: ["quality_judge"], next: round, progress: "检查中 · 草稿可查看", instruction: "" };
    if (!calls.has("quality_judge")) {
      const told = round.notified?.quality_judge;
      if (told === undefined || told >= latestSeq)
        return {
          kind: "call",
          members: ["quality_judge"],
          next: round,
          progress: "检查中 · 草稿可查看",
          instruction: `现在调用 quality_judge 独立检查第 ${judgeRound} 轮${protocol ? "，检查成员用 promax_check_result 提交结果" : `，报告写 ${reportPath}`}。`,
        };
      problem = "已通知调用独立检查，但没有实际派发";
    }
    const decision = (await note("check", "check_output_invalid", `${judgeRound}:${reportText ? sha256(reportText) : "absent"}:${lastCalls.get("quality_judge") ?? `notcalled-${round.notified?.quality_judge}`}`, problem, "带具体错误重新派独立检查，用 promax_check_result 提交")).decision;
    if (decision === "exhausted")
      return {
        kind: "halt",
        step: "check",
        reason: problem,
        progress: `待修复 · 检查结果无法接收（已自动恢复 ${RECOVERY_LIMIT} 次）：${problem} · 草稿保留 · 未检查`,
        status: "草稿 · 待修复 · 未检查",
        pending: [],
      };
    return {
      kind: "call",
      members: ["quality_judge"],
      next: { ...round, member_seq: recoverSeq(["quality_judge"]) },
      progress: "检查中 · 自动恢复",
      instruction: `自动恢复（同一故障最多 ${RECOVERY_LIMIT} 次）：第 ${judgeRound} 轮检查结果无法接收：${problem}。重新调用 quality_judge，检查成员必须用 promax_check_result 提交结果；本次工作不结束，已有草稿保留。`,
    };
  }
  const decisions: PendingItem[] = report.decisions.map((d) => ({
    ...d,
    id: `check-${d.id}`,
    question: d.question,
    artifact:
      d.artifact ||
      (report.reviewed_artifacts.length === 1
        ? report.reviewed_artifacts[0]!.filename
        : ""),
    reviewed_sha256:
      hashes[d.artifact || report.reviewed_artifacts[0]!.filename] ?? "",
    sources: [
      {
        source: "check",
        basis: d.evidence || "检查报告",
        reference: accepted?.report ?? reportPath,
      },
    ],
    ...(d.options.length ? { options: d.options } : {}),
    basis: [d.location, d.evidence].filter(Boolean).join("：") || "检查报告",
    source: "check",
    kind: "tradeoff",
    raised_by: "check",
  }));
  const outcome = checkOutcome(report);
  if (report.verdict === "PASS") {
    const card = await store.read(key);
    const blockingIssues = (await store.reviews(key)).issues.filter((i) => i.group === round.review_group && i.kind !== "suggestion" && i.state !== "verified").map((i) => i.id);
    const completion = taskCompletion(card, round.acceptance_baseline, accepted ? { ...accepted, blocking_issue_ids: blockingIssues } : undefined, hashes);
    return {
      kind: "finish",
      progress: `${completion.label} · ${outcome.label}${completion.gaps.length ? ` · 待满足：${completion.gaps.join("、")}` : ""}`,
      status: `${completion.label} · ${outcome.label}`,
      pending: decisions,
      verdict: "PASS",
    };
  }
  if (protocol && !round.check_only && report.verdict === "REVISION_REQUIRED" && (round.repair_round ?? 0) < 2) {
    const failure = await note("check", "proposal_invalid", `repair-plan:${round.task_key}:${judgeRound}:${latestSeq}`, "检查已接收，等待主 Agent 的明确返修安排", "调用 promax_repair_plan；不根据 Judge owner 自动派工");
    if (failure.decision === "exhausted") return { kind: "halt", step: "check", reason: "未收到合法返修安排", progress: "待修复 · 返修安排未完成 · 草稿保留", status: "需返修 · 待修复", pending: decisions };
    return { kind: "call", members: [], next: round, progress: "等待主 Agent 安排返修 · 草稿可查看", instruction: `检查结果已接收。你不是内容评审人，请根据 ${accepted?.report ?? reportPath} 和问题清单调用 promax_repair_plan：judge_round=${judgeRound}，assignments=[{member,files,issue_ids,instruction}]。只安排本轮授权成果的登记责任成员；不要让 Judge 分配成员或直接再调用成员。` };
  }
  const owners = round.check_only
    ? []
    : repairOwners(report, registered, round.repair_round ?? 0);
  if (!owners.length) {
    const unresolved: PendingItem[] =
      report.verdict === "REVISION_REQUIRED"
        ? report.issues.map((i) => ({
            id: `check-${i.id}`,
            artifact: i.artifact,
            location: i.location,
            effect: i.fix,
            reviewed_sha256: hashes[i.artifact] ?? "",
            sources: [
              { source: "check", basis: i.evidence, reference: accepted?.report ?? reportPath },
            ],
            question: `检查仍未解决：${i.location} —— ${i.fix}`,
            options: ["请 AI 再改这一处", "保持现状，我来判断"],
            basis: i.evidence,
            source: "check",
            kind: "revision",
            raised_by: "check",
          }))
        : [];
    return {
      kind: "finish",
      progress:
        report.verdict === "INCOMPLETE"
          ? "部分完成 · 无法完整检查"
          : `部分完成 · 自动返修已到上限 · 待人判断（${report.issues.length} 个问题）`,
      status:
        report.verdict === "INCOMPLETE"
          ? "草稿 · 无法完整检查"
          : "需返修 · 待你判断",
      pending: [...decisions, ...unresolved],
      verdict: report.verdict,
    };
  }
  const repairRound = (round.repair_round ?? 0) + 1;
  return {
    kind: "call",
    members: owners,
    next: {
      ...round,
      phase: "repairing",
      repair_round: repairRound,
      allowed_members: owners,
      event_seq: latestSeq,
    },
    progress: `返修中（${repairRound}/2）`,
    instruction: `只调用问题责任成员 ${owners.join("、")}，按 ${accepted?.report ?? reportPath} 问题表局部修改${protocol ? "，完成后提交成果回执" : ""}，不重跑无关成员、不要求无关成果变化。`,
  };
}

const SYNC_MEMBER_FAILURE =
  /^(?:Error:\s*)?subagent (?:run failed|run was cancelled|run hit its token limit|declined the task|run ended abnormally)/u;
const BACKGROUND_MEMBER_SETTLED =
  /^Background subagent (\S+) (finished and will do no further work|failed before it finished|was stopped before it finished|ran out of room before it finished|declined the task|ended abnormally)/u;

function eventTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (typeof block !== "object" || block === null) return [];
    const b = block as { text?: unknown; content?: unknown };
    return [
      ...(typeof b.text === "string" ? [b.text] : []),
      ...eventTexts(b.content),
    ];
  });
}

/** Latest failed attempt per member with the evidence that identifies it (dsh sync error or background settlement). */
function memberFailures(
  events: readonly DispatchSessionEvent[],
  round: Pick<WorkRound, "children" | "allowed_members" | "member_seq">,
): Map<string, MemberFailure> {
  const byCall = new Map<string, string>();
  const latest = new Map<string, MemberFailure | undefined>();
  for (const event of events) {
    const data = event.data as Record<string, unknown> | undefined;
    const seq = event.seq ?? 0;
    if (event.type === "tool/call") {
      const member = dispatchedMemberName(event);
      if (!member) continue;
      byCall.set(String(data?.callId), member);
      // A new attempt clears an earlier failure until it settles.
      if (latest.get(member)) latest.set(member, undefined);
    } else if (event.type === "tool/result") {
      const content = (data?.message as { content?: unknown[] } | undefined)
        ?.content;
      for (const block of Array.isArray(content) ? content : []) {
        const b = block as {
          toolCallId?: unknown;
          isError?: unknown;
          content?: unknown;
        };
        const member = byCall.get(String(b.toolCallId));
        if (!member || b.isError !== true) continue;
        const text = eventTexts(b.content).find((t) => SYNC_MEMBER_FAILURE.test(t));
        if (text)
          latest.set(member, { seq, evidence: `result:${String(b.toolCallId)}:${seq}`, kind: /cancelled/u.test(text) ? "cancelled" : /declined/u.test(text) ? "declined" : "failed", reason: text.replace(/^Error:\s*/u, "").slice(0, 200) });
      }
    } else if (event.type === "user/message") {
      const text = eventTexts(data?.content).join("");
      const match = BACKGROUND_MEMBER_SETTLED.exec(text);
      if (!match) continue;
      const owners = round.allowed_members ?? [];
      const member =
        round.children?.[match[1]!] ??
        (owners.length === 1 ? owners[0] : undefined);
      if (!member) continue;
      latest.set(
        member,
        match[2]!.startsWith("finished")
          ? undefined
          : { seq, evidence: `settled:${match[1]}:${seq}`, kind: match[2]!.startsWith("was stopped") ? "cancelled" : match[2]!.startsWith("declined") ? "declined" : "failed", reason: match[2]! },
      );
    }
  }
  return new Map(
    [...latest].filter((entry): entry is [string, MemberFailure] => !!entry[1] && entry[1].seq > (round.member_seq?.[entry[0]] ?? -1)),
  );
}

/** Members whose latest run in this phase ended without finishing (dsh sync error or background settlement). */
export function failedWorkMembers(
  events: readonly DispatchSessionEvent[],
  round: Pick<WorkRound, "children" | "allowed_members">,
): Set<string> {
  return new Set([...memberFailures(events, round)].filter(([, f]) => f.kind !== "cancelled").map(([m]) => m));
}

async function workExecutionState(
  store: WorkStore,
  key: string,
  sessionId: string,
  events: readonly DispatchSessionEvent[],
) {
  const round = await store.round(key);
  if (
    !round?.task_key ||
    round.source === "proposal" ||
    round.phase === "ended"
  )
    return undefined;
  const files = await readTaskRunFiles(store.workspace, {
    sessionId,
    taskKey: round.task_key,
  });
  // Boundary-inclusive: a call admitted in pre-execute may carry the round's own baseline seq.
  const later = events.filter((e) => (e.seq ?? 0) >= round.event_seq);
  const rejected = new Set(
    later.flatMap((e) => {
      if (e.type !== "tool/result") return [];
      const content = (e.data as { message?: { content?: unknown[] } })?.message
        ?.content;
      return (Array.isArray(content) ? content : []).flatMap((block) =>
        typeof block === "object" &&
        block !== null &&
        (block as { isError?: unknown }).isError === true
          ? [String((block as { toolCallId?: unknown }).toolCallId)]
          : [],
      );
    }),
  );
  const hashes = Object.fromEntries(
    await Promise.all(
      files.artifactStates
        .filter((a) => a.nonEmpty)
        .map(
          async (a) =>
            [
              basename(a.path),
              sha256(await readFile(join(store.workspace, a.path))),
            ] as const,
        ),
    ),
  );
  // A denied member call does not count as the member having run; a recovery starts a fresh attempt window.
  const accepted = later.filter(
    (e) =>
      e.type === "tool/call" &&
      !rejected.has(String((e.data as { callId?: unknown })?.callId)) &&
      (e.seq ?? 0) > (round.member_seq?.[dispatchedMemberName(e, round.children) ?? ""] ?? -1),
  );
  const lastCalls = new Map<string, number>();
  for (const e of accepted) {
    const name = dispatchedMemberName(e, round.children);
    if (name) lastCalls.set(name, e.seq ?? 0);
  }
  return {
    round,
    files,
    hashes,
    failed: memberFailures(later, round),
    calls: new Set(accepted.map((e) => dispatchedMemberName(e, round.children)).filter(Boolean)),
    lastCalls,
    latestSeq: Math.max(round.event_seq, ...later.map((e) => e.seq ?? 0)),
  };
}

/** A coordinator call that matches the program's next step advances the phase instead of being rejected. */
async function admitNextWorkMember(
  store: WorkStore,
  key: string,
  sessionId: string,
  events: readonly DispatchSessionEvent[],
  member: string,
): Promise<{ admitted: true } | { admitted: false; reason: string }> {
  await settleStructuredCommits(store.workspace);
  const current = await store.round(key);
  // A continuation is the same dispatch as a new child, including its pending event.
  const pendingCall = [...events]
    .reverse()
    .find((e) => e.type === "tool/call" && dispatchedMemberName(e, current?.children) === member);
  const state = await workExecutionState(store, key, sessionId, events.filter((e) => e !== pendingCall));
  if (!state || state.files.cancellation !== "running")
    return { admitted: false, reason: "本次执行已结束，不需要再调用成员" };
  // Dispatch checks unprocessed changes first, so an old requirement version never starts new work.
  const unseen = ((await store.read(key)).events ?? []).filter((e) => e.state === "received" && e.task_key === state.round.task_key);
  if (unseen.length)
    return { admitted: false, reason: `执行期间有 ${unseen.length} 条员工新输入尚未处理：先调用 promax_work_proposal 处理（${unseen.map((e) => e.id).join("、")}），再按程序通知派工` };
  const step = await planWorkStep(
    store,
    key,
    state.round,
    state.files,
    state.calls,
    state.latestSeq,
    state.hashes,
    state.failed,
    state.lastCalls,
    "admit",
  );
  if (step.kind === "call" && step.members.includes(member)) {
    const next =
      pendingCall?.seq !== undefined
        ? {
            ...step.next,
            event_seq: Math.min(step.next.event_seq, pendingCall.seq - 1),
          }
        : step.next;
    if (JSON.stringify(next) === JSON.stringify(state.round)) return { admitted: true };
    const moved = await store.transitionRound(key, state.round, next);
    if (moved) {
      await store.progress(key, step.progress, state.hashes);
      if (next.phase === "checking")
        await store.markDecisions(
          key,
          ["running", "updated"],
          "checking",
          "正在检查本次修改的草稿；发布状态以保存结果为准",
          next.decision_ids ?? [],
        );
      return { admitted: true };
    }
    return {
      admitted: false,
      reason: "阶段刚刚已由程序推进，请按最新通知继续",
    };
  }
  return {
    admitted: false,
    reason:
      step.kind === "wait"
        ? `${step.reason}；这不是失败，无需告知员工或请求授权`
        : step.kind === "call"
          ? `当前这一步应由 ${step.members.join("、")} 处理，程序会在需要时通知你`
          : step.kind === "halt"
            ? "这一步已暂停待修复，已有成果保留；不要再调用成员"
            : "本次执行已进入收尾，不需要再调用成员",
  };
}

function steerText(payload: DispatchTurnStopping, text: string) {
  payload.agent.steer(
    createUserMessage({
      content: [{ type: "text", text: `运行时完整性闸门：${text}` }],
      source: { kind: "plugin", plugin: "@promax/promax-bundle" },
    }),
  );
}

async function completeWorkExecution(
  payload: DispatchTurnStopping,
  store: WorkStore,
  key: string,
  telemetry?: LocalTelemetry,
  uploader?: TraceUploader,
): Promise<void> {
  const sessionId = payload.agent.session.header.id;
  await settleStructuredCommits(store.workspace);
  const round = await store.round(key);
  if (round?.delivery && round.phase === "ended") {
    await waitForSettlement(deliveryKey(store.workspace, key, round.delivery.task_key), payload.signal).catch(error => { if (payload.signal.aborted) throw error; });
    await store.refreshDelivery(key);
  }
  if (
    !round?.task_key ||
    round.source === "proposal" ||
    round.phase === "ended"
  )
    return;
  const control = await readTaskRunFiles(store.workspace, {
    sessionId,
    taskKey: round.task_key,
  });
  if (control.cancellation !== "running") {
    if (["cancelled", "completed", "failed"].includes(control.cancellation))
      await store.endStoppedRound(
        sessionId,
        round.task_key,
        round.revision,
        control.cancellation === "cancelled",
      );
    return;
  }
  const state = (await workExecutionState(
    store,
    key,
    sessionId,
    payload.agent.session.events,
  ))!;
  if (Object.keys(state.round.children ?? {}).some((id) => activeWorkChildren.has(id))) return;
  // Inputs received during this run are understood before any dispatch, check or commit; they are never swallowed.
  const unseen = ((await store.read(key)).events ?? []).filter(
    (e) => e.state === "received" && e.task_key === state.round.task_key && (e.attempts ?? 0) < RECOVERY_LIMIT,
  );
  if (unseen.length) {
    await store.markEventsAttempted(key, unseen.map((e) => e.id));
    steerText(payload, `执行期间收到员工新输入。继续派工、提交检查或结束前，先调用 promax_work_proposal 在 handled_events 中处理：${unseen.map((e) => `${e.id}「${e.text.slice(0, 80)}」`).join("；")}。高影响纠正会暂停受影响成果，普通补充不打断其他工作。`);
    return;
  }
  const overdueInputs = ((await store.read(key)).events ?? []).filter((e) => e.state === "received" && e.task_key === state.round.task_key && (e.attempts ?? 0) >= RECOVERY_LIMIT);
  if (overdueInputs.length) await store.failEvents(key, overdueInputs.map((e) => e.id), "收尾前多次要求理解仍未处理；输入已保留，待后续处理，不声称已应用");
  const step = await planWorkStep(
    store,
    key,
    state.round,
    state.files,
    state.calls,
    state.latestSeq,
    state.hashes,
    state.failed,
    state.lastCalls,
  );
  if (step.kind === "wait") return;
  if (step.kind === "call") {
    const next = { ...step.next, notified: { ...step.next.notified, ...Object.fromEntries(step.members.map((m) => [m, state.latestSeq])) } };
    if (!(await store.transitionRound(key, state.round, next))) return;
    await store.progress(key, step.progress, state.hashes);
    if (next.phase === "checking")
      await store.markDecisions(
        key,
        ["running", "updated"],
        "checking",
        "正在检查本次修改的草稿；发布状态以保存结果为准",
        next.decision_ids ?? [],
      );
    const bound = next.phase === "checking" ? await store.round(key) : undefined;
    const judgeId = bound?.review_group ? (await store.reviews(key)).bindings[bound.review_group]?.session_id : undefined;
    steerText(payload, `${step.instruction}${judgeId ? `\n该组必须续接现有 Judge：send_message({subagent_id:"${judgeId}", message:"按当前工作简报评审请求 ${bound?.review_request} 复查"})；不要新建。` : ""}`);
    return;
  }
  return settleWorkStep(store, key, sessionId, state, step, telemetry, uploader);
}

/** Program-owned commit path, also callable after a Judge ends without another coordinator reply. */
async function settleWorkStep(
  store: WorkStore, key: string, sessionId: string,
  state: NonNullable<Awaited<ReturnType<typeof workExecutionState>>>,
  step: Extract<WorkStep, { kind: "finish" | "halt" }>,
  telemetry?: LocalTelemetry, uploader?: TraceUploader,
) {
  return singleSettlement(deliveryKey(store.workspace, key, state.round.task_key!), async () => {
    const current = await store.round(key);
    if (current?.delivery?.task_key === state.round.task_key) { await store.refreshDelivery(key); return; }
    return settleWorkStepOnce(store, key, sessionId, state, step, telemetry, uploader);
  });
}
async function settleWorkStepOnce(
  store: WorkStore, key: string, sessionId: string,
  state: NonNullable<Awaited<ReturnType<typeof workExecutionState>>>,
  step: Extract<WorkStep, { kind: "finish" | "halt" }>,
  telemetry?: LocalTelemetry, uploader?: TraceUploader,
) {
  const halted = step.kind === "halt";
  const preservingDrafts = halted || (!!state.round.execution_digest && state.round.execution_digest !== await store.requirements(key));
  const status = await store.status(key);
  const stale = [
    ...new Set([
      ...(state.round.stale_files ?? []),
      ...status.alignments.filter((a) => a.state === "active").flatMap((a) => a.affects),
    ]),
  ].filter((f) => state.round.turn.deliverables.includes(f));
  const live = Object.fromEntries(Object.entries(state.hashes).filter(([f]) => !stale.includes(f)));
  const reportPath = state.round.judge_round
    ? (state.round.check_results?.[String(state.round.judge_round)]?.report ??
      taskPathFromTemplate(
        ".任务/{task_key}/判定-r{round}.md",
        state.round.task_key!,
        true,
        state.round.judge_round,
      ))
    : undefined;
  const ended: WorkRound = {
    ...state.round,
    phase: "ended",
    allowed_members: [],
    delivery: { task_key: state.round.task_key!, trace_id: telemetry?.traceId(sessionId) ?? "", reviewed_hashes: preservingDrafts ? live : state.round.reviewed_hashes ?? state.hashes, at: new Date().toISOString(), ...(state.round.check_only ? { check_only: true } : {}) },
    ...(halted ? { halted: "needs_fix" as const } : {}),
    ...(stale.length ? { stale_files: stale } : {}),
    ...(!halted && reportPath && state.round.judge_round && state.round.reviewed_hashes && (state.round.check_results?.[String(state.round.judge_round)] || state.round.protocol !== 2)
      ? {
          previous_check: reportPath,
          last_check: {
            report: reportPath,
            judge_round: state.round.judge_round,
            reviewed_hashes: state.round.reviewed_hashes,
            ...(state.round.requirements_digest
              ? { requirements_digest: state.round.requirements_digest }
              : {}),
            ...(step.kind === "finish" && step.verdict ? { verdict: step.verdict } : {}),
            ...(state.round.acceptance_baseline ? {
              acceptance_baseline: state.round.acceptance_baseline,
              ...(state.round.check_results?.[String(state.round.judge_round)]?.acceptance ? { acceptance: state.round.check_results[String(state.round.judge_round)]!.acceptance! } : {}),
              ...(state.round.check_results?.[String(state.round.judge_round)]?.acceptance_evidence ? { acceptance_evidence: state.round.check_results[String(state.round.judge_round)]!.acceptance_evidence! } : {}),
              unverified: state.round.check_results?.[String(state.round.judge_round)]?.unverified ?? [],
              blocking_issue_ids: (await store.reviews(key)).issues.filter((i) => i.group === state.round.review_group && i.kind !== "suggestion" && i.state !== "verified").map((i) => i.id),
              delivery_saved: false,
            } : {}),
          },
        }
      : {}),
  };
  if (!(await store.transitionRound(key, state.round, ended))) return;
  try {
    await store.progress(key, step.progress.startsWith("已完成") ? "成果检查已结束 · 正在保存版本" : step.progress, {}, step.status.startsWith("已完成") ? "正在保存版本" : step.status);
    await store.refreshDelivery(key, true);
    await store.addCheckPending(key, step.pending);
    await store.withDeliveryScope(key, state.round, async () => {
    if (halted) {
      const published = await publishStoppedDrafts(store.workspace, state.round.task_key!, sessionId, telemetry, stale);
      // Projection is refreshed after releasing the work lock; no nested WorkStore mutation here.
      void published;
      await settleTaskRun(store.workspace, state.files, "failed", telemetry);
    } else
      await settleTaskRun(
        store.workspace,
        state.files,
        Object.keys(live).length ? "completed" : "failed",
        telemetry,
        stale,
        state.round.reviewed_hashes,
      );
    }, preservingDrafts);
    await store.refreshDelivery(key);
    await store.finishDecisions(
      key,
      ended,
      (await store.refreshDelivery(key))?.state === "complete",
      (await store.read(key)).last_progress,
    );
    if (stale.length)
      await store.proposeRedo(key, stale, state.latestSeq, `执行期间要求有高影响变化：按最新要求重做受影响成果 ${stale.join("、")}，其余成果保留。`);
  } catch (error) {
    const latest = await store.round(key);
    if (latest?.delivery && latest.delivery.task_key === state.round.task_key) {
      latest.delivery.error = error instanceof Error ? error.message : String(error);
      latest.delivery.failure = "failed";
      // Never overwrite a newer round with the pre-commit snapshot.
      await store.transitionRound(key, latest, latest);
      const facts = deliveryFacts(store.workspace, await store.read(key), latest);
      if (facts?.state === "saved") {
        await finishTaskRunFiles(store.workspace, state.files, "completed");
        await store.refreshDelivery(key); // Commit succeeded; only response/projection failed. No business replay.
        return;
      }
    }
    await store.markDecisions(
      key,
      ["running", "checking", "updated"],
      "partial",
      "决定已保留，成果版本保存失败",
      ended.decision_ids ?? [],
    );
    await store.noteFailure(key, { step: "commit", class: "commit_failed", evidence: `commit:${state.round.task_key}`, reason: error instanceof Error ? error.message : String(error), strategy: "核对实际保存状态后再决定是否重试，不重复提交", at: new Date().toISOString(), runtime_version: BUNDLE_VERSION, ...(state.round.task_key ? { task_key: state.round.task_key } : {}) });
    await store.refreshDelivery(key);
    throw error;
  }
  if (halted) await reportWorkFault(store, key, uploader, step.step);
}

/** An accepted terminal review settles from durable facts, not a further normal model response. */
async function settleAcceptedReview(store: WorkStore, key: string, telemetry?: LocalTelemetry, uploader?: TraceUploader, signal?: AbortSignal) {
  await settleStructuredCommits(store.workspace);
  const card = await store.read(key), round = await store.round(key);
  const result = round?.check_results?.[String(round.judge_round)];
  if (!round) return;
  if (round.delivery && (!round.task_key || round.delivery.task_key === round.task_key)) {
    await waitForSettlement(deliveryKey(store.workspace, key, round.delivery.task_key), signal);
    await store.refreshDelivery(key);
    return;
  }
  if (round.phase !== "checking" || !result || Object.keys(round.children ?? {}).some((id) => activeWorkChildren.has(id))) return;
  if ((card.events ?? []).some((e) => e.task_key === round.task_key && e.state === "received")) return;
  if (result.verdict === "REVISION_REQUIRED" && !round.check_only && (round.repair_round ?? 0) < 2) return;
  if (round.execution_digest !== await store.requirements(key)) return;
  const state = await workExecutionState(store, key, card.session_id, []);
  if (!state || Object.entries(result.reviewed_hashes).some(([f, h]) => state.hashes[f] !== h)) return;
  const step = await planWorkStep(store, key, state.round, state.files, state.calls, state.latestSeq, state.hashes);
  if (step.kind !== "finish" && step.kind !== "halt") return;
  const pending = settleWorkStep(store, key, card.session_id, state, step, telemetry, uploader);
  void pending.catch(() => {});
  await waitForSettlement(deliveryKey(store.workspace, key, round.task_key!), signal);
  await pending;
  const current = await store.read(key);
  uploader?.reportWork(store.workspace, current);
  if (uploader) {
    const entries = new ContentObjectStore(store.workspace).index().artifacts.filter((a) => a.work_key === key);
    for (const entry of entries) await uploader.reportArtifactVersion(store.workspace, current.project_id, entry);
    const trace = telemetry?.traceId(card.session_id);
    const checkedReport = parseJudgeReport(await readFile(join(store.workspace, result.report), "utf8"), { hashes: result.reviewed_hashes, scope: result.scope, round: result.judge_round }).report;
    if (trace && checkedReport) for (const [filename, hash] of Object.entries(result.reviewed_hashes)) {
      const entry = entries.find((e) => e.filename === filename), version = entry?.versions.findLast((v) => v.sha256 === hash);
      if (entry && version) uploader.reportCheckReport(store.workspace, {
        project_id: current.project_id, report_id: workId(current.project_id, `${round.task_key}:${round.judge_round}:${entry.artifact_id}`), work_id: workId(current.project_id, key), artifact_id: entry.artifact_id, version_id: artifactVersionId(entry, version), trace_id: trace, created_at: result.at,
        report: uploadedJudgeReport(checkedReport),
      });
    }
  }
}

/** Stable across clients for the same fault class and step kind; content never enters the fingerprint. */
export function defectFingerprint(fault: Pick<FaultRecord, "class" | "step">) {
  return sha256(JSON.stringify([fault.class, fault.step.split(":")[0]]));
}
/** Minimal defect record: identity, location, version, counts and evidence references. No chat, material text or keys. */
export function defectRequest(card: WorkCard, fault: FaultRecord, key: string) {
  return {
    project_id: card.project_id,
    defect_id: workId(card.project_id, `defect:${card.work_key}:${fault.key}:${fault.first_at}`),
    fingerprint: defectFingerprint(fault),
    work_id: workId(card.project_id, card.work_key),
    task_key: fault.task_key ?? null,
    step: fault.step.slice(0, 256),
    category: fault.class,
    summary: (fault.history.at(-1)?.reason ?? "").slice(0, 500),
    runtime_version: (fault.runtime_version ?? BUNDLE_VERSION).slice(0, 128),
    first_seen: fault.first_at,
    last_seen: fault.last_at,
    occurrences: fault.history.length,
    resume_position: (fault.resume ?? "").slice(0, 256),
    evidence_refs: [`.工作/${key}/状态.yml`, ...(fault.task_key ? [`.任务/${fault.task_key}/任务包.yml`] : [])],
  };
}
/**
 * Queues an exhausted fault for the backend when an upload identity exists, else records it locally. A reporting
 * failure is recorded on the fault itself and never produces another fault.
 */
async function reportWorkFault(store: WorkStore, key: string, uploader: TraceUploader | undefined, step: string) {
  const card = await store.read(key);
  const fault = openFaults(await store.status(key)).find((f) => f.step === step && f.state === "needs_fix");
  if (!fault) return;
  let state: NonNullable<FaultRecord["report"]>["state"] = "local";
  let reportKey: string | undefined;
  try {
    reportKey = uploader?.reportDefect?.(card, defectRequest(card, fault, key));
    if (reportKey) state = "pending";
  } catch {
    state = "failed";
  }
  await store.updateStatus(key, (status) => {
    const target = status.faults.find((f) => f.key === fault.key && f.state === "needs_fix");
    if (target) target.report = { state, ...(reportKey ? { key: reportKey } : {}), at: new Date().toISOString() };
  });
}

/** A stopped run keeps its written drafts as AI versions instead of leaving them only in a sealed task folder. */
async function publishStoppedDrafts(
  workspace: string,
  taskKey: string,
  sessionId: string,
  telemetry: LocalTelemetry | undefined,
  exclude: readonly string[] = [],
): Promise<{ hashes: Record<string, string>; note: string }> {
  const files = await readTaskRunFiles(workspace, { sessionId, taskKey });
  // Drafts made under replaced requirements stay in the task snapshot only.
  const drafts = files.artifactStates.filter((a) => a.nonEmpty && !exclude.includes(basename(a.path)));
  if (!drafts.length) return { hashes: {}, note: "尚无已落盘的草稿" };
  const association = YAML.parse(
    await readFile(join(workspace, ".任务", taskKey, "工作关联.yml"), "utf8"),
  ) as {
    work_key: string;
    author: string;
    kind: "ai_run" | "ai_edit";
    check_only?: boolean;
    edit?: { filename: string; base_sha256: string };
  };
  if (association.check_only)
    return { hashes: {}, note: "复查已停止，成果未改动" };
  if (!telemetry)
    return {
      hashes: {},
      note: "草稿保留在本次执行中（运行记录未就绪，未保存为版本）",
    };
  const store = new ContentObjectStore(workspace, (attributes) =>
    telemetry.observation(sessionId, attributes),
  );
  const entries = store.commit(
    taskKey,
    telemetry.traceId(sessionId),
    drafts.map((a) => a.path),
    {
      workKey: association.work_key,
      kind: association.kind,
      author: association.author,
      ...(association.edit
        ? {
            baseSha256ByFilename: {
              [association.edit.filename]: association.edit.base_sha256,
            },
          }
        : {}),
    },
  );
  return {
    hashes: Object.fromEntries(
      entries.map((e) => [e.filename, e.current_sha256]),
    ),
    note: `已保存 ${entries.length} 份草稿版本 · 未检查`,
  };
}

function jsonYaml(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function evidenceManifestYaml(manifest: EvidenceInputManifest): string {
  const count = manifest.inputs.src_files.length;
  const comment =
    count === 0
      ? "# 无用户上传文件\n"
      : `# 已冻结 ${String(count)} 个上传文件登记项（含办公文档转换件）\n`;
  return `${comment}# 冻结路径使用 source_id 与 ASCII 扩展名；不合规扩展名使用 .bin，用户原名见 original_filename\n${YAML.stringify(manifest)}`;
}

function taskRunControlValue(
  taskKey: string,
  sessionId: string,
  state: TaskRunCancellationState,
  runEpoch: number,
  updatedAt: string,
): Record<string, unknown> {
  return {
    api_version: "promax.ai/v1alpha2",
    kind: "TaskRunControl",
    metadata: {
      task_key: taskKey,
      session_id: sessionId,
      updated_at: updatedAt,
    },
    spec: { state, run_epoch: runEpoch },
  };
}

function taskRunControlOf(
  value: unknown,
  taskKey: string,
  sessionId: string,
): { state: TaskRunCancellationState; runEpoch: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("任务运行控制文件无效");
  const row = value as Record<string, unknown>;
  const metadata =
    typeof row.metadata === "object" &&
    row.metadata !== null &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : undefined;
  const spec =
    typeof row.spec === "object" &&
    row.spec !== null &&
    !Array.isArray(row.spec)
      ? (row.spec as Record<string, unknown>)
      : undefined;
  if (
    row.kind !== "TaskRunControl" ||
    metadata?.task_key !== taskKey ||
    metadata.session_id !== sessionId
  )
    throw new Error("任务运行控制文件与当前 task/session 不一致");
  const state = spec?.state;
  const runEpoch = spec?.run_epoch;
  if (
    ![
      "running",
      "stop_requested",
      "draining",
      "cancelled",
      "completed",
      "failed",
      "failed_to_stop",
    ].includes(String(state))
  )
    throw new Error("任务运行控制状态无效");
  if (
    typeof runEpoch !== "number" ||
    !Number.isSafeInteger(runEpoch) ||
    runEpoch < 1
  )
    throw new Error("任务运行 epoch 无效");
  // Migrate historical failed_to_stop files into the truthful waiting state.
  // The next accepted transition rewrites the file without preserving the retired value.
  return {
    state:
      state === "failed_to_stop"
        ? "stop_requested"
        : (state as TaskRunCancellationState),
    runEpoch,
  };
}

async function writeTaskRunControl(
  path: string,
  taskKey: string,
  sessionId: string,
  state: TaskRunCancellationState,
  runEpoch: number,
  updatedAt: string,
): Promise<void> {
  const temporary = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`;
  await writeFile(
    temporary,
    jsonYaml(
      taskRunControlValue(taskKey, sessionId, state, runEpoch, updatedAt),
    ),
    { encoding: "utf8", flag: "wx" },
  );
  await rename(temporary, path);
}

function exactTaskArtifactPath(path: string, taskKey: string): boolean {
  return (
    (path.startsWith(`deliverables/${taskKey}/`) ||
      (path.startsWith(`.任务/${taskKey}/产物快照/`) &&
        path.slice(`.任务/${taskKey}/产物快照/`.length).split("/").length ===
          1)) &&
    !path.includes("..") &&
    !path.includes("\\")
  );
}

async function fileState(
  workspace: string,
  path: string,
): Promise<{ path: string; exists: boolean; nonEmpty: boolean }> {
  const absolute = resolve(workspace, path);
  if (absolute !== workspace && !absolute.startsWith(`${workspace}${sep}`))
    throw new Error(`任务文件越出工作区：${path}`);
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink())
      throw new Error(`任务文件不得是符号链接：${path}`);
    return {
      path,
      exists: info.isFile(),
      nonEmpty: info.isFile() && info.size > 0,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { path, exists: false, nonEmpty: false };
    throw error;
  }
}

async function taskDeliverableFiles(
  workspace: string,
  taskKey: string,
): Promise<TaskDeliverableFile[]> {
  const deliverablePath = taskPaths(workspace, taskKey).artifacts;
  const root = resolve(workspace, deliverablePath);
  if (root !== resolve(workspace, taskPaths(workspace, taskKey).artifacts))
    throw new Error("任务产出目录无效");
  try {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new Error(`任务产出路径不是普通目录：${deliverablePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: TaskDeliverableFile[] = [];
  const walk = async (directory: string, parents: string[]): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name, "zh-CN"),
    );
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw new Error(
          `任务产出目录不得包含符号链接：${[...parents, entry.name].join("/")}`,
        );
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, [...parents, entry.name]);
        continue;
      }
      if (!entry.isFile())
        throw new Error(
          `任务产出目录只允许普通文件：${[...parents, entry.name].join("/")}`,
        );
      const info = await lstat(absolute);
      const relativePath = [...parents, entry.name].join("/");
      files.push({
        name: entry.name,
        relativePath,
        path: `${deliverablePath}/${relativePath}`,
        bytes: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  };
  await walk(root, []);
  return files;
}

export interface TaskRunArtifactRegistration {
  path: string;
  memberId: string;
}

function taskExecutionManifestOf(
  value: unknown,
  taskKey: string,
): TaskExecutionManifest {
  const row = objectRow(value, "TaskPackage");
  exactKeys(row, ["api_version", "kind", "metadata", "spec"], "TaskPackage");
  const metadata = objectRow(row.metadata, "TaskPackage.metadata");
  const spec = objectRow(row.spec, "TaskPackage.spec");
  const layout = taskLayoutPaths(
    taskKey,
    spec.input_manifest_path === `.任务/${taskKey}/输入/manifest.yml`,
  );
  exactKeys(
    metadata,
    ["task_key", "team_revision_id", "confirmed_at"],
    "TaskPackage.metadata",
  );
  exactKeys(
    spec,
    ["input_manifest_path", "members_confirmed", "artifacts", "judge"],
    "TaskPackage.spec",
  );
  const confirmedAt =
    typeof metadata.confirmed_at === "string" &&
    !Number.isNaN(Date.parse(metadata.confirmed_at))
      ? metadata.confirmed_at
      : "";
  const teamRevisionId =
    typeof metadata.team_revision_id === "string"
      ? metadata.team_revision_id
      : "";
  const membersConfirmed = dispatchMemberIds(
    spec.members_confirmed,
    "TaskPackage 已确认成员名单",
  );
  if (
    row.api_version !== "promax.ai/v1alpha2" ||
    row.kind !== "TaskPackage" ||
    metadata.task_key !== taskKey ||
    teamRevisionId === "" ||
    confirmedAt === "" ||
    spec.input_manifest_path !== `${layout.input}/manifest.yml` ||
    !Array.isArray(spec.artifacts) ||
    spec.artifacts.length === 0
  ) {
    throw new Error("TaskPackage Schema 校验失败");
  }
  const artifacts = spec.artifacts.map((value, index) => {
    const artifact = objectRow(
      value,
      `TaskPackage.spec.artifacts[${String(index)}]`,
    );
    exactKeys(
      artifact,
      [
        "artifact_kind",
        "validation_kind",
        "relative_path",
        "produced_by",
        "domain_rubric",
      ],
      `TaskPackage.spec.artifacts[${String(index)}]`,
    );
    const parsed: TaskManifestArtifact = {
      artifact_kind:
        typeof artifact.artifact_kind === "string"
          ? artifact.artifact_kind
          : "",
      validation_kind:
        typeof artifact.validation_kind === "string"
          ? artifact.validation_kind
          : "",
      relative_path:
        typeof artifact.relative_path === "string"
          ? artifact.relative_path
          : "",
      produced_by:
        typeof artifact.produced_by === "string" ? artifact.produced_by : "",
      ...(artifact.domain_rubric === undefined
        ? {}
        : { domain_rubric: artifact.domain_rubric }),
    };
    if (
      parsed.artifact_kind === "" ||
      parsed.validation_kind === "" ||
      !exactTaskArtifactPath(parsed.relative_path, taskKey) ||
      parsed.produced_by === "quality_judge" ||
      !membersConfirmed.includes(parsed.produced_by)
    ) {
      throw new Error(`TaskPackage 业务产物 ${String(index + 1)} 无效`);
    }
    return parsed;
  });
  if (
    new Set(artifacts.map((artifact) => artifact.relative_path)).size !==
    artifacts.length
  )
    throw new Error("TaskPackage 业务产物路径不得重复");
  const judge = objectRow(spec.judge, "TaskPackage.spec.judge");
  exactKeys(judge, ["relative_path", "produced_by"], "TaskPackage.spec.judge");
  const expectedJudgePath =
    layout.modern && judge.relative_path === `.任务/${taskKey}/判定-r1.md`
      ? `.任务/${taskKey}/判定-r1.md`
      : layout.judge;
  if (
    judge.relative_path !== expectedJudgePath ||
    judge.produced_by !== "quality_judge"
  )
    throw new Error("TaskPackage Judge 登记无效");
  return {
    api_version: "promax.ai/v1alpha2",
    kind: "TaskPackage",
    metadata: {
      task_key: taskKey,
      team_revision_id: teamRevisionId,
      confirmed_at: confirmedAt,
    },
    spec: {
      input_manifest_path: `${layout.input}/manifest.yml`,
      members_confirmed: membersConfirmed,
      artifacts,
      judge: { relative_path: expectedJudgePath, produced_by: "quality_judge" },
    },
  };
}

function taskExecutionManifestFromTeamRevision(
  value: unknown,
  contract: TaskManifestContract,
  taskKey: string,
): TaskExecutionManifest {
  const layout = taskLayoutPaths(
    taskKey,
    contract.judge.relative_path.startsWith(".任务/"),
  );
  const row = objectRow(value, "TeamRevision");
  const metadata = objectRow(row.metadata, "TeamRevision.metadata");
  const spec = objectRow(row.spec, "TeamRevision.spec");
  const teamRevisionId =
    typeof metadata.team_revision_id === "string"
      ? metadata.team_revision_id
      : "";
  if (
    row.api_version !== "promax.ai/v1alpha2" ||
    row.kind !== "TeamRevision" ||
    metadata.status !== "published" ||
    teamRevisionId === "" ||
    !Array.isArray(spec.artifacts)
  )
    throw new Error("已发布 TeamRevision 无效");
  const declarations = spec.artifacts.map((value, index) => {
    const artifact = objectRow(
      value,
      `TeamRevision.spec.artifacts[${String(index)}]`,
    );
    const relativePath =
      typeof artifact.relative_path === "string"
        ? taskPathFromTemplate(
            artifact.relative_path,
            taskKey,
            layout.modern,
            1,
          )
        : "";
    return {
      artifact_kind: typeof artifact.kind === "string" ? artifact.kind : "",
      validation_kind:
        typeof artifact.validation_kind === "string"
          ? artifact.validation_kind
          : "",
      relative_path: relativePath,
      produced_by:
        typeof artifact.produced_by === "string" ? artifact.produced_by : "",
    };
  });
  const rubricCatalog =
    spec.domain_rubrics === undefined
      ? {}
      : objectRow(spec.domain_rubrics, "TeamRevision.spec.domain_rubrics");
  const artifacts = contract.deliverables.map((registered, index) => {
    const declaration = declarations.find(
      (candidate) =>
        candidate.relative_path === registered.relative_path &&
        candidate.produced_by === registered.produced_by,
    );
    if (
      declaration === undefined ||
      declaration.artifact_kind === "" ||
      declaration.validation_kind === ""
    ) {
      throw new Error(
        `已确认产物 ${String(index + 1)} 不属于已发布 TeamRevision`,
      );
    }
    const rubric = rubricCatalog[declaration.validation_kind];
    return {
      ...declaration,
      ...(rubric === undefined ? {} : { domain_rubric: rubric }),
    };
  });
  const judgeDeclaration = declarations.find(
    (candidate) =>
      candidate.relative_path === contract.judge.relative_path &&
      candidate.produced_by === "quality_judge",
  );
  if (
    judgeDeclaration?.artifact_kind !== "judge-report" ||
    judgeDeclaration.validation_kind === ""
  )
    throw new Error("已发布 TeamRevision 缺少固定 Judge 产物");
  return taskExecutionManifestOf(
    {
      api_version: "promax.ai/v1alpha2",
      kind: "TaskPackage",
      metadata: {
        task_key: taskKey,
        team_revision_id: teamRevisionId,
        confirmed_at: contract.confirmed_at,
      },
      spec: {
        input_manifest_path: `${layout.input}/manifest.yml`,
        members_confirmed: contract.members_confirmed,
        artifacts,
        judge: contract.judge,
      },
    },
    taskKey,
  );
}

async function writeImmutableTaskManifest(
  path: string,
  manifest: TaskExecutionManifest,
): Promise<void> {
  const content = YAML.stringify(manifest);
  try {
    await writeFile(path, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = taskExecutionManifestOf(
      YAML.parse(await readFile(path, "utf8")) as unknown,
      manifest.metadata.task_key,
    );
    if (JSON.stringify(existing) !== JSON.stringify(manifest))
      throw new Error("TaskPackage 已冻结且与当前执行契约不一致");
  }
}

/** Seals the confirmed output contract beside the immutable input manifest before execution starts. */
export async function sealTaskRunManifest(
  workspacePath: string,
  input: {
    sessionId: string;
    taskKey: string;
    confirmedAt: string;
    confirmedMemberIds: string[];
    artifacts: TaskRunArtifactRegistration[];
    teamRevision: unknown;
  },
): Promise<{
  manifestPath: string;
  artifactPaths: string[];
  judgePath: string;
  runEpoch: number;
}> {
  const workspace = resolve(workspacePath);
  const sessionId = sessionIdOf(input.sessionId);
  const taskKey = taskKeyOf(input.taskKey);
  const layout = taskPaths(workspace, taskKey);
  const registrations = input.artifacts.map((artifact) => ({
    ...artifact,
    path: taskPathFromTemplate(artifact.path, taskKey, layout.modern, 1),
  }));
  const confirmedMemberIds = dispatchMemberIds(
    input.confirmedMemberIds,
    "manifest 已确认成员名单",
  );
  if (Number.isNaN(Date.parse(input.confirmedAt)))
    throw new Error("manifest 确认时间无效");
  if (!Array.isArray(input.artifacts) || input.artifacts.length < 2)
    throw new Error("manifest 至少需要一个业务产物和固定 Judge");
  const expectedJudgePath =
    layout.modern &&
    registrations.some((a) => a.path === `.任务/${taskKey}/判定-r1.md`)
      ? `.任务/${taskKey}/判定-r1.md`
      : layout.judge;
  const judgeRows = registrations.filter(
    (artifact) =>
      artifact.memberId === "quality_judge" ||
      artifact.path === expectedJudgePath,
  );
  if (
    judgeRows.length !== 1 ||
    judgeRows[0]?.memberId !== "quality_judge" ||
    judgeRows[0].path !== expectedJudgePath
  ) {
    throw new Error("manifest 必须且只能登记一个固定 Judge 产物");
  }
  const deliverables = registrations
    .filter((artifact) => artifact.memberId !== "quality_judge")
    .map((artifact, index) => {
      if (
        !confirmedMemberIds.includes(artifact.memberId) ||
        !exactTaskArtifactPath(artifact.path, taskKey)
      ) {
        throw new Error(
          `manifest 业务产物 ${String(index + 1)} 不属于已确认任务`,
        );
      }
      return {
        artifact_kind: "",
        validation_kind: "",
        relative_path: artifact.path,
        produced_by: artifact.memberId,
      };
    });
  if (
    deliverables.length === 0 ||
    new Set(deliverables.map((deliverable) => deliverable.relative_path))
      .size !== deliverables.length
  ) {
    throw new Error("manifest 业务产物为空或路径重复");
  }
  const scope = JSON.parse(
    await readFile(
      join(workspace, ".promax", "session-scopes", `${sessionId}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
  if (scope.sessionName !== taskKey || scope.taskKey !== taskKey)
    throw new Error("当前父 session 与 task_key 不一致");
  const manifestPath = join(workspace, layout.input, "manifest.yml");
  const current = evidenceManifestOf(
    YAML.parse(await readFile(manifestPath, "utf8")) as unknown,
    taskKey,
  );
  await validateEvidenceManifestFiles(workspace, current);
  const contract: TaskManifestContract = {
    confirmed_at: input.confirmedAt,
    members_confirmed: confirmedMemberIds,
    deliverables,
    judge: { relative_path: expectedJudgePath, produced_by: "quality_judge" },
  };
  const taskRoot = join(workspace, layout.task);
  await mkdir(taskRoot, { recursive: true });
  const taskManifest = taskExecutionManifestFromTeamRevision(
    input.teamRevision,
    contract,
    taskKey,
  );
  const taskManifestPath = join(workspace, layout.manifest);
  await writeImmutableTaskManifest(taskManifestPath, taskManifest);
  const runControlPath = join(taskRoot, "run-control.yml");
  try {
    const existing = JSON.parse(
      await readFile(runControlPath, "utf8"),
    ) as unknown;
    taskRunControlOf(existing, taskKey, sessionId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(
      runControlPath,
      jsonYaml(
        taskRunControlValue(
          taskKey,
          sessionId,
          "running",
          1,
          input.confirmedAt,
        ),
      ),
      { encoding: "utf8", flag: "wx" },
    );
  }
  return {
    manifestPath: layout.manifest,
    artifactPaths: deliverables.map((deliverable) => deliverable.relative_path),
    judgePath: expectedJudgePath,
    runEpoch: 1,
  };
}

function judgeStateOf(report: string): TaskRunJudgeState {
  const manual =
    /\|\s*人工处理\s*\|([^\n|]+)/iu.exec(report)?.[1]?.trim() ?? "";
  if (/人工强制放行|force[-_ ]?release/iu.test(manual)) return "force_released";
  if (/APPEALED|已?申诉|申诉中/iu.test(manual)) return "appealed";
  if (
    /HUMAN_REQUIRED|等待人工|需要人工|需人工|人工复核|交由人工/iu.test(manual)
  )
    return "human_required";
  const verdicts = [
    ...report.matchAll(
      /(?:判定结论|(?:(?:整体|最终)\s*verdict)|overall[_ -]+verdict|(?:最终|复核)\s*判定)\s*(?:[：:=]|\|)\s*\**\s*(PASS(?:ED)?|FAIL(?:ED)?|APPEALED|HUMAN_REQUIRED)\b/giu,
    ),
  ];
  const verdict = verdicts.at(-1)?.[1]?.toUpperCase();
  if (verdict === "PASS" || verdict === "PASSED") return "pass";
  if (verdict === "FAIL" || verdict === "FAILED") return "fail";
  if (verdict === "APPEALED") return "appealed";
  if (verdict === "HUMAN_REQUIRED") return "human_required";
  return "unverified";
}

function cleanJudgeReason(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s+|>\s*)/u, "")
    .replace(/\*\*/gu, "")
    .replace(/`/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function judgeReasonOf(
  report: string,
  state: TaskRunJudgeState,
): string | undefined {
  if (!["fail", "appealed", "human_required", "unverified"].includes(state))
    return undefined;
  const explicit =
    /(?:失败原因|不通过原因|阻断原因|主要缺陷|修复方向)\s*[：:]\s*([^\n]+)/iu.exec(
      report,
    )?.[1];
  if (explicit !== undefined && cleanJudgeReason(explicit) !== "")
    return cleanJudgeReason(explicit);

  const lines = report.split(/\r?\n/u);
  const failingHeading = lines.findIndex((line) =>
    /^#{2,6}\s+.*(?:—|-|：|:)\s*\**fail(?:ed)?\**\s*$/iu.test(line.trim()),
  );
  if (failingHeading >= 0) {
    const detail = lines.slice(failingHeading + 1).find((line) => {
      const value = line.trim();
      return (
        value !== "" &&
        !value.startsWith("#") &&
        !value.startsWith("|") &&
        !/^[-*_]{3,}$/u.test(value) &&
        !/诊断分/u.test(value)
      );
    });
    if (detail !== undefined && cleanJudgeReason(detail) !== "")
      return cleanJudgeReason(detail);
  }

  const failingRow = lines.find((line) =>
    /^\|.*\|\s*\**fail(?:ed)?\**\s*\|/iu.test(line.trim()),
  );
  if (failingRow !== undefined) {
    const cells = failingRow.split("|").map(cleanJudgeReason).filter(Boolean);
    const verdictIndex = cells.findIndex((cell) =>
      /^fail(?:ed)?$/iu.test(cell),
    );
    const detail = verdictIndex >= 0 ? cells[verdictIndex + 1] : undefined;
    if (detail !== undefined && detail !== "") return detail;
  }

  if (state === "appealed") return "Judge 判定已申诉，正在等待后续处理。";
  if (state === "human_required") return "Judge 要求人工复核后才能放行。";
  if (state === "unverified") return "Judge 报告没有可识别的最终通过结论。";
  return "Judge 最终判定不通过；请按报告中的有效缺陷修复。";
}

const MAX_JUDGE_REPAIR_ROUNDS = 2;

interface TaskJudgeRepairControl extends TaskJudgeRepairSnapshot {
  taskKey: string;
  sessionId: string;
  artifactFingerprints: Record<string, string>;
  judgeFingerprint: string;
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label}无效`);
  const entries = Object.entries(value);
  if (
    entries.some(
      ([key, item]) => key === "" || typeof item !== "string" || item === "",
    )
  )
    throw new Error(`${label}无效`);
  return Object.fromEntries(entries) as Record<string, string>;
}

function taskJudgeRepairControlOf(
  value: unknown,
  taskKey: string,
  sessionId: string,
): TaskJudgeRepairControl {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Judge 返修控制文件无效");
  const row = value as Record<string, unknown>;
  const metadata =
    typeof row.metadata === "object" &&
    row.metadata !== null &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : undefined;
  const spec =
    typeof row.spec === "object" &&
    row.spec !== null &&
    !Array.isArray(row.spec)
      ? (row.spec as Record<string, unknown>)
      : undefined;
  if (
    row.kind !== "TaskJudgeRepairControl" ||
    metadata?.task_key !== taskKey ||
    metadata.session_id !== sessionId
  )
    throw new Error("Judge 返修控制文件与当前 task/session 不一致");
  const state = spec?.state;
  const round = spec?.round;
  const maxRounds = spec?.max_rounds;
  const updatedAt = metadata.updated_at;
  const reasons = spec?.reasons;
  if (!["repairing", "judging", "passed", "exhausted"].includes(String(state)))
    throw new Error("Judge 返修状态无效");
  if (
    !Number.isSafeInteger(round) ||
    !Number.isSafeInteger(maxRounds) ||
    Number(round) < 1 ||
    Number(round) > Number(maxRounds) ||
    maxRounds !== MAX_JUDGE_REPAIR_ROUNDS
  )
    throw new Error("Judge 返修轮次无效");
  if (
    !Array.isArray(reasons) ||
    reasons.length < 1 ||
    reasons.length > MAX_JUDGE_REPAIR_ROUNDS ||
    reasons.some((reason) => typeof reason !== "string" || reason.trim() === "")
  )
    throw new Error("Judge 返修原因无效");
  if (
    typeof updatedAt !== "string" ||
    Number.isNaN(Date.parse(updatedAt)) ||
    !updatedAt.endsWith("Z")
  )
    throw new Error("Judge 返修时间无效");
  const artifactFingerprints = stringRecord(
    spec?.artifact_fingerprints,
    "Judge 返修产物指纹",
  );
  const judgeFingerprint =
    typeof spec?.judge_fingerprint === "string" && spec.judge_fingerprint !== ""
      ? spec.judge_fingerprint
      : undefined;
  if (judgeFingerprint === undefined) throw new Error("Judge 返修报告指纹无效");
  return {
    taskKey,
    sessionId,
    state: state as TaskJudgeRepairState,
    round: Number(round),
    maxRounds: Number(maxRounds),
    reasons: reasons.map(String),
    updatedAt,
    artifactFingerprints,
    judgeFingerprint,
  };
}

function taskJudgeRepairValue(
  control: TaskJudgeRepairControl,
): Record<string, unknown> {
  return {
    api_version: "promax.ai/v1alpha2",
    kind: "TaskJudgeRepairControl",
    metadata: {
      task_key: control.taskKey,
      session_id: control.sessionId,
      updated_at: control.updatedAt,
    },
    spec: {
      state: control.state,
      round: control.round,
      max_rounds: control.maxRounds,
      reasons: control.reasons,
      artifact_fingerprints: control.artifactFingerprints,
      judge_fingerprint: control.judgeFingerprint,
    },
  };
}

async function optionalTaskJudgeRepairControl(
  workspace: string,
  taskKey: string,
  sessionId: string,
): Promise<TaskJudgeRepairControl | undefined> {
  try {
    return taskJudgeRepairControlOf(
      JSON.parse(
        await readFile(
          join(
            workspace,
            taskPaths(workspace, taskKey).task,
            "judge-repair.yml",
          ),
          "utf8",
        ),
      ) as unknown,
      taskKey,
      sessionId,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeTaskJudgeRepairControl(
  workspace: string,
  control: TaskJudgeRepairControl,
): Promise<void> {
  const path = join(
    workspace,
    taskPaths(workspace, control.taskKey).task,
    "judge-repair.yml",
  );
  const temporary = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`;
  await writeFile(temporary, jsonYaml(taskJudgeRepairValue(control)), {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporary, path);
}

async function pathFingerprint(
  workspace: string,
  relativePath: string,
): Promise<string> {
  const absolute = resolve(workspace, relativePath);
  if (absolute !== workspace && !absolute.startsWith(`${workspace}${sep}`))
    throw new Error(`Judge 返修文件越出工作区：${relativePath}`);
  try {
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) return "missing";
    const content = await readFile(absolute);
    return `${String(info.mtimeMs)}:${String(info.size)}:${createHash("sha256").update(content).digest("hex")}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function artifactFingerprints(
  workspace: string,
  paths: readonly string[],
): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, await pathFingerprint(workspace, path)]),
    ),
  );
}

function repairSnapshotOf(
  control: TaskJudgeRepairControl,
): TaskJudgeRepairSnapshot {
  return {
    state: control.state,
    round: control.round,
    maxRounds: control.maxRounds,
    reasons: [...control.reasons],
    updatedAt: control.updatedAt,
  };
}

async function taskWorkspace(
  workspacePath: string,
  sessionId: string,
  taskKey: string,
): Promise<string> {
  const workspace = resolve(workspacePath);
  const scope = JSON.parse(
    await readFile(
      join(workspace, ".promax", "session-scopes", `${sessionId}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
  if (scope.sessionName !== taskKey || scope.taskKey !== taskKey)
    throw new Error("当前父 session 与 task_key 不一致");
  return workspace;
}

/** Reads the exact artifact list from the sealed task manifest, then observes only those disk paths. */
export async function readTaskRunFiles(
  workspacePath: string,
  input: { sessionId: string; taskKey: string },
): Promise<TaskRunFileSnapshot> {
  const sessionId = sessionIdOf(input.sessionId);
  const taskKey = taskKeyOf(input.taskKey);
  const workspace = await taskWorkspace(workspacePath, sessionId, taskKey);
  const inputManifestPath = `${taskPaths(workspace, taskKey).input}/manifest.yml`;
  const inputManifest = evidenceManifestOf(
    YAML.parse(
      await readFile(resolve(workspace, inputManifestPath), "utf8"),
    ) as unknown,
    taskKey,
  );
  await validateEvidenceManifestFiles(workspace, inputManifest);
  const manifestPath = taskPaths(workspace, taskKey).manifest;
  const manifest = taskExecutionManifestOf(
    YAML.parse(
      await readFile(resolve(workspace, manifestPath), "utf8"),
    ) as unknown,
    taskKey,
  );
  const controlPath = join(workspace, taskPaths(workspace, taskKey).control);
  const control = taskRunControlOf(
    JSON.parse(await readFile(controlPath, "utf8")) as unknown,
    taskKey,
    sessionId,
  );
  const artifactStates = await Promise.all(
    manifest.spec.artifacts.map(async (deliverable) => ({
      ...(await fileState(workspace, deliverable.relative_path)),
      memberId: deliverable.produced_by,
    })),
  );
  const work = await new WorkStore(workspace).forSession(sessionId);
  const workRound = work
    ? await new WorkStore(workspace).round(work.work_key)
    : undefined;
  const judgePath =
    workRound?.task_key === taskKey && workRound.judge_round
      ? `.任务/${taskKey}/判定-r${workRound.judge_round}.md`
      : manifest.spec.judge.relative_path;
  const judgeFile = await fileState(workspace, judgePath);
  const judgeReport = judgeFile.nonEmpty
    ? await readFile(resolve(workspace, judgePath), "utf8")
    : "";
  const expected =
    workRound?.task_key === taskKey &&
    workRound.judge_round &&
    workRound.check_scope &&
    workRound.reviewed_hashes
      ? {
          hashes: workRound.reviewed_hashes,
          scope: workRound.check_scope,
          round: workRound.judge_round,
        }
      : undefined;
  let strict = taskPaths(workspace, taskKey).modern
    ? expected
      ? parseJudgeReport(judgeReport, expected)
      : { error: "无法完整检查：缺少程序冻结的检查上下文" }
    : undefined;
  if (strict?.report) {
    // Compare the task's own snapshot, not today's current version: historical PASS stays historical.
    const snapshotHashes = Object.fromEntries(
      await Promise.all(
        artifactStates
          .filter((a) => a.nonEmpty)
          .map(
            async (a) =>
              [
                basename(a.path),
                sha256(await readFile(join(workspace, a.path))),
              ] as const,
          ),
      ),
    );
    if (
      Object.keys(snapshotHashes).length !==
        strict.report.reviewed_artifacts.length ||
      strict.report.reviewed_artifacts.some(
        (a) => snapshotHashes[a.filename] !== a.sha256,
      )
    )
      strict = { error: "无法完整检查：任务快照已偏离被审版本" };
  }
  const state = judgeFile.nonEmpty
    ? strict
      ? strict.report?.verdict === "PASS"
        ? "pass"
        : strict.report?.verdict === "REVISION_REQUIRED"
          ? "fail"
          : "unverified"
      : judgeStateOf(judgeReport)
    : "absent";
  const repair = await optionalTaskJudgeRepairControl(
    workspace,
    taskKey,
    sessionId,
  );
  const judgeReason = strict?.error ?? judgeReasonOf(judgeReport, state);
  const reason =
    repair?.state === "exhausted"
      ? `多次返修后仍未通过（${String(repair.round)}/${String(repair.maxRounds)}）：${repair.reasons.join("；")}`
      : judgeReason;
  const deliverablePath = taskPaths(workspace, taskKey).artifacts;
  const deliverableFiles = await taskDeliverableFiles(workspace, taskKey);
  return {
    taskKey,
    parentSessionId: sessionId,
    createdAt: inputManifest.metadata.frozen_at,
    cancellation: control.state,
    runEpoch: control.runEpoch,
    manifestPath,
    inputManifestPath,
    confirmedMemberIds: manifest.spec.members_confirmed,
    artifactStates,
    deliverablePath,
    deliverableFiles,
    judge: {
      path: judgePath,
      memberId: "quality_judge",
      state,
      exists: judgeFile.exists,
      nonEmpty: judgeFile.nonEmpty,
      ...(reason === undefined ? {} : { reason }),
    },
    ...(repair === undefined ? {} : { repair: repairSnapshotOf(repair) }),
    observedAt: new Date().toISOString(),
  };
}

function historyStatusOf(snapshot: TaskRunFileSnapshot): TaskHistoryStatus {
  if (snapshot.cancellation === "completed") return "completed";
  if (snapshot.cancellation === "failed") return "failed";
  if (snapshot.cancellation === "cancelled") return "failed";
  if (
    snapshot.repair?.state === "repairing" ||
    snapshot.repair?.state === "judging"
  )
    return "running";
  if (snapshot.repair?.state === "exhausted") return "failed";
  if (
    snapshot.judge.state === "pass" ||
    snapshot.judge.state === "force_released"
  )
    return "completed";
  if (
    ["fail", "appealed", "human_required", "unverified"].includes(
      snapshot.judge.state,
    )
  )
    return "failed";
  return "running";
}

async function incompleteHistoryItem(
  workspace: string,
  sessionId: string,
  taskKey: string,
  scopeModifiedAt: string,
  error: unknown,
): Promise<TaskHistoryItem> {
  const deliverablePath = taskPaths(workspace, taskKey).artifacts;
  const deliverableFiles = await taskDeliverableFiles(workspace, taskKey);
  const inputManifestPath = `${taskPaths(workspace, taskKey).input}/manifest.yml`;
  let createdAt = scopeModifiedAt;
  let invalidInput = false;
  try {
    const inputManifest = evidenceManifestOf(
      YAML.parse(
        await readFile(resolve(workspace, inputManifestPath), "utf8"),
      ) as unknown,
      taskKey,
    );
    await validateEvidenceManifestFiles(workspace, inputManifest);
    createdAt = inputManifest.metadata.frozen_at;
  } catch (reason) {
    invalidInput = (reason as NodeJS.ErrnoException).code !== "ENOENT";
  }
  const judgePath = taskPaths(workspace, taskKey).judge;
  const judgeFile = await fileState(workspace, judgePath);
  const judgeReport = judgeFile.nonEmpty
    ? await readFile(resolve(workspace, judgePath), "utf8")
    : "";
  const judgeState = judgeFile.nonEmpty ? judgeStateOf(judgeReport) : "absent";
  const reason = judgeReasonOf(judgeReport, judgeState);
  const message = error instanceof Error ? error.message : String(error);
  const terminalJudge = [
    "fail",
    "appealed",
    "human_required",
    "unverified",
  ].includes(judgeState);
  const invalidExecution = (error as NodeJS.ErrnoException).code !== "ENOENT";
  return {
    sessionId,
    taskKey,
    createdAt,
    status:
      invalidInput || invalidExecution || terminalJudge ? "failed" : "running",
    fileCount: deliverableFiles.length,
    deliverablePath,
    deliverableFiles,
    judge: {
      path: judgePath,
      memberId: "quality_judge",
      state: judgeState,
      exists: judgeFile.exists,
      nonEmpty: judgeFile.nonEmpty,
      ...(reason === undefined ? {} : { reason }),
    },
    observedAt: new Date().toISOString(),
    ...(invalidInput || invalidExecution ? { error: message } : {}),
  };
}

/** Lists task assets from session-scope files and current disk contents; no browser state participates. */
export async function readTaskHistory(
  workspacePath: string,
): Promise<TaskHistoryItem[]> {
  const workspace = resolve(workspacePath);
  const scopeRoot = join(workspace, ".promax", "session-scopes");
  let entries: Dirent[];
  try {
    entries = await readdir(scopeRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const items: TaskHistoryItem[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !entry.name.endsWith(".json")
    )
      continue;
    const sessionId = sessionIdOf(entry.name.slice(0, -".json".length));
    const scopePath = join(scopeRoot, entry.name);
    const scopeInfo = await lstat(scopePath);
    const scope = JSON.parse(await readFile(scopePath, "utf8")) as Record<
      string,
      unknown
    >;
    const taskKey = taskKeyOf(scope.taskKey);
    if (scope.sessionId !== sessionId || scope.sessionName !== taskKey)
      throw new Error(`任务范围文件与文件名不一致：${entry.name}`);
    try {
      const snapshot = await readTaskRunFiles(workspace, {
        sessionId,
        taskKey,
      });
      items.push({
        sessionId,
        taskKey,
        createdAt: snapshot.createdAt,
        status: historyStatusOf(snapshot),
        fileCount: snapshot.deliverableFiles.length,
        deliverablePath: snapshot.deliverablePath,
        deliverableFiles: snapshot.deliverableFiles,
        judge: snapshot.judge,
        observedAt: snapshot.observedAt,
      });
    } catch (error) {
      items.push(
        await incompleteHistoryItem(
          workspace,
          sessionId,
          taskKey,
          scopeInfo.mtime.toISOString(),
          error,
        ),
      );
    }
  }
  return items.sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

/** Resolves only the current task's real delivery directory for the native file-manager action. */
export async function resolveTaskDeliverableDirectory(
  workspacePath: string,
  input: { sessionId: string; taskKey: string },
): Promise<string> {
  const sessionId = sessionIdOf(input.sessionId);
  const taskKey = taskKeyOf(input.taskKey);
  const workspace = await taskWorkspace(workspacePath, sessionId, taskKey);
  const directory = resolve(workspace, taskPaths(workspace, taskKey).artifacts);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("任务产出路径不是普通目录");
  return directory;
}

const TASK_RUN_TRANSITIONS: Record<
  TaskRunCancellationState,
  readonly TaskRunCancellationState[]
> = {
  running: ["running", "stop_requested", "completed", "failed"],
  stop_requested: ["stop_requested", "draining"],
  draining: ["draining", "cancelled"],
  cancelled: ["cancelled"],
  completed: ["completed"],
  failed: ["failed"],
};

async function sealTaskFiles(
  workspace: string,
  taskKey: string,
): Promise<void> {
  const layout = taskPaths(workspace, taskKey);
  if (!layout.modern) return;
  const pending = [join(workspace, layout.task)];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("任务封存拒绝符号链接");
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) chmodSync(path, 0o444);
    }
  }
}

async function settleTaskRun(
  workspacePath: string,
  snapshot: TaskRunFileSnapshot,
  state: "completed" | "failed",
  telemetry?: LocalTelemetry,
  exclude: readonly string[] = [],
  reviewedHashes?: Record<string, string>,
): Promise<void> {
  return singleSettlement(`task-run:${workspacePath}:${snapshot.taskKey}:${snapshot.runEpoch}`, () => settleTaskRunOnce(workspacePath, snapshot, state, telemetry, exclude, reviewedHashes));
}
async function settleTaskRunOnce(
  workspacePath: string, snapshot: TaskRunFileSnapshot, state: "completed" | "failed", telemetry?: LocalTelemetry,
  exclude: readonly string[] = [], reviewedHashes?: Record<string, string>,
): Promise<void> {
  const workspace = await taskWorkspace(
    workspacePath,
    snapshot.parentSessionId,
    snapshot.taskKey,
  );
  const path = join(workspace, taskPaths(workspace, snapshot.taskKey).control);
  const current = taskRunControlOf(
    JSON.parse(await readFile(path, "utf8")) as unknown,
    snapshot.taskKey,
    snapshot.parentSessionId,
  );
  if (current.runEpoch !== snapshot.runEpoch)
    throw new Error("任务运行 epoch 已变化，拒绝结算旧 run");
  if (current.state === state) return;
  if (current.state !== "running")
    throw new Error(`任务运行控制不允许 ${current.state} → ${state}`);
  if (taskPaths(workspace, snapshot.taskKey).modern && state === "completed") {
    if (!telemetry)
      throw new Error("产物提交缺少本次 trace，不允许伪造版本来源");
    const store = new ContentObjectStore(workspace, (attributes) =>
      telemetry.observation(snapshot.parentSessionId, attributes),
    );
    const association = YAML.parse(
      await readFile(
        join(workspace, ".任务", snapshot.taskKey, "工作关联.yml"),
        "utf8",
      ),
    ) as {
      work_key: string;
      author: string;
      kind: "ai_run" | "ai_edit";
      check_only?: boolean;
      edit?: {
        filename: string;
        base_sha256: string;
        anchor: { type: "heading" | "quote" | "page"; value: string };
      };
    };
    if (association.edit) {
      const source = store.readVersion(
        association.work_key,
        association.edit.filename,
        association.edit.base_sha256,
      );
      const changed = await readFile(
        join(
          workspace,
          taskPaths(workspace, snapshot.taskKey).artifacts,
          association.edit.filename,
        ),
        "utf8",
      );
      const outside = outsideAnchorChanges(source.content, changed, association.edit.anchor);
      const diff = YAML.stringify({
        filename: association.edit.filename,
        base_sha256: source.sha256,
        outside_anchor_changes: outside,
        anchor: association.edit.anchor,
      });
      const diffPath = join(workspace, ".任务", snapshot.taskKey, "修改差异.yml");
      try { await writeFile(diffPath, diff, { flag: "wx", mode: 0o444 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(diffPath, "utf8") !== diff) throw error;
      }
      if (outside) throw new Error("修改超出授权锚点范围；草稿保留，请按影响范围重新提出修订");
    }
    if (reviewedHashes) for (const file of snapshot.artifactStates.filter(f => f.nonEmpty && !exclude.includes(basename(f.path)))) {
      if (sha256(await readFile(join(workspace, file.path))) !== reviewedHashes[basename(file.path)]) throw new Error(`提交草稿已不再是被审版本：${basename(file.path)}`);
    }
    // No await between this last cancellation/epoch check and the synchronous CAS commit.
    const committing = taskRunControlOf(JSON.parse(readFileSync(path, "utf8")), snapshot.taskKey, snapshot.parentSessionId);
    if (committing.runEpoch !== snapshot.runEpoch || committing.state !== "running") throw new Error("提交前任务已停止或运行身份变化，草稿保留");
    if (!association.check_only)
      store.commit(
        snapshot.taskKey,
        telemetry.traceId(snapshot.parentSessionId),
        snapshot.artifactStates
          .filter((file) => file.nonEmpty && !exclude.includes(basename(file.path)))
          .map((file) => file.path),
        {
          workKey: association.work_key,
          kind: association.kind,
          author: association.author,
          ...(association.edit
            ? {
                baseSha256ByFilename: {
                  [association.edit.filename]: association.edit.base_sha256,
                },
              }
            : {}),
        },
      );
  }
  await finishTaskRunFiles(workspace, snapshot, state);
}
/** Finalize only run control/seals after confirmed storage, including a lost commit response. */
async function finishTaskRunFiles(workspace: string, snapshot: TaskRunFileSnapshot, state: "completed" | "failed") {
  const path = join(workspace, taskPaths(workspace, snapshot.taskKey).control);
  const current = taskRunControlOf(JSON.parse(await readFile(path, "utf8")), snapshot.taskKey, snapshot.parentSessionId);
  if (current.runEpoch !== snapshot.runEpoch || !["running", state].includes(current.state)) throw new Error("任务运行状态已变化，不覆盖取消或后续运行");
  if (current.state !== state) await writeTaskRunControl(path, snapshot.taskKey, snapshot.parentSessionId, state, snapshot.runEpoch, new Date().toISOString());
  await sealTaskFiles(workspace, snapshot.taskKey);
}

/** Persists one idempotent cancellation transition before/after runtime work. */
export async function controlTaskRunFiles(
  workspacePath: string,
  input: {
    sessionId: string;
    taskKey: string;
    state: TaskRunCancellationState;
    runEpoch: number;
    updatedAt: string;
  },
): Promise<{
  state: TaskRunCancellationState;
  runEpoch: number;
  updatedAt: string;
  changed: boolean;
}> {
  const sessionId = sessionIdOf(input.sessionId);
  const taskKey = taskKeyOf(input.taskKey);
  if (
    !["running", "stop_requested", "draining", "cancelled"].includes(
      input.state,
    )
  )
    throw new Error("任务运行控制状态无效");
  if (!Number.isSafeInteger(input.runEpoch) || input.runEpoch < 1)
    throw new Error("任务运行 epoch 无效");
  if (
    Number.isNaN(Date.parse(input.updatedAt)) ||
    !input.updatedAt.endsWith("Z")
  )
    throw new Error("任务运行控制时间无效");
  const workspace = await taskWorkspace(workspacePath, sessionId, taskKey);
  if (!taskPaths(workspace, taskKey).modern)
    throw new Error("历史任务只读，不允许改变运行状态");
  const path = join(workspace, taskPaths(workspace, taskKey).control);
  const current = taskRunControlOf(
    JSON.parse(await readFile(path, "utf8")) as unknown,
    taskKey,
    sessionId,
  );
  if (current.runEpoch !== input.runEpoch)
    throw new Error("任务运行 epoch 已变化，拒绝用旧停止请求修改新 run");
  if (
    (input.state === "stop_requested" || input.state === "draining") &&
    (current.state === "draining" || current.state === "cancelled")
  ) {
    return {
      state: current.state,
      runEpoch: current.runEpoch,
      updatedAt: input.updatedAt,
      changed: false,
    };
  }
  if (!TASK_RUN_TRANSITIONS[current.state].includes(input.state))
    throw new Error(`任务运行控制不允许 ${current.state} → ${input.state}`);
  if (current.state === input.state)
    return {
      state: current.state,
      runEpoch: current.runEpoch,
      updatedAt: input.updatedAt,
      changed: false,
    };
  await writeTaskRunControl(
    path,
    taskKey,
    sessionId,
    input.state,
    input.runEpoch,
    input.updatedAt,
  );
  if (input.state === "cancelled") await sealTaskFiles(workspace, taskKey);
  return {
    state: input.state,
    runEpoch: input.runEpoch,
    updatedAt: input.updatedAt,
    changed: true,
  };
}

function requestPath(request: IncomingMessage): string {
  return (request.url ?? "").split("?")[0]?.replace(/\/+$/u, "") ?? "";
}

function taskRunArtifactRegistrations(
  value: unknown,
): TaskRunArtifactRegistration[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== "object" || item === null || Array.isArray(item),
    )
  ) {
    throw new Error("任务产物登记格式无效");
  }
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    const path = typeof row.path === "string" ? row.path : "";
    const memberId = typeof row.memberId === "string" ? row.memberId : "";
    if (path === "" || !/^[a-z][a-z0-9_]{2,47}$/u.test(memberId))
      throw new Error("任务产物登记格式无效");
    return { path, memberId };
  });
}

/** Actual provider usage of the latest turn, as reported on assistant messages; nothing is estimated. */
function turnUsage(events: readonly DispatchSessionEvent[]): Array<{ at: string; step: string; kind: "turn" | "recovery"; input_tokens: number; output_tokens: number; event_seq: number }> {
  let start = events.length;
  while (start > 0 && events[start - 1]!.type !== "user/message") start--;
  const trigger = events[start - 1]?.data as { source?: { kind?: string } } | undefined;
  return events.slice(start).flatMap((e) => {
    const usage = (e.data as { usage?: { inputTokens?: unknown; outputTokens?: unknown } } | undefined)?.usage;
    if (e.type !== "assistant/message" || typeof usage?.inputTokens !== "number" || typeof usage.outputTokens !== "number") return [];
    return [{ at: new Date().toISOString(), step: "coordinator", kind: trigger?.source?.kind === "plugin" ? "recovery" as const : "turn" as const, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, event_seq: e.seq ?? 0 }];
  });
}
/** The coordinator reads a compact, relevant projection plus pending inputs and Agent Status; not the full history. */
/** Program-owned receipt events preserve source identity for persistence/export; no fake model response. */
function publishDeliveryEvents(agent: any, card: WorkCard) {
  if (typeof agent?.session?.append !== "function") return;
  for (const receipt of card.delivery_receipts ?? []) {
    if (agent.session.events.some((e: any) => e.type === "user/message" && e.data?.id === receipt.id && e.data.source?.kind === "plugin" && e.data.source.plugin === "promax-delivery")) continue;
    agent.session.append("user/message", { id: receipt.id, role: "user", source: { kind: "plugin", plugin: "promax-delivery" }, content: [{ type: "text", text: `程序交付回执（不是员工输入）：${JSON.stringify(receipt)}` }] }, { surfaceOp: "append" });
  }
}
export function coordinatorContext(
  card: WorkCard,
  round: WorkRound | undefined,
  status: AgentStatus,
  current: ReadonlyArray<{ filename: string; current_sha256: string }>,
) {
  const brief = {
    title: card.title,
    goal: card.goal,
    ...(card.origin ? { origin: card.origin.text.slice(0, 800) } : {}),
    requirement_version: card.requirement_version ?? 0,
    materials: card.materials.map(({ reads: _reads, summary: _summary, ...m }) => m),
    confirmed: card.confirmed.map(confirmedWords),
    acceptance_baseline_version: (round?.acceptance_baseline ?? card.acceptance_baseline)?.version,
    completion: taskCompletion(card, round?.last_check?.acceptance_baseline, round?.last_check, Object.fromEntries(current.map((c) => [c.filename, c.current_sha256]))),
    decisions: activeDecisions(card).map((d) => ({ id: d.id, question: d.question, answer: d.answer, state: d.state, ...(d.affects?.length ? { affects: d.affects } : {}) })),
    suggestions: (card.suggestions ?? []).filter((s) => s.state !== "superseded").map((s) => ({ text: s.text, state: s.state ?? "proposed" })),
    pending: card.pending.map((p) => ({ id: p.id, question: p.question, ...(p.options?.length ? { options: p.options } : {}), ...(p.artifact ? { artifact: p.artifact } : {}), ...(p.location ? { location: p.location } : {}), timing: p.timing ?? "now", ...(p.blocking !== undefined ? { blocking: p.blocking } : {}) })),
    deliverables: card.deliverables.map((d) => ({ filename: d.filename, status: d.status, sha256: current.find((c) => c.filename === d.filename)?.current_sha256 ?? d.current_sha256 })),
    ...(card.spine ? { nodes: card.spine.nodes.map((n) => ({ id: n.id, title: n.title, filenames: n.filenames })) } : {}),
    last_progress: card.last_progress,
    delivery_receipt: card.delivery_receipts?.at(-1) ?? null,
    side_topics: (card.side_topics ?? []).filter((t) => !t.deferred).map((t) => t.text),
  };
  const lastCheck = round?.last_check ? { report: round.last_check.report, judge_round: round.last_check.judge_round, ...(round.last_check.verdict ? { verdict: round.last_check.verdict } : {}) } : null;
  const inputs = unprocessedEvents(card).map((e) => ({ id: e.id, channel: e.channel, priority: e.priority, ...(e.question_id ? { question_id: e.question_id } : {}), ...(e.choice ? { choice: e.choice } : {}), ...(e.intent ? { recorded_as: e.intent } : {}), text: e.text }));
  return [
    "## 当前工作（程序注入的相关摘要，内部上下文，不向员工复述标识）",
    YAML.stringify(brief),
    requirementsBrief(round?.effective_requirements ?? effectiveRequirements(card), round?.acceptance_baseline ?? card.acceptance_baseline, round?.acceptance_scope),
    `## 待处理输入（${inputs.length} 项；按优先级排列，每项都要在 promax_work_proposal 的 handled_events 中处理）`,
    inputs.length ? YAML.stringify(inputs) : "无",
    "## Agent Status（程序产生，只读）",
    YAML.stringify({
      control: CONTROL_LABEL[status.control],
      requirement_version: status.requirement_version,
      ...(status.execution_version !== undefined ? { execution_version: status.execution_version } : {}),
      steps: status.steps.map((st) => ({ step: st.label, control: CONTROL_LABEL[st.control], ...(st.recoveries ? { recoveries: `${st.recoveries.used}/${st.recoveries.limit}` } : {}), ...(st.detail ? { detail: st.detail.slice(0, 200) } : {}) })),
      blocks: status.blocks.map((b) => `${b.kind}: ${b.detail.slice(0, 160)}`),
      ...(status.resume ? { resume: status.resume } : {}),
      ...(status.recent_error ? { recent_error: status.recent_error.slice(0, 300) } : {}),
    }),
    `可采用信息交接（非成员结束；主 Agent 判断适用性并派工）：${JSON.stringify(Object.values(round?.receipts ?? {}).filter((r) => r.handoff).map((r) => ({ member: r.member, filename: r.filename, sha256: r.sha256, ...r.handoff })))}`,
    `本轮：${YAML.stringify(round ? { intent: round.turn.intent, deliverables: round.turn.deliverables, phase: round.phase ?? (round.task_key ? "generating" : "discussion"), started: round.source !== "proposal", judge_round: round.judge_round, repair_round: round.repair_round, task_key: round.task_key, last_check: lastCheck } : null)}`,
    round?.task_key && round.source !== "proposal"
      ? `本次任务包：.任务/${round.task_key}/任务包.yml${round.turn.edit_request ? `\n冻结修改源：.任务/${round.task_key}/修改源/${round.turn.edit_request.filename}，只改锚点 ${JSON.stringify(round.turn.edit_request.anchor)}；意见 ${round.turn.edit_request.instruction}` : ""}`
      : "尚未开始执行：不要调用业务成员或写成果。",
    lastCheck ? `最近检查报告（按需读取原文）：${lastCheck.report}` : "",
    "评分样本简洁交付不扩成全量长模板：安排成员先用promax_rating_facts取得统计，必要记录原文按需读。普通追问只回答并提交intent=answer，不新建任务/重评。材料替换沿用当前成果，仅更新程序版本对照指出的统计、相关结论和必要交叉影响；不合并新旧样本、不自动新增分析维度。Judge读取程序事实，不安排其手工重数。", 
  ].join("\n");
}

export async function apply(ctx: HostContext, config: Config): Promise<void> {
  if (config.chainContext?.enabled) {
    installRequestHealth(ctx as unknown as import("./request-health.ts").RuntimeHost);
    ctx.effect(() => installContextBudget(ctx as unknown as import("./request-health.ts").RuntimeHost, config.chainContext?.capacity), "promax-context-budget");
  }
  installDispatchControl(ctx as unknown as import("./request-health.ts").RuntimeHost, config.chainContext?.toolConfigVersion ?? BUNDLE_VERSION);
  // Company Feishu credentials and operational writes moved to Java. Personal MCPs use independent custom connections.
  installCustomMcpRuntime(ctx);
  const proxy = createApiProxy(config.apiBaseUrl);
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: API_PROXY_PREFIX,
        handler: proxy,
      }),
    "promax-api-proxy",
  );
  ctx.on("webserver/index-inject", (table) => {
    table.push({
      kind: "html",
      placement: "head",
      html: '<meta name="promax-api-base-url" content="/promax-api">',
    });
  });

  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  ctx.provide("promaxSessionPresetBinding", {
    resolve: (session: { header: { id: string; cwd?: string; parentSession?: string; agentPreset?: string }; events?: readonly unknown[] }) => resolveProductSessionPreset(dshHome, session),
  });
  const selectedPreset = (events?: readonly unknown[]) => [...(events ?? [])].reverse().find((event) =>
    !!event && typeof event === "object" && (event as { type?: unknown }).type === "agent-preset/selected",
  ) as { data?: { agentPreset?: string } } | undefined;
  const effectiveHeader = <T extends { id: string; cwd?: string; parentSession?: string; agentPreset?: string }>(header: T, events?: readonly unknown[]) => {
    const selected = selectedPreset(events)?.data?.agentPreset;
    return selected ? { ...header, agentPreset: selected } : header;
  };
  const sessionHeaderFor = async (id: string, cwd: string) => {
    const live = (ctx.agents.list() as unknown as Array<{ session: { header: { id: string; cwd?: string; agentPreset?: string; parentSession?: string }; events?: readonly unknown[] } }>).find((agent) => agent.session.header.id === id)?.session;
    const persistence = (ctx as unknown as { get(name: string): { inspect(id: string): Promise<{ meta: { id: string; cwd?: string; agentPreset?: string; parentSession?: string }; events: unknown[] }> } | undefined }).get("sessionPersistence");
    const saved = live ? undefined : await persistence?.inspect(id);
    const header = live?.header ?? saved?.meta;
    if (!header || header.cwd !== cwd) throw new Error(`会话 ${id} 缺少可核对的原始preset/工作区绑定`);
    return effectiveHeader(header, live?.events ?? saved?.events);
  };
  const dispatchPlanRoot = join(dshHome, ".promax", "dispatch-plans");
  // SAFETY: dsh provides the global prompt waterfall hook; the local HostContext only lists typed hooks used elsewhere.
  const promptHooks = ctx as unknown as {
    on(
      name: string,
      callback: (...args: any[]) => unknown,
      options?: { global: boolean },
    ): void;
  };
  promptHooks.on(
    "system-prompt/assemble",
    async (_assembly, context, next) => {
      const result = await next();
      const header = context.scope?.session?.header;
      const workStore = header?.cwd ? new WorkStore(header.cwd) : undefined;
      let work = workStore
        ? await workStore.forSession(header.parentSession ?? header.id)
        : undefined;
      if (work && workStore) {
        const workKey = work.work_key;
        if (!header.parentSession) {
          // Native pre-step is AFTER assembly. Settle before reading any delivery context, not afterwards.
          await settleAcceptedReview(workStore, work.work_key, ctx.get?.("promaxTelemetry"), ctx.get?.("promaxUploader"), context.signal).catch(error => { if (context.signal?.aborted) throw error; });
          work = (await workStore.read(work.work_key));
          publishDeliveryEvents(context.scope, work);
        }
        const round = await workStore.round(work.work_key);
        const current = new ContentObjectStore(header.cwd)
          .index()
          .artifacts.filter((a) => a.work_key === workKey);
        const persona =
          result.sections.find(
            (section: { name?: string }) =>
              section.name === "deployment:persona",
          )?.text ?? "";
        const member = header.parentSession
          ? [...String(persona).matchAll(PROMAX_MEMBER_ID_RE)][0]?.[1]
          : undefined;
        if (member || !header.parentSession) bindRuntimeRole(header.id, member ?? "coordinator");
        const status = deriveAgentStatus(work, round, await workStore.status(work.work_key));
        result.sections.push({ name: "promax-execution-facts", text: await executionFactsBrief(workStore, work.work_key, round?.task_key, config.chainContext?.toolConfigVersion ?? BUNDLE_VERSION) });
        result.sections.push({
          name: "promax-work",
          text: header.parentSession
            ? `${memberWorkContext(work, round, member)}${member === "quality_judge" ? `\n当前问题清单（逐项复查，不把历史结论当当前证据）：${JSON.stringify((await workStore.reviews(work.work_key)).issues.filter((i) => i.group === round?.review_group).map(({ history, ...issue }) => ({ ...issue, last_review: history.at(-1), history_path: `.工作/${workKey}/评审.yml` })))}` : ""}`
            : `${WORK_SYSTEM_PROMPT}\n\n${collaborationContext(work)}\n${coordinatorContext(work, round, status, current)}\n返修只能由你调用 promax_repair_plan 提交明确安排；不能根据 Judge owner 自动派工。`,
        });
      }
      const scope = executionTask({ name: "", agent: context.scope });
      if (!scope || !taskPaths(scope.cwd, scope.taskKey).modern) return result;
      const rewrite = (text: string): string => {
        for (const key of [scope.taskKey, "{task_key}"]) {
          text = text
            .replaceAll(
              `.promax/tasks/${key}/task-package.yml`,
              `.任务/${key}/任务包.yml`,
            )
            .replaceAll(`.promax/input/${key}/`, `.任务/${key}/输入/`)
            .replaceAll(`.promax/judge/${key}/judge.md`, `.任务/${key}/判定.md`)
            .replaceAll(`deliverables/${key}/`, `.任务/${key}/产物快照/`);
        }
        return text;
      };
      return {
        ...result,
        sections: result.sections.map((section: { text?: string }) => ({
          ...section,
          ...(typeof section.text === "string"
            ? { text: rewrite(section.text) }
            : {}),
        })),
      };
    },
    { global: true },
  );
  // The native driver appends assistant chunks/messages before turn-stopping. An
  // automatic Judge wake may need model tools to continue, but its free-form text
  // is not a delivery receipt. Gate that stream *before* either public append.
  const guardedAutomatic = new Set<string>();
  // agent/request is the native loop's request boundary. The bundle may resolve
  // a different dsh-llm instance than the host, whose loop marker is process-local;
  // correlate the loop's own signal instead of trusting a cross-package WeakSet.
  const guardedRequests = new Map<string, AbortSignal>();
  promptHooks.on("agent/request", async (payload, next) => {
    const config = await next();
    const id = payload.agent.session.header.id;
    if (guardedAutomatic.has(id)) guardedRequests.set(id, payload.signal);
    return config;
  }, { global: true });
  promptHooks.on("agent/status", ({ agent, status }) => {
    if (status !== "idle") return;
    guardedAutomatic.delete(agent.session.header.id);
    guardedRequests.delete(agent.session.header.id);
  }, { global: true });
  promptHooks.on("llm/stream", (options, next) => {
    if (options.purpose !== undefined || !options.sessionId || !guardedRequests.has(options.sessionId) || guardedRequests.get(options.sessionId) !== options.signal) return next();
    return (async function* () {
      const textBlocks = new Set<number>();
      for await (const chunk of next()) {
        if (chunk.type === "block-start" && chunk.blockType === "text") { textBlocks.add(chunk.index); continue; }
        if (chunk.type === "text-delta" && textBlocks.has(chunk.index)) continue;
        if (chunk.type === "block-end" && textBlocks.delete(chunk.index)) continue;
        yield chunk;
      }
    })();
  }, { global: true });
  promptHooks.on("agent/pre-step", async (payload, next) => {
    const h = payload.agent.session.header;
    if (!h.cwd || h.parentSession) return next();
    const store = new WorkStore(h.cwd), card = await store.forSession(h.id);
    if (!card) return next();
    guardedRequests.delete(h.id); // A claimed boundary invalidates the previous model request.
    const round = await store.round(card.work_key);
    const automatic = (m: any) => ["subagent-settled", "subagent-report"].includes(m.source?.kind) && !!round?.children?.[m.source.senderSessionId];
    const notices = payload.messages.some(automatic);
    if (!round?.delivery && round?.source !== "proposal" && notices) {
      guardedAutomatic.add(h.id);
      const progress = "部分完成 · 自动通知已到达，交付尚未结算；已有成果保留，不代表正式完成";
      if (card.last_progress !== progress) await store.progress(card.work_key, progress);
      // Native Inbox.claim joins next-step employee input with a next-turn notice.
      // Give the automatic wake its guarded tool turn, then answer the original
      // employee messages in their own unguarded turn without inventing new input.
      const employees = payload.messages.filter((m: any) => m.source?.kind === "user");
      if (employees.length) {
        for (const message of employees) payload.agent.followup(message);
        const decision = await next();
        const deferred = new Set(employees.map((m: any) => m.id));
        return decision.kind !== "enter" ? decision : { ...decision, messages: decision.messages.filter((m: any) => !deferred.has(m.id)) };
      }
    }
    // A later employee-only boundary is an ordinary conversation, not an automatic delivery.
    else if (round?.delivery || round?.source === "proposal" || payload.messages.some((m: any) => m.source?.kind === "user")) guardedAutomatic.delete(h.id);
    // A terminal Judge result is not a delivery: digest, input or reviewed bytes may still block settlement.
    // Let the native turn-stopping path handle those branches instead of consuming its only wake.
    if (!round?.delivery || round.source === "proposal") return next();
    if (!notices) return next();
    publishDeliveryEvents(payload.agent, await store.read(card.work_key));
    // Only consume the automatic wake. Never reject a batch containing a real employee message.
    const userMessages = payload.messages.filter((m: any) => !automatic(m));
    if (!userMessages.length) return { kind: "complete" };
    const decision = await next();
    return decision.kind !== "enter" ? decision : { ...decision, messages: decision.messages.filter((m: any) => !automatic(m)) };
  }, { global: true });
  const teamContract = async (header: { id: string; cwd?: string; parentSession?: string; agentPreset?: string }, events?: readonly unknown[]) => {
    const bound = effectiveHeader(header, events);
    return dispatchTeamFromRevision((await productRevisionForSession(dshHome, bound.agentPreset ? bound : await sessionHeaderFor(header.id, header.cwd ?? ""))).revision);
  };
  const structuredDeps: StructuredDeps = {
    contract: (exec) => teamContract(exec.agent!.session.header, exec.agent!.session.events),
    member: async (exec) => {
      const childCtx = (exec.agent as unknown as { ctx?: ChildAgentContext } | undefined)?.ctx;
      return childCtx ? childPromaxMemberId(childCtx).catch(() => undefined) : undefined;
    },
    runtimeVersion: BUNDLE_VERSION,
  };
  // Structured submissions are Promax adapter tools; acceptance is committed only after the authoritative result.
  ctx.effect(() => {
    const disposers = [...structuredToolDefinitions(structuredDeps), ratingFactsTool()].map((definition) =>
      ctx.tools.register(definition as unknown as MappedToolDefinition),
    );
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "promax-structured-results");
  promptHooks.on(
    "tools/result",
    (exec: { name: string; callId: string; agent?: unknown }, result: { isError: boolean }) => {
      const reservation = takeContinuationReservation(exec);
      if (reservation) releaseContinuationReservation(reservation);
      if (!STRUCTURED_TOOLS.includes(exec.name)) return undefined;
      void commitStructuredSubmission(exec as Parameters<typeof commitStructuredSubmission>[0], result, structuredDeps).catch(() => undefined);
      return undefined;
    },
    { global: true },
  );
  ctx.on("tools/pre-execute", async (exec, next) => {
    const policyVersion = config.chainContext?.toolConfigVersion ?? BUNDLE_VERSION;
    const unavailable = await knownToolFailure(exec, policyVersion);
    return unavailable ?? enforceDispatchPlanTool(dispatchPlanRoot, exec, next, policyVersion);
  });
  promptHooks.on(
    "tools/post-execute",
    async (exec, result, next) => {
      const decision = await next();
      // Revalidate success using the current native schema, but never render it as a fresh delivery.
      // Reservation settlement belongs to tools/result, including normalization/middleware failures that skip here.
      if (reusedDispatch(exec)) return result.isError || decision?.kind === "block" ? decision
        : { ...decision, kind: "accept", content: [{ type: "text", text: `已沿用原动作进度/结果，本次未再次投递或创建成员：${JSON.stringify(result.value)}` }] };
      await recordWorkChild(exec, result);
      if (config.chainContext?.enabled) await recordToolHealth(exec, result, config.chainContext.toolConfigVersion ?? BUNDLE_VERSION);
      const h = exec.agent?.session.header;
      if (h?.cwd) {
        const store = new WorkStore(h.cwd), work = await store.forSession(h.parentSession ?? h.id);
        if (work) {
          if (exec.name === "quality_judge") pendingJudgeDispatches.delete(`${h.cwd}:${work.work_key}`);
          const args = (exec.arguments ?? {}) as Record<string, unknown>;
          if (!result.isError && !h.parentSession && (exec.name === "send_message" || work.deliverables.some((d) => d.member_id === exec.name) || exec.name === "quality_judge"))
            await store.observe(work.work_key, { id: `dispatched:${exec.callId}`, kind: "dispatch_tool_returned", at: new Date().toISOString(), task_key: (await store.round(work.work_key))?.task_key, call_id: exec.callId });
          if (!result.isError && ["write", "edit", "bash"].includes(exec.name)) {
            const round = await store.round(work.work_key), member = round?.children?.[h.id];
            if (round?.task_key && member) await store.observeDrafts(work.work_key, round.task_key, member);
          }
          if (h.parentSession) {
            childWorkBindings.set(h.id, { workspace: h.cwd, key: work.work_key });
            const message = result.isError ? `${exec.name}失败；本步骤未完成`
              : exec.name === "report" ? eventTexts(args.content).join("\n") || String(args.output ?? args.message ?? args.text ?? "阶段回报")
              : exec.name === "read" ? `读取 ${basename(String(args.path ?? args.file_path ?? "材料"))} · 起始 ${Number(args.offset ?? 1)}${typeof args.limit === "number" ? `，请求 ${args.limit} 行` : "，返回范围以工具为准"}；不据此宣称通读`
              : exec.name === MEMBER_RECEIPT_TOOL ? `提交成果回执 ${String(args.filename ?? "")}：${String(args.summary ?? "")}（接受状态以工作记录为准）`
              : `${exec.name}完成`;
            await store.executionEvent(work.work_key, h.id, { id: String((exec as { callId?: string }).callId ?? `${exec.name}:${Date.now()}`), at: new Date().toISOString(), kind: exec.name === "report" ? "report" : "tool", text: executionSummary(message), ...(result.isError ? { failed: true } : {}) });
          }
          if (exec.name === "read" && !result.isError && typeof (args.path ?? args.file_path) === "string")
            await store.materialRead(work.work_key, h.id, String((exec as { callId?: string }).callId ?? ""), String(args.path ?? args.file_path), { ...(typeof args.offset === "number" ? { offset: args.offset } : {}), ...(typeof args.limit === "number" ? { limit: args.limit } : {}) });
          // Continuation dispatch events are recorded at native inbox acceptance, not from the caller's return value.
        }
      }
      return decision;
    },
    { global: true },
  );
  promptHooks.on("subagent/start", (info) => {
    childRunIds.set(info.id, info.runId);
  }, { global: true });
  promptHooks.on("agent/inbox/inserted", ({ agent, message }) => {
    const h = agent.session.header;
    const reservation = continuationOwners.get(h.id);
    if (!reservation || reservation.parent !== h.parentSession || reservation.workspace !== h.cwd
      || message.source?.kind !== "coordinator" || message.source.senderSessionId !== reservation.parent) return;
    reservation.accepted = message.id;
    childWorkBindings.set(h.id, { workspace: reservation.workspace, key: reservation.key });
    endedWorkChildren.delete(h.id);
    activeWorkChildren.add(h.id);
    // Enqueue immediately, before any await: the subsequent native end queues after this accepted dispatch.
    return new WorkStore(reservation.workspace).executionEvent(reservation.key, h.id, {
      id: `continue:${message.id}`, at: new Date().toISOString(), kind: "dispatch", text: "原成员已受理当前授权续接；调用方取消不撤回已受理工作",
    }, "running");
  }, { global: true });
  promptHooks.on(
    "subagent/end",
    async (info) => {
      if (childRunIds.has(info.id) && childRunIds.get(info.id) !== info.runId) return;
      // Keep the epoch as a tombstone so repeated/late old ends cannot affect a later activation.
      continuationOwners.delete(info.id);
      activeWorkChildren.delete(info.id);
      endedWorkChildren.add(info.id);
      const binding = childWorkBindings.get(info.id);
      if (binding) {
        const reason = String(info.stopReason ?? "unknown");
        const state = /cancel|interrupt|aborted/u.test(reason) ? "stopped" : /error|fail|limit|max-tokens|refusal/u.test(reason) ? "failed" : "done";
        const store = new WorkStore(binding.workspace);
        await store.executionEvent(binding.key, info.id, { id: `end:${info.runId ?? Date.now()}`, at: new Date().toISOString(), kind: "result", text: executionSummary(eventTexts(info.lastAssistantMessage).join("\n") || `成员执行结束：${reason}`) }, state);
        await settleStructuredCommits(binding.workspace);
        if (activeWorkChildren.has(info.id) || (childRunIds.has(info.id) && childRunIds.get(info.id) !== info.runId)) return;
        if ((await store.round(binding.key))?.children?.[info.id] === "quality_judge") {
          try { await settleAcceptedReview(store, binding.key, ctx.get?.("promaxTelemetry"), ctx.get?.("promaxUploader")); }
          finally {
            const card = await store.read(binding.key);
            const parent = ctx.agents.list().find(a => a.session.header.id === card.session_id);
            if (parent) publishDeliveryEvents(parent, card);
          }
        }
      }
    },
    { global: true },
  );
  ctx.on("agent/turn-stopping", async (payload) => {
    const header = payload.agent.session.header;
    if (header.cwd && header.origin !== "subagent") {
      const store = new WorkStore(header.cwd),
        work = await store.forSession(header.id);
      if (work) {
        const round = await store.round(work.work_key);
        if (
          round?.source === "proposal" &&
          (round.check_only || round.turn.intent === "edit")
        )
          return;
        if (round?.source === "proposal") {
          await settleStructuredCommits(store.workspace);
          const events = payload.agent.session.events;
          await store.recordUsage(work.work_key, turnUsage(events));
          const latest = (await store.round(work.work_key)) ?? round;
          const lastUser = [...events].reverse().find((e) => e.type === "user/message");
          const assistant = [...events].reverse().find((e) => e.type === "assistant/message");
          const structured = !!latest.structured && latest.structured.seq >= (lastUser?.seq ?? 0);
          const text = assistant ? assistantEventText(assistant) : "";
          if (!structured && assistant && hasWorkBlock(text))
            // Historical sessions: a text block can still update the draft, but it never classifies employee inputs.
            await store
              .propose(work.work_key, text, assistant.seq ?? 0, await teamContract(header, events), employeeMessagesOf(events))
              .catch(() => undefined);
          const open = unprocessedEvents(await store.read(work.work_key));
          const overdue = open.filter((e) => (e.attempts ?? 0) >= 2);
          await store.failEvents(work.work_key, overdue.map((e) => e.id), "主 Agent 多次没有给出处理结果；原文已保留，可重新发送");
          const remaining = open.filter((e) => (e.attempts ?? 0) < 2);
          if (!remaining.length) return;
          const failure = await store.noteFailure(work.work_key, {
            step: "coordinator",
            class: "proposal_invalid",
            evidence: `turn:${assistant?.seq ?? lastUser?.seq ?? 0}`,
            reason: structured ? `结构化提交没有处理 ${remaining.length} 项员工输入` : "本轮回复没有通过 promax_work_proposal 处理员工输入",
            strategy: "只调用 promax_work_proposal 补交结构化结果，不重复正文",
            at: new Date().toISOString(),
            runtime_version: BUNDLE_VERSION,
          });
          if (failure.decision === "exhausted") {
            await store.failEvents(work.work_key, remaining.map((e) => e.id), `未能被理解：结构化提交已自动恢复 ${RECOVERY_LIMIT} 次仍失败，原文已保留，平台待修复`);
            await reportWorkFault(store, work.work_key, ctx.get?.("promaxUploader"), "coordinator");
            return;
          }
          if (failure.duplicate) return;
          await store.markEventsAttempted(work.work_key, remaining.map((e) => e.id));
          steerText(
            payload,
            `自动恢复（${Math.min(failure.fault.attempts, RECOVERY_LIMIT)}/${RECOVERY_LIMIT}）：以下员工输入还没有结构化处理。不要重复正文，只调用 promax_work_proposal，在 handled_events 中逐项处理：${remaining.map((e) => `${e.id}${e.question_id ? `（回答问题 ${e.question_id}）` : ""}「${e.text.slice(0, 120)}」`).join("；")}。`,
          );
          return;
        }
      }
    }
    // Historical execution compatibility; proposals only come from committed native events.
    await enforceConfirmedDispatchCompleteness(
      dispatchPlanRoot,
      payload,
      ctx.get?.("promaxTelemetry"),
      ctx.get?.("promaxUploader"),
    );
    if (header.cwd && header.origin !== "subagent") {
      const store = new WorkStore(header.cwd),
        work = await store.forSession(header.id);
      const event = [...payload.agent.session.events]
        .reverse()
        .find((e) => e.type === "assistant/message");
      if (work) await store.recordUsage(work.work_key, turnUsage(payload.agent.session.events));
      if (work && event && hasWorkBlock(assistantEventText(event)))
        await store
          .noteAssistant(work.work_key, assistantEventText(event), await teamContract(header, payload.agent.session.events), employeeMessagesOf(payload.agent.session.events))
          .catch(() => undefined);    }
    if (header.cwd && header.origin !== "subagent") {
      const store = new WorkStore(header.cwd),
        card = await store.forSession(header.id),
        uploader = ctx.get?.("promaxUploader");
      if (card && uploader) {
        uploader.reportWork(header.cwd, card);
        const round = await store.round(card.work_key);
        if (round?.phase === "ended" && round.task_key) {
          const entries = new ContentObjectStore(header.cwd)
            .index()
            .artifacts.filter((a) => a.work_key === card.work_key);
          for (const entry of entries)
            await uploader.reportArtifactVersion(
              header.cwd,
              card.project_id,
              entry,
            );
          if (round.judge_round && round.reviewed_hashes) {
            let reportText = "";
            try {
              reportText = await readFile(
                join(
                  header.cwd,
                  ".任务",
                  round.task_key,
                  `判定-r${round.judge_round}.md`,
                ),
                "utf8",
              );
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
            }
            const report = parseJudgeReport(reportText, {
              hashes: round.reviewed_hashes,
              scope: round.check_scope ?? "",
              round: round.judge_round,
            }).report;
            if (report)
              for (const reviewed of report.reviewed_artifacts) {
                const entry = entries.find(
                    (a) => a.filename === reviewed.filename,
                  ),
                  version = entry?.versions.findLast(
                    (v) => v.sha256 === reviewed.sha256,
                  );
                if (entry && version)
                  uploader.reportCheckReport(header.cwd, {
                    project_id: card.project_id,
                    report_id: workId(
                      card.project_id,
                      `${round.task_key}:${round.judge_round}:${entry.artifact_id}`,
                    ),
                    work_id: workId(card.project_id, card.work_key),
                    artifact_id: entry.artifact_id,
                    version_id: artifactVersionId(entry, version),
                    trace_id:
                      ctx.get?.("promaxTelemetry")?.traceId(header.id) ??
                      (() => {
                        throw new Error("检查缺少本次运行记录");
                      })(),
                    created_at: round.check_results?.[String(round.judge_round)]?.at ?? card.updated_at,
                    report: uploadedJudgeReport(report),
                  });
              }
          }
        }
      }
    }
    await saveGeneratedDispatchPlan(dispatchPlanRoot, payload.agent.session);
  });
  const generalWorkspacePath = resolve(
    process.env.PROMAX_GENERAL_WORKSPACE?.trim() ||
      join(dshHome, "workspaces", "general"),
  );
  const projectRoot = resolve(
    process.env.PROMAX_PROJECT_ROOT?.trim() || join(homedir(), "Promax"),
  );
  const compatibilityProductPath = resolve(
    process.env.PROMAX_PRODUCT_WORKSPACE?.trim() || join(projectRoot, "产品"),
  );
  const knownWorkspaces = new Map<string, WorkspaceRecord>();
  const recycle = await createRecycleBin(ctx, projectRoot, dshHome);
  ctx.effect(
    () => () => {
      recycle.dispose();
    },
    "promax-recycle-bin",
  );
  ctx.on("tools/pre-execute", (exec, next) => {
    recycle.assertAllowed({
      sessionId: exec.agent?.session.header.id,
      cwd: exec.agent?.session.header.cwd,
    });
    return next();
  });

  await mkdir(generalWorkspacePath, { recursive: true });
  const general = await ctx.workspaceRegistry.create(
    generalWorkspacePath,
    "通用",
  );
  knownWorkspaces.set(general.id, general);
  const auth = ctx.promaxAuth;
  const companyFeishu = installCompanyFeishu(
    ctx,
    config.feishuMcpUrl ??
      (config.apiBaseUrl.startsWith("https://")
        ? `${new URL(config.apiBaseUrl).origin}/mcp/feishu`
        : "https://localhost:3443/mcp/feishu"),
  );
  const company = installCompanyConnection(ctx, auth);
  await company.refresh();
  const owner = {
    employee_id: "personal",
    name: "个人",
    role: "owner" as const,
  };
  const product = recycle.wasDeleted(compatibilityProductPath)
    ? undefined
    : await ensureProjectWorkspace(
        ctx.workspaceRegistry,
        resolve(compatibilityProductPath, ".."),
        basename(compatibilityProductPath),
        owner,
      );
  if (product !== undefined) knownWorkspaces.set(product.id, product);
  for (const project of await registerProjectWorkspaces(
    ctx.workspaceRegistry,
    projectRoot,
    owner,
  ))
    knownWorkspaces.set(project.id, project);
  ctx.on("webserver/index-inject", (table) => {
    table.push({
      kind: "html",
      placement: "head",
      html: `<meta name="promax-projects" content="${encodeURIComponent(JSON.stringify({ root: projectRoot, defaultWorkspaceId: product?.id }))}"><meta name="promax-bundle-runtime" content="${encodeURIComponent(JSON.stringify(BUNDLE_LOAD_IDENTITY))}">`,
    });
  });

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: WORKSPACE_API_PREFIX,
        handler: async (request, response) => {
          let release: (() => void) | undefined;
          try {
            if (request.method !== "POST") {
              writeJson(response, 405, { error: "只接受 POST 请求" });
              return;
            }
            const path = requestPath(request);
            const input = path.endsWith("/attachments")
              ? await readJson(
                  request,
                  MAX_ATTACHMENT_REQUEST_BYTES,
                  "附件总大小不能超过 20 MiB",
                )
              : await readJson(request);

            if (path.startsWith(`${WORKSPACE_API_PREFIX}/recycle/`)) {
              if (
                !request.headers["content-type"]?.startsWith(
                  "application/json",
                ) ||
                request.headers["sec-fetch-site"] === "cross-site" ||
                (request.headers.origin !== undefined &&
                  new URL(request.headers.origin).host !== request.headers.host)
              )
                throw new Error("回收站只接受当前 Promax 页面的 JSON 请求");
              const target: DeleteTarget = {
                kind: input.kind as DeleteTarget["kind"],
                workspaceId: String(input.workspaceId ?? ""),
                ...(typeof input.sessionId === "string"
                  ? { sessionId: input.sessionId }
                  : {}),
              };
              const operation = path.slice(
                `${WORKSPACE_API_PREFIX}/recycle/`.length,
              );
              const result =
                operation === "list"
                  ? recycle.list()
                  : operation === "preview"
                    ? await recycle.preview(target)
                    : operation === "delete"
                      ? await recycle.remove(
                          target,
                          String(input.revision ?? ""),
                        )
                      : operation === "restore"
                        ? await recycle.restore(String(input.id ?? ""))
                        : operation === "purge"
                          ? await recycle.purge(String(input.id ?? ""))
                          : undefined;
              if (result === undefined) throw new Error("未知回收站操作");
              writeJson(response, 200, { ...result });
              return;
            }
            if (path.startsWith(`${WORKSPACE_API_PREFIX}/company/`)) {
              if (
                !request.headers["content-type"]?.startsWith(
                  "application/json",
                ) ||
                request.headers["sec-fetch-site"] === "cross-site" ||
                (request.headers.origin !== undefined &&
                  new URL(request.headers.origin).host !== request.headers.host)
              )
                throw new Error("公司连接只接受当前 Promax 页面的 JSON 请求");
              const action = path.slice(
                `${WORKSPACE_API_PREFIX}/company/`.length,
              );
              if (action === "login") await auth.login(String(input.key ?? ""));
              // The password only passes through to the identity service; it is never stored or echoed back.
              else if (action === "password-login")
                await auth.loginWithPassword(
                  String(input.account ?? ""),
                  String(input.password ?? ""),
                );
              else if (action === "logout") await auth.logout();
              else if (action === "select-model")
                await company.select(String(input.id ?? ""));
              else if (action === "refresh") await auth.accessToken();
              else if (action === "open-project") {
                await auth.accessToken();
                const project = auth
                  .snapshot()
                  .projects.find((p) => p.project_id === input.projectId);
                if (!project)
                  throw new PromateError(
                    "PROJECT_ACCESS_DENIED",
                    "当前账号没有该项目的访问权限",
                    403,
                  );
                await auth.authorizeProject(project.project_id);
                const workspace = await openCompanyProject(
                  ctx.workspaceRegistry,
                  projectRoot,
                  project,
                  auth.identity().employee_id,
                  recycle,
                );
                knownWorkspaces.set(workspace.id, workspace);
                writeJson(response, 200, {
                  workspaceId: workspace.id,
                  path: workspace.path,
                  title: workspace.title,
                  sessionIds: [...workspace.sessionIds],
                });
                return;
              } else if (action !== "status")
                throw new Error("未知公司连接操作");
              await company.refresh();
              writeJson(response, 200, {
                ...company.snapshot(),
                companyWorkspaces: await companyWorkspaces(projectRoot),
              });
              return;
            }
            const requestedWorkspace =
              typeof input.workspaceId === "string"
                ? (ctx.workspaceRegistry.get?.(input.workspaceId) ??
                  knownWorkspaces.get(input.workspaceId))
                : undefined;
            const requestedPath =
              requestedWorkspace?.path ??
              (typeof input.projectPath === "string"
                ? resolve(input.projectPath)
                : undefined);
            const mapping =
              requestedPath &&
              (await companyWorkspaces(projectRoot)).find(
                (row) => row.path === requestedPath,
              );
            if (mapping) await auth.authorizeProject(mapping.projectId);
            if (path === `${WORKSPACE_API_PREFIX}/task-trace/read`) {
              if (
                !request.headers["content-type"]?.startsWith(
                  "application/json",
                ) ||
                request.headers["sec-fetch-site"] === "cross-site" ||
                (request.headers.origin !== undefined &&
                  new URL(request.headers.origin).host !== request.headers.host)
              )
                throw new PromateError(
                  "ORIGIN_DENIED",
                  "运行记录只接受当前 Promax 页面的 JSON 请求",
                  403,
                );
              if (
                !requestedWorkspace ||
                (typeof input.projectPath === "string" &&
                  resolve(input.projectPath) !==
                    resolve(requestedWorkspace.path))
              )
                throw new PromateError("INVALID_WORKSPACE", "目标项目无效");
              if (auth.snapshot().loggedIn) await auth.accessToken();
              const result = readTaskTraces(
                requestedWorkspace.path,
                {
                  sessionId: String(input.sessionId ?? ""),
                  ...(typeof input.traceId === "string"
                    ? { traceId: input.traceId }
                    : {}),
                },
                auth.traceAccess(),
              );
              writeJson(response, 200, result);
              return;
            }
            if (/\/(?:work|artifact|check)\//u.test(path)) {
              if (
                !request.headers["content-type"]?.startsWith(
                  "application/json",
                ) ||
                request.headers["sec-fetch-site"] === "cross-site" ||
                (request.headers.origin !== undefined &&
                  new URL(request.headers.origin).host !== request.headers.host)
              )
                throw new PromateError(
                  "ORIGIN_DENIED",
                  "只接受当前 Promax 页面的 JSON 请求",
                  403,
                );
              if (
                !requestedWorkspace ||
                (typeof input.projectPath === "string" &&
                  resolve(input.projectPath) !==
                    resolve(requestedWorkspace.path))
              )
                throw new PromateError(
                  "INVALID_WORKSPACE",
                  "目标项目无效",
                  403,
                );
              if (mapping)
                await auth.authorizeProject(
                  mapping.projectId,
                  /\/(?:work\/(?:list|read|member|inspect)|artifact\/(?:versions|read-version|status))$/u.test(
                    path,
                  )
                    ? "read"
                    : "write",
                );
              const store = new WorkStore(requestedWorkspace.path);
              const key = String(input.work_key ?? "");
              const uploader = ctx.get?.("promaxUploader");
              if (path.includes("/artifact/")) {
                const operation = path.split("/").at(-1)!;
                if (operation === "status" || operation === "retry") {
                  const card = await store.read(key),
                    objects = new ContentObjectStore(requestedWorkspace.path);
                  const entry = objects
                    .index()
                    .artifacts.find(
                      (a) =>
                        a.work_key === key && a.filename === input.filename,
                    );
                  const version = entry?.versions.findLast(
                    (v) => v.sha256 === input.version_sha256,
                  );
                  if (!entry || !version) throw new Error("成果版本不存在");
                  const reportKey = reportKeys.version(
                    card.project_id,
                    entry.artifact_id,
                    artifactVersionId(entry, version),
                  );
                  if (operation === "retry") {
                    if (!uploader) throw new Error("上传服务未连接");
                    uploader.retryReport(card.project_id, reportKey);
                  }
                  writeJson(
                    response,
                    200,
                    uploader
                      ? {
                          ...(await uploader.reportStatus(
                            card.project_id,
                            reportKey,
                          )),
                        }
                      : { state: "not_queued" },
                  );
                  return;
                }
                const result = await artifactOperation(
                  requestedWorkspace.path,
                  operation,
                  input,
                  auth.snapshot().loggedIn
                    ? auth.identity().employee_id
                    : "personal",
                );
                if (["save-human-edit", "restore"].includes(operation)) {
                  const card = await store.read(key),
                    entry = new ContentObjectStore(requestedWorkspace.path)
                      .index()
                      .artifacts.find(
                        (a) =>
                          a.work_key === key && a.filename === input.filename,
                      )!;
                  await store.progress(key, "人工版本已保存 · 未检查", {
                    [entry.filename]: entry.current_sha256,
                  });
                  if (uploader) {
                    uploader.reportWork(
                      requestedWorkspace.path,
                      await store.read(key),
                    );
                    await uploader.reportArtifactVersion(
                      requestedWorkspace.path,
                      card.project_id,
                      entry,
                    );
                  }
                }
                writeJson(response, 200, result);
                return;
              }
              if (path.endsWith("/check/request")) {
                const card = await store.read(key),
                  prior = await store.round(key);
                if (prior?.task_key && prior.phase !== "ended")
                  throw new PromateError(
                    "RUN_CONFLICT",
                    "当前执行尚未结束",
                    409,
                  );
                if (
                  !Array.isArray(input.filenames) ||
                  !input.filenames.length ||
                  !input.filenames.every(
                    (f) =>
                      typeof f === "string" &&
                      card.deliverables.some((d) => d.filename === f),
                  ) ||
                  typeof input.scope !== "string" ||
                  !input.scope.trim()
                )
                  throw new Error("检查范围无效");
                await store.writeRound(key, {
                  revision: randomUUID(),
                  event_seq: prior?.event_seq ?? -1,
                  source: "proposal",
                  phase: "generating",
                  check_only: true,
                  ...(prior?.previous_check
                    ? { previous_check: prior.previous_check }
                    : {}),
                  check_scope: input.scope,
                  demand: input.scope,
                  attachments: [],
                  unverified: [],
                  turn: {
                    intent: "execute",
                    card_patch: {},
                    deliverables: input.filenames as string[],
                    edit_request: null,
                  },
                });
                writeJson(response, 200, { requested: true, work_key: key });
                return;
              }
              if (path.endsWith("/work/list")) {
                writeJson(response, 200, { items: await store.list() });
                return;
              }
              if (path.endsWith("/work/inspect")) {
                const card = await store.read(key);
                if (!requestedWorkspace.sessionIds.includes(card.session_id)) throw new PromateError("SESSION_DENIED", "父工作不属于当前项目", 403);
                writeJson(response, 200, await store.inspectFile(key, { kind: input.kind, id: input.id, filename: input.filename, sha256: input.sha256 }));
                return;
              }
              if (path.endsWith("/work/member")) {
                const card = await store.read(key);
                if (!requestedWorkspace.sessionIds.includes(card.session_id)) throw new PromateError("SESSION_DENIED", "父工作不属于当前项目", 403);
                const entry = (await store.executions(key)).find((e) => e.parent_session === card.session_id && e.session_id === input.child_id && e.task_key === input.task_key);
                if (!entry) throw new PromateError("SESSION_DENIED", "不是本工作的真实子会话", 403);
                writeJson(response, 200, { execution: entry });
                return;
              }
              if (path.endsWith("/work/metrics")) {
                const card = await store.read(key);
                if (!requestedWorkspace.sessionIds.includes(card.session_id)) throw new PromateError("SESSION_DENIED", "父工作不属于当前项目", 403);
                const evaluation = input.judge_evaluation;
                if (evaluation !== undefined && (!evaluation || typeof evaluation !== "object" || typeof (evaluation as Record<string, unknown>).references_yaml !== "string" || typeof (evaluation as Record<string, unknown>).observations_yaml !== "string")) throw new Error("judge_evaluation 需要 references_yaml 与 observations_yaml；仅本地读取计算，不登记参考标签");
                writeJson(response, 200, await workMetrics(requestedWorkspace.path, key, evaluation as { references_yaml: string; observations_yaml: string } | undefined));
                return;
              }
              if (path.endsWith("/work/read")) {
                let card = key
                  ? await store.read(key)
                  : await store.forSession(sessionIdOf(input.sessionId));
                let round = card ? await store.round(card.work_key) : undefined;
                if (card && round?.delivery) {
                  await store.refreshDelivery(card.work_key, settlementInFlight(deliveryKey(store.workspace, card.work_key, round.delivery.task_key)));
                  card = await store.read(card.work_key);
                  round = await store.round(card.work_key);
                  const parent = ctx.agents.list().find(a => a.session.header.id === card!.session_id);
                  if (parent) publishDeliveryEvents(parent, card);
                }
                const files =
                  card && round?.task_key
                    ? await readTaskRunFiles(requestedWorkspace.path, {
                        sessionId: card.session_id,
                        taskKey: round.task_key,
                      })
                    : undefined;
                // Status, outcomes and delivery states are read from the same records the coordinator and uploader use.
                const stored = card ? await store.status(card.work_key) : undefined;
                if (card && stored && uploader)
                  for (const fault of stored.faults)
                    if (fault.report?.state === "pending" && fault.report.key) {
                      const delivery = await uploader.reportStatus(card.project_id, fault.report.key).catch(() => undefined);
                      if (delivery?.state === "confirmed" || delivery?.state === "failed")
                        await store.updateStatus(card.work_key, (s) => {
                          const target = s.faults.find((f) => f.key === fault.key && f.first_at === fault.first_at);
                          if (target?.report) target.report = { ...target.report, state: delivery.state as "confirmed" | "failed", at: new Date().toISOString() };
                        });
                    }
                const status = card ? deriveAgentStatus(card, round, await store.status(card.work_key)) : null;
                const observations = card ? (await store.observations(card.work_key)).filter((e) => (e.task_key ?? null) === (round?.task_key ?? null)) : [];
                const health = selectRequestProgress(observations, round?.task_key);
                writeJson(response, 200, {
                  card: card ?? null,
                  round: round ?? null,
                  request_health: health,
                  context_budget: observations.findLast((e) => e.kind === "request_context") ?? null,
                  health_blocked: stored?.faults.some((f) => f.task_key === round?.task_key && f.class === "request_exhausted" && f.state !== "resolved") || observations.some((e) => e.kind === "tool_unavailable" && !observations.some((r) => r.kind === "tool_health_reset" && r.tool === e.tool && r.at >= e.at)),
                  status,
                  reviews: card ? await store.reviews(card.work_key) : null,
                  members: card ? (await store.executions(card.work_key)).filter((e) => e.parent_session === card.session_id && e.task_key === round?.task_key).map(({ events: _events, ...e }) => e) : [],
                  status_write_error: card ? (store.statusWriteFailure(card.work_key) ?? null) : null,
                  recording_error: card && store.recordingHealth(card.work_key).status === "incomplete" ? store.recordingHealth(card.work_key) : null,
                  outcomes: card
                    ? new ContentObjectStore(requestedWorkspace.path)
                        .index()
                        .artifacts.filter((a) => a.work_key === card.work_key)
                        .map((a) => ({ filename: a.filename, versions: a.versions.map((v) => ({ sha256: v.sha256, created_at: v.created_at, ...(v.task_key ? { task_key: v.task_key } : {}), ...(v.kind ? { kind: v.kind } : {}) })) }))
                    : [],
                  live: Object.keys(round?.children ?? {}).some((id) =>
                    activeWorkChildren.has(id),
                  ),
                  progress:
                    files?.artifactStates.map((a) => ({
                      filename: basename(a.path),
                      member_id: a.memberId,
                      present: a.nonEmpty,
                    })) ?? [],
                });
                return;
              }
              if (path.endsWith("/work/card/update")) {
                if (input.action === "create") {
                  const sessionId = sessionIdOf(input.sessionId);
                  if (!requestedWorkspace.sessionIds.includes(sessionId))
                    throw new PromateError(
                      "SESSION_DENIED",
                      "会话不属于当前项目",
                      403,
                    );
                  const title = String(input.title ?? "").trim();
                  const card = await store.create({
                    session_id: sessionId,
                    project_id:
                      (mapping ? mapping.projectId : undefined) ??
                      `local:${createHash("sha256").update(requestedWorkspace.path).digest("hex")}`,
                    title,
                    shortname: taskKeyFromSubmission(title, []),
                  });
                  uploader?.reportWork(requestedWorkspace.path, card);
                  writeJson(response, 200, { card });
                  return;
                }
                const card = await store.read(key);
                if (input.action === "health-retry") {
                  const round = await store.round(key);
                  if (!round?.task_key) throw new Error("当前没有可恢复任务");
                  const status = await store.status(key);
                  for (const fault of status.faults.filter((f) => f.task_key === round.task_key && f.class === "request_exhausted" && f.state !== "resolved")) await store.resolveStep(key, fault.step, ["request_exhausted"]);
                  for (const event of (await store.observations(key)).filter((e) => e.task_key === round.task_key && e.kind === "tool_unavailable"))
                    await store.observe(key, { id: `tool-reset:${randomUUID()}`, kind: "tool_health_reset", at: new Date().toISOString(), task_key: round.task_key, tool: event.tool, config_version: event.config_version, source: "explicit_user_retry" });
                  writeJson(response, 200, { recorded: true, note: "明确重试许可已记录；保留原会话/文件/问题，可继续任务" });
                  return;
                }
                if (input.action === "interact") {
                  const updated = await store.interact(
                    key,
                    input as Parameters<WorkStore["interact"]>[1],
                    auth.snapshot().loggedIn ? auth.identity().employee_id : "personal",
                  );
                  uploader?.reportWork(requestedWorkspace.path, updated);
                  writeJson(response, 200, { card: updated });
                  return;
                }
                if (input.action === "decide") {
                  const result = await decisionUpdate(
                    requestedWorkspace.path,
                    input,
                    auth.snapshot().loggedIn
                      ? auth.identity().employee_id
                      : "personal",
                  );
                  uploader?.reportWork(requestedWorkspace.path, result.card);
                  writeJson(response, 200, result);
                  return;
                }
                if (input.action === "message") {
                  if (isReturnIntent(String(input.text ?? ""))) {
                    const updated = await store.interact(key, {
                      navigation: { mode: "overview" },
                    });
                    writeJson(response, 200, { card: updated, returned: true });
                    return;
                  }
                  const paths =
                    Array.isArray(input.paths) &&
                    input.paths.every((p) => typeof p === "string")
                      ? (input.paths as string[])
                      : [];
                  if (input.feishuLinks !== undefined)
                    paths.push(
                      ...(await saveTaskAttachments(
                        requestedWorkspace.path,
                        card.session_id,
                        await companyFeishu.sources(
                          card.session_id,
                          requestedWorkspace.path,
                          input.feishuLinks,
                        ),
                      )),
                    );
                  if (paths.length > MAX_ATTACHMENT_COUNT || new Set(paths).size !== paths.length) throw new Error("材料最多 20 个，不得重复路径");
                  // Record the employee input before parsing. A failed file cannot erase the text or successful files.
                  const recorded = await store.employeeMessage(
                    key,
                    String(input.text ?? ""),
                    paths,
                    typeof input.suggestion_target === "string" ? input.suggestion_target : undefined,
                    {
                      channel: typeof input.question_id === "string" ? "question" : "chat",
                      ...(typeof input.event_id === "string" ? { id: input.event_id } : {}),
                      ...(typeof input.question_id === "string" ? { question_id: input.question_id } : {}),
                    },
                  );
                  const materials: WorkCard["materials"] = [];
                  const materialErrors: string[] = [];
                  for (const path of paths) {
                    let hash = "";
                    try {
                      const original = await uploadedAttachment(requestedWorkspace.path, card.session_id, path);
                      hash = sha256(original.bytes);
                      const prior = card.materials.find((m) => m.path === path && m.sha256 === hash && m.parse_status === "ready");
                      if (prior) { materials.push(prior); continue; }
                      const [parsed] = await prepareTaskAttachmentsForPlanning(requestedWorkspace.path, card.session_id, [path]);
                      const readable = await readFile(join(requestedWorkspace.path, parsed!.readablePath));
                      materials.push({ path, sha256: hash, summary: "", source_id: `MAT-${hash.slice(0, 16)}`, readable_path: parsed!.readablePath, readable_sha256: sha256(readable), format: original.extension, parse_status: "ready", limitation: parsed!.converter ? "仅提取可读文字/表格；未进行 OCR、复杂图表理解或公式计算" : "文本；未自动读取正文" });
                    } catch (e) {
                      const error = e instanceof Error ? e.message : String(e);
                      materialErrors.push(error);
                      materials.push({ path, sha256: hash, summary: "", parse_status: "failed", error });
                    }
                  }
                  if (materials.length) await store.materials(key, materials);
                  writeJson(response, 200, { card: await store.read(key), event: recorded.event, duplicate: recorded.duplicate, material_errors: materialErrors });
                  return;
                }
                if (input.action === "start") {
                  const session = await sessionHeaderFor(card.session_id, requestedWorkspace.path);
                  const { preset: revisionPreset, bytes: revisionBytes, revision: rawRevision } = await productRevisionForSession(dshHome, session);
                  const revision = rawRevision as { metadata?: { team_revision_id?: string; revision?: number; definition_sha256?: string } };
                  const revisionPath = join(dshHome, ".agent-presets", revisionPreset, "team-revision.yml");
                  const team = dispatchTeamFromRevision(revision);
                  const result = await store.authorize(
                    key,
                    String(input.revision ?? ""),
                    input.source as "click" | "countdown",
                    async (card, round) => {
                      const telemetry = ctx.get?.("promaxTelemetry");
                      if (!telemetry) throw new Error("本地运行记录尚未就绪");
                      await telemetry.admit(
                        card.session_id,
                        requestedWorkspace.path,
                      );
                      const oldScope = executionTask({
                        name: "",
                        agent: {
                          session: {
                            header: {
                              id: card.session_id,
                              cwd: requestedWorkspace.path,
                            },
                          },
                        },
                      });
                      if (oldScope) {
                        const files = await readTaskRunFiles(
                          requestedWorkspace.path,
                          {
                            sessionId: card.session_id,
                            taskKey: oldScope.taskKey,
                          },
                        );
                        if (files.cancellation === "running")
                          throw new PromateError(
                            "RUN_CONFLICT",
                            "当前执行尚未结束",
                            409,
                          );
                        await rm(
                          join(
                            requestedWorkspace.path,
                            ".promax/session-scopes",
                            `${card.session_id}.json`,
                          ),
                        );
                      }
                      const edit = round.turn.edit_request;
                      const objects = new ContentObjectStore(
                        requestedWorkspace.path,
                      );
                      if (
                        edit &&
                        objects
                          .index()
                          .artifacts.find(
                            (a) =>
                              a.work_key === key &&
                              a.filename === edit.filename,
                          )?.current_sha256 !== edit.base_sha256
                      )
                        throw new ArtifactConflictError(
                          objects
                            .index()
                            .artifacts.find(
                              (a) =>
                                a.work_key === key &&
                                a.filename === edit.filename,
                            )?.current_sha256 ?? null,
                        );
                      // The run freezes the complete effective input: original task, rules, decisions, selected materials.
                      const frozen = frozenInput(card, round);
                      const materials = (
                        await Promise.all(
                          frozen.attachments.map(async (path) =>
                            (await lstat(resolve(requestedWorkspace.path, path)).then((info) => info.isFile(), () => false)) ? [path] : [],
                          ),
                        )
                      ).flat();
                      const prepared = await prepareTaskSubmission({
                        workspacePath: requestedWorkspace.path,
                        sessionId: card.session_id,
                        demand: `${frozen.demand}${materials.length < frozen.attachments.length ? `\n（${frozen.attachments.length - materials.length} 份材料原文已不存在，未冻结）` : ""}${edit ? `\n修改成果 ${edit.filename}，基线 ${edit.base_sha256}，锚点 ${JSON.stringify(edit.anchor)}` : round.check_scope || round.revise ? `\n相关成果 ${round.turn.deliverables.join(" ")}` : ""}`,
                        attachmentPaths: materials,
                        frozenAt: new Date().toISOString(),
                        telemetry,
                      });
                      if (edit || round.check_scope || round.revise) {
                        for (const filename of edit
                          ? [edit.filename]
                          : round.turn.deliverables) {
                          const entry = objects
                            .index()
                            .artifacts.find(
                              (a) =>
                                a.work_key === key && a.filename === filename,
                            );
                          if (!entry) throw new Error("修改或复查的成果不存在");
                          const source = objects.readVersion(
                            key,
                            filename,
                            edit?.base_sha256 ?? entry.current_sha256,
                          );
                          const frozenPath = `.任务/${prepared.taskKey}/修改源/${filename}`;
                          objects.reference(frozenPath, source.sha256);
                          await writeFile(
                            join(
                              requestedWorkspace.path,
                              `.任务/${prepared.taskKey}/产物快照/${filename}`,
                            ),
                            source.content,
                            { flag: "wx" },
                          );
                        }
                      }
                      const members = workMembers(
                        round.turn.deliverables,
                        team,
                      );
                      await sealTaskRunManifest(requestedWorkspace.path, {
                        sessionId: card.session_id,
                        taskKey: prepared.taskKey,
                        confirmedAt: new Date().toISOString(),
                        confirmedMemberIds: members,
                        artifacts: [
                          ...team.artifacts
                            .filter((a) =>
                              round.turn.deliverables.includes(
                                basename(a.relativePath),
                              ),
                            )
                            .map((a) => ({
                              path: a.relativePath,
                              memberId: a.producedBy,
                            })),
                          {
                            path: ".任务/{task_key}/判定-r{round}.md",
                            memberId: "quality_judge",
                          },
                        ],
                        teamRevision: revision,
                      });
                      await writeFile(
                        join(
                          requestedWorkspace.path,
                          ".任务",
                          prepared.taskKey,
                          "工作关联.yml",
                        ),
                        YAML.stringify({
                          work_key: key,
                          author: auth.snapshot().loggedIn
                            ? auth.identity().employee_id
                            : "personal",
                          check_only: round.check_only === true,
                          kind:
                            round.turn.intent === "edit" ? "ai_edit" : "ai_run",
                          edit: round.turn.edit_request,
                        }),
                        { flag: "wx", mode: 0o444 },
                      );
                      return prepared.taskKey;
                    },
                    {
                      protocol: 2,
                      requirement_policy: policyFromRevision(revision, (await store.read(key)).deliverables.map((d) => d.filename)),
                      // 13.1 运行快照只写本次实际读取的事实；未知保留原因，不从磁盘安装状态回填。
                      runtime_snapshot: ({ task_key, baseline_version, requirement_version }) => {
                        const manifestPath = join(requestedWorkspace.path, ".任务", task_key, "输入", "manifest.yml");
                        const manifestBytes = existsSync(manifestPath) ? readFileSync(manifestPath) : undefined;
                        const frozenAt = manifestBytes ? (() => { try { return String(YAML.parse(manifestBytes.toString("utf8"))?.metadata?.frozen_at ?? "") || null; } catch { return null; } })() : null;
                        return buildRuntimeSnapshot({
                          work_key: key,
                          task_key,
                          capture_point: "work/card/update:start",
                          baseline_version,
                          requirement_version,
                          runtime_version: BUNDLE_VERSION,
                          components: [{ name: "promax-bundle", version: BUNDLE_LOAD_IDENTITY.version, evidence: `执行模块求值时捕获：${JSON.stringify(BUNDLE_LOAD_IDENTITY)}` }],
                          preset: {
                            team_revision_id: revision?.metadata?.team_revision_id ?? null,
                            revision: revision?.metadata?.revision ?? null,
                            definition_sha256: revision?.metadata?.definition_sha256 ?? null,
                            bytes: revisionBytes,
                            source: revisionPath,
                          },
                          frozen_input: { manifest_sha256: manifestBytes ? sha256(manifestBytes) : null, frozen_at: frozenAt, source: ".任务/{task_key}/输入/manifest.yml" },
                          model_route: null,
                          config_source: "本捕获点未读取模型/工具配置",
                          config_version: null,
                        });
                      },
                    },
                  );
                  // Decision bindings and state are persisted by authorize, not by a global state sweep.
                  ctx.emit("promax/decision", {
                    sessionId: card.session_id,
                    target: "scope.start",
                    source: input.source,
                    decision: {
                      work_key: key,
                      task_key: result.task_key,
                      source: input.source,
                    },
                  });
                  writeJson(response, 200, result);
                  return;
                }
                const updated = await store.update(
                  key,
                  {
                    ...(typeof input.title === "string"
                      ? { title: input.title }
                      : {}),
                    ...(typeof input.goal === "string"
                      ? { goal: input.goal }
                      : {}),
                    ...(typeof input.confirmed_text === "string"
                      ? { confirmed_text: input.confirmed_text }
                      : {}),
                    ...(input.answer &&
                    typeof input.answer === "object" &&
                    typeof (input.answer as Record<string, unknown>).id ===
                      "string" &&
                    typeof (input.answer as Record<string, unknown>).text ===
                      "string"
                      ? {
                          answer: input.answer as { id: string; text: string },
                        }
                      : {}),
                    ...(typeof input.withdraw_decision === "string"
                      ? { withdraw_decision: input.withdraw_decision }
                      : {}),
                    ...(typeof input.resend_decision === "string"
                      ? { resend_decision: input.resend_decision }
                      : {}),
                  },
                  String(input.base_updated_at ?? ""),
                );
                uploader?.reportWork(requestedWorkspace.path, updated);
                writeJson(response, 200, { card: updated });
                return;
              }
            }
            release = recycle.beginRequest({
              ...input,
              ...(path.endsWith("/project")
                ? {
                    path: resolve(projectRoot, String(input.projectName ?? "")),
                  }
                : {}),
            });

            if (path.endsWith("/dispatch-plan/begin")) {
              if (!requestedWorkspace) throw new Error("调度计划缺少可核对的工作区");
              const result = await beginDispatchPlan(dispatchPlanRoot, {
                sessionId: String(input.sessionId ?? ""),
                taskKey: String(input.taskKey ?? ""),
                rosterMemberIds: dispatchMemberIds(
                  input.rosterMemberIds,
                  "调度计划团队名单",
                ),
                teamRevision: (await productRevisionForSession(dshHome, await sessionHeaderFor(String(input.sessionId ?? ""), requestedWorkspace.path))).revision,
              });
              writeJson(response, 200, result);
              return;
            }

            if (path.endsWith("/dispatch-plan/read")) {
              const plan = await readGeneratedDispatchPlan(dispatchPlanRoot, {
                sessionId: String(input.sessionId ?? ""),
                planId: String(input.planId ?? ""),
              });
              writeJson(response, 200, { plan: plan ?? null });
              return;
            }

            if (path.endsWith("/dispatch-plan/confirm")) {
              const result = await confirmDispatchPlan(dispatchPlanRoot, {
                sessionId: String(input.sessionId ?? ""),
                planId: String(input.planId ?? ""),
                confirmedMemberIds: dispatchMemberIds(
                  input.confirmedMemberIds,
                  "已确认成员名单",
                ),
                plan: input.plan,
              });
              const workspaceId =
                typeof input.workspaceId === "string" ? input.workspaceId : "";
              const registered =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              const claimedPath =
                typeof input.projectPath === "string"
                  ? resolve(input.projectPath)
                  : undefined;
              const workspacePath = registered?.path ?? claimedPath;
              if (
                workspaceId === "" ||
                workspacePath === undefined ||
                basename(workspacePath) === ""
              )
                throw new Error("目标项目组无效");
              const sealed = await sealTaskRunManifest(workspacePath, {
                sessionId: String(input.sessionId ?? ""),
                taskKey: result.taskKey,
                confirmedAt: result.confirmedAt,
                confirmedMemberIds: result.confirmedMemberIds,
                artifacts: taskRunArtifactRegistrations(input.artifacts),
                teamRevision: (await optionalDispatchPlanControl(
                  dispatchPlanPath(
                    dispatchPlanRoot,
                    String(input.sessionId),
                    "confirmed",
                  ),
                  "confirmed",
                ))!.spec.team_revision,
              });
              ctx.emit("promax/decision", {
                sessionId: String(input.sessionId ?? ""),
                target: "dispatch.confirm",
                decision: {
                  task_key: result.taskKey,
                  plan_id: result.planId,
                  member_ids: result.confirmedMemberIds,
                },
              });
              writeJson(response, 200, { ...result, ...sealed });
              return;
            }

            if (path.endsWith("/attachments/freeze")) {
              const workspaceId =
                typeof input.workspaceId === "string" ? input.workspaceId : "";
              const registered =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              const claimedPath =
                typeof input.projectPath === "string"
                  ? resolve(input.projectPath)
                  : undefined;
              const workspacePath = registered?.path ?? claimedPath;
              if (
                workspaceId === "" ||
                workspacePath === undefined ||
                basename(workspacePath) === ""
              )
                throw new Error("目标工作目录无效");
              const sessionId = String(input.sessionId ?? "");
              const paths =
                Array.isArray(input.paths) &&
                input.paths.every((item) => typeof item === "string")
                  ? input.paths
                  : [];
              const telemetry = ctx.get?.("promaxTelemetry");
              if (!telemetry)
                throw new Error("冻结输入：本地 trace 采集尚未就绪");
              await telemetry.admit(sessionId, workspacePath);
              if (input.feishuLinks !== undefined) {
                const files = await companyFeishu.sources(
                  sessionId,
                  workspacePath,
                  input.feishuLinks,
                );
                if (files.length)
                  paths.push(
                    ...(await saveTaskAttachments(
                      workspacePath,
                      sessionId,
                      files,
                    )),
                  );
              }
              const prepared = await prepareTaskSubmission({
                telemetry,
                workspacePath,
                sessionId,
                demand: String(input.demand ?? ""),
                attachmentPaths: paths,
                frozenAt: new Date().toISOString(),
              });
              writeJson(response, 200, prepared);
              return;
            }

            if (path.endsWith("/attachments")) {
              const workspaceId =
                typeof input.workspaceId === "string" ? input.workspaceId : "";
              const registered =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              const claimedPath =
                typeof input.projectPath === "string"
                  ? resolve(input.projectPath)
                  : undefined;
              const workspacePath = registered?.path ?? claimedPath;
              if (
                workspaceId === "" ||
                workspacePath === undefined ||
                basename(workspacePath) === ""
              )
                throw new Error("目标工作目录无效");
              const sessionId = String(input.sessionId ?? "");
              const paths = await saveTaskAttachments(
                workspacePath,
                sessionId,
                input.files,
              );
              writeJson(response, 200, { paths });
              return;
            }

            if (path.includes("/feishu/")) {
              const workspaceId = String(input.workspaceId ?? "");
              const workspace =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              if (!workspace) throw new Error("请选择已登记的项目");
              const sessionId = String(input.sessionId ?? ""),
                operationId = String(input.operationId ?? "");
              const result = path.endsWith("/feishu/pending")
                ? companyFeishu.pending(workspace.path)
                : path.endsWith("/feishu/detail")
                  ? await companyFeishu.detail(
                      sessionId,
                      workspace.path,
                      operationId,
                    )
                  : path.endsWith("/feishu/resolve")
                    ? await companyFeishu.resolve(
                        sessionId,
                        workspace.path,
                        operationId,
                        input.action as
                          | "verify"
                          | "overwrite"
                          | "keep"
                          | "manual",
                      )
                    : (() => {
                        throw new Error("飞书操作入口不存在");
                      })();
              writeJson(
                response,
                200,
                Array.isArray(result) ? { pending: result } : result,
              );
              return;
            }

            if (path.endsWith("/project")) {
              const workspace = await ensureProjectWorkspace(
                ctx.workspaceRegistry,
                projectRoot,
                String(input.projectName ?? ""),
                owner,
              );
              knownWorkspaces.set(workspace.id, workspace);
              writeJson(response, 200, {
                workspaceId: workspace.id,
                path: workspace.path,
                title: workspace.title,
                sessionIds: [...workspace.sessionIds],
              });
              return;
            }

            if (path.endsWith("/task-history/read")) {
              const workspaceId =
                typeof input.workspaceId === "string" ? input.workspaceId : "";
              const registered =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              const claimedPath =
                typeof input.projectPath === "string"
                  ? resolve(input.projectPath)
                  : undefined;
              const workspacePath = registered?.path ?? claimedPath;
              if (
                workspaceId === "" ||
                workspacePath === undefined ||
                basename(workspacePath) === ""
              )
                throw new Error("目标项目组无效");
              const items = await readTaskHistory(workspacePath);
              writeJson(response, 200, {
                items,
                observedAt: new Date().toISOString(),
              });
              return;
            }

            if (path.startsWith(`${WORKSPACE_API_PREFIX}/project-files/`)) {
              if (
                !request.headers["content-type"]?.startsWith(
                  "application/json",
                ) ||
                request.headers["sec-fetch-site"] === "cross-site" ||
                (request.headers.origin !== undefined &&
                  new URL(request.headers.origin).host !== request.headers.host)
              )
                throw new Error("项目文件只接受当前 Promax 页面的 JSON 请求");
              const workspaceId =
                typeof input.workspaceId === "string" ? input.workspaceId : "";
              const registered =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              if (
                registered === undefined ||
                resolve(registered.path, "..") !== resolve(projectRoot)
              )
                throw new Error("目标项目无效");
              if (typeof input.relativePath !== "string")
                throw new Error("文件路径无效");
              const operation = path.slice(
                `${WORKSPACE_API_PREFIX}/project-files/`.length,
              );
              if (operation === "list")
                writeJson(
                  response,
                  200,
                  await listProjectFiles(registered.path, input.relativePath),
                );
              else if (operation === "read")
                writeJson(
                  response,
                  200,
                  await readTaskArtifact(
                    registered.path,
                    registered.path,
                    input.relativePath,
                  ),
                );
              else if (operation === "resolve") {
                const target = await resolveProjectFile(
                  registered.path,
                  input.relativePath,
                );
                writeJson(response, 200, {
                  path: (await lstat(target)).isDirectory()
                    ? target
                    : resolve(target, ".."),
                });
              } else throw new Error("未知项目文件操作");
              return;
            }

            if (path.endsWith("/task-file/read")) {
              const workspaceId =
                typeof input.workspaceId === "string" ? input.workspaceId : "";
              const registered =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              if (
                registered === undefined ||
                (typeof input.projectPath === "string" &&
                  resolve(input.projectPath) !== resolve(registered.path))
              )
                throw new Error("目标项目无效");
              const directory = await resolveTaskDeliverableDirectory(
                registered.path,
                {
                  sessionId: String(input.sessionId ?? ""),
                  taskKey: String(input.taskKey ?? ""),
                },
              );
              const preview = await readTaskArtifact(
                registered.path,
                directory,
                String(input.relativePath ?? ""),
              );
              writeJson(response, 200, { ...preview });
              return;
            }

            if (path.endsWith("/task-folder/resolve")) {
              const workspaceId =
                typeof input.workspaceId === "string" ? input.workspaceId : "";
              const registered =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              const claimedPath =
                typeof input.projectPath === "string"
                  ? resolve(input.projectPath)
                  : undefined;
              const workspacePath = registered?.path ?? claimedPath;
              if (
                workspaceId === "" ||
                workspacePath === undefined ||
                basename(workspacePath) === ""
              )
                throw new Error("目标项目组无效");
              const folderPath = await resolveTaskDeliverableDirectory(
                workspacePath,
                {
                  sessionId: String(input.sessionId ?? ""),
                  taskKey: String(input.taskKey ?? ""),
                },
              );
              writeJson(response, 200, { path: folderPath });
              return;
            }

            if (path.endsWith("/task-run/read")) {
              const workspaceId =
                typeof input.workspaceId === "string" ? input.workspaceId : "";
              const registered =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              const claimedPath =
                typeof input.projectPath === "string"
                  ? resolve(input.projectPath)
                  : undefined;
              const workspacePath = registered?.path ?? claimedPath;
              if (
                workspaceId === "" ||
                workspacePath === undefined ||
                basename(workspacePath) === ""
              )
                throw new Error("目标项目组无效");
              const snapshot = await readTaskRunFiles(workspacePath, {
                sessionId: String(input.sessionId ?? ""),
                taskKey: String(input.taskKey ?? ""),
              });
              writeJson(response, 200, { ...snapshot });
              return;
            }

            if (path.endsWith("/task-run/control")) {
              if (
                !request.headers["content-type"]?.startsWith(
                  "application/json",
                ) ||
                request.headers["sec-fetch-site"] === "cross-site" ||
                (request.headers.origin !== undefined &&
                  new URL(request.headers.origin).host !== request.headers.host)
              )
                throw new PromateError(
                  "ORIGIN_DENIED",
                  "只接受当前 Promax 页面的 JSON 请求",
                  403,
                );
              const workspaceId =
                typeof input.workspaceId === "string" ? input.workspaceId : "";
              const registered =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              const claimedPath =
                typeof input.projectPath === "string"
                  ? resolve(input.projectPath)
                  : undefined;
              const workspacePath = registered?.path ?? claimedPath;
              if (
                workspaceId === "" ||
                workspacePath === undefined ||
                basename(workspacePath) === ""
              )
                throw new Error("目标项目组无效");
              if (
                !registered ||
                (claimedPath !== undefined &&
                  claimedPath !== resolve(registered.path)) ||
                !registered.sessionIds.includes(String(input.sessionId ?? ""))
              )
                throw new PromateError(
                  "INVALID_WORKSPACE",
                  "目标项目或会话无效",
                  403,
                );
              const works = new WorkStore(workspacePath);
              const work = await works.forSession(
                String(input.sessionId ?? ""),
              );
              const round = work ? await works.round(work.work_key) : undefined;
              const result = await controlTaskRunFiles(workspacePath, {
                sessionId: String(input.sessionId ?? ""),
                taskKey: String(input.taskKey ?? ""),
                state: String(input.state ?? "") as TaskRunCancellationState,
                runEpoch: Number(input.runEpoch),
                updatedAt: String(input.updatedAt ?? ""),
              });
              // "Stopped" is shown only after the actual cancellation is confirmed, never at request time.
              const stoppingTask = round?.task_key;
              if (work && stoppingTask && stoppingTask === input.taskKey && result.changed)
                await works.updateStatus(work.work_key, (status) => {
                  const prior = status.stop?.task_key === stoppingTask ? status.stop : undefined;
                  const requested_at = prior?.requested_at ?? new Date().toISOString();
                  if (result.state === "stop_requested" || result.state === "draining")
                    status.stop = { task_key: stoppingTask, requested_at };
                  if (result.state === "cancelled")
                    status.stop = { task_key: stoppingTask, requested_at, confirmed_at: new Date().toISOString(), outcome: "cancelled" };
                });
              if (
                result.state === "cancelled" &&
                round?.task_key &&
                round.task_key === input.taskKey
              ) {
                const published =
                  result.changed && round.phase !== "ended"
                    ? await publishStoppedDrafts(
                        workspacePath,
                        round.task_key,
                        String(input.sessionId ?? ""),
                        ctx.get?.("promaxTelemetry"),
                      ).catch((error: unknown) => ({
                        hashes: {} as Record<string, string>,
                        note: `草稿保留在本次执行中，未能保存为版本：${error instanceof Error ? error.message : String(error)}`,
                      }))
                    : undefined;
                const stopped = await works.endStoppedRound(
                  String(input.sessionId ?? ""),
                  round.task_key,
                  round.revision,
                );
                if (stopped)
                  await works.markDecisions(
                    stopped.work_key,
                    ["running", "awaiting_start"],
                    "failed",
                    "已停止，成果没有按这个决定改完",
                  );
                if (stopped && published)
                  await works.progress(
                    stopped.work_key,
                    `已停止 · ${published.note}`,
                    published.hashes,
                    "草稿 · 已停止 · 未检查",
                  );
                if (stopped)
                  ctx
                    .get?.("promaxUploader")
                    ?.reportWork(workspacePath, stopped);
              }
              if (result.changed && result.state === "cancelled")
                ctx.emit("promax/decision", {
                  sessionId: String(input.sessionId ?? ""),
                  target: "task.abandon",
                  decision: {
                    task_key: String(input.taskKey ?? ""),
                    reason: "user-stop",
                  },
                });
              writeJson(response, 200, result);
              return;
            }

            if (path.endsWith("/session-scope")) {
              const workspaceId =
                typeof input.workspaceId === "string" ? input.workspaceId : "";
              const registered =
                ctx.workspaceRegistry.get?.(workspaceId) ??
                knownWorkspaces.get(workspaceId);
              const claimedPath =
                typeof input.projectPath === "string"
                  ? resolve(input.projectPath)
                  : undefined;
              const workspacePath = registered?.path ?? claimedPath;
              if (
                workspaceId === "" ||
                workspacePath === undefined ||
                basename(workspacePath) === ""
              )
                throw new Error("目标项目组无效");
              const scope = await ensureSessionOutputDirectory(
                workspacePath,
                String(input.sessionId ?? ""),
                String(input.sessionName ?? ""),
              );
              writeJson(response, 200, scope);
              return;
            }

            writeJson(response, 404, { error: "未知的 Promax 工作区操作" });
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            const attachmentMessage =
              /^(?:请求体|附件|图片|不支持文件|文档|PDF|冻结输入|当前会话的冻结输入)/u.test(
                message,
              )
                ? message
                : "附件处理失败，请确认文件可读取且工作目录可写后重试";
            const path = requestPath(request);
            writeJson(
              response,
              error instanceof ArtifactConflictError
                ? 409
                : error instanceof PromateError
                  ? error.status
                  : 400,
              {
                ...(error instanceof ArtifactConflictError
                  ? { code: error.code, current_sha256: error.current_sha256 }
                  : error instanceof PromateError
                    ? { code: error.code }
                    : {}),
                error:
                  path.endsWith("/attachments") ||
                  path.endsWith("/attachments/freeze")
                    ? attachmentMessage
                    : message || "请求处理失败",
              },
            );
          } finally {
            release?.();
          }
        },
      }),
    "promax-project-workspace-api",
  );
}
