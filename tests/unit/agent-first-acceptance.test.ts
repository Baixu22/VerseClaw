import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkAgentFirstAcceptanceContract } from '../../scripts/agent-first-acceptance-check.mjs';
import {
  CONTRACT_PATHS,
  loadAgentFirstAcceptanceContractFiles,
  runAgentFirstAcceptanceNegativeControls,
  validateAgentFirstAcceptanceContract,
} from '../../scripts/lib/agent-first-acceptance-contract.mjs';

const ROOT = process.cwd();
const MATRIX_PATH = join(ROOT, 'harness/specs/fixtures/agent-first-acceptance/matrix.json');
const SOURCES_PATH = join(ROOT, 'harness/specs/fixtures/agent-first-acceptance/sources.json');
const GUIDE_PATH = join(ROOT, 'harness/specs/guides/agent-first-acceptance.md');
const CLOSEOUT_PATH = join(ROOT, 'harness/specs/tasks/product-acceptance-closeout.md');
const VALIDATION_REPORT_PATH = join(ROOT, 'harness/specs/fixtures/agent-first-acceptance/validation-report.json');

const EXPECTED_GATE_FIELDS = [
  'id',
  'phase',
  'name',
  'input',
  'command',
  'oracle',
  'negative',
  'evidence',
  'actor',
  'automated',
] as const;
const EXPECTED_GATE_IDS = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'D1', 'D2', 'E1', 'E2', 'F1', 'F2', 'G1'];
const EXPECTED_DIMENSIONS = [
  'source',
  'engineering',
  'runtime',
  'effect',
  'distribution',
  'operational',
  'agentQuality',
  'releaseApproval',
];
const EXPECTED_VERDICTS = ['pass', 'partial', 'not-run', 'accepted-shortfall', 'fail', 'invalid'];
const EXPECTED_NODES = {
  root: 'TF-0588',
  contract: 'TF-0589',
  tasks: 'TF-0590',
  ui: 'TF-0591',
  stats: 'TF-0592',
  review: 'TF-0593',
  ops: 'TF-0594',
  adjudicate: 'TF-0595',
  integrate: 'TF-0596',
};

type Gate = Record<(typeof EXPECTED_GATE_FIELDS)[number], unknown>;
type Matrix = {
  schemaVersion: string;
  status: string;
  dimensions: Array<{ id: string; claim: string; blocking: boolean }>;
  gates: Gate[];
  verdictStates: string[];
  requiredGateFields: string[];
  requiredVerdictStates: string[];
  requiredDimensions: string[];
  evidencePack: string[];
  taskForestNodes: Record<string, string>;
  taskForestClosure?: {
    node: string;
    status: string;
    progress: number;
    graphHashBefore: string;
    graphHashAfter: string;
  };
  lockedBoundaries: Record<string, unknown>;
  currentContractEvidence: {
    scope: string;
    verdict: string;
    driven_by: string;
    actor: string;
    limitations: string[];
    independentReview?: { actor: string; verdict: string };
    evidenceStatus?: string;
    evidenceBinding?: { sourceCandidateCommit: string; finalSealedReadbackRequired: boolean };
    focusedTests: { exitCode: number; testsPassed: number; testsFailed: number };
  };
  staticContractValidation?: {
    recordedAt: string;
    driven_by: string;
    actor: string;
    scope: string;
    relationToSealedEvidence: string;
    command: string;
    exitCode: number;
    report: string;
    counts: { gates: number; dimensions: number; verdictStates: number; sources: number; findings: number };
    negativeControls: { total: number; rejected: number };
    failureClassesCovered: string[];
    limitations: string[];
  };
};
type Sources = {
  schemaVersion: string;
  driven_by: string;
  actor: string;
  sources: Array<{ id: string; url: string; family: string; title: string; facts: string[] }>;
  providerRequests: Array<{ status: string }>;
  findings: unknown[];
  taskForestNodes: Record<string, string>;
};

