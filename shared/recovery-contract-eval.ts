/**
 * TF-0709 · recovery contract evaluation (eval-only).
 *
 * This module freezes the recovery evaluation contract *before* any measurement:
 *   - five failure windows, each carrying the five required annotations;
 *   - at least 30 long-session pairs across compression / handoff / fork /
 *     restart / revocation;
 *   - the quantified gates a later measurement run must clear.
 *
 * It is deliberately a contract plus a pure scorer. It does not read or mutate
 * the runtime, does not change production recovery behavior or any default
 * switch, and never treats synthetic or scripted provider output as quality
 * evidence.
 */
import { createHash } from 'node:crypto';

export const RECOVERY_CONTRACT_MANIFEST_SCHEMA = 'RecoveryContractManifest/v1' as const;
export const RECOVERY_CONTRACT_EVAL_SCHEMA = 'RecoveryContractEval/v1' as const;
export const RECOVERY_CONTRACT_FREEZE_EPOCH = '2026-11-03T00:00:00.000Z' as const;
export const RECOVERY_CONTRACT_ACTOR = 'recovery-eval-agent' as const;

/** Each failure window must be repeated at least this many times. */
export const MIN_REPEATS_PER_WINDOW = 3 as const;

/** Minimum number of long-session pairs in the frozen workload. */
export const MIN_LONG_SESSION_PAIRS = 30 as const;

/** 30 pairs / 5 families. Every family must be represented. */
export const MIN_LONG_SESSION_PAIRS_PER_FAMILY = 6 as const;

export const RECOVERY_FAILURE_WINDOW_IDS = [
  'intent-after-persist-kill',
  'effect-before-receipt-kill',
  'child-created-before-parent-advance-kill',
  'store-write-failure',
  'repeated-restart',
] as const;

export type RecoveryFailureWindowId = (typeof RECOVERY_FAILURE_WINDOW_IDS)[number];

export const RECOVERY_LONG_SESSION_FAMILIES = [
  'compression',
  'handoff',
  'fork',
  'restart',
  'revocation',
] as const;

export type RecoveryLongSessionFamily = (typeof RECOVERY_LONG_SESSION_FAMILIES)[number];

/**
 * The five annotations every failure window must freeze. The order is part of
 * the contract because the frozen hash covers the full manifest.
 */
export const RECOVERY_WINDOW_ANNOTATION_FIELDS = [
  'injectionPoint',
  'expectedObservableState',
  'forbiddenRerunRegion',
  'allowedRerunRegion',
  'requiredDiskEvidence',
] as const;

export type RecoveryWindowAnnotationField = (typeof RECOVERY_WINDOW_ANNOTATION_FIELDS)[number];

export type RecoveryWindowAnnotation = {
  /** 注入点：exactly where the fault is injected. */
  injectionPoint: string;
  /** 预期可观察状态：what a correct recovery must expose. */
  expectedObservableState: string;
  /** 禁止重跑区：work that must never be replayed. */
  forbiddenRerunRegion: string;
  /** 允许重跑区：work that may be retried or re-linked. */
  allowedRerunRegion: string;
  /** 所需磁盘证据：files that must exist before a trial can be scored. */
  requiredDiskEvidence: string[];
};

export type RecoveryFailureWindow = {
  id: RecoveryFailureWindowId;
  title: string;
  description: string;
  minRepeats: number;
  annotation: RecoveryWindowAnnotation;
};

export const RECOVERY_FAILURE_WINDOWS: readonly RecoveryFailureWindow[] = Object.freeze([
  {
    id: 'intent-after-persist-kill',
    title: 'Kill after intent persist, before dispatch',
    description: 'The user intent is durably persisted, then the process dies before provider dispatch.',
    minRepeats: MIN_REPEATS_PER_WINDOW,
    annotation: {
      injectionPoint: 'after the turn-intent journal record is appended and fsynced, before provider dispatch',
      expectedObservableState: 'exactly one persisted intent is found; no assistant output was emitted; the turn is resumable',
      forbiddenRerunRegion: 'do not re-append the persisted user intent and do not replay any tool call that already started',
      allowedRerunRegion: 'may schedule the unstarted turn from the persisted intent',
      requiredDiskEvidence: [
        'turn-intent journal record',
        'session transcript tail',
        'recovery decision record',
      ],
    },
  },
  {
    id: 'effect-before-receipt-kill',
    title: 'Kill after external effect, before receipt persist',
    description: 'The external side effect committed, but the process died before the effect receipt was persisted.',
    minRepeats: MIN_REPEATS_PER_WINDOW,
    annotation: {
      injectionPoint: 'after the external effect commits, before its effect receipt is persisted',
      expectedObservableState: 'the effect exists once; the missing receipt is classified as unknown and is never silently replayed',
      forbiddenRerunRegion: 'do not replay the tool invocation whose side effect may have committed',
      allowedRerunRegion: 'may reconcile through the idempotency key, or mark the effect unreceipted and require explicit continuation',
      requiredDiskEvidence: [
        'effect log entry or idempotency key',
        'tool invocation record',
        'receipt reconciliation record',
      ],
    },
  },
  {
    id: 'child-created-before-parent-advance-kill',
    title: 'Kill after child creation, before parent advance',
    description: 'A child task was durably created, but the parent node did not advance before the process died.',
    minRepeats: MIN_REPEATS_PER_WINDOW,
    annotation: {
      injectionPoint: 'after the child task record is durably created, before the parent task node advances',
      expectedObservableState: 'the child exists exactly once and is linked to the parent; the parent stays at its pre-advance state',
      forbiddenRerunRegion: 'do not create a second child and do not re-run child initialization',
      allowedRerunRegion: 'may re-link the existing child and advance the parent after verifying child identity',
      requiredDiskEvidence: [
        'child task record',
        'parent task journal',
        'parent-child link or edge record',
      ],
    },
  },
  {
    id: 'store-write-failure',
    title: 'Store write failure',
    description: 'The durable store rejects or fails a write (ENOSPC / EACCES / abrupt I/O failure).',
    minRepeats: MIN_REPEATS_PER_WINDOW,
    annotation: {
      injectionPoint: 'during a store write, before the write acknowledgment is returned',
      expectedObservableState: 'the write is reported as failed; no silent success; the previous durable state remains readable',
      forbiddenRerunRegion: 'do not report write success and do not advance state on an unacknowledged store write',
      allowedRerunRegion: 'may retry the same idempotent write or fall back to the append-only journal when one exists',
      requiredDiskEvidence: [
        'store write error record',
        'last durable snapshot or journal offset',
        'retry or fallback decision record',
      ],
    },
  },
  {
    id: 'repeated-restart',
    title: 'Repeated restart at the same recovery boundary',
    description: 'The process restarts repeatedly (at least three times) at the same or adjacent recovery boundary.',
    minRepeats: MIN_REPEATS_PER_WINDOW,
    annotation: {
      injectionPoint: 'restart at least three times while the same recovery boundary is pending',
      expectedObservableState: 'every restart converges on the same task state with no duplicate effect and no orphan child',
      forbiddenRerunRegion: 'do not replay completed effects and do not re-create children that survived a prior restart',
      allowedRerunRegion: 'may re-scan the journal, re-link surviving children, and resume only the not-yet-committed step',
      requiredDiskEvidence: [
        'restart counter',
        'journal replay checkpoint per restart',
        'final task, effect and child state dump',
      ],
    },
  },
]);

