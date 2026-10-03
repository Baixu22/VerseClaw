import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTaskLoopRunsForTests,
  runTaskLoop,
  type TaskLoopControllerDeps,
} from "../../openclaw_runtime/src/agents/task-loop-controller";
import { formatTaskLoopContextPackForReviewer } from "../../openclaw_runtime/src/agents/task-loop-context";
import {
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
  createTestContextProviderRegistry,
} from "./helpers/context-provider-registry";
import {
  buildAgentMapResultFixture,
  buildBudgetedAgentMapResult,
  buildAgentMapPromptCandidateRuntimeShadowReport,
  type AgentMapPromptCandidateRuntimeShadowReport,
  type AgentMapRequest,
  type AgentMapResult,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildClawxLikeAgentMapFixtureRequest,
  readClawxLikeAgentMapFixtureFiles,
} from "../fixtures/agent-map/fixture-loader";

const ENABLED_CONFIG = {
  runtime: {
    agentMap: {
      promptAssemblyExperiment: true,
      promptCandidateRuntimeShadow: true,
    },
  },
};

type FakePlan = {
  mode: "lead-workers";
  leadRole: string;
  workers: Array<{ roleName: string; task: string }>;
  verifierRole: string;
  templateId?: string;
  reasons: string[];
};

function fakeResult(templateId = "quick-development") {
  const plan: FakePlan = {
    mode: "lead-workers",
    leadRole: "planner",
    templateId,
    verifierRole: "reviewer",
    reasons: [`template:${templateId}`],
    workers: [
      { roleName: "implementer", task: "implement" },
      { roleName: "tester", task: "test" },
      { roleName: "reviewer", task: "review" },
    ],
  };
  return {
    plan,
    outcomes: plan.workers.map((worker, index) => ({
      roleName: worker.roleName,
      task: worker.task,
      isVerifier: false,
      spawn: { status: "accepted", result: { runId: `run_${index}`, childSessionKey: `child_${index}` } },
    })),
    spawnedRunIds: ["run_0", "run_1", "run_2"],
    expectedWorkerRunIds: ["run_0", "run_1", "run_2"],
    pendingVerifier: true,
    failures: [],
  };
}

function getEvidenceRun(runId?: string, childSessionKey?: string) {
  if (!runId || !childSessionKey) return null;
  return {
    runId,
    childSessionKey,
    requesterSessionKey: "agent:main:abc",
    requesterDisplayKey: "Main",
    task: "task",
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
        "",
        "## Files Touched",
        `src/${runId}.ts`,
        "",
        "## Tests Run",
        `pnpm exec vitest run ${runId}.test.ts passed`,
        "",
        "## Decisions",
        "Kept changes scoped.",
      ].join("\n"),
    },
  };
}

afterEach(() => {
  clearTaskLoopRunsForTests();
});

async function buildClawxLikeResult(
  overrides: Partial<AgentMapRequest> = {},
): Promise<AgentMapResult> {
  return buildBudgetedAgentMapResult({
    request: buildClawxLikeAgentMapFixtureRequest({
      mentionedSymbols: ["dispatchRuntimeMessage"],
      tokenBudget: 1_200,
      ...overrides,
    }),
    files: readClawxLikeAgentMapFixtureFiles(),
    contextLines: 0,
  });
}

