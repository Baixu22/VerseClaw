import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  normalizeCompilationSnapshot,
  normalizeContextRef,
  normalizePromptPlan,
  type ContextRef,
  type TurnIdentity,
} from "../../shared/types/context-control-plane/artifacts";
import {
  appendLongTaskLedgerEvents,
  ensureLongTaskLedgerRoot,
  readLongTaskLedgerRevision,
} from "../../openclaw_runtime/src/agents/long-task-control/task-ledger";
import {
  buildStage2TaskLedgerContextRef,
  buildStage2ToolResultContextRef,
  buildStage2UserIntentContextRef,
} from "../../openclaw_runtime/src/context-engine/stage2-context-refs";
import {
  buildStage2CatalogEpoch,
  buildStage2PolicyEpoch,
} from "../../openclaw_runtime/src/context-engine/stage2-catalog-epoch";
import {
  compileStage2Dcs,
  resetStage2DcsRegistryForTests,
  resolveStage2DcsState,
  STAGE2_DCS_POLICY_DIGEST,
  type Stage2DcsCompileInput,
} from "../../openclaw_runtime/src/context-engine/stage2-dcs";
import {
  persistStage2DcsEvidence,
  persistStage2EnvelopeEvidence,
  queryStage2DcsEvidence,
} from "../../openclaw_runtime/src/context-engine/stage2-dcs-evidence";
import { buildStage2TransformGraph } from "../../openclaw_runtime/src/context-engine/stage2-transform-graph";

const OBSERVED_AT = "2026-08-16T00:00:00.000Z";
const tempRoots: string[] = [];

function buildRefs(): {
  userIntent: ContextRef;
  taskLedger: ContextRef;
  toolResult: ContextRef;
} {
  const user = buildStage2UserIntentContextRef({
    sessionKey: "sess:stage2",
    runId: "run:stage2",
    entryId: "entry_1",
    payload: { role: "user", content: "write sentinel.txt" },
    observedAt: OBSERVED_AT,
  });
  const ledger = buildStage2TaskLedgerContextRef({
    sessionKey: "sess:stage2",
    runId: "run:stage2",
    taskLedgerRootId: "tlroot_contract",
    revision: "rev_2_deadbeef",
    contentDigest: `sha256:${"b".repeat(64)}`,
    observedAt: OBSERVED_AT,
  });
  const tool = buildStage2ToolResultContextRef({
    sessionKey: "sess:stage2",
    runId: "run:stage2",
    handle: {
      uri: "context-archive://sess-stage2/observation-file.json",
      checksum: `sha256:${"c".repeat(64)}`,
      byteLength: 42,
    },
    observedAt: OBSERVED_AT,
  });
  if (!user.ok || !ledger.ok || !tool.ok) {
    throw new Error("fixture ContextRef build failed");
  }
  return { userIntent: user.ref, taskLedger: ledger.ref, toolResult: tool.ref };
}

