import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildMaturityScorecard,
  collectPhaseStatuses,
  evaluateReleaseDecision,
  evaluateRiskAcceptances,
  runSystemMaturityQuarterlyAudit,
  validateQuarterlyAuditReport,
} from '../../scripts/lib/system-maturity-quarterly-audit.mjs';

function writeJson(root: string, relative: string, value: unknown) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function fixtureRoot(overrides: {
  p0Done?: boolean;
  p1Done?: boolean;
  p7Done?: boolean;
  riskItems?: Array<Record<string, string>>;
  findings?: Array<Record<string, string>>;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'clawx-p7-004-'));
  const p0Done = overrides.p0Done ?? true;
  const p1Done = overrides.p1Done ?? true;
  const p7Done = overrides.p7Done ?? true;
  const phases = [
    ['phase0-foundation', p0Done, { 'P0-001': p0Done ? 'done' : 'todo' }],
    ['phase1-direct-boundaries', p1Done, { 'P1-001': p1Done ? 'done' : 'todo' }],
    ['phase2-authorization-isolation', true, { 'P2-001': 'done' }],
    ['phase3-data-authority', true, { 'P3-001': 'done' }],
    ['phase4-runtime-surfaces', true, { 'P4-001': 'done' }],
    ['phase5-reliability-abuse', true, { 'P5-001': 'done' }],
    ['phase6-supply-release', true, { 'P6-001': 'done' }],
    ['phase7-continuous-governance', p7Done, {
      'P7-001': 'done',
      'P7-002': 'done',
      'P7-003': 'done',
      'P7-004': p7Done ? 'done' : 'in_progress',
    }],
  ] as const;
  for (const [id, done, tasks] of phases) {
    writeJson(root, `plans/system-maturity/${id}/STATUS.json`, {
      phase: id,
      phaseStatus: done ? 'done' : 'in_progress',
      tasks,
      allTasksDone: done,
    });
  }
  writeJson(root, 'plans/system-maturity/findings-registry.json', {
    findings: overrides.findings ?? [
      { id: 'F-GOV-002', decision: 'Track', status: 'Partial' },
      { id: 'F-GOV-003', decision: 'Publish-blocker', status: 'Fixed' },
    ],
  });
  writeJson(root, 'plans/system-maturity/risk-acceptance.json', {
    schemaVersion: 1,
    items: overrides.riskItems ?? [
      {
        findingId: 'F-GOV-002',
        decision: 'Track',
        owner: 'program-governance',
        reviewBy: '2026-10-18',
        rationale: 'quarterly residual',
      },
    ],
  });
  return root;
}

