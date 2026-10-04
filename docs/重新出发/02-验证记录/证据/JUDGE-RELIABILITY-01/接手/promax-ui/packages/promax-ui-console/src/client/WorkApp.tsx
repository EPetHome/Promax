import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { micromark } from "micromark";
import { requestProgressText } from "../request-progress.ts";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import {
  requirementsDigest,
  type DecisionRecord,
  type PendingItem,
  type WorkCard,
} from "../work-protocol.ts";
import {
  decisionTurnFailed,
  displayMemberState,
  MEMBER_STATE_LABEL,
  mergeTimeline,
  deliveryTimeline,
  messageEventStates,
  outcomeTimeline,
  TEAM_ROLES,
  workTimeline,
  type TimelineItem,
} from "./work-timeline.ts";
import { workRequest, type WorkView, type ProjectScope } from "./work-api.ts";
import {
  type WorkspaceShellActions,
  type WorkspaceListState,
  type SessionListState,
  workspacesForTeam,
} from "./PromaxWorkspaceShell.tsx";
import { useTeamState, PRODUCT_PRESET_ID } from "./team-state.ts";
import {
  CompanyLoginEntry,
  CompanyProjects,
  ModelSelector,
  useCompanyConnection,
} from "./company-connection.tsx";
import { type PromaxSettingsService } from "./PromaxSettings.tsx";
import { ConsoleLauncher } from "./ConsoleLauncher.tsx";
import { ProjectFiles } from "./ProjectFiles.tsx";
import { FeishuConflicts } from "./FeishuConflicts.tsx";
import { taskAttachmentSelectionError } from "./task-attachments.ts";
import { ProjectPicker } from "./ProjectPicker.tsx";
import { WorkSettingsDialog } from "./WorkSettingsDialog.tsx";
import { WorkComposer, type ComposerChip } from "./WorkComposer.tsx";
import { CurrentWork, type DocQuote } from "./CurrentWork.tsx";
import { deliverableLabel } from "./WorkDraft.tsx";
import { ProgressTrunk } from "./ProgressTrunk.tsx";
import { WorkspaceSplit } from "./WorkspaceSplit.tsx";
import { scopeSignature } from "../work-scope.ts";
import { sameDecision } from "../work-spine.ts";
import {
  EVENT_STATE_LABEL,
  orderQuestions,
  pendingResponseCount,
  questionViews,
  type QuestionView,
} from "../work-control.ts";
import { QuestionQueue } from "./QuestionQueue.tsx";
import { WorkActivity } from "./WorkActivity.tsx";
import { ArtifactPreview } from "./ArtifactPreview.tsx";
import type { MemberExecution } from "../execution-protocol.ts";
import { useWorkInteraction } from "./work-interaction.ts";
import { DocPointer, type PointerOpen } from "./DocPointer.tsx";
import { questionLabel, shortText } from "./work-tree.ts";
import { WORK_APP_CSS } from "./work-styles.ts";
import logo from "../assets/first-usable/logo-38.png";
import { MemberAvatar } from "../components/BrandAssets.tsx";
import { Icon } from "../components/icons.tsx";
import { installPromaxConsoleStyles } from "../styles.ts";
interface Observable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
interface Conversation {
  running: boolean;
  nodes?: readonly unknown[];
  partial?: { blocks: readonly unknown[] } | null;
  runningCalls?: readonly unknown[];
  promptError?: unknown;
}
export interface WorkAppProps extends WorkspaceShellActions {
  workspaceStore: Observable<WorkspaceListState>;
  sessionStore: Observable<SessionListState>;
  conversationFor(
    id: string,
  ):
    | (Observable<Conversation> & { cancel(): Promise<{ ok: boolean }> })
    | undefined;
  settings: PromaxSettingsService;
  apiBaseUrl?: string;
}
const empty: Conversation = { running: false, nodes: [] };
const EMPTY_WORK: WorkView = { card: null, round: null };
const NO_WORKS: WorkCard[] = [];
/** Files waiting to go out with the next message of one project/work context. */
const NO_FILES: File[] = [];
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function useConversation(props: WorkAppProps, id?: string) {
  const binding = id ? props.conversationFor(id) : undefined;
  return useSyncExternalStore(
    (listener) => binding?.subscribe(listener) ?? (() => {}),
    () => binding?.getSnapshot() ?? empty,
  );
}
export function ScopeCountdown({
  revision,
  onStart,
  onWait,
}: {
  revision: string;
  onStart(source: "click" | "countdown"): Promise<void>;
  onWait(): void;
}) {
  const [seconds, setSeconds] = useState(5),
    [waiting, setWaiting] = useState(false),
    [error, setError] = useState("");
  const started = useRef(false);
  const paused = useRef(false);
  const startRef = useRef(onStart);
  startRef.current = onStart;
  const begin = async (source: "click" | "countdown") => {
    if (started.current) return;
    started.current = true;
    setWaiting(true);
    try {
      await startRef.current(source);
    } catch (e) {
      setError(String(e));
      started.current = false;
    }
  };
  useEffect(() => {
    started.current = false;
    paused.current = false;
    setSeconds(5);
    setWaiting(false);
    setError("");
  }, [revision]);
  useEffect(() => {
    if (waiting || paused.current) return;
    const timer = window.setTimeout(() => {
      if (paused.current) return;
      if (seconds > 1) setSeconds(seconds - 1);
      else {
        void begin("countdown");
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [seconds, waiting, revision]);
  return (
    <div className="scope-countdown">
      <p>{waiting ? "已暂停自动开始" : `${seconds} 秒后自动开始`}</p>
      <button
        type="button"
        className="promax-button promax-button--primary"
        disabled={started.current}
        onClick={() => {
          void begin("click");
        }}
      >
        开始做
      </button>
      <button
        type="button"
        className="toolbar-button"
        onClick={() => {
          paused.current = true;
          setWaiting(true);
          onWait();
        }}
      >
        先等等
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
const QUOTE_KEY = "composer:quote";
/** "已上报" is shown only after the backend confirmed the defect record. */
const FAULT_REPORT_LABEL: Readonly<Record<string, string>> = {
  none: "尚未上报",
  local: "仅本机记录（未登录或无上传权限）",
  pending: "待上传，服务端确认后才算已上报",
  confirmed: "已上报（服务端已确认）",
  failed: "上报失败，记录保留在本机",
};
const faultStepLabel = (step: string) =>
  step === "check" ? "独立检查" : step === "coordinator" ? "理解输入" : step === "commit" ? "保存成果版本" : step.startsWith("file:") ? step.slice(5) : step;
export function WorkApp(props: WorkAppProps) {
  useEffect(() => installPromaxConsoleStyles(), []);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const workspaces = useSyncExternalStore(
    props.workspaceStore.subscribe,
    props.workspaceStore.getSnapshot,
  );
  const sessions = useSyncExternalStore(
    props.sessionStore.subscribe,
    props.sessionStore.getSnapshot,
  );
  const teams = useTeamState(),
    team = teams.teams[0]!;
  const company = useCompanyConnection();
  const projects = workspacesForTeam(team, workspaces.items);
  const [projectId, setProjectId] = useState(""),
    [page, setPage] = useState<"work" | "list" | "materials">("work");
  const project =
    projects.find((p) => p.workspaceId === projectId) ?? projects[0];
  const scope: ProjectScope = {
    workspaceId: project?.workspaceId ?? "",
    projectPath: project?.path ?? "",
  };
  // Views are tagged with the project they were read for: a late or in-between render of project A
  // can never appear under project B's title.
  const [workState, setWorkState] = useState<{ workspaceId: string; view: WorkView }>({ workspaceId: "", view: EMPTY_WORK }),
    [worksState, setWorksState] = useState<{ workspaceId: string; items: WorkCard[] }>({ workspaceId: "", items: NO_WORKS });
  const work = workState.workspaceId === scope.workspaceId ? workState.view : EMPTY_WORK;
  const works = worksState.workspaceId === scope.workspaceId ? worksState.items : NO_WORKS;
  const setWork = (view: WorkView) => setWorkState({ workspaceId: scope.workspaceId, view });
  const setWorks = (items: WorkCard[]) => setWorksState({ workspaceId: scope.workspaceId, items });
  const [newDrafts, setNewDrafts] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [materials, setMaterials] = useState<Record<string, File[]>>({}),
    [attachmentNotice, setAttachmentNotice] = useState<{ key: string; message: string } | null>(null),
    [stopStatus, setStopStatus] = useState<{ key: string; state: "stopping" | "stopped" | "failed"; message?: string } | null>(null),
    [retried, setRetried] = useState<Record<string, true>>({}),
    [settings, setSettings] = useState({ open: false, mounted: false }),
    [notice, setNotice] = useState(""),
    [newProject, setNewProject] = useState<string | null>(null),
    [pausedRevision, setPausedRevision] = useState("");
  useEffect(() => {
    if (page !== "work" && work.round) setPausedRevision(work.round.revision);
  }, [page]);
  const conversation = useConversation(props, work.card?.session_id);
  const sessionId = work.card?.session_id;
  const newDraft = newDrafts[scope.workspaceId] ?? "";
  const setNewDraft = (value: string, workspaceId = scope.workspaceId) =>
    setNewDrafts((current) => ({ ...current, [workspaceId]: value }));
  /** Pending files belong to one project and one work (or that project's new work), never to the app. */
  const contextKey = `${scope.workspaceId}::${work.card?.work_key ?? "new"}`;
  const files = materials[contextKey] ?? NO_FILES;
  const setFiles = (key: string, next: File[]) => setMaterials((current) => ({ ...current, [key]: next }));
  /** What each project had open, so switching back restores the work and reading position. */
  const projectMemory = useRef(new Map<string, { workKey?: string; doc?: Parameters<PointerOpen>[0] }>());
  const docRestore = useRef<{ workKey: string; doc: Parameters<PointerOpen>[0] } | null>(null);
  /** A new work created by a send that failed later is reused by the retry instead of creating another. */
  const createdCards = useRef(new Map<string, WorkCard>());
  /** Steps already done for an unchanged message, so a retry does not upload or record it twice. */
  const sendProgress = useRef(new Map<string, { signature: string; paths?: string[]; recorded?: boolean; eventId?: string; duplicate?: boolean }>());
  const openSettings = () => setSettings({ open: true, mounted: true });
  const closeSettings = () => setSettings((current) => ({ ...current, open: false }));
  const interaction = useWorkInteraction(scope, work.card, setError);
  const viewCard = work.card
    ? {
        ...work.card,
        ...(interaction.navigation
          ? { navigation: interaction.navigation }
          : {}),
        drafts: interaction.drafts,
      }
    : null;
  // Preserve the legacy focused draft, but reading documents no longer changes the composer identity.
  const composerKey = `composer:${interaction.navigation?.mode === "question" ? `question:${interaction.navigation.question_id}` : interaction.navigation?.mode === "overview" ? "main" : (interaction.navigation?.node_id ?? "main")}`;
  const draft = work.card ? (interaction.drafts[composerKey] ?? "") : newDraft;
  const setDraft = (value: string) =>
    work.card ? interaction.setDraft(composerKey, value) : setNewDraft(value);
  const [activeDoc, setActiveDoc] = useState<Parameters<PointerOpen>[0] | null>(null);
  const [answerBusy, setAnswerBusy] = useState(false);
  const answerInFlight = useRef(false);
  const [memberDetail, setMemberDetail] = useState<{ key: string; value: MemberExecution } | null>(null);
  const [readonlyFile, setReadonlyFile] = useState<{ key: string; filename: string; content: string; sha256: string } | null>(null);
  const fileRequest = useRef(0);
  const inspectFile = async (input: Record<string, string>) => {
    const ticket = ++fileRequest.current;
    try {
      const file = await workRequest<{ filename: string; content: string; sha256: string }>(scope, "work/inspect", { work_key: work.card?.work_key, ...input });
      if (ticket === fileRequest.current) { setMemberDetail(null); setReadonlyFile({ key: contextKey, ...file }); }
    } catch (e) { setError(errorText(e)); }
  };
  const memberRequest = useRef(0);
  const openMember = async (id: string, task: string) => {
    const ticket = ++memberRequest.current;
    try {
      const result = await workRequest<{ execution: MemberExecution }>(scope, "work/member", { work_key: work.card?.work_key, child_id: id, task_key: task });
      if (ticket === memberRequest.current) { setReadonlyFile(null); setMemberDetail({ key: contextKey, value: result.execution }); }
    } catch (e) { setError(errorText(e)); }
  };
  const [replyTo, setReplyTo] = useState<PendingItem | null>(null);
  const [replyBase, setReplyBase] = useState<string>();
  const [suggestionReply, setSuggestionReply] = useState<string | null>(null);
  /** The right workspace shows one thing at a time: the question list or one document. */
  const [panelView, setPanelView] = useState<"questions" | "doc">("questions");
  const [boardExpanded, setBoardExpanded] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<{ id: string; message: string } | null>(null);
  /** One stable event id per answer attempt, so a retry never records or sends the same input twice. */
  const answerEvents = useRef(new Map<string, string>());
  const dispatchedAnswers = useRef(new Set<string>());
  useEffect(() => {
    const restored = docRestore.current && docRestore.current.workKey === work.card?.work_key ? docRestore.current.doc : null;
    docRestore.current = null;
    setActiveDoc(restored); setReplyTo(null); setSuggestionReply(null); setNotice("");
    setPanelView(restored ? "doc" : "questions");
    setBoardExpanded(null); setAnswerError(null);
    answerEvents.current.clear(); dispatchedAnswers.current.clear();
  }, [scope.workspaceId, work.card?.work_key]);
  // Reading is local view state only: no navigation write, model call or execution action.
  const openDoc: PointerOpen = (target) => { setReadonlyFile(null); setMemberDetail(null); setActiveDoc(target); setPanelView("doc"); setNotice(""); };
  const closeDoc = () => {
    setActiveDoc(null);
    setPanelView("questions");
    setNotice("文档视图已关闭；文件与未保存修改保留。");
  };
  const discuss = (item: PendingItem) => {
    setReplyTo(item); setSuggestionReply(null);
    const filename = item.artifact ?? (work.card?.deliverables.length === 1 ? work.card.deliverables[0]?.filename : undefined);
    setReplyBase(work.card?.deliverables.find((d) => d.filename === filename)?.current_sha256 ?? undefined);
    composerRef.current?.focus();
  };
  const navigation = useRef(0);
  const [navigationEpoch, setNavigationEpoch] = useState(0);
  const navigate = () => {
    navigation.current++;
    setNavigationEpoch(navigation.current);
    return navigation.current;
  };
  const acting = useRef(false);
  const starts = useRef(new Set<string>());
  const refresh = async () => {
    if (!project) return;
    const generation = navigation.current;
    const list = await workRequest<{ items: WorkCard[] }>(scope, "work/list");
    const view = work.card
      ? await workRequest<WorkView>(scope, "work/read", {
          work_key: work.card.work_key,
        })
      : null;
    if (generation !== navigation.current) return;
    setWorks(list.items);
    if (view) setWork(view);
  };
  useEffect(() => {
    const generation = navigate();
    setWork(EMPTY_WORK);
    setPausedRevision("");
    setWorks([]);
    setError("");
    const remembered = project ? projectMemory.current.get(project.workspaceId) : undefined;
    if (!project || !remembered?.workKey) return;
    const target: ProjectScope = { workspaceId: project.workspaceId, projectPath: project.path };
    void workRequest<WorkView>(target, "work/read", { work_key: remembered.workKey })
      .then((view) => {
        if (generation !== navigation.current || !view.card) return;
        if (remembered.doc) docRestore.current = { workKey: view.card.work_key, doc: remembered.doc };
        props.openSession(view.card.session_id);
        setWorkState({ workspaceId: target.workspaceId, view });
      })
      .catch((e) => {
        if (generation === navigation.current)
          setError(`未能恢复「${project.title}」上次打开的工作：${errorText(e)}。当前停在该项目的新工作，其他项目内容未带入。`);
      });
  }, [project?.workspaceId]);
  /** Switching only changes what is shown: running work keeps its own project, session and outputs. */
  const switchProject = (workspaceId: string) => {
    if (!project || workspaceId === project.workspaceId) return;
    void interaction.flush().catch((e) => setError(String(e)));
    projectMemory.current.set(project.workspaceId, {
      ...(work.card ? { workKey: work.card.work_key } : {}),
      ...(activeDoc && work.card ? { doc: activeDoc } : {}),
    });
    navigate();
    setProjectId(workspaceId);
    props.clearSession();
  };
  useEffect(() => {
    if (!project) return;
    let active = true,
      loading = false;
    const generation = navigation.current;
    const update = async () => {
      if (loading) return;
      loading = true;
      try {
        const list = await workRequest<{ items: WorkCard[] }>(
          scope,
          "work/list",
        );
        const view = sessionId
          ? await workRequest<WorkView>(scope, "work/read", { sessionId })
          : null;
        if (active && generation === navigation.current) {
          setWorks(list.items);
          if (view) setWork(view);
        }
      } catch (e) {
        if (active && generation === navigation.current) setError(String(e));
      } finally {
        loading = false;
      }
    };
    void update();
    const timer = window.setInterval(() => void update(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [project?.workspaceId, sessionId, navigationEpoch]);
  const act = async (action: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  const quote = (() => {
    try {
      return work.card && interaction.drafts[QUOTE_KEY]
        ? (JSON.parse(interaction.drafts[QUOTE_KEY]) as DocQuote)
        : undefined;
    } catch {
      return undefined;
    }
  })();
  const setQuote = (value?: DocQuote) =>
    interaction.setDraft(QUOTE_KEY, value ? JSON.stringify(value) : "");
  const send = async () =>
    act(async () => {
      if (!project || (!draft.trim() && !files.length && !quote))
        return;
      if (work.round) setPausedRevision(work.round.revision);
      if (replyTo && work.card && !conversation.running && !inProgress() && !files.length && !quote) {
        await answerRaw(replyTo, draft, undefined, replyBase);
        setDraft(""); setReplyTo(null); await interaction.flush();
        return;
      }
      const key = contextKey,
        workspaceId = scope.workspaceId;
      let card = work.card ?? createdCards.current.get(workspaceId) ?? null;
      if (!card) {
        const id = await props.startSession(
          project.workspaceId,
          PRODUCT_PRESET_ID,
        );
        props.openSession(id);
        card = (
          await workRequest<{ card: WorkCard }>(scope, "work/card/update", {
            action: "create",
            sessionId: id,
            title:
              (draft.trim().split("\n")[0] ?? "").slice(0, 28) ||
              files[0]?.name ||
              "材料分析",
          })
        ).card;
        createdCards.current.set(workspaceId, card);
      }
      const quoted = quote
        ? `引用「${deliverableLabel(quote.filename)}${quote.location ? ` · ${quote.location}` : ""}」：\n> ${quote.text.replace(/\n/gu, "\n> ")}\n\n`
        : "";
      const text = `${quoted}${draft}`;
      const signature = JSON.stringify([card.work_key, text, files.map((f) => [f.name, f.size, f.lastModified]), suggestionReply, replyTo?.id ?? null]);
      const prior = sendProgress.current.get(key);
      const progress = prior?.signature === signature ? prior : { signature };
      sendProgress.current.set(key, progress);
      if (!progress.paths) {
        let paths: string[] = [];
        if (files.length) {
          try {
            const uploads = await Promise.all(
              files.map(async (f) => ({
                name: f.name,
                mediaType: f.type,
                contentBase64: await new Promise<string>((resolve, reject) => {
                  const r = new FileReader();
                  r.onerror = reject;
                  r.onload = () => resolve(String(r.result).split(",")[1]!);
                  r.readAsDataURL(f);
                }),
              })),
            );
            paths = (
              await workRequest<{ paths: string[] }>(scope, "attachments", {
                sessionId: card.session_id,
                files: uploads,
              })
            ).paths;
          } catch (e) {
            throw new Error(`材料未上传，消息未发送：${errorText(e)}。输入和附件已保留，可直接重试。`);
          }
        }
        progress.paths = paths;
      }
      if (work.card) await interaction.flush();
      if (!progress.eventId) progress.eventId = crypto.randomUUID();
      if (!progress.recorded) {
        const record = await workRequest<{ duplicate?: boolean; material_errors?: string[] }>(scope, "work/card/update", {
          work_key: card.work_key,
          action: "message",
          text,
          paths: progress.paths,
          event_id: progress.eventId,
          ...(replyTo ? { question_id: replyTo.id } : {}),
          ...(suggestionReply ? { suggestion_target: suggestionReply } : {}),
        });
        if (record.material_errors?.length) throw new Error(`文字与成功材料已保存，解析失败项可重试（不会重复上传）：${record.material_errors.join("；")}`);
        // A retried send of the same input is acknowledged without a second record or chat turn.
        progress.duplicate = record.duplicate === true && dispatchedAnswers.current.has(progress.eventId);
        progress.recorded = true;
      }
      const context = suggestionReply ? `回应建议「${suggestionReply}」：` : replyTo ? `回应问题「${replyTo.question}」：` : "";
      const message = context + (text.trim() || "请帮我看这份材料。");
      if (!progress.duplicate && !dispatchedAnswers.current.has(progress.eventId)) {
        // Supplements to running work are steered into it; they never start the whole task again.
        if (conversation.running || inProgress()) await props.sendSessionMessage(card.session_id, message, "steer");
        else await props.sendSessionMessage(card.session_id, message);
        // Marked only after the turn was accepted; a failed send stays retryable under the same input id.
        dispatchedAnswers.current.add(progress.eventId);
      }
      sendProgress.current.delete(key);
      createdCards.current.delete(workspaceId);
      setMaterials((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setAttachmentNotice(null);
      setStopStatus(null);
      if (work.card) {
        setDraft("");
        if (quote) setQuote();
        await interaction.flush();
      } else {
        setNewDraft("", workspaceId);
        setWork({ card, round: null });
      }
      setSuggestionReply(null); setReplyTo(null);
    });
  const addFiles = (selected: File[]) => {
    if (!selected.length) return;
    const merged = [...files];
    for (const file of selected)
      if (!merged.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) merged.push(file);
    const message = taskAttachmentSelectionError(merged);
    if (message) {
      setAttachmentNotice({ key: contextKey, message: `未添加：${message}` });
      return;
    }
    setAttachmentNotice(null);
    setFiles(contextKey, merged);
  };
  const resume = async (card: WorkCard) =>
    act(async () => {
      await interaction.flush();
      const generation = navigate();
      if (work.round) setPausedRevision(work.round.revision);
      setWork({ card: null, round: null });
      const view = await workRequest<WorkView>(scope, "work/read", {
        work_key: card.work_key,
      });
      if (generation !== navigation.current) return;
      props.openSession(card.session_id);
      setWork(view);
      if (view.round?.source === "proposal")
        setPausedRevision(view.round.revision);
      setPage("work");
    });
  const start = async (source: "click" | "countdown") => {
    const card = work.card,
      round = work.round;
    if (!card || !round || acting.current || round.source !== "proposal")
      return;
    const key = `${scope.workspaceId}:${card.work_key}:${round.revision}`;
    if (starts.current.has(key)) return;
    starts.current.add(key);
    acting.current = true;
    setBusy(true);
    setPausedRevision(round.revision);
    let authorized = false;
    try {
      await workRequest(scope, "work/card/update", {
        work_key: card.work_key,
        action: "start",
        revision: round.revision,
        source,
      });
      authorized = true;
      await props.sendSessionMessage(card.session_id, "开始做。");
      await refresh();
    } catch (e) {
      if (!authorized) starts.current.delete(key);
      setError(
        authorized
          ? `成果范围已授权，但启动消息发送失败：${String(e)}。请用输入框继续。`
          : String(e),
      );
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  /** Stop asks the real run to stop; the input stays editable and the outcome is shown in place. */
  const stop = async () => {
    if (acting.current) return;
    const key = contextKey;
    acting.current = true;
    setStopStatus({ key, state: "stopping" });
    try {
      if (work.round) setPausedRevision(work.round.revision);
      if (work.round?.task_key && work.round.phase !== "ended" && work.card) {
        const input = {
          ...scope,
          sessionId: work.card.session_id,
          taskKey: work.round.task_key,
        };
        const snapshot = await props.readTaskRunFiles(input);
        await props.stopTeamTask({ ...input, runEpoch: snapshot.runEpoch });
      } else if (sessionId) {
        const result = await props.conversationFor(sessionId)?.cancel();
        if (!result?.ok) throw new Error("停止请求未被接受");
      } else throw new Error("没有找到正在执行的任务");
    } catch (e) {
      setStopStatus({ key, state: "failed", message: errorText(e) });
      acting.current = false;
      return;
    }
    // Report "stopped" only once the view has re-read the run, so a follow-up message is not steered into it.
    await refresh().catch((e) => setError(String(e)));
    setStopStatus({ key, state: "stopped" });
    acting.current = false;
  };
  const newWork = () => {
    void interaction.flush().catch((e) => setError(String(e)));
    navigate();
    props.clearSession();
    setWork(EMPTY_WORK);
    if (work.round) setPausedRevision(work.round.revision);
    setPage("work");
  };
  const updateCard = (patch: Record<string, unknown>) =>
    act(async () => {
      await interaction.flush();
      const current = (
        await workRequest<WorkView>(scope, "work/read", {
          work_key: work.card!.work_key,
        })
      ).card!;
      await workRequest(scope, "work/card/update", {
        work_key: current.work_key,
        base_updated_at: current.updated_at,
        ...patch,
      });
      if (patch.scope_decision) {
        const text = patch.scope_decision === "accept" ? "我已同意刚才这一份范围调整。按已记录的新范围继续，其他明确要求保留。" : "不采纳刚才这一份范围调整，保留原范围，已明确且具备输入的工作继续。";
        await workRequest(scope, "work/card/update", { work_key: current.work_key, action: "message", text, paths: [] });
        await props.sendSessionMessage(current.session_id, text);
      }
      await refresh();
    });
  const tellDecision = async (
    card: WorkCard,
    question: string,
    text: string,
  ) => {
    const message = `我的决定：${question} → ${text}${card.deliverables.some((d) => d.current_sha256) ? "。请据此修改受影响的成果位置，其他已明确的内容保持不变。" : ""}`;
    await workRequest(scope, "work/card/update", {
      work_key: card.work_key,
      action: "message",
      text: message,
      paths: [],
    });
    await props.sendSessionMessage(card.session_id, message);
  };
  /**
   * One entry for answers in place. A button choice is recorded by code; free text is kept as a received
   * input for the coordinator. The same event id makes a retried answer idempotent: nothing is recorded or
   * sent a second time, and the employee's typed text is never cleared on failure.
   */
  const answerRaw = async (
    item: PendingItem,
    text: string,
    location?: string,
    base?: string,
    choice?: string,
  ) => {
    await interaction.flush();
    const card = (
      await workRequest<WorkView>(scope, "work/read", {
        work_key: work.card!.work_key,
      })
    ).card!;
    const currentItem = card.pending.find((p) => p.id === item.id);
    if (!currentItem || !sameDecision(currentItem, item)) throw new Error("这个问题已有变化，请查看最新问题后重新回应；输入已保留。");
    const attempt = `${item.id}:${choice ?? text}`;
    let eventId = answerEvents.current.get(attempt);
    if (!eventId) {
      eventId = crypto.randomUUID();
      answerEvents.current.set(attempt, eventId);
    }
    const result = await workRequest<{
      card: WorkCard;
      duplicate?: boolean;
      needs_context?: boolean;
      follow_up?: boolean;
      guard?: "question" | "ambiguous" | "ok";
    }>(scope, "work/card/update", {
      work_key: card.work_key,
      base_updated_at: card.updated_at,
      action: "decide",
      id: item.id,
      event_id: eventId,
      ...(choice ? { choice } : { text }),
      ...(location ? { location } : {}),
      ...(base ? { base_sha256: base } : {}),
    });
    if (result.follow_up) setNotice("补答已保存为原工作的后续输入，待后续处理；未重跑或改写原完成状态。");
    if (!choice && !result.follow_up) {
      // The chat record keeps the employee's own words on the same input identity.
      await workRequest(scope, "work/card/update", {
        work_key: card.work_key,
        action: "message",
        text,
        paths: [],
        event_id: eventId,
        question_id: item.id,
      }).catch(() => undefined);
    }
    // A choice the program could handle itself never calls the model; only an input the coordinator must
    // understand (free text, unknown impact, missing location) is passed on, once.
    if (result.needs_context && !result.duplicate && !dispatchedAnswers.current.has(eventId) && work.round?.phase !== "ended") {
      const answerText = choice
        ? `我的决定：${item.question} → ${choice}${card.deliverables.some((d) => d.current_sha256) ? "。请据此修改受影响的成果位置，其他已明确的内容保持不变。" : ""}`
        : `回应问题「${item.question}」：${text}`;
      // The record already exists under this event id; only the chat turn is dispatched here.
      // During a run it is steered into the running task instead of starting anything new.
      if (conversation.running || inProgress())
        await props.sendSessionMessage(card.session_id, answerText, "steer");
      else await props.sendSessionMessage(card.session_id, answerText);
      dispatchedAnswers.current.add(eventId);
    }
    for (const key of Object.keys(interaction.drafts))
      if (key === `answer:${item.id}` || key.startsWith(`panel:${item.id}:`)) interaction.setDraft(key, "");
    answerEvents.current.delete(attempt);
    await refresh();
  };
  /** Answer in place: the panel shows the failure next to its own input, without stealing the composer. */
  const answerView = async (view: QuestionView, text: string, choice?: string) => {
    if (answerInFlight.current) return;
    answerInFlight.current = true; setAnswerBusy(true); setAnswerError(null);
    try { await answerRaw(view.item as PendingItem, text, undefined, undefined, choice); }
    catch (e) { setAnswerError({ id: view.id, message: errorText(e) }); }
    finally { answerInFlight.current = false; setAnswerBusy(false); }
  };
  const resendDecisionRaw = async (record: DecisionRecord) => {
    await interaction.flush();
    const card = (
      await workRequest<WorkView>(scope, "work/read", {
        work_key: work.card!.work_key,
      })
    ).card!;
    await workRequest(scope, "work/card/update", {
      work_key: card.work_key,
      base_updated_at: card.updated_at,
      resend_decision: record.id,
    });
    await tellDecision(card, record.question, record.answer);
    await refresh();
  };
  const withdrawDecisionRaw = async (record: DecisionRecord) => {
    await interaction.flush();
    const current = (
      await workRequest<WorkView>(scope, "work/read", {
        work_key: work.card!.work_key,
      })
    ).card!;
    await workRequest(scope, "work/card/update", {
      work_key: current.work_key,
      base_updated_at: current.updated_at,
      withdraw_decision: record.id,
    });
    await refresh();
  };
  /** Retries one failed item once, in its own session; repeated clicks do not dispatch it again. */
  const retryKey = (itemKey: string) => `${contextKey}:${itemKey}`;
  const retry = (itemKey: string, text: string) =>
    act(async () => {
      const id = retryKey(itemKey);
      if (retried[id] || !work.card) return;
      await props.sendSessionMessage(work.card.session_id, text);
      setRetried((current) => ({ ...current, [id]: true }));
      await refresh();
    });
  const renderMarkdown = (text: string) =>
    // micromark escapes raw HTML and rejects dangerous URL protocols at the rendering boundary.
    micromark(text, {
      allowDangerousHtml: false,
      allowDangerousProtocol: false,
      extensions: [gfm()],
      htmlExtensions: [gfmHtml()],
    });
  const pageTitle =
    page === "materials"
      ? "项目资料"
      : page === "list"
        ? "工作列表"
        : (work.card?.title ?? "新工作");
  const topbar = (actions?: ReactNode) => (
    <header className="topbar work-topbar">
      <div className="topbar-title-wrap">
        <span className="topbar-project">{project?.title ?? "选择项目"}</span>
        <span className="topbar-divider">/</span>
        <span className="topbar-title" title={pageTitle}>
          {pageTitle}
        </span>
      </div>
      <div className="topbar-actions">
        {actions}
        <CompanyLoginEntry />
      </div>
    </header>
  );
  const running = !!sessions.byId[sessionId ?? ""]?.running;
  function inProgress() {
    return (
      !!work.round?.task_key &&
      work.round.source !== "proposal" &&
      work.round.phase !== "ended"
    );
  }
  const interrupted =
    inProgress() &&
    !conversation.running &&
    !running &&
    !work.live &&
    !!work.card &&
    Date.now() - Date.parse(work.card.updated_at) > 15_000;
  const phaseLabel = work.round?.task_key
    ? work.round.phase === "checking"
      ? `检查中（第 ${work.round.judge_round ?? 1} 轮）· 草稿可查看`
      : work.round.phase === "repairing"
        ? `返修中（${work.round.repair_round ?? 1}/2）`
        : work.round.phase === "ended"
          ? (work.card?.last_progress ?? "已结束")
          : "生成中"
    : "";
  const resumeRun = () =>
    act(async () => {
      await props.sendSessionMessage(
        work.card!.session_id,
        "继续完成本次已开始的工作，已落盘的成果保留。",
      );
      await refresh();
    });
  const timeline: TimelineItem[] = mergeTimeline(
    workTimeline(
      [
        ...(conversation.nodes ?? []),
        ...(conversation.partial
          ? [
              {
                kind: "assistant",
                blocks: conversation.partial.blocks,
                partial: true,
                time: Date.now(),
              },
            ]
          : []),
      ],
      {
        ...(work.round?.children ? { children: work.round.children } : {}),
        ...(conversation.runningCalls
          ? { runningCalls: conversation.runningCalls }
          : {}),
        ...(conversation.promptError
          ? { promptError: conversation.promptError }
          : {}),
      },
    ),
    // Result entries sit with the message that produced them instead of after the whole conversation.
    [
      ...deliveryTimeline(viewCard?.delivery_receipts),
      ...outcomeTimeline(
        (work.outcomes ?? []).filter((o) => viewCard?.deliverables.some((d) => d.filename === o.filename && !d.draft)),
        (filename) => viewCard?.deliverables.find((d) => d.filename === filename)?.member_id,
      ),
      ...(viewCard?.deliverables ?? []).flatMap((d) => d.draft ? [{ kind: "outcome" as const, key: `draft:${d.filename}:${d.draft.task_key}`, filename: d.filename, member: d.member_id, time: Date.parse(d.draft.first_readable_at) }] : []),
    ],
  );
  const eventStates = messageEventStates(timeline, work.card?.events ?? []);
  const issueVerified = (i: import("../review-protocol.ts").ReviewLedgerItem) => i.state === "verified" && i.input_version === viewCard?.requirement_version && Object.entries(i.latest_hashes).every(([file, hash]) => viewCard?.deliverables.some((d) => d.filename === file && d.current_sha256 === hash));
  /** The right panel: paged questions with one open item, or one document in the same place. */
  const views = viewCard ? orderQuestions(questionViews(viewCard)) : [];
  /** Only these need the employee; a decision already being applied is listed but never counted. */
  const awaitingViews = views.filter((view) => view.needsUser);
  const pendingCount = viewCard ? pendingResponseCount(viewCard) : 0;
  const urgentCount = awaitingViews.filter((view) => view.urgent).length;
  const deliverableIndex = (filename: string) =>
    (viewCard?.deliverables ?? []).findIndex((d) => d.filename === filename);
  /**
   * The reminder locates the first item that still needs an answer. It only moves the panel:
   * the count never resets, the composer text and the open document stay where they are.
   */
  const locateQuestion = () => {
    const first = awaitingViews[0];
    if (!first) return;
    setBoardExpanded(first.id);
    setPanelView("questions");
  };
  const discussView = (view: QuestionView) => {
    discuss(view.item as PendingItem);
  };

  /** A member card may say "处理中" only while this work is actually executing. */
  const executing = conversation.running || running || !!work.live || (inProgress() && !interrupted);
  const stopping = stopStatus?.key === contextKey && stopStatus.state === "stopping";
  const anyRunning = conversation.running || running || inProgress() || sessions.ids.some((id) => sessions.byId[id]?.running);
  const modelLock = anyRunning ? { lockedReason: "有任务正在执行：完成或停止后再切换模型，避免改变其后续请求" } : {};
  const hasContent = !!(draft.trim() || files.length || quote);
  const chips: ComposerChip[] = [
    ...(quote ? [{ key: "quote", label: `引用：${deliverableLabel(quote.filename)}${quote.location ? ` · ${shortText(quote.location, 14)}` : ""} · ${shortText(quote.text, 30)}`, title: quote.text, onRemove: () => setQuote(), removeLabel: "移除引用" }] : []),
    ...(replyTo || suggestionReply ? [{ key: "reply", label: `回应：${replyTo ? questionLabel(replyTo) : suggestionReply}`, onRemove: () => { setReplyTo(null); setSuggestionReply(null); }, removeLabel: "取消回应" }] : []),
    ...files.map((f, index): ComposerChip => ({
      key: `file:${index}:${f.name}`,
      icon: "paperclip",
      label: f.name,
      title: `${f.name} · ${Math.max(1, Math.round(f.size / 1024))} KB · 随本条消息上传`,
      onRemove: () => { setFiles(contextKey, files.filter((_, i) => i !== index)); setAttachmentNotice(null); },
      removeLabel: `移除附件 ${f.name}`,
    })),
    ...(attachmentNotice?.key === contextKey ? [{ key: "attachment-error", tone: "error" as const, label: attachmentNotice.message, onRemove: () => setAttachmentNotice(null), removeLabel: "关闭附件提示" }] : []),
    ...(stopStatus?.key === contextKey
      ? [{
          key: "stop",
          tone: stopStatus.state === "failed" ? ("error" as const) : ("status" as const),
          label: stopStatus.state === "stopping" ? "正在停止…"
            : stopStatus.state === "failed" ? `停止失败：${stopStatus.message ?? ""}（点此重试停止）`
              : conversation.running ? "已请求停止，等待当前步骤结束…" : "已停止 · 已有成果保留",
          // A failed stop stays retryable here even when typed text turns the slot back into 发送.
          ...(stopStatus.state === "failed" ? { onOpen: () => void stop() } : {}),
          ...(stopStatus.state === "stopping" ? {} : { onRemove: () => setStopStatus(null), removeLabel: "关闭停止提示" }),
        }]
      : []),
  ];
  /** Document pointers sit on a member's latest line only; older lines of the same task stay short. */
  const latestMember = new Map(
    timeline.flatMap((m) => (m.kind === "member" ? [[m.member, m.key] as const] : [])),
  );
  const reviewedCurrent = (filename: string) => {
    const file = work.card?.deliverables.find((d) => d.filename === filename);
    return !!work.card?.acceptances?.some(
      (a) =>
        a.filename === filename &&
        a.sha256 === file?.current_sha256 &&
        a.digest === requirementsDigest(work.card!),
    );
  };
  return (
    <div
      className={`work-app ${page === "work" ? "work-page" : ""}`}
    >
      <style>{WORK_APP_CSS}</style>
      <nav className="left-sidebar work-nav" aria-label="Promax 导航">
        <div className="brand-row">
          <img
            className="brand-mark"
            src={logo}
            alt=""
            aria-hidden="true"
            width="29"
            height="29"
          />
          <div>
            <div className="brand-name">Promax</div>
            <div className="brand-label">AGENT WORKSPACE</div>
          </div>
        </div>
        <div className="left-scroll work-nav-scroll">
          <ProjectPicker
            projects={projects}
            value={project?.workspaceId ?? ""}
            disabled={busy}
            onChange={switchProject}
          />
          <button
            type="button"
            className="promax-new-session work-new"
            disabled={busy}
            onClick={newWork}
          >
            <Icon name="plus" size={15} />
            新工作
          </button>
          <button
            type="button"
            className={`work-nav-item ${page === "list" || page === "materials" ? "is-active" : ""}`}
            onClick={() => {
              setPage("list");
            }}
          >
            <Icon name="grid" size={16} />
            工作列表
          </button>
          <section className="work-nav-section" aria-label="最近工作">
            <h2 className="sidebar-section-title">最近工作</h2>
            {works.length ? (
              works.slice(0, 8).map((w) => (
                <button
                  type="button"
                  key={w.work_key}
                  className={`work-nav-row ${page === "work" && w.work_key === work.card?.work_key ? "is-active" : ""}`}
                  disabled={busy}
                  onClick={() => void resume(w)}
                >
                  <span className="work-nav-row-title">{w.title}</span>
                  <small>{w.last_progress}</small>
                </button>
              ))
            ) : (
              <p className="work-nav-empty">还没有工作</p>
            )}
          </section>
          <CompanyProjects
            openProject={(id) =>
              act(async () => {
                await props.openCompanyProject?.(id);
                setProjectId("");
              })
            }
          />
        </div>
        <div className="work-nav-footer">
          <button
            type="button"
            className={`work-nav-item ${settings.open ? "is-active" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={settings.open}
            onClick={() => openSettings()}
          >
            <Icon name="settings" size={16} />
            设置
          </button>
          <ConsoleLauncher {...(props.apiBaseUrl ? { apiBaseUrl: props.apiBaseUrl } : {})} />
          <div
            className="work-identity"
            title={
              company.loggedIn
                ? "项目权限按当前登录身份校验；开发环境身份不等于公司正式身份"
                : "未登录时成果只保存在本机，不上传后端；请只使用脱敏或虚构材料"
            }
          >
            <Icon name="shield" size={15} />
            {company.loggedIn
              ? `已登录 ${company.employeeId ?? ""}（开发环境）`
              : "未登录 · 本机体验（脱敏材料）"}
          </div>
        </div>
      </nav>
      {page === "materials" ? (
        <main className="work-main">
          {topbar(
            <button
              type="button"
              className="toolbar-button"
              onClick={() => setPage("list")}
            >
              <Icon name="chevronLeft" size={15} />
              返回工作列表
            </button>,
          )}
          <div className="main-scroll work-scroll">
            <div className="work-page-body">
              {project && (
                <ProjectFiles
                  workspaceId={project.workspaceId}
                  title={project.title}
                  targetPath=""
                  {...props}
                />
              )}
            </div>
          </div>
        </main>
      ) : page === "list" ? (
        <main className="work-main">
          {topbar(
            <>
              <button
                type="button"
                className="toolbar-button"
                onClick={() => setPage("materials")}
              >
                <Icon name="folder" size={15} />
                项目资料
              </button>
              <button
                type="button"
                className="toolbar-button"
                aria-expanded={newProject !== null}
                onClick={() => setNewProject(newProject === null ? "" : null)}
              >
                <Icon name="plus" size={15} />
                新建项目
              </button>
            </>,
          )}
          <div className="main-scroll work-scroll">
            <div className="work-page-body">
              <div className="work-section-head">
                <span className="promax-eyebrow">PROMAX</span>
                <h1>{project?.title ?? "选择项目"} · 工作列表</h1>
                <p>项目里的每一件工作，都可以接着上次的进展继续。</p>
              </div>
              {newProject !== null && (
                <form
                  className="deliverable-card work-new-project"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const title = newProject.trim();
                    if (title)
                      void act(async () => {
                        const p = await props.createProject(title);
                        switchProject(p.workspaceId);
                        setNewProject(null);
                      });
                  }}
                >
                  <label>
                    新项目名称
                    <input
                      value={newProject}
                      placeholder="例如：协作工具项目"
                      onChange={(e) => setNewProject(e.target.value)}
                    />
                  </label>
                  <p className="draft-hint">
                    新项目有独立的工作、材料和成果；已有工作不会移动。
                  </p>
                  <div className="draft-actions">
                    <button
                      type="submit"
                      className="promax-button promax-button--primary"
                      disabled={busy || !newProject.trim()}
                    >
                      创建项目
                    </button>
                    <button
                      type="button"
                      className="toolbar-button"
                      onClick={() => setNewProject(null)}
                    >
                      取消
                    </button>
                  </div>
                </form>
              )}
              <div className="work-grid">
                {works.map((card) => (
                  <article className="work-card" key={card.work_key}>
                    <header>
                      <span className="work-card-icon">
                        <Icon name="artifact" size={18} />
                      </span>
                      <h2>{card.title}</h2>
                    </header>
                    <dl className="work-kv">
                      <div>
                        <dt>上次</dt>
                        <dd>{card.last_progress}</dd>
                      </div>
                      <div>
                        <dt>决定</dt>
                        <dd>
                          已确认 {card.confirmed.length} · 待决定{" "}
                          {card.pending.length}
                        </dd>
                      </div>
                      <div>
                        <dt>成果</dt>
                        <dd>
                          {card.deliverables
                            .map((d) => `${d.filename}（${d.status}）`)
                            .join(" · ") || "尚无成果"}
                        </dd>
                      </div>
                    </dl>
                    <footer>
                      <button
                        type="button"
                        className="promax-button promax-button--primary"
                        disabled={busy}
                        onClick={() => void resume(card)}
                      >
                        继续
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
              {!works.length && (
                <p className="team-note">
                  这个项目还没有工作。点击左侧「新工作」开始。
                </p>
              )}
            </div>
          </div>
        </main>
      ) : (
        <>
          <div className="work-workspace-header">{topbar()}</div>
          <WorkspaceSplit chat={<main className="work-main work-conversation">
            <div className="main-scroll work-scroll" ref={chatScrollRef}>
              <div className="work-messages" aria-label="对话">
                {!work.card && (
                  <section className="work-intro">
                    <span className="promax-eyebrow">PROMAX</span>
                    <h1>今天，哪件产品工作需要我帮忙？</h1>
                    <p>
                      说一句话、贴一段反馈、给一份材料，或交代一件明确的工作。
                    </p>
                  </section>
                )}
                {!!work.request_health?.length && <section aria-label="请求状态" className="work-message message-system">
                  {work.request_health.map((h) => <p key={h.id} role="status">{TEAM_ROLES[h.member ?? ""] ?? (h.member === "coordinator" ? "主 Agent" : "成员未知")} · {requestProgressText(h, Date.now())}</p>)}
                </section>}
                {work.context_budget?.status === "capacity_unverified" && <p role="note">上下文已计量；端点窗口/输出预留尚未核实，新硬阈值未启用。</p>}
                {work.health_blocked && work.card && <p role="status">请求或工具受阻，已有草稿保留。<button disabled={busy || conversation.running} onClick={() => void act(async () => {
                  await workRequest(scope, "work/card/update", { work_key: work.card!.work_key, action: "health-retry" });
                  await props.sendSessionMessage(work.card!.session_id, "我明确允许本次受阻请求或工具再试一次；保持现有成果、问题与权限，继续原任务。");
                  await refresh();
                })}>明确再试一次</button></p>}
                {timeline.map((m) => {
                  const eventState = eventStates.get(m.key);
                  return m.kind === "user" ? (
                    <article key={m.key} className="work-message message-user">
                      <p>{m.text}</p>
                      {eventState && (
                        <p className={`message-event is-${eventState.state}`}>
                          <span>{EVENT_STATE_LABEL[eventState.state]}</span>
                          {eventState.note && <span className="event-note">{eventState.note}</span>}
                        </p>
                      )}
                    </article>
                  ) : m.kind === "assistant" ? (
                    <article
                      key={m.key}
                      className="work-message message-assistant"
                    >
                      <header>
                        <img
                          src={logo}
                          alt=""
                          aria-hidden="true"
                          width="22"
                          height="22"
                        />
                        <strong>Pm 主理人</strong>
                      </header>
                      <div
                        className="work-markdown"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(m.text),
                        }}
                      />
                      {!!m.process?.length && <details className="execution-process"><summary>执行过程 · {m.process.some((p) => p.state === "failed") ? "有步骤失败" : m.process.some((p) => p.state === "running") ? "进行中" : `${m.process.length} 步`}</summary><ul>{m.process.map((p) => <li key={p.key}>{p.name} · {p.state === "running" ? "执行中" : p.state === "failed" ? "失败，此步骤未完成" : "已返回"}</li>)}</ul></details>}
                    </article>
                  ) : m.kind === "delivery" ? (
                    <article key={m.key} className="work-message message-outcome" aria-label={m.receipt.correction ? "交付更正" : "交付回执"}>
                      <strong>{m.receipt.correction ? "交付更正" : "交付回执"}</strong>
                      <p>{m.receipt.text}</p>
                      <span className="outcome-pointers">{m.receipt.targets.map(t => (
                        <button key={`${t.kind}:${t.filename}:${t.sha256}`} type="button" onClick={() => void inspectFile({ kind: "delivery-version", id: m.receipt.id, filename: t.filename, sha256: t.sha256 })}>
                          {t.kind === "draft" ? "保留草稿" : t.kind === "previous" ? "旧正式版" : viewCard?.deliverables.find(d => d.filename === t.filename)?.current_sha256 === t.sha256 ? "当前正式版" : "本次正式版（历史）"} · {deliverableLabel(t.filename)}
                        </button>
                      ))}</span>
                    </article>
                  ) : m.kind === "outcome" ? (
                    <article key={m.key} className="work-message message-outcome" aria-label="成果入口">
                      <p className="outcome-head">
                        <Icon name="artifact" size={14} /> {deliverableLabel(m.filename)}
                        {m.key.startsWith("draft:") ? " · 草稿可查看，正式保存状态见交付回执" : m.member ? ` · ${TEAM_ROLES[m.member] ?? m.member} 已保存新版本` : " 已保存新版本"}
                      </p>
                      {viewCard && (
                        <span className="outcome-pointers">
                          <DocPointer scope={scope} card={viewCard} filename={m.filename} {...(m.sha256 ? { sha256: m.sha256 } : {})} onOpen={openDoc} />
                        </span>
                      )}
                    </article>
                  ) : m.kind === "member" ? (() => {
                    const state = displayMemberState(m.state, executing);
                    const name = TEAM_ROLES[m.member] ?? "成员";
                    const settledFailure = m.state === "failed" || m.state === "stopped";
                    const done = !!retried[retryKey(m.key)];
                    return (
                    <article
                      key={m.key}
                      className={`work-message message-member is-${state}`}
                      aria-label={`${name}：${m.title}`}
                    >
                      <header>
                        <MemberAvatar
                          memberId={m.member}
                          displayName={name}
                          className="work-avatar"
                        />
                        <strong>{name}</strong>
                        <span className={`member-state is-${state}`}>
                          {(state === "done" || state === "reported") && latestMember.get(m.member) === m.key && viewCard?.deliverables.some((d) => d.member_id === m.member && d.current_sha256 && !reviewedCurrent(d.filename))
                            ? "待你查看"
                            : MEMBER_STATE_LABEL[state]}
                        </span>
                      </header>
                      <p className="member-title">{state !== m.state ? "这一步没有回报：执行已停止或中断" : m.title}</p>
                      {viewCard && m.state !== "running" && latestMember.get(m.member) === m.key && viewCard.deliverables
                        .filter((d) => d.member_id === m.member && (d.draft || d.current_sha256))
                        .map((d) => (
                          <span key={d.filename} className="member-pointers">
                            <DocPointer scope={scope} card={viewCard} filename={d.filename} onOpen={openDoc} />
                          </span>
                        ))}
                      {settledFailure && (
                        <>
                          <p className="member-detail">{m.detail}</p>
                          <div className="work-card-actions">
                            <button
                              type="button"
                              className="toolbar-button"
                              disabled={busy || done || conversation.running || inProgress()}
                              title={inProgress() ? "本次任务仍在进行，结束或停止后再重试这一步" : undefined}
                              onClick={() =>
                                void retry(
                                  m.key,
                                  `请让${name}重新完成刚才没完成的部分，已写出的草稿保留。`,
                                )
                              }
                            >
                              {done ? "已请求重试" : "再试一次"}
                            </button>
                          </div>
                        </>
                      )}
                      {!settledFailure && m.detail && (
                        <details className="member-report">
                          <summary>展开回报原文</summary>
                          <div
                            className="work-markdown"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdown(m.detail),
                            }}
                          />
                        </details>
                      )}
                    </article>
                    );
                  })() : (
                    <article
                      key={m.key}
                      className={`work-message message-system tone-${m.tone}`}
                      role={m.tone === "error" ? "alert" : "status"}
                    >
                      <header>
                        <span className="system-badge" aria-hidden="true">
                          !
                        </span>
                        <strong>Promax 系统</strong>
                      </header>
                      <p className="member-title">{m.title}</p>
                      <p className="member-detail">{m.detail}</p>
                      {m.retryStop ? (
                        <div className="work-card-actions">
                          <button type="button" className="toolbar-button" disabled={stopping} onClick={() => void stop()}>
                            重试停止
                          </button>
                        </div>
                      ) : m.retryText ? (
                        <div className="work-card-actions">
                          <button
                            type="button"
                            className="toolbar-button"
                            disabled={busy || conversation.running || !!retried[retryKey(m.key)]}
                            onClick={() => void retry(m.key, m.retryText!)}
                          >
                            {retried[retryKey(m.key)] ? "已重新发送" : "重试"}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {/*
                 * In-place actions of the current round. Questions, decisions and result entries live with
                 * their own message or in the right panel; only round-level actions stay here.
                 */}
                {!!viewCard?.suggestions?.filter((s) => s.state !== "superseded").length && (
                  <article className="work-message message-system tone-info" aria-label="建议跟进">
                    <header>
                      <span className="system-badge is-info" aria-hidden="true">
                        <Icon name="check" size={13} />
                      </span>
                      <strong>建议（未采纳）</strong>
                    </header>
                    {viewCard.suggestions!
                      .filter((s) => s.state !== "superseded")
                      .map((s) => (
                        <p className="member-detail" key={s.text}>
                          {s.state === "accepted" ? "已采纳，持续跟进" : s.state === "rejected" ? "未采纳" : s.state === "adjusted" ? "调整建议" : "建议（未采纳）"}：{s.text}
                          {s.history?.at(-1)?.reply ? ` · 你的反馈：${s.history.at(-1)!.reply}` : ""}
                          <button type="button" onClick={() => { setSuggestionReply(s.text); setReplyTo(null); composerRef.current?.focus(); }}>回应这条建议</button>
                        </p>
                      ))}
                  </article>
                )}
                {viewCard && viewCard.scope_proposal && (
                  <article className="work-message message-system tone-warning" aria-label="范围调整建议">
                    <header>
                      <span className="system-badge" aria-hidden="true">
                        <Icon name="activity" size={13} />
                      </span>
                      <strong>范围调整建议</strong>
                    </header>
                    <p className="member-detail">{viewCard.scope_proposal.reason}</p>
                    <div className="work-card-actions">
                      <button disabled={busy || conversation.running || inProgress()} onClick={() => void updateCard({ action: "interact", scope_decision: "accept", scope_expected: scopeSignature(viewCard), scope_moves: viewCard.scope_proposal?.moves })}>按此调整范围</button>
                      <button disabled={busy || conversation.running || inProgress()} onClick={() => void updateCard({ action: "interact", scope_decision: "reject" })}>保留原范围</button>
                    </div>
                  </article>
                )}
                {viewCard?.scope_history?.slice(-1).map((h) => (
                  <p className="message-note" key={h.id}>
                    范围变化：{h.decision === "accept" ? h.reason : "保留原范围"}
                  </p>
                ))}
                {viewCard && <FeishuConflicts workspaceId={scope.workspaceId} sessionId={viewCard.session_id} onShowProposal={(path) => {
                  const generation = navigation.current;
                  void props.readProjectFile({ workspaceId: scope.workspaceId, relativePath: path }).then((file) => { if (generation === navigation.current) setQuote({ filename: path, sha256: "", location: "", text: file.content }); }).catch((e) => setError(String(e)));
                }} />}
                {viewCard && work.round?.source === "proposal" && ["execute", "edit"].includes(work.round.turn.intent) && !conversation.running && (
                  <article className="work-message message-system tone-info" aria-label="执行授权">
                    <header>
                      <span className="system-badge is-info" aria-hidden="true">
                        <Icon name="check" size={13} />
                      </span>
                      <strong>执行授权</strong>
                    </header>
                    <p className="member-detail">将按本轮范围处理：{work.round.turn.deliverables.map(deliverableLabel).join("、")}。还没有开工，确认后才会派工。</p>
                    <div className="work-card-actions">
                      {pausedRevision === work.round.revision ? <button disabled={busy} onClick={() => void start("click")}>开始做（已暂停倒计时）</button> : !busy && <ScopeCountdown key={`${viewCard.work_key}:${work.round.revision}`} revision={work.round.revision} onStart={start} onWait={() => setPausedRevision(work.round!.revision)} />}
                    </div>
                  </article>
                )}
                {!sessionId && (
                  <div className="work-examples">
                    <div className="work-chips">
                      {["帮我看一份材料", "一起想方案", "修改已有成果"].map(
                        (s) => (
                          <button
                            type="button"
                            className="toolbar-button"
                            key={s}
                            onClick={() => setDraft(s)}
                          >
                            {s}
                          </button>
                        ),
                      )}
                    </div>
                    {works.length > 0 && (
                      <section className="work-recent">
                        <h2 className="work-section-title">继续之前的工作</h2>
                        {works.slice(0, 3).map((w) => (
                          <button
                            type="button"
                            className="file-item work-recent-item"
                            disabled={busy}
                            key={w.work_key}
                            onClick={() => void resume(w)}
                          >
                            <Icon name="artifact" size={20} />
                            <span className="file-copy">
                              <span className="file-name">{w.title}</span>
                              <span className="file-meta">
                                上次：{w.last_progress}
                              </span>
                            </span>
                            <Icon name="chevronRight" size={16} />
                          </button>
                        ))}
                      </section>
                    )}
                  </div>
                )}
                {work.round?.task_key &&
                (inProgress() || work.round.phase === "ended") ? (
                  <article
                    className={`work-message message-system tone-${interrupted ? "warning" : "info"} work-progress-card`}
                    aria-label="本次进展"
                  >
                    <header>
                      <span className="system-badge is-info" aria-hidden="true">
                        <Icon name="activity" size={13} />
                      </span>
                      <strong>本次进展</strong>
                      <span
                        className={`promax-status ${inProgress() && !interrupted ? "work-status--running" : "work-status--done"}`}
                        role="status"
                      >
                        {interrupted
                          ? "执行未在进行（可能已中断）· 已落盘的草稿保留"
                          : inProgress()
                            ? phaseLabel
                            : `${work.card?.last_progress} · 可继续讨论`}
                      </span>
                    </header>
                    {inProgress() && (
                      <div className="work-progress-actions">
                        {interrupted && (
                          <button
                            type="button"
                            className="promax-button promax-button--primary"
                            disabled={busy}
                            onClick={() => void resumeRun()}
                          >
                            继续执行
                          </button>
                        )}
                        <button
                          type="button"
                          className="toolbar-button"
                          disabled={busy || stopping}
                          onClick={() => void stop()}
                        >
                          {stopping ? "正在停止…" : "停止并保留草稿"}
                        </button>
                      </div>
                    )}
                  </article>
                ) : null}
              </div>
            </div>
            {/* Questions float over messages, never inside the fixed composer or its scroll area. */}
            {viewCard && <QuestionQueue key={contextKey} storageKey={contextKey} items={views} focusId={boardExpanded} drafts={interaction.drafts} onDraft={interaction.setDraft}
              onAnswer={(view, text) => answerView(view, text)} onChoice={(view, option) => answerView(view, option, option)} onDiscuss={discussView}
              onResendDecision={(record) => { void act(() => resendDecisionRaw(record)); }} onWithdrawDecision={(record) => { void act(() => withdrawDecisionRaw(record)); }}
              followUpFailed={(record) => !!decisionTurnFailed(timeline, record.answered_at)} answerError={answerError} busy={answerBusy} />}
            <div className="work-activity-slot">
              <WorkActivity work={work} active={executing} sending={busy} label={conversation.running && !inProgress() ? (conversation.runningCalls?.length ? "工具执行中" : "处理中 · 等待回复") : work.status?.label || phaseLabel} onMember={(id, task) => void openMember(id, task)} />
            </div>
            <div className="composer-wrap work-composer-wrap">
              <WorkComposer
                draft={draft}
                onDraft={setDraft}
                textareaRef={composerRef}
                placeholder={
                  !viewCard
                    ? "输入要做的工作或问题（Enter 发送，Shift+Enter 换行）"
                    : inProgress()
                      ? "补充说明会并入当前任务，不会重跑（Enter 发送）"
                      : "继续讨论，或输入“回到主题”（Enter 发送）"
                }
                inputDisabled={busy}
                canSubmit={!!project && hasContent && !busy && !stopping}
                showStop={(conversation.running || inProgress()) && !hasContent}
                stopping={stopping}
                stopDisabled={busy}
                attachDisabled={busy || !project}
                onSubmit={() => void send()}
                onStop={() => void stop()}
                onAddFiles={addFiles}
                chips={chips}
                model={<ModelSelector location="composer" {...modelLock} onError={setError} />}
                pendingCount={pendingCount}
                onPendingOpen={locateQuestion}
              />
            </div>
          </main>} workspace={<aside id="work-reading-area" className="right-sidebar current-work" aria-label="工作区">
            <ProgressTrunk work={work} interrupted={interrupted} />
            <div className="question-alert" aria-label="待回应提醒">
              <strong>待回应 {pendingCount}</strong>
              {urgentCount > 0 ? (
                <span className="alert-urgent">紧急 {urgentCount}</span>
              ) : pendingCount > 0 ? (
                <span className="alert-active">按等待时间处理</span>
              ) : (
                <span className="alert-ok">没有待你回应的必答项</span>
              )}
              {!!work.recording_error && <span className="alert-urgent" role="alert" title={work.recording_error.at}>
                运行记录暂未完整保存（待补存{work.recording_error.buffered}项）；不表示模型失败，不自动重跑。
              </span>}
              {!!work.status_write_error && (
                <span className="alert-urgent" role="alert" title={work.status_write_error.at}>
                  状态写入失败：{work.status_write_error.message}
                </span>
              )}
              {(work.status?.faults ?? [])
                .filter((fault) => fault.state === "needs_fix")
                .map((fault) => (
                  <span key={fault.key} className="alert-urgent" role="status" title={fault.history.at(-1)?.reason}>
                    待修复：{faultStepLabel(fault.step)} · 已自动恢复 {Math.min(fault.attempts, fault.limit)}/{fault.limit} 次 · 成果已保留 · {FAULT_REPORT_LABEL[fault.report?.state ?? "none"]}
                  </span>
                ))}
              {!!work.status?.blocks.some((block) => block.kind === "alignment") && (
                <span
                  className="alert-urgent"
                  title={work.status.blocks.find((block) => block.kind === "alignment")?.detail}
                >
                  高影响对齐中（不计入待回应）
                </span>
              )}
              <span className="foot-spacer" />
              {work.status?.label && <span>{work.status.label}</span>}
            </div>
            <div className="work-panel">
              {readonlyFile?.key === contextKey ? <section className="viewer-index"><header><strong>只读版本 · {readonlyFile.sha256.slice(0, 12)}</strong><button type="button" onClick={() => { fileRequest.current++; setReadonlyFile(null); }}>返回查看目录</button></header><ArtifactPreview filename={readonlyFile.filename} content={readonlyFile.content} /></section> : memberDetail?.key === contextKey ? <section className="member-readonly" aria-label="成员只读执行详情"><header><strong>{TEAM_ROLES[memberDetail.value.member] ?? memberDetail.value.member}</strong><button type="button" onClick={() => setMemberDetail(null)}>返回查看</button></header><p>本次任务：{memberDetail.value.task_key} · {memberDetail.value.state}</p><p>只读记录；未记录的历史过程不补造。</p>{memberDetail.value.events.map((e) => <article key={e.id}><time>{new Date(e.at).toLocaleTimeString()}</time><p>{e.text}</p>{e.failed && <span role="alert">此步骤失败</span>}</article>)}</section> : panelView === "doc" && activeDoc && viewCard ? (
                <>
                  <header className="workspace-document-head"><strong>{deliverableLabel(activeDoc.filename)}</strong><button type="button" aria-label="关闭文档" onClick={closeDoc}>关闭</button></header>
                  <div className="ws-viewport">
                    <CurrentWork scope={scope} work={{ ...work, card: viewCard }} onRefresh={refresh} onDraft={interaction.setDraft} onOpenQuestion={discuss}
                      page={{ filename: activeDoc.filename, ...(activeDoc.sha256 ? { pinnedSha: activeDoc.sha256 } : {}), ...(activeDoc.kind === "check" ? { initialTab: "check" as const } : {}), ...(activeDoc.highlight ? { highlight: activeDoc.highlight } : {}),
                        onHighlight: (highlight) => setActiveDoc((current) => current ? { ...current, highlight } : null), onOpenDoc: openDoc,
                        onPointOut: (filename, location) => { setQuote({ filename, sha256: "", location, text: location || deliverableLabel(filename) }); composerRef.current?.focus(); },
                        onQuote: (value) => { setQuote(value); composerRef.current?.focus(); },
                      }} />
                  </div>
                </>
              ) : (
                <div className="viewer-index">
                  <h3>当前工作的材料与成果</h3>
                  {!viewCard && <p>开始工作后在这里查看材料、成果和评审。</p>}
                  {viewCard?.materials.map((m) => <article key={m.path}><strong>{m.path.split("/").at(-1)}</strong><p>上传：{m.sha256 ? "已保存原件" : "未确认"} · 解析：{m.parse_status === "ready" ? "可读" : m.parse_status === "failed" ? "失败" : "旧记录未区分"}</p><p>{m.error || m.limitation}</p>{m.readable_path && <><p>可读副本：{m.readable_path}</p><button type="button" onClick={() => void inspectFile({ kind: "material", id: m.path })}>查看可读材料</button></>}<p>实际读取：{m.reads?.length ? m.reads.map((r) => `${TEAM_ROLES[r.member] ?? "主 Agent"}（起始 ${r.offset ?? 1}，${r.limit ? `请求 ${r.limit} 行` : "范围未声明"}）`).join("；") : "暂无读取记录"}；不等于通读或成果采用。</p></article>)}
                  {viewCard?.deliverables.map((d) => <button type="button" key={d.filename} onClick={() => { setMemberDetail(null); openDoc({ filename: d.filename }); }}>{deliverableLabel(d.filename)} · {d.status}</button>)}
                  <h3>评审记录与被审版本</h3>
                  {work.reviews?.reports?.map((r) => <article key={r.request}><button type="button" onClick={() => void inspectFile({ kind: "report", id: r.request })}>{r.at} · {r.verdict} · 查看评审</button>{Object.entries(r.hashes).map(([filename, sha256]) => <button key={filename} type="button" onClick={() => void inspectFile({ kind: "review-version", filename, sha256 })}>被审版 {deliverableLabel(filename)} · {sha256.slice(0, 8)}</button>)}</article>)}
                  <h3>当前问题清单</h3>
                  {!work.reviews?.issues.length && <p>暂无已接收的问题记录，不代表评审通过。</p>}
                  {work.reviews?.issues.map((i) => <article key={`${i.group}:${i.id}`}><strong>[{issueVerified(i) ? "x" : " "}] {i.id} · {i.state === "verified" && !issueVerified(i) ? "旧版已修，当前版本/要求待核对" : ({ open: "未修", changed: "已改待查", verified: "核实修复（绑定版本）", unverifiable: "无法验证", accepted_risk: "接受风险暂不改" })[i.state]}</strong><p>{i.artifact} · {i.location}</p><p>{i.impact} · {i.fix}</p><details><summary>依据与复查历史</summary><p>{i.evidence}</p>{i.history.map((h) => <p key={`${h.request}:${h.state}`}>{h.at} · {h.state} · {h.evidence} · {h.report}</p>)}</details></article>)}
                </div>
              )}
            </div>
            <div className="work-panel-foot">
              {panelView === "doc" && activeDoc && viewCard ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const files = viewCard.deliverables;
                      const index = deliverableIndex(activeDoc.filename);
                      const previous = files[index <= 0 ? files.length - 1 : index - 1];
                      if (previous) openDoc({ filename: previous.filename });
                    }}
                  >
                    上一份
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const files = viewCard.deliverables;
                      const index = deliverableIndex(activeDoc.filename);
                      const next = files[index < 0 || index + 1 >= files.length ? 0 : index + 1];
                      if (next) openDoc({ filename: next.filename });
                    }}
                  >
                    下一份
                  </button>
                  <span>
                    第 {Math.max(1, deliverableIndex(activeDoc.filename) + 1)} / {Math.max(1, viewCard.deliverables.length)} 份
                  </span>
                  <span className="foot-spacer" />
                  <button type="button" onClick={() => setPanelView("questions")}>返回查看目录</button>
                </>
              ) : (
                <>
                  <span>查看不派工、不改写文件；问题请在输入区上方回答。</span>
                  <span className="foot-spacer" />
                  {activeDoc && viewCard && (
                    <button type="button" onClick={() => setPanelView("doc")}>返回阅读：{deliverableLabel(activeDoc.filename)}</button>
                  )}
                </>
              )}
            </div>
          </aside>} />
          {notice && <span className="work-view-notice" role="status">{notice}</span>}
        </>
      )}
      {settings.mounted && (
        <WorkSettingsDialog
          open={settings.open}
          onClose={closeSettings}
          service={props.settings}
          preferences={<ModelSelector location="settings" {...modelLock} />}
          modelSelector={<ModelSelector location="settings" {...modelLock} />}
        />
      )}
      {error && (
        <div className="work-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="promax-workbench-icon-button"
            aria-label="关闭"
            onClick={() => setError("")}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