/**
 * Quantified gates. Values are frozen: a manifest that changes any of them is
 * rejected by `assertFrozenRecoveryContractManifest`.
 */
export type RecoveryContractThresholds = {
  duplicateEffectsMax: 0;
  lostTasksMax: 0;
  terminalCorrectnessMin: 1;
  unknownClassifiableRateMax: 0.02;
  mustPreserveFidelityMin: 1;
  falseCompletionClaimsMax: 0;
  nextActionAccuracyMin: 0.95;
  recoveryLatencyP50MsMax: 5000;
  recoveryLatencyP95MsMax: 15000;
};

export const RECOVERY_CONTRACT_THRESHOLDS: RecoveryContractThresholds = Object.freeze({
  duplicateEffectsMax: 0,
  lostTasksMax: 0,
  terminalCorrectnessMin: 1,
  unknownClassifiableRateMax: 0.02,
  mustPreserveFidelityMin: 1,
  falseCompletionClaimsMax: 0,
  nextActionAccuracyMin: 0.95,
  recoveryLatencyP50MsMax: 5000,
  recoveryLatencyP95MsMax: 15000,
});
export type RecoveryLongSessionPair = {
  id: string;
  family: RecoveryLongSessionFamily;
  pairIndex: number;
  title: string;
  prompt: string;
  mustPreserve: string[];
  expectedNextAction: string;
  forbiddenCompletionClaims: string[];
  /** SHA-256 of the pair content, excluding this field. */
  inputHash: string;
};

export type RecoveryContractManifest = {
  schema: typeof RECOVERY_CONTRACT_MANIFEST_SCHEMA;
  version: 1;
  frozenAt: typeof RECOVERY_CONTRACT_FREEZE_EPOCH;
  frozenBeforeMeasurement: true;
  drivenBy: 'agent';
  actor: string;
  windows: RecoveryFailureWindow[];
  longSessionPairs: RecoveryLongSessionPair[];
  thresholds: RecoveryContractThresholds;
  manifestHash: string;
};

export type RecoveryContractManifestDraft = Omit<RecoveryContractManifest, 'manifestHash'>;

const FAMILY_BLUEPRINTS: Record<
  RecoveryLongSessionFamily,
  { title: string; focus: string }
> = {
  compression: {
    title: 'Compress the active task spine and continue',
    focus: 'A long conversation is compacted at a checkpoint; the recovered turn must continue from the accepted compression artifact.',
  },
  handoff: {
    title: 'Hand off the work between sessions',
    focus: 'A session boundary hands the work to a fresh session; the recovered session must continue from accepted facts only.',
  },
  fork: {
    title: 'Fork a branch and continue the selected branch',
    focus: 'A fork creates a sibling branch; the recovered branch must keep its identity and must not inherit sibling state.',
  },
  restart: {
    title: 'Restart the process mid-conversation',
    focus: 'The desktop process restarts mid-task; the recovered session must reload the transcript tail and resume the pending step.',
  },
  revocation: {
    title: 'Revoke an earlier instruction and continue',
    focus: 'A prior instruction or fact is revoked; the recovered session must preserve the revocation and must not resurrect the revoked fact.',
  },
};

function buildLongSessionPair(
  family: RecoveryLongSessionFamily,
  pairIndex: number,
): RecoveryLongSessionPair {
  const blueprint = FAMILY_BLUEPRINTS[family];
  const caseId = 'ls-' + family + '-' + String(pairIndex + 1).padStart(2, '0');
  const mustPreserve = [
    'Objective ' + caseId + ' remains active after the ' + family + ' boundary',
    'Constraint ' + caseId + ': preserve the accepted scope and do not rerun committed effects',
    'Decision ' + caseId + ': keep the last owner-accepted recovery boundary',
    'Next action ' + caseId + ': resume from the last durable checkpoint',
  ];
  const expectedNextAction = 'next action ' + caseId + ': resume from the last durable checkpoint';
  const forbiddenCompletionClaims = [
    'All work for ' + caseId + ' is complete',
    caseId + ' has no remaining work',
  ];
  const prompt = blueprint.focus + ' Scenario ' + caseId + ' must continue without losing the four required facts.';
  const draft: Omit<RecoveryLongSessionPair, 'inputHash'> = {
    id: caseId,
    family,
    pairIndex,
    title: blueprint.title + ' #' + String(pairIndex + 1),
    prompt,
    mustPreserve,
    expectedNextAction,
    forbiddenCompletionClaims,
  };

  return { ...draft, inputHash: hashRecoveryLongSessionPairInput(draft) };
}

