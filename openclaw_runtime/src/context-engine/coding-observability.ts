/**
 * In-memory coding scorecard counters (C0-C3 + C1 sim + C4 merge + C6 compaction).
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
  /** FP-P1-04: project test-runner detection outcomes on the write path. */
  testRunnerDetected: number;
  testRunnerSkipped: number;
  diagHits: number;
  diagSilent: number;
  approvalPrompts: number;
  approvalSkips: number;
  waveConflictChecks: number;
  waveConflicts: number;
  writeSetPredCorrect: number;
  writeSetPredTotal: number;
  writeSetNodesPopulated: number;
  writeSetNodesTotal: number;
  tokenBudgetAborts: number;
  mergeSuccess: number;
  mergeRework: number;
  taskPass: number;
  taskFail: number;
  dupToolCalls: number;
  tokenCost: number;
  toolRoutingCorrect: number;
  toolRoutingTotal: number;
  compactionLayerHits: Record<string, number>;
  taskStateRewriteOk: number;
  taskStateRewriteDrift: number;
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
  testRunnerDetected: 0,
  testRunnerSkipped: 0,
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
  mergeSuccess: 0,
  mergeRework: 0,
  taskPass: 0,
  taskFail: 0,
  dupToolCalls: 0,
  tokenCost: 0,
  toolRoutingCorrect: 0,
  toolRoutingTotal: 0,
  compactionLayerHits: {},
  taskStateRewriteOk: 0,
  taskStateRewriteDrift: 0,
};

/** Opt-in diagnostic preset, never an approval/security policy or config default. */
export const APPROVAL_RATE_DIAGNOSTIC_POLICY = Object.freeze({
  maxSamples: 100,
  minimumSamples: 20,
  stride: 20,
  high: 0.5,
  low: 0.3,
  windows: 2,
  ttlMs: 300_000,
});

export type ApprovalRateDiagnostic = {
  metric: string;
  scope: "runtime-process";
  measurement: "destructive-tier-classification";
  status: "disabled" | "unavailable" | "observing" | "alert";
  reason:
    | "diagnostics_disabled"
    | "insufficient_samples"
    | "expired_window"
    | "invalid_clock"
    | "clock_regression"
    | "observing"
    | "high_rate_confirmed"
    | "low_rate_confirmed";
  sampleCount: number;
  promptCount: number;
  skipCount: number;
  approvalPromptRate: number | null;
  rateMeasured: boolean;
  alertActive: boolean | null;
  windowStartMs: number | null;
  windowEndMs: number | null;
  observedAtMs: number | null;
  expiresAtMs: number | null;
  sampleSequence: number;
  evaluatedAtSequence: number;
  windowSize: number;
  windowStride: number;
  nextAction: string;
};

class CodingObservabilityRegistry {
  #approvalEnabled = false;
  #approvalSamples: { prompt: boolean; at: number }[] = [];
  #approvalSequence = 0;
  #approvalSinceWindow = 0;
  #approvalEvaluatedAt = 0;
  #approvalHighWindows = 0;
  #approvalLowWindows = 0;
  #approvalAlert = false;
  #approvalLastTime: number | null = null;
  #approvalReason: ApprovalRateDiagnostic["reason"] = "diagnostics_disabled";
  #approvalLastReportedKey: string | undefined;

