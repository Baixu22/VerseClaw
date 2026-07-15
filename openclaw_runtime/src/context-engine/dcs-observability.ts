/**
 * DCS dual-injection + workspace-scope observability counters.
 *
 * In-memory only (same pattern as observability/deprecation-counters).
 * Used for addendum 6 dual-injection character accounting and D3
 * workspace_scope_invalidated telemetry. Not a dashboard product surface.
 */
export type DcsInjectionChannel = "cvk_system_prompt_addition" | "dcs_transform_context";

export type DcsObservabilitySnapshot = {
  cvkSystemPromptAdditionCalls: number;
  cvkSystemPromptAdditionChars: number;
  dcsTransformContextCalls: number;
  dcsTransformContextChars: number;
  injectionDuplicateSuppressions: number;
  workspaceScopeBound: number;
  workspaceScopeInvalidated: number;
  contextLadderActionHits: Record<string, number>;
};

const ZERO: DcsObservabilitySnapshot = {
  cvkSystemPromptAdditionCalls: 0,
  cvkSystemPromptAdditionChars: 0,
  dcsTransformContextCalls: 0,
  dcsTransformContextChars: 0,
  injectionDuplicateSuppressions: 0,
  workspaceScopeBound: 0,
  workspaceScopeInvalidated: 0,
  contextLadderActionHits: {},
};

class DcsObservabilityRegistry {
  #counters: DcsObservabilitySnapshot = { ...ZERO, contextLadderActionHits: {} };

  /**
   * Record one CVK systemPromptAddition injection application.
   * `chars` is the actual addition length (0 when assemble produced none).
   */
  recordCvkSystemPromptAddition(chars: number): void {
    this.#counters.cvkSystemPromptAdditionCalls += 1;
    this.#counters.cvkSystemPromptAdditionChars += Math.max(0, Math.floor(chars));
  }

  /**
   * Record one DCS transformContext/assembler injection attempt.
   * When `suppressed` is true (exactly-once heading already present),
   * chars must be 0 and the suppression counter increments.
   */
  recordDcsTransformContextInjection(params: {
    chars: number;
    suppressed?: boolean;
  }): void {
    this.#counters.dcsTransformContextCalls += 1;
    if (params.suppressed) {
      this.#counters.injectionDuplicateSuppressions += 1;
      return;
    }
    this.#counters.dcsTransformContextChars += Math.max(0, Math.floor(params.chars));
  }

  recordWorkspaceScopeBound(delta = 1): void {
    this.#counters.workspaceScopeBound += delta;
  }

  recordWorkspaceScopeInvalidated(delta = 1): void {
    this.#counters.workspaceScopeInvalidated += delta;
  }

  recordContextLadderAction(action: string): void {
    const key = action.trim() || "unknown";
    this.#counters.contextLadderActionHits[key] =
      (this.#counters.contextLadderActionHits[key] ?? 0) + 1;
  }

  snapshot(): DcsObservabilitySnapshot {
    return {
      ...this.#counters,
      contextLadderActionHits: { ...this.#counters.contextLadderActionHits },
    };
  }

  reset(): void {
    this.#counters = { ...ZERO, contextLadderActionHits: {} };
  }
}

export const dcsObservability = new DcsObservabilityRegistry();