function cloneFailureWindows(): RecoveryFailureWindow[] {
  return RECOVERY_FAILURE_WINDOWS.map((window) => ({
    ...window,
    annotation: {
      ...window.annotation,
      requiredDiskEvidence: [...window.annotation.requiredDiskEvidence],
    },
  }));
}

/**
 * Build the deterministic frozen manifest. Regenerating it must produce the
 * same `manifestHash`; no timestamp from the wall clock is used.
 */
export function buildRecoveryContractManifest(
  actor: string = RECOVERY_CONTRACT_ACTOR,
): RecoveryContractManifest {
  const longSessionPairs: RecoveryLongSessionPair[] = [];
  for (let index = 0; index < MIN_LONG_SESSION_PAIRS; index += 1) {
    const family = RECOVERY_LONG_SESSION_FAMILIES[index % RECOVERY_LONG_SESSION_FAMILIES.length];
    const pairIndex = Math.floor(index / RECOVERY_LONG_SESSION_FAMILIES.length);
    longSessionPairs.push(buildLongSessionPair(family, pairIndex));
  }

  const draft: RecoveryContractManifestDraft = {
    schema: RECOVERY_CONTRACT_MANIFEST_SCHEMA,
    version: 1,
    frozenAt: RECOVERY_CONTRACT_FREEZE_EPOCH,
    frozenBeforeMeasurement: true,
    drivenBy: 'agent',
    actor: actor.trim() || RECOVERY_CONTRACT_ACTOR,
    windows: cloneFailureWindows(),
    longSessionPairs,
    thresholds: { ...RECOVERY_CONTRACT_THRESHOLDS },
  };

  return { ...draft, manifestHash: hashRecoveryContractManifest(draft) };
}

export function hashRecoveryContractManifest(
  value: RecoveryContractManifestDraft | RecoveryContractManifest,
): string {
  return sha256Text(stableJson(withoutManifestHash(value)));
}

export function hashRecoveryLongSessionPairInput(
  value: Omit<RecoveryLongSessionPair, 'inputHash'>,
): string {
  return sha256Text(stableJson(value));
}

export type RecoveryContractManifestCheck = {
  ok: boolean;
  blockers: string[];
};

/**
 * Validate that the manifest is the frozen contract: exact window matrix,
 * five annotations per window, at least 30 long-session pairs with every
 * family represented, unchanged thresholds, and a matching manifest hash.
 */
