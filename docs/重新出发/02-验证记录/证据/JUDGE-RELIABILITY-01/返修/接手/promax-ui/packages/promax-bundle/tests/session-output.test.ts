import {
  mkdir,
  mkdtemp,
  realpath,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { WorkStore } from "../src/work-store.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalTrace } from "@promax/promax-report";
import ExcelJS from "exceljs";
import YAML from "yaml";

import {
  beginDispatchPlan,
  confirmDispatchPlan,
  enforceConfirmedDispatchCompleteness,
  enforceDispatchPlanTool,
  ensureSessionOutputDirectory,
  frozenInputMutationReason,
  prepareDispatchEvidenceInput,
  prepareTaskAttachmentsForPlanning,
  prepareTaskSubmission,
  prepareTaskSubmissionInput,
  readTaskRunFiles,
  saveTaskAttachments,
  sealTaskRunManifest,
  taskKeyFromSubmission,
  saveGeneratedDispatchPlan,
  readGeneratedDispatchPlan,
} from "../src/index.ts";
import {
  ensureProjectWorkspace,
  openCompanyProject,
  registerProjectWorkspaces,
} from "../src/index.ts";

const temporaryRoots: string[] = [];

const traces = new Map<string, LocalTrace>();
const telemetry = (root: string, id: string) => {
  const trace = traces.get(id) ?? new LocalTrace(root, id, "unit-test");
  traces.set(id, trace);
  return {
    admit: async () => {},
    observation: (_id: string, attrs: Record<string, unknown>) => {
      trace.event(trace.root, "observation", attrs);
      return trace.id;
    },
    traceId: () => trace.id,
  };
};
const TEAM_REVISION = {
  api_version: "promax.ai/v1alpha2",
  kind: "TeamRevision",
  metadata: { team_revision_id: "promax-product-team@r1", status: "published" },
  spec: {
    members: [
      { member_id: "solution_design", display_name: "方案" },
      { member_id: "quality_judge", display_name: "Judge" },
    ],
    artifacts: [
      {
        kind: "prd",
        validation_kind: "prd",
        relative_path: "deliverables/{task_key}/prd.md",
        produced_by: "solution_design",
      },
      {
        kind: "judge-report",
        validation_kind: "judge-report",
        relative_path: ".promax/judge/{task_key}/judge.md",
        produced_by: "quality_judge",
      },
    ],
    domain_rubrics: {
      prd: {
        display_name: "PRD",
        rules: [{ rule_id: "PRD_REQUIRED_SECTIONS", check: "check" }],
      },
    },
  },
};

async function modelPlanFixture(
  root: string,
  sessionId: string,
  opened: { planId: string; taskKey: string },
) {
  const text = `PROMAX_DISPATCH_PLAN_V1_START\n${JSON.stringify({ protocol: "promax.dispatch-plan/v1", plan_id: opened.planId, assessment: "测试计划", members: TEAM_REVISION.spec.members.map((member) => ({ member_id: member.member_id, selected: true, reason: "负责测试交付", deliverables: TEAM_REVISION.spec.artifacts.filter((artifact) => artifact.produced_by === member.member_id).map((artifact) => artifact.relative_path.replaceAll("{task_key}", opened.taskKey)) })) })}\nPROMAX_DISPATCH_PLAN_V1_END`;
  const event = {
    type: "assistant/message",
    seq: 0,
    time: Date.now(),
    data: { message: { content: [{ type: "text", text }] } },
  };
  await saveGeneratedDispatchPlan(root, {
    header: { id: sessionId },
    events: [event],
  });
  return (await readGeneratedDispatchPlan(root, {
    sessionId,
    planId: opened.planId,
  }))!;
}

async function temporaryRoot(): Promise<string> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "promax-session-output-")),
  );
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function judgeRepairFixture(sessionId: string, taskKey: string) {
  const root = await temporaryRoot(),
    works = new WorkStore(root);
  const card = await works.create({
    session_id: sessionId,
    project_id: "local:test",
    title: taskKey,
    shortname: taskKey,
  });
  await prepareTaskSubmission({
    workspacePath: root,
    sessionId,
    demand: taskKey,
    attachmentPaths: [],
    frozenAt: "2026-09-03T12:00:00.000Z",
  });
  await sealTaskRunManifest(root, {
    sessionId,
    taskKey,
    confirmedAt: new Date().toISOString(),
    confirmedMemberIds: ["solution_design"],
    artifacts: [
      { path: `deliverables/${taskKey}/prd.md`, memberId: "solution_design" },
      { path: `.promax/judge/${taskKey}/judge.md`, memberId: "quality_judge" },
    ],
    teamRevision: TEAM_REVISION,
  });
  await writeFile(
    join(root, ".任务", taskKey, "工作关联.yml"),
    YAML.stringify({
      work_key: card.work_key,
      author: "personal",
      kind: "ai_run",
    }),
  );
  await writeFile(
    join(root, ".任务", taskKey, "产物快照", "prd.md"),
    "# 初稿\n越出冻结输入范围。\n",
  );
  await works.employeeMessage(card.work_key, taskKey, []);
  await works.propose(
    card.work_key,
    `<promax-work>${JSON.stringify({ intent: "execute", card_patch: {}, deliverables: ["prd.md"], edit_request: null })}</promax-work>`,
    0,
    { artifacts: [{ relativePath: "prd.md", producedBy: "solution_design" }] },
  );
  await works.writeRound(card.work_key, {
    ...(await works.round(card.work_key))!,
    source: "click",
    task_key: taskKey,
    phase: "generating",
    check_scope: "冻结输入范围",
    allowed_members: ["solution_design"],
  });
  const writeReport = async (
    round: number,
    verdict: "PASS" | "REVISION_REQUIRED",
    evidence = "越出冻结输入范围",
  ) => {
    const sha256 = createHash("sha256")
      .update(
        await readFile(join(root, ".任务", taskKey, "产物快照", "prd.md")),
      )
      .digest("hex");
    const report = {
      reviewer: "quality_judge",
      round,
      verdict,
      scope: "冻结输入范围",
      reviewed_artifacts: [{ filename: "prd.md", sha256 }],
      issues:
        verdict === "PASS"
          ? []
          : [
              {
                id: "I1",
                severity: "high",
                artifact: "prd.md",
                location: "初稿",
                evidence,
                impact: "不符合要求",
                owner_member_id: "solution_design",
                fix: "只改问题位置",
              },
            ],
      unverified: [],
    };
    await writeFile(
      join(root, ".任务", taskKey, `判定-r${round}.md`),
      `---\n${YAML.stringify(report)}---\n${evidence}`,
    );
  };
  const steered: unknown[] = [],
    events: Array<{ type: string; data: unknown; seq: number }> = [
      { type: "tool/call", seq: 1, data: { name: "solution_design" } },
    ];
  const payload = {
    agent: {
      session: { header: { id: sessionId, cwd: root }, events },
      steer: (message: unknown) => {
        steered.push(message);
      },
    },
    turn: 3,
    signal: new AbortController().signal,
  };
  // Freeze trusted review context through the same transition as production, before writing Judge output.
  await enforceConfirmedDispatchCompleteness(
    root,
    payload,
    telemetry(root, sessionId),
  );
  expect((await works.round(card.work_key))?.judge_round).toBe(1);
  expect(steered).toHaveLength(1);
  steered.length = 0;
  await writeReport(1, "REVISION_REQUIRED");
  return {
    root,
    taskKey,
    sessionId,
    payload,
    steered,
    works,
    card,
    events,
    writeReport,
  };
}