function replayProjection(report: AgentMapPromptCandidateRuntimeShadowReport) {
  return {
    status: report.status,
    flags: report.flags,
    candidate: {
      status: report.candidate.status,
      sourceStatus: report.candidate.sourceStatus,
      tokenBudget: report.candidate.tokenBudget,
      tokenEstimate: report.candidate.tokenEstimate,
      contentHash: report.candidate.contentHash,
      contentLength: report.candidate.contentLength,
      includedSymbolCount: report.candidate.includedSymbolCount,
      includedFileCount: report.candidate.includedFileCount,
      promptPresentExcludedCount: report.candidate.promptPresentExcludedCount,
      diagnosticCount: report.candidate.diagnosticCount,
      candidateTextStored: report.candidate.candidateTextStored,
      candidateTextInsertedIntoPrompt: report.candidate.candidateTextInsertedIntoPrompt,
    },
    diagnosticCodes: report.diagnostics.map((diagnostic) => diagnostic.code),
    diagnosticFiles: report.diagnostics.map((diagnostic) => diagnostic.file ?? ""),
    authority: report.authority,
    metadata: {
      optIn: report.metadata.optIn,
      candidateTextMeasuredOnly: report.metadata.candidateTextMeasuredOnly,
      candidateTextStored: report.metadata.candidateTextStored,
      candidateTextInsertedIntoPrompt: report.metadata.candidateTextInsertedIntoPrompt,
      promptPresentExcludedCount: report.metadata.promptPresentExcludedCount,
      includedSymbolCount: report.metadata.includedSymbolCount,
      includedFileCount: report.metadata.includedFileCount,
      tokenBudget: report.metadata.tokenBudget,
      tokenEstimate: report.metadata.tokenEstimate,
      noPromptAuthority: report.metadata.noPromptAuthority,
      noToolAuthority: report.metadata.noToolAuthority,
      noRuntimeAuthority: report.metadata.noRuntimeAuthority,
      noGatewayCutover: report.metadata.noGatewayCutover,
      noProviderTransportCutover: report.metadata.noProviderTransportCutover,
      noModelMessageCutover: report.metadata.noModelMessageCutover,
    },
  };
}

function expectNoCandidateTextStored(report: AgentMapPromptCandidateRuntimeShadowReport) {
  expect(report.candidate).not.toHaveProperty("content");
  expect(JSON.stringify(report)).not.toContain("AgentMap experimental prompt candidate");
  expect(JSON.stringify(report)).not.toContain("@@ symbol");
  expect(report.candidate.candidateTextStored).toBe(false);
  expect(report.candidate.candidateTextInsertedIntoPrompt).toBe(false);
}

async function runTaskLoopReplay(params: {
  label: string;
  cfg?: Parameters<typeof runTaskLoop>[1];
  resultProvided?: boolean;
  result?: unknown;
  tokenBudget?: number;
  promptPresentFiles?: string[];
  capturedReviewerContexts: string[];
  lifecycleReports?: AgentMapPromptCandidateRuntimeShadowReport[];
}) {
  const deps: TaskLoopControllerDeps = {
    idFactory: (prefix) => `${prefix}_${params.label}`,
    now: () => 1_700_000_000_000,
    ensureTaskLedgerRoot: vi.fn(() => `tlroot_${params.label}`),
    runObserved: (async (request: { templateId?: string; maxWorkers?: number; preferredLeadRole?: string }) => fakeResult(request.templateId)) as never,
    selfCheck: (async ({ contextPack }: { contextPack: import("../../openclaw_runtime/src/agents/task-loop-context").TaskLoopContextPack }) => {
      params.capturedReviewerContexts.push(formatTaskLoopContextPackForReviewer(contextPack));
      return {
        decision: "complete",
        confidence: 0.9,
        missingEvidence: [],
        verificationGaps: [],
        risks: [],
        validationState: { status: "passed", checks: ["unit tests"], evidenceRefs: [] },
        contextSummary: "done",
      };
    }) as never,
    getSubagentRun: getEvidenceRun as never,
    lifecycle: (event) => {
      if (event.agentMapPromptCandidateRuntimeShadowReport) {
        params.lifecycleReports?.push(event.agentMapPromptCandidateRuntimeShadowReport);
      }
    },
    recordCheckpoint: vi.fn() as never,
    storeTrace: vi.fn() as never,
    ...(params.resultProvided
      ? { agentMapPromptCandidateRuntimeShadowResult: params.result as never }
      : {}),
    ...(params.tokenBudget !== undefined
      ? { agentMapPromptCandidateRuntimeShadowTokenBudget: params.tokenBudget }
      : {}),
    ...(params.promptPresentFiles
      ? { agentMapPromptCandidateRuntimeShadowPromptPresentFiles: params.promptPresentFiles }
      : {}),
  };

  return runTaskLoop(
    { task: "implement feature", sessionKey: "agent:main:abc" },
    params.cfg,
    deps,
  );
}

