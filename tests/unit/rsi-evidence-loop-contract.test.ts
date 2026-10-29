import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MATRIX_PATH = join(ROOT, 'harness/specs/fixtures/rsi-evidence-loop/capability-matrix.v1.json');
const POLICY_PATH = join(ROOT, 'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json');
const DOC_PATH = join(ROOT, 'docs/dev/rsi-capability-and-boundaries.md');
const SPEC_PATH = join(ROOT, 'harness/specs/tasks/rsi-evidence-loop-contract.md');

const EXPECTED_LAYERS = ['experience-loop', 'harness-self-modification', 'code-self-modification'];
const EXPECTED_STAGES = ['capture', 'suggest', 'confirm', 'retrieve', 'adoption'];
const EXPECTED_EVIDENCE_LEVELS = ['source', 'engineering', 'runtime', 'effect'];
const EXPECTED_FAILURE_CLASSES = ['infrastructure', 'task', 'grader', 'agent'];
const EXPECTED_VERDICTS = ['pass', 'partial', 'not-run', 'accepted-shortfall', 'fail', 'invalid'];
const ABSENT_LEVEL_STATUSES = ['absent', 'not-run'];

const REPO_PATH_PATTERN = /(?:^|[\s`(])((?:src|shared|electron|harness|openclaw_runtime|tests|scripts|docs|reports|plans|artifacts|resources)\/[A-Za-z0-9_.@%+~()/\-:]+\.(?:tsx|ts|jsonl|json|mjs|mts|md|yml|yaml|css|html))/g;

type EvidenceLevel = { status: string; paths: string[]; note: string };
type Stage = { id: string; status: string; verdict: string; evidence: Record<string, EvidenceLevel>; limitations: string[] };
type Layer = {
  id: string;
  exists?: boolean;
  stages: Stage[];
  layerVerdict: string;
  defaultState?: Record<string, unknown>;
  automaticWriteBack?: { status: string; statement: string };
};
type CapabilityMatrix = {
  schemaVersion: string;
  driven_by: string;
  actor: string;
  verdictVocabulary: string[];
  evidenceLevels: Record<string, string>;
  layers: Layer[];
  measurementSubstrate: { description: string; items: Array<{ id: string; status: string; paths: string[] }> };
  currentState: { completeRsiImplementation: boolean; statement: string; basis: string[] };
  lockedBoundaries: Record<string, unknown>;
  prerequisites: Record<string, unknown>;
  limitations: string[];
};
type PromotionPolicy = {
  schemaVersion: string;
  driven_by: string;
  actor: string;
  normativeBasis: Array<{ rule: string; path: string }>;
  taskSet: {
    minimumCompleteCases: number;
    k: number;
    insufficientSampleGate: string;
    fixtureGradeDisclosure: { rule: string; knownFixtureGradeFixtures: string[] };
    heldOutSplit: { required: boolean; retuneRule: string };
  };
  graders: { deterministicOraclePrecedence: string; productionGraderStatus: string };
  metrics: {
    primaryMetric: string;
    reportedSeparately: string[];
    mixingProhibited: string;
    confidenceInterval: { level: number; method: string; decisionRule: string };
    minimumDetectableEffect: { passK: string; mdeComputationStatus: string };
  };
  budgets: {
    perCompletedCase: Record<string, unknown>;
    costCeiling: { maxRelativeIncrease: number; appliesTo: string[] };
  };
  failureClasses: { separated: string[]; rule: string; incompleteTrialPreservation: string };
  promotion: {
    preconditions: string[];
    thresholds: {
      passKAbsoluteImprovement: { minimum: number };
      confidenceInterval: { requirement: string };
      costIncrease: { maximum: number };
      negativeControls: { requirement: string };
      safetyCases: { requirement: string };
    };
    decisionStates: string[];
  };
  elimination: { disqualifiers: string[]; residualHandling: string };
  rollback: {
    defaultOff: boolean;
    singleFlagRollback: string;
    rollbackEvidence: string;
    noReverseMigration: string;
  };
  forbiddenMutations: { pathsAndSurfaces: string[]; rule: string };
  evidenceLabelling: { drivenBy: string; actorRequired: boolean; realHumanClaimProhibited: boolean; rule: string };
  currentState: { completeRsiImplementation: boolean; gateStatus: Record<string, string> };
  prerequisites: Record<string, unknown>;
  limitations: string[];
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Every repository path a frozen fixture cites must exist on disk. A citation
 * that resolves to nothing is an unverifiable claim, and this is the only thing
 * in the change set that can catch one automatically. */
function citedRepoPaths(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(REPO_PATH_PATTERN)) found.add(match[1]);
  } else if (Array.isArray(value)) {
    for (const entry of value) citedRepoPaths(entry, found);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) citedRepoPaths(entry, found);
  }
  return found;
}

describe('RSI evidence loop contract', () => {
  it('separates the three capability layers and refuses to claim the two that do not exist', () => {
    const matrix = readJson<CapabilityMatrix>(MATRIX_PATH);

    expect(matrix.schemaVersion).toBe('RsiCapabilityMatrix/v1');
    expect(matrix.driven_by).toBe('agent');
    expect(matrix.actor.trim().length).toBeGreaterThan(0);
    expect(matrix.actor).not.toMatch(/human/iu);
    expect(matrix.layers.map((layer) => layer.id)).toEqual(EXPECTED_LAYERS);
    expect(new Set(matrix.layers.map((layer) => layer.id)).size).toBe(matrix.layers.length);
    for (const level of EXPECTED_EVIDENCE_LEVELS) {
      expect(matrix.evidenceLevels[level], `evidence level ${level}`).toBeTruthy();
    }
    expect(matrix.verdictVocabulary).toEqual(EXPECTED_VERDICTS);

    const [experience, harnessSelfModification, codeSelfModification] = matrix.layers;

    // Layer 1: present, default off, no automatic write-back.
    expect(experience.stages.map((stage) => stage.id)).toEqual(EXPECTED_STAGES);
    expect(experience.defaultState?.default).toBe('off');
    expect(experience.automaticWriteBack?.status).toBe('absent');
    expect(experience.automaticWriteBack?.statement.trim().length).toBeGreaterThan(0);

    // Layers 2 and 3: must not be claimed at any level.
    for (const layer of [harnessSelfModification, codeSelfModification]) {
      expect(layer.exists).toBe(false);
      expect(layer.layerVerdict).toBe('not-run');
      expect(layer.stages.length).toBeGreaterThan(0);
      for (const stage of layer.stages) {
        expect(stage.verdict, `${layer.id}/${stage.id} verdict`).toBe('not-run');
        for (const level of EXPECTED_EVIDENCE_LEVELS) {
          expect(ABSENT_LEVEL_STATUSES, `${layer.id}/${stage.id}/${level}`).toContain(stage.evidence[level]?.status);
        }
      }
    }

    // Every stage in every layer carries all four levels and a declared verdict.
    for (const layer of matrix.layers) {
      for (const stage of layer.stages) {
        expect(EXPECTED_VERDICTS, `${layer.id}/${stage.id}`).toContain(stage.verdict);
        for (const level of EXPECTED_EVIDENCE_LEVELS) {
          const entry = stage.evidence[level];
          expect(entry, `${layer.id}/${stage.id}/${level}`).toBeTruthy();
          expect(entry.status.trim().length, `${layer.id}/${stage.id}/${level} status`).toBeGreaterThan(0);
          expect(Array.isArray(entry.paths)).toBe(true);
          expect(entry.note.trim().length, `${layer.id}/${stage.id}/${level} note`).toBeGreaterThan(0);
          // An observed level must cite where it was observed.
          if (!ABSENT_LEVEL_STATUSES.includes(entry.status)) {
            expect(entry.paths.length, `${layer.id}/${stage.id}/${level} needs paths`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('records the unwired adoption stage and the default-off boundary as observations, not omissions', () => {
    const matrix = readJson<CapabilityMatrix>(MATRIX_PATH);
    const experience = matrix.layers.find((layer) => layer.id === 'experience-loop');
    const adoption = experience?.stages.find((stage) => stage.id === 'adoption');

    expect(adoption?.status).toBe('typed-surface-only');
    expect(adoption?.verdict).toBe('not-run');
    expect(adoption?.evidence.runtime.status).toBe('absent');
    expect(adoption?.evidence.runtime.note).toMatch(/no production caller/iu);

    // The instruments are listed apart from the capability layers: a code path
    // that can measure an improvement is not an improvement.
    expect(matrix.measurementSubstrate.description.trim().length).toBeGreaterThan(0);
    expect(matrix.measurementSubstrate.items.length).toBeGreaterThanOrEqual(5);
    const substrateIds = matrix.measurementSubstrate.items.map((item) => item.id);
    expect(substrateIds).toContain('baseline-aggregation-run');
    expect(matrix.measurementSubstrate.items.find((item) => item.id === 'baseline-aggregation-run')?.status).toBe('not-run');
    expect(matrix.measurementSubstrate.items.find((item) => item.id === 'production-grader')?.status).toBe('absent');
    // An instrument marked not-run or absent may not cite paths or claim a level.
    for (const layer of matrix.layers) {
      expect(substrateIds).not.toContain(layer.id);
    }
  });

  it('states the no-complete-RSI fact with its basis', () => {
    const matrix = readJson<CapabilityMatrix>(MATRIX_PATH);
    const doc = readFileSync(DOC_PATH, 'utf8');

    expect(matrix.currentState.completeRsiImplementation).toBe(false);
    expect(matrix.currentState.statement).toMatch(/no complete recursive-self-improvement/iu);
    expect(matrix.currentState.basis.length).toBeGreaterThan(0);
    for (const path of matrix.currentState.basis) {
      expect(existsSync(join(ROOT, path)), `basis path ${path}`).toBe(true);
    }

    expect(doc).toMatch(/no complete RSI implementation/iu);
    expect(doc).toContain('harness/specs/fixtures/rsi-evidence-loop/capability-matrix.v1.json');
    expect(doc).toContain('harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json');
    expect(doc).toContain('runtime-feature-leaves.ts');

    // Publication and product state stay untouched by a capability record.
    expect(matrix.lockedBoundaries).toMatchObject({
      humanAcceptanceRequired: false,
      humanEvidenceClaimed: false,
      drivenBy: 'agent',
      releaseApproved: false,
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      capabilityClaimed: false,
    });
  });

  it('freezes a baseline protocol that a candidate cannot satisfy with a thin or silent sample', () => {
    const policy = readJson<PromotionPolicy>(POLICY_PATH);

    expect(policy.schemaVersion).toBe('RsiPromotionPolicy/v1');
    expect(policy.driven_by).toBe('agent');
    expect(policy.actor).not.toMatch(/human/iu);
    expect(policy.normativeBasis.length).toBeGreaterThanOrEqual(5);
    for (const basis of policy.normativeBasis) {
      expect(existsSync(join(ROOT, basis.path)), `basis ${basis.path}`).toBe(true);
    }

    expect(policy.taskSet.minimumCompleteCases).toBeGreaterThanOrEqual(20);
    expect(policy.taskSet.k).toBeGreaterThanOrEqual(3);
    expect(policy.taskSet.insufficientSampleGate).toBe('insufficient-sample');
    // A five-case fixture must be disclosed as fixture-grade, never as benefit.
    expect(policy.taskSet.fixtureGradeDisclosure.rule).toMatch(/five-case|5.case/iu);
    expect(policy.taskSet.fixtureGradeDisclosure.knownFixtureGradeFixtures.length).toBeGreaterThan(0);
    expect(policy.taskSet.heldOutSplit.required).toBe(true);
    expect(policy.taskSet.heldOutSplit.retuneRule).toMatch(/must not be retuned/iu);

    expect(policy.graders.deterministicOraclePrecedence.trim().length).toBeGreaterThan(0);
    expect(policy.graders.productionGraderStatus).toBe('not-run');

    expect(policy.metrics.primaryMetric).toMatch(/pass\^k/u);
    expect(policy.metrics.reportedSeparately.join(' ')).toMatch(/pass\^k/u);
    expect(policy.metrics.reportedSeparately.join(' ')).toMatch(/pass@k/u);
    expect(policy.metrics.mixingProhibited.trim().length).toBeGreaterThan(0);
    expect(policy.metrics.confidenceInterval.level).toBe(0.95);
    expect(policy.metrics.confidenceInterval.decisionRule).toMatch(/exclude zero/iu);
    expect(policy.metrics.minimumDetectableEffect.passK.trim().length).toBeGreaterThan(0);
    // The floor is a design constant and says so; it is not a computed output.
    expect(policy.metrics.minimumDetectableEffect.mdeComputationStatus).toBe('design-fixed');

    expect(Object.keys(policy.budgets.perCompletedCase)).toEqual(
      expect.arrayContaining(['tokens', 'turns', 'toolCalls', 'wallClockCeilingMs', 'retries']),
    );
    expect(policy.budgets.costCeiling.maxRelativeIncrease).toBeLessThanOrEqual(0.1);

    expect(policy.failureClasses.separated).toEqual(EXPECTED_FAILURE_CLASSES);
    expect(policy.failureClasses.rule.trim().length).toBeGreaterThan(0);
    // A timeout, skip or failure must be preserved, never silently dropped.
    expect(policy.failureClasses.incompleteTrialPreservation).toMatch(/silently dropping/iu);
  });

  it('freezes promotion thresholds, elimination rules and a single-flag rollback with no reverse migration', () => {
    const policy = readJson<PromotionPolicy>(POLICY_PATH);
    const thresholds = policy.promotion.thresholds;

    expect(thresholds.passKAbsoluteImprovement.minimum).toBeGreaterThanOrEqual(0.05);
    expect(thresholds.confidenceInterval.requirement).toMatch(/lower bound/iu);
    expect(thresholds.confidenceInterval.requirement).toMatch(/greater than zero/iu);
    expect(thresholds.costIncrease.maximum).toBeLessThanOrEqual(0.1);
    expect(thresholds.negativeControls.requirement).toMatch(/zero regression/iu);
    expect(thresholds.safetyCases.requirement).toMatch(/zero regression/iu);
    expect(policy.promotion.preconditions.length).toBeGreaterThan(0);
    expect(policy.promotion.decisionStates).toEqual(
      expect.arrayContaining(['promote', 'hold', 'eliminate', 'insufficient-evidence']),
    );

    expect(policy.elimination.disqualifiers.length).toBeGreaterThanOrEqual(6);
    expect(policy.elimination.disqualifiers.join(' ')).toMatch(/thresholds were changed after the run/iu);
    expect(policy.elimination.residualHandling.trim().length).toBeGreaterThan(0);

    expect(policy.rollback.defaultOff).toBe(true);
    expect(policy.rollback.singleFlagRollback).toMatch(/exactly one configuration flag/iu);
    expect(policy.rollback.rollbackEvidence).toMatch(/off state is exercised/iu);
    expect(policy.rollback.noReverseMigration).toMatch(/disqualifier/iu);
  });

  it('denies a candidate authority over its own success criteria and keeps evidence agent-labelled', () => {
    const policy = readJson<PromotionPolicy>(POLICY_PATH);
    const surfaces = policy.forbiddenMutations.pathsAndSurfaces.join(' | ').toLowerCase();

    for (const required of [
      'evaluator',
      'held-out',
      'evidence generator',
      'permission',
      'product lock',
      'default value',
      'task set',
      'promotion policy',
    ]) {
      expect(surfaces, `forbidden surface: ${required}`).toContain(required);
    }
    expect(policy.forbiddenMutations.rule.trim().length).toBeGreaterThan(0);

    expect(policy.evidenceLabelling.drivenBy).toBe('agent');
    expect(policy.evidenceLabelling.actorRequired).toBe(true);
    expect(policy.evidenceLabelling.realHumanClaimProhibited).toBe(true);
    expect(policy.evidenceLabelling.rule.trim().length).toBeGreaterThan(0);

    expect(policy.currentState.completeRsiImplementation).toBe(false);
    expect(policy.currentState.gateStatus.baselineAggregationRun).toBe('not-run');
  });

  it('blocks later RSI stages behind their stated prerequisites and cites only paths that exist', () => {
    const matrix = readJson<CapabilityMatrix>(MATRIX_PATH);
    const policy = readJson<PromotionPolicy>(POLICY_PATH);
    const spec = readFileSync(SPEC_PATH, 'utf8');

    for (const prerequisites of [matrix.prerequisites, policy.prerequisites]) {
      expect(prerequisites['TF-0604']).toEqual(['TF-0590', 'TF-0592']);
      expect(prerequisites['TF-0605']).toEqual(['stage 1 (TF-0599)']);
      expect(prerequisites['TF-0606']).toEqual(['stage 1 (TF-0599)']);
      expect(prerequisites['TF-0609']).toEqual(['stage 3 (TF-0601)']);
      expect(String(prerequisites.rule).trim().length).toBeGreaterThan(0);
    }

    expect(spec).toContain('lifecycleStatus: active');
    for (const node of ['TF-0604', 'TF-0605', 'TF-0606', 'TF-0609', 'TF-0610']) {
      expect(spec, `spec must name ${node}`).toContain(node);
    }

    // Traceability, checked rather than asserted: every repository path either
    // fixture cites must resolve.
    const cited = new Set([...citedRepoPaths(matrix), ...citedRepoPaths(policy)]);
    expect(cited.size).toBeGreaterThanOrEqual(30);
    const missing = [...cited].filter((path) => !existsSync(join(ROOT, path))).sort();
    expect(missing).toEqual([]);

    expect(matrix.limitations.length).toBeGreaterThan(0);
    expect(policy.limitations.length).toBeGreaterThan(0);
  });
});
