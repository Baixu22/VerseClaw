// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSealMutation,
  getSealCoverageMatrix,
  registerSealProducer,
  resetSealRegistryForTests,
  SealMutationError,
} from "../../openclaw_runtime/src/context-engine/seal-registry";
import { registerRc03SealProducers } from "../../openclaw_runtime/src/context-engine/rc03-producers";
import {
  appliedProducerIdsFromLineage,
  getRc03SealPlan,
  resetRc03SealPlansForTest,
  runRc03SealHook,
  nextRc03ModelCallIndex,
  releaseRc03Run,
} from "../../openclaw_runtime/src/context-engine/rc03-seal-hook";
import {
  finalizeContextOrchestratorTurn,
  computeContextExtraSystemPrompt,
  resetContextOrchestratorLineageForTests,
} from "../../openclaw_runtime/src/context-engine/context-orchestrator";
import {
  resetContextCandidateCollectionsForTests,
  type ContextCandidateProjection,
} from "../../openclaw_runtime/src/context-engine/context-candidate";
import {
  getContextFinalSnapshot,
  resetContextFinalSnapshotsForTests,
} from "../../openclaw_runtime/src/context-engine/context-final-snapshot";
import { resetTurnInjectionBudgetsForTests } from "../../openclaw_runtime/src/context-engine/turn-injection-budget";
import { ReceiptStore } from "../../openclaw_runtime/src/agents/receipt-store";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { resolveEmbeddedAgentStreamFn } from "../../openclaw_runtime/src/agents/embedded-agent-runner/stream-resolution";
import { SYSTEM_PROMPT_CACHE_BOUNDARY } from "../../openclaw_runtime/src/agents/system-prompt-cache-boundary";
import { SUMMARIZATION_SYSTEM_PROMPT } from "../../openclaw_runtime/packages/agent-core/src/harness/compaction/compaction";
import { ExtensionRunner } from "../../openclaw_runtime/src/agents/sessions/extensions/runner";
import { buildEmbeddedExtensionFactories } from "../../openclaw_runtime/src/agents/embedded-agent-runner/extensions";

let stateRoot: string;
beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), "tf0739-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", stateRoot);
  vi.stubEnv("OPENCLAW_CONFIG_PATH", join(stateRoot, "openclaw.json"));
  vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", "");
  vi.stubEnv("OPENCLAW_RC03_SEAL", "");
  vi.stubEnv("OPENCLAW_RC02_SHADOW_CENSUS", "");
  resetSealRegistryForTests();
  registerRc03SealProducers();
});
afterEach(() => {
  closeOpenClawStateDatabase();
  resetSealRegistryForTests();
  resetRc03SealPlansForTest();
  resetContextOrchestratorLineageForTests();
  resetContextCandidateCollectionsForTests();
  resetContextFinalSnapshotsForTests();
  resetTurnInjectionBudgetsForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(stateRoot, { recursive: true, force: true });
});

function projection(
  sourceId: string,
  target: "system_prompt" | "message" = "system_prompt",
  charsApplied = 7,
): ContextCandidateProjection {
  return {
    messages: [],
    systemPromptAddition: "payload",
    lineage: [
      {
        sourceId,
        target,
        candidateId: `candidate:${sourceId}`,
        dedupKey: `dedup:${sourceId}`,
        channel: "knowledge",
        disposition: charsApplied ? "applied" : "drop",
        reason: charsApplied ? "applied" : "budget-drop",
        charsRequested: 7,
        charsApplied,
      },
    ],
  };
}
const seal = (sourceId = "compass-ssp", options = {}) =>
  runRc03SealHook(projection(sourceId), [], {
    enabled: true,
    runId: "seal-run",
    systemPrompt: "base prompt",
    ...options,
  });

