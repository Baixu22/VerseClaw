import { describe, expect, it, vi } from "vitest";
import {
  CapabilityRegistryV3ReceiptCollector,
  evaluateCapabilityRegistryV3Rollout,
  type CapabilityRegistryV3EvidenceClass,
  type CapabilityRegistryV3ObservationInput,
  type CapabilityRegistryV3ObservationMetrics,
  type CapabilityRegistryV3Receipt,
} from "./rollout-evaluation-v3.js";
import {
  CapabilityRegistryV3RolloutController,
  type CapabilityRegistryV3RolloutDecision,
} from "./rollout-control-v3.js";

const target = {
  providerId: "provider-a",
  modelId: "model-a",
  workflowNamespace: "engineering.discovery",
} as const;

function controller(mode: "off" | "shadow" | "opt-in" | "canary" = "opt-in") {
  return new CapabilityRegistryV3RolloutController({
    enabled: true,
    mode,
    killSwitch: false,
    allowlist: [target],
    canaryPercent: 50,
    cohortSalt: "evaluation-test-v1",
  });
}

function rolloutDecision(
  requestId: string,
  cohort: "control" | "treatment" | "shadow" = "treatment",
): CapabilityRegistryV3RolloutDecision {
  if (cohort === "shadow") {
    return controller("shadow").decide({ requestId, target });
  }
  return controller("opt-in").decide({
    requestId,
    target,
    explicitOptIn: cohort === "treatment",
  });
}

const defaultMetrics: CapabilityRegistryV3ObservationMetrics = {
  firstCallSuccess: true,
  schemaRetryCount: 0,
  fallback: false,
  policyDenied: false,
  inputTokens: 100,
  cachedTokens: 20,
  ttftMs: 40,
  catalogEpoch: "catalog-1",
  cacheMiss: false,
  pointerTokensSaved: 0,
  topology: "direct",
  topologySuccess: true,
  topologyLatencyMs: 10,
};

function observation(params: {
  requestId: string;
  cohort?: "control" | "treatment" | "shadow";
  evidenceClass?: CapabilityRegistryV3EvidenceClass;
  hit?: boolean;
  metrics?: Partial<CapabilityRegistryV3ObservationMetrics>;
}): CapabilityRegistryV3ObservationInput {
  const hit = params.hit ?? true;
  return {
    decision: rolloutDecision(params.requestId, params.cohort),
    evidenceClass: params.evidenceClass ?? "live",
    expected: {
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      capabilityId: "tool:runtime:workspace-read",
    },
    ranked: hit
      ? {
          categories: ["engineering"],
          workflowNamespaces: ["engineering.discovery"],
          capabilityIds: ["tool:runtime:workspace-read"],
        }
      : {
          categories: ["operations"],
          workflowNamespaces: ["operations.sessions"],
          capabilityIds: ["tool:runtime:session-status"],
        },
    metrics: { ...defaultMetrics, ...params.metrics },
  };
}

function requireReceipt(
  collector: CapabilityRegistryV3ReceiptCollector,
  input: CapabilityRegistryV3ObservationInput,
): CapabilityRegistryV3Receipt {
  const result = collector.record(input);
  if (!result.ok) {
    throw new Error(result.failure.code);
  }
  return result.receipt;
}

