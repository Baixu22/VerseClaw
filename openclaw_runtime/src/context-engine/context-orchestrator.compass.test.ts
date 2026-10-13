import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  computeContextExtraSystemPrompt,
  endContextOrchestratorTurn,
  finalizeContextOrchestratorTurn,
  projectStandaloneCompassContext,
} from "./context-orchestrator.js";
import {
  endTurnInjectionBudget,
  getTurnInjectionBudget,
  resetTurnInjectionBudgetsForTests,
} from "./turn-injection-budget.js";
import { collectContextCandidate, createContextCandidate } from "./context-candidate.js";
import {
  collectCompassContext,
  prepareCompassContext,
  type PreparedCompassContext,
} from "./compass-context.js";
import * as preReply from "../runtime-core/memory-pre-reply-injection.js";
import * as receipts from "./memory-injection-receipt.js";
import {
  attributeRc03SystemPromptContributions,
  recordRc03SystemPromptContribution,
  resetRc03SealPlansForTest,
} from "./rc03-seal-hook.js";

beforeEach(() => {
  vi.stubEnv("OPENCLAW_COMPASS_DISABLE", "0");
  vi.stubEnv("OPENCLAW_COMPASS_SSP", "1");
  vi.stubEnv("OPENCLAW_COMPASS_RETRIEVAL", "1");
  vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", "0");
  vi.spyOn(receipts, "recordCompassMemoryInjectionReceipt").mockReturnValue({ persisted: true });
});

