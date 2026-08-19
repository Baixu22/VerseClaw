import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ContextRef, TurnIdentity } from "../../shared/types/context-control-plane/artifacts";
import { buildStage1RequestEnvelope } from "../../openclaw_runtime/src/agents/stage1-request-envelope";
import {
  buildStage2TaskLedgerContextRef,
  buildStage2ToolResultContextRef,
  buildStage2UserIntentContextRef,
} from "../../openclaw_runtime/src/context-engine/stage2-context-refs";
import {
  compileStage2Dcs,
  resetStage2DcsRegistryForTests,
  STAGE2_DCS_POLICY_DIGEST,
  type Stage2DcsCompileInput,
} from "../../openclaw_runtime/src/context-engine/stage2-dcs";
import { buildStage2CatalogEpoch, buildStage2PolicyEpoch } from "../../openclaw_runtime/src/context-engine/stage2-catalog-epoch";
import { buildStage2TransformGraph } from "../../openclaw_runtime/src/context-engine/stage2-transform-graph";
import type { Stage2PromptPlanCarrier, Stage2SnapshotCarrier } from "../../openclaw_runtime/src/agents/shadow-census";
import { createCompilePlan } from "../../openclaw_runtime/src/context-engine/compile-plan";
import { RC03_SEAL_POLICY_DIGEST } from "../../openclaw_runtime/src/context-engine/rc03-seal-hook";

const OBSERVED_AT = "2026-08-16T00:00:00.000Z";
const PROVIDER_BODY = {
  messages: [
    { role: "system", content: "system" },
    { role: "user", content: "write sentinel" },
  ],
  tools: [{ type: "function", function: { name: "write" } }],
};

function buildCompilation() {
  const user = buildStage2UserIntentContextRef({
    sessionKey: "sess:stage2",
    runId: "run:stage2",
    entryId: "entry_1",
    payload: "write sentinel",
    observedAt: OBSERVED_AT,
  });
  const ledger = buildStage2TaskLedgerContextRef({
    sessionKey: "sess:stage2",
    runId: "run:stage2",
    taskLedgerRootId: "tlroot_guard",
    revision: "rev_1_deadbeef",
    contentDigest: `sha256:${"b".repeat(64)}`,
    observedAt: OBSERVED_AT,
  });
  const tool = buildStage2ToolResultContextRef({
    sessionKey: "sess:stage2",
    runId: "run:stage2",
    handle: {
      uri: "context-archive://sess-stage2/tool-result.json",
      checksum: `sha256:${"c".repeat(64)}`,
      byteLength: 16,
    },
    observedAt: OBSERVED_AT,
  });
  if (!user.ok || !ledger.ok || !tool.ok) throw new Error("fixture ref failed");
  const refs: ContextRef[] = [user.ref, ledger.ref, tool.ref];
  const identity: TurnIdentity = {
    sessionKey: "sess:stage2",
    runId: "run:stage2",
    attemptIndex: 0,
    modelCallIndex: 0,
  };
  const input: Stage2DcsCompileInput = {
    refs,
    identity,
    taskLedgerRevision: "rev_1_deadbeef",
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
    unitEstimates: {
      [user.ref.refId]: PROVIDER_BODY.messages[1]?.content.length ?? 0,
      [ledger.ref.refId]: 1,
      [tool.ref.refId]: 1,
    },
    observedAt: OBSERVED_AT,
  };
  const compiled = compileStage2Dcs(input);
  if (!compiled.ok) throw new Error(compiled.message);
  return { compiled, refs };
}

function carriers(): { plan: Stage2PromptPlanCarrier; snapshot: Stage2SnapshotCarrier } {
  const { compiled } = buildCompilation();
  return {
    plan: {
      schema: compiled.plan.schema,
      planId: compiled.plan.planId,
      snapshotId: compiled.plan.snapshotId,
      planDigest: compiled.plan.planDigest,
      sealed: compiled.plan.sealed,
      identity: compiled.plan.identity,
    },
    snapshot: {
      schema: compiled.snapshot.schema,
      snapshotId: compiled.snapshot.snapshotId,
      snapshotDigest: compiled.snapshot.snapshotDigest,
      policyDigest: compiled.snapshot.policyDigest,
      modelProfile: compiled.snapshot.modelProfile,
      transformGraph: compiled.snapshot.transformGraph,
    },
  };
}

function envelopeShadow(overrides: Partial<{ plan: Stage2PromptPlanCarrier; snapshot: Stage2SnapshotCarrier }> = {}) {
  const base = carriers();
  return {
    enabled: true,
    sessionKey: "sess:stage2",
    runId: "run:stage2",
    attemptIndex: 0,
    modelCallIndex: 0,
    stage2PromptPlan: overrides.plan ?? base.plan,
    stage2Snapshot: overrides.snapshot ?? base.snapshot,
  };
}

