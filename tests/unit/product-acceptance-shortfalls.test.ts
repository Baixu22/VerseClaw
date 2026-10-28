import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const LEDGER = join(ROOT, 'harness/specs/fixtures/product-acceptance-shortfalls/ledger.json');
const GUIDE = join(ROOT, 'harness/specs/guides/product-acceptance-strategy.md');
const RESEARCH = join(ROOT, 'harness/specs/fixtures/product-acceptance-research/sources.json');
const RESEARCH_REPORT = join(ROOT, 'harness/specs/fixtures/product-acceptance-research/research-report.json');
const CLOSEOUT = join(ROOT, 'harness/specs/tasks/product-acceptance-closeout.md');

const EXPECTED_SHORTFALL_IDS = [
  'runtime-memory-retired-test-contract',
  'coding-loop-e2e-final-response',
  'e2e-skill-source-mutation',
  'agent-acceptance-harness-unconfigured-test-dirs',
  'qa-lab-scenario-pack-not-present',
] as const;
const EXPECTED_TASK_IDS = [
  'TF-0573',
  'TF-0574',
  'TF-0575',
  'TF-0576',
  'TF-0577',
  'TF-0578',
  'TF-0580',
  'TF-0581',
  'TF-0582',
  'TF-0584',
  'TF-0585',
  'TF-0579',
  'TF-0583',
] as const;
const STATUSES = ['open', 'in-progress', 'resolved'] as const;
const DISPOSITIONS = ['must-resolve-before-ga', 'accepted-shortfall'] as const;
const LEVELS = ['source', 'automated', 'runtime', 'effect', 'packaged', 'operational', 'release-approved'] as const;

type Status = (typeof STATUSES)[number];
type Disposition = (typeof DISPOSITIONS)[number];
type Level = (typeof LEVELS)[number];

type CandidateBinding = {
  commit: string;
  tree: string;
  dirty: boolean;
};

type ResolvedEvidence = {
  candidate: CandidateBinding;
  sourceRef: string;
  command: string;
  exitCode: number;
  counts: string;
  artifactSha256: string;
  artifactPath: string;
  negativeControl: string;
};

type Shortfall = {
  id: string;
  level: Level;
  dimension: string;
  gap: string;
  evidence: string[];
  impact: string;
  owner: string;
  reportedAt: string;
  reviewBy: string;
  status: Status;
  shortfallClass: string;
  acceptanceDisposition: Disposition;
  risk: 'low' | 'medium' | 'high' | 'critical';
  dataAtRisk: boolean;
  userVisible: boolean;
  rootCauseClass: string;
  blastRadius: string;
  repairCost: 'small' | 'medium' | 'large';
  pathToGa: string;
  observed: string;
  resolution?: ResolvedEvidence;
  acceptedResidual?: {
    owner: string;
    reviewBy: string;
    impact: string;
    reproduction: string;
    rollback: string;
    monitoring: string;
  };
};

type Ledger = {
  schemaVersion: string;
  driven_by: string;
  actor: string;
  boundaries: Record<string, unknown>;
  vocabulary: { levels: string[]; status: string[]; dimensions: string[] };
  shortfalls: Shortfall[];
  acceptancePolicy: {
    resolutionOrder: string[];
    blockedByAnyOf: string[];
    acceptedShortfallEligibility: string[];
    agentEvidenceRule: {
      drivenBy: string;
      realHumanEvidence: boolean;
      deterministicOracleRequired: boolean;
      evaluatorMayOnlyReturn: string[];
    };
  };
  summary: {
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    blocking: string[];
    accepted: string[];
    byDisposition: Partial<Record<Disposition, number>>;
    residualLimits: string[];
  };
};

type Issue = { code: string; message: string; shortfallId?: string };

