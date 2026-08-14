import {
  canonicalizeMetadataValue,
  hashCapabilityMetadata,
  type CapabilityExecutionTopology,
} from "./capability-descriptor.js";
import {
  CAPABILITY_REGISTRY_V3_ROLLOUT_DECISION_SCHEMA_VERSION,
  isCapabilityRegistryV3RolloutTarget,
  type CapabilityRegistryV3RolloutCohort,
  type CapabilityRegistryV3RolloutDecision,
  type CapabilityRegistryV3RolloutMode,
  type CapabilityRegistryV3RolloutTarget,
} from "./rollout-control-v3.js";

export const CAPABILITY_REGISTRY_V3_RECEIPT_SCHEMA_VERSION =
  "capability-registry-v3-receipt/v1" as const;
export const CAPABILITY_REGISTRY_V3_EVALUATION_REPORT_SCHEMA_VERSION =
  "capability-registry-v3-evaluation-report/v1" as const;

export type CapabilityRegistryV3EvidenceClass = "fixture" | "replay" | "live";

export type CapabilityRegistryV3RecallExpectation = {
  category: string;
  workflowNamespace: string;
  capabilityId: string;
};

export type CapabilityRegistryV3RankedCandidates = {
  categories: readonly string[];
  workflowNamespaces: readonly string[];
  capabilityIds: readonly string[];
};

export type CapabilityRegistryV3ObservationMetrics = {
  firstCallSuccess: boolean;
  schemaRetryCount: number;
  fallback: boolean;
  policyDenied: boolean;
  inputTokens: number;
  cachedTokens: number;
  ttftMs: number;
  catalogEpoch: string;
  cacheMiss: boolean;
  pointerTokensSaved: number;
  topology: CapabilityExecutionTopology;
  topologySuccess: boolean;
  topologyLatencyMs: number;
};

export type CapabilityRegistryV3ObservationInput = {
  decision: CapabilityRegistryV3RolloutDecision;
  evidenceClass: CapabilityRegistryV3EvidenceClass;
  expected: CapabilityRegistryV3RecallExpectation;
  ranked: CapabilityRegistryV3RankedCandidates;
  metrics: CapabilityRegistryV3ObservationMetrics;
};

export type CapabilityRegistryV3Receipt = {
  schemaVersion: typeof CAPABILITY_REGISTRY_V3_RECEIPT_SCHEMA_VERSION;
  receiptHash: string;
  recordedAt: number;
  requestId: string;
  policyHash: string;
  target: CapabilityRegistryV3RolloutTarget;
  mode: CapabilityRegistryV3RolloutMode;
  cohort: Exclude<CapabilityRegistryV3RolloutCohort, "none">;
  evidenceClass: CapabilityRegistryV3EvidenceClass;
  expected: CapabilityRegistryV3RecallExpectation;
  ranked: {
    categories: string[];
    workflowNamespaces: string[];
    capabilityIds: string[];
  };
  metrics: CapabilityRegistryV3ObservationMetrics;
};

export type CapabilityRegistryV3MetricPoint = {
  name:
    | "capability_registry_v3.first_call_success"
    | "capability_registry_v3.schema_retry_count"
    | "capability_registry_v3.fallback"
    | "capability_registry_v3.policy_denial"
    | "capability_registry_v3.cache_miss"
    | "capability_registry_v3.pointer_tokens_saved"
    | "capability_registry_v3.topology_success"
    | "capability_registry_v3.topology_latency_ms";
  value: number;
  attributes: {
    cohort: Exclude<CapabilityRegistryV3RolloutCohort, "none">;
    mode: CapabilityRegistryV3RolloutMode;
    topology: CapabilityExecutionTopology;
    evidenceClass: CapabilityRegistryV3EvidenceClass;
  };
};

export type CapabilityRegistryV3MetricSink = {
  record(point: CapabilityRegistryV3MetricPoint): void;
};

export type CapabilityRegistryV3ReceiptCollectorSnapshot = {
  receiptCount: number;
  recordedCount: number;
  replayCount: number;
  conflictCount: number;
  evictedCount: number;
  metricSinkFailureCount: number;
  receipts: CapabilityRegistryV3Receipt[];
};