describe('P7-004 quarterly maturity audit', () => {
  it('A1: traces every phase STATUS path and detects inconsistency', () => {
    const root = fixtureRoot({ p7Done: false });
    const phases = collectPhaseStatuses(root);
    expect(phases).toHaveLength(8);
    expect(phases.every((phase) => Boolean(phase.statusPath))).toBe(true);
    expect(phases.find((phase) => phase.id === 'phase7-continuous-governance')?.consistent).toBe(true);

    writeJson(root, 'plans/system-maturity/phase0-foundation/STATUS.json', {
      phase: 'phase0-foundation',
      phaseStatus: 'done',
      tasks: { 'P0-001': 'todo' },
      allTasksDone: true,
    });
    const bad = collectPhaseStatuses(root).find((phase) => phase.id === 'phase0-foundation');
    expect(bad?.consistent).toBe(false);
  });

  it('A2: requires risk acceptance reviewBy and fails expired entries', () => {
    const findings = [
      { id: 'F-GOV-002', decision: 'Track' },
      { id: 'F-UX-001', decision: 'Track' },
    ];
    const missing = evaluateRiskAcceptances({
      findings,
      riskRegistry: { items: [] },
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors.join('\n')).toContain('missing risk acceptance entry for F-GOV-002');

    const expired = evaluateRiskAcceptances({
      findings,
      riskRegistry: {
        items: [
          { findingId: 'F-GOV-002', reviewBy: '2026-01-01' },
          { findingId: 'F-UX-001', reviewBy: '2026-10-18' },
        ],
      },
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
    });
    expect(expired.ok).toBe(false);
    expect(expired.errors.join('\n')).toContain('expired');
    expect(expired.rows.find((row) => row.findingId === 'F-UX-001')?.status).toBe('active');
  });

  it('A3: incomplete P0/P1 automatically blocks release', () => {
    const incomplete = fixtureRoot({ p0Done: false, p1Done: true, p7Done: true });
    const report = runSystemMaturityQuarterlyAudit({
      root: incomplete,
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
      agentDevAudit: { status: 'pass', releaseReady: true, score: 95, grade: 'A' },
    });
    expect(report.releaseDecision.allowed).toBe(false);
    expect(report.releaseDecision.blockers.join('\n')).toContain('P0 incomplete');
    expect(report.ok).toBe(false);

    const incompleteP1 = fixtureRoot({ p0Done: true, p1Done: false });
    const reportP1 = runSystemMaturityQuarterlyAudit({
      root: incompleteP1,
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
      agentDevAudit: null,
    });
    expect(reportP1.releaseDecision.blockers.join('\n')).toContain('P1 incomplete');
  });

  it('does not treat Agent Dev A-grade or releaseReady=false as whole-system release truth', () => {
    const root = fixtureRoot({ p7Done: true });
    const report = runSystemMaturityQuarterlyAudit({
      root,
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
      agentDevAudit: { status: 'pass', releaseReady: false, score: 96, grade: 'A' },
    });
    expect(report.releaseDecision.allowed).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.scorecard.agentDevNote?.caveat).toMatch(/must not be extrapolated/i);
    expect(report.releaseDecision.notes?.some((note: { code: string }) => note.code === 'agent-dev-releaseReady-false')).toBe(true);
  });

  it('builds a scorecard and validates report shape', () => {
    const root = fixtureRoot();
    const report = runSystemMaturityQuarterlyAudit({
      root,
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
      agentDevAudit: null,
    });
    expect(validateQuarterlyAuditReport(report)).toEqual([]);
    expect(report.scorecard.total).toBeGreaterThanOrEqual(90);
    expect(report.summary.phasesTraceable).toBe(8);

    const release = evaluateReleaseDecision({
      phases: collectPhaseStatuses(root),
      riskOk: true,
      agentDevAudit: null,
    });
    const scorecard = buildMaturityScorecard({
      phases: collectPhaseStatuses(root),
      risk: { ok: true, errors: [], rows: [] },
      release,
      agentDevAudit: null,
    });
    expect(scorecard.dimensions).toHaveLength(4);
    expect(scorecard.max).toBe(100);
  });

  it('maps Agent Dev totalScore into quarterly scorecard without whole-system release extrapolation', () => {
    const root = fixtureRoot({ p7Done: true });
    const report = runSystemMaturityQuarterlyAudit({
      root,
      nowMs: Date.parse('2026-07-18T00:00:00.000Z'),
      agentDevAudit: {
        status: 'pass',
        releaseReady: false,
        score: 97,
        grade: 'A',
      },
    });
    expect(report.scorecard.agentDevNote?.score).toBe(97);
    expect(report.releaseDecision.allowed).toBe(true);
  });

  it('keeps the checked-in risk-acceptance registry covering Track findings', () => {
    const findings = JSON.parse(
      readFileSync(join(process.cwd(), 'plans/system-maturity/findings-registry.json'), 'utf8'),
    );
    const risk = JSON.parse(
      readFileSync(join(process.cwd(), 'plans/system-maturity/risk-acceptance.json'), 'utf8'),
    );
    const result = evaluateRiskAcceptances({
      findings: findings.findings,
      riskRegistry: risk,
      nowMs: Date.parse('2026-07-18T12:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