function isNonEmpty(value: unknown, minimum = 1): value is string {
  return typeof value === 'string' && value.trim().length >= minimum;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isCandidateBinding(value: unknown): value is CandidateBinding {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CandidateBinding>;
  return (
    typeof candidate.commit === 'string' &&
    /^[a-f0-9]{7,40}$/i.test(candidate.commit) &&
    typeof candidate.tree === 'string' &&
    /^[a-f0-9]{7,40}$/i.test(candidate.tree) &&
    typeof candidate.dirty === 'boolean'
  );
}

/**
 * Stable verifier for the shortfall ledger.
 *
 * It intentionally does not snapshot the number of open rows: a fix must be able to
 * move a row forward after current-candidate evidence exists. What it does reject is
 * any summary drift, evidence-free resolution, a P1 accepted as a residual, or a
 * marker that turns a shortfall into a release/GA pass.
 */
function verifyLedger(ledger: Ledger): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, message: string, shortfall?: Shortfall) =>
    issues.push({ code, message, shortfallId: shortfall?.id });

  if (ledger.schemaVersion !== 'ProductAcceptanceShortfallLedger/v1') {
    add('schema-version', 'Unexpected shortfall ledger schema version.');
  }
  if (ledger.driven_by !== 'agent') {
    add('evidence-actor', 'The ledger must be agent-driven; real-human evidence is not claimed.');
  }
  if (ledger.boundaries.productApproved !== false) add('product-lock', 'productApproved must remain false.');
  if (ledger.boundaries.releaseApproved !== false) add('release-lock', 'releaseApproved must remain false.');
  if (ledger.boundaries.realHumanEvidence !== false) {
    add('human-claim', 'realHumanEvidence must remain false.');
  }

  for (const level of LEVELS) {
    if (!ledger.vocabulary.levels.includes(level)) add('vocabulary-level', `Missing level vocabulary: ${level}`);
  }
  for (const status of STATUSES) {
    if (!ledger.vocabulary.status.includes(status)) add('vocabulary-status', `Missing status vocabulary: ${status}`);
  }

  const actualIds = ledger.shortfalls.map((item) => item.id);
  if (new Set(actualIds).size !== actualIds.length) add('duplicate-shortfall', 'Shortfall IDs must be unique.');
  for (const expectedId of EXPECTED_SHORTFALL_IDS) {
    if (!actualIds.includes(expectedId)) add('missing-shortfall', `Required shortfall ${expectedId} is missing.`);
  }
  for (const actualId of actualIds) {
    if (!EXPECTED_SHORTFALL_IDS.includes(actualId as (typeof EXPECTED_SHORTFALL_IDS)[number])) {
      add('unknown-shortfall', `Unexpected shortfall ${actualId} is not part of the frozen baseline.`);
    }
  }

  for (const item of ledger.shortfalls) {
    if (!ledger.vocabulary.status.includes(item.status)) add('invalid-status', `Invalid status: ${item.status}`, item);
    if (!ledger.vocabulary.dimensions.includes(item.dimension)) {
      add('invalid-dimension', `Invalid dimension: ${item.dimension}`, item);
    }
    if (!ledger.vocabulary.levels.includes(item.level)) add('invalid-level', `Invalid level: ${item.level}`, item);
    if (item.level === 'release-approved') add('release-level', 'A shortfall cannot be release-approved.', item);
    if (item.level === 'packaged' && item.status !== 'resolved') {
      add('packaged-unresolved', 'An unresolved gap cannot claim packaged level.', item);
    }
    if (!isNonEmpty(item.gap, 20)) add('gap', 'Gap description is too short.', item);
    if (!isNonEmpty(item.impact, 20)) add('impact', 'Impact description is too short.', item);
    if (!/^agent:/.test(item.owner)) add('owner', 'Owner must be an agent owner.', item);
    if (!isDate(item.reportedAt)) add('reported-date', 'reportedAt must be an ISO date.', item);
    if (!isDate(item.reviewBy)) add('review-date', 'reviewBy must be an ISO date.', item);
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
      add('evidence', 'A shortfall needs source evidence.', item);
    }
    if (!isNonEmpty(item.observed, 20)) add('observed', 'Observed result is too short.', item);
    if (!isNonEmpty(item.rootCauseClass, 2)) add('root-cause', 'rootCauseClass is missing.', item);
    if (!isNonEmpty(item.blastRadius, 20)) add('blast-radius', 'blastRadius is too short.', item);
    if (!['small', 'medium', 'large'].includes(item.repairCost)) add('repair-cost', 'Invalid repairCost.', item);
    if (!isNonEmpty(item.pathToGa, 20)) add('path-to-ga', 'pathToGa is too short.', item);
    if (!['low', 'medium', 'high', 'critical'].includes(item.risk)) add('risk', 'Invalid risk.', item);
    if (typeof item.dataAtRisk !== 'boolean') add('data-at-risk', 'dataAtRisk must be boolean.', item);
    if (typeof item.userVisible !== 'boolean') add('user-visible', 'userVisible must be boolean.', item);
    if (!DISPOSITIONS.includes(item.acceptanceDisposition)) {
      add('disposition', `Invalid acceptance disposition: ${item.acceptanceDisposition}`, item);
    }

    const textFields = [item.gap, item.impact, item.observed, item.pathToGa];
    const passClaim =
      textFields.some((value) => /^\s*(?:pass|passed|passing|green)\s*$/i.test(value)) ||
      textFields.some((value) => /\b(?:shortfall|gap)\b.{0,30}\b(?:pass|passed|passing|green)\b/i.test(value)) ||
      textFields.some((value) => /\bGA\b.{0,20}\b(?:pass|passed|green)\b/i.test(value));
    if (passClaim) {
      add('pass-claim', 'A shortfall record must not be described as pass/green.', item);
    }

    if (item.status === 'resolved') {
      const proof = item.resolution;
      if (!proof) {
        add('resolution-evidence', 'resolved requires a candidate-bound resolution object.', item);
      } else {
        if (!isCandidateBinding(proof.candidate)) add('resolution-candidate', 'Invalid resolution candidate binding.', item);
        if (proof.candidate.dirty) add('resolution-dirty', 'Resolved evidence must come from a clean candidate.', item);
        if (!isNonEmpty(proof.sourceRef, 3)) add('resolution-source', 'Resolution needs a source reference.', item);
        if (!isNonEmpty(proof.command, 3)) add('resolution-command', 'Resolution needs a reproducible command.', item);
        if (proof.exitCode !== 0) add('resolution-exit', 'Resolution command must exit zero.', item);
        if (!isNonEmpty(proof.counts, 2)) add('resolution-counts', 'Resolution needs parsed counts.', item);
        if (!isSha256(proof.artifactSha256)) add('resolution-hash', 'Resolution needs a SHA256 artifact.', item);
        if (!isNonEmpty(proof.artifactPath, 3)) add('resolution-path', 'Resolution needs an artifact path.', item);
        if (!isNonEmpty(proof.negativeControl, 3)) {
          add('resolution-negative', 'Resolution needs a negative control.', item);
        }
      }
      if (item.acceptanceDisposition === 'accepted-shortfall') {
        add('resolved-accepted', 'A resolved shortfall cannot also be an accepted residual.', item);
      }
    } else if (item.status === 'in-progress') {
      if (item.acceptanceDisposition === 'accepted-shortfall') {
        add('in-progress-accepted', 'An in-progress shortfall cannot be accepted as residual.', item);
      }
    }

    if (item.acceptanceDisposition === 'accepted-shortfall') {
      if (item.risk === 'high' || item.risk === 'critical') {
        add('accepted-p1', 'High/critical/P1 defects cannot be accepted as residual.', item);
      }
      if (item.status !== 'open') add('accepted-status', 'Accepted residual must remain explicitly open.', item);
      const residual = item.acceptedResidual;
      if (!residual) {
        add('accepted-evidence', 'Accepted residual needs a complete residual record.', item);
      } else {
        if (!/^agent:/.test(residual.owner)) add('accepted-owner', 'Accepted residual needs an agent owner.', item);
        if (!isDate(residual.reviewBy)) add('accepted-date', 'Accepted residual needs a review date.', item);
        for (const [name, value] of Object.entries({
          impact: residual.impact,
          reproduction: residual.reproduction,
          rollback: residual.rollback,
          monitoring: residual.monitoring,
        })) {
          if (!isNonEmpty(value, 10)) add('accepted-field', `Accepted residual ${name} is missing.`, item);
        }
      }
    }
  }

  const expectedOpen = ledger.shortfalls.filter((item) => item.status === 'open').length;
  const expectedInProgress = ledger.shortfalls.filter((item) => item.status === 'in-progress').length;
  const expectedResolved = ledger.shortfalls.filter((item) => item.status === 'resolved').length;
  const expectedBlocking = ledger.shortfalls
    .filter((item) => item.acceptanceDisposition === 'must-resolve-before-ga' && item.status !== 'resolved')
    .map((item) => item.id);
  const expectedAccepted = ledger.shortfalls
    .filter((item) => item.acceptanceDisposition === 'accepted-shortfall')
    .map((item) => item.id);
  const expectedByDisposition = {
    'must-resolve-before-ga': ledger.shortfalls.filter((item) => item.acceptanceDisposition === 'must-resolve-before-ga').length,
    'accepted-shortfall': ledger.shortfalls.filter((item) => item.acceptanceDisposition === 'accepted-shortfall').length,
  };
  const summary = ledger.summary;

  if (summary.total !== ledger.shortfalls.length) add('summary-total', 'summary.total does not match shortfalls.');
  if (summary.open !== expectedOpen) add('summary-open', 'summary.open does not match shortfall statuses.');
  if (summary.inProgress !== expectedInProgress) {
    add('summary-in-progress', 'summary.inProgress does not match shortfall statuses.');
  }
  if (summary.resolved !== expectedResolved) add('summary-resolved', 'summary.resolved does not match shortfall statuses.');
  if (!Array.isArray(summary.blocking) || summary.blocking.slice().sort().join(',') !== expectedBlocking.sort().join(',')) {
    add('summary-blocking', 'summary.blocking must derive from unresolved must-resolve rows.');
  }
  if (!Array.isArray(summary.accepted) || summary.accepted.slice().sort().join(',') !== expectedAccepted.sort().join(',')) {
    add('summary-accepted', 'summary.accepted must derive from accepted-shortfall rows.');
  }
  for (const disposition of DISPOSITIONS) {
    if ((summary.byDisposition[disposition] ?? 0) !== expectedByDisposition[disposition]) {
      add('summary-disposition', `summary.byDisposition.${disposition} does not match rows.`);
    }
  }
  if (summary.blocking.some((id) => ledger.shortfalls.find((item) => item.id === id)?.status === 'resolved')) {
    add('summary-resolved-blocking', 'A resolved row cannot remain in summary.blocking.');
  }
  if (summary.accepted.some((id) => ledger.shortfalls.find((item) => item.id === id)?.acceptanceDisposition !== 'accepted-shortfall')) {
    add('summary-accepted-mismatch', 'summary.accepted contains a non-accepted row.');
  }
  if (!Array.isArray(summary.residualLimits) || !summary.residualLimits.some((limit) => limit.includes('No real-provider or real-human evidence is claimed'))) {
    add('residual-limit', 'Residual limits must state provider/human evidence boundaries.');
  }

  const policy = ledger.acceptancePolicy;
  if (policy.resolutionOrder[0] !== 'fix-the-product-or-test-contract') {
    add('policy-order', 'Product fix must be the first resolution option.');
  }
  for (const blocker of ['unexpected-test-failure', 'current-candidate-critical-journey-not-effect-proven', 'unbounded-worktree-or-user-data-mutation']) {
    if (!policy.blockedByAnyOf.includes(blocker)) add('policy-blocker', `Missing blocking condition ${blocker}.`);
  }
  for (const criterion of [
    'impact-blast-radius-and-user-visible-consequence-recorded',
    'reproduction-evidence-and-failing-oracle-recorded',
    'rollback-or-kill-switch-recorded',
    'residual-risk-accepted-with-agent-owner-and-review-date',
    'release-monitoring-and-quarantine-rule-recorded',
  ]) {
    if (!policy.acceptedShortfallEligibility.includes(criterion)) add('policy-accepted', `Missing criterion ${criterion}.`);
  }
  if (
    policy.agentEvidenceRule.drivenBy !== 'agent' ||
    policy.agentEvidenceRule.realHumanEvidence !== false ||
    policy.agentEvidenceRule.deterministicOracleRequired !== true ||
    policy.agentEvidenceRule.evaluatorMayOnlyReturn.join(',') !== 'pass,fail,unverified'
  ) {
    add('policy-evidence', 'Agent evidence policy is inconsistent.');
  }

  return issues;
}