export type CapabilityRegistryV3ReceiptRecordResult =
  | { ok: true; receipt: CapabilityRegistryV3Receipt; replayed: boolean }
  | {
      ok: false;
      failure: {
        code:
          | "collector-disabled"
          | "observation-not-authorized"
          | "invalid-observation"
          | "receipt-conflict";
      };
    };

type StoredReceipt = {
  fingerprint: string;
  receipt: CapabilityRegistryV3Receipt;
};

const CAPABILITY_ID_PATTERN =
  /^(skill|tool|context):[a-z0-9][a-z0-9._-]{0,127}:[a-z0-9][a-z0-9._-]{0,127}$/;
const WORKFLOW_NAMESPACE_PATTERN =
  /^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63}){0,7}$/;
const CATEGORY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const CATALOG_EPOCH_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const VALID_COHORTS = new Set<CapabilityRegistryV3Receipt["cohort"]>([
  "shadow",
  "control",
  "treatment",
]);
const VALID_EVIDENCE_CLASSES = new Set<CapabilityRegistryV3EvidenceClass>([
  "fixture",
  "replay",
  "live",
]);
const VALID_TOPOLOGIES = new Set<CapabilityExecutionTopology>([
  "direct",
  "proxy",
  "code",
  "native",
]);
const VALID_MODES = new Set<CapabilityRegistryV3RolloutMode>([
  "off",
  "shadow",
  "opt-in",
  "canary",
]);
const MAX_RANKED_CANDIDATES = 100;
const MAX_RECEIPTS = 10_000;