export function assertFrozenRecoveryContractManifest(
  manifest: RecoveryContractManifest,
): RecoveryContractManifestCheck {
  const blockers: string[] = [];

  if (manifest.schema !== RECOVERY_CONTRACT_MANIFEST_SCHEMA) blockers.push('manifest schema mismatch');
  if (manifest.version !== 1) blockers.push('manifest version mismatch');
  if (manifest.frozenAt !== RECOVERY_CONTRACT_FREEZE_EPOCH) blockers.push('manifest freeze epoch mismatch');
  if (manifest.frozenBeforeMeasurement !== true) blockers.push('manifest was not frozen before measurement');
  if (manifest.drivenBy !== 'agent') blockers.push('manifest is not agent-driven');
  if (typeof manifest.actor !== 'string' || manifest.actor.trim() === '') blockers.push('manifest actor is missing');

  const windows = Array.isArray(manifest.windows) ? manifest.windows : [];
  if (windows.length !== RECOVERY_FAILURE_WINDOW_IDS.length) {
    blockers.push('manifest must freeze exactly ' + String(RECOVERY_FAILURE_WINDOW_IDS.length) + ' failure windows');
  }
  const windowIds = windows.map((window) => window.id);
  for (const expectedId of RECOVERY_FAILURE_WINDOW_IDS) {
    if (!windowIds.includes(expectedId)) blockers.push('missing failure window: ' + expectedId);
  }
  for (const id of windowIds) {
    if (!RECOVERY_FAILURE_WINDOW_IDS.includes(id)) blockers.push('unknown failure window: ' + id);
  }
  if (windowIds.join('|') !== RECOVERY_FAILURE_WINDOW_IDS.join('|')) {
    blockers.push('failure window order does not match the frozen matrix');
  }
  for (const window of windows) {
    if (typeof window.title !== 'string' || window.title.trim() === '') {
      blockers.push('failure window title is missing: ' + window.id);
    }
    if (typeof window.description !== 'string' || window.description.trim() === '') {
      blockers.push('failure window description is missing: ' + window.id);
    }
    if (!Number.isFinite(window.minRepeats) || window.minRepeats < MIN_REPEATS_PER_WINDOW) {
      blockers.push('failure window ' + window.id + ' must repeat at least ' + String(MIN_REPEATS_PER_WINDOW) + ' times');
    }
    const annotation = window.annotation as Partial<RecoveryWindowAnnotation> | undefined;
    for (const field of RECOVERY_WINDOW_ANNOTATION_FIELDS) {
      const value = annotation?.[field];
      if (field === 'requiredDiskEvidence') {
        if (
          !Array.isArray(value)
          || value.length === 0
          || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')
        ) {
          blockers.push('failure window ' + window.id + ' is missing annotation requiredDiskEvidence');
        }
      } else if (typeof value !== 'string' || value.trim() === '') {
        blockers.push('failure window ' + window.id + ' is missing annotation ' + field);
      }
    }
  }
  const pairs = Array.isArray(manifest.longSessionPairs) ? manifest.longSessionPairs : [];
  if (pairs.length < MIN_LONG_SESSION_PAIRS) {
    blockers.push('fewer than ' + String(MIN_LONG_SESSION_PAIRS) + ' long-session pairs');
  }
  const seenIds = new Set<string>();
  const seenIndexes = new Set<string>();
  const familyCounts: Record<RecoveryLongSessionFamily, number> = {
    compression: 0,
    handoff: 0,
    fork: 0,
    restart: 0,
    revocation: 0,
  };
  for (const pair of pairs) {
    if (seenIds.has(pair.id)) blockers.push('duplicate long-session pair id: ' + pair.id);
    seenIds.add(pair.id);
    const indexKey = pair.family + ':' + String(pair.pairIndex);
    if (seenIndexes.has(indexKey)) blockers.push('duplicate long-session pair index: ' + indexKey);
    seenIndexes.add(indexKey);
    if (!RECOVERY_LONG_SESSION_FAMILIES.includes(pair.family)) {
      blockers.push('unknown long-session family: ' + String(pair.family));
    } else {
      familyCounts[pair.family] += 1;
    }
    if (typeof pair.title !== 'string' || pair.title.trim() === '') blockers.push('long-session pair title is missing: ' + pair.id);
    if (typeof pair.prompt !== 'string' || pair.prompt.trim() === '') blockers.push('long-session pair prompt is missing: ' + pair.id);
    if (pair.mustPreserve.length < 4) blockers.push('long-session pair has fewer than four must-preserve facts: ' + pair.id);
    if (typeof pair.expectedNextAction !== 'string' || pair.expectedNextAction.trim() === '') {
      blockers.push('long-session pair has no expected next action: ' + pair.id);
    }
    if (pair.forbiddenCompletionClaims.length === 0) {
      blockers.push('long-session pair has no forbidden completion claims: ' + pair.id);
    }
    if (pair.inputHash !== hashRecoveryLongSessionPairInput({
      id: pair.id,
      family: pair.family,
      pairIndex: pair.pairIndex,
      title: pair.title,
      prompt: pair.prompt,
      mustPreserve: pair.mustPreserve,
      expectedNextAction: pair.expectedNextAction,
      forbiddenCompletionClaims: pair.forbiddenCompletionClaims,
    })) {
      blockers.push('long-session pair input hash mismatch: ' + pair.id);
    }
  }
  for (const family of RECOVERY_LONG_SESSION_FAMILIES) {
    if (familyCounts[family] < MIN_LONG_SESSION_PAIRS_PER_FAMILY) {
      blockers.push('long-session family ' + family + ' has fewer than ' + String(MIN_LONG_SESSION_PAIRS_PER_FAMILY) + ' pairs');
    }
  }

  const frozen = buildRecoveryContractManifest(
    typeof manifest.actor === 'string' ? manifest.actor : RECOVERY_CONTRACT_ACTOR,
  );
  if (stableJson(windows) !== stableJson(frozen.windows)) {
    blockers.push('failure window matrix changed under the frozen epoch');
  }
  if (stableJson(pairs) !== stableJson(frozen.longSessionPairs)) {
    blockers.push('long-session workload changed under the frozen epoch');
  }

  if (stableJson(manifest.thresholds) !== stableJson(RECOVERY_CONTRACT_THRESHOLDS)) {
    blockers.push('quantified thresholds changed after freeze');
  }
  if (manifest.manifestHash !== hashRecoveryContractManifest(manifest)) {
    blockers.push('manifest hash mismatch after freeze');
  }

  return { ok: blockers.length === 0, blockers };
}

export type RecoveryMetricValue = number | null;

/**
 * All metrics are nullable. `null` means "not measured" and is never replaced
 * with zero when the sample is incomplete.
 */
export type RecoveryContractEvalMetrics = {
  duplicateEffects: RecoveryMetricValue;
  lostTasks: RecoveryMetricValue;
  terminalCorrectness: RecoveryMetricValue;
  unknownClassifiableRate: RecoveryMetricValue;
  mustPreserveFidelity: RecoveryMetricValue;
  falseCompletionClaims: RecoveryMetricValue;
  nextActionAccuracy: RecoveryMetricValue;
  recoveryLatencyP50: RecoveryMetricValue;
  recoveryLatencyP95: RecoveryMetricValue;
};

export const RECOVERY_CONTRACT_METRIC_FIELDS = [
  'duplicateEffects',
  'lostTasks',
  'terminalCorrectness',
  'unknownClassifiableRate',
  'mustPreserveFidelity',
  'falseCompletionClaims',
  'nextActionAccuracy',
  'recoveryLatencyP50',
  'recoveryLatencyP95',
] as const;

export type RecoveryContractMetricField = (typeof RECOVERY_CONTRACT_METRIC_FIELDS)[number];

export type RecoveryWindowTrial = {
  windowId: RecoveryFailureWindowId;
  trialIndex: number;
  /** Must equal the frozen annotation injection point when the trial is scored. */
  injectionPoint: string | null;
  duplicateEffects: number | null;
  lostTasks: number | null;
  terminalCorrect: boolean | null;
  unknownClassifiable: boolean | null;
  recoveryLatencyMs: number | null;
  /** Whether every file named by the window's `requiredDiskEvidence` was read back. */
  diskEvidenceComplete: boolean | null;
  /** True when any work in the forbidden rerun region was replayed. */
  rerunOutsideAllowedRegion: boolean | null;
  /** Path or artifact id that points at the disk evidence. */
  evidenceRef: string | null;
};

type CompleteWindowTrial = RecoveryWindowTrial & {
  injectionPoint: string;
  duplicateEffects: number;
  lostTasks: number;
  terminalCorrect: boolean;
  unknownClassifiable: boolean;
  recoveryLatencyMs: number;
  diskEvidenceComplete: boolean;
  rerunOutsideAllowedRegion: boolean;
  evidenceRef: string;
};

export type RecoveryMeasurementBasis = 'live-provider' | 'scripted-provider' | 'agent-derived';

