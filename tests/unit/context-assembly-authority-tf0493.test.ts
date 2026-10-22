// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  beginTurnInjectionBudget,
  chargeTurnInjection,
  endTurnInjectionBudget,
  getTurnInjectionBudget,
  summarizeTurnInjection,
} from "../../openclaw_runtime/src/context-engine/turn-injection-budget";
import {
  beginContextCandidateCollection,
  collectContextCandidate,
  createContextCandidate,
  reopenContextCandidateCollection,
} from "../../openclaw_runtime/src/context-engine/context-candidate";
import {
  endContextOrchestratorTurn,
  finalizeContextOrchestratorTurn,
  resetContextOrchestratorLineageForTests,
} from "../../openclaw_runtime/src/context-engine/context-orchestrator";
import {
  getContextFinalSnapshot,
  listContextFinalSnapshots,
  recordContextFinalSnapshot,
  resetContextFinalSnapshotsForTests,
} from "../../openclaw_runtime/src/context-engine/context-final-snapshot";
import {
  C6_INTERNAL_BLOCK_BUDGET_MAX_TOKENS,
  C6_INTERNAL_BLOCK_BUDGET_MIN_TOKENS,
  resolveInternalContextLadderPolicy,
} from "../../openclaw_runtime/src/context-engine/context-ladder";
import {
  getRc03SealCorrelationDigest,
  getRc03SealPlan,
  resetRc03SealPlansForTest,
} from "../../openclaw_runtime/src/context-engine/rc03-seal-hook";
import { buildStage1RequestEnvelope } from "../../openclaw_runtime/src/agents/stage1-request-envelope";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";

const root = process.cwd();
const tempRoots: string[] = [];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function messages(text: string): Array<{ role: "user"; content: string }> {
  return [{ role: "user", content: text }];
}

function seedCandidate(turnId: string, sourceId: string, text: string): void {
  beginContextCandidateCollection(turnId);
  collectContextCandidate(
    turnId,
    createContextCandidate({
      authorityObjectId: sourceId,
      authorityVersion: "v1",
      sourceId,
      channel: sourceId === "working_memory" ? "working_memory" : "knowledge",
      target: "message",
      text,
    }),
  );
}

beforeEach(() => {
  resetContextOrchestratorLineageForTests();
  resetContextFinalSnapshotsForTests();
  resetRc03SealPlansForTest();
  delete process.env.OPENCLAW_RC03_SEAL;
});

