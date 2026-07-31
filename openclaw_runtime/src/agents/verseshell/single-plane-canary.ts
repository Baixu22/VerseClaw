export const UAS06_ENGINEERING_SCENARIOS = [
  "short",
  "long",
  "background",
  "stdin",
  "pty",
  "cancel",
  "timeout",
  "restart",
  "rollback",
] as const;

export type Uas06EngineeringScenario = (typeof UAS06_ENGINEERING_SCENARIOS)[number];
export type Uas06CanarySource = "engineering" | "live";
export type Uas06CanaryArm = "baseline" | "verseshell";

export type Uas06ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  actual: true;
};

export type Uas06CanaryObservation = {
  observationId: string;
  source: Uas06CanarySource;
  cohortId: string;
  cohortArm: Uas06CanaryArm;
  scenario: Uas06EngineeringScenario;
  pairedTaskId?: string;
  eligibleLocal: boolean;
  executionHost: "gateway" | "sandbox" | "node" | "verseshell";
  lifecycleOwner: "native" | "sandbox" | "node" | "verseshell" | "legacy-verseshell";
  nativeFallback: boolean;
  outcome: "completed" | "failed";
  durationMs: number;
  recoveryState: "none" | "start-failed" | "exited" | "killed" | "lost" | "runtime-error";
  unauthorizedExecutionCount: number;
  duplicateProcessCount: number;
  lostOutputBytes: number;
  sensitiveOutputLeakCount: number;
  rollbackSucceeded?: boolean;
  operatorReviewed?: boolean;
  providerUsage?: Uas06ProviderUsage;
  humanRecoveryMinutes?: number;
};

export type Uas06CanaryStatus =
  | "blocked"
  | "needs-engineering-matrix"
  | "needs-real-canary"
  | "eligible-for-closeout-review";

export type Uas06CanarySummary = {
  schema: "uas-06.single-local-exec-canary/v1";
  status: Uas06CanaryStatus;
  productGraduationAuthorized: false;
  counts: {
    observations: number;
    engineering: number;
    live: number;
    eligibleCanaryLocal: number;
    governedVerseShell: number;
    nativeFallback: number;
    realPairedTasks: number;
    realProviderUsage: number;
  };
  coverage: {
    governedLocalPercent: number | null;
    engineeringScenarios: Uas06EngineeringScenario[];
    missingEngineeringScenarios: Uas06EngineeringScenario[];
    providerUsagePercent: number | null;
  };
  hardVetoes: string[];
  rollback: {
    observed: boolean;
    succeeded: boolean;
    realReviewedObserved: boolean;
    realReviewedSucceeded: boolean;
  };
  requiredNextEvidence: string[];
};

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validProviderUsage(usage: Uas06ProviderUsage): boolean {
  return (
    usage.actual === true &&
    finiteNonNegative(usage.inputTokens) &&
    finiteNonNegative(usage.outputTokens) &&
    finiteNonNegative(usage.cacheReadTokens) &&
    finiteNonNegative(usage.cacheWriteTokens) &&
    finiteNonNegative(usage.costUsd)
  );
}

function passesScenarioLifecycleGate(observation: Uas06CanaryObservation): boolean {
  switch (observation.scenario) {
    case "short":
    case "long":
    case "background":
    case "stdin":
    case "pty":
      return observation.outcome === "completed" && observation.recoveryState === "exited";
    case "cancel":
    case "timeout":
      return observation.recoveryState === "killed";
    case "restart":
      return observation.recoveryState === "lost";
    case "rollback":
      return observation.rollbackSucceeded === true;
  }
}

function validObservation(observation: Uas06CanaryObservation): boolean {
  return (
    observation.observationId.trim().length > 0 &&
    observation.cohortId.trim().length > 0 &&
    finiteNonNegative(observation.durationMs) &&
    finiteNonNegative(observation.unauthorizedExecutionCount) &&
    finiteNonNegative(observation.duplicateProcessCount) &&
    finiteNonNegative(observation.lostOutputBytes) &&
    finiteNonNegative(observation.sensitiveOutputLeakCount) &&
    (observation.providerUsage === undefined || validProviderUsage(observation.providerUsage)) &&
    (observation.humanRecoveryMinutes === undefined ||
      finiteNonNegative(observation.humanRecoveryMinutes))
  );
}

function stableUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].toSorted();
}

function pairedLiveTaskCount(observations: readonly Uas06CanaryObservation[]): number {
  const pairs = new Map<string, Set<Uas06CanaryArm>>();
  for (const observation of observations) {
    if (observation.source !== "live" || !observation.pairedTaskId?.trim()) continue;
    const arms = pairs.get(observation.pairedTaskId) ?? new Set<Uas06CanaryArm>();
    arms.add(observation.cohortArm);
    pairs.set(observation.pairedTaskId, arms);
  }
  return [...pairs.values()].filter((arms) => arms.has("baseline") && arms.has("verseshell"))
    .length;
}