describe("AgentMap prompt candidate runtime shadow replay proof", () => {
  it("replays identical pure adapter input with stable diagnostics metadata", async () => {
    const result = await buildClawxLikeResult();
    const reports = Array.from({ length: 3 }, () =>
      buildAgentMapPromptCandidateRuntimeShadowReport({
        result,
        config: ENABLED_CONFIG,
        tokenBudget: 700,
        generatedAt: 123,
        runtime: {
          source: "task_loop",
          loopRunId: "loop_replay",
          sessionKey: "agent:main:abc",
          phase: "self_check",
          status: "running",
          iteration: 1,
          contextPackHash: "context-hash",
        },
      })
    );

    expect(reports.map(replayProjection)).toEqual([
      replayProjection(reports[0]),
      replayProjection(reports[0]),
      replayProjection(reports[0]),
    ]);
    expect(reports[0].status).toBe("success");
    expect(reports[0].candidate.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(reports[0].candidate.tokenEstimate).toBeLessThanOrEqual(
      reports[0].candidate.tokenBudget,
    );
    expect(reports[0].authority).toMatchObject({
      noPromptCutover: true,
      noPromptAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
      noGatewayCutover: true,
      noProviderTransportCutover: true,
      noModelMessageCutover: true,
      taskLoopDecisionUnaffected: true,
    });
    for (const report of reports) {
      expectNoCandidateTextStored(report);
    }
  });

  it("keeps budget variants diagnostics-only and bounded", async () => {
    const result = await buildClawxLikeResult();
    const budgets = [0, 1, 520, 1_000] as const;
    const reports = budgets.map((tokenBudget) =>
      buildAgentMapPromptCandidateRuntimeShadowReport({
        result,
        config: ENABLED_CONFIG,
        tokenBudget,
        runtime: { source: "runtime" },
      })
    );
    const [zero, tooSmall, medium, full] = reports;

    expect(zero.status).toBe("budget_exhausted");
    expect(tooSmall.status).toBe("budget_exhausted");
    expect(medium.candidate.tokenEstimate).toBeLessThanOrEqual(medium.candidate.tokenBudget);
    expect(full.candidate.tokenEstimate).toBeLessThanOrEqual(full.candidate.tokenBudget);
    expect(medium.candidate.includedSymbolCount).toBeLessThanOrEqual(
      full.candidate.includedSymbolCount,
    );
    expect(reports.map((report) => report.authority.noPromptAuthority)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    for (const report of reports) {
      expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        report.status === "success" ? "candidate_measured" : "candidate_budget_exhausted",
      );
      expectNoCandidateTextStored(report);
    }
  });

  it("replays prompt-present exclusions as stable diagnostics only", async () => {
    const result = await buildClawxLikeResult({
      promptPresentFiles: [],
      tokenBudget: 1_500,
    });
    const promptPresentFiles = ["src/pages/Chat/Composer.tsx"];
    const first = buildAgentMapPromptCandidateRuntimeShadowReport({
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 900,
      promptPresentFiles,
      runtime: { source: "runtime" },
    });
    const second = buildAgentMapPromptCandidateRuntimeShadowReport({
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 900,
      promptPresentFiles,
      runtime: { source: "runtime" },
    });

    expect(replayProjection(second)).toEqual(replayProjection(first));
    expect(first.candidate.promptPresentExcludedCount).toBeGreaterThan(0);
    expect(first.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "prompt_present_file_excluded",
        file: "src/pages/Chat/Composer.tsx",
      }),
    ]));
    expect(first.authority).toMatchObject({
      noPromptAuthority: true,
      noRuntimeAuthority: true,
      legacyPromptAuthoritative: true,
    });
    expectNoCandidateTextStored(first);
  });

  it("does not emit TaskLoop reports without both flags and explicit valid AgentMap input", async () => {
    const agentMapResult = buildAgentMapResultFixture();
    const cases = [
      {
        label: "no_flags",
        cfg: {},
        resultProvided: true,
        result: agentMapResult,
      },
      {
        label: "assembly_only",
        cfg: { runtime: { agentMap: { promptAssemblyExperiment: true } } },
        resultProvided: true,
        result: agentMapResult,
      },
      {
        label: "shadow_only",
        cfg: { runtime: { agentMap: { promptCandidateRuntimeShadow: true } } },
        resultProvided: true,
        result: agentMapResult,
      },
      {
        label: "missing_result",
        cfg: ENABLED_CONFIG,
        resultProvided: false,
      },
      {
        label: "invalid_result",
        cfg: ENABLED_CONFIG,
        resultProvided: true,
        result: { schemaVersion: 1, readonly: true },
      },
    ];

    for (const item of cases) {
      const capturedReviewerContexts: string[] = [];
      const run = await runTaskLoopReplay({
        ...item,
        capturedReviewerContexts,
      });
      expect(run.agentMapPromptCandidateRuntimeShadowReport).toBeUndefined();
      expect(run.iterations.at(-1)?.agentMapPromptCandidateRuntimeShadowReport).toBeUndefined();
      expect(capturedReviewerContexts).toHaveLength(1);
      expect(capturedReviewerContexts[0]).not.toContain("AgentMap experimental prompt candidate");
      expect(capturedReviewerContexts[0]).not.toContain("@@ symbol");
    }
  });

  it("replays TaskLoop reports without changing reviewer prompt text or provider defaults", async () => {
    const agentMapResult = buildAgentMapResultFixture();
    const capturedReviewerContexts: string[] = [];
    const lifecycleReports: AgentMapPromptCandidateRuntimeShadowReport[] = [];
    const defaultOff = await runTaskLoopReplay({
      label: "prompt_parity",
      cfg: {},
      resultProvided: true,
      result: agentMapResult,
      tokenBudget: 500,
      capturedReviewerContexts,
      lifecycleReports,
    });
    const first = await runTaskLoopReplay({
      label: "prompt_parity",
      cfg: ENABLED_CONFIG,
      resultProvided: true,
      result: agentMapResult,
      tokenBudget: 500,
      capturedReviewerContexts,
      lifecycleReports,
    });
    const second = await runTaskLoopReplay({
      label: "prompt_parity",
      cfg: ENABLED_CONFIG,
      resultProvided: true,
      result: agentMapResult,
      tokenBudget: 500,
      capturedReviewerContexts,
      lifecycleReports,
    });

    expect(defaultOff.agentMapPromptCandidateRuntimeShadowReport).toBeUndefined();
    const firstReport = first.agentMapPromptCandidateRuntimeShadowReport;
    const secondReport = second.agentMapPromptCandidateRuntimeShadowReport;
    expect(firstReport).toBeDefined();
    expect(secondReport).toBeDefined();
    if (!firstReport || !secondReport) {
      throw new Error("Expected enabled TaskLoop replay reports.");
    }
    expect(replayProjection(secondReport)).toEqual(replayProjection(firstReport));
    expect(first.iterations.at(-1)?.agentMapPromptCandidateRuntimeShadowReport)
      .toBe(firstReport);
    expect(second.iterations.at(-1)?.agentMapPromptCandidateRuntimeShadowReport)
      .toBe(secondReport);
    expect(lifecycleReports.map(replayProjection)).toContainEqual(replayProjection(firstReport));
    expect(capturedReviewerContexts).toHaveLength(3);
    expect(capturedReviewerContexts[1]).toBe(capturedReviewerContexts[0]);
    expect(capturedReviewerContexts[2]).toBe(capturedReviewerContexts[0]);
    for (const context of capturedReviewerContexts) {
      expect(context).not.toContain("AgentMap experimental prompt candidate");
      expect(context).not.toContain("@@ symbol");
      expect(context).not.toContain("sendMessage(input: ChatInput)");
    }

    expect(createTestContextProviderRegistry().listManifests().map((manifest) => manifest.id))
      .toEqual([
        LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
        LOOP_CONTEXT_PACK_PROVIDER_ID,
      ]);
    expectNoCandidateTextStored(firstReport);
    expectNoCandidateTextStored(secondReport);
  });
});