describe("Capability Registry V3 receipt collector", () => {
  it("is inert while disabled or when observation was not authorized", () => {
    const sink = { record: vi.fn() };
    const disabled = new CapabilityRegistryV3ReceiptCollector({
      enabled: false,
      maxReceipts: 2,
      metricSink: sink,
    });
    expect(disabled.record(observation({ requestId: "disabled-1" }))).toEqual({
      ok: false,
      failure: { code: "collector-disabled" },
    });
    expect(disabled.snapshot().receiptCount).toBe(0);
    expect(sink.record).not.toHaveBeenCalled();

    const enabled = new CapabilityRegistryV3ReceiptCollector({ enabled: true, maxReceipts: 2 });
    const unauthorized = observation({ requestId: "off-1" });
    unauthorized.decision = controller("off").decide({ requestId: "off-1", target });
    expect(enabled.record(unauthorized)).toEqual({
      ok: false,
      failure: { code: "observation-not-authorized" },
    });
  });

  it("stores only the closed receipt projection and emits low-cardinality metric points", () => {
    const points: unknown[] = [];
    const collector = new CapabilityRegistryV3ReceiptCollector({
      enabled: true,
      maxReceipts: 4,
      metricSink: { record: (point) => points.push(point) },
      now: () => 123.9,
    });
    const input = {
      ...observation({ requestId: "receipt-1", metrics: { pointerTokensSaved: 250 } }),
      rawResult: { secret: "must-not-be-retained" },
      credential: "must-not-be-retained",
    } as CapabilityRegistryV3ObservationInput;

    const result = collector.record(input);

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        replayed: false,
        receipt: expect.objectContaining({ recordedAt: 123, receiptHash: expect.stringMatching(/^sha256:/) }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("must-not-be-retained");
    expect(points).toHaveLength(8);
    expect(points).toContainEqual(
      expect.objectContaining({
        name: "capability_registry_v3.pointer_tokens_saved",
        value: 250,
        attributes: {
          cohort: "treatment",
          mode: "opt-in",
          topology: "direct",
          evidenceClass: "live",
        },
      }),
    );
    expect(JSON.stringify(points)).not.toContain("receipt-1");
  });

  it("deduplicates replay, rejects conflicts, and evicts the oldest receipt at its bound", () => {
    let now = 1;
    const collector = new CapabilityRegistryV3ReceiptCollector({
      enabled: true,
      maxReceipts: 2,
      now: () => now++,
    });
    const firstInput = observation({ requestId: "bounded-1" });
    const first = requireReceipt(collector, firstInput);
    expect(collector.record(firstInput)).toEqual({ ok: true, receipt: first, replayed: true });
    expect(
      collector.record(
        observation({ requestId: "bounded-1", metrics: { firstCallSuccess: false } }),
      ),
    ).toEqual({ ok: false, failure: { code: "receipt-conflict" } });

    requireReceipt(collector, observation({ requestId: "bounded-2" }));
    requireReceipt(collector, observation({ requestId: "bounded-3" }));
    const snapshot = collector.snapshot();
    expect(snapshot).toEqual(
      expect.objectContaining({
        receiptCount: 2,
        recordedCount: 3,
        replayCount: 1,
        conflictCount: 1,
        evictedCount: 1,
      }),
    );
    expect(snapshot.receipts.map((receipt) => receipt.requestId)).toEqual([
      "bounded-2",
      "bounded-3",
    ]);
  });

  it("keeps receipts when an injected metric sink fails", () => {
    const collector = new CapabilityRegistryV3ReceiptCollector({
      enabled: true,
      maxReceipts: 2,
      metricSink: { record: () => void (() => { throw new Error("sink down"); })() },
    });

    expect(collector.record(observation({ requestId: "sink-1" }))).toEqual(
      expect.objectContaining({ ok: true }),
    );
    expect(collector.snapshot()).toEqual(
      expect.objectContaining({ receiptCount: 1, metricSinkFailureCount: 8 }),
    );
  });

  it("rejects malformed metric and ranking inputs without throwing", () => {
    const collector = new CapabilityRegistryV3ReceiptCollector({ enabled: true, maxReceipts: 2 });
    const invalid = observation({ requestId: "invalid-1" }) as CapabilityRegistryV3ObservationInput & {
      metrics: { inputTokens: number };
    };
    invalid.metrics.inputTokens = -1;
    invalid.ranked.capabilityIds = Array.from({ length: 101 }, () => "tool:runtime:workspace-read");

    expect(collector.record(invalid)).toEqual({
      ok: false,
      failure: { code: "invalid-observation" },
    });
    expect(collector.snapshot().receiptCount).toBe(0);
  });

  it("rejects malformed runtime inputs without throwing", () => {
    const collector = new CapabilityRegistryV3ReceiptCollector({ enabled: true, maxReceipts: 2 });

    expect(
      collector.record(null as unknown as CapabilityRegistryV3ObservationInput),
    ).toEqual({
      ok: false,
      failure: { code: "invalid-observation" },
    });
    expect(
      collector.record({} as CapabilityRegistryV3ObservationInput),
    ).toEqual({
      ok: false,
      failure: { code: "invalid-observation" },
    });
    expect(
      collector.record({ decision: { observe: "yes" } } as unknown as CapabilityRegistryV3ObservationInput),
    ).toEqual({
      ok: false,
      failure: { code: "invalid-observation" },
    });
    expect(collector.snapshot().receiptCount).toBe(0);
  });
});

describe("Capability Registry V3 rollout evaluation", () => {
  function liveEvaluationReceipts(): CapabilityRegistryV3Receipt[] {
    const collector = new CapabilityRegistryV3ReceiptCollector({ enabled: true, maxReceipts: 20 });
    return [
      requireReceipt(
        collector,
        observation({
          requestId: "control-1",
          cohort: "control",
          metrics: { topology: "direct", inputTokens: 120, topologyLatencyMs: 20 },
        }),
      ),
      requireReceipt(
        collector,
        observation({
          requestId: "control-2",
          cohort: "control",
          metrics: {
            topology: "proxy",
            fallback: true,
            catalogEpoch: "catalog-2",
            cacheMiss: true,
            ttftMs: 60,
            topologyLatencyMs: 30,
          },
        }),
      ),
      requireReceipt(
        collector,
        observation({
          requestId: "treatment-1",
          cohort: "treatment",
          metrics: {
            topology: "native",
            inputTokens: 70,
            cachedTokens: 30,
            pointerTokensSaved: 200,
            ttftMs: 30,
            topologyLatencyMs: 8,
          },
        }),
      ),
      requireReceipt(
        collector,
        observation({
          requestId: "treatment-2",
          cohort: "treatment",
          metrics: {
            topology: "code",
            inputTokens: 80,
            cachedTokens: 40,
            schemaRetryCount: 1,
            firstCallSuccess: false,
            catalogEpoch: "catalog-2",
            cacheMiss: true,
            pointerTokensSaved: 100,
            ttftMs: 50,
            topologyLatencyMs: 12,
          },
        }),
      ),
    ];
  }

  it("reports all required A/B, cache, token, and topology metrics while keeping locks false", () => {
    const receipts = liveEvaluationReceipts();

    const report = evaluateCapabilityRegistryV3Rollout(receipts, {
      recallK: 1,
      minSamplesPerCohort: 2,
    });

    expect(report).toEqual(
      expect.objectContaining({
        receiptCount: 4,
        eligibleLiveReceiptCount: 4,
        evidenceInventory: { fixture: 0, replay: 0, live: 4 },
        decision: {
          status: "reviewable",
          reasons: ["live-sample-and-recall-gates-met"],
          locks: { defaultOn: false, liveReady: false, productApproved: false },
        },
        reportHash: expect.stringMatching(/^sha256:/),
      }),
    );
    expect(report.cohorts.control).toEqual(
      expect.objectContaining({
        sampleCount: 2,
        recallAtK: { category: 1, workflowNamespace: 1, capability: 1 },
        fallbackRate: 0.5,
        cacheMissRate: 0.5,
      }),
    );
    expect(report.cohorts.treatment).toEqual(
      expect.objectContaining({
        sampleCount: 2,
        recallAtK: { category: 1, workflowNamespace: 1, capability: 1 },
        firstCallSuccessRate: 0.5,
        schemaRetryRate: 0.5,
        schemaRetriesPerRun: 0.5,
        pointerTokensSaved: { total: 300, average: 150 },
      }),
    );
    expect(report.comparison.treatmentMinusControl.pointerTokensSavedAverage).toBe(150);
    expect(report.topology).toEqual([
      expect.objectContaining({ topology: "direct", sampleCount: 1, successRate: 1 }),
      expect.objectContaining({ topology: "proxy", sampleCount: 1, successRate: 1 }),
      expect.objectContaining({ topology: "code", sampleCount: 1, successRate: 1 }),
      expect.objectContaining({ topology: "native", sampleCount: 1, successRate: 1 }),
    ]);
    expect(report.catalogEpochs).toEqual([
      { catalogEpoch: "catalog-1", sampleCount: 2, cacheMissCount: 0, cacheMissRate: 0 },
      { catalogEpoch: "catalog-2", sampleCount: 2, cacheMissCount: 2, cacheMissRate: 1 },
    ]);
  });

  it("holds rollout when treatment Recall@k drops by more than five percentage points", () => {
    const collector = new CapabilityRegistryV3ReceiptCollector({ enabled: true, maxReceipts: 10 });
    const receipts = [
      requireReceipt(collector, observation({ requestId: "hold-c1", cohort: "control" })),
      requireReceipt(collector, observation({ requestId: "hold-c2", cohort: "control" })),
      requireReceipt(
        collector,
        observation({ requestId: "hold-t1", cohort: "treatment", hit: false }),
      ),
      requireReceipt(
        collector,
        observation({ requestId: "hold-t2", cohort: "treatment", hit: false }),
      ),
    ];

    const report = evaluateCapabilityRegistryV3Rollout(receipts, {
      recallK: 1,
      minSamplesPerCohort: 2,
      maxRecallDrop: 0.05,
    });

    expect(report.decision).toEqual({
      status: "hold",
      reasons: ["treatment-recall-regression-exceeds-limit"],
      locks: { defaultOn: false, liveReady: false, productApproved: false },
    });
    expect(report.comparison.treatmentMinusControl.recallAtK).toEqual({
      category: -1,
      workflowNamespace: -1,
      capability: -1,
    });
  });

  it("treats fixture and replay samples as inventory rather than live rollout evidence", () => {
    const collector = new CapabilityRegistryV3ReceiptCollector({ enabled: true, maxReceipts: 10 });
    const receipts = [
      requireReceipt(
        collector,
        observation({ requestId: "fixture-c", cohort: "control", evidenceClass: "fixture" }),
      ),
      requireReceipt(
        collector,
        observation({ requestId: "replay-t", cohort: "treatment", evidenceClass: "replay" }),
      ),
    ];

    const report = evaluateCapabilityRegistryV3Rollout(receipts, {
      recallK: 1,
      minSamplesPerCohort: 1,
    });

    expect(report).toEqual(
      expect.objectContaining({
        eligibleLiveReceiptCount: 0,
        excludedNonLiveReceiptCount: 2,
        evidenceInventory: { fixture: 1, replay: 1, live: 0 },
        decision: expect.objectContaining({ status: "insufficient-evidence" }),
      }),
    );
  });

  it("is stable across receipt order and rejects tampered receipt evidence", () => {
    const receipts = liveEvaluationReceipts();
    const first = evaluateCapabilityRegistryV3Rollout(receipts, {
      recallK: 1,
      minSamplesPerCohort: 2,
    });
    const reversed = evaluateCapabilityRegistryV3Rollout([...receipts].reverse(), {
      recallK: 1,
      minSamplesPerCohort: 2,
    });
    expect(reversed).toEqual(first);

    const tampered = structuredClone(receipts[0]!);
    tampered.metrics.inputTokens += 1;
    expect(() =>
      evaluateCapabilityRegistryV3Rollout([tampered], {
        recallK: 1,
        minSamplesPerCohort: 1,
      }),
    ).toThrow("invalid or tampered receipt");
  });
});
