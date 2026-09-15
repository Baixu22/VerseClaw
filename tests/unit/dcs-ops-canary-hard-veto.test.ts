import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function exists(rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

function readJson(rel: string) {
  const p = path.join(root, rel);
  expect(fs.existsSync(p), `missing ${rel}`).toBe(true);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('DCS ops canary hard veto (honesty locks)', () => {
  it('packaging report stays opt-in and non-graduated when present', () => {
    if (!exists('artifacts/coding-prod-p0/report.json')) {
      // Local overnight/CI without packaging artifacts: not a product default flip.
      expect(true).toBe(true);
      return;
    }
    const report = readJson('artifacts/coding-prod-p0/report.json');
    expect(report.ok).toBe(true);
    expect(report.defaultsUnchanged).toBe(true);
    expect(report.readyForDefaultFlagGraduation).toBe(false);
    expect(report.productionMode).toBe('opt-in');
    const rl = report.redLines;
    expect(rl.viewToolsDefaultOff).toBe(true);
    expect(rl.staleWriteGuardDefaultFalse).toBe(true);
    expect(rl.isolationDefaultShared).toBe(true);
    expect(rl.worktreeBackendInprocess).toBe(true);
    expect(rl.symbolLeaseDefaultFalse).toBe(true);
    expect(rl.patchFlowDefaultFalse).toBe(true);
    expect(rl.routingMemoShadowDefaultFalse).toBe(true);
    expect(rl.sekbExperienceShadowDefaultFalse).toBe(true);
  });

  it('C1 canary decision refuses default-on and liveReady when present', () => {
    if (!exists('artifacts/dcs-canary/c1/decision.json')) {
      expect(true).toBe(true);
      return;
    }
    const d = readJson('artifacts/dcs-canary/c1/decision.json');
    expect(d.recommendation).not.toBe('default-on');
    expect(d.recommendation).toBe('keep-off');
    expect(d.liveReady).toBe(false);
    expect(d.productApproved).toBe(false);
    expect(d.defaultsUnchanged).toBe(true);
    expect(d.metrics?.live).not.toBe(true);
    expect(String(d.metrics?.corpusKind || '')).toMatch(/synthetic/i);
  });

  it('uses the real-tool C1 corpus as the only gate authority', () => {
    const d = readJson('artifacts/first-product-preview/FP-P4-05/decision.json');
    expect(d.authority).toMatchObject({
      corpusId: 'coding-c1-hand-authored-real-tools',
      role: 'gate-authority',
      fixtureCount: 4,
      reductionFactor: 4.5,
      live: false,
      meetsMetricThreshold: false,
    });
    expect(d.references).toHaveLength(1);
    expect(d.references[0]).toMatchObject({
      role: 'reference-only',
      fixtureCount: 32,
      reductionFactor: 5.125,
      eligibleForGateAuthority: false,
      live: false,
    });
    expect(d.decision).toMatchObject({
      meetsGate: false,
      recommendation: 'keep-off',
      defaultOn: false,
      defaultsUnchanged: true,
      liveReady: false,
      productApproved: false,
    });
  });

  it('TF-0006 remains blocked with graduation gates false when present', () => {
    if (!exists('artifacts/tf0006-evidence-upgrade/status.json')) {
      expect(true).toBe(true);
      return;
    }
    const s = readJson('artifacts/tf0006-evidence-upgrade/status.json');
    expect(s.status).toBe('blocked');
    expect(s.gates.liveReady).toBe(false);
    expect(s.gates.productApproved).toBe(false);
    expect(s.gates.readyForDefaultFlagGraduation).toBe(false);
  });

  it('week1 profiles hardBounds fail-closed when overnight pack present', () => {
    if (!exists('artifacts/dcs-deep-test-week1/profiles.json')) {
      expect(true).toBe(true);
      return;
    }
    const p = readJson('artifacts/dcs-deep-test-week1/profiles.json');
    expect(p.hardBounds.defaultsUnchanged).toBe(true);
    expect(p.hardBounds.liveReady).toBe(false);
    expect(p.hardBounds.productApproved).toBe(false);
    expect(p.hardBounds.jointSystemGa).toBe('NO-GO');
    expect(p.hardBounds.sekbAutoWriteback).toBe(false);
    expect(p.hardBounds.cutoverAllowed).toBe(false);
    const ids = (p.profiles || []).map((x: { id?: string }) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['dcs-coding', 'sekb-assisted', 'browser-supervised']));
    for (const id of ['dcs-coding', 'sekb-assisted', 'browser-supervised']) {
      const prof = p.profiles.find((x: { id?: string }) => x.id === id);
      expect(prof.owner || p.roles?.owner).toBeTruthy();
      expect(prof.kill).toBeTruthy();
      expect(prof.budget || prof.budgetTasks != null).toBeTruthy();
      expect(prof.privacy).toBeTruthy();
      expect(Array.isArray(prof.metrics) && prof.metrics.length > 0).toBe(true);
      expect(Array.isArray(prof.stopConditions) && prof.stopConditions.length > 0).toBe(true);
    }
  });

  it('preflight script exists and refuses default-on language in source', () => {
    const src = fs.readFileSync(path.join(root, 'scripts/dcs-ops-preflight.mjs'), 'utf8');
    expect(src).toMatch(/recommendation === ["']default-on["']/);
    expect(src).toMatch(/liveReady === true/);
    expect(src).toMatch(/HARD-STOP/);
    expect(src).toMatch(/nextStep/);
    expect(src).toMatch(/authoritative C1 gate decision/);
    expect(src).toMatch(/C1 reference corpus gained gate authority/);
    expect(src).toMatch(/l3Ready/);
    expect(src).toMatch(/do not start L3/);
    expect(src).toMatch(/evaluateTf0009L3Readiness/);
    expect(src).toMatch(/validateTf0009AgentSurrogateReport/);
    expect(src).toMatch(/agentSurrogateReady/);
  });
});
