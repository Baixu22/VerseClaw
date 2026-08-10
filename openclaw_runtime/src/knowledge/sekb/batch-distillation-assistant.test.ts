import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import { DistillationTool } from "./distillation-tool.js";
import {
  SekbBatchDistillationAssistant,
  type SekbBatchDistillationModelInput,
  type SekbBatchDistillationProvider,
  type SekbBatchDistillationSuggestion,
} from "./batch-distillation-assistant.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { buildSekbOperatorReport } from "./operator-report.js";
import type { Principle, Trajectory } from "./types.js";

const tempRoots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SekbBatchDistillationAssistant", () => {
  it("is exact deterministic parity while default-off and makes no evidence write", async () => {
    const store = createStore();
    const ids = seedTrajectories(store, 2);
    const distiller = new DistillationTool({ store });
    const provider: SekbBatchDistillationProvider = { suggest: vi.fn() };
    const assistant = createAssistant(store, { provider, enabled: false });

    const result = await assistant.suggest({ trajectoryIds: ids });

    expect(result.suggestions).toEqual(distiller.suggest_principles_from_trajectories(ids));
    expect(result.userVisibleStatus).toBe("feature_disabled");
    expect(provider.suggest).not.toHaveBeenCalled();
    expect(store.list_batch_distillation_events()).toEqual([]);
  });

  it("sends only opaque bounded projections and does not persist model input or output", async () => {
    const store = createStore();
    const secret = "sk-batch-projection-must-not-leak";
    const trajectoryId = `raw-${randomUUID()}`;
    store.save_trajectory(trajectory({
      trajectory_id: trajectoryId,
      task_intent: `intent ${secret}`,
      task_type: "config/db",
      context_fingerprint: ["postgresql", secret],
      error_signature: `RawError ${secret}`,
      steps: [{
        action: "tool.call",
        input: { prompt: secret, secret },
        output: { raw_error: secret },
        timestamp: "2026-07-14T00:00:00.000Z",
      }],
    }));
    const principle = existingPrinciple({
      title: `existing ${secret}`,
      full_content: `full principle ${secret}`,
    });
    store.save_principle(principle);
    let input: SekbBatchDistillationModelInput | undefined;
    const outputTitle = "LLM output must stay ephemeral";
    const assistant = createAssistant(store, {
      provider: {
        suggest: async (payload) => {
          input = payload;
          return response({ title: outputTitle, sourceRefs: ["t1"], principleRefs: ["p1"] });
        },
      },
    });

    const result = await assistant.suggest({ trajectoryIds: [trajectoryId], minClusterSize: 1 });

    const serializedInput = JSON.stringify(input);
    expect(serializedInput).not.toContain(secret);
    expect(serializedInput).not.toContain(trajectoryId);
    expect(serializedInput).not.toContain(principle.principle_id);
    expect(serializedInput).not.toContain("full principle");
    expect(input).toMatchObject({
      schema: "sekb-batch-distillation-input.v1",
      trajectories: [expect.objectContaining({ trajectory_ref: "t1", error_signature: expect.stringMatching(/^sig-/) })],
      existing_principles: [expect.objectContaining({ principle_ref: "p1" })],
    });
    expect(result.userVisibleStatus).toBe("ready");
    const eventJson = JSON.stringify(store.list_batch_distillation_events());
    expect(eventJson).not.toContain(secret);
    expect(eventJson).not.toContain(outputTitle);
    expect(eventJson).not.toContain(trajectoryId);
  });

  it("maps validated source attribution and conflicts back to local ids without mutation before confirmation", async () => {
    const store = createStore();
    const ids = seedTrajectories(store, 2);
    const existing = existingPrinciple();
    store.save_principle(existing);
    const beforeIndex = store.get_index();
    const beforeUndistilled = store.query_trajectories({ distilled: false }).map((trajectory) => trajectory.trajectory_id);
    const attempts: number[] = [];
    const assistant = createAssistant(store, {
      onAttempt: (event) => attempts.push(event.attempt),
      provider: {
        suggest: async () => response({ sourceRefs: ["t1", "t2"], principleRefs: ["p1"] }),
      },
    });

    const result = await assistant.suggest({ trajectoryIds: ids });
    const suggestion = result.suggestions[0] as SekbBatchDistillationSuggestion;

    expect(result.userVisibleStatus).toBe("ready");
    expect(attempts).toEqual([1]);
    expect(suggestion).toMatchObject({
      source_trajectory_ids: ids,
      related_principle_ids: [existing.principle_id],
      conflicts: [{ principle_id: existing.principle_id, reason: "Overlaps existing scoped principle" }],
      skipped_reason: null,
    });
    expect(store.query_principles({})).toHaveLength(1);
    expect(store.query_trajectories({ distilled: false }).map((trajectory) => trajectory.trajectory_id)).toEqual(beforeUndistilled);
    expect(store.get_index()).toBe(beforeIndex);
    expect(store.list_batch_distillation_events()[0]).toMatchObject({
      status: "assisted",
      suggestion_count: 1,
      attributed_suggestion_count: 1,
      input_tokens: 21,
      output_tokens: 13,
      total_cost_usd: 0.03,
    });
  });

  it("uses one observable retry then deterministic fallback for timeout, unavailable provider, invalid JSON, and schema errors", async () => {
    const scenarios: Array<{
      name: string;
      provider?: SekbBatchDistillationProvider;
      expectedStatus: string;
      expectedAttempts: number;
    }> = [
      {
        name: "provider unavailable",
        provider: undefined,
        expectedStatus: "provider_unavailable",
        expectedAttempts: 0,
      },
      {
        name: "invalid JSON",
        provider: { suggest: vi.fn(async () => ({ content: "not json" })) },
        expectedStatus: "invalid_response",
        expectedAttempts: 2,
      },
      {
        name: "schema error",
        provider: {
          suggest: vi.fn(async () => ({
            content: JSON.stringify({
              schema: "sekb-batch-distillation-output.v1",
              suggestions: [],
              unexpected_field: true,
            }),
          })),
        },
        expectedStatus: "invalid_response",
        expectedAttempts: 2,
      },
    ];

    for (const scenario of scenarios) {
      const store = createStore();
      const ids = seedTrajectories(store, 2);
      const distiller = new DistillationTool({ store });
      const attempts: number[] = [];
      const assistant = createAssistant(store, { provider: scenario.provider, onAttempt: (event) => attempts.push(event.attempt) });
      const result = await assistant.suggest({ trajectoryIds: ids });

      expect(result.userVisibleStatus, scenario.name).toBe(scenario.expectedStatus);
      expect(result.suggestions, scenario.name).toEqual(distiller.suggest_principles_from_trajectories(ids));
      expect(result.operatorEvidence.attempts, scenario.name).toBe(scenario.expectedAttempts);
      expect(attempts, scenario.name).toHaveLength(scenario.expectedAttempts);
      expect(store.list_batch_distillation_events()[0]?.status, scenario.name).toBe("fallback");
    }
  });

  it("times out at 30 seconds, retries once, and returns deterministic fallback", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const ids = seedTrajectories(store, 2);
    const distiller = new DistillationTool({ store });
    const provider = {
      suggest: vi.fn((_input, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as SekbBatchDistillationProvider["suggest"],
    } as SekbBatchDistillationProvider;
    const assistant = createAssistant(store, { provider });
    const pending = assistant.suggest({ trajectoryIds: ids });

    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(provider.suggest).toHaveBeenCalledTimes(2);
    expect(result.userVisibleStatus).toBe("timeout");
    expect(result.operatorEvidence).toMatchObject({ attempts: 2, retryAttempted: true, fallbackReason: "timeout" });
    expect(result.suggestions).toEqual(distiller.suggest_principles_from_trajectories(ids));
  });

  it("enforces input limits before calling the provider and output limits before deterministic fallback", async () => {
    const store = createStore();
    const ids = seedTrajectories(store, 21);
    const provider: SekbBatchDistillationProvider = { suggest: vi.fn() };
    const assistant = createAssistant(store, { provider });

    const result = await assistant.suggest({ trajectoryIds: ids });

    expect(provider.suggest).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      userVisibleStatus: "request_limit",
      operatorEvidence: { status: "fallback", fallbackReason: "limit_exceeded", attempts: 0 },
    });

    const outputLimitedStore = createStore();
    const outputLimitedIds = seedTrajectories(outputLimitedStore, 2);
    const outputLimitedProvider: SekbBatchDistillationProvider = {
      suggest: vi.fn(async () => outputLimitResponse()),
    };
    const outputLimitedAssistant = createAssistant(outputLimitedStore, { provider: outputLimitedProvider });
    const outputLimited = await outputLimitedAssistant.suggest({ trajectoryIds: outputLimitedIds });

    expect(outputLimitedProvider.suggest).toHaveBeenCalledTimes(2);
    expect(outputLimited).toMatchObject({
      userVisibleStatus: "request_limit",
      operatorEvidence: { status: "fallback", fallbackReason: "limit_exceeded", attempts: 2 },
    });
  });

  it("soft-skips missing trajectory ids without throwing and reports skipped count", async () => {
    const store = createStore();
    const ids = seedTrajectories(store, 2);
    const missing = `missing-${randomUUID()}`;
    const provider: SekbBatchDistillationProvider = {
      suggest: async () => response({ sourceRefs: ["t1"] }),
    };
    const assistant = createAssistant(store, { provider });

    const result = await assistant.suggest({
      trajectoryIds: [ids[0], missing, ids[1]],
      minClusterSize: 1,
    });

    expect(result.userVisibleStatus).toBe("ready");
    expect(result.operatorEvidence.skippedMissingTrajectoryIds).toBe(1);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("returns no_eligible_trajectories when every requested id is missing", async () => {
    const store = createStore();
    seedTrajectories(store, 1);
    const assistant = createAssistant(store, {
      provider: { suggest: vi.fn() },
    });

    const result = await assistant.suggest({
      trajectoryIds: [`missing-${randomUUID()}`],
      minClusterSize: 1,
    });

    expect(result.userVisibleStatus).toBe("no_eligible_trajectories");
    expect(result.operatorEvidence.skippedMissingTrajectoryIds).toBe(1);
    expect(result.operatorEvidence.fallbackReason).toBe("no_eligible_trajectories");
  });

  it("records confirmation/rejection aggregates and read-only report metrics without retaining model text", async () => {
    const store = createStore();
    const ids = seedTrajectories(store, 2);
    const assistant = createAssistant(store, {
      provider: { suggest: async () => response({ sourceRefs: ["t1", "t2"] }) },
    });
    const result = await assistant.suggest({ trajectoryIds: ids });
    const suggestion = result.suggestions[0] as SekbBatchDistillationSuggestion;
    const distiller = new DistillationTool({ store });

    const principleId = distiller.confirm_and_save(suggestion);
    store.record_adoption(principleId, true);
    distiller.reject_suggestion(suggestion, "operator free-form text must not be persisted with LLM output");
    const report = buildSekbOperatorReport(store, { batchDistillationAssistantEnabled: true });

    expect(store.list_distillation_rejections()).toEqual([]);
    expect(report.evidence.batchDistillationAssistant).toMatchObject({
      state: "ready",
      suggestionCount: { status: "available", value: 1 },
      acceptedCount: { status: "available", value: 1 },
      rejectedCount: { status: "available", value: 1 },
      normalizedEditDistance: { status: "available", value: 0 },
      duplicateSuggestionRate: { status: "available", value: 0 },
      sourceAttributionCompleteness: { status: "available", value: 1 },
      inputTokens: { status: "available", value: 21 },
      outputTokens: { status: "available", value: 13 },
      totalCostUsd: { status: "available", value: 0.03 },
      fallbackCount: { status: "available", value: 0 },
      subsequentAdoption: { status: "available", value: 1 },
    });
    expect(JSON.stringify(store.list_batch_distillation_events())).not.toContain("LLM output");
  });
});

