import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import manifest from "../../../openclaw_runtime/extensions/codegraph/openclaw.plugin.json";
import type { TaskLoopRunResult } from "../../../openclaw_runtime/src/agents/task-loop-controller";
import type { MissionReviewerResult } from "../../../openclaw_runtime/src/agents/mission-control/types";

function toolResult(value: unknown): { details?: {
  mustReadSource?: unknown;
  sourceReadPolicy?: unknown;
  filesToRead?: unknown;
  freshness?: { status?: string };
  stats?: { fileCount?: number };
    path?: string;
} } {
  return value as { details?: {
    mustReadSource?: unknown;
    sourceReadPolicy?: unknown;
    filesToRead?: unknown;
    freshness?: { status?: string };
    stats?: { fileCount?: number };
    path?: string;
  } };
}

export type RuntimeEffectivenessMode = "deterministic" | "live" | "hybrid";

export type RuntimeEffectivenessDecision =
  | "effective"
  | "available-but-neutral"
  | "shadow-only"
  | "not-effective"
  | "blocked";

export type RuntimeEffectivenessComponent = {
  id: string;
  lane: "deterministic" | "live" | "hybrid";
  triggered: boolean;
  decision: RuntimeEffectivenessDecision;
  effectivenessScore: number;
  metrics: Record<string, unknown>;
  evidence: string[];
  risks: string[];
};

export type RuntimeEffectivenessReport = {
  generatedAt: string;
  mode: RuntimeEffectivenessMode;
  durationMs: number;
  decision: {
    status: "effective" | "mixed" | "blocked";
    effectiveComponents: number;
    blockedComponents: string[];
  };
  components: RuntimeEffectivenessComponent[];
  summary: {
    componentCount: number;
    triggeredCount: number;
    effectiveCount: number;
    neutralCount: number;
    shadowOnlyCount: number;
    regressionCount: number;
  };
  boundaryMatrix: Array<{
    componentId: string;
    authority: string;
    defaultMode: "active" | "shadow-only" | "repair-only";
    inScope: string[];
    outOfScope: string[];
    acceptance: string;
  }>;
  overlaps: Array<{
    components: string[];
    risk: string;
    boundaryRule: string;
    status: "controlled" | "needs-watch";
  }>;
  optimizationTargets: Array<{
    componentId: string;
    priority: "P0" | "P1" | "P2";
    status: "passed" | "open";
    target: string;
    evidence: string;
  }>;
  notInScope: string[];
  acceptance: {
    gate: "deterministic-hard-gate";
    status: "passed" | "failed";
    criteria: Array<{
      id: string;
      passed: boolean;
      details: string;
    }>;
  };
  live?: {
    requested: boolean;
    available: boolean;
    reason?: string;
    provider?: {
      envKeysDetected: string[];
      override: boolean;
    };
    gateway?: {
      url: string;
      checked: boolean;
      available: boolean;
      endpoint?: string;
      status?: number;
      durationMs?: number;
      error?: string;
    };
  };
};

export type RuntimeEffectivenessOptions = {
  mode?: RuntimeEffectivenessMode;
  includeLiveProbe?: boolean;
};

type RegisteredCodeGraphTool = {
  tool: {
    name: string;
    execute: (toolCallId: string, args: unknown) => Promise<unknown>;
  };
};

function score(passed: number, total: number): number {
  return total <= 0 ? 0 : Number((passed / total).toFixed(3));
}

function decideEffective(
  checks: Record<string, boolean>,
  fallback: RuntimeEffectivenessDecision = "not-effective",
): RuntimeEffectivenessDecision {
  return Object.values(checks).every(Boolean) ? "effective" : fallback;
}

function component(params: {
  id: string;
  lane?: RuntimeEffectivenessComponent["lane"];
  triggered: boolean;
  decision: RuntimeEffectivenessDecision;
  effectivenessScore: number;
  metrics?: Record<string, unknown>;
  evidence?: string[];
  risks?: string[];
}): RuntimeEffectivenessComponent {
  return {
    lane: "deterministic",
    metrics: {},
    evidence: [],
    risks: [],
    ...params,
    effectivenessScore: Number(params.effectivenessScore.toFixed(3)),
  };
}