export type RecoveryLongSessionMeasurement = {
  pairId: string;
  family: RecoveryLongSessionFamily;
  provider: string;
  model: string;
  measurementBasis: RecoveryMeasurementBasis;
  /** How many of the pair's `mustPreserve` facts survived the recovery. */
  mustPreserveMatched: number | null;
  falseCompletionClaim: boolean | null;
  nextActionCorrect: boolean | null;
  recoveryLatencyMs: number | null;
  evidenceRef: string | null;
};

type CompleteLongSessionMeasurement = RecoveryLongSessionMeasurement & {
  provider: string;
  model: string;
  mustPreserveMatched: number;
  falseCompletionClaim: boolean;
  nextActionCorrect: boolean;
  recoveryLatencyMs: number;
  evidenceRef: string;
};

export type RecoveryWindowCoverage = {
  windowId: RecoveryFailureWindowId;
  requiredRepeats: number;
  observedRepeats: number;
  completeRepeats: number;
};

export type RecoveryLongSessionCoverage = {
  requiredPairs: number;
  observedPairs: number;
  completePairs: number;
  liveProviderPairs: number;
  scriptedProviderPairs: number;
  agentDerivedPairs: number;
  families: Record<RecoveryLongSessionFamily, number>;
};

export type RecoveryContractEvalCoverage = {
  windows: RecoveryWindowCoverage[];
  longSession: RecoveryLongSessionCoverage;
};

export type RecoveryContractGateResult = {
  name: string;
  observed: number | null;
  threshold: string;
  pass: boolean | null;
};

export type RecoveryContractEvalStatus = 'PASS' | 'FAIL' | 'EVIDENCE_INSUFFICIENT';

export type RecoveryContractEvalInput = {
  manifest: RecoveryContractManifest;
  windowTrials: RecoveryWindowTrial[];
  longSessionMeasurements: RecoveryLongSessionMeasurement[];
  generatedAt?: string;
  actor?: string;
};

export type RecoveryContractEvalResult = {
  schema: typeof RECOVERY_CONTRACT_EVAL_SCHEMA;
  generatedAt: string;
  drivenBy: 'agent';
  actor: string;
  /** This eval never claims real-human evidence. */
  realHumanEvidence: false;
  manifestHash: string;
  status: RecoveryContractEvalStatus;
  qualityClaimAllowed: boolean;
  metrics: RecoveryContractEvalMetrics;
  coverage: RecoveryContractEvalCoverage;
  gates: RecoveryContractGateResult[];
  blockers: string[];
  unmeasured: string[];
  decision: {
    disposition: 'contract-passed' | 'contract-failed' | 'evidence-insufficient';
    productDefaultChanged: false;
    requiresPublisherDecision: false;
  };
};

type CoverageBuild = {
  coverage: RecoveryContractEvalCoverage;
  completeWindowTrials: CompleteWindowTrial[];
  liveMeasurements: Array<{
    measurement: CompleteLongSessionMeasurement;
    pair: RecoveryLongSessionPair;
  }>;
  evidenceIssues: string[];
  windowEvidenceValid: boolean;
  longSessionEvidenceValid: boolean;
};
function emptyMetrics(): RecoveryContractEvalMetrics {
  return {
    duplicateEffects: null,
    lostTasks: null,
    terminalCorrectness: null,
    unknownClassifiableRate: null,
    mustPreserveFidelity: null,
    falseCompletionClaims: null,
    nextActionAccuracy: null,
    recoveryLatencyP50: null,
    recoveryLatencyP95: null,
  };
}

function isCompleteWindowTrial(trial: RecoveryWindowTrial): trial is CompleteWindowTrial {
  return (
    Number.isInteger(trial.trialIndex)
    && trial.trialIndex >= 0
    && typeof trial.injectionPoint === 'string'
    && trial.injectionPoint.trim() !== ''
    && typeof trial.duplicateEffects === 'number'
    && Number.isFinite(trial.duplicateEffects)
    && trial.duplicateEffects >= 0
    && typeof trial.lostTasks === 'number'
    && Number.isFinite(trial.lostTasks)
    && trial.lostTasks >= 0
    && typeof trial.terminalCorrect === 'boolean'
    && typeof trial.unknownClassifiable === 'boolean'
    && typeof trial.recoveryLatencyMs === 'number'
    && Number.isFinite(trial.recoveryLatencyMs)
    && trial.recoveryLatencyMs >= 0
    && typeof trial.diskEvidenceComplete === 'boolean'
    && typeof trial.rerunOutsideAllowedRegion === 'boolean'
    && typeof trial.evidenceRef === 'string'
    && trial.evidenceRef.trim() !== ''
  );
}

function isCompleteLongSessionMeasurement(
  measurement: RecoveryLongSessionMeasurement,
): measurement is CompleteLongSessionMeasurement {
  return (
    typeof measurement.pairId === 'string'
    && measurement.pairId.trim() !== ''
    && RECOVERY_LONG_SESSION_FAMILIES.includes(measurement.family)
    && typeof measurement.provider === 'string'
    && measurement.provider.trim() !== ''
    && typeof measurement.model === 'string'
    && measurement.model.trim() !== ''
    && ['live-provider', 'scripted-provider', 'agent-derived'].includes(measurement.measurementBasis)
    && typeof measurement.mustPreserveMatched === 'number'
    && Number.isFinite(measurement.mustPreserveMatched)
    && measurement.mustPreserveMatched >= 0
    && typeof measurement.falseCompletionClaim === 'boolean'
    && typeof measurement.nextActionCorrect === 'boolean'
    && typeof measurement.recoveryLatencyMs === 'number'
    && Number.isFinite(measurement.recoveryLatencyMs)
    && measurement.recoveryLatencyMs >= 0
    && typeof measurement.evidenceRef === 'string'
    && measurement.evidenceRef.trim() !== ''
  );
}