function createAssistant(
  store: KnowledgeStore,
  overrides: Partial<Omit<ConstructorParameters<typeof SekbBatchDistillationAssistant>[0], "store" | "fallback">> = {},
): SekbBatchDistillationAssistant {
  const distiller = new DistillationTool({ store });
  return new SekbBatchDistillationAssistant({
    store,
    enabled: true,
    fallback: (trajectoryIds, minClusterSize) =>
      distiller.suggest_principles_from_trajectories(trajectoryIds, minClusterSize),
    ...overrides,
  });
}

function createStore(): KnowledgeStore {
  const root = mkdtempSync(path.join(os.tmpdir(), "openclaw-sekb-batch-test-"));
  tempRoots.push(root);
  return new KnowledgeStore({ database: { path: path.join(root, "openclaw.sqlite") } });
}

function seedTrajectories(store: KnowledgeStore, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const trajectoryId = `trajectory-${index + 1}-${randomUUID()}`;
    store.save_trajectory(trajectory({ trajectory_id: trajectoryId }));
    return trajectoryId;
  });
}

function trajectory(overrides: Partial<Trajectory> = {}): Trajectory {
  return {
    trajectory_id: overrides.trajectory_id ?? randomUUID(),
    created_at: overrides.created_at ?? "2026-07-14T00:00:00.000Z",
    task_intent: overrides.task_intent ?? "connect PostgreSQL for the deployment",
    task_type: overrides.task_type ?? "config/db",
    context_fingerprint: overrides.context_fingerprint ?? ["postgresql"],
    steps: overrides.steps ?? [{ action: "tool.call", input: { command: "psql" }, output: {}, timestamp: "2026-07-14T00:00:00.000Z" }],
    outcome: overrides.outcome ?? "failure",
    error_signature: overrides.error_signature ?? "ConnectionError::db_connection_refused::postgresql",
    cost: overrides.cost ?? { tokens: 10, duration_seconds: 1, retries: 0 },
    distilled: overrides.distilled ?? false,
    distilled_into: overrides.distilled_into ?? [],
    expires_at: overrides.expires_at ?? null,
    metadata: overrides.metadata ?? {},
  };
}

