// KE-P1-2: RetrievalEngine shadow mounting (would_retrieve + receipt, zero injection).
import { describe, expect, it } from "vitest";
import { RetrievalEngine } from "../../openclaw_runtime/src/knowledge/sekb/retrieval-engine";
import type { KnowledgeStore } from "../../openclaw_runtime/src/knowledge/sekb/knowledge-store";
import type { Principle } from "../../openclaw_runtime/src/knowledge/sekb/types";
import type {
  KeReceiptWriter,
  KeRetrievalShadowResult,
} from "../../openclaw_runtime/src/runtime-core/ke-retrieval-shadow";

const principle: Principle = {
  principle_id: "pr_1",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  title: "Review before durable writes",
  condition: "A runtime lesson is proposed",
  action: "Require explicit confirmation",
  reason: "Suggestion is not approval",
  full_content: "Review before durable knowledge writes.",
  task_types: ["codegen"],
  context_tags: ["knowledge", "review"],
  embedding: null,
  source_trajectories: ["traj_1"],
  created_by: "agent",
  status: "active",
  retrieval_count: 0,
  adoption_count: 0,
  post_adoption_success: 0,
  criticality: "high",
  pinned: true,
  metadata: {},
};

function makeStore(): KnowledgeStore {
  return {
    query_principles: () => [principle],
    increment_retrieval_count: () => {},
  } as unknown as KnowledgeStore;
}

const RETR_ON = { runtime: { coding: { sekb: { retrievalShadow: true } } } };

describe("RetrievalEngine shadow mounting", () => {
  it("records would_retrieve on retrieve_for_task without changing the result (zero injection)", () => {
    const shadows: KeRetrievalShadowResult[] = [];
    const engine = new RetrievalEngine({
      store: makeStore(),
      config: RETR_ON,
      onRetrievalShadow: (r) => shadows.push(r),
    });
    const result = engine.retrieve_for_task("review durable writes", "codegen", ["knowledge"], 3);
    // Retrieval result is unchanged (the shadow never alters it).
    expect(result).toHaveLength(1);
    expect(result[0]!.principle_id).toBe("pr_1");
    expect(shadows).toHaveLength(1);
    expect(shadows[0]!.enabled).toBe(true);
    expect(shadows[0]!.wouldRetrieve.length).toBeGreaterThan(0);
  });

  it("records would_retrieve on retrieve_for_error", () => {
    const shadows: KeRetrievalShadowResult[] = [];
    const engine = new RetrievalEngine({ store: makeStore(), config: RETR_ON, onRetrievalShadow: (r) => shadows.push(r) });
    engine.retrieve_for_error("command-exited-1", ["knowledge"], 3);
    expect(shadows).toHaveLength(1);
    expect(shadows[0]!.enabled).toBe(true);
  });

  it("flag off => no shadow, retrieval unchanged", () => {
    const shadows: KeRetrievalShadowResult[] = [];
    const engine = new RetrievalEngine({ store: makeStore(), config: {}, onRetrievalShadow: (r) => shadows.push(r) });
    const result = engine.retrieve_for_task("review durable writes", "codegen", ["knowledge"], 3);
    expect(result).toHaveLength(1);
    expect(shadows).toHaveLength(0);
  });

  it("persists the shadow receipt through the writer when enabled", () => {
    const written: unknown[] = [];
    const writer: KeReceiptWriter = {
      put: (input) => {
        written.push(input);
        return { ok: true, duplicate: false, receiptId: "rcpt_1", inserted: true };
      },
    };
    const engine = new RetrievalEngine({ store: makeStore(), config: RETR_ON, receiptWriter: writer });
    engine.retrieve_for_task("review durable writes", "codegen", ["knowledge"], 3);
    expect(written).toHaveLength(1);
  });
});