function buildCoverage(
  manifest: RecoveryContractManifest,
  windowTrials: RecoveryWindowTrial[],
  longSessionMeasurements: RecoveryLongSessionMeasurement[],
): CoverageBuild {
  const windowEvidenceIssues: string[] = [];
  const longSessionEvidenceIssues: string[] = [];
  const windows = Array.isArray(manifest.windows) ? manifest.windows : [];
  const windowById = new Map(windows.map((window) => [window.id, window]));
  const completeByWindow = new Map<RecoveryFailureWindowId, CompleteWindowTrial[]>();
  for (const id of RECOVERY_FAILURE_WINDOW_IDS) completeByWindow.set(id, []);

  const seenTrialKeys = new Set<string>();
  for (const trial of windowTrials) {
    if (!RECOVERY_FAILURE_WINDOW_IDS.includes(trial.windowId)) {
      windowEvidenceIssues.push('unknown failure window trial: ' + String(trial.windowId));
      continue;
    }
    if (!isCompleteWindowTrial(trial)) {
      windowEvidenceIssues.push('incomplete failure window trial: ' + trial.windowId + '#' + String(trial.trialIndex));
      continue;
    }
    const definition = windowById.get(trial.windowId);
    if (!definition) {
      windowEvidenceIssues.push('trial references a window missing from the manifest: ' + trial.windowId);
      continue;
    }
    if (trial.injectionPoint !== definition.annotation.injectionPoint) {
      windowEvidenceIssues.push('trial injection point does not match the frozen annotation: ' + trial.windowId + '#' + String(trial.trialIndex));
      continue;
    }
    const key = trial.windowId + ':' + String(trial.trialIndex);
    if (seenTrialKeys.has(key)) {
      windowEvidenceIssues.push('duplicate window trial index: ' + key);
      continue;
    }
    seenTrialKeys.add(key);
    completeByWindow.get(trial.windowId)?.push(trial);
  }

  const windowCoverage: RecoveryWindowCoverage[] = RECOVERY_FAILURE_WINDOW_IDS.map((windowId) => {
    const definition = windowById.get(windowId);
    return {
      windowId,
      requiredRepeats: definition?.minRepeats ?? MIN_REPEATS_PER_WINDOW,
      observedRepeats: windowTrials.filter((trial) => trial.windowId === windowId).length,
      completeRepeats: completeByWindow.get(windowId)?.length ?? 0,
    };
  });
  for (const coverage of windowCoverage) {
    if (coverage.completeRepeats > coverage.observedRepeats) {
      windowEvidenceIssues.push('window ' + coverage.windowId + ' complete repeats exceed observed repeats');
      coverage.completeRepeats = coverage.observedRepeats;
    }
  }

  const pairs = Array.isArray(manifest.longSessionPairs) ? manifest.longSessionPairs : [];
  const pairById = new Map(pairs.map((pair) => [pair.id, pair]));
  const uniqueMeasurements = new Map<string, CompleteLongSessionMeasurement>();
  for (const measurement of longSessionMeasurements) {
    if (!isCompleteLongSessionMeasurement(measurement)) {
      longSessionEvidenceIssues.push('incomplete long-session measurement: ' + measurement.pairId);
      continue;
    }
    const pair = pairById.get(measurement.pairId);
    if (!pair) {
      longSessionEvidenceIssues.push('long-session measurement outside the frozen workload: ' + measurement.pairId);
      continue;
    }
    if (measurement.family !== pair.family) {
      longSessionEvidenceIssues.push('long-session measurement family mismatch: ' + measurement.pairId);
      continue;
    }
    if (measurement.mustPreserveMatched > pair.mustPreserve.length) {
      longSessionEvidenceIssues.push('long-session measurement matched more facts than the pair defines: ' + measurement.pairId);
      continue;
    }
    if (uniqueMeasurements.has(measurement.pairId)) {
      longSessionEvidenceIssues.push('duplicate long-session measurement: ' + measurement.pairId);
      continue;
    }
    uniqueMeasurements.set(measurement.pairId, measurement);
  }

  const completeMeasurements = [...uniqueMeasurements.values()];
  const liveMeasurements = completeMeasurements
    .filter((measurement) => measurement.measurementBasis === 'live-provider')
    .map((measurement) => ({
      measurement,
      pair: pairById.get(measurement.pairId) as RecoveryLongSessionPair,
    }));

  const families: Record<RecoveryLongSessionFamily, number> = {
    compression: 0,
    handoff: 0,
    fork: 0,
    restart: 0,
    revocation: 0,
  };
  for (const entry of liveMeasurements) families[entry.pair.family] += 1;

  return {
    coverage: {
      windows: windowCoverage,
      longSession: {
        requiredPairs: MIN_LONG_SESSION_PAIRS,
        observedPairs: longSessionMeasurements.length,
        completePairs: completeMeasurements.length,
        liveProviderPairs: liveMeasurements.length,
        scriptedProviderPairs: completeMeasurements.filter(
          (measurement) => measurement.measurementBasis === 'scripted-provider',
        ).length,
        agentDerivedPairs: completeMeasurements.filter(
          (measurement) => measurement.measurementBasis === 'agent-derived',
        ).length,
        families,
      },
    },
    completeWindowTrials: RECOVERY_FAILURE_WINDOW_IDS.flatMap((windowId) => (
      [...(completeByWindow.get(windowId) ?? [])].sort((left, right) => left.trialIndex - right.trialIndex)
    )),
    liveMeasurements,
    evidenceIssues: [...windowEvidenceIssues, ...longSessionEvidenceIssues],
    windowEvidenceValid: windowEvidenceIssues.length === 0,
    longSessionEvidenceValid: longSessionEvidenceIssues.length === 0,
  };
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0];
  const rank = (percentileValue / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}
function gate(
  name: string,
  observed: number | null,
  threshold: string,
  pass: boolean | null,
): RecoveryContractGateResult {
  return { name, observed, threshold, pass };
}

