import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { vi } from "vitest";
import { LocalTrace } from "@promax/promax-report";
import { apply } from "../../promax-bundle/src/index.ts";

type RegisteredTool = { name: string; parameters: Record<string, unknown>; execute(args: unknown, exec: unknown): Promise<unknown> };
// Tests with a local synthetic TeamRevision ship an equally local two-file
// published manifest. The real mount/139-file manifest is tested separately.
export async function sealFixturePreset(home: string): Promise<void> {
  const root = join(home, ".agent-presets", "promax-team-r10");
  const published = join(home, "profiles", "web", "node_modules", "@promax", "team-harness", "generated", "r10", "promax-team-r10");
  await mkdir(published, { recursive: true });
  await writeFile(join(root, "agent.cordis.yml"), "# synthetic fixture; no model mounted here\n");
  const files = ["agent.cordis.yml", "team-revision.yml"];
  const manifest: string[] = [];
  for (const name of files) {
    const bytes = await readFile(join(root, name));
    await writeFile(join(published, name), bytes);
    manifest.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
  }
  for (const dir of [root, published]) await writeFile(join(dir, "manifest.sha256"), `${manifest.join("\n")}\n`);
}
// Real registered route, in-process streams only: no listening socket or runtime Agent.
export async function workRouteFixture(options: { revision?: unknown; chainContext?: boolean; runtime?: { on: (...args: any[]) => any; tools: { register: (definition: any) => () => void }; agents?: { list(): any[] } } } = {}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "promax-controls-")),
  );
  const home = join(root, "home"),
    projectRoot = join(root, "projects");
  vi.stubEnv("DSH_HOME", home);
  vi.stubEnv("PROMAX_PROJECT_ROOT", projectRoot);
  vi.stubEnv("PROMAX_GENERAL_WORKSPACE", join(root, "general"));
  vi.stubEnv("PROMAX_PRODUCT_WORKSPACE", join(projectRoot, "product"));
  const revision = {
    api_version: "promax.ai/v1alpha2",
    kind: "TeamRevision",
    metadata: {
      team_revision_id: "promax-product-team@r2",
      status: "published",
    },
    spec: {
      members: [
        { member_id: "solution_design", display_name: "方案设计师" },
        { member_id: "quality_judge", display_name: "检查" },
      ],
      artifacts: ["prd.md", "other.md"]
        .map((filename) => ({
          kind: "prd",
          validation_kind: "prd",
          relative_path: `.任务/{task_key}/产物快照/${filename}`,
          produced_by: "solution_design",
        }))
        .concat([
          {
            kind: "judge-report",
            validation_kind: "judge-report",
            relative_path: ".任务/{task_key}/判定-r{round}.md",
            produced_by: "quality_judge",
          },
        ]),
    },
  };
  await mkdir(join(home, ".agent-presets/promax-team"), { recursive: true });
  await writeFile(
    join(home, ".agent-presets/promax-team/team-revision.yml"),
    JSON.stringify(options.revision ?? revision),
  );
  const current = structuredClone(options.revision ?? revision) as typeof revision;
  current.metadata.team_revision_id = "promax-product-team@r10";
  (current.spec as typeof current.spec & { preset_id: string }).preset_id = "promax-team-r10";
  await mkdir(join(home, ".agent-presets/promax-team-r10"), { recursive: true });
  await writeFile(join(home, ".agent-presets/promax-team-r10/team-revision.yml"), JSON.stringify(current));
  await sealFixturePreset(home);
  const workspaces = new Map<
    string,
    { id: string; path: string; title: string; sessionIds: string[] }
  >();
  const handlers = new Map<
    string,
    (req: IncomingMessage, res: ServerResponse) => Promise<void>
  >();
  const disposers: Array<() => unknown> = [];
  const hooks = new Map<string, (...args: any[]) => any>();
  const tools = new Map<string, RegisteredTool>();
  const emitted = vi.fn();
  const reportStatus = vi.fn(async () => ({ state: "not_queued" })),
    retryReport = vi.fn();
  const uploader = {
    reportStatus,
    retryReport,
    reportWork: vi.fn(),
    reportArtifactVersion: vi.fn(async () => {}),
    reportCheckReport: vi.fn(),
  };
  const traces = new Map<string, LocalTrace>();
  const telemetry = {
    admit: async (id: string, path: string) => {
      if (!traces.has(id))
        traces.set(id, new LocalTrace(path, id, "unit-test"));
    },
    traceId: (id: string) => traces.get(id)?.id,
    observation: (id: string, attrs: Record<string, unknown>) => {
      const trace = traces.get(id)!;
      trace.event(trace.root, "observation", attrs);
      return trace.id;
    },
  };
  const ctx = {
    effect: (setup: () => unknown) => {
      const dispose = setup();
      if (typeof dispose === "function")
        disposers.push(dispose as () => unknown);
    },
    on: (name: string, callback: (...args: any[]) => any, hookOptions?: { prepend?: boolean }) => {
      if (options.runtime) disposers.push(options.runtime.on(name, callback, hookOptions));
      const previous = hooks.get(name);
      // Compose actual admission and around-dispatch middleware, including the durable dedup owner.
      hooks.set(name, ["tools/pre-execute", "tools/execute"].includes(name) && previous
        ? hookOptions?.prepend ? (exec, next) => callback(exec, () => previous(exec, next)) : (exec, next) => previous(exec, () => callback(exec, next))
        : callback);
    },
    emit: emitted,
    webServer: {
      register: (entry: {
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
      }) => {
        handlers.set(entry.path, entry.handler);
        return () => {};
      },
    },
    settings: {
      register: (
        _name: string,
        _schema: unknown,
        options: { base: Record<string, unknown> },
      ) => {
        let value = options.base;
        return {
          get: () => value,
          watch: () => () => {},
          update: async (next: Record<string, unknown>) => {
            value = next;
          },
        };
      },
    },
    workspaceRegistry: {
      delete: async (id: string) => workspaces.delete(id),
      get: (id: string) => workspaces.get(id),
      create: async (path: string, title: string) => {
        const id = path;
        const workspace = {
          id,
          path,
          title,
          sessionIds: ["session-one", "session-two"],
        };
        workspaces.set(id, workspace);
        return workspace;
      },
    },
    provide: (_name: string, _value: unknown) => {},
    promaxAuth: {
      snapshot: () => ({
        loggedIn: false,
        models: [],
        projects: [],
        clientId: "test",
      }),
      identity: () => ({ employee_id: "personal" }),
      subscribe: () => () => {},
      authorizeProject: async () => {
        throw Error("unexpected company authorization");
      },
      traceAccess: () => ({}),
    },
    llm: { listProviders: () => options.runtime ? [{ id: "stub", name: "隔离模型" }] : [], listModels: async () => [{ id: "stub", name: "隔离模型" }] },
    tools: {
      register: (definition: { name: string }) => {
        tools.set(definition.name, definition as RegisteredTool);
        const dispose = options.runtime?.tools.register(definition);
        return () => { dispose?.(); tools.delete(definition.name); };
      },
      list: () => [],
    },
    sessionPersistence: { list: async () => [], locate: () => undefined, inspect: async (id: string) => ({ meta: { id, cwd: join(projectRoot, "product"), agentPreset: "promax-team-r10" }, events: [] }) },
    agents: options.runtime?.agents ?? { list: () => [] },
    apiProxy: {},
    get: (name: string) =>
      name === "promaxUploader"
        ? uploader
        : name === "promaxTelemetry"
          ? telemetry
          : name === "sessionPersistence"
            ? { inspect: async (id: string) => ({ meta: { id, cwd: join(projectRoot, "product"), agentPreset: "promax-team-r10" }, events: [] }) }
            : undefined,
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  };
  try {
    await apply(
      ctx as unknown as Parameters<typeof apply>[0],
      { apiBaseUrl: "https://example.invalid", ...(options.chainContext ? { chainContext: { enabled: true } } : {}) } as Parameters<typeof apply>[1],
    );
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const scope = {
    workspaceId: join(projectRoot, "product"),
    projectPath: join(projectRoot, "product"),
  };
  const pending = new Set<Promise<void>>();
  let closed = false;
  const request = async (
    path: string,
    body: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) => {
    if (closed) return new Response(JSON.stringify({ error: "fixture closed" }), { status: 503 });
    const req = Object.assign(
      Readable.from([Buffer.from(JSON.stringify({ ...scope, ...body }))]),
      {
        method: "POST",
        url: `/promax-workspace-api/${path}`,
        headers: {
          "content-type": "application/json",
          host: "unit.test",
          ...headers,
        },
      },
    );
    let code = 200,
      output = "";
    const res = {
      writeHead: (status: number) => {
        code = status;
      },
      end: (data: string) => {
        output = data;
      },
      setHeader: () => {},
    };
    const handling = handlers.get("/promax-workspace-api")!(
      req as IncomingMessage,
      res as unknown as ServerResponse,
    );
    pending.add(handling);
    try {
      await handling;
    } finally {
      pending.delete(handling);
    }
    return new Response(output, {
      status: code,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    root,
    scope,
    request,
    uploader,
    emitted,
    hooks,
    tools,
    /** Calls a registered structured tool exactly as the runtime does: execute, then the authoritative result hook. */
    submit: async (name: string, args: unknown, exec: { callId: string; agent: unknown }) => {
      const tool = tools.get(name);
      if (!tool) throw Error(`tool ${name} not registered`);
      let value: unknown, isError = false;
      try {
        value = await tool.execute(args, exec);
      } catch (error) {
        value = error instanceof Error ? error.message : String(error);
        isError = true;
      }
      await hooks.get("tools/result")?.({ ...exec, name }, { isError });
      const { settleStructuredCommits } = await import("../../promax-bundle/src/structured-results.ts");
      const header = (exec.agent as { session: { header: { cwd: string } } }).session.header;
      await settleStructuredCommits(header.cwd);
      return { value, isError };
    },
    fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).startsWith("/promax-workspace-api/"))
        throw Error(`unexpected external request ${String(url)}`);
      return request(
        String(url).slice("/promax-workspace-api/".length),
        JSON.parse(String(init?.body ?? "{}")),
      );
    }),
    close: async () => {
      closed = true; // Stop accepting queued unmount saves before draining and removing the fixture.
      await Promise.all([...pending]);
      for (const dispose of disposers.reverse()) await dispose();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    },
  };
}