/** Evaluate canary evidence without converting engineering fixtures into live qualification. */
export function summarizeUas06Canary(
  observations: readonly Uas06CanaryObservation[],
): Uas06CanarySummary {
  const invalid = observations.filter((observation) => !validObservation(observation));
  const engineering = observations.filter((observation) => observation.source === "engineering");
  const live = observations.filter((observation) => observation.source === "live");
  const eligibleCanary = observations.filter(
    (observation) => observation.cohortArm === "verseshell" && observation.eligibleLocal,
  );
  const governed = eligibleCanary.filter(
    (observation) =>
      observation.executionHost === "verseshell" &&
      observation.lifecycleOwner === "verseshell" &&
      !observation.nativeFallback,
  );
  const nativeFallback = eligibleCanary.filter((observation) => observation.nativeFallback);
  const engineeringScenarios = stableUnique(engineering.map((observation) => observation.scenario));
  const missingEngineeringScenarios = UAS06_ENGINEERING_SCENARIOS.filter(
    (scenario) => !engineeringScenarios.includes(scenario),
  );
  const rollbackObservations = engineering.filter(
    (observation) => observation.scenario === "rollback",
  );
  const rollbackSucceeded = rollbackObservations.some(
    (observation) => observation.rollbackSucceeded === true,
  );
  const realReviewedRollback = live.filter(
    (observation) =>
      observation.cohortArm === "verseshell" &&
      observation.scenario === "rollback" &&
      observation.operatorReviewed === true,
  );
  const realReviewedRollbackSucceeded = realReviewedRollback.some(
    (observation) => observation.rollbackSucceeded === true,
  );
  const providerUsageCount = live.filter(
    (observation) =>
      observation.providerUsage !== undefined && validProviderUsage(observation.providerUsage),
  ).length;
  const realPairedTasks = pairedLiveTaskCount(live);
  const hardVetoes: string[] = [];

  if (invalid.length > 0) hardVetoes.push("invalid-observation");
  if (nativeFallback.length > 0) hardVetoes.push("native-fallback-observed");
  if (observations.some((observation) => observation.unauthorizedExecutionCount > 0)) {
    hardVetoes.push("unauthorized-execution-observed");
  }
  if (observations.some((observation) => observation.duplicateProcessCount > 0)) {
    hardVetoes.push("duplicate-process-observed");
  }
  if (observations.some((observation) => observation.lostOutputBytes > 0)) {
    hardVetoes.push("lost-output-observed");
  }
  if (observations.some((observation) => observation.sensitiveOutputLeakCount > 0)) {
    hardVetoes.push("sensitive-output-leak-observed");
  }
  if (observations.some((observation) => !passesScenarioLifecycleGate(observation))) {
    hardVetoes.push("scenario-lifecycle-gate-failed");
  }
  if (eligibleCanary.length > 0 && governed.length !== eligibleCanary.length) {
    hardVetoes.push("eligible-local-route-coverage-below-100-percent");
  }

  const engineeringReady =
    engineering.length > 0 &&
    missingEngineeringScenarios.length === 0 &&
    rollbackSucceeded &&
    hardVetoes.length === 0;
  const realReady =
    live.length > 0 &&
    realPairedTasks > 0 &&
    providerUsageCount === live.length &&
    live.every((observation) => observation.humanRecoveryMinutes !== undefined) &&
    realReviewedRollbackSucceeded &&
    hardVetoes.length === 0;
  const status: Uas06CanaryStatus =
    hardVetoes.length > 0
      ? "blocked"
      : !engineeringReady
        ? "needs-engineering-matrix"
        : !realReady
          ? "needs-real-canary"
          : "eligible-for-closeout-review";
  const requiredNextEvidence: string[] = [];
  if (missingEngineeringScenarios.length > 0) {
    requiredNextEvidence.push(`engineering scenarios: ${missingEngineeringScenarios.join(", ")}`);
  }
  if (!rollbackSucceeded)
    requiredNextEvidence.push("engineering kill-switch and explicit rollback drill");
  if (!realReviewedRollbackSucceeded) {
    requiredNextEvidence.push("reviewed operator kill-switch and explicit rollback drill");
  }
  if (live.length === 0) requiredNextEvidence.push("real internal cohort observations");
  if (realPairedTasks === 0)
    requiredNextEvidence.push("paired baseline and VerseShell task observations");
  if (live.length === 0 || providerUsageCount !== live.length) {
    requiredNextEvidence.push("actual provider usage for every live observation");
  }
  if (
    live.length === 0 ||
    live.some((observation) => observation.humanRecoveryMinutes === undefined)
  ) {
    requiredNextEvidence.push("human recovery minutes for every live observation");
  }

  return {
    schema: "uas-06.single-local-exec-canary/v1",
    status,
    productGraduationAuthorized: false,
    counts: {
      observations: observations.length,
      engineering: engineering.length,
      live: live.length,
      eligibleCanaryLocal: eligibleCanary.length,
      governedVerseShell: governed.length,
      nativeFallback: nativeFallback.length,
      realPairedTasks,
      realProviderUsage: providerUsageCount,
    },
    coverage: {
      governedLocalPercent:
        eligibleCanary.length === 0 ? null : (governed.length / eligibleCanary.length) * 100,
      engineeringScenarios,
      missingEngineeringScenarios,
      providerUsagePercent: live.length === 0 ? null : (providerUsageCount / live.length) * 100,
    },
    hardVetoes: stableUnique(hardVetoes),
    rollback: {
      observed: rollbackObservations.length > 0,
      succeeded: rollbackSucceeded,
      realReviewedObserved: realReviewedRollback.length > 0,
      realReviewedSucceeded: realReviewedRollbackSucceeded,
    },
    requiredNextEvidence: stableUnique(requiredNextEvidence),
  };
}