function recordFailure(
  code: Extract<CapabilityRegistryV3ReceiptRecordResult, { ok: false }>["failure"]["code"],
): CapabilityRegistryV3ReceiptRecordResult {
  return { ok: false, failure: { code } };
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validRankedList(value: readonly string[], pattern: RegExp): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_RANKED_CANDIDATES &&
    value.every((entry) => typeof entry === "string" && pattern.test(entry))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function validObservation(input: CapabilityRegistryV3ObservationInput): boolean {
  const { decision, expected, ranked, metrics } = input;
  return (
    decision.schemaVersion === CAPABILITY_REGISTRY_V3_ROLLOUT_DECISION_SCHEMA_VERSION &&
    REQUEST_ID_PATTERN.test(decision.requestId) &&
    HASH_PATTERN.test(decision.policyHash) &&
    VALID_MODES.has(decision.mode) &&
    decision.observe === true &&
    decision.target !== undefined &&
    isCapabilityRegistryV3RolloutTarget(decision.target) &&
    VALID_COHORTS.has(decision.cohort as CapabilityRegistryV3Receipt["cohort"]) &&
    VALID_EVIDENCE_CLASSES.has(input.evidenceClass) &&
    CATEGORY_PATTERN.test(expected.category) &&
    WORKFLOW_NAMESPACE_PATTERN.test(expected.workflowNamespace) &&
    (expected.workflowNamespace === expected.category ||
      expected.workflowNamespace.startsWith(`${expected.category}.`)) &&
    CAPABILITY_ID_PATTERN.test(expected.capabilityId) &&
    validRankedList(ranked.categories, CATEGORY_PATTERN) &&
    validRankedList(ranked.workflowNamespaces, WORKFLOW_NAMESPACE_PATTERN) &&
    validRankedList(ranked.capabilityIds, CAPABILITY_ID_PATTERN) &&
    typeof metrics.firstCallSuccess === "boolean" &&
    nonNegativeInteger(metrics.schemaRetryCount) &&
    typeof metrics.fallback === "boolean" &&
    typeof metrics.policyDenied === "boolean" &&
    nonNegativeInteger(metrics.inputTokens) &&
    nonNegativeInteger(metrics.cachedTokens) &&
    nonNegativeFinite(metrics.ttftMs) &&
    CATALOG_EPOCH_PATTERN.test(metrics.catalogEpoch) &&
    typeof metrics.cacheMiss === "boolean" &&
    nonNegativeInteger(metrics.pointerTokensSaved) &&
    VALID_TOPOLOGIES.has(metrics.topology) &&
    typeof metrics.topologySuccess === "boolean" &&
    nonNegativeFinite(metrics.topologyLatencyMs)
  );
}

function validReceipt(receipt: CapabilityRegistryV3Receipt): boolean {
  try {
    if (
      !isRecord(receipt) ||
      !hasOnlyKeys(receipt, [
        "schemaVersion",
        "receiptHash",
        "recordedAt",
        "requestId",
        "policyHash",
        "target",
        "mode",
        "cohort",
        "evidenceClass",
        "expected",
        "ranked",
        "metrics",
      ]) ||
      receipt.schemaVersion !== CAPABILITY_REGISTRY_V3_RECEIPT_SCHEMA_VERSION ||
      !HASH_PATTERN.test(receipt.receiptHash) ||
      !nonNegativeInteger(receipt.recordedAt) ||
      !REQUEST_ID_PATTERN.test(receipt.requestId) ||
      !HASH_PATTERN.test(receipt.policyHash) ||
      !isCapabilityRegistryV3RolloutTarget(receipt.target) ||
      !VALID_MODES.has(receipt.mode) ||
      !VALID_COHORTS.has(receipt.cohort) ||
      !VALID_EVIDENCE_CLASSES.has(receipt.evidenceClass) ||
      !isRecord(receipt.expected) ||
      !hasOnlyKeys(receipt.expected, ["category", "workflowNamespace", "capabilityId"]) ||
      !isRecord(receipt.ranked) ||
      !hasOnlyKeys(receipt.ranked, ["categories", "workflowNamespaces", "capabilityIds"]) ||
      !isRecord(receipt.metrics) ||
      !hasOnlyKeys(receipt.metrics, [
        "firstCallSuccess",
        "schemaRetryCount",
        "fallback",
        "policyDenied",
        "inputTokens",
        "cachedTokens",
        "ttftMs",
        "catalogEpoch",
        "cacheMiss",
        "pointerTokensSaved",
        "topology",
        "topologySuccess",
        "topologyLatencyMs",
      ])
    ) {
      return false;
    }
    const observationValid = validObservation({
      decision: {
        schemaVersion: CAPABILITY_REGISTRY_V3_ROLLOUT_DECISION_SCHEMA_VERSION,
        requestId: receipt.requestId,
        policyHash: receipt.policyHash,
        target: receipt.target,
        mode: receipt.mode,
        observe: true,
        activate: receipt.cohort === "treatment",
        cohort: receipt.cohort,
        reason: receipt.cohort === "shadow" ? "shadow-only" : "explicit-opt-in",
      },
      evidenceClass: receipt.evidenceClass,
      expected: receipt.expected,
      ranked: receipt.ranked,
      metrics: receipt.metrics,
    });
    if (!observationValid) {
      return false;
    }
    const { receiptHash, ...withoutHash } = receipt;
    return hashCapabilityMetadata(withoutHash) === receiptHash;
  } catch {
    return false;
  }
}

function receiptProjection(input: CapabilityRegistryV3ObservationInput) {
  if (!input.decision.target || input.decision.cohort === "none") {
    throw new Error("observation decision is not recordable");
  }
  return {
    schemaVersion: CAPABILITY_REGISTRY_V3_RECEIPT_SCHEMA_VERSION,
    requestId: input.decision.requestId,
    policyHash: input.decision.policyHash,
    target: {
      providerId: input.decision.target.providerId,
      modelId: input.decision.target.modelId,
      workflowNamespace: input.decision.target.workflowNamespace,
    },
    mode: input.decision.mode,
    cohort: input.decision.cohort,
    evidenceClass: input.evidenceClass,
    expected: {
      category: input.expected.category,
      workflowNamespace: input.expected.workflowNamespace,
      capabilityId: input.expected.capabilityId,
    },
    ranked: {
      categories: [...input.ranked.categories],
      workflowNamespaces: [...input.ranked.workflowNamespaces],
      capabilityIds: [...input.ranked.capabilityIds],
    },
    metrics: {
      firstCallSuccess: input.metrics.firstCallSuccess,
      schemaRetryCount: input.metrics.schemaRetryCount,
      fallback: input.metrics.fallback,
      policyDenied: input.metrics.policyDenied,
      inputTokens: input.metrics.inputTokens,
      cachedTokens: input.metrics.cachedTokens,
      ttftMs: input.metrics.ttftMs,
      catalogEpoch: input.metrics.catalogEpoch,
      cacheMiss: input.metrics.cacheMiss,
      pointerTokensSaved: input.metrics.pointerTokensSaved,
      topology: input.metrics.topology,
      topologySuccess: input.metrics.topologySuccess,
      topologyLatencyMs: input.metrics.topologyLatencyMs,
    },
  } satisfies Omit<CapabilityRegistryV3Receipt, "receiptHash" | "recordedAt">;
}

function cloneReceipt(receipt: CapabilityRegistryV3Receipt): CapabilityRegistryV3Receipt {
  return JSON.parse(canonicalizeMetadataValue(receipt)) as CapabilityRegistryV3Receipt;
}

function metricPoints(receipt: CapabilityRegistryV3Receipt): CapabilityRegistryV3MetricPoint[] {
  const attributes = {
    cohort: receipt.cohort,
    mode: receipt.mode,
    topology: receipt.metrics.topology,
    evidenceClass: receipt.evidenceClass,
  };
  return [
    {
      name: "capability_registry_v3.first_call_success",
      value: Number(receipt.metrics.firstCallSuccess),
      attributes,
    },
    {
      name: "capability_registry_v3.schema_retry_count",
      value: receipt.metrics.schemaRetryCount,
      attributes,
    },
    {
      name: "capability_registry_v3.fallback",
      value: Number(receipt.metrics.fallback),
      attributes,
    },
    {
      name: "capability_registry_v3.policy_denial",
      value: Number(receipt.metrics.policyDenied),
      attributes,
    },
    {
      name: "capability_registry_v3.cache_miss",
      value: Number(receipt.metrics.cacheMiss),
      attributes,
    },
    {
      name: "capability_registry_v3.pointer_tokens_saved",
      value: receipt.metrics.pointerTokensSaved,
      attributes,
    },
    {
      name: "capability_registry_v3.topology_success",
      value: Number(receipt.metrics.topologySuccess),
      attributes,
    },
    {
      name: "capability_registry_v3.topology_latency_ms",
      value: receipt.metrics.topologyLatencyMs,
      attributes,
    },
  ];
}

/** Bounded, in-memory evidence projection. It is not a telemetry exporter or result store. */
export class CapabilityRegistryV3ReceiptCollector {
  readonly #enabled: boolean;
  readonly #maxReceipts: number;
  readonly #metricSink: CapabilityRegistryV3MetricSink | undefined;
  readonly #now: () => number;
  readonly #receipts = new Map<string, StoredReceipt>();
  #recordedCount = 0;
  #replayCount = 0;
  #conflictCount = 0;
  #evictedCount = 0;
  #metricSinkFailureCount = 0;

  constructor(input: {
    enabled?: boolean;
    maxReceipts: number;
    metricSink?: CapabilityRegistryV3MetricSink;
    now?: () => number;
  }) {
    if (
      !Number.isInteger(input.maxReceipts) ||
      input.maxReceipts < 1 ||
      input.maxReceipts > MAX_RECEIPTS
    ) {
      throw new Error("Capability Registry V3 maxReceipts must be an integer from 1 through 10000");
    }
    this.#enabled = input.enabled === true;
    this.#maxReceipts = input.maxReceipts;
    this.#metricSink = input.metricSink;
    this.#now = input.now ?? Date.now;
  }

  record(input: CapabilityRegistryV3ObservationInput): CapabilityRegistryV3ReceiptRecordResult {
    if (!this.#enabled) {
      return recordFailure("collector-disabled");
    }
    if (!isRecord(input) || !isRecord(input.decision)) {
      return recordFailure("invalid-observation");
    }
    if (typeof input.decision.observe !== "boolean") {
      return recordFailure("invalid-observation");
    }
    if (input.decision.observe !== true) {
      return recordFailure("observation-not-authorized");
    }
    let observationValid: boolean;
    try {
      observationValid = validObservation(input);
    } catch {
      observationValid = false;
    }
    if (!observationValid) {
      return recordFailure("invalid-observation");
    }
    const projection = receiptProjection(input);
    const fingerprint = hashCapabilityMetadata(projection);
    const existing = this.#receipts.get(input.decision.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        this.#conflictCount += 1;
        return recordFailure("receipt-conflict");
      }
      this.#replayCount += 1;
      return { ok: true, receipt: cloneReceipt(existing.receipt), replayed: true };
    }
    const now = this.#now();
    if (!nonNegativeFinite(now)) {
      return recordFailure("invalid-observation");
    }
    if (this.#receipts.size >= this.#maxReceipts) {
      const oldestRequestId = this.#receipts.keys().next().value as string | undefined;
      if (oldestRequestId) {
        this.#receipts.delete(oldestRequestId);
        this.#evictedCount += 1;
      }
    }
    const receiptWithoutHash = { ...projection, recordedAt: Math.floor(now) };
    const receipt: CapabilityRegistryV3Receipt = {
      ...receiptWithoutHash,
      receiptHash: hashCapabilityMetadata(receiptWithoutHash),
    };
    this.#receipts.set(input.decision.requestId, { fingerprint, receipt });
    this.#recordedCount += 1;
    if (this.#metricSink) {
      for (const point of metricPoints(receipt)) {
        try {
          this.#metricSink.record(point);
        } catch {
          this.#metricSinkFailureCount += 1;
        }
      }
    }
    return { ok: true, receipt: cloneReceipt(receipt), replayed: false };
  }

  snapshot(): CapabilityRegistryV3ReceiptCollectorSnapshot {
    return {
      receiptCount: this.#receipts.size,
      recordedCount: this.#recordedCount,
      replayCount: this.#replayCount,
      conflictCount: this.#conflictCount,
      evictedCount: this.#evictedCount,
      metricSinkFailureCount: this.#metricSinkFailureCount,
      receipts: [...this.#receipts.values()].map(({ receipt }) => cloneReceipt(receipt)),
    };
  }
}