  #counters: CodingObservabilitySnapshot = {
    ...ZERO,
    factToolCallsByName: {},
    compactionLayerHits: {},
  };

  recordFactToolCall(toolName: string): void {
    this.#counters.factToolCalls += 1;
    const key = toolName.trim() || "unknown";
    this.#counters.factToolCallsByName[key] = (this.#counters.factToolCallsByName[key] ?? 0) + 1;
  }

  recordFactStoreHit(hit: boolean): void {
    if (hit) this.#counters.factStoreHits += 1;
    else this.#counters.factStoreMisses += 1;
  }

  recordSchemaOccupancy(toolCount: number, schemaChars: number): void {
    this.#counters.schemaToolCount = Math.max(0, toolCount);
    this.#counters.schemaChars = Math.max(0, schemaChars);
  }

  recordTouchLatency(ms: number): void {
    const latency = Math.max(0, ms);
    this.#counters.touchCount += 1;
    this.#counters.touchLatencyMsSum += latency;
    if (latency > this.#counters.touchLatencyMsMax) this.#counters.touchLatencyMsMax = latency;
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
    if (latency > this.#counters.journalLatencyMsMax) this.#counters.journalLatencyMsMax = latency;
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
  recordTestRunnerDetect(detected: boolean): void {
    if (detected) this.#counters.testRunnerDetected += 1;
    else this.#counters.testRunnerSkipped += 1;
  }
  recordDiagHit(): void {
    this.#counters.diagHits += 1;
  }
  recordDiagSilent(): void {
    this.#counters.diagSilent += 1;
  }
  recordApprovalPrompt(diagnosticsEnabled = false): void {
    this.#counters.approvalPrompts += 1;
    this.#recordApprovalDecision(true, diagnosticsEnabled);
  }
  recordApprovalSkip(diagnosticsEnabled = false): void {
    this.#counters.approvalSkips += 1;
    this.#recordApprovalDecision(false, diagnosticsEnabled);
  }

  #invalidateApprovalWindow(reason: ApprovalRateDiagnostic["reason"]): void {
    this.#approvalSamples = [];
    this.#approvalSinceWindow = 0;
    this.#approvalEvaluatedAt = 0;
    this.#approvalHighWindows = 0;
    this.#approvalLowWindows = 0;
    this.#approvalAlert = false;
    this.#approvalReason = reason;
  }

  #refreshApprovalWindow(now: number, prompt?: boolean): boolean {
    if (!Number.isFinite(now) || now < 0) {
      this.#invalidateApprovalWindow("invalid_clock");
      this.#approvalLastTime = null;
      return false;
    }
    if (this.#approvalLastTime !== null && now < this.#approvalLastTime) {
      this.#invalidateApprovalWindow("clock_regression");
      this.#approvalLastTime = now;
      return false;
    }
    this.#approvalLastTime = now;
    const policy = APPROVAL_RATE_DIAGNOSTIC_POLICY;
    // A late replacement must not hide a coverage gap; an exact TTL-boundary replacement is valid.
    const coveredStart = this.#approvalSamples.at(-policy.minimumSamples)?.at;
    const coverageGap = coveredStart !== undefined && now - coveredStart > policy.ttlMs;
    if (prompt !== undefined) this.#approvalSamples.push({ prompt, at: now });
    const previousCount = this.#approvalSamples.length;
    // ponytail: scan at most 100 samples; no timer, cache service or persistent store.
    this.#approvalSamples = this.#approvalSamples.filter((s) => now - s.at < policy.ttlMs);
    if (
      coverageGap ||
      (this.#approvalSamples.length !== previousCount &&
        this.#approvalSamples.length < policy.minimumSamples)
    ) {
      // A real coverage gap resets confirmations, not the cadence of new valid decisions.
      this.#approvalHighWindows = this.#approvalLowWindows = 0;
      this.#approvalAlert = false;
      this.#approvalReason = "expired_window";
    }
    if (this.#approvalSamples.length > policy.maxSamples) this.#approvalSamples.shift();
    return true;
  }

  #recordApprovalDecision(prompt: boolean, enabled: boolean): void {
    if (enabled !== true) {
      if (this.#approvalEnabled) {
        this.#invalidateApprovalWindow("diagnostics_disabled");
        this.#approvalSequence = 0;
        this.#approvalLastTime = null;
        this.#approvalLastReportedKey = undefined;
      }
      this.#approvalEnabled = false;
      return;
    }
    if (!this.#approvalEnabled) this.#approvalReason = "insufficient_samples";
    this.#approvalEnabled = true;
    const now = Date.now();
    if (!this.#refreshApprovalWindow(now, prompt)) return;
    const policy = APPROVAL_RATE_DIAGNOSTIC_POLICY;
    this.#approvalSequence++;
    if (++this.#approvalSinceWindow < policy.stride) return;
    this.#approvalSinceWindow = 0;
    this.#approvalEvaluatedAt = this.#approvalSequence;
    if (this.#approvalSamples.length < policy.minimumSamples) return;
    const rate =
      this.#approvalSamples.filter((s) => s.prompt).length / this.#approvalSamples.length;
    this.#approvalHighWindows =
      rate >= policy.high ? Math.min(policy.windows, this.#approvalHighWindows + 1) : 0;
    this.#approvalLowWindows =
      rate <= policy.low ? Math.min(policy.windows, this.#approvalLowWindows + 1) : 0;
    const wasAlert = this.#approvalAlert;
    if (this.#approvalHighWindows >= policy.windows) this.#approvalAlert = true;
    if (this.#approvalLowWindows >= policy.windows) this.#approvalAlert = false;
    this.#approvalReason = this.#approvalAlert
      ? "high_rate_confirmed"
      : wasAlert
        ? "low_rate_confirmed"
        : "observing";
  }

  /** Current window only; a null rate is never a healthy zero. Reading cannot confirm another window. */
  approvalRateDiagnostics(now = Date.now()): ApprovalRateDiagnostic {
    if (this.#approvalEnabled) this.#refreshApprovalWindow(now);
    const policy = APPROVAL_RATE_DIAGNOSTIC_POLICY;
    const sampleCount = this.#approvalSamples.length;
    const promptCount = this.#approvalSamples.filter((s) => s.prompt).length;
    const measured = this.#approvalEnabled && sampleCount >= policy.minimumSamples;
    const start = this.#approvalSamples[0]?.at ?? null;
    return {
      metric: CODING_METRIC_NAMES.approvalPromptRate,
      scope: "runtime-process",
      measurement: "destructive-tier-classification",
      status: !this.#approvalEnabled
        ? "disabled"
        : !measured
          ? "unavailable"
          : this.#approvalAlert
            ? "alert"
            : "observing",
      reason:
        measured &&
        this.#approvalReason !== "high_rate_confirmed" &&
        this.#approvalReason !== "low_rate_confirmed"
          ? "observing"
          : this.#approvalReason,
      sampleCount,
      promptCount,
      skipCount: sampleCount - promptCount,
      approvalPromptRate: measured ? promptCount / sampleCount : null,
      rateMeasured: measured,
      alertActive: measured ? this.#approvalAlert : null,
      windowStartMs: start,
      windowEndMs: this.#approvalSamples.at(-1)?.at ?? null,
      observedAtMs: Number.isFinite(now) && now >= 0 ? now : null,
      expiresAtMs: start === null ? null : start + policy.ttlMs,
      sampleSequence: this.#approvalSequence,
      evaluatedAtSequence: this.#approvalEvaluatedAt,
      windowSize: policy.maxSamples,
      windowStride: policy.stride,
      nextAction:
        this.#approvalReason === "invalid_clock" || this.#approvalReason === "clock_regression"
          ? "check_system_clock"
          : !measured
            ? "collect_fresh_classifications"
            : this.#approvalAlert
              ? "inspect_destructive_classification_and_write_journal"
              : "observe_next_window",
    };
  }

  /** The one diagnostic consumer is best-effort: a logging failure must not change tool effects. */
  reportApprovalRateDiagnostic(emit: (diagnostic: ApprovalRateDiagnostic) => void): void {
    const diagnostic = this.approvalRateDiagnostics();
    if (diagnostic.status === "disabled") return;
    const key = diagnostic.status + "/" + diagnostic.reason;
    if (key === this.#approvalLastReportedKey) return;
    try {
      emit(diagnostic);
      this.#approvalLastReportedKey = key;
    } catch {
      // Do not acknowledge a failed logging call; the next observation can retry.
    }
  }
  recordWaveConflictCheck(conflicted: boolean): void {
    this.#counters.waveConflictChecks += 1;
    if (conflicted) this.#counters.waveConflicts += 1;
  }
  recordWriteSetPrediction(correct: boolean): void {
    this.#counters.writeSetPredTotal += 1;
    if (correct) this.#counters.writeSetPredCorrect += 1;
  }
  recordWriteSetCoverage(params: { total: number; populated: number }): void {
    this.#counters.writeSetNodesTotal += Math.max(0, params.total);
    this.#counters.writeSetNodesPopulated += Math.max(0, params.populated);
  }
  recordTokenBudgetAbort(): void {
    this.#counters.tokenBudgetAborts += 1;
  }

  recordMergeOutcome(rework: boolean): void {
    if (rework) this.#counters.mergeRework += 1;
    else this.#counters.mergeSuccess += 1;
  }

  recordReplayTask(params: {
    dupToolCalls: number;
    tokenCost: number;
    passed: boolean;
    routingCorrect?: boolean;
  }): void {
    this.#counters.dupToolCalls += Math.max(0, params.dupToolCalls);
    this.#counters.tokenCost += Math.max(0, params.tokenCost);
    if (params.passed) this.#counters.taskPass += 1;
    else this.#counters.taskFail += 1;
    if (typeof params.routingCorrect === "boolean") {
      this.#counters.toolRoutingTotal += 1;
      if (params.routingCorrect) this.#counters.toolRoutingCorrect += 1;
    }
  }

  recordCompactionLayer(layer: string): void {
    const key = layer.trim() || "unknown";
    this.#counters.compactionLayerHits[key] = (this.#counters.compactionLayerHits[key] ?? 0) + 1;
  }

  recordTaskStateRewrite(ok: boolean): void {
    if (ok) this.#counters.taskStateRewriteOk += 1;
    else this.#counters.taskStateRewriteDrift += 1;
  }

  rates(): {
    approvalPromptRate: number;
    diagHitRate: number;
    verifyHitRate: number;
    falseBlockRate: number;
    waveConflictRate: number;
    writeSetPredAccuracy: number;
    writeSetCoverageRate: number;
    taskPassRate: number;
    toolRoutingAccuracy: number;
    mergeReworkRate: number;
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
      taskPassRate: div(c.taskPass, c.taskPass + c.taskFail),
      toolRoutingAccuracy: div(c.toolRoutingCorrect, c.toolRoutingTotal),
      mergeReworkRate: div(c.mergeRework, c.mergeRework + c.mergeSuccess),
    };
  }

  snapshot(): CodingObservabilitySnapshot {
    return {
      ...this.#counters,
      factToolCallsByName: { ...this.#counters.factToolCallsByName },
      compactionLayerHits: { ...this.#counters.compactionLayerHits },
    };
  }

  reset(): void {
    this.#approvalEnabled = false;
    this.#invalidateApprovalWindow("diagnostics_disabled");
    this.#approvalSequence = 0;
    this.#approvalLastTime = null;
    this.#approvalLastReportedKey = undefined;
    this.#counters = {
      ...ZERO,
      factToolCallsByName: {},
      compactionLayerHits: {},
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
  testRunnerDetected: "coding.write.testRunnerDetected",
  testRunnerSkipped: "coding.write.testRunnerSkipped",
  diagHitRate: "coding.write.diagHitRate",
  approvalPromptRate: "coding.write.approvalPromptRate",
  waveConflictRate: "coding.concurrent.waveConflictRate",
  writeSetPredAccuracy: "coding.concurrent.writeSetPredAccuracy",
  writeSetCoverageRate: "coding.concurrent.writeSetCoverageRate",
  tokenBudgetAborts: "coding.concurrent.tokenBudgetAborts",
  mergeReworkRate: "coding.concurrent.mergeReworkRate",
  dupToolCalls: "coding.read.dupToolCalls",
  tokenCost: "coding.read.tokenCost",
  taskPassRate: "coding.read.taskPassRate",
  toolRoutingAccuracy: "coding.read.toolRoutingAccuracy",
  compactionLayerDist: "coding.context.compactionLayerDist",
} as const;
