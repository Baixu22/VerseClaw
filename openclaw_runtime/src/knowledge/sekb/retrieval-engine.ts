import type { KnowledgeStore } from "./knowledge-store.js";
import {
  persistKeRetrievalShadowReceipt,
  runKeRetrievalShadow,
  type KeReceiptWriter,
  type KeRetrievalCandidate,
  type KeRetrievalShadowContext,
  type KeRetrievalShadowResult,
} from "../../runtime-core/ke-retrieval-shadow.js";
import { getPrincipleVersion, normalizeTags, type Principle } from "./types.js";

export type RetrievalEngineOptions = {
  store: KnowledgeStore;
  /** KE-P1-2 shadow retrieval config (runtime.coding.sekb.retrievalShadow). Off => no shadow. */
  config?: unknown;
  /** Receipt writer to persist the shadow_context receipt (optional). */
  receiptWriter?: KeReceiptWriter;
  /** Shadow result sink (tests/diagnostics). */
  onRetrievalShadow?: (result: KeRetrievalShadowResult) => void;
  /** Base context (taskId/runId/sessionKey/configDigest) for the shadow event. */
  shadowBase?: Partial<KeRetrievalShadowContext>;
};

type ScoredPrinciple = {
  principle: Principle;
  score: number;
};

/** Deterministic advisory retriever for SEKB principles. */
export class RetrievalEngine {
  readonly #store: KnowledgeStore;
  readonly #config: unknown;
  readonly #receiptWriter: KeReceiptWriter | undefined;
  readonly #onRetrievalShadow: ((result: KeRetrievalShadowResult) => void) | undefined;
  readonly #shadowBase: Partial<KeRetrievalShadowContext>;

  constructor(options: RetrievalEngineOptions) {
    this.#store = options.store;
    this.#config = options.config;
    this.#receiptWriter = options.receiptWriter;
    this.#onRetrievalShadow = options.onRetrievalShadow;
    this.#shadowBase = options.shadowBase ?? {};
  }

  retrieve_for_task(
    task_intent: string,
    task_type: string,
    context_tags: string[],
    top_k = 5,
  ): Principle[] {
    const tags = normalizeTags(context_tags);
    const taskType = task_type.trim().toLowerCase();
    const candidates = this.#store.query_principles({ status: "active", task_types: [taskType] })
      .filter((principle) =>
        tags.length === 0 || tags.some((tag) => principle.context_tags.includes(tag))
      );
    const query = [task_intent, taskType, ...tags].join(" ");
    this.#recordShadow(query, candidates, { taskType, contextTags: tags }, top_k);
    return this.#rank(candidates, query, top_k);
  }

  retrieve_for_error(error_signature: string, context_tags: string[], top_k = 3): Principle[] {
    const tags = normalizeTags(context_tags);
    const candidates = this.#store.query_principles({ status: "active" });
    const query = [error_signature, ...tags].join(" ");
    this.#recordShadow(query, candidates, { taskType: "error", contextTags: tags, errorSignature: error_signature }, top_k);
    return this.#rank(candidates, query, top_k);
  }

  format_for_injection(principles: Principle[]): string {
    return principles
      .map((principle, index) =>
        [
          `[Relevant SEKB principle ${index + 1}] ${principle.title}`,
          `Identity: ${principle.principle_id}@${getPrincipleVersion(principle)}`,
          `Condition: ${principle.condition}`,
          `Action: ${principle.action}`,
          `Reason: ${principle.reason}`,
          "---",
        ].join("\n")
      )
      .join("\n");
  }

  create_context_injector(): ContextInjector {
    return new ContextInjector(this);
  }

  /** KE-P1-2 shadow: record would_retrieve + receipt without changing retrieval. */
  #recordShadow(
    query: string,
    candidates: readonly Principle[],
    context: { taskType: string; contextTags: string[]; errorSignature?: string },
    topK: number,
  ): void {
    if (!this.#config) return;
    try {
      const result = runKeRetrievalShadow(
        this.#config,
        query,
        candidates.map((principle) => principleToKeCandidate(principle)),
        {
          taskId: this.#shadowBase.taskId ?? "sekb-retrieval",
          taskType: context.taskType,
          configDigest: this.#shadowBase.configDigest ?? "sekb-retrieval",
          ...this.#shadowBase,
          contextTags: context.contextTags,
          ...(context.errorSignature !== undefined ? { errorSignature: context.errorSignature } : {}),
        },
        topK,
      );
      if (!result.enabled) return;
      if (result.receipt && this.#receiptWriter) {
        persistKeRetrievalShadowReceipt(result, this.#receiptWriter);
      }
      this.#onRetrievalShadow?.(result);
    } catch {
      // Shadow retrieval must never perturb SEKB retrieval or injection.
    }
  }

  #rank(candidates: Principle[], query: string, topK: number): Principle[] {
    const ranked = candidates
      .map<ScoredPrinciple>((principle) => ({
        principle,
        score: lexicalScore(query, principle) + metadataScore(principle),
      }))
      .filter((item) => item.score > 0)
      .toSorted((left, right) =>
        right.score - left.score ||
        Number(right.principle.pinned) - Number(left.principle.pinned) ||
        left.principle.title.localeCompare(right.principle.title)
      )
      .slice(0, Math.max(0, Math.trunc(topK)))
      .map((item) => item.principle);
    for (const principle of ranked) {
      this.#store.increment_retrieval_count(principle.principle_id);
    }
    return ranked;
  }
}

/** Formats retrieved SEKB advice at the two MVP injection points. */
export class ContextInjector {
  readonly #engine: RetrievalEngine;

  constructor(engine: RetrievalEngine) {
    this.#engine = engine;
  }

  for_task(
    system_prompt: string,
    task_intent: string,
    task_type: string,
    context_tags: string[],
    onRetrieved?: (principles: readonly Principle[]) => void,
  ): string {
    const principles = this.#engine.retrieve_for_task(task_intent, task_type, context_tags);
    onRetrieved?.(principles);
    const injection = this.#engine.format_for_injection(principles);
    return injection ? `${system_prompt}\n${injection}` : system_prompt;
  }

  for_error(error_signature: string, context_tags: string[], onRetrieved?: (principles: readonly Principle[]) => void): string {
    const principles = this.#engine.retrieve_for_error(error_signature, context_tags);
    onRetrieved?.(principles);
    const injection = this.#engine.format_for_injection(principles);
    return injection ? `[SEKB historical error advice]\n${injection}` : "";
  }
}

function lexicalScore(query: string, principle: Principle): number {
  const queryTokens = tokens(query);
  if (queryTokens.size === 0) {
    return 0;
  }
  const haystack = tokens([
    principle.title,
    principle.condition,
    principle.action,
    principle.reason,
    principle.full_content,
    ...principle.task_types,
    ...principle.context_tags,
  ].join(" "));
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) {
      score += token.length > 4 ? 2 : 1;
    }
  }
  return score;
}

function metadataScore(principle: Principle): number {
  const criticality = { low: 0, medium: 0.1, high: 0.2, critical: 0.3 }[principle.criticality];
  return criticality + (principle.pinned ? 0.5 : 0);
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
}

function principleToKeCandidate(principle: Principle): KeRetrievalCandidate {
  return {
    envelopeId: principle.principle_id,
    contentVersion: principle.updated_at || principle.created_at,
    text: [
      principle.title,
      principle.condition,
      principle.action,
      principle.reason,
      principle.full_content,
    ].join(" "),
    tags: principle.context_tags,
    capturedAt: Date.parse(principle.created_at) || undefined,
    quality: { criticality: principle.criticality, pinned: principle.pinned },
  };
}