export type CapabilityRegistryV3RecallAtK = {
  category: number;
  workflowNamespace: number;
  capability: number;
};

export type CapabilityRegistryV3CohortMetrics = {
  sampleCount: number;
  recallAtK: CapabilityRegistryV3RecallAtK;
  firstCallSuccessRate: number;
  schemaRetryRate: number;
  schemaRetriesPerRun: number;
  fallbackRate: number;
  policyDenialRate: number;
  inputTokens: { total: number; average: number };
  cachedTokens: { total: number; average: number };
  ttftMs: { average: number; p95: number };
  cacheMissRate: number;
  pointerTokensSaved: { total: number; average: number };
};

export type CapabilityRegistryV3TopologyMetrics = {
  topology: CapabilityExecutionTopology;
  sampleCount: number;
  successRate: number;
  latencyMs: { average: number; p95: number };
};

export type CapabilityRegistryV3CatalogEpochMetrics = {
  catalogEpoch: string;
  sampleCount: number;
  cacheMissCount: number;
  cacheMissRate: number;
};

export type CapabilityRegistryV3EvaluationReport = {
  schemaVersion: typeof CAPABILITY_REGISTRY_V3_EVALUATION_REPORT_SCHEMA_VERSION;
  reportHash: string;
  recallK: number;
  receiptCount: number;
  eligibleLiveReceiptCount: number;
  excludedNonLiveReceiptCount: number;
  evidenceInventory: Record<CapabilityRegistryV3EvidenceClass, number>;
  cohorts: {
    control: CapabilityRegistryV3CohortMetrics;
    treatment: CapabilityRegistryV3CohortMetrics;
    shadow: CapabilityRegistryV3CohortMetrics;
  };
  comparison: {
    treatmentMinusControl: {
      recallAtK: CapabilityRegistryV3RecallAtK;
      firstCallSuccessRate: number;
      schemaRetryRate: number;
      fallbackRate: number;
      policyDenialRate: number;
      cacheMissRate: number;
      pointerTokensSavedAverage: number;
    };
  };
  topology: CapabilityRegistryV3TopologyMetrics[];
  catalogEpochs: CapabilityRegistryV3CatalogEpochMetrics[];
  decision: {
    status: "insufficient-evidence" | "hold" | "reviewable";
    reasons: string[];
    locks: { defaultOn: false; liveReady: false; productApproved: false };
  };
};

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function average(values: readonly number[]): number {
  return rate(values.reduce((sum, value) => sum + value, 0), values.length);
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const ordered = [...values].toSorted((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

function includesAtK(values: readonly string[], expected: string, k: number): boolean {
  return values.slice(0, k).includes(expected);
}

function cohortMetrics(
  receipts: readonly CapabilityRegistryV3Receipt[],
  recallK: number,
): CapabilityRegistryV3CohortMetrics {
  const sampleCount = receipts.length;
  const inputTokens = receipts.map((receipt) => receipt.metrics.inputTokens);
  const cachedTokens = receipts.map((receipt) => receipt.metrics.cachedTokens);
  const ttft = receipts.map((receipt) => receipt.metrics.ttftMs);
  const pointerSavings = receipts.map((receipt) => receipt.metrics.pointerTokensSaved);
  return {
    sampleCount,
    recallAtK: {
      category: rate(
        receipts.filter((receipt) =>
          includesAtK(receipt.ranked.categories, receipt.expected.category, recallK),
        ).length,
        sampleCount,
      ),
      workflowNamespace: rate(
        receipts.filter((receipt) =>
          includesAtK(
            receipt.ranked.workflowNamespaces,
            receipt.expected.workflowNamespace,
            recallK,
          ),
        ).length,
        sampleCount,
      ),
      capability: rate(
        receipts.filter((receipt) =>
          includesAtK(receipt.ranked.capabilityIds, receipt.expected.capabilityId, recallK),
        ).length,
        sampleCount,
      ),
    },
    firstCallSuccessRate: rate(
      receipts.filter((receipt) => receipt.metrics.firstCallSuccess).length,
      sampleCount,
    ),
    schemaRetryRate: rate(
      receipts.filter((receipt) => receipt.metrics.schemaRetryCount > 0).length,
      sampleCount,
    ),
    schemaRetriesPerRun: average(
      receipts.map((receipt) => receipt.metrics.schemaRetryCount),
    ),
    fallbackRate: rate(
      receipts.filter((receipt) => receipt.metrics.fallback).length,
      sampleCount,
    ),
    policyDenialRate: rate(
      receipts.filter((receipt) => receipt.metrics.policyDenied).length,
      sampleCount,
    ),
    inputTokens: {
      total: inputTokens.reduce((sum, value) => sum + value, 0),
      average: average(inputTokens),
    },
    cachedTokens: {
      total: cachedTokens.reduce((sum, value) => sum + value, 0),
      average: average(cachedTokens),
    },
    ttftMs: { average: average(ttft), p95: percentile95(ttft) },
    cacheMissRate: rate(
      receipts.filter((receipt) => receipt.metrics.cacheMiss).length,
      sampleCount,
    ),
    pointerTokensSaved: {
      total: pointerSavings.reduce((sum, value) => sum + value, 0),
      average: average(pointerSavings),
    },
  };
}

function topologyMetrics(
  receipts: readonly CapabilityRegistryV3Receipt[],
): CapabilityRegistryV3TopologyMetrics[] {
  return (["direct", "proxy", "code", "native"] as const).map((topology) => {
    const matching = receipts.filter((receipt) => receipt.metrics.topology === topology);
    const latencies = matching.map((receipt) => receipt.metrics.topologyLatencyMs);
    return {
      topology,
      sampleCount: matching.length,
      successRate: rate(
        matching.filter((receipt) => receipt.metrics.topologySuccess).length,
        matching.length,
      ),
      latencyMs: { average: average(latencies), p95: percentile95(latencies) },
    };
  });
}

function catalogEpochMetrics(
  receipts: readonly CapabilityRegistryV3Receipt[],
): CapabilityRegistryV3CatalogEpochMetrics[] {
  const byEpoch = new Map<string, CapabilityRegistryV3Receipt[]>();
  for (const receipt of receipts) {
    const entries = byEpoch.get(receipt.metrics.catalogEpoch) ?? [];
    entries.push(receipt);
    byEpoch.set(receipt.metrics.catalogEpoch, entries);
  }
  return [...byEpoch.entries()]
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([catalogEpoch, entries]) => {
      const cacheMissCount = entries.filter((receipt) => receipt.metrics.cacheMiss).length;
      return {
        catalogEpoch,
        sampleCount: entries.length,
        cacheMissCount,
        cacheMissRate: rate(cacheMissCount, entries.length),
      };
    });
}

function subtractRecall(
  treatment: CapabilityRegistryV3RecallAtK,
  control: CapabilityRegistryV3RecallAtK,
): CapabilityRegistryV3RecallAtK {
  return {
    category: treatment.category - control.category,
    workflowNamespace: treatment.workflowNamespace - control.workflowNamespace,
    capability: treatment.capability - control.capability,
  };
}

/** Computes a live-evidence A/B report. Fixture/replay receipts remain inventory only. */
export function evaluateCapabilityRegistryV3Rollout(
  receipts: readonly CapabilityRegistryV3Receipt[],
  options: { recallK: number; minSamplesPerCohort: number; maxRecallDrop?: number },
): CapabilityRegistryV3EvaluationReport {
  if (!Number.isInteger(options.recallK) || options.recallK < 1 || options.recallK > 100) {
    throw new Error("Capability Registry V3 recallK must be an integer from 1 through 100");
  }
  if (
    !Number.isInteger(options.minSamplesPerCohort) ||
    options.minSamplesPerCohort < 1 ||
    options.minSamplesPerCohort > 1_000_000
  ) {
    throw new Error("Capability Registry V3 minSamplesPerCohort must be a positive integer");
  }
  const maxRecallDrop = options.maxRecallDrop ?? 0.05;
  if (!Number.isFinite(maxRecallDrop) || maxRecallDrop < 0 || maxRecallDrop > 1) {
    throw new Error("Capability Registry V3 maxRecallDrop must be between 0 and 1");
  }
  if (receipts.some((receipt) => !validReceipt(receipt))) {
    throw new Error("Capability Registry V3 evaluation received an invalid or tampered receipt");
  }
  const evidenceInventory = {
    fixture: receipts.filter((receipt) => receipt.evidenceClass === "fixture").length,
    replay: receipts.filter((receipt) => receipt.evidenceClass === "replay").length,
    live: receipts.filter((receipt) => receipt.evidenceClass === "live").length,
  };
  const eligible = receipts.filter((receipt) => receipt.evidenceClass === "live");
  const controlReceipts = eligible.filter((receipt) => receipt.cohort === "control");
  const treatmentReceipts = eligible.filter((receipt) => receipt.cohort === "treatment");
  const shadowReceipts = eligible.filter((receipt) => receipt.cohort === "shadow");
  const control = cohortMetrics(controlReceipts, options.recallK);
  const treatment = cohortMetrics(treatmentReceipts, options.recallK);
  const shadow = cohortMetrics(shadowReceipts, options.recallK);
  const recallDelta = subtractRecall(treatment.recallAtK, control.recallAtK);
  const reasons: string[] = [];
  let status: CapabilityRegistryV3EvaluationReport["decision"]["status"];
  if (
    control.sampleCount < options.minSamplesPerCohort ||
    treatment.sampleCount < options.minSamplesPerCohort
  ) {
    status = "insufficient-evidence";
    reasons.push("live-control-treatment-samples-below-minimum");
  } else if (
    recallDelta.category < -maxRecallDrop ||
    recallDelta.workflowNamespace < -maxRecallDrop ||
    recallDelta.capability < -maxRecallDrop
  ) {
    status = "hold";
    reasons.push("treatment-recall-regression-exceeds-limit");
  } else {
    status = "reviewable";
    reasons.push("live-sample-and-recall-gates-met");
  }
  const reportWithoutHash = {
    schemaVersion: CAPABILITY_REGISTRY_V3_EVALUATION_REPORT_SCHEMA_VERSION,
    recallK: options.recallK,
    receiptCount: receipts.length,
    eligibleLiveReceiptCount: eligible.length,
    excludedNonLiveReceiptCount: receipts.length - eligible.length,
    evidenceInventory,
    cohorts: { control, treatment, shadow },
    comparison: {
      treatmentMinusControl: {
        recallAtK: recallDelta,
        firstCallSuccessRate:
          treatment.firstCallSuccessRate - control.firstCallSuccessRate,
        schemaRetryRate: treatment.schemaRetryRate - control.schemaRetryRate,
        fallbackRate: treatment.fallbackRate - control.fallbackRate,
        policyDenialRate: treatment.policyDenialRate - control.policyDenialRate,
        cacheMissRate: treatment.cacheMissRate - control.cacheMissRate,
        pointerTokensSavedAverage:
          treatment.pointerTokensSaved.average - control.pointerTokensSaved.average,
      },
    },
    topology: topologyMetrics(eligible),
    catalogEpochs: catalogEpochMetrics(eligible),
    decision: {
      status,
      reasons,
      locks: { defaultOn: false as const, liveReady: false as const, productApproved: false as const },
    },
  };
  return {
    ...reportWithoutHash,
    reportHash: hashCapabilityMetadata(reportWithoutHash),
  };
}