afterEach(() => {
  delete process.env.OPENCLAW_RC03_SEAL;
  resetContextOrchestratorLineageForTests();
  resetContextFinalSnapshotsForTests();
  resetRc03SealPlansForTest();
  closeOpenClawStateDatabase();
  for (const tempRoot of tempRoots.splice(0)) fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("TF-0493 context assembly authority", () => {
  it("keeps one shared injection ledger for an entire turn", () => {
    const turnId = "tf0493-one-ledger";
    const first = beginTurnInjectionBudget({ turnId, total: 500, turnIndex: 7 });
    const second = beginTurnInjectionBudget({ turnId, total: 100, turnIndex: 99 });
    expect(second).toBe(first);
    expect(getTurnInjectionBudget(turnId)).toBe(first);
    chargeTurnInjection(first, "knowledge", "one", true);
    chargeTurnInjection(first, "vtoken", "two", true);
    const accounting = summarizeTurnInjection(first);
    expect(accounting.turnId).toBe(turnId);
    expect(accounting.byChannel.knowledge?.applied).toBeGreaterThan(0);
    expect(accounting.byChannel.vtoken?.applied).toBeGreaterThan(0);
    endTurnInjectionBudget(turnId);
    expect(getTurnInjectionBudget(turnId)).toBeUndefined();
  });

  it("records exactly one immutable final snapshot per actual model call", () => {
    const turnId = "tf0493-model-calls";
    const runId = "tf0493-run";
    try {
      seedCandidate(turnId, "knowledge", "first-call knowledge");
      const first = finalizeContextOrchestratorTurn({
        turnId,
        runId,
        sessionKey: "agent:test:main",
        attemptIndex: 0,
        modelCallIndex: 0,
        systemPrompt: "base system",
        messages: messages("first model call") as never,
      });
      const firstSnapshot = getContextFinalSnapshot(runId, 0, 0);
      expect(firstSnapshot).toBeDefined();
      expect(firstSnapshot?.sealed).toBe(true);
      expect(firstSnapshot?.modelCallIndex).toBe(0);
      expect(firstSnapshot?.providerRequestDigest).toMatch(/^sha256:/);

      finalizeContextOrchestratorTurn({
        turnId,
        runId,
        sessionKey: "agent:test:main",
        attemptIndex: 0,
        modelCallIndex: 0,
        systemPrompt: "base system",
        messages: messages("first model call") as never,
      });
      expect(listContextFinalSnapshots(runId)).toHaveLength(1);

      reopenContextCandidateCollection(turnId);
      collectContextCandidate(
        turnId,
        createContextCandidate({
          authorityObjectId: "working-memory",
          authorityVersion: "v2",
          sourceId: "working_memory",
          channel: "working_memory",
          target: "message",
          text: "second-call working memory",
        }),
      );
      finalizeContextOrchestratorTurn({
        turnId,
        runId,
        sessionKey: "agent:test:main",
        attemptIndex: 0,
        modelCallIndex: 1,
        systemPrompt: "base system",
        messages: [...first.messages, ...messages("second model call")] as never,
        priorDedupKeys: new Set(first.projection.lineage.map((entry) => entry.dedupKey)),
      });

      reopenContextCandidateCollection(turnId);
      collectContextCandidate(
        turnId,
        createContextCandidate({
          authorityObjectId: "knowledge-fallback",
          authorityVersion: "v1",
          sourceId: "knowledge",
          channel: "knowledge",
          target: "message",
          text: "fallback knowledge",
        }),
      );
      finalizeContextOrchestratorTurn({
        turnId,
        runId,
        sessionKey: "agent:test:main",
        attemptIndex: 1,
        modelCallIndex: 0,
        systemPrompt: "base system",
        messages: messages("fallback model call") as never,
      });

      const snapshots = listContextFinalSnapshots(runId);
      expect(snapshots.map((snapshot) => [snapshot.attemptIndex, snapshot.modelCallIndex])).toEqual([
        [0, 0],
        [0, 1],
        [1, 0],
      ]);
      expect(firstSnapshot).toEqual(getContextFinalSnapshot(runId, 0, 0));
    } finally {
      endContextOrchestratorTurn(turnId);
      endTurnInjectionBudget(turnId);
    }
  });

  it("rejects a conflicting second final state for the same model call", () => {
    const turnId = "tf0493-conflict";
    const ledger = beginTurnInjectionBudget({ turnId, total: 100 });
    chargeTurnInjection(ledger, "knowledge", "x", true);
    const budget = summarizeTurnInjection(ledger);
    const projection = { messages: [], lineage: [] };
    const first = recordContextFinalSnapshot({
      turnId,
      runId: "run-conflict",
      attemptIndex: 0,
      modelCallIndex: 0,
      systemPrompt: "base",
      messages: messages("one") as never,
      projection,
      budget,
      createdAt: 1,
    });
    expect(
      recordContextFinalSnapshot({
        turnId,
        runId: "run-conflict",
        attemptIndex: 0,
        modelCallIndex: 0,
        systemPrompt: "base",
        messages: messages("one") as never,
        projection,
        budget,
        createdAt: 2,
      }).snapshotId,
    ).toBe(first.snapshotId);
    expect(() =>
      recordContextFinalSnapshot({
        turnId,
        runId: "run-conflict",
        attemptIndex: 0,
        modelCallIndex: 0,
        systemPrompt: "base",
        messages: messages("different") as never,
        projection,
        budget,
      }),
    ).toThrow(/context final snapshot conflict/);
    endTurnInjectionBudget(turnId);
  });

  it("binds the final provider RequestEnvelope to the sealed ContextBundle", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tf0493-envelope-"));
    tempRoots.push(tempRoot);
    const turnId = "tf0493-envelope";
    const runId = "run-envelope";
    const databasePath = path.join(tempRoot, "state.db");
    try {
      seedCandidate(turnId, "knowledge", "bundle knowledge");
      const finalized = finalizeContextOrchestratorTurn({
        turnId,
        runId,
        sessionKey: "agent:test:main",
        providerId: "fixture-provider",
        attemptIndex: 4,
        modelCallIndex: 2,
        systemPrompt: "authoritative system",
        messages: messages("provider body") as never,
        rc03Seal: { enabled: true, database: { env: process.env, path: databasePath } },
      });
      const snapshot = getContextFinalSnapshot(runId, 4, 2);
      const plan = getRc03SealPlan(runId, 2);
      expect(snapshot).toBeDefined();
      expect(plan).toBeDefined();
      expect(snapshot?.bundleDigest).toBe(getRc03SealCorrelationDigest(runId, 2));
      expect(snapshot?.rc03PlanId).toBe(plan?.planId);

      const body = { system: "authoritative system", messages: finalized.messages };
      const built = buildStage1RequestEnvelope({
        body,
        bodyText: JSON.stringify(body),
        providerId: "fixture-provider",
        adapterId: "fixture-adapter",
        modelId: "fixture-model",
        url: "https://fixture.invalid/v1/responses",
        method: "POST",
        endpointClass: "custom",
        wireAttemptIndex: 0,
        shadow: {
          enabled: true,
          sourceRuntime: true,
          sessionKey: "agent:test:main",
          runId,
          providerId: "fixture-provider",
          adapterId: "fixture-adapter",
          attemptIndex: 4,
          modelCallIndex: 2,
          rc03Plan: plan,
        },
      });
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error(built.reason);
      expect(built.envelope.planId).toBe(plan?.planId);
      expect(built.envelope.snapshotId).toBe(`snap_stage1:${plan?.planId}`);
      expect(built.envelope.identity).toMatchObject({ attemptIndex: 4, modelCallIndex: 2 });
    } finally {
      endContextOrchestratorTurn(turnId);
      endTurnInjectionBudget(turnId);
    }
  });

  it("uses an automatic, bounded C6 policy only for DCS Block projection", () => {
    const normal = resolveInternalContextLadderPolicy(200_000);
    const pressure = resolveInternalContextLadderPolicy(16_000);
    expect(normal).toMatchObject({
      enabled: true,
      tokenBudget: C6_INTERNAL_BLOCK_BUDGET_MAX_TOKENS,
      mode: "normal",
      heatThreshold: 0,
    });
    expect(pressure).toMatchObject({
      enabled: true,
      tokenBudget: 4_000,
      mode: "pressure",
      heatThreshold: 0,
    });
    expect(normal?.tokenBudget).toBeGreaterThanOrEqual(C6_INTERNAL_BLOCK_BUDGET_MIN_TOKENS);
    const extensions = read("openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts");
    expect(extensions).toContain("resolveInternalContextLadderPolicy");
    expect(extensions).toMatch(/hasContextBlockProjection\(params\.projectionFlags\)/);
    expect(extensions).toContain("...(contextLadder ? { contextLadder } : {})");
  });

  it("keeps VToken host internals but removes its user-level bridge and product copy", () => {
    const settings = read("src/pages/Settings/index.tsx");
    expect(settings).not.toContain("VtokenBridgePanel");
    expect(settings).not.toContain("ContextLayersExplainer");
    const e2e = read("tests/e2e/vtoken-bridge-settings.spec.ts");
    expect(e2e).toMatch(/settings-vtoken-bridge[\s\S]*toHaveCount\(0\)/);
    expect(fs.existsSync(path.join(root, "electron/services/vtoken-bridge.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "shared/vtoken/types.ts"))).toBe(true);
  });
});