function existingPrinciple(overrides: Partial<Principle> = {}): Principle {
  return {
    principle_id: overrides.principle_id ?? randomUUID(),
    created_at: overrides.created_at ?? "2026-07-14T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-07-14T00:00:00.000Z",
    title: overrides.title ?? "Existing PostgreSQL setup rule",
    condition: overrides.condition ?? "When configuring PostgreSQL",
    action: overrides.action ?? "Review network and authentication configuration",
    reason: overrides.reason ?? "The existing scope may overlap a new suggestion",
    full_content: overrides.full_content ?? "Existing bounded principle content",
    task_types: overrides.task_types ?? ["config/db"],
    context_tags: overrides.context_tags ?? ["postgresql"],
    embedding: overrides.embedding ?? null,
    source_trajectories: overrides.source_trajectories ?? [],
    created_by: overrides.created_by ?? "human",
    status: overrides.status ?? "active",
    retrieval_count: overrides.retrieval_count ?? 0,
    adoption_count: overrides.adoption_count ?? 0,
    post_adoption_success: overrides.post_adoption_success ?? 0,
    criticality: overrides.criticality ?? "medium",
    pinned: overrides.pinned ?? false,
    metadata: overrides.metadata ?? {},
  };
}

function response(input: {
  title?: string;
  sourceRefs?: string[];
  principleRefs?: string[];
} = {}): { content: string; traceId: string; usage: { inputTokens: number; outputTokens: number; totalCostUsd: number } } {
  return {
    content: JSON.stringify({
      schema: "sekb-batch-distillation-output.v1",
      suggestions: [{
        title: input.title ?? "Check PostgreSQL access",
        condition: "When PostgreSQL connection attempts fail",
        action: "Verify the service, network access, and authentication rules",
        reason: "Repeated bounded trajectory evidence indicates configuration failure",
        source_trajectory_refs: input.sourceRefs ?? ["t1"],
        related_principle_refs: input.principleRefs ?? [],
        conflicts: input.principleRefs?.length
          ? [{ principle_ref: input.principleRefs[0], reason: "Overlaps existing scoped principle" }]
          : [],
        confidence: 0.8,
        skipped_reason: null,
      }],
    }),
    traceId: "provider-trace-1",
    usage: { inputTokens: 21, outputTokens: 13, totalCostUsd: 0.03 },
  };
}

function outputLimitResponse(): { content: string } {
  return {
    content: JSON.stringify({
      schema: "sekb-batch-distillation-output.v1",
      suggestions: Array.from({ length: 9 }, () => ({
        title: "Bounded output",
        condition: "When bounded test runs",
        action: "Return deterministic fallback",
        reason: "The output cap is enforced",
        source_trajectory_refs: ["t1"],
        related_principle_refs: [],
        conflicts: [],
        confidence: 0.5,
        skipped_reason: null,
      })),
    }),
  };
}