afterEach(() => {
  endContextOrchestratorTurn("compass-budget");
  endTurnInjectionBudget("compass-budget");
  resetTurnInjectionBudgetsForTests();
  resetRc03SealPlansForTest();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function context(ssp = "SSP", retrieval = "FACT"): PreparedCompassContext {
  return {
    sessionKey: "test-compass",
    injection: {
      sspString: ssp,
      top5FactsString: retrieval,
      injectedFactIds: ["fact-1"],
      iFrameRefreshed: false,
    },
    candidateFactIds: ["fact-1", "fact-2"],
    appliedFactIds: [],
  };
}

it("deduplicates COMPASS before charging alongside every existing injection channel", async () => {
  const compassContext = context();
  await computeContextExtraSystemPrompt(
    "base",
    {},
    { turnId: "compass-budget", deferProjection: true, compassContext },
  );
  collectCompassContext("compass-budget", compassContext, {});
  for (const channel of [
    "working_memory",
    "tool_registry",
    "cvk_addition",
    "vtoken",
    "memory_pilot",
  ] as const) {
    collectContextCandidate(
      "compass-budget",
      createContextCandidate({
        authorityObjectId: channel,
        authorityVersion: "1",
        sourceId: channel,
        channel,
        target: "system_prompt",
        text: channel,
      }),
    );
  }
  const { projection } = finalizeContextOrchestratorTurn({
    turnId: "compass-budget",
    messages: [],
    seal: false,
  });
  expect(projection.lineage.filter((entry) => entry.reason === "duplicate")).toHaveLength(2);
  expect(projection.systemPromptAddition?.match(/SSP/g)).toHaveLength(1);
  expect(projection.systemPromptAddition?.match(/FACT/g)).toHaveLength(1);
  expect(compassContext.appliedFactIds).toEqual(["fact-1"]);
  expect(receipts.recordCompassMemoryInjectionReceipt).toHaveBeenCalledOnce();
  expect(
    projection.lineage.filter((entry) => entry.charsApplied > 0).map((entry) => entry.channel),
  ).toEqual([
    "knowledge",
    "knowledge",
    "working_memory",
    "tool_registry",
    "cvk_addition",
    "vtoken",
    "memory_pilot",
  ]);
});

it.each(["kill", "off"])(
  "%s prevents preparation queries and projection of queued candidates",
  async (mode) => {
    const cfg = mode === "kill" ? { runtime: { contextEnhancement: { killSwitch: true } } } : {};
    if (mode === "off") vi.stubEnv("OPENCLAW_COMPASS_DISABLE", "1");
    const load = vi.spyOn(preReply, "loadCompassFacts");
    const build = vi.spyOn(preReply, "buildPreReplyInjection");
    const prepared = await prepareCompassContext({
      cfg,
      sessionKey: "test",
      userInputText: "hello",
    });
    expect(load).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(prepared.context.injection.sspString).toBeUndefined();
    const queued = context();
    await computeContextExtraSystemPrompt("base", cfg, {
      turnId: "compass-budget",
      deferProjection: true,
      compassContext: queued,
    });
    const { projection } = finalizeContextOrchestratorTurn({
      turnId: "compass-budget",
      messages: [],
      seal: false,
    });
    expect(projection.systemPromptAddition).toBeUndefined();
    expect(queued.appliedFactIds).toEqual([]);
    expect(
      projection.lineage
        .filter((entry) => entry.sourceId.startsWith("compass-"))
        .every((entry) => entry.charsApplied === 0),
    ).toBe(true);
  },
);

it("does not claim complete facts when retrieval is truncated", async () => {
  const compassContext = context("SSP", "F".repeat(8000));
  await computeContextExtraSystemPrompt(
    undefined,
    {},
    { turnId: "compass-budget", deferProjection: true, compassContext },
  );
  const { projection } = finalizeContextOrchestratorTurn({
    turnId: "compass-budget",
    messages: [],
    seal: false,
  });
  expect(projection.lineage.find((entry) => entry.sourceId === "compass-retrieval")?.reason).toBe(
    "budget-truncate",
  );
  expect(compassContext.appliedFactIds).toEqual([]);
  expect(receipts.recordCompassMemoryInjectionReceipt).not.toHaveBeenCalled();
});

it("CLI uses the same budget and releases its collection before returning", () => {
  const compassContext = context("S".repeat(8000), "");
  const prompt = projectStandaloneCompassContext({
    turnId: "compass-budget",
    context: compassContext,
  });
  expect(prompt?.length).toBeGreaterThan(0);
  expect(prompt!.length).toBeLessThanOrEqual(6000);
  expect(getTurnInjectionBudget("compass-budget")).toBeUndefined();
});

it("seal attribution counts projected bytes once and retains them after a collection reopens", () => {
  vi.stubEnv("OPENCLAW_RC03_SEAL", "1");
  recordRc03SystemPromptContribution("compass-ssp", "charged SSP");
  const prompt = "base\n\ncharged SSP";
  expect(
    attributeRc03SystemPromptContributions(prompt, [
      { sourceId: "compass-ssp", text: "charged SSP" },
    ]),
  ).toEqual([{ producerId: "compass-ssp", chars: 0 }]);
  expect(attributeRc03SystemPromptContributions(prompt)).toEqual([
    { producerId: "compass-ssp", chars: "charged SSP".length },
  ]);
});

it("arbitrates oversized COMPASS output instead of forwarding it outside the turn budget", async () => {
  const input = {
    turnId: "compass-budget",
    deferProjection: true,
    compassContext: {
      sessionKey: "test-compass",
      injection: { sspString: "S".repeat(8000), iFrameRefreshed: false },
      candidateFactIds: [],
      appliedFactIds: [],
    },
  };
  const result = await computeContextExtraSystemPrompt("base", {}, input, { stages: [] });
  expect(result.extraSystemPrompt).toBe("base");
  const { projection } = finalizeContextOrchestratorTurn({
    turnId: input.turnId,
    messages: [],
    seal: false,
  });
  const ssp = projection.lineage.find((entry) => entry.sourceId === "compass-ssp");
  expect(ssp?.charsRequested).toBe(8000);
  expect(ssp?.charsApplied).toBeGreaterThan(0);
  expect(ssp?.charsApplied).toBeLessThanOrEqual(6000);
  expect(projection.systemPromptAddition?.length).toBe(ssp?.charsApplied);
});


it("#182 keeps a COMPASS-injected fact out of the memory pilot block", async () => {
  const compassContext = context("SSP", "FACT");
  // compassContext.injection.injectedFactIds === ["fact-1"]
  const memoryProviderFactory = (() => [
    {
      manifest: { id: "runtime-memory", kind: "context" },
      getContext: () => [
        {
          id: "runtime-memory:fact-1",
          kind: "memory",
          text: "fact-1 body",
          source: "runtime-memory:fact-1",
          evidenceRefs: [],
          metadata: { providerId: "runtime-memory", factId: "fact-1" },
        },
        {
          id: "runtime-memory:fact-9",
          kind: "memory",
          text: "fact-9 body",
          source: "runtime-memory:fact-9",
          evidenceRefs: [],
          metadata: { providerId: "runtime-memory", factId: "fact-9" },
        },
      ],
    },
  ]) as unknown as NonNullable<
    NonNullable<Parameters<typeof computeContextExtraSystemPrompt>[2]>["memoryProviderFactory"]
  >;
  const cfg = {
    runtime: {
      memory: {
        injectPilot: { enabled: true, providers: ["runtime-memory"], sessions: "all" },
      },
    },
  };

  const result = await computeContextExtraSystemPrompt("base", cfg, {
    turnId: "compass-budget",
    sessionKey: "agent:main:main",
    memoryProviderFactory,
    compassContext,
  });

  // fact-1 is already in the prompt from COMPASS retrieval; only fact-9 is new.
  expect(result.extraSystemPrompt).toContain("fact-9 body");
  expect(result.extraSystemPrompt).not.toContain("fact-1 body");
});