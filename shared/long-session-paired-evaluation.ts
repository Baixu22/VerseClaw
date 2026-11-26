/**
 * D2 · paired evaluation of long-session continuity (contract:
 * `harness/specs/tasks/long-session-paired-evaluation.md`).
 *
 * This module owns two things and nothing else:
 *   1. a pre-measurement frozen workload manifest (>= 30 agent-driven pairs over
 *      compression / handoff / fork / restart / revocation), and
 *   2. the pure scoring rules that turn per-arm outputs into the fidelity,
 *      next-action, false-completion, token/cost and latency report.
 *
 * It is a decision-input harness, not a second context, memory, compression or
 * injection owner: the candidate arm only consumes the already-accepted
 * `CompressionArtifact` / `ContinuityContextPack` shapes owned elsewhere.
 * Nothing here claims a quality win: without live-provider measurements the
 * report must be `EVIDENCE_INSUFFICIENT` / `NO-GO` and keep the baseline.
 */
import { createHash } from 'node:crypto';
import type {
  CompressionArtifact,
  CompressionFact,
  CompressionSemanticAtom,
} from './host-api/contract';

/** C01 grades continued owner operations and disk artifacts, separately from text fidelity. */
export type ContinuationObservation = Record<string, string | number | boolean | null>;
export type ContinuationGrade = {
  status: 'pass' | 'fail' | 'unknown';
  matched: string[];
  failed: string[];
  unknown: string[];
};

export function gradeAutonomyContinuation(
  expected: ContinuationObservation,
  observed: ContinuationObservation,
): ContinuationGrade {
  if (!Object.keys(expected).length) throw new Error('CONTINUATION_ORACLE_EMPTY');
  const matched: string[] = [], failed: string[] = [], unknown: string[] = [];
  for (const [field, value] of Object.entries(expected)) {
    if (!Object.hasOwn(observed, field) || observed[field] === undefined
      || (typeof observed[field] === 'number' && !Number.isFinite(observed[field]))) unknown.push(field);
    else if (observed[field] === null && value !== null) unknown.push(field);
    else if (observed[field] === value) matched.push(field);
    else failed.push(field);
  }
  return { status: failed.length ? 'fail' : unknown.length ? 'unknown' : 'pass', matched, failed, unknown };
}

export const CONTINUATION_COST_FIELDS = [
  'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'wallMs',
] as const;
export const CONTINUATION_COST_PHASES = ['execution', 'organization', 'readback', 'failure', 'retry'] as const;
export type ContinuationCostValues = Record<typeof CONTINUATION_COST_FIELDS[number], number | null>;
export type ContinuationCostEvent = {
  id: string;
  phase: typeof CONTINUATION_COST_PHASES[number];
  basis: 'provider-receipt' | 'fixture' | 'unmeasured';
  terminal: 'done' | 'error' | 'unknown';
  values: ContinuationCostValues;
};

/** Events are disjoint charges; a retry must not be counted again as an execution charge. */
export function sumAutonomyContinuationCosts(events: readonly ContinuationCostEvent[]) {
  const ids = new Set<string>();
  for (const event of events) {
    if (!event.id || ids.has(event.id)) throw new Error('CONTINUATION_COST_DUPLICATE');
    ids.add(event.id);
    if (!CONTINUATION_COST_PHASES.includes(event.phase)) throw new Error('CONTINUATION_COST_PHASE');
    for (const field of CONTINUATION_COST_FIELDS) {
      const value = event.values[field];
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
        throw new Error(`CONTINUATION_COST_INVALID:${field}`);
    }
  }
  const total = {} as ContinuationCostValues;
  const knownSubtotal = {} as Record<typeof CONTINUATION_COST_FIELDS[number], number>;
  const unknownCells = {} as Record<typeof CONTINUATION_COST_FIELDS[number], number>;
  for (const field of CONTINUATION_COST_FIELDS) {
    const measured = events.filter(event => event.terminal !== 'unknown' && event.values[field] !== null);
    knownSubtotal[field] = measured.reduce((sum, event) => sum + event.values[field]!, 0);
    unknownCells[field] = events.length - measured.length;
    total[field] = events.length > 0 && unknownCells[field] === 0 ? knownSubtotal[field] : null;
  }
  return { total, knownSubtotal, unknownCells,
    providerMeasured: events.length > 0 && events.every(event => event.basis === 'provider-receipt'
      && event.terminal !== 'unknown' && CONTINUATION_COST_FIELDS.every(field => event.values[field] !== null)) };
}

export const PAIRED_EVALUATION_SCHEMA = 'LongSessionPairedEvaluation/v1' as const;
export const PAIRED_WORKLOAD_SCHEMA = 'LongSessionPairedWorkloadManifest/v1' as const;
export const PAIRED_WORKLOAD_SEED = 'long-session-d2-v1' as const;
export const PAIRED_TARGET_COUNT = 30;
export const PAIRED_CANDIDATE_IDENTITY = 'ContinuityContextPack/v1' as const;
/** Fixed so re-generating the manifest never re-signs the frozen workload. */
export const PAIRED_FREEZE_EPOCH = '2026-10-23T00:00:00.000Z';

export type PairedWorkloadFamily =
  | 'compression'
  | 'handoff'
  | 'fork'
  | 'restart'
  | 'revocation';

export const PAIRED_WORKLOAD_FAMILIES: readonly PairedWorkloadFamily[] = [
  'compression',
  'handoff',
  'fork',
  'restart',
  'revocation',
];

export type PairedMustPreserveFact = {
  id: string;
  text: string;
  kind: CompressionSemanticAtom['type'];
};