function buildEnvelope(shadow: ReturnType<typeof envelopeShadow>) {
  return buildStage1RequestEnvelope({
    body: PROVIDER_BODY,
    bodyText: JSON.stringify(PROVIDER_BODY),
    providerId: "deepseek",
    adapterId: "openai-completions",
    modelId: "deepseek-v4-flash",
    url: "https://api.deepseek.com/v1/chat/completions",
    method: "POST",
    endpointClass: "public",
    wireAttemptIndex: 0,
    shadow,
  });
}

describe("stage2 Provider Guard consumes sealed DCS artifacts", () => {
  it("C10: envelope takes planId/snapshotId/transforms from DCS and has a stable digest", () => {
    resetStage2DcsRegistryForTests();
    const shadow = envelopeShadow();
    const built = buildEnvelope(shadow);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.envelope.planId).toBe(shadow.stage2PromptPlan?.planId);
    expect(built.envelope.snapshotId).toBe(shadow.stage2Snapshot?.snapshotId);
    expect(built.envelope.transforms).toEqual(shadow.stage2Snapshot?.transformGraph);
    const again = buildEnvelope(shadow);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.envelopeDigest).toBe(built.envelopeDigest);
  });

  it("C11/C12: unsealed plan and snapshot/plan mismatch are observationally rejected", () => {
    const base = carriers();
    expect(buildEnvelope(envelopeShadow({ plan: { ...base.plan, sealed: false } })))
      .toMatchObject({ ok: false, reason: "prompt-plan-not-sealed" });
    expect(buildEnvelope(envelopeShadow({ snapshot: { ...base.snapshot, snapshotId: "snap_wrong" } })))
      .toMatchObject({ ok: false, reason: "snapshot-plan-mismatch" });
  });

  it("legacy Stage 1 RC-03 fallback remains byte-identical", () => {
    const plan = createCompilePlan({
      sessionKey: "sess:stage2",
      runId: "run:stage2",
      providerId: "deepseek",
      adapterId: "openai-completions",
      policyDigest: RC03_SEAL_POLICY_DIGEST,
      callIndex: { attemptIndex: 0, planRevision: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
      preSealProducers: [{ producerId: "dcs-knowledge", producerVersion: "1", applied: true }],
      postSealTransformIds: ["transport-wire-serialization"],
    });
    const built = buildStage1RequestEnvelope({
      body: PROVIDER_BODY,
      bodyText: JSON.stringify(PROVIDER_BODY),
      providerId: "deepseek",
      adapterId: "openai-completions",
      modelId: "deepseek-v4-flash",
      url: "https://api.deepseek.com/v1/chat/completions",
      method: "POST",
      endpointClass: "public",
      wireAttemptIndex: 0,
      shadow: {
        enabled: true,
        sessionKey: "sess:stage2",
        runId: "run:stage2",
        attemptIndex: 0,
        modelCallIndex: 0,
        rc03Plan: plan,
      },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.envelope.snapshotId).toBe(`snap_stage1:${plan.planId}`);
  });
});

describe("C13/C16 static boundary scan", () => {
  const stage2Files = [
    "openclaw_runtime/src/context-engine/stage2-context-refs.ts",
    "openclaw_runtime/src/context-engine/stage2-transform-graph.ts",
    "openclaw_runtime/src/context-engine/stage2-catalog-epoch.ts",
    "openclaw_runtime/src/context-engine/stage2-dcs.ts",
    "openclaw_runtime/src/context-engine/stage2-dcs-evidence.ts",
    "openclaw_runtime/src/agents/stage1-request-envelope.ts",
    "openclaw_runtime/src/agents/stage2-golden-run.ts",
  ];

  it("golden-path files contain zero direct system-prompt mutation", () => {
    const banned = [/body\.system\s*=/, /body\.messages\s*=/, /systemPrompt\s*=/];
    for (const file of stage2Files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const pattern of banned) {
        expect(pattern.exec(source)).toBeNull();
      }
    }
  });

  it("Provider Guard never imports or calls DCS compile and never changes policy", () => {
    const guard = fs.readFileSync(
      path.join(process.cwd(), "openclaw_runtime/src/agents/stage1-request-envelope.ts"),
      "utf8",
    );
    expect(guard).not.toContain("compileStage2Dcs");
    expect(guard).not.toContain("createCompilePlan");
    expect(guard).not.toContain("registerSealProducer");
    expect(guard).not.toContain("context-orchestrator");
    expect(guard).not.toContain("policyDigest =");
  });
});
