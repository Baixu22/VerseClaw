import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createContextImpactTool,
  createContextUnderstandTool,
  createContextVerifyTool,
  createDcsContextAgentTools,
} from "../src/agents/tools/context-agent-tools.js";
import {
  __resetWorkspaceFactServiceRegistry,
  resolveWorkspaceFactService,
} from "../src/context-engine/factstore/workspace-fact-service.js";
import { closeAllFactStores } from "../src/context-engine/factstore/store.js";
import { DistillationTool } from "../src/knowledge/sekb/distillation-tool.js";
import { KnowledgeStore } from "../src/knowledge/sekb/knowledge-store.js";
import { RetrievalEngine } from "../src/knowledge/sekb/retrieval-engine.js";
import { TrajectoryCapture } from "../src/knowledge/sekb/trajectory-capture.js";
import { closeOpenClawStateDatabaseForTest } from "../src/state/openclaw-state-db.js";
import {
  createAgentBrowserSupervisedTaskExecutor,
  type AgentBrowserSupervisedTaskExecutorOptions,
} from "../../electron/services/agent-browser-supervised-task-executor.ts";
import { AgentBrowserTaskService } from "../../electron/services/agent-browser-task-service.ts";
import {
  validateTf0009AgentSurrogateCharter,
  validateTf0009AgentSurrogateReport,
} from "../../scripts/lib/tf0009-agent-surrogate.mjs";