function cloneLedger(): Ledger {
  return JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger;
}

function firstOpenShortfall(
  ledger: Ledger,
  predicate: (item: Shortfall) => boolean = () => true,
): Shortfall {
  const item = ledger.shortfalls.find((entry) => entry.status === 'open' && predicate(entry))
    ?? ledger.shortfalls.find(predicate);
  if (!item) throw new Error('Expected a shortfall fixture.');
  // These negative controls operate on cloned ledgers. Construct their open row
  // independently of whether the current product backlog has already closed.
  if (item.status !== 'open') {
    ledger.summary[item.status === 'resolved' ? 'resolved' : 'inProgress'] -= 1;
    ledger.summary.open += 1;
    item.status = 'open';
    delete item.resolution;
    if (item.acceptanceDisposition === 'must-resolve-before-ga' && !ledger.summary.blocking.includes(item.id)) {
      ledger.summary.blocking.push(item.id);
    }
  }
  return item;
}

function repairedCandidate(commit = '082836ef4ae37b4d9e24bf35aa99b7a610e5f6a0'): CandidateBinding {
  return { commit, tree: 'a'.repeat(40), dirty: false };
}

function markResolved(ledger: Ledger, id: string): Shortfall {
  const item = ledger.shortfalls.find((entry) => entry.id === id)!;
  item.status = 'resolved';
  item.resolution = {
    candidate: repairedCandidate(),
    sourceRef: 'commit:fixture',
    command: 'pnpm exec vitest run tests/unit/fixture.test.ts --maxWorkers=1',
    exitCode: 0,
    counts: 'Tests 1 passed (1)',
    artifactSha256: 'b'.repeat(64),
    artifactPath: 'D:/tmp/fixture/result.json',
    negativeControl: 'fixture-negative: pass',
  };
  return item;
}

