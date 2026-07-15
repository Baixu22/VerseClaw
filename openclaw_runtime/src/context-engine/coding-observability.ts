/**
 * In-memory coding scorecard counters (decision plan + C2 write kit + C3 concurrent).
 * Process-local, same pattern as dcs-observability — not a dashboard product surface.
 */
export type CodingObservabilitySnapshot = {
  factToolCalls: number;
  factToolCallsByName: Record<string, number>;
  factStoreHits: number;
  factStoreMisses: number;
  schemaToolCount: number;
  schemaChars: number;
  touchCount: number;
  touchLatencyMsSum: number;
  touchLatencyMsMax: number;
  parseOnWriteHits: number;
  staleBlocks: number;
  staleAllowances: number;
  journalLatencyMsSum: number;
  journalLatencyMsMax: number;
  journalSnapshots: number;
  journalFailures: number;
  undoCount: number;
  syntaxCheckHits: number;
  syntaxCheckSilent: number;
  verifyConsumeHits: number;
  diagHits: number;
  diagSilent: number;
  approvalPrompts: number;
  approvalSkips: number;
  // C3 concurrent / write-set metrics
  waveConflictChecks: number;
  waveConflicts: number;
  writeSetPredCorrect: number;
  writeSetPredTotal: number;
  writeSetNodesPopulated: number;
  writeSetNodesTotal: number;
  tokenBudgetAborts: number;
};

const ZERO: CodingObservabilitySnapshot = {
  factToolCalls: 0,
  factToolCallsByName: {},
  factStoreHits: 0,
  factStoreMisses: 0,
  schemaToolCount: 0,
  schemaChars: 0,
  touchCount: 0,
  touchLatencyMsSum: 0,
  touchLatencyMsMax: 0,
  parseOnWriteHits: 0,
  staleBlocks: 0,
  staleAllowances: 0,
  journalLatencyMsSum: 0,
  journalLatencyMsMax: 0,
  journalSnapshots: 0,
  journalFailures: 0,
  undoCount: 0,
  syntaxCheckHits: 0,
  syntaxCheckSilent: 0,
  verifyConsumeHits: 0,
  diagHits: 0,
  diagSilent: 0,
  approvalPrompts: 0,
  approvalSkips: 0,
  waveConflictChecks: 0,
  waveConflicts: 0,
  writeSetPredCorrect: 0,
  writeSetPredTotal: 0,
  writeSetNodesPopulated: 0,
  writeSetNodesTotal: 0,
  tokenBudgetAborts: 0,
};