function nonEmpty(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return Array.isArray(value) && value.length > 0;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

describe('agent-first acceptance contract', () => {
  it('keeps the complete gate matrix with an executable input, command, oracle, negative and evidence', () => {
    const matrix = readJson<Matrix>(MATRIX_PATH);

    expect(matrix.schemaVersion).toBe('AgentFirstAcceptanceMatrix/v1');
    expect(matrix.status).toBe('done');
    expect(matrix.taskForestClosure?.node).toBe('TF-0589');
    expect(matrix.taskForestClosure?.status).toBe('done');
    expect(matrix.taskForestClosure?.progress).toBe(100);
    expect(matrix.taskForestClosure?.graphHashBefore).toMatch(/^[a-f0-9]{64}$/u);
    expect(matrix.taskForestClosure?.graphHashAfter).toMatch(/^[a-f0-9]{64}$/u);
    expect(matrix.requiredGateFields).toEqual([...EXPECTED_GATE_FIELDS]);
    expect(matrix.gates.map((gate) => gate.id)).toEqual(EXPECTED_GATE_IDS);
    expect(new Set(matrix.gates.map((gate) => gate.id)).size).toBe(matrix.gates.length);

    for (const gate of matrix.gates) {
      for (const field of EXPECTED_GATE_FIELDS) {
        const value = gate[field];
        if (typeof value === 'boolean') continue;
        expect(nonEmpty(value), `${String(gate.id)}: ${field}`).toBe(true);
      }
      expect(typeof gate.automated).toBe('boolean');
      expect(Array.isArray(gate.negative) && (gate.negative as unknown[]).length > 0).toBe(true);
      expect(Array.isArray(gate.evidence) && (gate.evidence as unknown[]).length > 0).toBe(true);
    }

    const publisher = matrix.gates.find((gate) => gate.id === 'G1');
    expect(publisher?.automated).toBe(false);
    expect(publisher?.actor).toBe('publisher');
  });

  it('requires every dimension, verdict and hard lock while separating publication from acceptance', () => {
    const matrix = readJson<Matrix>(MATRIX_PATH);

    expect(matrix.dimensions.map((dimension) => dimension.id)).toEqual(EXPECTED_DIMENSIONS);
    expect(matrix.requiredDimensions).toEqual(EXPECTED_DIMENSIONS);
    expect(matrix.verdictStates).toEqual(EXPECTED_VERDICTS);
    expect(matrix.requiredVerdictStates).toEqual(EXPECTED_VERDICTS);
    expect(new Set(matrix.dimensions.map((dimension) => dimension.id)).size).toBe(matrix.dimensions.length);
    for (const dimension of matrix.dimensions) {
      expect(dimension.claim.trim().length).toBeGreaterThan(10);
      expect(dimension.blocking).toBe(true);
    }

    expect(matrix.lockedBoundaries).toMatchObject({
      humanAcceptanceRequired: false,
      humanEvidenceClaimed: false,
      drivenBy: 'agent',
      releaseApproved: false,
      liveReady: false,
      productApproved: false,
      defaultOn: false,
    });
  });

  it('binds evidence, source provenance and TF mappings without overstating the current verdict', () => {
    const matrix = readJson<Matrix>(MATRIX_PATH);
    const sources = readJson<Sources>(SOURCES_PATH);

    expect(sources.schemaVersion).toBe('AgentFirstAcceptanceResearch/v1');
    expect(sources.driven_by).toBe('agent');
    expect(sources.actor).toBe('codex');
    expect(sources.sources.length).toBeGreaterThanOrEqual(19);
    expect(sources.providerRequests.every((request) => request.status === 'success')).toBe(true);
    expect(sources.findings.length).toBeGreaterThanOrEqual(10);
    expect(new Set(sources.sources.map((source) => source.id)).size).toBe(sources.sources.length);
    expect(new Set(sources.sources.map((source) => source.url)).size).toBe(sources.sources.length);
    expect(sources.sources.every((source) => source.url.startsWith('https://'))).toBe(true);
    expect(new Set(sources.sources.map((source) => source.family))).toEqual(
      new Set(['software-engineering-acceptance', 'engineering-acceptance', 'agent-era-acceptance']),
    );
    expect(sources.sources.filter((source) => source.family === 'agent-era-acceptance').length).toBeGreaterThanOrEqual(6);
    expect(sources.sources.every((source) => source.title.trim() && source.facts.length > 0)).toBe(true);
    expect(sources.taskForestNodes).toEqual(EXPECTED_NODES);
    expect(matrix.taskForestNodes).toEqual(EXPECTED_NODES);
    expect(matrix.evidencePack).toEqual(
      expect.arrayContaining(['manifest.json', 'aggregate.json', 'review.json', 'SHA256SUMS', 'credential-scan.json']),
    );
    expect(matrix.currentContractEvidence.driven_by).toBe('agent');
    expect(matrix.currentContractEvidence.actor).toBe('codex');
    expect(matrix.currentContractEvidence.verdict).toMatch(/^(pass|partial|not-run|accepted-shortfall|fail|invalid)$/u);
    expect(matrix.currentContractEvidence.limitations.length).toBeGreaterThan(0);
    expect(matrix.currentContractEvidence.scope).toContain('contract');
    expect(JSON.stringify(matrix.currentContractEvidence)).not.toMatch(/Files remain untracked|No independent agent has re-read/u);
    if (matrix.currentContractEvidence.verdict === 'pass') {
      expect(matrix.currentContractEvidence.independentReview?.verdict).toBe('pass');
      expect(matrix.currentContractEvidence.independentReview?.actor).not.toBe(matrix.currentContractEvidence.actor);
      expect(matrix.currentContractEvidence.evidenceStatus).toContain('sealed');
      expect(matrix.currentContractEvidence.evidenceBinding?.sourceCandidateCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(matrix.currentContractEvidence.evidenceBinding?.finalSealedReadbackRequired).toBe(false);
    }
  });

  it('documents all three research tracks and rejects a first-line human gate', () => {
    const guide = readFileSync(GUIDE_PATH, 'utf8');
    const closeout = readFileSync(CLOSEOUT_PATH, 'utf8');

    expect(guide).toMatch(/^---\r?\nid: agent-first-acceptance\r?\n/u);
    expect(guide).toContain('Status: active');
    for (const phrase of [
      'software-testing practice',
      'Agent evaluation',
      'final state',
      'deterministic',
      'transcript',
      'infrastructure',
      'confidence interval',
      'human verdict',
      'human-provided data',
    ]) {
      expect(guide.toLowerCase()).toContain(phrase.toLowerCase());
    }
    expect(guide).toContain('No node may use a human verdict or human-provided data as an open condition.');
    expect(guide).toContain('real-human acceptance');
    expect(closeout).toContain('harness/specs/guides/agent-first-acceptance.md');
    expect(closeout).toContain('harness/specs/fixtures/agent-first-acceptance/**');
  });

  it('layers the static validation on top of the sealed verdict without rewriting it', () => {
    const matrix = readJson<Matrix>(MATRIX_PATH);
    const additive = matrix.staticContractValidation;

    expect(additive, 'the additive static-validation block must be present').toBeTruthy();
    expect(additive?.driven_by).toBe('agent');
    expect(additive?.actor).toBe('claude/tf0589-verifier');
    expect(additive?.relationToSealedEvidence).toMatch(/does not replace/iu);
    // A second readback by a different actor, not a second verdict by the same one.
    expect(additive?.actor).not.toBe(matrix.currentContractEvidence.actor);
    expect(additive?.exitCode).toBe(0);
    expect(additive?.negativeControls.rejected).toBe(additive?.negativeControls.total);
    expect(additive?.negativeControls.total).toBeGreaterThanOrEqual(15);
    expect(additive?.failureClassesCovered.length).toBeGreaterThanOrEqual(4);
    expect(additive?.limitations.length).toBeGreaterThan(0);
    // The report it points at is a real tracked file, not a claim.
    expect(readFileSync(join(ROOT, String(additive?.report)), 'utf8').length).toBeGreaterThan(0);
  });

  it('accepts the checked-in contract by reading the file bodies, not a command transcript', () => {
    const files = loadAgentFirstAcceptanceContractFiles(ROOT);
    const { violations, counts } = validateAgentFirstAcceptanceContract(files);

    expect(violations).toEqual([]);
    expect(counts).toEqual({ gates: 14, dimensions: 8, verdictStates: 6, sources: 19, findings: 10 });
  });

  it('fails closed on every declared negative control', () => {
    const files = loadAgentFirstAcceptanceContractFiles(ROOT);
    const controls = runAgentFirstAcceptanceNegativeControls(files);

    expect(controls.length).toBeGreaterThanOrEqual(15);
    for (const control of controls) {
      expect(control.rejected, `${control.id} must be rejected with ${control.expectedCode}`).toBe(true);
      expect(control.observedCodes).toContain(control.expectedCode);
    }

    // The four failure classes the contract names explicitly, each pinned to a
    // control, so a refactor cannot quietly drop one of them.
    const byId = new Map(controls.map((control) => [control.id, control]));
    expect(byId.get('requirement-gate-dropped')?.expectedCode).toBe('requirement.gate-missing');
    expect(byId.get('dimension-unknown')?.expectedCode).toBe('dimension.invalid-set');
    expect(byId.get('verdict-unknown-state')?.expectedCode).toBe('verdict.unknown-state');
    expect(byId.get('gate-missing-negative')?.expectedCode).toBe('gate.negative-empty');
  });

  it('keeps the tracked validation report in lockstep with a fresh read of the contract', () => {
    // The report is compared against a re-run over the current files, so the
    // structural facts it records — gate set, dimension and verdict sets, and
    // every negative-control outcome — cannot drift from disk unnoticed. It is
    // a structural lock, not a byte hash of the three contract files.
    const tracked = readJson<{ checkedAt: string; actor: string }>(VALIDATION_REPORT_PATH);
    const fresh = checkAgentFirstAcceptanceContract(ROOT, tracked.actor, tracked.checkedAt);

    expect(fresh.ok).toBe(true);
    expect(fresh.report).toEqual(tracked);
  });

  it('keeps the contract paths the validator reads in one place', () => {
    // A validator reading a path the test does not is a silent coverage hole.
    expect(CONTRACT_PATHS.matrix).toBe('harness/specs/fixtures/agent-first-acceptance/matrix.json');
    expect(CONTRACT_PATHS.sources).toBe('harness/specs/fixtures/agent-first-acceptance/sources.json');
    expect(CONTRACT_PATHS.guide).toBe('harness/specs/guides/agent-first-acceptance.md');
    expect(CONTRACT_PATHS.closeout).toBe('harness/specs/tasks/product-acceptance-closeout.md');
  });
});