describe("per-session output directories", () => {
  it("allows only the active task to write snapshots and rejects project escapes and sealed task changes", async () => {
    const workspace = await temporaryRoot();
    await ensureSessionOutputDirectory(workspace, "guard-session", "本次任务");
    const check = (name: string, args: Record<string, unknown>) =>
      frozenInputMutationReason({
        name,
        arguments: args,
        agent: { session: { header: { id: "guard-session", cwd: workspace } } },
      });
    expect(
      check("write", { path: ".任务/本次任务/产物快照/prd.md" }),
    ).toBeUndefined();
    for (const path of [
      "产物/prd.md",
      ".对象库/00/object",
      "deliverables/旧任务/prd.md",
      ".任务/其他任务/产物快照/prd.md",
      ".任务/本次任务/任务包.yml",
    ])
      expect(check("write", { path })).toBeDefined();
    expect(check("read", { path: "../其他项目/产物/prd.md" })).toBeDefined();
    expect(
      check("bash", { command: "cat ../其他项目/产物/prd.md" }),
    ).toBeDefined();
    await writeFile(
      join(workspace, ".任务/本次任务/run-control.yml"),
      '{"spec":{"state":"completed"}}',
    );
    expect(
      check("write", { path: ".任务/本次任务/产物快照/prd.md" }),
    ).toContain("任务已结束");
  });
  it("registers independent local projects with stable owner metadata and unchanged relative task paths", async () => {
    const root = await temporaryRoot();
    const owner = {
      employee_id: "personal",
      name: "个人",
      role: "owner" as const,
    };
    const registry = {
      create: async (path: string, title = "") => ({
        id: path,
        path,
        title,
        sessionIds: [],
      }),
    };
    await mkdir(join(root, "产品", "deliverables", "历史记录"), {
      recursive: true,
    });
    await writeFile(
      join(root, "产品", "deliverables", "历史记录", "prd.md"),
      "原始内容",
    );
    await mkdir(join(root, "另一个项目"));
    await mkdir(join(root, ".内部目录"));
    await symlink(join(root, "产品"), join(root, "项目链接"));
    const projects = await registerProjectWorkspaces(registry, root, owner);
    expect(projects.map((project) => project.title).sort()).toEqual([
      "产品",
      "另一个项目",
    ]);
    const a = projects.find((project) => project.title === "产品")!;
    const b = projects.find((project) => project.title === "另一个项目")!;
    await expect(readFile(join(a.path, "project.yml"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await ensureProjectWorkspace(registry, root, "产品", owner);
    await ensureProjectWorkspace(registry, root, "另一个项目", owner);
    const first = await readFile(join(a.path, "project.yml"), "utf8");
    const manifestA = YAML.parse(first);
    const manifestB = YAML.parse(
      await readFile(join(b.path, "project.yml"), "utf8"),
    );
    expect(manifestA.metadata.project_id).not.toBe(
      manifestB.metadata.project_id,
    );
    expect(manifestA.metadata.project_id).toMatch(/^local:/);
    const mapped = await openCompanyProject(
      registry,
      root,
      { project_id: "company-1", name: "产品", permissions: ["read", "write"] },
      "demo-employee",
    );
    expect(mapped.path).not.toBe(a.path);
    expect(
      YAML.parse(await readFile(join(mapped.path, "project.yml"), "utf8"))
        .metadata.project_id,
    ).toBe("company-1");
    const renamed = await openCompanyProject(
      registry,
      root,
      {
        project_id: "company-1",
        name: "改名后的产品",
        permissions: ["read", "write"],
      },
      "demo-employee",
    );
    expect(renamed.path).toBe(mapped.path);
    expect(manifestA.spec.members).toEqual([owner]);
    expect(manifestB.spec.members).toEqual([owner]);
    await ensureProjectWorkspace(registry, root, "产品", owner);
    expect(await readFile(join(a.path, "project.yml"), "utf8")).toBe(first);
    for (const [index, project] of [a, b].entries()) {
      const prepared = await prepareTaskSubmission({
        workspacePath: project.path,
        sessionId: `session-${index}`,
        demand: "相同任务名",
        attachmentPaths: [],
        frozenAt: "2026-09-05T15:00:00.000Z",
      });
      expect(prepared.taskKey).toBe("相同任务名");
      expect(await readdir(project.path)).not.toContain("产出");
    }
    expect(
      await readFile(
        join(a.path, "deliverables", "历史记录", "prd.md"),
        "utf8",
      ),
    ).toBe("原始内容");
    expect(await readdir(join(b.path, ".任务"))).toEqual(["相同任务名"]);
    expect(await readdir(join(b.path, ".promax", "session-scopes"))).toEqual([
      "session-1.json",
    ]);
    await expect(
      ensureProjectWorkspace(registry, root, "../越界", owner),
    ).rejects.toThrow();
    await expect(
      ensureProjectWorkspace(registry, root, "项目链接", owner),
    ).rejects.toThrow("项目路径必须是独立目录");
  });
  it("uses the visible Chinese session name and suffixes duplicate folders", async () => {
    const root = await temporaryRoot();
    const first = await ensureSessionOutputDirectory(
      root,
      "session-1",
      "图书馆座位预约",
    );
    const duplicate = await ensureSessionOutputDirectory(
      root,
      "session-2",
      "图书馆座位预约",
    );
    const repeated = await ensureSessionOutputDirectory(
      root,
      "session-1",
      "会被已有映射忽略",
    );

    expect(first).toEqual({
      sessionName: "图书馆座位预约",
      taskKey: "图书馆座位预约",
      relativePath: ".任务/图书馆座位预约/产物快照",
    });
    expect(duplicate.sessionName).toBe("图书馆座位预约-2");
    expect(repeated).toEqual(first);
    expect(await readdir(join(root, ".任务"))).toEqual([
      "图书馆座位预约",
      "图书馆座位预约-2",
    ]);
    expect(
      JSON.parse(
        await readFile(
          join(root, ".promax", "session-scopes", "session-1.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      sessionName: "图书馆座位预约",
      taskKey: "图书馆座位预约",
    });
  });

  it("rejects names that could escape or break a cross-platform project directory", async () => {
    const root = await temporaryRoot();
    await expect(
      ensureSessionOutputDirectory(root, "session-1", "../越界"),
    ).rejects.toThrow("会话名称不能安全地用作产出目录");
  });

  it("derives a safe content topic for text-only and pure-file submissions", () => {
    expect(
      taskKeyFromSubmission(
        "版本一验收：依据共同输入.md，为虚构场馆预约站内提醒写简短 prd.md，本版提前30分钟提醒。",
        [],
      ).length,
    ).toBeLessThanOrEqual(40);
    expect(taskKeyFromSubmission("请整理会员续费提醒的验收方案", [])).toBe(
      "请整理会员续费提醒的验收方案",
    );
    expect(
      taskKeyFromSubmission("brief.txt", [
        {
          name: "brief.txt",
          text: "# 文件转换说明\n会员流失预警看板\n按渠道拆解流失原因",
        },
      ]),
    ).toBe("会员流失预警看板");
    expect(
      taskKeyFromSubmission("", [
        { name: "输入.md", text: "门店巡检异常闭环：按区域分派" },
      ]),
    ).toBe("门店巡检异常闭环-按区域分派");
  });
});

describe("dispatch confirmation gate", () => {
  it("requires a persisted native model plan, rejects forged and stale plans, and allows adding an unselected team member", async () => {
    const root = await temporaryRoot();
    const sessionId = "session-model-gate";
    const opened = await beginDispatchPlan(root, {
      sessionId,
      taskKey: "计划门禁",
      rosterMemberIds: ["solution_design", "quality_judge"],
      teamRevision: TEAM_REVISION,
    });
    const input = {
      sessionId,
      planId: opened.planId,
      confirmedMemberIds: ["solution_design", "quality_judge"],
    };
    const raw = {
      protocol: "promax.dispatch-plan/v1",
      plan_id: opened.planId,
      assessment: "等待用户选择业务成员",
      members: [
        {
          member_id: "solution_design",
          selected: false,
          reason: "目标尚未明确，用户可手动加入方案成员",
        },
        {
          member_id: "quality_judge",
          selected: true,
          reason: "独立验收",
          deliverables: [".promax/judge/计划门禁/judge.md"],
        },
      ],
    };
    const frame = (value: unknown) =>
      `PROMAX_DISPATCH_PLAN_V1_START\n${JSON.stringify(value)}\nPROMAX_DISPATCH_PLAN_V1_END`;
    const event = (text: string, type = "assistant/message", seq = 1) => ({
      type,
      seq,
      time: Date.now(),
      data: { message: { content: [{ type: "text", text }] } },
    });
    const save = async (events: ReturnType<typeof event>[], id = sessionId) =>
      saveGeneratedDispatchPlan(root, { header: { id }, events });
    for (const candidate of [
      event(frame(raw), "user/message"),
      event(frame({ ...raw, plan_id: "wrong-plan" })),
      event("invalid JSON"),
      event(frame({ ...raw, members: [] })),
    ]) {
      await save([candidate]);
      await expect(
        confirmDispatchPlan(root, { ...input, plan: raw }),
      ).rejects.toThrow("模型计划尚未生成并保存");
      expect(await readdir(root)).toEqual([`${sessionId}.planning.json`]);
    }
    await save([event(frame(raw))], "session-other");
    expect(await readGeneratedDispatchPlan(root, input)).toBeUndefined();
    await save([event(frame(raw))]);
    const plan = (await readGeneratedDispatchPlan(root, input))!;
    expect(plan.members[0]?.selected).toBe(false);
    expect(plan.members[0]?.deliverables).toEqual([
      "deliverables/计划门禁/prd.md",
    ]);
    await expect(
      confirmDispatchPlan(root, {
        ...input,
        plan,
        confirmedMemberIds: ["quality_judge"],
      }),
    ).rejects.toThrow("至少一名业务成员");
    await expect(
      confirmDispatchPlan(root, {
        ...input,
        plan: { ...plan, assessment: "伪造计划" },
      }),
    ).rejects.toThrow("与服务端保存的模型计划不一致");
    await expect(
      confirmDispatchPlan(root, {
        ...input,
        plan,
        confirmedMemberIds: ["outside_member", "quality_judge"],
      }),
    ).rejects.toThrow("不属于当前团队名单");
    await save([
      event(
        frame({ ...raw, assessment: "更新后的模型计划" }),
        "assistant/message",
        2,
      ),
    ]);
    await expect(confirmDispatchPlan(root, { ...input, plan })).rejects.toThrow(
      "与服务端保存的模型计划不一致",
    );
    const latest = (await readGeneratedDispatchPlan(root, input))!;
    const confirmed = await confirmDispatchPlan(root, {
      ...input,
      plan: latest,
    });
    expect(confirmed.confirmedMemberIds).toEqual(input.confirmedMemberIds);
    await expect(
      confirmDispatchPlan(root, {
        ...input,
        plan: {
          members: latest.members,
          assessment: latest.assessment,
          planId: latest.planId,
          protocol: latest.protocol,
        },
      }),
    ).resolves.toEqual(confirmed);
    const saved = JSON.parse(
      await readFile(join(root, `${sessionId}.confirmed.json`), "utf8"),
    );
    expect(saved.spec.model_plan.plan.members[0].selected).toBe(false);
    expect(saved.spec.model_plan.source_event_seq).toBe(2);
    await save([event(frame(raw), "assistant/message", 3)]);
    expect(
      JSON.parse(
        await readFile(join(root, `${sessionId}.confirmed.json`), "utf8"),
      ),
    ).toEqual(saved);
    delete saved.spec.team_revision;
    delete saved.spec.model_plan;
    await writeFile(
      join(root, `${sessionId}.confirmed.json`),
      JSON.stringify(saved),
    );
    await expect(
      confirmDispatchPlan(root, { ...input, plan: latest }),
    ).rejects.toThrow("历史计划缺少团队版本快照，请新建需求");
  });

  it("blocks all planning tools and then enforces the immutable confirmed member list", async () => {
    const root = await temporaryRoot();
    const opened = await beginDispatchPlan(root, {
      sessionId: "session-plan",
      taskKey: "登录流程",
      rosterMemberIds: ["solution_design", "quality_judge"],
      teamRevision: TEAM_REVISION,
    });
    let dispatched = 0;
    const next = async () => {
      dispatched += 1;
      return { kind: "allow" };
    };
    const executionMessage = `PROMAX_DISPATCH_EXECUTE_V1\n${JSON.stringify({
      plan_id: opened.planId,
      task_key: "登录流程",
      demand: "为移动端设计登录流程",
      attachment_paths: [],
      confirmed_member_ids: ["solution_design", "quality_judge"],
      assignments: [],
    })}`;
    const execution = (name: string) => ({
      name,
      agent: {
        session: {
          header: { id: "session-plan", cwd: root },
          events: [
            {
              type: "user/message",
              data: { content: [{ type: "text", text: executionMessage }] },
            },
          ],
        },
      },
    });

    await expect(
      enforceDispatchPlanTool(root, execution("solution_design"), next),
    ).resolves.toEqual({
      kind: "deny",
      reason: "调度计划尚未由用户确认；规划阶段禁止调用任何工具或启动成员",
    });
    await expect(
      enforceDispatchPlanTool(root, execution("bash"), next),
    ).resolves.toEqual(expect.objectContaining({ kind: "deny" }));
    expect(dispatched).toBe(0);

    await expect(
      confirmDispatchPlan(root, {
        sessionId: "session-plan",
        planId: opened.planId,
        confirmedMemberIds: ["solution_design", "quality_judge"],
      }),
    ).rejects.toThrow("模型计划尚未生成并保存");
    const plan = await modelPlanFixture(root, "session-plan", opened);
    const confirmed = await confirmDispatchPlan(root, {
      sessionId: "session-plan",
      planId: opened.planId,
      confirmedMemberIds: ["solution_design", "quality_judge"],
      plan,
    });
    expect(confirmed.confirmedMemberIds).toEqual([
      "solution_design",
      "quality_judge",
    ]);
    await expect(
      enforceDispatchPlanTool(root, execution("solution_design"), next),
    ).resolves.toEqual({ kind: "allow" });
    await expect(
      enforceDispatchPlanTool(root, execution("quality_judge"), next),
    ).resolves.toEqual({ kind: "allow" });
    expect(dispatched).toBe(2);
    const manifest = YAML.parse(
      await readFile(
        join(root, ".promax", "input", "登录流程", "manifest.yml"),
        "utf8",
      ),
    );
    expect(manifest).toMatchObject({
      api_version: "promax.ai/v1alpha2",
      kind: "EvidenceInputManifest",
      metadata: { task_key: "登录流程", frozen: true },
      inputs: { src_files: [] },
      spec: {
        sources: [
          {
            source_id: "SRC-001",
            relative_path: ".promax/input/登录流程/sources/SRC-001/demand.md",
          },
        ],
      },
    });

    await expect(
      confirmDispatchPlan(root, {
        sessionId: "session-plan",
        planId: opened.planId,
        confirmedMemberIds: ["quality_judge", "solution_design"],
        plan,
      }),
    ).rejects.toThrow("调度名单已经确认，不能再次修改");
  });

  it("keeps the platform-owned frozen input tree read-only for parent and child agent tools", async () => {
    const workspace = await temporaryRoot();
    const next = async () => ({ kind: "allow" as const });
    const execution = (
      name: string,
      args: Record<string, unknown>,
      origin?: "subagent",
    ) => ({
      name,
      arguments: args,
      agent: {
        session: {
          header: {
            id: origin === "subagent" ? "child-session" : "parent-session",
            cwd: workspace,
            ...(origin === undefined
              ? {}
              : { origin, parentSession: "parent-session" }),
          },
          events: [],
        },
      },
    });

    await expect(
      enforceDispatchPlanTool(
        workspace,
        execution(
          "write",
          {
            file_path: ".promax/input/调研任务/manifest.yml",
            content: "tampered",
          },
          "subagent",
        ),
        next,
      ),
    ).resolves.toMatchObject({
      kind: "deny",
      reason: expect.stringContaining("冻结输入与内容对象只读"),
    });
    await expect(
      enforceDispatchPlanTool(
        workspace,
        execution("edit", {
          file_path: join(
            workspace,
            ".promax",
            "input",
            "调研任务",
            "sources",
            "SRC-001",
            "demand.md",
          ),
          old_string: "a",
          new_string: "b",
        }),
        next,
      ),
    ).resolves.toMatchObject({
      kind: "deny",
      reason: expect.stringContaining("冻结输入与内容对象只读"),
    });
    await expect(
      enforceDispatchPlanTool(
        workspace,
        execution(
          "bash",
          {
            command: "sed -i.bak s/a/b/ .promax/input/调研任务/manifest.yml",
          },
          "subagent",
        ),
        next,
      ),
    ).resolves.toMatchObject({
      kind: "deny",
      reason: expect.stringContaining("不通过 shell 改写"),
    });

    await expect(
      enforceDispatchPlanTool(
        workspace,
        execution(
          "bash",
          {
            command: "shasum -a 256 .promax/input/调研任务/manifest.yml",
          },
          "subagent",
        ),
        next,
      ),
    ).resolves.toEqual({ kind: "allow" });
    await expect(
      enforceDispatchPlanTool(
        workspace,
        execution(
          "write",
          {
            file_path: "deliverables/调研任务/customer_research.md",
            content: "# report",
          },
          "subagent",
        ),
        next,
      ),
    ).resolves.toMatchObject({ kind: "deny" });
  });

  it("rejects malformed historical frozen input without rewriting or quarantining it", async () => {
    const root = await temporaryRoot();
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const attachmentPaths = await saveTaskAttachments(
      workspace,
      "session-evidence",
      [
        {
          name: "brief.txt",
          contentBase64: Buffer.from("only-in-attachment").toString("base64"),
        },
      ],
    );
    const opened = await beginDispatchPlan(root, {
      sessionId: "session-evidence",
      taskKey: "续费提醒",
      rosterMemberIds: ["solution_design", "quality_judge"],
      teamRevision: TEAM_REVISION,
    });
    const plan = await modelPlanFixture(root, "session-evidence", opened);
    await confirmDispatchPlan(root, {
      sessionId: "session-evidence",
      planId: opened.planId,
      confirmedMemberIds: ["solution_design", "quality_judge"],
      plan,
    });
    const invalidRoot = join(workspace, ".promax", "input", "续费提醒");
    await mkdir(invalidRoot, { recursive: true });
    await writeFile(
      join(invalidRoot, "manifest.yml"),
      "schema: promax.manifest/v1\ninputs:\n  src_files: []\n",
    );

    const executionMessage = `PROMAX_DISPATCH_EXECUTE_V1\n${JSON.stringify({
      plan_id: opened.planId,
      task_key: "续费提醒",
      demand: "设计会员续费提醒功能",
      attachment_paths: attachmentPaths,
      confirmed_member_ids: ["solution_design", "quality_judge"],
      assignments: [],
    })}`;
    const session = {
      header: { id: "session-evidence", cwd: workspace },
      events: [
        {
          type: "user/message",
          data: { content: [{ type: "text", text: executionMessage }] },
        },
      ],
    };
    let dispatched = 0;
    const next = async () => {
      dispatched += 1;
      return { kind: "allow" };
    };
    await expect(
      enforceDispatchPlanTool(
        root,
        { name: "solution_design", agent: { session } },
        next,
      ),
    ).resolves.toMatchObject({
      kind: "deny",
      reason: expect.stringContaining("历史冻结输入只读"),
    });
    expect(dispatched).toBe(0);
    expect(await readFile(join(invalidRoot, "manifest.yml"), "utf8")).toBe(
      "schema: promax.manifest/v1\ninputs:\n  src_files: []\n",
    );
    expect(await readdir(join(workspace, ".promax", "input"))).toEqual([
      "续费提醒",
    ]);
  });

  it("freezes an xlsx original plus an agent-readable CSV with converter metadata", async () => {
    const workspace = await temporaryRoot();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("会员");
    sheet.addRow(["用户", "续费日"]);
    sheet.addRow(["唯一用户-XL-408", "2026-09-30"]);
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
    const attachmentPaths = await saveTaskAttachments(
      workspace,
      "session-xlsx",
      [
        {
          name: "members.xlsx",
          contentBase64: xlsx.toString("base64"),
        },
      ],
    );

    const planningContext = await prepareTaskAttachmentsForPlanning(
      workspace,
      "session-xlsx",
      attachmentPaths,
    );
    expect(planningContext).toMatchObject([
      {
        name: "members.xlsx",
        mediaType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        textCharacters: expect.any(Number),
        converter: "exceljs 4.4.0",
        truncated: false,
      },
    ]);
    expect(planningContext[0]?.excerpt).toContain("唯一用户-XL-408");
    expect(
      await readFile(join(workspace, planningContext[0]!.readablePath), "utf8"),
    ).toContain("唯一用户-XL-408");

    await prepareDispatchEvidenceInput({
      workspacePath: workspace,
      sessionId: "session-xlsx",
      taskKey: "表格输入测试",
      demand: "根据附件生成方案",
      attachmentPaths,
      frozenAt: "2026-09-03T12:00:00.000Z",
    });

    const manifest = YAML.parse(
      await readFile(
        join(workspace, ".promax", "input", "表格输入测试", "manifest.yml"),
        "utf8",
      ),
    );
    expect(manifest.inputs.src_files).toMatchObject([
      {
        source_id: "SRC-001",
        original_filename: "members.xlsx",
        agent_readable: false,
      },
      {
        source_id: "SRC-002",
        original_filename: "members.xlsx",
        agent_readable: true,
        conversion: {
          tool: "exceljs",
          version: "4.4.0",
          from_source_id: "SRC-001",
        },
      },
    ]);
    expect(
      await readFile(
        join(
          workspace,
          ".promax",
          "input",
          "表格输入测试",
          "sources",
          "SRC-002",
          "SRC-002.csv",
        ),
        "utf8",
      ),
    ).toContain("唯一用户-XL-408");
  });

  it("freezes Chinese upload names as source-id paths while preserving the UI names", async () => {
    const workspace = await temporaryRoot();
    const attachmentPaths = await saveTaskAttachments(
      workspace,
      "session-submit",
      [
        {
          name: "测试-访谈记录.txt",
          contentBase64: Buffer.from("unique-first").toString("base64"),
        },
        {
          name: "测试-访谈记录.txt",
          contentBase64: Buffer.from("unique-second").toString("base64"),
        },
      ],
    );

    const prepared = await prepareTaskSubmissionInput({
      workspacePath: workspace,
      sessionId: "session-submit",
      taskKey: "提交即冻结",
      demand: "严格依据两个附件输出结果",
      attachmentPaths,
      frozenAt: "2026-09-03T13:00:00.000Z",
    });

    expect(prepared.manifestPath).toBe(
      join(workspace, ".promax", "input", "提交即冻结", "manifest.yml"),
    );
    expect(prepared.attachments.map((item) => item.name)).toEqual([
      "测试-访谈记录.txt",
      "测试-访谈记录（2）.txt",
    ]);
    expect(prepared.attachments.map((item) => item.readablePath)).toEqual([
      ".promax/input/提交即冻结/sources/SRC-001/SRC-001.txt",
      ".promax/input/提交即冻结/sources/SRC-002/SRC-002.txt",
    ]);
    const manifest = YAML.parse(await readFile(prepared.manifestPath, "utf8"));
    expect(
      manifest.inputs.src_files.map(
        (item: { original_filename: string; relative_path: string }) => [
          item.original_filename,
          item.relative_path,
        ],
      ),
    ).toEqual([
      [
        "测试-访谈记录.txt",
        ".promax/input/提交即冻结/sources/SRC-001/SRC-001.txt",
      ],
      [
        "测试-访谈记录（2）.txt",
        ".promax/input/提交即冻结/sources/SRC-002/SRC-002.txt",
      ],
    ]);
    expect(
      await readFile(
        join(
          workspace,
          ".promax",
          "input",
          "提交即冻结",
          "sources",
          "SRC-002",
          "SRC-002.txt",
        ),
        "utf8",
      ),
    ).toBe("unique-second");
  });

  it("executes the work-scoped frozen member contract, then seals a strict passing report", async () => {
    const root = await temporaryRoot(),
      works = new WorkStore(root);
    const card = await works.create({
      session_id: "session-complete",
      project_id: "local:test",
      title: "登录流程",
      shortname: "登录流程",
    });
    const prepared = await prepareTaskSubmission({
      workspacePath: root,
      sessionId: "session-complete",
      demand: "登录流程",
      attachmentPaths: [],
      frozenAt: "2026-09-03T12:00:00.000Z",
    });
    const opened = await beginDispatchPlan(root, {
      sessionId: "session-complete",
      taskKey: prepared.taskKey,
      rosterMemberIds: ["solution_design", "quality_judge"],
      teamRevision: TEAM_REVISION,
    });
    const plan = await modelPlanFixture(root, "session-complete", opened);
    const confirmed = await confirmDispatchPlan(root, {
      sessionId: "session-complete",
      planId: opened.planId,
      confirmedMemberIds: ["solution_design", "quality_judge"],
      plan,
    });
    await sealTaskRunManifest(root, {
      sessionId: "session-complete",
      taskKey: prepared.taskKey,
      confirmedAt: confirmed.confirmedAt,
      confirmedMemberIds: confirmed.confirmedMemberIds,
      artifacts: [
        { path: "deliverables/登录流程/prd.md", memberId: "solution_design" },
        { path: ".promax/judge/登录流程/judge.md", memberId: "quality_judge" },
      ],
      teamRevision: TEAM_REVISION,
    });
    await works.employeeMessage(card.work_key, "登录流程", []);
    await works.writeRound(card.work_key, {
      ...(await works.round(card.work_key))!,
      source: "click",
      task_key: prepared.taskKey,
      turn: {
        intent: "execute",
        card_patch: {},
        deliverables: ["prd.md"],
        edit_request: null,
      },
    });
    await writeFile(
      join(root, ".任务", prepared.taskKey, "工作关联.yml"),
      YAML.stringify({
        work_key: card.work_key,
        author: "personal",
        kind: "ai_run",
      }),
    );
    const executionMessage = `PROMAX_DISPATCH_EXECUTE_V1\n${JSON.stringify({
      plan_id: opened.planId,
      task_key: prepared.taskKey,
      demand: "登录流程",
      attachment_paths: [],
      confirmed_member_ids: confirmed.confirmedMemberIds,
      assignments: [],
    })}`;
    const steered: unknown[] = [];
    const events: Array<{ type: string; data: unknown }> = [
      {
        type: "user/message",
        data: { content: [{ type: "text", text: executionMessage }] },
      },
    ];
    const payload = {
      agent: {
        session: { header: { id: "session-complete", cwd: root }, events },
        steer: (message: unknown) => {
          steered.push(message);
        },
      },
      turn: 2,
      signal: new AbortController().signal,
    };

    await enforceConfirmedDispatchCompleteness(
      root,
      payload as Parameters<typeof enforceConfirmedDispatchCompleteness>[1],
      telemetry(root, "session-complete"),
    );
    expect(steered).toHaveLength(1);
    expect(JSON.stringify(steered[0])).toContain("solution_design");

    events.push({
      type: "tool/call",
      data: { turn: 2, name: "solution_design" },
    });
    expect(steered).toHaveLength(1);

    await mkdir(join(root, ".任务", "登录流程", "产物快照"), {
      recursive: true,
    });
    await writeFile(
      join(root, ".任务", "登录流程", "产物快照", "prd.md"),
      "# 登录流程 PRD\n",
    );
    await enforceConfirmedDispatchCompleteness(
      root,
      payload as Parameters<typeof enforceConfirmedDispatchCompleteness>[1],
      telemetry(root, "session-complete"),
    );
    expect(steered).toHaveLength(2);
    expect(JSON.stringify(steered[1])).toContain("quality_judge");
    expect(JSON.stringify(steered[1])).toContain("reviewed_artifacts");
    expect(JSON.stringify(steered[1])).toContain("判定-r1.md");

    events.push({
      type: "tool/call",
      data: { turn: 2, name: "quality_judge" },
    });
    expect(steered).toHaveLength(2);

    await mkdir(join(root, ".任务", "登录流程"), { recursive: true });
    const round = (await works.round(card.work_key))!;
    await writeFile(
      join(root, ".任务", "登录流程", "判定-r1.md"),
      `---\n${YAML.stringify({ reviewer: "quality_judge", round: 1, verdict: "PASS", scope: round.check_scope, reviewed_artifacts: Object.entries(round.reviewed_hashes!).map(([filename, sha256]) => ({ filename, sha256 })), issues: [], unverified: [] })}---\n检查通过`,
    );
    await enforceConfirmedDispatchCompleteness(
      root,
      { ...payload, turn: 3 } as Parameters<
        typeof enforceConfirmedDispatchCompleteness
      >[1],
      telemetry(root, "session-complete"),
    );
    expect(steered).toHaveLength(2);
    await expect(
      readTaskRunFiles(root, {
        sessionId: "session-complete",
        taskKey: "登录流程",
      }),
    ).resolves.toMatchObject({
      cancellation: "completed",
      manifestPath: ".任务/登录流程/任务包.yml",
      inputManifestPath: ".任务/登录流程/输入/manifest.yml",
      artifactStates: [
        {
          path: ".任务/登录流程/产物快照/prd.md",
          exists: true,
          nonEmpty: true,
        },
      ],
      judge: {
        path: ".任务/登录流程/判定-r1.md",
        state: "pass",
        exists: true,
        nonEmpty: true,
      },
    });

    await expect(
      writeFile(join(root, ".任务", "登录流程", "判定-r1.md"), "tamper"),
    ).rejects.toThrow();
    await expect(
      readTaskRunFiles(root, {
        sessionId: "session-complete",
        taskKey: "登录流程",
      }),
    ).resolves.toMatchObject({
      judge: { state: "pass" },
    });
  });

  it("closes Judge block through repair, regenerated artifact, and a passing recheck without mutating frozen input", async () => {
    const fixture = await judgeRepairFixture(
      "session-repair-pass",
      "返修后通过",
    );
    const manifestPath = join(
      fixture.root,
      ".任务",
      fixture.taskKey,
      "输入",
      "manifest.yml",
    );
    const frozenBefore = await readFile(manifestPath, "utf8");

    await enforceConfirmedDispatchCompleteness(
      fixture.root,
      fixture.payload as Parameters<
        typeof enforceConfirmedDispatchCompleteness
      >[1],
      telemetry(fixture.root, fixture.sessionId),
    );
    expect(fixture.steered).toHaveLength(1);
    expect(JSON.stringify(fixture.steered[0])).toContain(
      "只调用问题责任成员 solution_design",
    );
    expect(JSON.stringify(fixture.steered[0])).toContain("不重跑无关成员");

    await writeFile(
      join(fixture.root, ".任务", fixture.taskKey, "产物快照", "prd.md"),
      "# 返修稿\n严格遵循冻结输入。\n",
    );
    fixture.events.push({
      type: "tool/call",
      seq: 2,
      data: { name: "solution_design" },
    });
    await enforceConfirmedDispatchCompleteness(
      fixture.root,
      { ...fixture.payload, turn: 4 } as Parameters<
        typeof enforceConfirmedDispatchCompleteness
      >[1],
      telemetry(fixture.root, fixture.sessionId),
    );
    expect(fixture.steered).toHaveLength(2);
    expect(JSON.stringify(fixture.steered[1])).toContain("判定-r2.md");

    await fixture.writeReport(2, "PASS");
    await enforceConfirmedDispatchCompleteness(
      fixture.root,
      { ...fixture.payload, turn: 5 } as Parameters<
        typeof enforceConfirmedDispatchCompleteness
      >[1],
      telemetry(fixture.root, fixture.sessionId),
    );
    await expect(
      readTaskRunFiles(fixture.root, {
        sessionId: fixture.sessionId,
        taskKey: fixture.taskKey,
      }),
    ).resolves.toMatchObject({
      cancellation: "completed",
      judge: { state: "pass" },
    });
    expect(
      (await fixture.works.round(fixture.card.work_key))?.repair_round,
    ).toBe(1);
    expect(await readFile(manifestPath, "utf8")).toBe(frozenBefore);
    expect(
      await readFile(
        join(fixture.root, ".任务", fixture.taskKey, "判定-r1.md"),
        "utf8",
      ),
    ).toContain("REVISION_REQUIRED");
  });

  it("stops after two failed repair rounds and exposes every final Judge reason", async () => {
    const fixture = await judgeRepairFixture(
      "session-repair-exhausted",
      "返修两轮仍失败",
    );

    await enforceConfirmedDispatchCompleteness(
      fixture.root,
      fixture.payload as Parameters<
        typeof enforceConfirmedDispatchCompleteness
      >[1],
      telemetry(fixture.root, fixture.sessionId),
    );
    await writeFile(
      join(fixture.root, ".任务", fixture.taskKey, "产物快照", "prd.md"),
      "# 第一轮返修\n仍有越界 A。\n",
    );
    fixture.events.push({
      type: "tool/call",
      seq: 2,
      data: { name: "solution_design" },
    });
    await enforceConfirmedDispatchCompleteness(
      fixture.root,
      { ...fixture.payload, turn: 4 } as Parameters<
        typeof enforceConfirmedDispatchCompleteness
      >[1],
      telemetry(fixture.root, fixture.sessionId),
    );
    await fixture.writeReport(2, "REVISION_REQUIRED", "第一轮仍有越界 A");
    await enforceConfirmedDispatchCompleteness(
      fixture.root,
      { ...fixture.payload, turn: 5 } as Parameters<
        typeof enforceConfirmedDispatchCompleteness
      >[1],
      telemetry(fixture.root, fixture.sessionId),
    );
    expect(
      (await fixture.works.round(fixture.card.work_key))?.repair_round,
    ).toBe(2);

    await writeFile(
      join(fixture.root, ".任务", fixture.taskKey, "产物快照", "prd.md"),
      "# 第二轮返修\n仍有越界 B。\n",
    );
    fixture.events.push({
      type: "tool/call",
      seq: 3,
      data: { name: "solution_design" },
    });
    await enforceConfirmedDispatchCompleteness(
      fixture.root,
      { ...fixture.payload, turn: 6 } as Parameters<
        typeof enforceConfirmedDispatchCompleteness
      >[1],
      telemetry(fixture.root, fixture.sessionId),
    );
    expect(JSON.stringify(fixture.steered.at(-1))).toContain("判定-r3.md");
    await fixture.writeReport(3, "REVISION_REQUIRED", "第二轮仍有越界 B");
    await enforceConfirmedDispatchCompleteness(
      fixture.root,
      { ...fixture.payload, turn: 7 } as Parameters<
        typeof enforceConfirmedDispatchCompleteness
      >[1],
      telemetry(fixture.root, fixture.sessionId),
    );

    const files = await readTaskRunFiles(fixture.root, {
      sessionId: fixture.sessionId,
      taskKey: fixture.taskKey,
    });
    expect(files.cancellation).toBe("completed");
    expect(await fixture.works.round(fixture.card.work_key)).toMatchObject({
      phase: "ended",
      repair_round: 2,
      allowed_members: [],
    });
    expect(
      (await fixture.works.read(fixture.card.work_key)).last_progress,
    ).toContain("待人判断");
    expect(
      await readFile(
        join(fixture.root, ".任务", fixture.taskKey, "判定-r3.md"),
        "utf8",
      ),
    ).toContain("第二轮仍有越界 B");
    expect(fixture.steered).toHaveLength(4);
  });
});