function compileInput(
  refs: ContextRef[],
  overrides: Partial<Stage2DcsCompileInput> = {},
): Stage2DcsCompileInput {
  const identity: TurnIdentity = {
    sessionKey: "sess:stage2",
    runId: "run:stage2",
    attemptIndex: 0,
    modelCallIndex: 0,
  };
  return {
    refs,
    identity,
    taskLedgerRevision: "rev_2_deadbeef",
    catalogEpoch: buildStage2CatalogEpoch(`sha256:${"d".repeat(64)}`),
    policyEpoch: buildStage2PolicyEpoch(STAGE2_DCS_POLICY_DIGEST),
    policyDigest: STAGE2_DCS_POLICY_DIGEST,
    modelProfile: {
      providerId: "deepseek",
      modelId: "deepseek-v4-flash",
      adapterId: "openai-completions",
    },
    transformGraph: buildStage2TransformGraph(),
    budget: { unit: "chars", limit: 10_000, outputReserve: 0 },
    unitEstimates: {},
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

afterEach(async () => {
  resetStage2DcsRegistryForTests();
  try {
    const { closeOpenClawStateDatabase } = await import("../../openclaw_runtime/src/state/openclaw-state-db");
    closeOpenClawStateDatabase();
  } catch {
    // No open database in pure ref/DCS tests.
  }
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("stage2 ContextRef owner adapters", () => {
  it("C1: user-intent ref is contract-valid and carries no payload", () => {
    const refs = buildRefs();
    expect(Object.hasOwn(refs.userIntent, "payload")).toBe(false);
    expect(Object.hasOwn(refs.userIntent, "text")).toBe(false);
    expect(refs.userIntent.kind).toBe("user_intent");
    expect(refs.userIntent.owner).toBe("transcript");
    expect(() => normalizeContextRef(refs.userIntent)).not.toThrow();
  });

  it("C2: long-task ledger reader is append-sensitive and read-only", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-ledger-"));
    tempRoots.push(root);
    const env = { ...process.env, OPENCLAW_STATE_DIR: root };
    const rootId = ensureLongTaskLedgerRoot({
      workspaceId: "stage2-contract",
      sessionKey: "sess:stage2",
      agentId: "stage2-test",
      runId: "run:stage2",
      title: "Stage 2 ledger contract",
      source: "task_loop",
      env,
    });
    const before = readLongTaskLedgerRevision({ workspaceId: "stage2-contract", taskLedgerRootId: rootId, env });
    expect(before).toBeDefined();
    const ref = buildStage2TaskLedgerContextRef({
      sessionKey: "sess:stage2",
      runId: "run:stage2",
      taskLedgerRootId: rootId,
      revision: before!.revision,
      contentDigest: before!.contentDigest,
      observedAt: OBSERVED_AT,
    });
    expect(ref.ok).toBe(true);
    appendLongTaskLedgerEvents("stage2-contract", [{
      type: "decision_recorded",
      actor: "assistant",
      taskId: rootId,
      sessionId: "sess:stage2",
      idempotencyKey: "stage2-ledger:decision",
      payload: { decision: "contract probe" },
    }], env);
    const after = readLongTaskLedgerRevision({ workspaceId: "stage2-contract", taskLedgerRootId: rootId, env });
    expect(after).toBeDefined();
    expect(after!.eventCount).toBe(before!.eventCount + 1);
    expect(after!.revision).not.toBe(before!.revision);
    expect(after!.contentDigest).not.toBe(before!.contentDigest);
  });

  it("C3: tool-result ref digests the real archive checksum without output text", () => {
    const refs = buildRefs();
    expect(refs.toolResult.contentDigest).toBe(refs.toolResult.revision);
    expect(refs.toolResult.owner).toBe("archive");
    expect(JSON.stringify(refs.toolResult)).not.toContain("tool output");
  });
});

describe("stage2 DCS flag", () => {
  it("defaults off and only enables from explicit config or env", () => {
    expect(resolveStage2DcsState({}, {})).toEqual({ enabled: false });
    expect(resolveStage2DcsState({ runtime: { contextControlPlane: { stage2Dcs: true } } }, {})).toEqual({ enabled: true });
    expect(resolveStage2DcsState(undefined, { OPENCLAW_STAGE2_DCS: "true" })).toEqual({ enabled: true });
    expect(resolveStage2DcsState(undefined, { OPENCLAW_STAGE2_DCS: "garbage" })).toEqual({ enabled: false });
  });
});

describe("stage2 DCS snapshot and PromptPlan", () => {
  it("C4/C7: compiles immutable snapshot and sealed plan over all frozen inputs", () => {
    const refs = buildRefs();
    const result = compileStage2Dcs(compileInput([
      refs.userIntent,
      refs.taskLedger,
      refs.toolResult,
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.schema).toBe("CompilationSnapshot/v1");
    expect(result.plan.schema).toBe("PromptPlan/v1");
    expect(result.plan.sealed).toBe(true);
    expect(result.snapshot.snapshotDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.plan.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => normalizeCompilationSnapshot(result.snapshot)).not.toThrow();
    expect(() => normalizePromptPlan(result.plan)).not.toThrow();
    expect(result.snapshot.contextRefs.map((ref) => ref.kind).toSorted())
      .toEqual(["task_ledger", "tool_result", "user_intent"]);
    expect(result.plan.selected.map((entry) => entry.refId)).toEqual(result.plan.order);
    expect(result.plan.budget.applied).toBeLessThanOrEqual(result.plan.budget.requested);
    expect(result.plan.why.ruleId).toBe("stage2-dcs:v1:deterministic-observational");
  });

  it("C6: identical canonical inputs produce identical snapshot/plan ids, digests, and decisions", () => {
    const refs = buildRefs();
    const first = compileStage2Dcs(compileInput([refs.userIntent, refs.taskLedger, refs.toolResult]));
    const second = compileStage2Dcs(compileInput([refs.userIntent, refs.taskLedger, refs.toolResult]));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.snapshot.snapshotId).toBe(second.snapshot.snapshotId);
    expect(first.snapshot.snapshotDigest).toBe(second.snapshot.snapshotDigest);
    expect(first.plan.planId).toBe(second.plan.planId);
    expect(first.plan.planDigest).toBe(second.plan.planDigest);
    expect(first.plan.selected).toEqual(second.plan.selected);
    expect(first.plan.omitted).toEqual(second.plan.omitted);
    expect(first.plan.order).toEqual(second.plan.order);
    expect(first.plan.budget).toEqual(second.plan.budget);
    expect(first.plan.why).toEqual(second.plan.why);
  });

  it("C5: missing user intent and task-ledger revision conflict fail closed", () => {
    const refs = buildRefs();
    expect(compileStage2Dcs(compileInput([refs.taskLedger, refs.toolResult])))
      .toMatchObject({ ok: false, reason: "missing-user-intent" });
    expect(compileStage2Dcs(compileInput([refs.userIntent, refs.taskLedger], {
      taskLedgerRevision: "rev_wrong",
    }))).toMatchObject({ ok: false, reason: "task-ledger-revision-conflict" });
  });

  it("C5: budget drops non-user refs with an explainable omission", () => {
    const refs = buildRefs();
    const result = compileStage2Dcs(compileInput([
      refs.userIntent,
      refs.taskLedger,
      refs.toolResult,
    ], {
      budget: { unit: "chars", limit: 3, outputReserve: 0 },
      unitEstimates: {
        [refs.userIntent.refId]: 1,
        [refs.taskLedger.refId]: 2,
        [refs.toolResult.refId]: 2,
      },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.order).toEqual([refs.userIntent.refId, refs.taskLedger.refId]);
    expect(result.plan.omitted).toContainEqual({
      refId: refs.toolResult.refId,
      reason: "budget-drop",
      policyDigest: STAGE2_DCS_POLICY_DIGEST,
    });
  });
});

describe("stage2 DCS evidence recovery", () => {
  it("C8/C9: persists and queries snapshot/plan rows without a new table", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-evidence-"));
    tempRoots.push(root);
    const refs = buildRefs();
    const compiled = compileStage2Dcs(compileInput([refs.userIntent, refs.taskLedger, refs.toolResult]));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const database = { env: process.env, path: path.join(root, "state.db") };
    const persisted = persistStage2DcsEvidence({ snapshot: compiled.snapshot, plan: compiled.plan, database });
    expect(persisted.failed).toBe(false);
    expect(persisted.snapshotReceipt?.ok).toBe(true);
    expect(persisted.planReceipt?.ok).toBe(true);
    const rows = queryStage2DcsEvidence(database, compiled.snapshot.snapshotDigest);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "context")).toBe(true);
    expect(rows.some((row) => row.logical_digest === compiled.snapshot.snapshotDigest.slice("sha256:".length)))
      .toBe(true);
    expect(rows.some((row) => row.logical_digest === compiled.plan.planDigest.slice("sha256:".length)))
      .toBe(true);
    const { closeOpenClawStateDatabase } = await import("../../openclaw_runtime/src/state/openclaw-state-db");
    closeOpenClawStateDatabase();
  });
});

describe("stage2 envelope evidence correlation", () => {
  it("closes snapshot -> plan -> RequestEnvelope digest chain", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-envelope-evidence-"));
    tempRoots.push(root);
    const refs = buildRefs();
    const compiled = compileStage2Dcs(compileInput([refs.userIntent, refs.taskLedger, refs.toolResult]));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const database = { env: process.env, path: path.join(root, "state.db") };
    expect(persistStage2DcsEvidence({ snapshot: compiled.snapshot, plan: compiled.plan, database }).failed).toBe(false);
    const envelopeDigest = `sha256:${"e".repeat(64)}`;
    const envelope = persistStage2EnvelopeEvidence({
      snapshot: compiled.snapshot,
      plan: compiled.plan,
      envelopeDigest,
      database,
    });
    expect(envelope.ok).toBe(true);
    const rows = queryStage2DcsEvidence(database, compiled.snapshot.snapshotDigest);
    expect(rows).toHaveLength(3);
    expect(rows.some((row) => row.selected_json?.includes(`ref:request-envelope:${"e".repeat(64)}`))).toBe(true);
    const { closeOpenClawStateDatabase } = await import("../../openclaw_runtime/src/state/openclaw-state-db");
    closeOpenClawStateDatabase();
  });
});