function evaluateGates(
  metrics: RecoveryContractEvalMetrics,
  completeWindowTrials: CompleteWindowTrial[],
): { gates: RecoveryContractGateResult[]; failures: string[] } {
  const failures: string[] = [];
  const gates: RecoveryContractGateResult[] = [];

  const check = (
    name: string,
    observed: number | null,
    threshold: string,
    pass: boolean | null,
    failure: string,
  ): void => {
    gates.push(gate(name, observed, threshold, pass));
    if (pass === false) failures.push(failure);
  };

  check(
    'duplicateEffects',
    metrics.duplicateEffects,
    '= 0',
    metrics.duplicateEffects === null ? null : metrics.duplicateEffects === 0,
    'duplicateEffects must be 0 (observed ' + String(metrics.duplicateEffects) + ')',
  );
  check(
    'lostTasks',
    metrics.lostTasks,
    '= 0',
    metrics.lostTasks === null ? null : metrics.lostTasks === 0,
    'lostTasks must be 0 (observed ' + String(metrics.lostTasks) + ')',
  );
  check(
    'terminalCorrectness',
    metrics.terminalCorrectness,
    '= 1',
    metrics.terminalCorrectness === null ? null : metrics.terminalCorrectness === 1,
    'terminalCorrectness must be 1 (observed ' + String(metrics.terminalCorrectness) + ')',
  );
  check(
    'unknownClassifiableRate',
    metrics.unknownClassifiableRate,
    '<= 0.02',
    metrics.unknownClassifiableRate === null ? null : metrics.unknownClassifiableRate <= RECOVERY_CONTRACT_THRESHOLDS.unknownClassifiableRateMax,
    'unknownClassifiableRate must be <= 0.02 (observed ' + String(metrics.unknownClassifiableRate) + ')',
  );
  check(
    'mustPreserveFidelity',
    metrics.mustPreserveFidelity,
    '= 1',
    metrics.mustPreserveFidelity === null ? null : metrics.mustPreserveFidelity === 1,
    'mustPreserveFidelity must be 1 (observed ' + String(metrics.mustPreserveFidelity) + ')',
  );
  check(
    'falseCompletionClaims',
    metrics.falseCompletionClaims,
    '= 0',
    metrics.falseCompletionClaims === null ? null : metrics.falseCompletionClaims === 0,
    'falseCompletionClaims must be 0 (observed ' + String(metrics.falseCompletionClaims) + ')',
  );
  check(
    'nextActionAccuracy',
    metrics.nextActionAccuracy,
    '>= 0.95',
    metrics.nextActionAccuracy === null ? null : metrics.nextActionAccuracy >= RECOVERY_CONTRACT_THRESHOLDS.nextActionAccuracyMin,
    'nextActionAccuracy must be >= 0.95 (observed ' + String(metrics.nextActionAccuracy) + ')',
  );
  check(
    'recoveryLatencyP50',
    metrics.recoveryLatencyP50,
    '<= 5000ms',
    metrics.recoveryLatencyP50 === null ? null : metrics.recoveryLatencyP50 <= RECOVERY_CONTRACT_THRESHOLDS.recoveryLatencyP50MsMax,
    'recoveryLatencyP50 must be <= 5000ms (observed ' + String(metrics.recoveryLatencyP50) + ')',
  );
  check(
    'recoveryLatencyP95',
    metrics.recoveryLatencyP95,
    '<= 15000ms',
    metrics.recoveryLatencyP95 === null ? null : metrics.recoveryLatencyP95 <= RECOVERY_CONTRACT_THRESHOLDS.recoveryLatencyP95MsMax,
    'recoveryLatencyP95 must be <= 15000ms (observed ' + String(metrics.recoveryLatencyP95) + ')',
  );

  const diskFailures = completeWindowTrials.filter((trial) => !trial.diskEvidenceComplete).length;
  check(
    'diskEvidenceComplete',
    diskFailures,
    '= 0 failures',
    completeWindowTrials.length === 0 ? null : diskFailures === 0,
    String(diskFailures) + ' window trial(s) did not read back all required disk evidence',
  );
  const rerunViolations = completeWindowTrials.filter((trial) => trial.rerunOutsideAllowedRegion).length;
  check(
    'rerunOutsideAllowedRegion',
    rerunViolations,
    '= 0 violations',
    completeWindowTrials.length === 0 ? null : rerunViolations === 0,
    String(rerunViolations) + ' window trial(s) reran work inside the forbidden region',
  );

  return { gates, failures };
}

/**
 * Score a recovery-contract run. Pure: all evidence arrives in the input.
 *
 * Sample minimums are hard gates: fewer than three complete repeats in any
 * window, or fewer than 30 live-provider long-session pairs, returns
 * `EVIDENCE_INSUFFICIENT`. Metrics that lack a complete evidence domain stay
 * `null`; they are never zero-filled.
 */
