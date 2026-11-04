// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  composePostOrchestratorPrompt,
  createTrackedSystemPromptSetter,
  collectContextOrchestratorCandidate,
  computeContextExtraSystemPrompt,
  finalizeContextOrchestratorTurn,
  getLastContextOrchestratorLineage,
  recordPostOrchestratorMessageChange,
  resetContextOrchestratorLineageForTests,
} from "../../openclaw_runtime/src/context-engine/context-orchestrator";
import {
  getContextFinalSnapshot,
  resetContextFinalSnapshotsForTests,
} from "../../openclaw_runtime/src/context-engine/context-final-snapshot";
import { resetContextCandidateCollectionsForTests } from "../../openclaw_runtime/src/context-engine/context-candidate";
import {
  beginTurnInjectionBudget,
  getTurnInjectionBudget,
  summarizeTurnInjection,
  resetTurnInjectionBudgetsForTests,
} from "../../openclaw_runtime/src/context-engine/turn-injection-budget";

beforeEach(() => {
  vi.stubEnv("OPENCLAW_STATE_DIR", "D:/tmp/tf0738-state");
});

afterEach(() => {
  resetContextOrchestratorLineageForTests();
  resetContextFinalSnapshotsForTests();
  resetContextCandidateCollectionsForTests();
  resetTurnInjectionBudgetsForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function setup(turnId = "budget-turn") {
  const composed = composePostOrchestratorPrompt({
    turnId,
    basePrompt: "extra base",
    additions: [
      { sourceId: "runtime-intensity", text: "runtime instructions" },
      { sourceId: "dcs-degradation", text: "degradation notice" },
    ],
  });
  let prompt = `CORE BASE\n\n${composed.prompt}`;
  const setPrompt = createTrackedSystemPromptSetter({
    turnId,
    basePrompt: prompt,
    apply: (next) => {
      prompt = next;
    },
  });
  setPrompt(prompt);
  setPrompt(`${prompt}\n\nthird hook addition`);
  return { turnId, composed, setPrompt, prompt: () => prompt };
}

function collect(
  turnId: string,
  sourceId: string,
  target: "system_prompt" | "message",
  text: string,
) {
  collectContextOrchestratorCandidate(
    turnId,
    {
      authorityObjectId: sourceId,
      authorityVersion: "1",
      sourceId,
      channel: "knowledge",
      target,
      text,
    },
    {
      mode: "enforce",
      declaration: {
        source: sourceId,
        authority: [target === "system_prompt" ? "append_instruction" : "append_data"],
        scope: [target],
        reason: "Fixture context producer admission",
      },
    },
  );
}

function finalize(turnId: string, systemPrompt: string, modelCallIndex = 0) {
  return finalizeContextOrchestratorTurn({
    turnId,
    messages: [],
    systemPrompt,
    runId: "budget-run",
    modelCallIndex,
  });
}

describe("TF-0738 observed prompt accounting", () => {
  it("records eight real API observations and a missing-accounting negative control", () => {
    const observations = [];
    for (let index = 0; index < 8; index++) {
      const state = setup(`observed-${index}`);
      collect(state.turnId, `managed-${index}`, "system_prompt", "m".repeat(1 + index * 1000));
      const prepared = finalizeContextOrchestratorTurn({
        turnId: state.turnId,
        messages: [],
        seal: false,
      });
      const prompt = `${state.prompt()}\n\n${prepared.projection.systemPromptAddition}`;
      finalize(state.turnId, prompt, index);
      const snapshot = getContextFinalSnapshot("budget-run", 0, index)!;
      expect(snapshot.budgetCoverage.unaccountedChars).toBe(0);
      expect(snapshot.budgetCoverage.overaccountedChars).toBe(0);
      expect(snapshot.budgetCoverage.unbudgeted).toBe(false);
      expect(snapshot.budgetCoverage.totalPromptChars).toBe(prompt.length);
      observations.push({
        turnId: state.turnId,
        modelCallIndex: index,
        budget: snapshot.budget,
        coverage: snapshot.budgetCoverage,
        providerRequestDigest: snapshot.providerRequestDigest,
      });
    }
    const finalState = observations.at(-1)!;
    const unknown = "\n\nUNREGISTERED EXTRA";
    const retained = getContextFinalSnapshot("budget-run", 0, 7)!;
    // The same observed turn continues with actual larger prompt bytes, without
    // adding an accounting record. A self-derived total would incorrectly stay green.
    const state = setup("negative-control");
    collect(state.turnId, "negative-managed", "system_prompt", "known");
    const prepared = finalizeContextOrchestratorTurn({
      turnId: state.turnId,
      messages: [],
      seal: false,
    });
    const prompt = `${state.prompt()}\n\n${prepared.projection.systemPromptAddition}`;
    finalize(state.turnId, prompt, 8);
    finalize(state.turnId, prompt + unknown, 9);
    const negative = getContextFinalSnapshot("budget-run", 0, 9)!;
    expect(negative.budgetCoverage.unaccountedChars).toBe(unknown.length);
    expect(getContextFinalSnapshot("budget-run", 0, 7)).toEqual(retained);
    expect(finalState.budget.total).toBe(6000);
    if (process.env.PROMPT_BUDGET_TRACE_PATH) {
      writeFileSync(
        process.env.PROMPT_BUDGET_TRACE_PATH,
        JSON.stringify(
          {
            schema: "PromptBudgetObservations/v1",
            driven_by: "agent",
            actor: "codex/prompt-budget",
            scope: "Deterministic real composer/setter/finalizer API calls; no provider request",
            observations,
            negativeControl: {
              coverage: negative.budgetCoverage,
              expectedUnknownChars: unknown.length,
            },
          },
          null,
          2,
        ) + "\n",
      );
    }
  });
  it("uses the tested composer/setter on the production embedded path", () => {
    const source = readFileSync(
      "openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts",
      "utf8",
    );
    expect(source).toContain("const effectiveExtraSystemPrompt = composePostOrchestratorPrompt({");
    expect(source).toContain(
      "const setActiveSessionSystemPrompt = createTrackedSystemPromptSetter({",
    );
    expect(source).toContain("basePrompt: attemptSystemPrompt.baseSystemPrompt");
    expect(
      source.match(
        /recordPostOrchestratorMessageChange\(injectionTurnId, before, effectivePrompt\)/g,
      ),
    ).toHaveLength(2);
  });
  it("accounts three post-orchestrator pieces while preserving the 6000 managed ceiling", () => {
    const state = setup();
    collect(state.turnId, "managed-system", "system_prompt", "m".repeat(7000));
    const prepared = finalizeContextOrchestratorTurn({
      turnId: state.turnId,
      messages: [],
      seal: false,
    });
    const actualPrompt = `${state.prompt()}\n\n${prepared.projection.systemPromptAddition}`;
    finalize(state.turnId, actualPrompt);
    const snapshot = getContextFinalSnapshot("budget-run", 0, 0)!;
    expect(snapshot.budget.total).toBe(6000);
    expect(snapshot.budget.charsApplied).toBe(6000);
    expect(snapshot.budgetCoverage).toMatchObject({
      managedChars: 6000,
      totalPromptChars: actualPrompt.length,
      unaccountedChars: 0,
      overaccountedChars: 0,
      unbudgeted: false,
    });
    expect(snapshot.budgetCoverage.postOrchestratorChars).toBe(
      state.composed.postOrchestratorChars + "\n\nthird hook addition".length + 2,
    );
    expect(snapshot.budgetCoverage.totalPromptChars).toBeGreaterThan(snapshot.budget.total);
    expect(
      (snapshot.budgetCoverage.managedChars + snapshot.budgetCoverage.postOrchestratorChars) /
        (snapshot.budgetCoverage.totalPromptChars - snapshot.budgetCoverage.basePromptChars),
    ).toBe(1);
  });

  it("uses the final prompt observation to expose a late unregistered addition", () => {
    const state = setup();
    collect(state.turnId, "managed-system", "system_prompt", "managed");
    const projection = finalizeContextOrchestratorTurn({
      turnId: state.turnId,
      messages: [],
      seal: false,
    }).projection;
    const prompt = `${state.prompt()}\n\n${projection.systemPromptAddition}`;
    finalize(state.turnId, prompt);
    const unknown = "\n\nUNREGISTERED";
    finalize(state.turnId, prompt + unknown, 1);
    expect(getContextFinalSnapshot("budget-run", 0, 1)?.budgetCoverage.unaccountedChars).toBe(
      unknown.length,
    );
  });

  it("does not charge repeated composition or cached finalization twice", () => {
    const state = setup();
    const before = summarizeTurnInjection(getTurnInjectionBudget(state.turnId)!);
    composePostOrchestratorPrompt({
      turnId: state.turnId,
      basePrompt: "extra base",
      additions: [
        { sourceId: "runtime-intensity", text: "runtime instructions" },
        { sourceId: "dcs-degradation", text: "degradation notice" },
      ],
    });
    expect(summarizeTurnInjection(getTurnInjectionBudget(state.turnId)!)).toEqual(before);
    collect(state.turnId, "managed-system", "system_prompt", "managed");
    const projection = finalizeContextOrchestratorTurn({
      turnId: state.turnId,
      messages: [],
      seal: false,
    }).projection;
    const actualPrompt = `${state.prompt()}\n\n${projection.systemPromptAddition}`;
    finalize(state.turnId, actualPrompt);
    const first = getContextFinalSnapshot("budget-run", 0, 0);
    finalize(state.turnId, actualPrompt);
    expect(getContextFinalSnapshot("budget-run", 0, 0)).toEqual(first);
  });

  it("retires overwritten base/post attribution when a hook replaces the whole base component", () => {
    const state = setup();
    state.setPrompt("replacement base");
    collect(state.turnId, "managed-system", "system_prompt", "managed");
    const projection = finalizeContextOrchestratorTurn({
      turnId: state.turnId,
      messages: [],
      seal: false,
    }).projection;
    const prompt = `${state.prompt()}\n\n${projection.systemPromptAddition}`;
    finalize(state.turnId, prompt);
    const coverage = getContextFinalSnapshot("budget-run", 0, 0)!.budgetCoverage;
    expect(coverage).toMatchObject({
      basePromptChars: 0,
      managedChars: 7,
      postOrchestratorChars: "replacement base".length + 2,
      unaccountedChars: 0,
      overaccountedChars: 0,
    });
  });

  it("accounts managed messages and hook data without treating ordinary history as injected text", () => {
    const state = setup();
    collect(state.turnId, "managed-message", "message", "managed data");
    const before = "user request";
    const after = `hook data\n\n${before}`;
    recordPostOrchestratorMessageChange(state.turnId, before, after);
    finalize(state.turnId, state.prompt());
    const snapshot = getContextFinalSnapshot("budget-run", 0, 0)!;
    expect(snapshot.budgetCoverage).toMatchObject({
      managedChars: "managed data".length,
      totalPromptChars:
        state.prompt().length + "managed data".length + after.length - before.length,
      unaccountedChars: 0,
      overaccountedChars: 0,
      unbudgeted: false,
    });
    expect(snapshot.budget.byChannel.knowledge?.applied).toBe("managed data".length);
  });

  it("accounts a provider rewrite using the actual successful setter output", () => {
    const turnId = "provider-transform";
    composePostOrchestratorPrompt({
      turnId,
      additions: [{ sourceId: "runtime-intensity", text: "old instructions" }],
    });
    let prompt = "CORE\n\nold instructions";
    const set = createTrackedSystemPromptSetter({
      turnId,
      basePrompt: prompt,
      apply: (next) => {
        prompt = next;
      },
    });
    set("provider rewritten prompt");
    finalize(turnId, prompt);
    expect(getContextFinalSnapshot("budget-run", 0, 0)?.budgetCoverage).toMatchObject({
      basePromptChars: 0,
      postOrchestratorChars: prompt.length,
      unaccountedChars: 0,
      overaccountedChars: 0,
      unbudgeted: false,
    });
  });

  it("leaves raw-run diagnostic text constructed but records no unapplied system contribution", () => {
    const turnId = "raw";
    const composed = composePostOrchestratorPrompt({
      turnId,
      additions: [{ sourceId: "runtime-intensity", text: "diagnostic text" }],
      applied: false,
    });
    const set = createTrackedSystemPromptSetter({
      turnId,
      basePrompt: composed.prompt,
      apply: () => {},
    });
    set("");
    finalize(turnId, "");
    expect(composed.prompt).toBe("diagnostic text");
    expect(getContextFinalSnapshot("budget-run", 0, 0)?.budgetCoverage).toMatchObject({
      totalPromptChars: 0,
      postOrchestratorChars: 0,
      unaccountedChars: 0,
      overaccountedChars: 0,
      unbudgeted: false,
    });
  });

  it("marks no-turnId paths in both returned and retained diagnostics", async () => {
    const composed = composePostOrchestratorPrompt({
      basePrompt: "base",
      additions: [{ sourceId: "post", text: "extra" }],
    });
    expect(composed).toMatchObject({ unbudgeted: true, prompt: "base\n\nextra" });
    const result = await computeContextExtraSystemPrompt("base", {}, {}, { stages: [] });
    expect(result.lineage.unbudgeted).toBe(true);
    expect(getLastContextOrchestratorLineage()?.unbudgeted).toBe(true);
    expect(getTurnInjectionBudget("")).toBeUndefined();
  });

  it("does not pretend a snapshot without a baseline observation has complete budgeting", () => {
    beginTurnInjectionBudget({ turnId: "unwired" });
    finalize("unwired", "untracked system prompt");
    expect(getContextFinalSnapshot("budget-run", 0, 0)?.budgetCoverage).toMatchObject({
      unbudgeted: true,
      unaccountedChars: "untracked system prompt".length,
    });
  });

  it("does not count a setter operation that failed to apply", () => {
    const set = createTrackedSystemPromptSetter({
      turnId: "failed",
      basePrompt: "base",
      apply: () => {
        throw new Error("apply failed");
      },
    });
    const before = summarizeTurnInjection(getTurnInjectionBudget("failed")!);
    expect(() => set("different prompt")).toThrow("apply failed");
    expect(summarizeTurnInjection(getTurnInjectionBudget("failed")!)).toEqual(before);
  });

  it("keeps recorded snapshots immutable as the ledger changes for the next model call", () => {
    const state = setup();
    finalize(state.turnId, state.prompt());
    const first = getContextFinalSnapshot("budget-run", 0, 0)!;
    state.setPrompt(`${state.prompt()}\n\nnext call`);
    finalize(state.turnId, state.prompt(), 1);
    expect(getContextFinalSnapshot("budget-run", 0, 0)).toEqual(first);
    const next = getContextFinalSnapshot("budget-run", 0, 1)!;
    expect(next.budgetCoverage.postOrchestratorChars).toBeGreaterThan(
      first.budgetCoverage.postOrchestratorChars,
    );
  });

  it.each(["", " ", "base"])("preserves the existing filtered join for base %j", (basePrompt) => {
    const additions = [undefined, "", " ", "a", "b"];
    const expected = [basePrompt, ...additions]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join("\n\n");
    const result = composePostOrchestratorPrompt({
      basePrompt,
      additions: additions.map((text, i) => ({ sourceId: String(i), text })),
    });
    expect(result.prompt).toBe(expected);
  });
});