describe('product acceptance shortfall ledger', () => {
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger;

  it('keeps the current baseline complete while allowing an evidence-backed transition', () => {
    expect(verifyLedger(ledger)).toEqual([]);
    expect(ledger.schemaVersion).toBe('ProductAcceptanceShortfallLedger/v1');
    expect(ledger.driven_by).toBe('agent');
    expect(ledger.boundaries).toMatchObject({
      productApproved: false,
      releaseApproved: false,
      realHumanEvidence: false,
    });
    expect(ledger.shortfalls).toHaveLength(5);
    expect(ledger.shortfalls.map((item) => item.id)).toEqual(EXPECTED_SHORTFALL_IDS);
    expect(ledger.summary.total).toBe(5);
    expect(ledger.summary.open + ledger.summary.inProgress + ledger.summary.resolved).toBe(5);
  });

  it('keeps every shortfall traceable and reviewable', () => {
    for (const item of ledger.shortfalls) {
      expect(ledger.vocabulary.levels).toContain(item.level);
      expect(ledger.vocabulary.status).toContain(item.status);
      expect(ledger.vocabulary.dimensions).toContain(item.dimension);
      expect(item.gap.trim().length).toBeGreaterThan(20);
      expect(item.impact.trim().length).toBeGreaterThan(20);
      expect(item.owner).toMatch(/^agent:/);
      expect(item.reportedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.reviewBy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.observed.trim().length).toBeGreaterThan(20);
    }
  });

  it('derives summary counts from rows instead of freezing all five as open', () => {
    const progressed = cloneLedger();
    const resolved = markResolved(progressed, firstOpenShortfall(progressed).id);
    progressed.summary.open -= 1;
    progressed.summary.resolved += 1;
    progressed.summary.blocking = progressed.summary.blocking.filter((id) => id !== resolved.id);
    expect(verifyLedger(progressed)).toEqual([]);

    const drifted = cloneLedger();
    markResolved(drifted, firstOpenShortfall(drifted).id);
    expect(verifyLedger(drifted).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['summary-open', 'summary-resolved', 'summary-blocking']),
    );
  });

  it('rejects evidence-free resolution and unresolved summary mutation', () => {
    const evidenceFree = cloneLedger();
    const item = firstOpenShortfall(evidenceFree);
    item.status = 'resolved';
    evidenceFree.summary.open -= 1;
    evidenceFree.summary.resolved += 1;
    evidenceFree.summary.blocking = evidenceFree.summary.blocking.filter((id) => id !== item.id);
    expect(verifyLedger(evidenceFree).map((issue) => issue.code)).toContain('resolution-evidence');

    const fabricatedCount = cloneLedger();
    fabricatedCount.summary.open += 1;
    expect(verifyLedger(fabricatedCount).map((issue) => issue.code)).toContain('summary-open');

    const missingId = cloneLedger();
    const missingShortfall = firstOpenShortfall(missingId);
    missingId.shortfalls = missingId.shortfalls.filter((entry) => entry.id !== missingShortfall.id);
    missingId.summary.total -= 1;
    missingId.summary.open -= 1;
    missingId.summary.blocking = missingId.summary.blocking.filter((id) => id !== missingShortfall.id);
    expect(verifyLedger(missingId).map((issue) => issue.code)).toContain('missing-shortfall');
  });

  it('rejects accepted P1 and unsigned accepted residuals', () => {
    const acceptedP1 = cloneLedger();
    // Upstream shortfalls can legitimately all be resolved; the rule under test
    // is about accepted P1/critical items, so construct a cloned open fixture
    // instead of requiring the current product ledger to retain one.
    const high = firstOpenShortfall(acceptedP1);
    high.risk = 'high';
    high.acceptanceDisposition = 'accepted-shortfall';
    acceptedP1.summary.accepted = [...acceptedP1.summary.accepted, high.id];
    acceptedP1.summary.blocking = acceptedP1.summary.blocking.filter((id) => id !== high.id);
    acceptedP1.summary.byDisposition['must-resolve-before-ga'] =
      (acceptedP1.summary.byDisposition['must-resolve-before-ga'] ?? 0) - 1;
    acceptedP1.summary.byDisposition['accepted-shortfall'] = 1;
    expect(verifyLedger(acceptedP1).map((issue) => issue.code)).toContain('accepted-p1');

    const unsigned = cloneLedger();
    const nonBlocking = firstOpenShortfall(unsigned, (item) => item.risk === 'medium');
    nonBlocking.acceptanceDisposition = 'accepted-shortfall';
    unsigned.summary.accepted = [...unsigned.summary.accepted, nonBlocking.id];
    unsigned.summary.blocking = unsigned.summary.blocking.filter((id) => id !== nonBlocking.id);
    unsigned.summary.byDisposition['must-resolve-before-ga'] =
      (unsigned.summary.byDisposition['must-resolve-before-ga'] ?? 0) - 1;
    unsigned.summary.byDisposition['accepted-shortfall'] = 1;
    expect(verifyLedger(unsigned).map((issue) => issue.code)).toContain('accepted-evidence');
  });

  it('never lets a gap become a pass or an implicit GA claim', () => {
    expect(ledger.shortfalls.some((item) => item.level === 'release-approved')).toBe(false);
    expect(ledger.shortfalls.some((item) => item.level === 'packaged' && item.status !== 'resolved')).toBe(false);
    const relabeled = cloneLedger();
    relabeled.shortfalls[0].observed = 'passing';
    expect(verifyLedger(relabeled).map((issue) => issue.code)).toContain('pass-claim');
    const guide = readFileSync(GUIDE, 'utf8');
    expect(guide).toContain('L6 requires the owner');
    expect(guide).toContain('A shortfall may never be written as `pass`');
  });

  it('classifies the current gaps for resolution versus accepted-shortfall decisions', () => {
    expect(ledger.acceptancePolicy.resolutionOrder[0]).toBe('fix-the-product-or-test-contract');
    expect(ledger.acceptancePolicy.blockedByAnyOf).toEqual(expect.arrayContaining([
      'unexpected-test-failure',
      'current-candidate-critical-journey-not-effect-proven',
      'unbounded-worktree-or-user-data-mutation',
    ]));
    expect(ledger.acceptancePolicy.acceptedShortfallEligibility).toEqual(expect.arrayContaining([
      'impact-blast-radius-and-user-visible-consequence-recorded',
      'reproduction-evidence-and-failing-oracle-recorded',
      'rollback-or-kill-switch-recorded',
      'residual-risk-accepted-with-agent-owner-and-review-date',
      'release-monitoring-and-quarantine-rule-recorded',
    ]));
    expect(ledger.acceptancePolicy.agentEvidenceRule).toMatchObject({
      drivenBy: 'agent',
      realHumanEvidence: false,
      deterministicOracleRequired: true,
      evaluatorMayOnlyReturn: ['pass', 'fail', 'unverified'],
    });
    for (const item of ledger.shortfalls) {
      expect(['low', 'medium', 'high', 'critical']).toContain(item.risk);
      expect(DISPOSITIONS).toContain(item.acceptanceDisposition);
      expect(typeof item.dataAtRisk).toBe('boolean');
      expect(typeof item.userVisible).toBe('boolean');
      expect(item.shortfallClass.trim().length).toBeGreaterThan(2);
    }
    expect(ledger.summary.byDisposition).toEqual({ 'must-resolve-before-ga': 5 });
    expect(ledger.summary.residualLimits).toEqual(expect.arrayContaining([
      'Windows x64 local source-build evidence only unless a separate platform receipt says otherwise',
      'No packaged/install-state artifact exists in the current checkout',
      'No real-provider or real-human evidence is claimed',
    ]));
    for (const item of ledger.shortfalls) {
      expect(item.rootCauseClass.trim().length).toBeGreaterThan(2);
      expect(item.blastRadius.trim().length).toBeGreaterThan(20);
      expect(['small', 'medium', 'large']).toContain(item.repairCost);
      expect(item.pathToGa.trim().length).toBeGreaterThan(20);
    }
    const blocking = new Set(ledger.summary.blocking);
    for (const item of ledger.shortfalls.filter(
      (entry) => entry.acceptanceDisposition === 'must-resolve-before-ga' && entry.status !== 'resolved',
    )) {
      expect(blocking.has(item.id)).toBe(true);
    }
    for (const item of ledger.shortfalls.filter((entry) => blocking.has(entry.id))) {
      expect(item.acceptanceDisposition).toBe('must-resolve-before-ga');
      expect(item.status).not.toBe('resolved');
    }
  });

  it('maps all eleven executable-plan nodes to current gates and evidence exits', () => {
    const closeout = readFileSync(CLOSEOUT, 'utf8');
    for (const id of EXPECTED_TASK_IDS) expect(closeout).toContain(`\`${id}\``);
    const nodes = closeout.match(/`TF-\d{4}`/g) ?? [];
    expect(new Set(nodes).size).toBeGreaterThanOrEqual(EXPECTED_TASK_IDS.length);
    for (const phrase of [
      'functionalReadiness',
      'distributionReadiness',
      'releaseApproved',
      'three consecutive times',
      'accepted-shortfall',
      'SHA256',
      'not-run',
      'driven_by: agent',
      'pnpm acceptance:agent:full',
    ]) {
      expect(closeout).toContain(phrase);
    }
  });

  it('requires deterministic evidence and independent evaluation for agent-driven acceptance', () => {
    const guide = readFileSync(GUIDE, 'utf8');
    expect(guide).toContain('### 5.1 Layered test strategy');
    expect(guide).toContain('### 5.2 Primary oracle and judge hierarchy');
    expect(guide).toContain('### 5.3 Agent-driven GUI acceptance runbook');
    expect(guide).toContain('### 5.4 Operational acceptance drills');
    expect(guide).toContain('### 5.5 Current-candidate acceptance matrix');
    expect(guide).toContain('### 5.6 Shortfall acceptance and false-positive controls');
    expect(guide).toContain('### 5.7 Next implementation sequence');
    expect(guide).toContain('Packaging | frozen');
    expect(guide).toContain('not-run for this candidate because');
    expect(guide).toContain('partial: index and policy checks pass, live docs review is unverified');
    expect(guide).toContain('A GUI Agent is an actor, not an oracle.');
    expect(guide).toContain('Deterministic oracle first');
    expect(guide).toContain('Run three times on a clean fixture');
    expect(guide).toContain('taskSuccess');
    expect(guide).toContain('trajectorySafety');
    expect(guide).toContain('replayable action timeline');
    expect(guide).toContain('A model-only claim of "I completed the');
    expect(guide).toContain('task" is never acceptance evidence.');
    expect(guide).toContain('openclaw_runtime/extensions/qa-lab');
    expect(guide).toContain('pnpm acceptance:agent:full');
  });

  it('retains successful primary-source research instead of unverifiable search summaries', () => {
    const research = JSON.parse(readFileSync(RESEARCH, 'utf8')) as {
      requestId: string;
      estimatedCostDollars: number;
      statuses: Array<{ id: string; status: string; source?: string }>;
      sources: Array<{ title: string; url: string; citationText: string }>;
      supplementarySources: Array<{ title: string; url: string; citationText: string }>;
      supplementaryStatuses: Array<{ id: string; status: string; source?: string }>;
    };
    expect(research.requestId).toBe('8b5571293252b541db3128c4129513f7');
    expect(research.estimatedCostDollars).toBe(0.01);
    expect(research.statuses).toHaveLength(10);
    expect(research.statuses.every((item) => item.status === 'success')).toBe(true);
    expect(research.sources).toHaveLength(10);
    expect(research.supplementarySources).toHaveLength(3);
    expect(research.supplementaryStatuses).toHaveLength(3);
    expect(research.supplementaryStatuses.every((item) => item.status === 'success')).toBe(true);
    for (const item of [...research.sources, ...research.supplementarySources]) {
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.url).toMatch(/^https:\/\//);
      expect(item.citationText.length).toBeGreaterThan(50);
    }

    const report = JSON.parse(readFileSync(RESEARCH_REPORT, 'utf8')) as {
      schemaVersion: string;
      driven_by: string;
      sources: Array<{ id: string; title: string; url: string; use: string }>;
      toolDecisions: Array<{ id: string; authority: string; ci: string; why: string; title?: string; url?: string }>;
    };
    expect(report.schemaVersion).toBe('ProductAcceptanceResearch/v1');
    expect(report.driven_by).toBe('agent');
    expect(report.sources).toHaveLength(15);
    expect(new Set(report.sources.map((item) => item.id)).size).toBe(report.sources.length);
    expect(report.toolDecisions).toHaveLength(6);
    expect(report.toolDecisions.map((item) => item.id)).toEqual(['midscene','windows-agent-arena','osworld','fast-check','stryker','axe']);
    for (const item of report.toolDecisions) {
      expect(item.authority.trim().length).toBeGreaterThan(2);
      expect(item.ci.trim().length).toBeGreaterThan(2);
      expect(item.why.trim().length).toBeGreaterThan(10);
      expect(item.url).toMatch(/^https:\/\//);
    }
    for (const item of report.sources) {
      expect(item.url).toMatch(/^https:\/\//);
      expect(item.use.trim().length).toBeGreaterThan(20);
    }
  });
});