describe("TF-0739 RC-03 executable coverage", () => {
  it("seals the live context prompt even when no before-agent-start event ran", async () => {
    const cfg = { runtime: { rc03: { seal: true } } };
    const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
    const factories = buildEmbeddedExtensionFactories({
      cfg,
      sessionManager: {} as never,
      provider: "fixture",
      modelId: "fixture",
      model: undefined,
      sessionId: "factory-session",
      sessionKey: "agent:main:factory",
      runId: "factory-run",
      injectionTurnId: "factory-turn",
    } as never);
    const agent = {
      on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      },
    };
    for (const factory of factories) await factory(agent as never);
    for (const handler of handlers.get("context") ?? [])
      await handler({ messages: [] }, { getSystemPrompt: () => "current continuation prompt" });
    const inner = vi.fn((_m: unknown, _c: unknown) => ({}) as never);
    const wrapped = resolveEmbeddedAgentStreamFn({
      cfg,
      currentStreamFn: undefined,
      providerStreamFn: inner,
      sessionId: "factory-session",
      runId: "factory-run",
      model: { provider: "fixture", api: "fixture", id: "fixture" } as never,
    });
    wrapped(
      { provider: "fixture" } as never,
      { systemPrompt: "current continuation prompt", messages: [] } as never,
    );
    expect(inner).toHaveBeenCalledTimes(1);
    expect(getContextFinalSnapshot("factory-run", 0, 0)?.sealCoverage).toBe("enforced");
  });
  it("propagates seal denial through the real extension runner while ordinary optional failures remain open", async () => {
    const runnerFor = (error: Error) =>
      new ExtensionRunner(
        [
          {
            path: "fixture",
            handlers: new Map([
              [
                "context",
                [
                  () => {
                    throw error;
                  },
                ],
              ],
            ]),
          },
        ] as never,
        {} as never,
        stateRoot,
        {} as never,
        {} as never,
      );
    await expect(
      runnerFor(new SealMutationError("fixture", "pre-seal", "unregistered")).emitContext([]),
    ).rejects.toThrow(/unregistered/);
    await expect(runnerFor(new Error("optional read failed")).emitContext([])).resolves.toEqual([]);
  });
  it("covers every registered producer in its legal phase and rejects the opposite phase", () => {
    const matrix = getSealCoverageMatrix();
    expect(matrix).toHaveLength(18);
    const observations = matrix.map((row) => {
      expect(() => assertSealMutation(row.id, row.phase)).not.toThrow();
      expect(() =>
        assertSealMutation(row.id, row.phase === "pre-seal" ? "post-seal" : "pre-seal"),
      ).toThrow(/wrong-phase/);
      return { ...row, verdict: "pass", driven_by: "agent" };
    });
    expect(Object.isFrozen(matrix)).toBe(true);
    const copy = { ...observations[0]! };
    expect(() => {
      copy.id = "local-copy";
    }).not.toThrow();
    expect(observations[0]!.id).toBe(matrix[0]!.id);
    if (process.env.RC03_COVERAGE_TRACE_PATH) {
      writeFileSync(
        process.env.RC03_COVERAGE_TRACE_PATH,
        JSON.stringify(
          { driven_by: "agent", actor: "codex/context-prompt-owner", observations },
          null,
          2,
        ),
      );
    }
  });

  it.each([
    ["compass-ssp", "compass-ssp"],
    ["compass-retrieval", "compass-retrieval"],
    ["memory-inject-pilot:runtime-memory", "memory-pilot-injection"],
    ["vtoken-assembly", "vtoken-packer"],
    ["session-start:restore", "session-start-injection"],
    ["cvk-context-engine", "cvk-system-prompt-addition"],
    ["cvk-message-replacement", "cvk-message-replacement"],
    ["context-block:cvk:tool_registry", "dcs-tool-registry"],
    ["context-block:compass:knowledge", "dcs-knowledge"],
    ["context-block:working-memory:working_memory", "dcs-working-memory"],
    ["dcs-knowledge", "dcs-knowledge"],
    ["role_memory", "role-memory-injection"],
  ])("admits actual source %s as %s", (sourceId, producerId) => {
    expect(appliedProducerIdsFromLineage(projection(sourceId))).toEqual([producerId]);
    const result = seal(sourceId);
    expect(result.sealCoverage).toBe("enforced");
    expect(result.unregisteredProducers).toEqual([]);
    expect(result.plan?.preSealProducers).toContainEqual({
      producerId,
      producerVersion: "1",
      applied: true,
    });
  });

  it("rejects unknown system-prompt sources even when supplied ids or a boundary try to hide lineage", () => {
    for (const options of [
      {},
      { appliedProducerIds: [] },
      { boundaryProducer: { id: "compaction-summarizer", chars: 7 } },
    ]) {
      expect(() => seal("plugin:unregistered", options)).toThrow(/unregistered/);
    }
    expect(getRc03SealPlan("seal-run")).toBeUndefined();
    expect(new ReceiptStore().list({ runId: "seal-run" })).toHaveLength(0);
  });

  it("admits a declared custom semantic producer through the same registry and plan", () => {
    registerSealProducer({
      id: "plugin:declared",
      kind: "semantic",
      mutates: "system_prompt",
      version: "1",
      purpose: "Declared plugin instructions",
    });
    expect(seal("plugin:declared").plan?.preSealProducers).toContainEqual({
      producerId: "plugin:declared",
      producerVersion: "1",
      applied: true,
    });
  });

  it("does not treat dropped unknown sources as applied mutations", () => {
    expect(
      runRc03SealHook(projection("plugin:dropped", "message", 0), [], { enabled: true })
        .sealCoverage,
    ).toBe("enforced");
  });

  it("rejects duplicate registration and keeps registration facts immutable", () => {
    const row = getSealCoverageMatrix().find((row) => row.id === "compass-ssp")!;
    expect(() => registerSealProducer(row)).toThrow(/already registered/);
    const declaration = {
      id: "declared",
      kind: "semantic" as const,
      mutates: "messages" as const,
      version: "1",
      purpose: "test",
    };
    registerSealProducer(declaration);
    declaration.id = "tampered";
    expect(() => assertSealMutation("declared", "pre-seal")).not.toThrow();
    expect(() => assertSealMutation("declared", "post-seal")).toThrow(/wrong-phase/);
  });

  it("reports disabled coverage and no RC-03 plan/receipt while the flag is off", () => {
    expect(runRc03SealHook(projection("plugin:unknown"), [], { enabled: false })).toMatchObject({
      sealCoverage: "disabled",
      engaged: false,
      bundleSealed: false,
    });
    finalizeContextOrchestratorTurn({
      turnId: "off-turn",
      runId: "off-run",
      messages: [],
      systemPrompt: "base prompt",
    });
    expect(getContextFinalSnapshot("off-run", 0, 0)).toMatchObject({ sealCoverage: "disabled" });
    expect(getRc03SealPlan("off-run")).toBeUndefined();
    expect(new ReceiptStore().list({ runId: "off-run" })).toHaveLength(0);
  });

  it.each(["changed prompt", `base prompt${SYSTEM_PROMPT_CACHE_BOUNDARY}new instructions`])(
    "rejects post-seal semantic prompt %s before calling the provider",
    (systemPrompt) => {
      seal();
      const inner = vi.fn((_model: unknown, _context: unknown) => ({}) as never);
      const wrapped = resolveEmbeddedAgentStreamFn({
        currentStreamFn: undefined,
        providerStreamFn: inner,
        sessionId: "guard-session",
        runId: "seal-run",
        model: { provider: "fixture", api: "fixture", id: "fixture" } as never,
      });
      expect(() =>
        wrapped({ provider: "fixture" } as never, { systemPrompt, messages: [] } as never),
      ).toThrow(/content-changed/);
      expect(inner).not.toHaveBeenCalled();
    },
  );

  it("permits the registered cache marker removal and keeps the stored plan detached from callers", () => {
    const systemPrompt = `base${SYSTEM_PROMPT_CACHE_BOUNDARY}prompt`;
    seal("compass-ssp", { systemPrompt });
    const plan = getRc03SealPlan("seal-run")!;
    plan.postSealTransformIds.push("compass-ssp");
    expect(getRc03SealPlan("seal-run")!.postSealTransformIds).not.toContain("compass-ssp");
    const inner = vi.fn((_model: unknown, _context: unknown) => ({}) as never);
    const wrapped = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn: inner,
      sessionId: "guard-session",
      runId: "seal-run",
      model: { provider: "fixture", api: "fixture", id: "fixture" } as never,
    });
    wrapped({ provider: "fixture" } as never, { systemPrompt, messages: [] } as never);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner.mock.calls[0]?.[1]).toMatchObject({ systemPrompt: "base\nprompt" });
  });

  it.each([false, true])(
    "keeps repeated denial closed with shadow census=%s and permits a repaired call",
    (shadow) => {
      vi.stubEnv("OPENCLAW_RC02_SHADOW_CENSUS", shadow ? "1" : "");
      seal();
      const inner = vi.fn((_m: unknown, _c: unknown) => ({}) as never);
      const wrapped = resolveEmbeddedAgentStreamFn({
        currentStreamFn: undefined,
        providerStreamFn: inner,
        sessionId: "guard-session",
        runId: "seal-run",
        model: { provider: "fixture", api: "fixture", id: "fixture" } as never,
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() =>
          wrapped(
            { provider: "fixture" } as never,
            { systemPrompt: "injected", messages: [] } as never,
          ),
        ).toThrow(/content-changed/);
      }
      expect(inner).not.toHaveBeenCalled();
      wrapped(
        { provider: "fixture" } as never,
        { systemPrompt: "base prompt", messages: [] } as never,
      );
      expect(inner).toHaveBeenCalledTimes(1);
      expect(() =>
        wrapped(
          { provider: "fixture" } as never,
          { systemPrompt: "base prompt", messages: [] } as never,
        ),
      ).toThrow(/unsealed-model-call/);
      expect(inner).toHaveBeenCalledTimes(1);
    },
  );

  it("shares call identities across a normal call, summarizer and normal continuation", () => {
    vi.stubEnv("OPENCLAW_RC03_SEAL", "1");
    seal();
    const inner = vi.fn((_m: unknown, _c: unknown) => ({}) as never);
    const wrapped = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn: inner,
      sessionId: "guard-session",
      runId: "seal-run",
      model: { provider: "fixture", api: "fixture", id: "fixture" } as never,
    });
    wrapped(
      { provider: "fixture" } as never,
      { systemPrompt: "base prompt", messages: [] } as never,
    );
    wrapped(
      { provider: "fixture" } as never,
      { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: [] } as never,
    );
    expect(getRc03SealPlan("seal-run", 1)?.preSealProducers).toContainEqual({
      producerId: "compaction-summarizer",
      producerVersion: "1",
      applied: true,
    });
    const continuationIndex = nextRc03ModelCallIndex("seal-run", 0, 1);
    expect(continuationIndex).toBe(2);
    seal("compass-ssp", { modelCallIndex: continuationIndex });
    wrapped(
      { provider: "fixture" } as never,
      { systemPrompt: "base prompt", messages: [] } as never,
    );
    expect(inner).toHaveBeenCalledTimes(3);
    expect(getRc03SealPlan("seal-run", 2)?.callIndex.modelCallIndex).toBe(2);
  });

  it.each(["env", "config"])(
    "honors a %s kill switch after sealing, including summarization",
    async (mode) => {
      vi.stubEnv("OPENCLAW_RC03_SEAL", "1");
      vi.stubEnv("OPENCLAW_RC02_SHADOW_CENSUS", "1");
      seal();
      const inner = vi.fn((_m: unknown, _c: unknown) => ({}) as never);
      const wrapped = resolveEmbeddedAgentStreamFn({
        currentStreamFn: undefined,
        providerStreamFn: inner,
        sessionId: "guard-session",
        runId: "seal-run",
        model: { provider: "fixture", api: "fixture", id: "fixture" } as never,
      });
      wrapped(
        { provider: "fixture" } as never,
        { systemPrompt: "base prompt", messages: [] } as never,
      );
      const cfg =
        mode === "env"
          ? { runtime: { rc03: { seal: true } } }
          : { runtime: { contextEnhancement: { killSwitch: true }, rc03: { seal: true } } };
      if (mode === "env") vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", "1");
      else writeFileSync(join(stateRoot, "openclaw.json"), JSON.stringify(cfg));
      await computeContextExtraSystemPrompt(undefined, cfg, {
        turnId: "killed-turn",
        runId: "seal-run",
        deferProjection: true,
      });
      finalizeContextOrchestratorTurn({
        turnId: "killed-turn",
        runId: "seal-run",
        modelCallIndex: 1,
        messages: [],
        systemPrompt: "changed after kill",
        // The live config kill must win over the construction-time snapshot.
        cfg: { runtime: { rc03: { seal: true } } },
      });
      wrapped(
        { provider: "fixture" } as never,
        { systemPrompt: "changed after kill", messages: [] } as never,
      );
      wrapped(
        { provider: "fixture" } as never,
        { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: [] } as never,
      );
      expect(inner).toHaveBeenCalledTimes(3);
      expect(getRc03SealPlan("seal-run")).toBeUndefined();
      expect(getContextFinalSnapshot("seal-run", 0, 1)?.sealCoverage).toBe("disabled");
      if (mode === "env") vi.stubEnv("VERSE_CONTEXT_ENHANCEMENT_KILL_SWITCH", "0");
      else
        writeFileSync(
          join(stateRoot, "openclaw.json"),
          JSON.stringify({
            runtime: { rc03: { seal: true }, contextEnhancement: { killSwitch: false } },
          }),
        );
      const resumedIndex = nextRc03ModelCallIndex("seal-run", 0, 2);
      expect(resumedIndex).toBe(3);
      finalizeContextOrchestratorTurn({
        turnId: "killed-turn",
        runId: "seal-run",
        modelCallIndex: resumedIndex,
        messages: [],
        systemPrompt: "base prompt",
        cfg,
      });
      expect(getContextFinalSnapshot("seal-run", 0, resumedIndex)?.sealCoverage).toBe("enforced");
      wrapped(
        { provider: "fixture" } as never,
        { systemPrompt: "base prompt", messages: [] } as never,
      );
      expect(inner).toHaveBeenCalledTimes(4);
    },
  );
  it("keeps snapshot call identity aligned through compaction while the seal is off", () => {
    const inner = vi.fn((_m: unknown, _c: unknown) => ({}) as never);
    const wrapped = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn: inner,
      sessionId: "guard-session",
      runId: "off-summary",
      model: { provider: "fixture", api: "fixture", id: "fixture" } as never,
    });
    wrapped({ provider: "fixture" } as never, { systemPrompt: "base", messages: [] } as never);
    wrapped(
      { provider: "fixture" } as never,
      { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: [] } as never,
    );
    const index = nextRc03ModelCallIndex("off-summary", 0, 1);
    expect(index).toBe(2);
    finalizeContextOrchestratorTurn({
      turnId: "off-summary-turn",
      runId: "off-summary",
      modelCallIndex: index,
      messages: [],
      systemPrompt: "base",
    });
    wrapped({ provider: "fixture" } as never, { systemPrompt: "base", messages: [] } as never);
    expect(inner).toHaveBeenCalledTimes(3);
    expect(getContextFinalSnapshot("off-summary", 0, 2)?.sealCoverage).toBe("disabled");
    expect(getRc03SealPlan("off-summary")).toBeUndefined();
  });

  it("binds an omitted system prompt to the effective projection, including an empty prompt", () => {
    for (const addition of ["projected prompt", ""]) {
      const runId = `omitted:${addition}`;
      runRc03SealHook({ messages: [], lineage: [], systemPromptAddition: addition }, [], {
        enabled: true,
        runId,
      });
      const inner = vi.fn((_m: unknown, _c: unknown) => ({}) as never);
      const wrapped = resolveEmbeddedAgentStreamFn({
        currentStreamFn: undefined,
        providerStreamFn: inner,
        sessionId: "guard-session",
        runId,
        model: { provider: "fixture", api: "fixture", id: "fixture" } as never,
      });
      expect(() =>
        wrapped(
          { provider: "fixture" } as never,
          { systemPrompt: "not the sealed prompt", messages: [] } as never,
        ),
      ).toThrow(/content-changed/);
      expect(inner).not.toHaveBeenCalled();
    }
  });

  it("releases default-off run counters while temporary clearing preserves the current run sequence", () => {
    const runId = "off-release";
    const inner = vi.fn((_m: unknown, _c: unknown) => ({}) as never);
    const wrapped = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn: inner,
      sessionId: "guard-session",
      runId,
      model: { provider: "fixture", api: "fixture", id: "fixture" } as never,
    });
    wrapped({ provider: "fixture" } as never, { systemPrompt: "base", messages: [] } as never);
    expect(nextRc03ModelCallIndex(runId, 0, 0)).toBe(1);
    releaseRc03Run(runId);
    expect(nextRc03ModelCallIndex(runId, 0, 0)).toBe(0);
  });

  it("rejects explicit summary identity conflicts and reuses a correctly identified summary on wire retry", () => {
    vi.stubEnv("OPENCLAW_RC03_SEAL", "1");
    seal();
    const inner = vi.fn((_m: unknown, _c: unknown) => ({}) as never);
    const wrapped = resolveEmbeddedAgentStreamFn({
      currentStreamFn: undefined,
      providerStreamFn: inner,
      sessionId: "guard-session",
      runId: "seal-run",
      model: { provider: "fixture", api: "fixture", id: "fixture" } as never,
    });
    const summary = { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: [] } as never;
    expect(() =>
      wrapped({ provider: "fixture" } as never, summary, { modelCallIndex: 0 } as never),
    ).toThrow(/content-changed/);
    expect(getRc03SealPlan("seal-run", 1)).toBeUndefined();
    wrapped({ provider: "fixture" } as never, summary, {
      modelCallIndex: 1,
      wireAttemptIndex: 0,
    } as never);
    const digest = getRc03SealPlan("seal-run", 1)?.planDigest;
    wrapped({ provider: "fixture" } as never, summary, {
      modelCallIndex: 1,
      wireAttemptIndex: 1,
    } as never);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(getRc03SealPlan("seal-run", 1)?.planDigest).toBe(digest);
    expect(getRc03SealPlan("seal-run", 2)).toBeUndefined();
  });
});