export function evaluateRecoveryContractEval(
  input: RecoveryContractEvalInput,
): RecoveryContractEvalResult {
  const manifest = input.manifest;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const actor = input.actor ?? manifest?.actor ?? RECOVERY_CONTRACT_ACTOR;
  const metrics = emptyMetrics();
  const blockers: string[] = [];
  const unmeasured: string[] = [];
  const pairCount = Array.isArray(manifest?.longSessionPairs) ? manifest.longSessionPairs.length : 0;
  const coverageBuild = buildCoverage(
    manifest,
    input.windowTrials ?? [],
    input.longSessionMeasurements ?? [],
  );
  const { coverage, completeWindowTrials, liveMeasurements, evidenceIssues } = coverageBuild;
  blockers.push(...evidenceIssues);

  const manifestCheck = assertFrozenRecoveryContractManifest(manifest);
  blockers.push(...manifestCheck.blockers);

  const windowsComplete = coverage.windows.every(
    (window) => window.completeRepeats >= window.requiredRepeats,
  ) && coverageBuild.windowEvidenceValid;
  const familiesComplete = RECOVERY_LONG_SESSION_FAMILIES.every(
    (family) => coverage.longSession.families[family] >= MIN_LONG_SESSION_PAIRS_PER_FAMILY,
  );
  const longSessionComplete = coverage.longSession.liveProviderPairs >= MIN_LONG_SESSION_PAIRS
    && familiesComplete
    && coverageBuild.longSessionEvidenceValid;

  if (!windowsComplete) {
    for (const window of coverage.windows) {
      if (window.completeRepeats < window.requiredRepeats) {
        unmeasured.push(
          'window ' + window.windowId + ': ' + String(window.completeRepeats) + '/' + String(window.requiredRepeats) + ' complete repeats',
        );
      }
    }
  }
  if (!longSessionComplete) {
    unmeasured.push(
      'long-session live-provider pairs: ' + String(coverage.longSession.liveProviderPairs) + '/' + String(MIN_LONG_SESSION_PAIRS),
    );
    if (coverage.longSession.scriptedProviderPairs > 0 || coverage.longSession.agentDerivedPairs > 0) {
      unmeasured.push(
        'scripted-provider and agent-derived long-session rows are recorded but never counted as quality evidence',
      );
    }
    for (const family of RECOVERY_LONG_SESSION_FAMILIES) {
      if (coverage.longSession.families[family] < MIN_LONG_SESSION_PAIRS_PER_FAMILY) {
        unmeasured.push(
          'long-session family ' + family + ': ' + String(coverage.longSession.families[family]) + '/' + String(MIN_LONG_SESSION_PAIRS_PER_FAMILY) + ' live-provider pairs',
        );
      }
    }
  }

  if (manifestCheck.ok && windowsComplete) {
    const duplicateEffects = completeWindowTrials.reduce((sum, trial) => sum + trial.duplicateEffects, 0);
    const lostTasks = completeWindowTrials.reduce((sum, trial) => sum + trial.lostTasks, 0);
    const terminalCorrect = completeWindowTrials.filter((trial) => trial.terminalCorrect).length;
    const unknownClassifiable = completeWindowTrials.filter((trial) => trial.unknownClassifiable).length;
    metrics.duplicateEffects = duplicateEffects;
    metrics.lostTasks = lostTasks;
    metrics.terminalCorrectness = terminalCorrect / completeWindowTrials.length;
    metrics.unknownClassifiableRate = unknownClassifiable / completeWindowTrials.length;
  }

  if (manifestCheck.ok && longSessionComplete) {
    const requiredFacts = liveMeasurements.reduce(
      (sum, entry) => sum + entry.pair.mustPreserve.length,
      0,
    );
    const matchedFacts = liveMeasurements.reduce(
      (sum, entry) => sum + entry.measurement.mustPreserveMatched,
      0,
    );
    metrics.mustPreserveFidelity = requiredFacts === 0 ? null : matchedFacts / requiredFacts;
    metrics.falseCompletionClaims = liveMeasurements.filter(
      (entry) => entry.measurement.falseCompletionClaim,
    ).length;
    metrics.nextActionAccuracy = liveMeasurements.filter(
      (entry) => entry.measurement.nextActionCorrect,
    ).length / liveMeasurements.length;
  }

  if (manifestCheck.ok && windowsComplete && longSessionComplete) {
    const latencies = [
      ...completeWindowTrials.map((trial) => trial.recoveryLatencyMs),
      ...liveMeasurements.map((entry) => entry.measurement.recoveryLatencyMs),
    ];
    metrics.recoveryLatencyP50 = percentile(latencies, 50);
    metrics.recoveryLatencyP95 = percentile(latencies, 95);
  }

  const gateEvaluation = evaluateGates(metrics, completeWindowTrials);
  const metricFieldsPresent = RECOVERY_CONTRACT_METRIC_FIELDS.every(
    (field) => field in metrics,
  );
  if (!metricFieldsPresent) blockers.push('metric fields are incomplete');

  let status: RecoveryContractEvalStatus;
  if (!manifestCheck.ok || evidenceIssues.length > 0) {
    status = 'EVIDENCE_INSUFFICIENT';
    unmeasured.push('no quality metric can be computed from an invalid or out-of-workload evidence set');
  } else if (!windowsComplete || !longSessionComplete) {
    status = 'EVIDENCE_INSUFFICIENT';
  } else if (gateEvaluation.failures.length > 0) {
    status = 'FAIL';
    blockers.push(...gateEvaluation.failures);
  } else {
    status = 'PASS';
  }

  if (status === 'PASS' && pairCount < MIN_LONG_SESSION_PAIRS) {
    status = 'EVIDENCE_INSUFFICIENT';
    unmeasured.push('manifest long-session pairs: ' + String(pairCount) + '/' + String(MIN_LONG_SESSION_PAIRS));
  }

  const qualityClaimAllowed = status === 'PASS' && longSessionComplete;

  return {
    schema: RECOVERY_CONTRACT_EVAL_SCHEMA,
    generatedAt,
    drivenBy: 'agent',
    actor,
    realHumanEvidence: false,
    manifestHash: manifest?.manifestHash ?? '',
    status,
    qualityClaimAllowed,
    metrics,
    coverage,
    gates: gateEvaluation.gates,
    blockers,
    unmeasured,
    decision: {
      disposition: status === 'PASS'
        ? 'contract-passed'
        : status === 'FAIL'
          ? 'contract-failed'
          : 'evidence-insufficient',
      productDefaultChanged: false,
      requiresPublisherDecision: false,
    },
  };
}
function withoutManifestHash(
  value: RecoveryContractManifestDraft | RecoveryContractManifest,
): Record<string, unknown> {
  const content: Record<string, unknown> = { ...value };
  delete content.manifestHash;
  return content;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableJson(record[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}