export type PairedForbiddenFact = {
  id: string;
  text: string;
  reason: 'revoked-or-superseded' | 'pending-not-accepted' | 'unverified-claim' | 'out-of-scope';
};

export type PairedWorkloadTranscriptTurn = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
};

export type PairedWorkloadCase = {
  id: string;
  family: PairedWorkloadFamily;
  title: string;
  prompt: string;
  pairIndex: number;
  variantIndex: number;
  /** Shared input identity; both arms must run against exactly this. */
  inputHash: string;
  baselineTranscript: PairedWorkloadTranscriptTurn[];
  mustPreserve: PairedMustPreserveFact[];
  forbiddenFacts: PairedForbiddenFact[];
  expectedNextAction: string;
  forbiddenCompletionClaims: string[];
  /** Candidate arm = the bounded accepted projection, owned by D1/context. */
  candidateArtifact: CompressionArtifact;
};

export type PairedWorkloadManifest = {
  schema: typeof PAIRED_WORKLOAD_SCHEMA;
  version: 1;
  frozenAt: string;
  frozenBeforeMeasurement: true;
  drivenBy: 'agent';
  actor: string;
  seed: typeof PAIRED_WORKLOAD_SEED;
  workloadCount: number;
  minimumRequired: number;
  /** One shared model/parameter block: baseline and candidate must not differ. */
  modelParameters: {
    model: string;
    temperature: 0;
    maxOutputTokens: number;
  };
  metricBudget: {
    minimumPairs: 30;
    fidelityTarget: 1;
    nextActionTarget: 0.95;
    falseCompletionTarget: 0;
    revokedLeakTarget: 0;
    costOrInputTokenReductionTarget: 0.15;
    p95LatencyRatioLimit: 1.1;
  };
  families: Record<PairedWorkloadFamily, number>;
  cases: PairedWorkloadCase[];
  workloadHash: string;
};

/** `null` always means "not measured", never zero and never a character estimate. */
export type PairedMeasurementValue = number | null;

export type PairedCostSource = 'provider-report' | 'character-estimate' | 'unmeasured';

export type PairedArmMeasurement = {
  arm: 'baseline' | 'candidate';
  provider: string;
  model: string;
  /** 'agent-derived' = deterministic structural output, not a live model run. */
  measurementBasis: 'live-provider' | 'agent-derived';
  outputText: string;
  matchedMustPreserve: string[];
  missedMustPreserve: string[];
  leakedForbiddenFacts: string[];
  nextActionCorrect: boolean;
  falseCompletion: boolean;
  costSource: PairedCostSource;
  inputTokens: PairedMeasurementValue;
  outputTokens: PairedMeasurementValue;
  cacheReadTokens: PairedMeasurementValue;
  cacheWriteTokens: PairedMeasurementValue;
  totalCostUsd: PairedMeasurementValue;
  firstTokenMs: PairedMeasurementValue;
  wallClockMs: PairedMeasurementValue;
};

export type PairedMeasurementRow = {
  caseId: string;
  family: PairedWorkloadFamily;
  runIndex: number;
  inputHash: string;
  baseline: PairedArmMeasurement;
  candidate: PairedArmMeasurement;
};

export type PairedEvaluationStatus = 'PASS' | 'NO_GO' | 'EVIDENCE_INSUFFICIENT';
export type PairedDisposition = 'promote-candidate-eligible' | 'NO-GO' | 'keep-baseline';

export type PairedEvaluationMetrics = {
  baselineFidelity: number;
  candidateFidelity: number;
  baselineNextActionAccuracy: number;
  candidateNextActionAccuracy: number;
  baselineFalseCompletions: number;
  candidateFalseCompletions: number;
  baselineRevokedLeaks: number;
  candidateRevokedLeaks: number;
  baselineInputTokens: PairedMeasurementValue;
  candidateInputTokens: PairedMeasurementValue;
  inputTokenReduction: PairedMeasurementValue;
  baselineCostUsd: PairedMeasurementValue;
  candidateCostUsd: PairedMeasurementValue;
  costReduction: PairedMeasurementValue;
  baselineFirstTokenP50Ms: PairedMeasurementValue;
  candidateFirstTokenP50Ms: PairedMeasurementValue;
  baselineFirstTokenP95Ms: PairedMeasurementValue;
  candidateFirstTokenP95Ms: PairedMeasurementValue;
  baselineWallClockP50Ms: PairedMeasurementValue;
  candidateWallClockP50Ms: PairedMeasurementValue;
  baselineWallClockP95Ms: PairedMeasurementValue;
  candidateWallClockP95Ms: PairedMeasurementValue;
  unmeasuredTokenCells: number;
  unmeasuredLatencyCells: number;
  characterEstimatedCostCells: number;
};

export type PairedNegativeCase = {
  id: string;
  input: string;
  expected: string;
  observed: string;
  result: 'pass' | 'fail';
};

export type PairedEvaluationReport = {
  schema: typeof PAIRED_EVALUATION_SCHEMA;
  generatedAt: string;
  drivenBy: 'agent';
  actor: string;
  workloadHash: string;
  candidateIdentity: typeof PAIRED_CANDIDATE_IDENTITY;
  measurementIdentity: string;
  status: PairedEvaluationStatus;
  samplePairs: number;
  requiredPairs: number;
  liveProviderEvidence: boolean;
  qualityClaimAllowed: boolean;
  /** Which sample the aggregates describe: live runs, or structural agent-derived rows only. */
  metricsBasis: 'live-provider' | 'agent-derived-structural' | 'mixed';
  metrics: PairedEvaluationMetrics;
  targets: PairedWorkloadManifest['metricBudget'];
  blockers: string[];
  unmeasured: string[];
  negativeCases: PairedNegativeCase[];
  decisionInputs: {
    disposition: PairedDisposition;
    promotionCandidateEligible: boolean;
    keepBaseline: boolean;
    productDefaultChanged: false;
    requiresPublisherDecision: string[];
  };
};

