/**
 * DCS dual-injection + workspace-scope observability counters.
 *
 * In-memory only (same pattern as observability/deprecation-counters).
 * Used for addendum 6 dual-injection character accounting and D3
 * workspace_scope_invalidated telemetry. Not a dashboard product surface.
 *
 * D7 residual: counters live in process memory with no out-of-process read
 * path. `writeSoakSnapshot(targetDir)` is the minimal on-disk export added for
 * TF-0006 soak operators; it is NEVER auto-called by the runtime and is NOT
 * gated by any flag/feature/default. Only an explicit in-process caller
 * (future host-api route or developer surface, out of scope here) invokes it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  vtokenAssemblyCalls: number;
  vtokenAssemblySuccesses: number;
  vtokenAssemblyErrors: number;
  vtokenAssemblyChars: number;
  vtokenAssemblyEstimatedTokens: number;
  vtokenSourcesIngested: number;
  /**
   * #182: of the sources VToken ingested, how many were already rendered into
   * the system prompt, plus the characters that represents. Measurement only —
   * nothing is deduplicated on the strength of this.
   */
  vtokenPromptOverlapSources: number;
  vtokenPromptOverlapChars: number;
  vtokenPromptOverlapToolSchemas: number;
  /**
   * #183: memory bytes `role-spawn` rendered into a spawned child's system
   * prompt. That path never charges the turn ledger (the bytes land in a
   * *different* session's prompt), so the only honest way to keep it visible is
   * to count it here instead of pretending it is budgeted.
   */
  roleSpawnMemoryInjectionCalls: number;
  roleSpawnMemoryInjectionChars: number;
  roleSpawnMemoryInjectionCards: number;
  /**
   * Read failures on the context/memory receipt surface. Those readers are
   * deliberately fail-open (they return an empty list and never throw), so
   * without this counter "nothing was injected" and "the store could not be
   * read" look identical to the caller and to the panel.
   */
  memoryReceiptReadFailures: number;
  /**
   * Read failures on the context-item registry surface. `query()` returns []
   * and `get()` returns undefined on a store error by design, so without this
   * counter a failed read is indistinguishable from "there are no items".
   */
  contextItemReadFailures: number;
  /** #182: the most recent VToken overlap breakdown (numerators + totals). */
  lastVtokenOverlap: {
    sourceCount: number;
    overlappingSourceCount: number;
    overlappingSourceChars: number;
    toolSchemaCount: number;
    overlappingToolSchemaCount: number;
  } | null;
  contextOrchestratorCalls: number;
  contextOrchestratorKillSwitchHits: number;
  contextOrchestratorErrors: number;
  contextOrchestratorCharsAdded: number;
  injectionBudgetOverflows: number;
  injectionBudgetTruncations: number;
  injectionBudgetDrops: number;
  injectionBudgetRequestedChars: number;
  injectionBudgetAppliedChars: number;
  /**
   * #184: assembles that fell back to the smaller per-assemble budget because
   * the caller did not supply a `turnId`, plus the ceiling that actually
   * applied. A silent 3x budget reduction is exactly the kind of invisible
   * degradation this project treats as a defect, so it is counted.
   */
  injectionBudgetFallbacks: number;
  injectionBudgetFallbackChars: number;
  /** FP-P0-05: turn-scoped shared budget across ALL injection sources. */
  turnInjectionTurns: number;
  turnInjectionKilledTurns: number;
  turnInjectionAppliedChars: number;
  turnInjectionRequestedChars: number;
  turnInjectionDroppedChars: number;
  turnInjectionTruncatedChars: number;
  turnInjectionDropAlerts: number;
  /**
   * FP-P1-11: per-channel detail of the MOST RECENT turn. Aggregate
   * counters cannot answer "which sources charged this turn" or "was the
   * degradation order the declared precedence", so the last turn's
   * breakdown is retained for the runtime ack evidence surface.
   */
  lastTurnInjection: {
    turnId?: string;
    killed: boolean;
    charsApplied: number;
    charsRequested: number;
    charsDropped: number;
    charsTruncated: number;
    byChannel: Record<string, { requested: number; applied: number; disposition: string }>;
    degradationOrder: Array<{ channel: string; disposition: string }>;
    /** #184: applied chars that repeated content an earlier channel injected. */
    crossInjectionDuplicateChars: number;
    /** #184: crossInjectionDuplicateChars / charsApplied for the last turn. */
    crossInjectionDuplicationRatio: number;
  } | null;
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
  vtokenAssemblyCalls: 0,
  vtokenAssemblySuccesses: 0,
  vtokenAssemblyErrors: 0,
  vtokenAssemblyChars: 0,
  vtokenAssemblyEstimatedTokens: 0,
  vtokenSourcesIngested: 0,
  vtokenPromptOverlapSources: 0,
  vtokenPromptOverlapChars: 0,
  vtokenPromptOverlapToolSchemas: 0,
  roleSpawnMemoryInjectionCalls: 0,
  roleSpawnMemoryInjectionChars: 0,
  roleSpawnMemoryInjectionCards: 0,
  memoryReceiptReadFailures: 0,
  contextItemReadFailures: 0,
  lastVtokenOverlap: null,
  contextOrchestratorCalls: 0,
  contextOrchestratorKillSwitchHits: 0,
  contextOrchestratorErrors: 0,
  contextOrchestratorCharsAdded: 0,
  injectionBudgetOverflows: 0,
  injectionBudgetTruncations: 0,
  injectionBudgetDrops: 0,
  injectionBudgetRequestedChars: 0,
  injectionBudgetAppliedChars: 0,
  injectionBudgetFallbacks: 0,
  injectionBudgetFallbackChars: 0,
  turnInjectionTurns: 0,
  turnInjectionKilledTurns: 0,
  turnInjectionAppliedChars: 0,
  turnInjectionRequestedChars: 0,
  turnInjectionDroppedChars: 0,
  turnInjectionTruncatedChars: 0,
  turnInjectionDropAlerts: 0,
  lastTurnInjection: null,
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
  recordDcsTransformContextInjection(params: { chars: number; suppressed?: boolean }): void {
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

  recordVtokenAssembly(params: {
    success: boolean;
    chars?: number;
    estimatedTokens?: number;
    sourcesIngested?: number;
  }): void {
    this.#counters.vtokenAssemblyCalls += 1;
    if (!params.success) {
      this.#counters.vtokenAssemblyErrors += 1;
      return;
    }
    this.#counters.vtokenAssemblySuccesses += 1;
    this.#counters.vtokenAssemblyChars += Math.max(0, Math.floor(params.chars ?? 0));
    this.#counters.vtokenAssemblyEstimatedTokens += Math.max(
      0,
      Math.floor(params.estimatedTokens ?? 0),
    );
    this.#counters.vtokenSourcesIngested += Math.max(0, Math.floor(params.sourcesIngested ?? 0));
  }

  /**
   * Record a failed read on the context-item registry surface (query/get).
   */
  recordContextItemReadFailure(params: { operation: "query" | "get" }): void {
    this.#counters.contextItemReadFailures += 1;
    void params.operation;
  }

  /**
   * Record a failed read on the memory-injection receipt surface. The reader
   * still returns [] (fail-open), but the failure is now countable.
   */
  recordMemoryReceiptReadFailure(): void {
    this.#counters.memoryReceiptReadFailures += 1;
  }

  /**
   * #183: record one role-spawn memory injection into a child system prompt.
   * Emitted from the renderer so the "role-spawn bypasses the turn budget" gap
   * has a number instead of only a code-path argument.
   */
  recordRoleSpawnMemoryInjection(params: { chars: number; cardCount: number }): void {
    this.#counters.roleSpawnMemoryInjectionCalls += 1;
    this.#counters.roleSpawnMemoryInjectionChars += Math.max(0, Math.floor(params.chars));
    this.#counters.roleSpawnMemoryInjectionCards += Math.max(0, Math.floor(params.cardCount));
  }

  /**
   * #182: record how much of one VToken call's input the system prompt already
   * carried. Emitted from the call site that builds VToken's inputs, so the
   * overlap is measured on the real wiring rather than inferred.
   */
  recordVtokenPromptOverlap(params: {
    sourceCount: number;
    overlappingSourceCount: number;
    overlappingSourceChars: number;
    toolSchemaCount: number;
    overlappingToolSchemaCount: number;
  }): void {
    const overlappingSourceCount = Math.max(0, Math.floor(params.overlappingSourceCount));
    const overlappingSourceChars = Math.max(0, Math.floor(params.overlappingSourceChars));
    const overlappingToolSchemaCount = Math.max(0, Math.floor(params.overlappingToolSchemaCount));
    this.#counters.vtokenPromptOverlapSources += overlappingSourceCount;
    this.#counters.vtokenPromptOverlapChars += overlappingSourceChars;
    this.#counters.vtokenPromptOverlapToolSchemas += overlappingToolSchemaCount;
    this.#counters.lastVtokenOverlap = {
      sourceCount: Math.max(0, Math.floor(params.sourceCount)),
      overlappingSourceCount,
      overlappingSourceChars,
      toolSchemaCount: Math.max(0, Math.floor(params.toolSchemaCount)),
      overlappingToolSchemaCount,
    };
  }

  recordContextOrchestrator(params: {
    killSwitch: boolean;
    stages: number;
    charsAdded: number;
    error?: boolean;
  }): void {
    this.#counters.contextOrchestratorCalls += 1;
    if (params.killSwitch) {
      this.#counters.contextOrchestratorKillSwitchHits += 1;
    }
    if (params.error) {
      this.#counters.contextOrchestratorErrors += 1;
    }
    this.#counters.contextOrchestratorCharsAdded += Math.max(0, Math.floor(params.charsAdded ?? 0));
  }

  /** TASK-P2-03: overflow / truncation against shared injection budget. */
  /**
   * FP-P0-05: record one turn's shared-budget accounting.
   * `appliedChars` is the turn's real prompt growth across every injection source,
   * so these counters can be summed and cross-checked against the prompt.
   */
  recordTurnInjectionAccounting(params: {
    killed: boolean;
    charsApplied: number;
    charsRequested: number;
    charsDropped: number;
    charsTruncated: number;
    alert: boolean;
    turnId?: string;
    byChannel?: Record<string, { requested: number; applied: number; disposition: string }>;
    degradationOrder?: Array<{ channel: string; disposition: string }>;
    crossInjectionDuplicateChars?: number;
    crossInjectionDuplicationRatio?: number;
  }): void {
    // FP-P1-11: keep this turn's per-channel breakdown so the runtime ack
    // can prove WHICH sources charged and in what order they degraded.
    this.#counters.lastTurnInjection = {
      ...(params.turnId ? { turnId: params.turnId } : {}),
      killed: params.killed,
      charsApplied: params.charsApplied,
      charsRequested: params.charsRequested,
      charsDropped: params.charsDropped,
      charsTruncated: params.charsTruncated,
      byChannel: { ...params.byChannel },
      degradationOrder: [...(params.degradationOrder ?? [])],
      crossInjectionDuplicateChars: Math.max(
        0,
        Math.floor(params.crossInjectionDuplicateChars ?? 0),
      ),
      crossInjectionDuplicationRatio: Math.max(
        0,
        Number(params.crossInjectionDuplicationRatio ?? 0),
      ),
    };
    this.#counters.turnInjectionTurns += 1;
    if (params.killed) {
      this.#counters.turnInjectionKilledTurns += 1;
    }
    this.#counters.turnInjectionAppliedChars += Math.max(0, Math.floor(params.charsApplied));
    this.#counters.turnInjectionRequestedChars += Math.max(0, Math.floor(params.charsRequested));
    this.#counters.turnInjectionDroppedChars += Math.max(0, Math.floor(params.charsDropped));
    this.#counters.turnInjectionTruncatedChars += Math.max(0, Math.floor(params.charsTruncated));
    if (params.alert) {
      this.#counters.turnInjectionDropAlerts += 1;
    }
  }

  /**
   * #184: record one injection that degraded to the per-assemble fallback
   * budget because no `turnId` was available. `effectiveLimit` is the ceiling
   * that actually applied; `turnLimit` is what a turnId-carrying call would
   * have received, so the delta is auditable.
   */
  recordInjectionBudgetFallback(params: {
    effectiveLimit: number;
    turnLimit: number;
    scope: string;
  }): void {
    this.#counters.injectionBudgetFallbacks += 1;
    this.#counters.injectionBudgetFallbackChars += Math.max(
      0,
      Math.floor(params.effectiveLimit),
    );
  }

  recordInjectionBudgetOverflow(params: {
    channel: string;
    requested: number;
    applied: number;
    dropped: boolean;
  }): void {
    this.#counters.injectionBudgetOverflows += 1;
    this.#counters.injectionBudgetRequestedChars += Math.max(0, Math.floor(params.requested));
    this.#counters.injectionBudgetAppliedChars += Math.max(0, Math.floor(params.applied));
    if (params.dropped) {
      this.#counters.injectionBudgetDrops += 1;
    } else if (params.applied > 0 && params.applied < params.requested) {
      this.#counters.injectionBudgetTruncations += 1;
    }
  }

  snapshot(): DcsObservabilitySnapshot {
    return {
      ...this.#counters,
      contextLadderActionHits: { ...this.#counters.contextLadderActionHits },
    };
  }

  /**
   * D7 residual minimal on-disk export for TF-0006 soak operators.
   *
   * Writes a single timestamped JSON file under `targetDir` containing the
   * current DCS counters plus a schema tag and generation timestamp.
   *
   * Hard constraints (enforced by design, not by flag):
   *  - NEVER auto-called by the runtime; only an explicit in-process caller
   *    (future host-api route / developer surface, out of scope) invokes it.
   *  - NOT gated by any feature flag, env var, or default config.
   *  - Does not mutate counters; does not reset; does not change default
   *    behavior when left uncalled.
   *  - codingObservability counters are intentionally NOT included here;
   *    they live in a sibling module and require their own export (follow-up).
   *
   * Returns the absolute path of the written file. Throws on fs failure
   * (caller's responsibility to handle).
   */
  writeSoakSnapshot(targetDir: string): {
    path: string;
    schema: string;
    generatedAt: string;
  } {
    const dir = String(targetDir);
    if (dir.length === 0) {
      throw new Error("writeSoakSnapshot: targetDir must be a non-empty path");
    }
    mkdirSync(dir, { recursive: true });
    const generatedAt = new Date().toISOString();
    const stamp = generatedAt.replace(/[:.]/g, "").replace("T", "-").replace("Z", "");
    // Random suffix avoids same-second collisions when called in a tight loop.
    const suffix = Math.random().toString(36).slice(2, 8);
    const filename = `dcs-soak-snapshot-${stamp}-${suffix}.json`;
    const filePath = join(dir, filename);
    const payload = {
      schema: "tf0006-soak-snapshot/dcs/v1",
      generatedAt,
      counters: this.snapshot(),
      d7ResidualNote:
        "DCS observability counters are in-memory only. This file is an explicit operator-triggered dump; it is NOT produced by default runtime behavior and is NOT gated by any flag.",
      // Honesty markers: soak evidence must not claim product satisfaction.
      satisfiesTf0006Soak: false,
      live: false,
    };
    writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    return { path: filePath, schema: payload.schema, generatedAt };
  }

  reset(): void {
    this.#counters = { ...ZERO, contextLadderActionHits: {} };
  }
}

export const dcsObservability = new DcsObservabilityRegistry();