async function writeCodeGraphProject(root: string): Promise<void> {
  await writeFile(path.join(root, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022" } }), "utf8");
  await writeFile(
    path.join(root, "user-service.ts"),
    [
      "export function normalizeEmail(email: string) {",
      "  return email.trim().toLowerCase();",
      "}",
      "",
      "export function createUser(email: string) {",
      "  return { email: normalizeEmail(email) };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(root, "api.ts"),
    [
      "import { createUser } from './user-service';",
      "export function route(input: string) {",
      "  return createUser(input);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}

function getTool(tools: RegisteredCodeGraphTool[], name: string): RegisteredCodeGraphTool["tool"] {
  const tool = tools.find((entry) => entry.tool.name === name)?.tool;
  if (!tool) throw new Error(`Missing CodeGraph tool: ${name}`);
  return tool;
}

async function evaluateCodeGraph(): Promise<RuntimeEffectivenessComponent> {
  const workspacePath = await mkdtemp(path.join(tmpdir(), "runtime-effectiveness-codegraph-"));
  try {
    const codeGraphPlugin = (await import("../../../openclaw_runtime/extensions/codegraph/index")).default;
    await writeCodeGraphProject(workspacePath);
    const tools: RegisteredCodeGraphTool[] = [];
    codeGraphPlugin.register({
      registerTool(tool: RegisteredCodeGraphTool["tool"]) {
        tools.push({ tool });
      },
    } as never);
    const registeredNames = tools.map((entry) => entry.tool.name).sort();
    const manifestNames = [...manifest.contracts.tools].sort();
    const registrationComplete = JSON.stringify(registeredNames) === JSON.stringify(manifestNames);

    const init = await getTool(tools, "codegraph_init").execute("cg-init", { workspacePath });
    const decision = await getTool(tools, "codegraph_decide").execute("cg-decide", {
      userIntent: "Modify user-service.ts email normalization",
      operationType: "modify",
      knownFiles: ["user-service.ts"],
    });
    const plan = await getTool(tools, "codegraph_context_plan").execute("cg-plan", {
      workspacePath,
      task: "Where does createUser route through?",
      operationType: "explain",
      maxFiles: 3,
    });
    await writeFile(
      path.join(workspacePath, "user-service.ts"),
      "\nexport function normalizeUserEmail(email: string) { return normalizeEmail(email); }\n",
      { flag: "a" },
    );
    const stale = await getTool(tools, "codegraph_search").execute("cg-stale", {
      workspacePath,
      query: "normalizeUserEmail",
      freshnessMode: "fast",
      limit: 5,
    });
    const refreshed = await getTool(tools, "codegraph_search").execute("cg-refresh", {
      workspacePath,
      query: "normalizeUserEmail",
      freshnessMode: "balanced",
      limit: 5,
    });

    const checks = {
      registrationComplete,
      manifestToolCount: manifestNames.length === 15,
      sourceReadBoundary: toolResult(decision).details?.mustReadSource === true &&
        toolResult(decision).details?.sourceReadPolicy === "read_named_files_before_edit_or_claim",
      planHitTarget: JSON.stringify(toolResult(plan).details?.filesToRead ?? []).includes("user-service.ts"),
      freshnessObserved: toolResult(stale).details?.freshness?.status === "stale" &&
        /fresh|refreshed/u.test(String(toolResult(refreshed).details?.freshness?.status ?? "")),
    };
    const passed = Object.values(checks).filter(Boolean).length;
    return component({
      id: "codegraph",
      triggered: true,
      decision: decideEffective(checks, registrationComplete ? "available-but-neutral" : "not-effective"),
      effectivenessScore: score(passed, Object.keys(checks).length),
      metrics: {
        registeredToolCount: registeredNames.length,
        manifestToolCount: manifestNames.length,
        indexedFileCount: toolResult(init).details?.stats?.fileCount ?? null,
        checks,
      },
      evidence: [
        "CodeGraph plugin registered runtime tools from manifest.",
        "Decision boundary required direct source reads before edits/claims.",
        "Fast freshness detected stale index and balanced freshness refreshed it.",
      ],
      risks: checks.sourceReadBoundary ? [] : ["CodeGraph source-read boundary was not enforced."],
    });
  } catch (error) {
    return component({
      id: "codegraph",
      triggered: false,
      decision: "blocked",
      effectivenessScore: 0,
      metrics: { error: error instanceof Error ? error.message : String(error) },
      risks: ["CodeGraph evaluation could not complete."],
    });
  } finally {
    await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  }
}

function fakeOrchestrationResult(failures: string[] = []) {
  const workers = [
    { roleName: "implementer", task: "implement" },
    { roleName: "tester", task: "test" },
  ];
  return {
    plan: {
      mode: "lead-workers",
      leadRole: "planner",
      templateId: "quick-development",
      workers,
      reasons: ["runtime-effectiveness"],
    },
    outcomes: workers.map((worker, index) => ({
      roleName: worker.roleName,
      task: worker.task,
      isVerifier: false,
      spawn: failures[index]
        ? { status: "error", error: failures[index], result: { error: failures[index] } }
        : { status: "accepted", result: { runId: `run_${index}`, childSessionKey: `child_${index}` } },
    })),
    spawnedRunIds: failures.length ? [] : ["run_0", "run_1"],
    expectedWorkerRunIds: failures.length ? [] : ["run_0", "run_1"],
    pendingVerifier: failures.length === 0,
    failures: failures.map((error, index) => ({ roleName: workers[index]?.roleName ?? "worker", status: "error", error })),
  };
}

function evidenceRun(runId?: string, childSessionKey?: string) {
  if (!runId || !childSessionKey) return null;
  return {
    runId,
    childSessionKey,
    requesterSessionKey: "agent:main:runtime-effectiveness",
    requesterDisplayKey: "Main",
    task: "runtime effectiveness task",
    cleanup: "delete",
    createdAt: 1,
    endedAt: 2,
    outcome: { status: "ok" },
    completion: {
      required: true,
      capturedAt: 2,
      resultText: [
        "## Summary",
        `Completed ${runId} with evidence.`,
        "## Files Touched",
        `src/${runId}.ts`,
        "## Tests Run",
        "pnpm test passed",
      ].join("\n"),
    },
  };
}

async function evaluateTaskAndMissionLoopRepair(): Promise<RuntimeEffectivenessComponent> {
  const {
    clearTaskLoopRunsForTests,
    runTaskLoop,
  } = await import("../../../openclaw_runtime/src/agents/task-loop-controller");
  const {
    cancelMission,
    runMission,
  } = await import("../../../openclaw_runtime/src/agents/mission-control/controller");
  clearTaskLoopRunsForTests();
  try {
    let repairCalls = 0;
    const recovered = await runTaskLoop(
      { task: "Repair missing API evidence", sessionKey: "agent:main:runtime-effectiveness" },
      { agents: { defaults: { taskLoop: { maxIterations: 3, maxRepairIterations: 2 } } } },
      {
        idFactory: (prefix) => `${prefix}_runtime_effectiveness_repair`,
        runObserved: (async () => fakeOrchestrationResult()) as never,
        getSubagentRun: evidenceRun as never,
        storeTrace: (async () => "trace_repair") as never,
        selfCheck: (async () => {
          repairCalls += 1;
          if (repairCalls === 1) {
            return {
              decision: "repair",
              confidence: 0.5,
              missingEvidence: ["API response test missing"],
              repairBrief: "Add API response unit test",
              verificationGaps: [],
              risks: [],
              controlSignals: [],
              contextSummary: "needs API test",
            };
          }
          return {
            decision: "complete",
            confidence: 0.9,
            missingEvidence: [],
            verificationGaps: [],
            risks: [],
            validationState: { status: "passed", checks: ["API test"], evidenceRefs: ["trace_repair"] },
            acceptanceStatus: { status: "satisfied", criteria: ["API evidence"], gaps: [] },
            contextSummary: "API test added and passing",
          };
        }) as never,
      },
    );

    const repeated = await runTaskLoop(
      { task: "Repeat repair evidence", sessionKey: "agent:main:runtime-effectiveness-repeat" },
      { agents: { defaults: { taskLoop: { maxIterations: 3, maxRepairIterations: 2 } } } },
      {
        idFactory: (prefix) => `${prefix}_runtime_effectiveness_repeat`,
        runObserved: (async () => fakeOrchestrationResult()) as never,
        getSubagentRun: evidenceRun as never,
        storeTrace: (async () => "trace_repeat") as never,
        selfCheck: (async () => ({
          decision: "repair",
          confidence: 0.4,
          missingEvidence: ["same missing evidence"],
          repairBrief: "same repair",
          verificationGaps: ["same validation gap"],
          risks: [],
          controlSignals: [],
          contextSummary: "same repair state",
        })) as never,
      },
    );

    const exhausted = await runTaskLoop(
      { task: "Exhaust repair budget", sessionKey: "agent:main:runtime-effectiveness-budget" },
      { agents: { defaults: { taskLoop: { maxIterations: 2, maxRepairIterations: 1 } } } },
      {
        idFactory: (prefix) => `${prefix}_runtime_effectiveness_budget`,
        runObserved: (async () => fakeOrchestrationResult()) as never,
        getSubagentRun: evidenceRun as never,
        
        storeTrace: (async () => "trace_budget") as never,
        selfCheck: (async () => ({
          decision: "repair",
          confidence: 0.3,
          missingEvidence: ["still missing"],
          repairBrief: "still repair",
          verificationGaps: ["still gap"],
          risks: [],
          controlSignals: [],
          contextSummary: "budget not enough",
        })) as never,
      },
    );

    const missionReviewer: MissionReviewerResult = {
      decision: "repair",
      confidence: 0.5,
      reason: "mission needs repair",
      missingEvidence: ["task loop blocked"],
      verificationGaps: ["missing mission validation"],
      repairBrief: "rerun repaired task-loop pulse",
      risks: [],
      controlSignals: [],
      validationState: { status: "missing", checks: [], evidenceRefs: [] },
      acceptanceStatus: { status: "missing", criteria: ["mission done"], gaps: ["task loop blocked"] },
      checkpointSummary: "mission repair checkpoint",
      nextTick: { afterMs: 1000 },
      memoryCandidates: [],
    };
    const mission = await runMission(
      {
        objective: "Mission repair effectiveness",
        sessionKey: "agent:main:runtime-effectiveness-mission",
        maxTicks: 2,
        maxRepairTicks: 1,
      },
      {},
      {
        idFactory: (prefix) => `${prefix}_runtime_effectiveness_mission`,
        runTaskLoop: (async () => ({
          ...repeated,
          loopRunId: "loop_runtime_effectiveness_mission_inner",
          status: "blocked",
          phase: "blocked",
          remaining: ["inner blocked"],
          risks: [],
        } satisfies TaskLoopRunResult)) as never,
        reviewer: (async () => missionReviewer) as never,
        
        storeTrace: (async () => "trace_mission") as never,
      },
    );
    cancelMission(mission.missionId);

    const checks = {
      repairPhaseEntered: recovered.iterations.some((entry) => entry.phase === "repair" || entry.selfCheck?.decision === "repair"),
      repairRecovered: recovered.status === "complete",
      repeatedRepairBlocked: repeated.status === "blocked" && /repeated without progress/u.test(repeated.finalSummary ?? ""),
      budgetBlocked: exhausted.status === "blocked",
      missionRepairTickRecorded: mission.lastDecision === "repair" && mission.repairTicks === 1,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    return component({
      id: "task-mission-repair",
      triggered: true,
      decision: decideEffective(checks),
      effectivenessScore: score(passed, Object.keys(checks).length),
      metrics: {
        repairDecisionCount: recovered.iterations.filter((entry) => entry.selfCheck?.decision === "repair").length,
        repairPhaseCount: recovered.iterations.filter((entry) => entry.phase === "repair").length,
        recoveredStatus: recovered.status,
        repeatedStatus: repeated.status,
        exhaustedStatus: exhausted.status,
        missionStatus: mission.status,
        missionRepairTicks: mission.repairTicks,
        checks,
      },
      evidence: [
        "TaskLoop repair scenario entered repair and later completed.",
        "TaskLoop repeated repair evidence blocked instead of pretending completion.",
        "MissionLoop recorded a repair reviewer decision above an inner task loop.",
      ],
    });
  } catch (error) {
    return component({
      id: "task-mission-repair",
      triggered: false,
      decision: "blocked",
      effectivenessScore: 0,
      metrics: { error: error instanceof Error ? error.message : String(error) },
      risks: ["TaskLoop/MissionLoop repair evaluation could not complete."],
    });
  } finally {
    clearTaskLoopRunsForTests();
  }
}

async function evaluateClawGraph(): Promise<RuntimeEffectivenessComponent> {
  const {
    abortClawGraphRun,
    extractClawGraphHandoff,
    getClawGraphRunEvents,
    resetClawGraphRunsForTests,
    startClawGraphRun,
  } = await import("../../../openclaw_runtime/src/agents/clawgraph/runtime");
  const {
    parseClawGraphWorkflowYaml,
  } = await import("../../../openclaw_runtime/src/agents/clawgraph/compiler");
  resetClawGraphRunsForTests();
  try {
    const validYaml = [
      "schemaVersion: 1",
      "workflow:",
      "  id: runtime_effectiveness",
      "  title: Runtime Effectiveness",
      "  objective: Verify ClawGraph",
      "roles:",
      "  worker:",
      "    runtimeRole: planner",
      "nodes:",
      "  - id: audit",
      "    type: audit",
      "    task: Audit dependencies",
      "control:",
      "  maxParallel: 1",
    ].join("\n");
    const invalidYaml = validYaml + "\n  - id: audit\n    type: audit\n    task: Duplicate id\n";
    const compile = parseClawGraphWorkflowYaml(validYaml);
    const invalidCompile = parseClawGraphWorkflowYaml(invalidYaml);
    const lifecycle: string[] = [];
    const run = await startClawGraphRun({
      ir: compile.ir!,
      sessionKey: "agent:main:runtime-effectiveness-clawgraph",
      lifecycle: (event) => lifecycle.push(event.type),
    });
    const events = getClawGraphRunEvents(run.runId) ?? [];
    const handoff = extractClawGraphHandoff(
      [
        "```clawgraph_handoff",
        JSON.stringify({
          nodeId: "work",
          status: "done",
          summary: "Done",
          evidenceRefs: [{ type: "subagent", ref: "run_child" }],
          filesTouched: [],
          testsRun: [],
          decisions: [],
          deviations: [],
          risks: [],
          followupTasks: [],
          confidence: 0.8,
        }),
        "```",
      ].join("\n"),
      "work",
    );
    const invalidHandoff = extractClawGraphHandoff("no structured handoff", "work");

    const reviewYaml = validYaml
      .replace("type: audit", "type: agent\n    role: worker")
      .replace("runtimeRole: planner", "runtimeRole: definitely_missing_role");
    const reviewCompile = parseClawGraphWorkflowYaml(reviewYaml);
    const reviewRun = await startClawGraphRun({
      ir: reviewCompile.ir!,
      sessionKey: "agent:main:runtime-effectiveness-clawgraph-review",
      deps: {
        spawn: async () => ({
          status: "accepted",
          runId: "unused",
          childSessionKey: "unused",
        }),
      },
    });
    const reviewWasRequested = reviewRun.status === "review" &&
      reviewRun.reviewItems.some((item) => item.kind === "handoff_invalid");
    const aborted = abortClawGraphRun(reviewRun.runId, "runtime effectiveness abort");

    const checks = {
      compileOk: compile.ok === true && Boolean(compile.ir),
      compileDiagnostics: invalidCompile.ok === false && invalidCompile.diagnostics.length > 0,
      runEvents: run.status === "complete" &&
        events.some((entry) => entry.type === "node_done") &&
        events.some((entry) => entry.type === "node_audit"),
      handoffParsing: handoff?.status === "done" && invalidHandoff === null,
      abortPath: aborted?.status === "aborted",
      invalidWorkerReview: reviewWasRequested,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    return component({
      id: "clawgraph",
      triggered: true,
      decision: decideEffective(checks),
      effectivenessScore: score(passed, Object.keys(checks).length),
      metrics: {
        compileDiagnostics: invalidCompile.diagnostics.map((entry) => entry.code),
        lifecycle,
        eventTypes: events.map((entry) => entry.type),
        reviewItemKinds: reviewRun.reviewItems.map((entry) => entry.kind),
        checks,
      },
      evidence: [
        "ClawGraph compiled workflow YAML and rejected malformed YAML.",
        "ClawGraph runtime emitted run events and supported abort.",
        "ClawGraph handoff extractor accepted fenced JSON and rejected unstructured output.",
        "Invalid worker path requested review instead of completing.",
      ],
    });
  } catch (error) {
    return component({
      id: "clawgraph",
      triggered: false,
      decision: "blocked",
      effectivenessScore: 0,
      metrics: { error: error instanceof Error ? error.message : String(error) },
      risks: ["ClawGraph evaluation could not complete."],
    });
  } finally {
    resetClawGraphRunsForTests();
  }
}

async function evaluateAgentMapShadow(): Promise<RuntimeEffectivenessComponent> {
  const {
    AGENT_MAP_CONTEXT_PROVIDER_ID,
    createAgentMapContextProvider,
  } = await import("../../../openclaw_runtime/src/context-engine/agent-map-context-provider");
  const {
    buildAgentMapResultFixture,
  } = await import("../../../openclaw_runtime/src/runtime-core");
  let defaultRuns = 0;
  let enabledRuns = 0;
  const resultFixture = buildAgentMapResultFixture();
  const defaultProvider = createAgentMapContextProvider({
    getResult: () => {
      defaultRuns += 1;
      return resultFixture;
    },
  });
  const defaultResult = await defaultProvider.getContext({ taskId: "agentmap-default-off" }) as import("../../../openclaw_runtime/src/runtime-core").RuntimeContextProviderResult;
  const enabledProvider = createAgentMapContextProvider({
    config: { runtime: { agentMap: { provider: true } } },
    getResult: () => {
      enabledRuns += 1;
      return resultFixture;
    },
  });
  const enabledResult = await enabledProvider.getContext({ taskId: "agentmap-enabled" }) as import("../../../openclaw_runtime/src/runtime-core").RuntimeContextProviderResult;
  const metadata = enabledResult.metadata ?? {};
  const firstItemMetadata = enabledResult.contextItems[0]?.metadata ?? {};

  const checks = {
    defaultOffSkipped: defaultRuns === 0 && defaultResult.status === "fallback",
    enabledRunsOnce: enabledRuns === 1 && enabledResult.status === "success",
    providerIdentity: metadata.providerId === AGENT_MAP_CONTEXT_PROVIDER_ID,
    shadowOnly: metadata.shadowOnly === true && firstItemMetadata.shadowOnly === true,
    noAuthority: metadata.noPromptAuthority === true &&
      metadata.noToolAuthority === true &&
      metadata.noRuntimeAuthority === true,
  };
  const passed = Object.values(checks).filter(Boolean).length;
  const decision = Object.values(checks).every(Boolean) ? "shadow-only" : "not-effective";
  return component({
    id: "agentmap-shadow",
    triggered: enabledRuns > 0,
    decision,
    effectivenessScore: score(passed, Object.keys(checks).length),
    metrics: {
      defaultRuns,
      enabledRuns,
      defaultStatus: defaultResult.status,
      enabledStatus: enabledResult.status,
      contextItemCount: enabledResult.contextItems.length,
      checks,
    },
    evidence: [
      "AgentMap provider stayed default-off without executing getResult.",
      "Explicit provider flag produced readonly shadow context items.",
      "Shadow metadata retained noPromptAuthority/noToolAuthority/noRuntimeAuthority.",
    ],
    risks: checks.noAuthority ? [] : ["AgentMap authority boundary metadata missing."],
  });
}

function createToolCallRepairStream(rawArgs: string) {
  const message = { role: "assistant", content: [{ type: "toolCall", name: "read", arguments: {} }] };
  const events = [
    {
      type: "toolcall_delta",
      contentIndex: 0,
      delta: rawArgs,
      partial: message,
      message,
    },
    {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { name: "read", arguments: {} },
      partial: message,
      message,
    },
  ];
  return {
    async result() {
      return message;
    },
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

async function evaluateTranscriptAndToolRepair(): Promise<RuntimeEffectivenessComponent> {
  const {
    repairSessionFileIfNeeded,
  } = await import("../../../openclaw_runtime/src/agents/session-file-repair");
  const {
    repairToolUseResultPairing,
  } = await import("../../../openclaw_runtime/src/agents/session-transcript-repair");
  const {
    shouldRepairMalformedToolCallArguments,
    wrapStreamFnRepairMalformedToolCallArguments,
  } = await import("../../../openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.tool-call-argument-repair");
  const malformedArgsRepairSupported = shouldRepairMalformedToolCallArguments({
    provider: "openai",
    modelApi: "openai-completions",
  });
  const baseFn = () => createToolCallRepairStream('tool.read {"path":"src/app.ts"}') as never;
  const repairedStream = wrapStreamFnRepairMalformedToolCallArguments(baseFn as never)({} as never, {} as never, {} as never) as {
    [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
    result: () => Promise<{ content?: Array<{ arguments?: { path?: string } }> }>;
  };
  for await (const _event of repairedStream) {
    // Drain stream so repair wrappers can observe deltas.
  }
  const repairedMessage = await repairedStream.result();
  const repairedArgs = repairedMessage.content?.[0]?.arguments;

  const transcriptRepair = repairToolUseResultPairing([
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "src/app.ts" } }],
    },
    { role: "user", content: "intervening user turn" },
    { role: "toolResult", toolCallId: "call_1", toolName: "read", content: "ok" },
    { role: "toolResult", toolCallId: "call_1", toolName: "read", content: "duplicate" },
    { role: "toolResult", toolCallId: "orphan", toolName: "read", content: "orphan" },
  ] as never);

  const sessionDir = await mkdtemp(path.join(tmpdir(), "runtime-effectiveness-session-repair-"));
  const sessionFile = path.join(sessionDir, "session.jsonl");
  try {
    await writeFile(
      sessionFile,
      [
        JSON.stringify({ type: "session", id: "session_runtime_effectiveness" }),
        "{ invalid json",
        JSON.stringify({ type: "message", message: { role: "assistant", content: "" } }),
      ].join("\n") + "\n",
      "utf8",
    );
    const sessionRepair = await repairSessionFileIfNeeded({ sessionFile });
    const repairedFile = await readFile(sessionFile, "utf8");
    const checks = {
      argsRepairSupported: malformedArgsRepairSupported,
      argsRepaired: repairedArgs?.path === "src/app.ts",
      syntheticOrMovedResult: transcriptRepair.moved === true && transcriptRepair.messages.length > 0,
      duplicateDropped: transcriptRepair.droppedDuplicateCount > 0,
      sessionFileRepaired: sessionRepair.repaired === true && sessionRepair.droppedLines > 0,
      cleanFilePreservedHeader: repairedFile.includes('"type":"session"'),
    };
    const passed = Object.values(checks).filter(Boolean).length;
    return component({
      id: "transcript-toolcall-repair",
      triggered: true,
      decision: decideEffective(checks),
      effectivenessScore: score(passed, Object.keys(checks).length),
      metrics: {
        repairedArgs,
        transcriptRepair: {
          moved: transcriptRepair.moved,
          addedCount: transcriptRepair.added.length,
          droppedDuplicateCount: transcriptRepair.droppedDuplicateCount,
          droppedOrphanCount: transcriptRepair.droppedOrphanCount,
        },
        sessionRepair,
        checks,
      },
      evidence: [
        "Malformed tool-call argument stream was repaired into object arguments.",
        "Transcript tool_use/tool_result pairing repair moved/dropped unsafe records.",
        "Session JSONL repair dropped invalid lines and rewrote unsafe entries.",
      ],
    });
  } catch (error) {
    return component({
      id: "transcript-toolcall-repair",
      triggered: false,
      decision: "blocked",
      effectivenessScore: 0,
      metrics: { error: error instanceof Error ? error.message : String(error) },
      risks: ["Transcript/tool-call repair evaluation could not complete."],
    });
  } finally {
    await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function joinGatewayUrl(base: string, pathname: string): string {
  const url = new URL(base);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function probeGateway(gatewayUrl: string) {
  const startedAt = performance.now();
  for (const endpoint of ["/health", "/healthz", "/ready", "/readyz"]) {
    const url = joinGatewayUrl(gatewayUrl, endpoint);
    try {
      const response = await fetchWithTimeout(url, 800);
      if (response.ok) {
        return {
          url: gatewayUrl,
          checked: true,
          available: true,
          endpoint,
          status: response.status,
          durationMs: Number((performance.now() - startedAt).toFixed(1)),
        };
      }
      if (response.status !== 404) {
        return {
          url: gatewayUrl,
          checked: true,
          available: false,
          endpoint,
          status: response.status,
          durationMs: Number((performance.now() - startedAt).toFixed(1)),
          error: `Gateway responded with HTTP ${response.status}`,
        };
      }
    } catch (error) {
      return {
        url: gatewayUrl,
        checked: true,
        available: false,
        endpoint,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return {
    url: gatewayUrl,
    checked: true,
    available: false,
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
    error: "Gateway probe returned 404 for health and readiness endpoints",
  };
}

async function liveProbe() {
  const envKeysDetected = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
  ].filter((key) => Boolean(process.env[key]));
  const override = Boolean(process.env.OPENCLAW_RUNTIME_EFFECTIVENESS_LIVE);
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL ||
    process.env.GATEWAY_URL ||
    "http://127.0.0.1:18789";
  const gateway = await probeGateway(gatewayUrl);
  const available = envKeysDetected.length > 0 || override || gateway.available;
  const reason = available
    ? [
        envKeysDetected.length > 0 ? `provider env detected: ${envKeysDetected.join(", ")}` : undefined,
        override ? "OPENCLAW_RUNTIME_EFFECTIVENESS_LIVE override enabled" : undefined,
        gateway.available ? `Gateway responded at ${gateway.endpoint}` : undefined,
      ].filter(Boolean).join("; ")
    : `live lane requested but no provider key was detected and Gateway probe failed: ${gateway.error ?? "unavailable"}; deterministic lane remains authoritative`;
  return {
    requested: true,
    available,
    reason,
    provider: { envKeysDetected, override },
    gateway,
  };
}

export function summarizeRuntimeEffectiveness(
  components: RuntimeEffectivenessComponent[],
): RuntimeEffectivenessReport["summary"] {
  return {
    componentCount: components.length,
    triggeredCount: components.filter((entry) => entry.triggered).length,
    effectiveCount: components.filter((entry) => entry.decision === "effective").length,
    neutralCount: components.filter((entry) => entry.decision === "available-but-neutral").length,
    shadowOnlyCount: components.filter((entry) => entry.decision === "shadow-only").length,
    regressionCount: components.filter((entry) => entry.decision === "not-effective").length,
  };
}

export function decideRuntimeEffectiveness(components: RuntimeEffectivenessComponent[]) {
  const blockedComponents = components
    .filter((entry) => entry.decision === "not-effective" || entry.decision === "blocked")
    .map((entry) => entry.id);
  const effectiveComponents = components.filter((entry) => entry.decision === "effective").length;
  const agentMapOk = components.find((entry) => entry.id === "agentmap-shadow")?.decision === "shadow-only";
  const nonAgentMap = components.filter((entry) => entry.id !== "agentmap-shadow");
  const allCoreEffective = nonAgentMap.every((entry) => entry.decision === "effective");
  const status = blockedComponents.length > 0
    ? "blocked"
    : allCoreEffective && agentMapOk
      ? "effective"
      : "mixed";
  return { status, effectiveComponents, blockedComponents } as const;
}

export function buildRuntimeBoundaryMatrix(): RuntimeEffectivenessReport["boundaryMatrix"] {
  return [
    {
      componentId: "codegraph",
      authority: "code-index-context",
      defaultMode: "active",
      inScope: ["code indexing", "symbol/call graph retrieval", "context candidates", "source-read decision boundary"],
      outOfScope: ["task completion decision", "prompt authority rewrite", "runtime authority rewrite"],
      acceptance: "effective only when tools register, source-read boundary holds, TS files index, target context hits, and freshness is observable",
    },
    {
      componentId: "task-mission-repair",
      authority: "workflow-quality-repair",
      defaultMode: "active",
      inScope: ["TaskLoop repair/block/complete", "MissionLoop repair tick", "quality self-check recovery"],
      outOfScope: ["provider transcript repair", "ClawGraph DAG handoff ownership", "code indexing"],
      acceptance: "effective when repair enters repair phase, recoverable tasks complete, repeated/no-budget repairs block",
    },
    {
      componentId: "clawgraph",
      authority: "workflow-dag-review",
      defaultMode: "active",
      inScope: ["workflow YAML compile", "DAG node lifecycle", "handoff JSON parse", "review/abort state"],
      outOfScope: ["TaskLoop self-check replacement", "provider transcript normalization", "AgentMap authority"],
      acceptance: "effective when compile/run/status/events/review/abort paths have evidence and invalid handoff never completes",
    },
    {
      componentId: "agentmap-shadow",
      authority: "architecture-shadow-diagnostics",
      defaultMode: "shadow-only",
      inScope: ["architecture diagnostics", "role/module relationship hints", "shadow metadata"],
      outOfScope: ["default prompt authority", "default runtime authority", "tool authority"],
      acceptance: "healthy only as shadow-only with noPromptAuthority/noRuntimeAuthority/noToolAuthority",
    },
    {
      componentId: "transcript-toolcall-repair",
      authority: "provider-safe-transcript-repair",
      defaultMode: "repair-only",
      inScope: ["malformed tool args", "orphan/duplicate/missing toolResult repair", "session JSONL corruption repair"],
      outOfScope: ["task semantic completion", "workflow repair decisions", "code context selection"],
      acceptance: "effective when unsafe transcript/tool-call inputs are repaired and clean inputs remain safe",
    },
  ];
}

export function buildRuntimeOverlapRisks(): RuntimeEffectivenessReport["overlaps"] {
  return [
    {
      components: ["codegraph", "agentmap-shadow"],
      risk: "Both can describe codebase context, which could blur prompt/context authority.",
      boundaryRule: "CodeGraph owns concrete code retrieval; AgentMap remains diagnostics-only shadow metadata.",
      status: "controlled",
    },
    {
      components: ["task-mission-repair", "clawgraph"],
      risk: "Both expose review/repair/block language around workflow failures.",
      boundaryRule: "Task/Mission repair owns quality loop decisions; ClawGraph owns DAG handoff review and node state.",
      status: "controlled",
    },
    {
      components: ["task-mission-repair", "transcript-toolcall-repair"],
      risk: "Both use repair terminology but operate at different layers.",
      boundaryRule: "Transcript repair is transport/provider safety; Task/Mission repair is semantic workflow quality.",
      status: "controlled",
    },
  ];
}

export function buildRuntimeOptimizationTargets(
  components: RuntimeEffectivenessComponent[],
): RuntimeEffectivenessReport["optimizationTargets"] {
  const byId = new Map(components.map((entry) => [entry.id, entry]));
  const codegraph = byId.get("codegraph");
  const agentMap = byId.get("agentmap-shadow");
  const liveTargetStatus = "open";
  return [
    {
      componentId: "codegraph",
      priority: "P0",
      status: codegraph?.decision === "effective" ? "passed" : "open",
      target: "Keep TypeScript grammar loading and indexedFileCount/planHitTarget under deterministic gate.",
      evidence: `decision=${codegraph?.decision ?? "missing"} score=${codegraph?.effectivenessScore ?? 0}`,
    },
    {
      componentId: "agentmap-shadow",
      priority: "P1",
      status: agentMap?.decision === "shadow-only" ? "passed" : "open",
      target: "Maintain default-off shadow diagnostics without prompt/runtime/tool authority.",
      evidence: `decision=${agentMap?.decision ?? "missing"} score=${agentMap?.effectivenessScore ?? 0}`,
    },
    {
      componentId: "live-lane",
      priority: "P2",
      status: liveTargetStatus,
      target: "Add real provider/Gateway tool-choice sampling while keeping deterministic lane authoritative.",
      evidence: "live lane currently records availability and health probe context only",
    },
  ];
}

export function buildRuntimeNotInScope(): string[] {
  return [
    "frontend UI for Runtime Effectiveness",
    "AgentMap default production authority",
    "live lane as CI hard gate",
    "TaskLoop/MissionLoop/ClawGraph control-flow refactor",
    "memory, event-log, grounding, or other runtime subsystems outside the five evaluated components",
  ];
}

export function buildRuntimeAcceptance(
  components: RuntimeEffectivenessComponent[],
): RuntimeEffectivenessReport["acceptance"] {
  const byId = new Map(components.map((entry) => [entry.id, entry]));
  const decision = decideRuntimeEffectiveness(components);
  const criteria = [
    {
      id: "aggregate-effective",
      passed: decision.status === "effective",
      details: `aggregate decision is ${decision.status}`,
    },
    {
      id: "no-blocked-components",
      passed: decision.blockedComponents.length === 0,
      details: `blockedComponents=${decision.blockedComponents.join(",") || "none"}`,
    },
    {
      id: "no-regressions",
      passed: summarizeRuntimeEffectiveness(components).regressionCount === 0,
      details: `regressionCount=${summarizeRuntimeEffectiveness(components).regressionCount}`,
    },
    {
      id: "codegraph-effective",
      passed: byId.get("codegraph")?.decision === "effective",
      details: `codegraph=${byId.get("codegraph")?.decision ?? "missing"}`,
    },
    {
      id: "agentmap-shadow-only",
      passed: byId.get("agentmap-shadow")?.decision === "shadow-only",
      details: `agentmap=${byId.get("agentmap-shadow")?.decision ?? "missing"}`,
    },
  ];
  return {
    gate: "deterministic-hard-gate",
    status: criteria.every((entry) => entry.passed) ? "passed" : "failed",
    criteria,
  };
}

export async function evaluateRuntimeEffectiveness(
  options: RuntimeEffectivenessOptions = {},
): Promise<RuntimeEffectivenessReport> {
  const startedAt = performance.now();
  const mode = options.mode ?? "deterministic";
  const components = await Promise.all([
    evaluateCodeGraph(),
    evaluateTaskAndMissionLoopRepair(),
    evaluateClawGraph(),
    evaluateAgentMapShadow(),
    evaluateTranscriptAndToolRepair(),
  ]);
  const live = options.includeLiveProbe || mode === "live" || mode === "hybrid"
    ? await liveProbe()
    : undefined;
  const effectiveMode: RuntimeEffectivenessMode = live ? "hybrid" : mode;
  return {
    generatedAt: new Date().toISOString(),
    mode: effectiveMode,
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
    decision: decideRuntimeEffectiveness(components),
    components,
    summary: summarizeRuntimeEffectiveness(components),
    boundaryMatrix: buildRuntimeBoundaryMatrix(),
    overlaps: buildRuntimeOverlapRisks(),
    optimizationTargets: buildRuntimeOptimizationTargets(components),
    notInScope: buildRuntimeNotInScope(),
    acceptance: buildRuntimeAcceptance(components),
    ...(live ? { live } : {}),
  };
}

export function renderRuntimeEffectivenessMarkdown(report: RuntimeEffectivenessReport): string {
  const rows = report.components.map((entry) => (
    `| ${entry.id} | ${entry.lane} | ${entry.triggered ? "yes" : "no"} | ${entry.decision} | ${Math.round(entry.effectivenessScore * 100)}% |`
  )).join("\n");
  const boundaryRows = report.boundaryMatrix.map((entry) => (
    `| ${entry.componentId} | ${entry.authority} | ${entry.defaultMode} | ${entry.inScope.join("; ")} | ${entry.outOfScope.join("; ")} |`
  )).join("\n");
  const overlapRows = report.overlaps.map((entry) => (
    `| ${entry.components.join(" + ")} | ${entry.status} | ${entry.risk} | ${entry.boundaryRule} |`
  )).join("\n");
  const optimizationRows = report.optimizationTargets.map((entry) => (
    `| ${entry.componentId} | ${entry.priority} | ${entry.status} | ${entry.target} | ${entry.evidence} |`
  )).join("\n");
  const acceptanceRows = report.acceptance.criteria.map((entry) => (
    `| ${entry.id} | ${entry.passed ? "pass" : "fail"} | ${entry.details} |`
  )).join("\n");
  const evidence = report.components.map((entry) => {
    const lines = entry.evidence.length
      ? entry.evidence.map((item) => `- ${item}`).join("\n")
      : "- No evidence captured.";
    const risks = entry.risks.length
      ? ["", "Risks:", ...entry.risks.map((item) => `- ${item}`)].join("\n")
      : "";
    return `### ${entry.id}\n\n${lines}${risks}`;
  }).join("\n\n");
  return `# Runtime Effectiveness Evaluation

Generated: ${report.generatedAt}

## Summary

| Metric | Value |
| --- | ---: |
| Mode | ${report.mode} |
| Duration | ${report.durationMs} ms |
| Decision | ${report.decision.status} |
| Components | ${report.summary.componentCount} |
| Triggered | ${report.summary.triggeredCount} |
| Effective | ${report.summary.effectiveCount} |
| Shadow-only | ${report.summary.shadowOnlyCount} |
| Neutral | ${report.summary.neutralCount} |
| Regressions | ${report.summary.regressionCount} |

${report.live ? `## Live Lane\n\n- Available: ${report.live.available ? "yes" : "no"}\n- Reason: ${report.live.reason ?? "n/a"}\n` : ""}
## Components

| Component | Lane | Triggered | Decision | Score |
| --- | --- | --- | --- | ---: |
${rows}

## Boundary Matrix

| Component | Authority | Default Mode | In Scope | Out Of Scope |
| --- | --- | --- | --- | --- |
${boundaryRows}

## Overlap Risks

| Components | Status | Risk | Boundary Rule |
| --- | --- | --- | --- |
${overlapRows}

## Optimization Targets

| Component | Priority | Status | Target | Evidence |
| --- | --- | --- | --- | --- |
${optimizationRows}

## Not In Scope

${report.notInScope.map((entry) => `- ${entry}`).join("\n")}

## Acceptance Status

Gate: ${report.acceptance.gate}

Status: ${report.acceptance.status}

| Criterion | Result | Details |
| --- | --- | --- |
${acceptanceRows}

## Evidence

${evidence}
`;
}