/**
 * Frozen-workload digest. `workloadHash` and `frozenAt` describe the freeze
 * rather than its content, so they are excluded and the hash stays byte-stable
 * across re-generation.
 */
export function hashLongSessionPairedWorkload(value: unknown): string {
  return createHash('sha256').update(stableJson(withoutFreezeMetadata(value)), 'utf8').digest('hex');
}

function withoutFreezeMetadata(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const content: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  delete content.workloadHash;
  delete content.frozenAt;
  return content;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const WORKLOAD_TITLES: Record<PairedWorkloadFamily, string> = {
  compression: 'Compress the active task spine without losing a required fact',
  handoff: 'Hand off the current work from accepted facts only',
  fork: 'Continue a forked branch without inheriting a stale generation',
  restart: 'Resume after a process restart from bounded owner references',
  revocation: 'Respect revoked, superseded and out-of-scope facts',
};

function evidenceRef(family: PairedWorkloadFamily, caseId: string): string {
  return `fixture:long-session-d2:${family}:${caseId}`;
}

function fact(text: string, ref: string): CompressionFact {
  return { text, evidenceRefs: [{ type: 'manual', ref }] };
}

function atom(params: {
  id: string;
  type: CompressionSemanticAtom['type'];
  identity: string;
  text: string;
  ref: string;
  status?: CompressionSemanticAtom['status'];
  supersedes?: string[];
  conflicts?: string[];
}): CompressionSemanticAtom {
  return {
    id: params.id,
    type: params.type,
    canonicalIdentity: params.identity,
    severity: 'critical',
    confidence: 1,
    scope: 'workspace',
    polarity: params.status && params.status !== 'verified' ? 'negative' : 'positive',
    status: params.status ?? 'verified',
    text: params.text,
    evidenceRefs: [{ type: 'manual', ref: params.ref }],
    ...(params.supersedes ? { supersedes: params.supersedes } : {}),
    ...(params.conflicts ? { conflicts: params.conflicts } : {}),
  };
}
/**
 * Render the bounded candidate projection exactly the way a model would receive
 * it: accepted fields only, no `unverifiedClaims`, no forbidden atoms.
 */
export function renderLongSessionPairedCandidateInput(artifact: CompressionArtifact): string {
  const lines: string[] = [`objective=${artifact.objective}`, `state=${artifact.currentState}`];
  const groups: Array<readonly [string, readonly CompressionFact[]]> = [
    ['constraint', artifact.constraints],
    ['decision', artifact.decisions],
    ['blocked', artifact.blocked],
    ['inProgress', artifact.inProgress],
    ['done', artifact.done],
    ['file', artifact.filesTouched],
    ['test', artifact.testsRun],
    ['failure', artifact.failedAttempts],
    ['deviation', artifact.deviations],
    ['review', artifact.reviewNeeded],
  ];
  for (const [field, entries] of groups) {
    for (const entry of entries) lines.push(`${field}=${entry.text}`);
  }
  lines.push(`next=${artifact.nextAction}`);
  for (const ref of artifact.evidenceRefs) lines.push(`ref=${ref.type}:${ref.ref}`);
  for (const entry of artifact.semanticAtoms ?? []) {
    if (entry.status !== 'verified') continue;
    lines.push(`atom:${entry.id}=${entry.text}`);
  }
  return lines.join('\n');
}

/**
 * Baseline arm: full transcript replay. This is what continuity has to beat,
 * and the same text is the reference for what must be preserved.
 */
export function renderLongSessionPairedBaselineInput(
  caseValue: Pick<PairedWorkloadCase, 'prompt' | 'baselineTranscript'>,
): string {
  const lines = [`prompt=${caseValue.prompt}`];
  for (const turn of caseValue.baselineTranscript) lines.push(`${turn.role}=${turn.content}`);
  return lines.join('\n');
}

function buildCaseInputText(caseValue: PairedWorkloadCase): string {
  return stableJson({
    id: caseValue.id,
    family: caseValue.family,
    prompt: caseValue.prompt,
    baselineTranscript: caseValue.baselineTranscript,
    mustPreserve: caseValue.mustPreserve,
    forbiddenFacts: caseValue.forbiddenFacts,
    expectedNextAction: caseValue.expectedNextAction,
    forbiddenCompletionClaims: caseValue.forbiddenCompletionClaims,
  });
}

function buildCase(
  index: number,
  family: PairedWorkloadFamily,
  pairIndex: number,
  actor: string,
): PairedWorkloadCase {
  const caseId = `d2-${family}-${String(pairIndex + 1).padStart(2, '0')}`;
  const ref = evidenceRef(family, caseId);
  const step = pairIndex + 1;
  const isRevocation = family === 'revocation';

  const mustPreserve: PairedMustPreserveFact[] = [
    {
      id: `${caseId}-objective`,
      kind: 'goal',
      text: `Objective ${caseId}: keep the bound workspace task recoverable through family=${family}.`,
    },
    {
      id: `${caseId}-constraint`,
      kind: 'constraint',
      text: `Constraint ${caseId}: never leave ${actor} write scope of the bound workspace.`,
    },
    {
      id: `${caseId}-decision`,
      kind: 'decision',
      text: `Decision ${caseId}: reuse the existing ContextOrchestrator and Task Ledger owners.`,
    },
    {
      id: `${caseId}-blocker`,
      kind: 'failed_attempt',
      text: `Failed attempt ${caseId}: the retry loop at step ${step} failed and must not be repeated.`,
    },
    {
      id: `${caseId}-open`,
      kind: 'outcome',
      text: `Open dependency ${caseId}: step ${step} waits for the owner receipt before completion.`,
    },
  ];
  const expectedNextAction = `Next action ${caseId}: run step ${step} against the owning API and read back the receipt.`;

  const pendingFact: PairedForbiddenFact = {
    id: `${caseId}-pending`,
    reason: 'pending-not-accepted',
    text: `Pending proposal ${caseId}: raise the context budget to ${step * 4096}.`,
  };
  const unverifiedFact: PairedForbiddenFact = {
    id: `${caseId}-unverified`,
    reason: 'unverified-claim',
    text: `Unverified narrative ${caseId}: the long-session program is already released.`,
  };
  const forbiddenFacts: PairedForbiddenFact[] = [pendingFact, unverifiedFact];
  const revokedFact: PairedForbiddenFact | undefined = isRevocation
    ? {
        id: `${caseId}-revoked`,
        reason: 'revoked-or-superseded',
        text: `Revoked decision ${caseId}: archive the coordinator session and drop its binding.`,
      }
    : undefined;
  const crossScopeFact: PairedForbiddenFact | undefined = isRevocation
    ? {
        id: `${caseId}-cross-scope`,
        reason: 'out-of-scope',
        text: `Foreign workspace note ${caseId}: reuse the binding of another workspace.`,
      }
    : undefined;
  if (revokedFact) forbiddenFacts.push(revokedFact);
  if (crossScopeFact) forbiddenFacts.push(crossScopeFact);

  const baselineTranscript: PairedWorkloadTranscriptTurn[] = [
    { role: 'user', content: mustPreserve[0]!.text },
    { role: 'assistant', content: mustPreserve[1]!.text },
    { role: 'assistant', content: mustPreserve[2]!.text },
    { role: 'tool', content: mustPreserve[3]!.text },
    { role: 'tool', content: mustPreserve[4]!.text },
    { role: 'assistant', content: pendingFact.text },
    { role: 'assistant', content: unverifiedFact.text },
  ];
  // Revoked / cross-scope facts exist in the baseline history only; the
  // candidate projection must drop them, which the scorer asserts below.
  for (const forbidden of forbiddenFacts) {
    if (forbidden.reason === 'revoked-or-superseded' || forbidden.reason === 'out-of-scope') {
      baselineTranscript.push({ role: 'assistant', content: forbidden.text });
    }
  }
  baselineTranscript.push({ role: 'assistant', content: expectedNextAction });
  baselineTranscript.push({ role: 'user', content: `Continue ${caseId} after ${family}: report status only from receipts.` });

  const artifact: CompressionArtifact = {
    schemaVersion: 1,
    objective: mustPreserve[0]!.text,
    constraints: [fact(mustPreserve[1]!.text, ref)],
    currentState: `Family ${family}, pair ${step}; work still open.`,
    done: [fact(`Accepted evidence for ${caseId} step ${step - 1}`, ref)],
    inProgress: [fact(`Running ${family} continuity for ${caseId}`, ref)],
    blocked: [fact(mustPreserve[4]!.text, ref)],
    decisions: [fact(mustPreserve[2]!.text, ref)],
    filesTouched: [fact(`shared/long-session-paired-evaluation.ts#${caseId}`, ref)],
    testsRun: [fact(`vitest ${caseId}`, ref)],
    failedAttempts: [fact(mustPreserve[3]!.text, ref)],
    deviations: [],
    nextAction: expectedNextAction,
    reviewNeeded: [],
    evidenceRefs: [{ type: 'manual', ref }],
    // Never promoted into the projection.
    unverifiedClaims: [unverifiedFact.text],
    quality: {
      score: 1,
      level: 'high',
      fieldCoverage: 1,
      evidenceCoverage: 1,
      artifactTokens: 0,
      projectionTokens: 0,
      warnings: [],
    },
    semanticAtoms: [
      atom({ id: mustPreserve[1]!.id, type: 'constraint', identity: mustPreserve[1]!.id, text: mustPreserve[1]!.text, ref }),
      atom({ id: mustPreserve[2]!.id, type: 'decision', identity: mustPreserve[2]!.id, text: mustPreserve[2]!.text, ref }),
      atom({ id: mustPreserve[3]!.id, type: 'failed_attempt', identity: mustPreserve[3]!.id, text: mustPreserve[3]!.text, ref }),
      atom({ id: mustPreserve[4]!.id, type: 'outcome', identity: mustPreserve[4]!.id, text: mustPreserve[4]!.text, ref }),
      atom({ id: `${caseId}-next`, type: 'next_action', identity: `${caseId}-next`, text: expectedNextAction, ref }),
      atom({ id: pendingFact.id, type: 'decision', identity: pendingFact.id, text: pendingFact.text, ref, status: 'unverified' }),
      atom({ id: unverifiedFact.id, type: 'outcome', identity: unverifiedFact.id, text: unverifiedFact.text, ref, status: 'stale' }),
      ...(revokedFact
        ? [atom({
            id: revokedFact.id,
            type: 'decision',
            identity: revokedFact.id,
            text: revokedFact.text,
            ref,
            status: 'superseded',
            supersedes: [`${caseId}-decision-old`],
          })]
        : []),
      ...(crossScopeFact
        ? [atom({
            id: crossScopeFact.id,
            type: 'constraint',
            identity: crossScopeFact.id,
            text: crossScopeFact.text,
            ref,
            status: 'superseded',
            conflicts: [mustPreserve[1]!.id],
          })]
        : []),
    ],
  };

  const caseValue: PairedWorkloadCase = {
    id: caseId,
    family,
    title: `${WORKLOAD_TITLES[family]} (pair ${step})`,
    prompt: `Continue ${caseId} using accepted context only; report completion only from receipts.`,
    pairIndex,
    variantIndex: index,
    inputHash: '',
    baselineTranscript,
    mustPreserve,
    forbiddenFacts,
    expectedNextAction,
    forbiddenCompletionClaims: [
      `All work for ${caseId} is finished.`,
      'The whole long-session program is complete.',
    ],
    candidateArtifact: artifact,
  };
  caseValue.inputHash = sha256Text(buildCaseInputText(caseValue));
  return caseValue;
}
export function buildLongSessionPairedWorkload(actor = 'codex-long-session-d2'): PairedWorkloadManifest {
  const cases: PairedWorkloadCase[] = [];
  for (let index = 0; index < PAIRED_TARGET_COUNT; index += 1) {
    const family = PAIRED_WORKLOAD_FAMILIES[index % PAIRED_WORKLOAD_FAMILIES.length];
    const pairIndex = Math.floor(index / PAIRED_WORKLOAD_FAMILIES.length);
    cases.push(buildCase(index, family, pairIndex, actor));
  }
  const families = {} as Record<PairedWorkloadFamily, number>;
  for (const family of PAIRED_WORKLOAD_FAMILIES) {
    families[family] = cases.filter((entry) => entry.family === family).length;
  }

  const workload: PairedWorkloadManifest = {
    schema: PAIRED_WORKLOAD_SCHEMA,
    version: 1,
    frozenAt: PAIRED_FREEZE_EPOCH,
    frozenBeforeMeasurement: true,
    drivenBy: 'agent',
    actor,
    seed: PAIRED_WORKLOAD_SEED,
    workloadCount: cases.length,
    minimumRequired: PAIRED_TARGET_COUNT,
    modelParameters: { model: 'frozen-paired-evaluation-model', temperature: 0, maxOutputTokens: 2048 },
    metricBudget: {
      minimumPairs: PAIRED_TARGET_COUNT,
      fidelityTarget: 1,
      nextActionTarget: 0.95,
      falseCompletionTarget: 0,
      revokedLeakTarget: 0,
      costOrInputTokenReductionTarget: 0.15,
      p95LatencyRatioLimit: 1.1,
    },
    families,
    cases,
    workloadHash: '',
  };
  workload.workloadHash = hashLongSessionPairedWorkload(workload);
  return workload;
}

export type FrozenWorkloadCheck = {
  ok: boolean;
  blockers: string[];
  workloadHash: string;
  recomputedHash: string;
};

export function assertFrozenWorkload(manifest: PairedWorkloadManifest): FrozenWorkloadCheck {
  const blockers: string[] = [];
  const recomputedHash = hashLongSessionPairedWorkload(manifest);
  if (manifest.schema !== PAIRED_WORKLOAD_SCHEMA) blockers.push('workload schema mismatch');
  if (manifest.version !== 1) blockers.push('workload version mismatch');
  if (manifest.frozenBeforeMeasurement !== true) blockers.push('workload was not frozen before measurement');
  if (manifest.drivenBy !== 'agent') blockers.push('workload is not agent-driven');
  if (manifest.seed !== PAIRED_WORKLOAD_SEED) blockers.push('workload seed mismatch');
  if (manifest.workloadCount < PAIRED_TARGET_COUNT) blockers.push('fewer than 30 workload pairs');
  if (manifest.minimumRequired !== PAIRED_TARGET_COUNT) blockers.push('workload minimum budget mismatch');
  if (manifest.cases.length !== manifest.workloadCount) blockers.push('workloadCount does not match cases');
  if (manifest.workloadHash !== recomputedHash) blockers.push('workload hash mismatch after freeze');
  if (manifest.modelParameters.temperature !== 0) blockers.push('model parameters are not deterministic');

  const budget = manifest.metricBudget;
  if (budget.minimumPairs !== PAIRED_TARGET_COUNT) blockers.push('metric budget minimumPairs changed');
  if (budget.fidelityTarget !== 1) blockers.push('metric budget fidelityTarget changed');
  if (budget.nextActionTarget !== 0.95) blockers.push('metric budget nextActionTarget changed');
  if (budget.falseCompletionTarget !== 0) blockers.push('metric budget falseCompletionTarget changed');
  if (budget.revokedLeakTarget !== 0) blockers.push('metric budget revokedLeakTarget changed');
  if (budget.costOrInputTokenReductionTarget !== 0.15) blockers.push('metric budget reduction target changed');
  if (budget.p95LatencyRatioLimit !== 1.1) blockers.push('metric budget p95 ratio changed');

  const seen = new Set<string>();
  for (const family of PAIRED_WORKLOAD_FAMILIES) {
    const count = manifest.families[family];
    if (!Number.isFinite(count)) blockers.push(`missing family count: ${family}`);
    else if (count < 1) blockers.push(`empty family: ${family}`);
  }
  for (const entry of manifest.cases) {
    if (seen.has(entry.id)) blockers.push(`duplicate case id: ${entry.id}`);
    seen.add(entry.id);
    if (!PAIRED_WORKLOAD_FAMILIES.includes(entry.family)) blockers.push(`unknown family: ${entry.id}`);
    if (entry.mustPreserve.length === 0) blockers.push(`case has no must-preserve facts: ${entry.id}`);
    if (entry.forbiddenFacts.length === 0) blockers.push(`case has no forbidden facts: ${entry.id}`);
    if (!entry.expectedNextAction) blockers.push(`case has no expected next action: ${entry.id}`);
    if (entry.forbiddenCompletionClaims.length === 0) blockers.push(`case has no forbidden completion claim: ${entry.id}`);
    if (entry.inputHash !== sha256Text(buildCaseInputText(entry))) blockers.push(`case input hash mismatch: ${entry.id}`);
    const rendered = renderLongSessionPairedCandidateInput(entry.candidateArtifact);
    for (const forbidden of entry.forbiddenFacts) {
      if (rendered.includes(forbidden.text)) {
        blockers.push(`candidate projection leaks ${forbidden.reason}: ${entry.id}`);
      }
    }
  }
  return { ok: blockers.length === 0, blockers, workloadHash: manifest.workloadHash, recomputedHash };
}

type RawArmInput = Omit<
  PairedArmMeasurement,
  'arm' | 'matchedMustPreserve' | 'missedMustPreserve' | 'leakedForbiddenFacts' | 'nextActionCorrect' | 'falseCompletion'
>;

function classifyArmOutput(caseValue: PairedWorkloadCase, arm: 'baseline' | 'candidate', input: RawArmInput): PairedArmMeasurement {
  const text = input.outputText;
  return {
    arm,
    provider: input.provider,
    model: input.model,
    measurementBasis: input.measurementBasis,
    outputText: text,
    matchedMustPreserve: caseValue.mustPreserve.filter((entry) => text.includes(entry.text)).map((entry) => entry.id),
    missedMustPreserve: caseValue.mustPreserve.filter((entry) => !text.includes(entry.text)).map((entry) => entry.id),
    leakedForbiddenFacts: caseValue.forbiddenFacts.filter((entry) => text.includes(entry.text)).map((entry) => entry.id),
    nextActionCorrect: text.includes(caseValue.expectedNextAction),
    falseCompletion: caseValue.forbiddenCompletionClaims.some((claim) => text.includes(claim)),
    costSource: input.costSource,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    totalCostUsd: input.totalCostUsd,
    firstTokenMs: input.firstTokenMs,
    wallClockMs: input.wallClockMs,
  };
}

export type EvaluatePairedCaseInput = {
  caseValue: PairedWorkloadCase;
  runIndex?: number;
  baseline: RawArmInput;
  candidate: RawArmInput;
};

/** Score one frozen pair from the two arms' raw outputs. Pure, no I/O. */
export function evaluateLongSessionPair(params: EvaluatePairedCaseInput): PairedMeasurementRow {
  const { caseValue } = params;
  return {
    caseId: caseValue.id,
    family: caseValue.family,
    runIndex: params.runIndex ?? 0,
    inputHash: caseValue.inputHash,
    baseline: classifyArmOutput(caseValue, 'baseline', params.baseline),
    candidate: classifyArmOutput(caseValue, 'candidate', params.candidate),
  };
}

const UNMEASURED_CELLS = {
  measurementBasis: 'agent-derived' as const,
  costSource: 'unmeasured' as const,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  totalCostUsd: null,
  firstTokenMs: null,
  wallClockMs: null,
};

/**
 * Agent-derived structural pair for one frozen case. It proves the projection
 * boundary only: every token, cost and latency cell stays null, so it can
 * never be read as a quality or savings measurement.
 */
export function deriveLongSessionPairedStructuralRow(
  caseValue: PairedWorkloadCase,
  options: { provider?: string; model?: string; runIndex?: number } = {},
): PairedMeasurementRow {
  const shared = {
    ...UNMEASURED_CELLS,
    provider: options.provider ?? 'synthetic',
    model: options.model ?? 'none',
  };
  return evaluateLongSessionPair({
    caseValue,
    runIndex: options.runIndex ?? 0,
    baseline: { ...shared, outputText: renderLongSessionPairedBaselineInput(caseValue) },
    candidate: { ...shared, outputText: renderLongSessionPairedCandidateInput(caseValue.candidateArtifact) },
  });
}

export function deriveLongSessionPairedStructuralRows(
  manifest: PairedWorkloadManifest,
  options: { provider?: string; model?: string } = {},
): PairedMeasurementRow[] {
  return manifest.cases.map((caseValue) => deriveLongSessionPairedStructuralRow(caseValue, options));
}
function sumMeasured(values: PairedMeasurementValue[]): PairedMeasurementValue {
  const measured = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (measured.length === 0 || measured.length !== values.length) return null;
  return measured.reduce((total, value) => total + value, 0);
}

function percentileMeasured(values: PairedMeasurementValue[], p: number): PairedMeasurementValue {
  const measured = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (measured.length === 0 || measured.length !== values.length) return null;
  const sorted = [...measured].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

function countUnmeasured(values: PairedMeasurementValue[]): number {
  return values.filter((value) => value === null || !Number.isFinite(value)).length;
}

function reduction(baseline: PairedMeasurementValue, candidate: PairedMeasurementValue): PairedMeasurementValue {
  if (baseline === null || candidate === null) return null;
  if (baseline === 0) return 0;
  return (baseline - candidate) / baseline;
}

/** True when the candidate is within `limit` of the baseline; null when unmeasured. */
function ratioOk(candidate: PairedMeasurementValue, baseline: PairedMeasurementValue, limit: number): boolean | null {
  if (candidate === null || baseline === null) return null;
  if (baseline === 0) return candidate === 0;
  return candidate <= baseline * limit;
}

export type SummarizePairedEvaluationInput = {
  manifest: PairedWorkloadManifest;
  rows: PairedMeasurementRow[];
  actor?: string;
  generatedAt?: string;
  /** Negative evidence the caller already produced and read back from disk. */
  negativeCases?: PairedNegativeCase[];
};

export function summarizeLongSessionPairedEvaluation(params: SummarizePairedEvaluationInput): PairedEvaluationReport {
  const { manifest, rows } = params;
  const targets = manifest.metricBudget;
  const frozen = assertFrozenWorkload(manifest);
  const blockers: string[] = [...frozen.blockers];
  const unmeasured: string[] = [];
  const negativeCases: PairedNegativeCase[] = [...(params.negativeCases ?? [])];

  const byCase = new Map(manifest.cases.map((entry) => [entry.id, entry]));
  const unknownRows = rows.filter((row) => !byCase.has(row.caseId));
  const validRows = rows.filter((row) => byCase.has(row.caseId));
  if (unknownRows.length > 0) {
    negativeCases.push({
      id: 'measurement-outside-frozen-workload',
      input: `${unknownRows.length} measurement row(s) reference a case id absent from the frozen manifest`,
      expected: 'rejected from every aggregate metric',
      observed: `excluded ${unknownRows.map((row) => row.caseId).join(', ')}`,
      result: 'pass',
    });
    blockers.push(`${unknownRows.length} measured row(s) outside the frozen workload`);
  }

  if (validRows.length < targets.minimumPairs) {
    blockers.push(`fewer than ${targets.minimumPairs} measured pairs (${validRows.length})`);
  }
  const uniqueIds = new Set(validRows.map((row) => row.caseId));
  if (uniqueIds.size !== validRows.length) blockers.push('duplicate measured pair');
  for (const family of PAIRED_WORKLOAD_FAMILIES) {
    const expected = manifest.families[family] ?? 0;
    const observed = validRows.filter((row) => row.family === family).length;
    if (observed < expected) blockers.push(`family ${family} under-measured (${observed}/${expected})`);
  }

  const inputMismatch = validRows.filter((row) => row.inputHash !== byCase.get(row.caseId)?.inputHash);
  if (inputMismatch.length > 0) blockers.push('an arm ran against a different input than the frozen pair');

  const liveRows = validRows.filter(
    (row) => row.baseline.measurementBasis === 'live-provider' && row.candidate.measurementBasis === 'live-provider',
  );
  const liveProviderEvidence = liveRows.length >= targets.minimumPairs;
  if (liveRows.length > 0 && liveRows.length < targets.minimumPairs) {
    unmeasured.push(`live-provider coverage incomplete (${liveRows.length}/${targets.minimumPairs} pairs)`);
  }

  // Pairing integrity: both arms of one frozen pair must run one identical model.
  const armMismatch = validRows.filter((row) => row.baseline.model !== row.candidate.model);
  if (armMismatch.length > 0) blockers.push('baseline and candidate did not share identical model parameters');
  // Measurement integrity: only live-provider arms must carry the frozen model id.
  const manifestModelMismatch = liveRows.filter(
    (row) => row.baseline.model !== manifest.modelParameters.model || row.candidate.model !== manifest.modelParameters.model,
  );
  if (manifestModelMismatch.length > 0) blockers.push('live-provider arms did not use the frozen model identifier');


  const fidelity = (arm: 'baseline' | 'candidate') =>
    validRows.length === 0
      ? 0
      : validRows.filter((row) => row[arm].missedMustPreserve.length === 0 && row[arm].matchedMustPreserve.length > 0).length /
        validRows.length;

  const baselineInputTokens = sumMeasured(validRows.map((row) => row.baseline.inputTokens));
  const candidateInputTokens = sumMeasured(validRows.map((row) => row.candidate.inputTokens));
  const baselineCostUsd = sumMeasured(validRows.map((row) => row.baseline.totalCostUsd));
  const candidateCostUsd = sumMeasured(validRows.map((row) => row.candidate.totalCostUsd));

  const metrics: PairedEvaluationMetrics = {
    baselineFidelity: fidelity('baseline'),
    candidateFidelity: fidelity('candidate'),
    baselineNextActionAccuracy: validRows.length ? validRows.filter((row) => row.baseline.nextActionCorrect).length / validRows.length : 0,
    candidateNextActionAccuracy: validRows.length ? validRows.filter((row) => row.candidate.nextActionCorrect).length / validRows.length : 0,
    baselineFalseCompletions: validRows.filter((row) => row.baseline.falseCompletion).length,
    candidateFalseCompletions: validRows.filter((row) => row.candidate.falseCompletion).length,
    baselineRevokedLeaks: validRows.reduce((total, row) => total + row.baseline.leakedForbiddenFacts.length, 0),
    candidateRevokedLeaks: validRows.reduce((total, row) => total + row.candidate.leakedForbiddenFacts.length, 0),
    baselineInputTokens,
    candidateInputTokens,
    inputTokenReduction: reduction(baselineInputTokens, candidateInputTokens),
    baselineCostUsd,
    candidateCostUsd,
    costReduction: reduction(baselineCostUsd, candidateCostUsd),
    baselineFirstTokenP50Ms: percentileMeasured(validRows.map((row) => row.baseline.firstTokenMs), 50),
    candidateFirstTokenP50Ms: percentileMeasured(validRows.map((row) => row.candidate.firstTokenMs), 50),
    baselineFirstTokenP95Ms: percentileMeasured(validRows.map((row) => row.baseline.firstTokenMs), 95),
    candidateFirstTokenP95Ms: percentileMeasured(validRows.map((row) => row.candidate.firstTokenMs), 95),
    baselineWallClockP50Ms: percentileMeasured(validRows.map((row) => row.baseline.wallClockMs), 50),
    candidateWallClockP50Ms: percentileMeasured(validRows.map((row) => row.candidate.wallClockMs), 50),
    baselineWallClockP95Ms: percentileMeasured(validRows.map((row) => row.baseline.wallClockMs), 95),
    candidateWallClockP95Ms: percentileMeasured(validRows.map((row) => row.candidate.wallClockMs), 95),
    unmeasuredTokenCells: countUnmeasured(
      validRows.flatMap((row) => [
        row.baseline.inputTokens,
        row.candidate.inputTokens,
        row.baseline.totalCostUsd,
        row.candidate.totalCostUsd,
      ]),
    ),
    unmeasuredLatencyCells: countUnmeasured(
      validRows.flatMap((row) => [
        row.baseline.firstTokenMs,
        row.candidate.firstTokenMs,
        row.baseline.wallClockMs,
        row.candidate.wallClockMs,
      ]),
    ),
    characterEstimatedCostCells: validRows.filter(
      (row) => row.baseline.costSource === 'character-estimate' || row.candidate.costSource === 'character-estimate',
    ).length,
  };

  if (!liveProviderEvidence) {
    blockers.push(
      validRows.length === 0
        ? 'no measurement rows: no live-provider evidence'
        : 'no live-provider evidence: agent-derived or synthetic measurements cannot promote a candidate',
    );
    unmeasured.push('live-provider fidelity, next-action, token/cache/cost and first-token/wall-clock P50/P95');
  }
  if (metrics.characterEstimatedCostCells > 0) {
    blockers.push(
      `${metrics.characterEstimatedCostCells} pair(s) reported a character-estimated cost instead of a provider cost report`,
    );
  }
  if (metrics.candidateFidelity < targets.fidelityTarget) blockers.push('candidate fidelity is below the 100% target');
  if (metrics.candidateNextActionAccuracy < targets.nextActionTarget) {
    blockers.push('candidate next-action accuracy is below 95%');
  }
  if (metrics.candidateFalseCompletions > targets.falseCompletionTarget) {
    blockers.push('candidate contains false task-completion claims');
  }
  if (metrics.candidateRevokedLeaks > targets.revokedLeakTarget) {
    blockers.push('candidate re-injected revoked, pending, unverified or out-of-scope facts');
  }

  const tokenGate = ratioOk(candidateInputTokens, baselineInputTokens, 1 - targets.costOrInputTokenReductionTarget);
  const costGate = ratioOk(candidateCostUsd, baselineCostUsd, 1 - targets.costOrInputTokenReductionTarget);
  if (tokenGate === null || costGate === null) {
    blockers.push('token and cost reduction are unmeasured for the current sample');
    unmeasured.push('cost or input-token net reduction of at least 15%');
  } else if (
    metrics.inputTokenReduction !== null
    && metrics.costReduction !== null
    && metrics.inputTokenReduction < targets.costOrInputTokenReductionTarget
    && metrics.costReduction < targets.costOrInputTokenReductionTarget
  ) {
    blockers.push('candidate does not reduce input tokens or cost by at least 15%');
  }

  const firstTokenRatio = ratioOk(metrics.candidateFirstTokenP95Ms, metrics.baselineFirstTokenP95Ms, targets.p95LatencyRatioLimit);
  const wallRatio = ratioOk(metrics.candidateWallClockP95Ms, metrics.baselineWallClockP95Ms, targets.p95LatencyRatioLimit);
  if (firstTokenRatio === null || wallRatio === null) {
    blockers.push('first-token and wall-clock P95 are unmeasured for the current sample');
    unmeasured.push('first-token and wall-clock P95 within 1.10x of baseline');
  } else {
    if (!firstTokenRatio) blockers.push('candidate first-token P95 exceeds baseline by more than 10%');
    if (!wallRatio) blockers.push('candidate wall-clock P95 exceeds baseline by more than 10%');
  }

  const eligible = blockers.length === 0 && liveProviderEvidence;
  const status: PairedEvaluationStatus = eligible ? 'PASS' : liveProviderEvidence ? 'NO_GO' : 'EVIDENCE_INSUFFICIENT';
  const requiresPublisherDecision: string[] = [];
  if (!eligible) {
    requiresPublisherDecision.push(
      'D3 must record keep-baseline/NO-GO: this evidence does not promote a continuous-compression default.',
    );
    requiresPublisherDecision.push(
      'Any future promotion needs a new authorized live-provider sample set plus a separate product-lock decision.',
    );
  }

  return {
    schema: PAIRED_EVALUATION_SCHEMA,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    drivenBy: 'agent',
    actor: params.actor ?? manifest.actor,
    workloadHash: manifest.workloadHash,
    candidateIdentity: PAIRED_CANDIDATE_IDENTITY,
    measurementIdentity: `${manifest.workloadHash}:${validRows.length}:${validRows.map((row) => row.caseId).join('+')}`,
    status,
    samplePairs: validRows.length,
    requiredPairs: targets.minimumPairs,
    liveProviderEvidence,
    qualityClaimAllowed: eligible,
    metricsBasis: liveProviderEvidence ? 'live-provider' : validRows.length > 0 ? 'agent-derived-structural' : 'mixed',
    metrics,
    targets,
    blockers,
    unmeasured,
    negativeCases,
    decisionInputs: {
      disposition: eligible ? 'promote-candidate-eligible' : 'NO-GO',
      promotionCandidateEligible: eligible,
      keepBaseline: !eligible,
      productDefaultChanged: false,
      requiresPublisherDecision,
    },
  };
}