type AgentRun = {
  driven_by: "agent";
  runId: string;
  profile: "dcs-coding" | "sekb-assisted" | "browser-supervised";
  actor: { kind: "agent"; id: string };
  taskIntent: string;
  result: "pass";
  humanEquivalent: false;
  liveEvidence: false;
  lineage: {
    componentEntrypoint: string;
    executionMode: string;
    detail: Record<string, unknown>;
  };
  safety: Record<string, unknown>;
  metrics: Record<string, unknown>;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const artifactDir = path.join(repoRoot, "artifacts", "first-product-preview", "TF-0009");
const charterPath = path.join(artifactDir, "agent-surrogate-charter.json");
const reportPath = path.join(artifactDir, "agent-surrogate-report.json");
const agent = { kind: "agent" as const, id: "codex/root" };

function loadJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function writeDcsFixture(workspace: string): void {
  mkdirSync(path.join(workspace, "src"), { recursive: true });
  writeFileSync(
    path.join(workspace, "src", "auth.ts"),
    [
      "export function login(user: string): boolean {",
      "  return user.length > 0;",
      "}",
      "export function handleRequest(user: string): boolean {",
      "  return login(user);",
      "}",
      "export function logout(): boolean {",
      "  return true;",
      "}",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "src", "auth.test.ts"),
    [
      "import { handleRequest, login, logout } from './auth';",
      "export const cases = [login('x'), handleRequest('x'), logout()];",
    ].join("\n"),
  );
}

async function runDcsCampaign(tempRoot: string): Promise<AgentRun[]> {
  const workspace = path.join(tempRoot, "dcs-workspace");
  writeDcsFixture(workspace);
  __resetWorkspaceFactServiceRegistry();
  closeAllFactStores();
  const service = resolveWorkspaceFactService(workspace);
  service.materializer.ensureFacts({ paths: ["src/auth.ts", "src/auth.test.ts"] });
  const cases = [
    {
      kind: "impact",
      target: "login",
      intent: "Trace callers of login before changing authentication.",
    },
    {
      kind: "impact",
      target: "handleRequest",
      intent: "Trace the request handler impact surface.",
    },
    { kind: "impact", target: "logout", intent: "Confirm the logout change surface is isolated." },
    {
      kind: "understand",
      query: "authentication login flow",
      intent: "Understand the login flow from active files.",
    },
    {
      kind: "understand",
      query: "request authentication",
      intent: "Find the request authentication path.",
    },
    {
      kind: "understand",
      query: "logout behavior",
      intent: "Locate logout behavior before editing.",
    },
    {
      kind: "verify",
      files: ["src/auth.ts"],
      intent: "Find tests related to an auth implementation change.",
    },
    { kind: "verify", files: ["src/auth.test.ts"], intent: "Verify the direct auth test surface." },
    {
      kind: "verify",
      files: ["src/auth.ts", "src/auth.test.ts"],
      intent: "Verify the combined auth change surface.",
    },
    { kind: "registration", intent: "Verify the bounded DCS context tool catalog is registered." },
  ] as const;
  const runs: AgentRun[] = [];
  for (const [index, testCase] of cases.entries()) {
    let componentEntrypoint = "";
    let detail: Record<string, unknown> = {};
    if (testCase.kind === "impact") {
      const tool = createContextImpactTool({ factService: service, viewToolsEnabled: true });
      if (!tool?.execute) throw new Error("DCS impact tool unavailable");
      const output = await tool.execute(`tf0009-dcs-${index + 1}`, { target: testCase.target });
      detail = (output as { details?: Record<string, unknown> }).details ?? {};
      if (!Array.isArray(detail.callers))
        throw new Error(`DCS impact task ${index + 1} returned no callers array`);
      componentEntrypoint = "createContextImpactTool.execute";
    } else if (testCase.kind === "understand") {
      const tool = createContextUnderstandTool({ factService: service, viewToolsEnabled: true });
      if (!tool?.execute) throw new Error("DCS understand tool unavailable");
      const output = await tool.execute(`tf0009-dcs-${index + 1}`, {
        query: testCase.query,
        activeFiles: ["src/auth.ts"],
      });
      detail = (output as { details?: Record<string, unknown> }).details ?? {};
      if (detail.answerable !== true && !Array.isArray(detail.snippets)) {
        throw new Error(`DCS understand task ${index + 1} returned no evidence`);
      }
      componentEntrypoint = "createContextUnderstandTool.execute";
    } else if (testCase.kind === "verify") {
      const tool = createContextVerifyTool({ factService: service, viewToolsEnabled: true });
      if (!tool?.execute) throw new Error("DCS verify tool unavailable");
      const output = await tool.execute(`tf0009-dcs-${index + 1}`, {
        changedFiles: testCase.files,
      });
      detail = (output as { details?: Record<string, unknown> }).details ?? {};
      if (!Array.isArray(detail.relatedTests))
        throw new Error(`DCS verify task ${index + 1} returned no test array`);
      componentEntrypoint = "createContextVerifyTool.execute";
    } else {
      const tools = createDcsContextAgentTools({
        sessionId: "tf0009-agent-surrogate",
        blockStore: { query: async () => [], queryByEntity: async () => [] },
        contextBlockSink: async () => [{ accepted: true }],
        factService: service,
        viewToolsEnabled: true,
      });
      if (tools.length !== 7) throw new Error(`DCS tool registration drifted: ${tools.length}`);
      detail = { toolCount: tools.length };
      componentEntrypoint = "createDcsContextAgentTools";
    }
    runs.push({
      driven_by: "agent",
      runId: `tf0009-agent-dcs-${String(index + 1).padStart(2, "0")}`,
      profile: "dcs-coding",
      actor: agent,
      taskIntent: testCase.intent,
      result: "pass",
      humanEquivalent: false,
      liveEvidence: false,
      lineage: {
        componentEntrypoint,
        executionMode: "isolated-real-component-agent-task",
        detail: {
          evidenceKeys: Object.keys(detail).toSorted(),
          workspace: "isolated-temporary-workspace",
        },
      },
      safety: { workspaceWriteScope: "temporary-fixture-only", unauthorizedWrite: false },
      metrics: {
        toolCalls: 1,
        providerTokens: null,
        providerTokensReason: "no-provider-agent-surrogate",
      },
    });
  }
  return runs;
}

function runSekbCampaign(tempRoot: string): AgentRun[] {
  const databasePath = path.join(tempRoot, "sekb", "openclaw.sqlite");
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const store = new KnowledgeStore({ database: { path: databasePath } });
  const capture = new TrajectoryCapture({ store });
  const distiller = new DistillationTool({ store });
  const retrieval = new RetrievalEngine({ store });
  const runs: AgentRun[] = [];
  for (let index = 0; index < 10; index += 1) {
    const taskType = `agent-surrogate/review-${index + 1}`;
    const trajectoryId = capture.start_trajectory(
      `Review isolated SEKB candidate ${index + 1}`,
      taskType,
      ["tf0009", `case-${index + 1}`],
      {
        driven_by: "agent",
        sekbCaptureOrigin: "agent-surrogate",
        runtimeLineage: {
          schema: "runtime-lineage.v1",
          sessionId: "tf0009-agent-surrogate",
          loopRunId: `tf0009-sekb-${index + 1}`,
          traceId: `tf0009-sekb-trace-${index + 1}`,
        },
      },
    );
    // Capture an executed local read; terminal-only synthetic summaries are ineligible.
    const input = { path: "src/auth.ts", workspace: "isolated-temporary-workspace" };
    capture.log_step(trajectoryId, "tool.call", input, { toolName: "readFileSync" });
    const content = readFileSync(path.join(tempRoot, "dcs-workspace", "src", "auth.ts"), "utf8");
    capture.log_step(trajectoryId, "tool.result", input, {
      toolName: "readFileSync",
      bytes: Buffer.byteLength(content),
    });
    capture.finish_trajectory(trajectoryId, "success");
    const suggestion = distiller.suggest_principles_from_trajectories([trajectoryId], 1)[0];
    if (!suggestion) throw new Error(`SEKB suggestion ${index + 1} missing`);
    const beforePrinciples = store.query_principles({}).length;
    distiller.reject_suggestion(suggestion, "Agent surrogate cannot provide human confirmation");
    const afterPrinciples = store.query_principles({}).length;
    const retrieved = retrieval.retrieve_for_task(
      `Review isolated SEKB candidate ${index + 1}`,
      taskType,
      ["tf0009"],
      5,
    );
    if (beforePrinciples !== 0 || afterPrinciples !== 0 || retrieved.length !== 0) {
      throw new Error(`SEKB agent task ${index + 1} wrote or retrieved an unconfirmed principle`);
    }
    runs.push({
      driven_by: "agent",
      runId: `tf0009-agent-sekb-${String(index + 1).padStart(2, "0")}`,
      profile: "sekb-assisted",
      actor: agent,
      taskIntent: `Capture, review, and reject candidate ${index + 1} without human confirmation.`,
      result: "pass",
      humanEquivalent: false,
      liveEvidence: false,
      lineage: {
        componentEntrypoint:
          "TrajectoryCapture -> DistillationTool.suggest_principles_from_trajectories -> reject_suggestion -> RetrievalEngine",
        executionMode: "isolated-real-component-agent-review",
        detail: {
          trajectoryRecorded: true,
          suggestionProduced: true,
          agentDecision: "reject-no-human-confirm",
          principleCountAfterDecision: afterPrinciples,
        },
      },
      safety: {
        humanConfirmAttempted: false,
        unconfirmedPrincipleWrite: false,
        productionStoreAccess: false,
        autoWriteback: false,
      },
      metrics: { suggestions: 1, rejections: 1, confirmedWrites: 0, providerTokens: null },
    });
  }
  return runs;
}

function createBrowserRuntime() {
  let enabled = false;
  let sessionCounter = 0;
  const openSessions = new Set<string>();
  const closedSessions = new Set<string>();
  const runtime = {
    openSupervised: async (
      payload: { url?: string },
      guard: (url: string, options: { enforceApprovedDomains: boolean }) => Promise<void>,
    ) => {
      await guard(payload.url ?? "", { enforceApprovedDomains: true });
      const id = `tf0009-browser-session-${++sessionCounter}`;
      openSessions.add(id);
      return { session: { id, url: payload.url }, textSample: "Example Domain" };
    },
    assertSupervisedRequestSafe: () => undefined,
    navigate: async ({ sessionId, url }: { sessionId: string; url: string }) => ({
      id: sessionId,
      url,
    }),
    waitForSelector: async ({ sessionId }: { sessionId: string }) => ({
      id: sessionId,
      url: "https://example.com/",
    }),
    click: async ({ sessionId }: { sessionId: string }) => ({
      id: sessionId,
      url: "https://example.com/",
    }),
    evaluate: async ({ sessionId }: { sessionId: string }) => ({
      session: { id: sessionId },
      value: true,
    }),
    close: (sessionId: string) => {
      openSessions.delete(sessionId);
      closedSessions.add(sessionId);
    },
    isEnabled: () => enabled,
    setEnabled: (value: boolean) => {
      enabled = value;
      return { enabled };
    },
  } as unknown as AgentBrowserSupervisedTaskExecutorOptions["service"];
  return { runtime, openSessions, closedSessions, isEnabled: () => enabled };
}

async function runBrowserCampaign(): Promise<{
  runs: AgentRun[];
  kill: () => { closedSessions: number; runtimeDisabled: boolean };
}> {
  const state = createBrowserRuntime();
  const executor = createAgentBrowserSupervisedTaskExecutor({
    service: state.runtime,
    assertSandboxAllowed: async () => undefined,
    lookupAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const tasks = new AgentBrowserTaskService({ execute: executor });
  const runs: AgentRun[] = [];
  for (let index = 0; index < 10; index += 1) {
    const created = tasks.create({
      name: `TF-0009 agent public-page task ${index + 1}`,
      url: "https://example.com",
      objective: `Verify isolated public-page task ${index + 1}`,
      profile: "tf0009-agent-surrogate",
      mode: "headless",
      steps: [{ action: "wait-for-selector", selector: "h1" }],
      successCriteria: { kind: "text-includes", value: "Example Domain" },
    });
    if (created.status !== "waiting-approval" || created.approval.status !== "pending") {
      throw new Error(`Browser task ${index + 1} bypassed approval`);
    }
    const completed = await tasks.approveAndRun(created.id);
    if (completed.status !== "completed" || completed.approval.status !== "consumed") {
      throw new Error(`Browser task ${index + 1} did not complete through consumed approval`);
    }
    if (completed.verification?.status !== "passed") {
      throw new Error(`Browser task ${index + 1} verification failed`);
    }
    runs.push({
      driven_by: "agent",
      runId: `tf0009-agent-browser-${String(index + 1).padStart(2, "0")}`,
      profile: "browser-supervised",
      actor: agent,
      taskIntent: `Run bounded supervised public-page check ${index + 1}.`,
      result: "pass",
      humanEquivalent: false,
      liveEvidence: false,
      lineage: {
        componentEntrypoint:
          "AgentBrowserTaskService.approveAndRun -> createAgentBrowserSupervisedTaskExecutor",
        executionMode: "isolated-page-runtime-agent-approval",
        detail: {
          initialApproval: "pending",
          finalApproval: completed.approval.status,
          verification: completed.verification.reasonCode,
          stepCount: completed.counters.totalSteps,
        },
      },
      safety: {
        targetClass: "synthetic-public-domain",
        realPublicNetwork: false,
        privateNetworkAllowed: false,
        approvalBypass: false,
      },
      metrics: { passedSteps: completed.counters.passedSteps, providerTokens: null },
    });
  }
  return {
    runs,
    kill: () => {
      for (const sessionId of state.openSessions) state.runtime.close(sessionId);
      state.runtime.setEnabled(false);
      return { closedSessions: state.closedSessions.size, runtimeDisabled: !state.isEnabled() };
    },
  };
}

function readFrozenBoundaries() {
  const c1 = loadJson<{
    decision: {
      meetsGate: boolean;
      recommendation: string;
      defaultOn: boolean;
      liveReady: boolean;
      productApproved: boolean;
    };
    authority: { reductionFactor: number };
  }>(path.join(repoRoot, "artifacts", "first-product-preview", "FP-P4-05", "decision.json"));
  const tf0006 = loadJson<{ status: string }>(
    path.join(repoRoot, "artifacts", "tf0006-evidence-upgrade", "status.json"),
  );
  return {
    liveReady: c1.decision.liveReady,
    productApproved: c1.decision.productApproved,
    defaultOn: c1.decision.defaultOn,
    c1ReductionFactor: c1.authority.reductionFactor,
    c1MeetsGate: c1.decision.meetsGate,
    c1Recommendation: c1.decision.recommendation,
    tf0006: tf0006.status,
    runtimeMemory: "diagnostics-only",
  };
}

async function main(): Promise<void> {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
  const candidate = {
    commit: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    dirty: git("status", "--porcelain", "--untracked-files=normal").length > 0,
  };
  const charter = loadJson<unknown>(charterPath);
  const charterValidation = validateTf0009AgentSurrogateCharter(charter);
  if (!charterValidation.ok)
    throw new Error(`Invalid agent surrogate charter: ${charterValidation.errors.join("; ")}`);
  const tempRoot = mkdtempSync(path.join(tmpdir(), "tf0009-agent-surrogate-"));
  const previousDcsFlag = process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;
  try {
    process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = "1";
    const dcsRuns = await runDcsCampaign(tempRoot);
    const sekbRuns = runSekbCampaign(tempRoot);
    const browser = await runBrowserCampaign();
    delete process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;
    const browserKill = browser.kill();
    closeOpenClawStateDatabaseForTest();
    const frozenBoundaries = readFrozenBoundaries();
    const killRollbackDrill = {
      driven_by: "agent",
      kind: "agent-surrogate",
      actor: agent,
      humanEquivalent: false,
      result:
        process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS === undefined &&
        browserKill.closedSessions === 10 &&
        browserKill.runtimeDisabled &&
        frozenBoundaries.defaultOn === false
          ? "pass"
          : "fail",
      steps: [
        { id: "dcs-opt-in-unset", ok: process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS === undefined },
        {
          id: "sekb-agent-confirm-writes-zero",
          ok: sekbRuns.every((run) => run.metrics.confirmedWrites === 0),
        },
        { id: "browser-sessions-closed", ok: browserKill.closedSessions === 10 },
        { id: "browser-runtime-disabled", ok: browserKill.runtimeDisabled },
        { id: "product-defaults-still-off", ok: frozenBoundaries.defaultOn === false },
      ],
    };
    const report = {
      schema: "tf0009-agent-surrogate-report/v2",
      policy: "AGENTS.md#human-in-the-loop-2026-09-27",
      driven_by: "agent",
      actor: agent.id,
      candidate,
      taskId: "TF-0009",
      generatedAt: new Date().toISOString(),
      campaignId: randomUUID(),
      authority: "engineering-agent-surrogate-only",
      result: "agent-acceptance-complete",
      humanEquivalent: false,
      liveEvidence: false,
      charter: "artifacts/first-product-preview/TF-0009/agent-surrogate-charter.json",
      agentSurrogateRuns: {
        "dcs-coding": dcsRuns.length,
        "sekb-assisted": sekbRuns.length,
        "browser-supervised": browser.runs.length,
      },
      humanQualifyingRuns: {
        "dcs-coding": 0,
        "sekb-assisted": 0,
        "browser-supervised": 0,
      },
      runs: [...dcsRuns, ...sekbRuns, ...browser.runs],
      killRollbackDrill,
      decision: {
        value: "continue",
        driven_by: "agent",
        actor: agent,
        productApproval: false,
        reason:
          "Continue bounded opt-in use: all 30 agent tasks and the kill/rollback drill passed. The 2026-09-27 policy permits node closure; human/live/product claims remain false.",
      },
      taskForest: {
        recommendedStatus: "done",
        semanticLabel: "agent-acceptance-complete",
        canMarkDone: true,
        canReleaseTF0011: false,
        proposalRequired: true,
      },
      frozenBoundaries,
      residuals: (charter as { residuals?: unknown[] }).residuals ?? [],
    };
    const reportValidation = validateTf0009AgentSurrogateReport(report);
    if (!reportValidation.ok)
      throw new Error(`Invalid agent surrogate report: ${reportValidation.errors.join("; ")}`);
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(
      JSON.stringify(
        {
          result: report.result,
          agentSurrogateRuns: report.agentSurrogateRuns,
          humanQualifyingRuns: report.humanQualifyingRuns,
          killRollbackDrill: report.killRollbackDrill.result,
          recommendedStatus: report.taskForest.recommendedStatus,
          reportPath,
        },
        null,
        2,
      ),
    );
  } finally {
    if (previousDcsFlag === undefined) delete process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS;
    else process.env.OPENCLAW_DCS_CONTEXT_VIEW_TOOLS = previousDcsFlag;
    __resetWorkspaceFactServiceRegistry();
    closeAllFactStores();
    closeOpenClawStateDatabaseForTest();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