class CodingObservabilityRegistry {
  #counters: CodingObservabilitySnapshot = {
    ...ZERO,
    factToolCallsByName: {},
  };

  recordFactToolCall(toolName: string): void {
    this.#counters.factToolCalls += 1;
    const key = toolName.trim() || "unknown";
    this.#counters.factToolCallsByName[key] = (this.#counters.factToolCallsByName[key] ?? 0) + 1;
  }

  recordFactStoreHit(hit: boolean): void {
    if (hit) {
      this.#counters.factStoreHits += 1;
    } else {
      this.#counters.factStoreMisses += 1;
    }
  }

  /**
   * W0-4 / addendum 6: record injected tool schema character occupancy.
   * Callers supply toolCount + serialized schema chars for the active catalog.
   */
  recordSchemaOccupancy(toolCount: number, schemaChars: number): void {
    this.#counters.schemaToolCount = Math.max(0, toolCount);
    this.#counters.schemaChars = Math.max(0, schemaChars);
  }

  recordTouchLatency(ms: number): void {
    const latency = Math.max(0, ms);
    this.#counters.touchCount += 1;
    this.#counters.touchLatencyMsSum += latency;
    if (latency > this.#counters.touchLatencyMsMax) {
      this.#counters.touchLatencyMsMax = latency;
    }
  }

  recordParseOnWriteHit(): void {
    this.#counters.parseOnWriteHits += 1;
  }

  recordStaleBlock(): void {
    this.#counters.staleBlocks += 1;
  }

  recordStaleAllowance(): void {
    this.#counters.staleAllowances += 1;
  }

  recordJournalLatency(ms: number, ok: boolean): void {
    const latency = Math.max(0, ms);
    this.#counters.journalLatencyMsSum += latency;
    if (latency > this.#counters.journalLatencyMsMax) {
      this.#counters.journalLatencyMsMax = latency;
    }
    if (ok) this.#counters.journalSnapshots += 1;
    else this.#counters.journalFailures += 1;
  }

  recordUndo(): void {
    this.#counters.undoCount += 1;
  }

  recordSyntaxCheck(hit: boolean): void {
    if (hit) this.#counters.syntaxCheckHits += 1;
    else this.#counters.syntaxCheckSilent += 1;
  }

  recordVerifyConsumeHit(): void {
    this.#counters.verifyConsumeHits += 1;
  }

  recordDiagHit(): void {
    this.#counters.diagHits += 1;
  }

  recordDiagSilent(): void {
    this.#counters.diagSilent += 1;
  }

  recordApprovalPrompt(): void {
    this.#counters.approvalPrompts += 1;
  }

  recordApprovalSkip(): void {
    this.#counters.approvalSkips += 1;
  }

  recordWaveConflictCheck(conflicted: boolean): void {
    this.#counters.waveConflictChecks += 1;
    if (conflicted) this.#counters.waveConflicts += 1;
  }

  recordWriteSetPrediction(correct: boolean): void {
    this.#counters.writeSetPredTotal += 1;
    if (correct) this.#counters.writeSetPredCorrect += 1;
  }

  /** C3 probe: how many graph worker nodes carry a non-empty writeSet. */
  recordWriteSetCoverage(params: { total: number; populated: number }): void {
    this.#counters.writeSetNodesTotal += Math.max(0, params.total);
    this.#counters.writeSetNodesPopulated += Math.max(0, params.populated);
  }

  recordTokenBudgetAbort(): void {
    this.#counters.tokenBudgetAborts += 1;
  }

  rates(): {
    approvalPromptRate: number;
    diagHitRate: number;
    verifyHitRate: number;
    falseBlockRate: number;
    waveConflictRate: number;
    writeSetPredAccuracy: number;
    writeSetCoverageRate: number;
  } {
    const c = this.#counters;
    const div = (n: number, d: number) => (d <= 0 ? 0 : n / d);
    return {
      approvalPromptRate: div(c.approvalPrompts, c.approvalPrompts + c.approvalSkips),
      diagHitRate: div(c.diagHits, c.diagHits + c.diagSilent),
      verifyHitRate: div(c.verifyConsumeHits, c.verifyConsumeHits + c.syntaxCheckSilent + 1),
      falseBlockRate: div(c.staleBlocks, c.staleBlocks + c.staleAllowances),
      waveConflictRate: div(c.waveConflicts, c.waveConflictChecks),
      writeSetPredAccuracy: div(c.writeSetPredCorrect, c.writeSetPredTotal),
      writeSetCoverageRate: div(c.writeSetNodesPopulated, c.writeSetNodesTotal),
    };
  }

  snapshot(): CodingObservabilitySnapshot {
    return {
      ...this.#counters,
      factToolCallsByName: { ...this.#counters.factToolCallsByName },
    };
  }

  reset(): void {
    this.#counters = {
      ...ZERO,
      factToolCallsByName: {},
    };
  }
}

export const codingObservability = new CodingObservabilityRegistry();

export const CODING_METRIC_NAMES = {
  factToolCalls: "coding.read.factToolCalls",
  touchLatencyMs: "coding.read.touchLatencyMs",
  parseOnWriteHits: "coding.write.parseOnWriteHits",
  staleBlocks: "coding.write.staleBlocks",
  falseBlockRate: "coding.write.falseBlockRate",
  journalLatencyMs: "coding.write.journalLatencyMs",
  undoCount: "coding.write.undoCount",
  syntaxCheckHits: "coding.write.syntaxCheckHits",
  verifyHitRate: "coding.write.verifyHitRate",
  diagHitRate: "coding.write.diagHitRate",
  approvalPromptRate: "coding.write.approvalPromptRate",
  waveConflictRate: "coding.concurrent.waveConflictRate",
  writeSetPredAccuracy: "coding.concurrent.writeSetPredAccuracy",
  writeSetCoverageRate: "coding.concurrent.writeSetCoverageRate",
  tokenBudgetAborts: "coding.concurrent.tokenBudgetAborts",
} as const;