// KE-P1-2: shadow retrieval (would_retrieve -> receipt, zero injection)
import { describe, expect, it } from "vitest";
import {
  buildKeBrokerSignals,
  resolveKeRetrievalShadowEnabled,
  runKeRetrievalShadow,
  type KeRetrievalCandidate,
  type KeRetrievalShadowContext,
} from "../../openclaw_runtime/src/runtime-core/ke-retrieval-shadow";

const ENABLED = { runtime: { coding: { sekb: { retrievalShadow: true } } } };
const DISABLED = { runtime: { coding: { sekb: { retrievalShadow: false } } } };

const candidates: KeRetrievalCandidate[] = [
  {
    envelopeId: "sekb:principle:pr_1",
    contentVersion: "sha256:1111",
    text: "Review before durable knowledge writes. Keep changes reviewable.",
    tags: ["knowledge", "review"],
    errorSignature: "command-exited-1",
    capturedAt: Date.now() - 1000,
    quality: { criticality: "high", pinned: true },
  },
  {
    envelopeId: "sekb:principle:pr_2",
    contentVersion: "sha256:2222",
    text: "Reject sparse runtime lessons without source evidence.",
    tags: ["knowledge", "sparse"],
    capturedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    quality: { criticality: "low", pinned: false },
  },
];

const context: KeRetrievalShadowContext = {
  taskId: "task_1",
  taskType: "codegen",
  runId: "run_1",
  sessionKey: "session_1",
  configDigest: "sha256:cfg",
  errorSignature: "command-exited-1",
  contextTags: ["knowledge", "review"],
  tokenBudget: 2000,
};

describe("KE-P1-2 shadow retrieval", () => {
  it("flag read: default off, on only when explicitly true", () => {
    expect(resolveKeRetrievalShadowEnabled({})).toBe(false);
    expect(resolveKeRetrievalShadowEnabled(DISABLED)).toBe(false);
    expect(resolveKeRetrievalShadowEnabled(ENABLED)).toBe(true);
  });

  it("(1) every would_retrieve candidate is covered by a receipt and a retrieved_at event", () => {
    const result = runKeRetrievalShadow(ENABLED, "review durable writes", candidates, context, 3);
    expect(result.enabled).toBe(true);
    expect(result.wouldRetrieve.length).toBeGreaterThan(0);
    expect(result.receipt).not.toBeNull();
    expect(result.retrievedAtEvents).toHaveLength(result.wouldRetrieve.length);
    expect(result.receipt!.content.selected).toHaveLength(result.wouldRetrieve.length);
    expect(result.receipt!.kind).toBe("shadow_context");
  });

  it("(2) zero injection: the result has no prompt surface and never presents", () => {
    const prompt = "System: you are an agent. User: fix the build.";
    const result = runKeRetrievalShadow(ENABLED, "fix the build", candidates, context, 3);
    expect("injection" in result).toBe(false);
    expect("prompt" in result).toBe(false);
    for (const candidate of result.wouldRetrieve) {
      expect(candidate.selectedForPresentation).toBe(false);
    }
    expect(prompt).toBe("System: you are an agent. User: fix the build.");
  });

  it("(3) flag off => zero retrieval, zero receipt, zero write", () => {
    const result = runKeRetrievalShadow(DISABLED, "review durable writes", candidates, context, 3);
    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe("flag_disabled");
    expect(result.wouldRetrieve).toHaveLength(0);
    expect(result.retrievedAtEvents).toHaveLength(0);
    expect(result.receipt).toBeNull();
  });

  it("(4) retrieved_at events align with KE-P0-3 fields", () => {
    const result = runKeRetrievalShadow(ENABLED, "review durable writes", candidates, context, 2);
    expect(result.retrievedAtEvents.length).toBeGreaterThan(0);
    const event = result.retrievedAtEvents[0]!;
    expect(event.schemaVersion).toBe(1);
    expect(event.arm).toBe("shadow");
    expect(event.envelopeId).toBe("sekb:principle:pr_1");
    expect(event.authority).toEqual({
      family: "sekb",
      id: "sekb:principle:pr_1",
      contentVersion: "sha256:1111",
    });
    expect(event.queryDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(event.rank).toBe(1);
    expect(typeof event.score).toBe("number");
    expect(typeof event.retrievalReason).toBe("string");
    expect(event.candidateSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(event.selectedForPresentation).toBe(false);
  });

  it("produces five sourceRef-anchored broker signals per candidate", () => {
    const signals = buildKeBrokerSignals("review durable writes", candidates[0]!, context, Date.now());
    expect(signals).toHaveLength(5);
    const names = new Set(signals.map((s) => s.name));
    expect(names).toEqual(new Set(["lexical", "tags", "error_signature", "temporal", "quality"]));
    for (const signal of signals) {
      expect(signal.score).toBeGreaterThanOrEqual(0);
      expect(signal.score).toBeLessThanOrEqual(1);
      expect(signal.sourceRef).toMatch(/^ke-broker:/);
    }
  });

  it("ranks candidates by calibrated score", () => {
    const result = runKeRetrievalShadow(ENABLED, "review durable writes", candidates, context, 3);
    expect(result.wouldRetrieve[0]!.envelopeId).toBe("sekb:principle:pr_1");
    expect(result.wouldRetrieve[0]!.rank).toBe(1);
    expect(result.wouldRetrieve[0]!.calibratedScore).toBeGreaterThanOrEqual(0);
    expect(result.wouldRetrieve[0]!.packingScore).toBeGreaterThanOrEqual(0);
    expect(result.wouldRetrieve[0]!.packingScore).toBeLessThanOrEqual(1);
  });
});
