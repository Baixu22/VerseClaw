import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WP9_EVIDENCE_REPORT_PATH,
  buildWp9GlobalAcceptance,
  documentDigest,
} from '../../scripts/versegit-wp9-global-acceptance.mjs';
import {
  validateWp9Report,
  verifyShaManifest,
  verifyWp9Artifacts,
} from '../../scripts/verify-versegit-wp9.mjs';

interface StoredReport {
  acceptance: Array<{ evidence: unknown[] }>;
  taskForest: {
    children: Array<{ self?: boolean; status: string }>;
    self: { status: string };
    parent: { status: string };
  };
  p1: unknown[];
  review: { wp8: { verdict: string } };
  authority: Record<string, boolean>;
  lifecycle: Record<string, boolean>;
  inputs: Array<{ sha256: string }>;
  digest?: string;
  [key: string]: unknown;
}

function stored(): StoredReport {
  return JSON.parse(readFileSync(resolve(process.cwd(), WP9_EVIDENCE_REPORT_PATH), 'utf8')) as StoredReport;
}

describe('WP9 whole-goal acceptance', () => {
  it('aggregates seven criteria, seventeen done children and one explicit retirement', () => {
    const report = buildWp9GlobalAcceptance({ generatedAt: '2026-10-22T00:00:00.000Z' });
    expect(report.passed).toBe(true);
    expect(report.globalVerdict).toBe('PASS_WITH_GAPS');
    expect(report.acceptanceSummary).toMatchObject({ required: 7, verified: 7, withoutEvidence: 0 });
    expect(report.childGateSummary).toMatchObject({ total: 18, done: 17, deprecated: 1, openOrBlocked: [], unresolvedDependencies: [] });
    expect(report.p0).toEqual([]);
    expect(report.p1).toEqual([]);
    expect(report.p2).toHaveLength(3);
    expect(report.review.wp8).toMatchObject({ verdict: 'PASS_WITH_GAPS', p0: 0, p1: 0, p2: 3, verifierPassed: true });
    expect(report.authority).toMatchObject({ humanEvidence: false, singleGreenLight: false, defaultOn: false, ga: false, releaseEligible: false, m4Authorized: false });
    expect(report.lifecycle).toMatchObject({ m3BoundedHostSliceObserved: true, m3ProductComplete: false, m4Authorized: false });
    expect(validateWp9Report(report, { root: process.cwd() }).issues).toEqual([]);
  });

  it('replays the retained report, manifest and both checksum surfaces', () => {
    const result = verifyWp9Artifacts({ root: process.cwd() });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.report.acceptanceSummary.verified).toBe(7);
    expect(result.manifest.children.total).toBe(18);
  });

  it('rejects missing evidence, open children and promoted lifecycle authority', () => {
    const report = structuredClone(stored());
    report.acceptance[0].evidence = [];
    const child = report.taskForest.children.find((entry: Record<string, unknown>) => entry.self !== true);
    child.status = 'ready';
    report.taskForest.children.find((entry: Record<string, unknown>) => entry.self === true).status = 'blocked';
    report.taskForest.self.status = 'blocked';
    report.taskForest.parent.status = 'blocked';
    report.p1.push({ id: 'P1-open' });
    report.review.wp8.verdict = 'FAIL';
    report.authority.ga = true;
    report.authority.releaseEligible = true;
    report.authority.m4Authorized = true;
    report.authority.humanEvidence = true;
    report.lifecycle.defaultOn = true;
    report.digest = documentDigest(report);
    const issues = validateWp9Report(report, { root: process.cwd() }).issues;
    expect(issues).toEqual(expect.arrayContaining([
      'P1 findings must be zero',
      'AC1-contract-identity: evidence missing',
      'self node status is illegal',
      'parent node status is illegal',
      'a required child is not done/deprecated',
      'WP8 review gate is not passing',
      'authority promotion: ga',
      'authority promotion: releaseEligible',
      'authority promotion: m4Authorized',
      'authority promotion: humanEvidence',
      'lifecycle promotion: defaultOn',
    ]));
  });

  it('rejects a re-sealed report whose retained input bytes changed', () => {
    const report = structuredClone(stored());
    report.inputs[0].sha256 = '0'.repeat(64);
    report.digest = documentDigest(report);
    const issues = validateWp9Report(report, { root: process.cwd() }).issues;
    expect(issues.some((issue: string) => issue.includes('input digest mismatch'))).toBe(true);
  });

  it('rejects a checksum surface after target bytes are mutated', () => {
    const root = mkdtempSync(join(tmpdir(), 'versegit-wp9-sha-'));
    try {
      const target = 'payload.json';
      const content = '{"ok":true}\n';
      writeFileSync(resolve(root, target), content, 'utf8');
      const digest = createHash('sha256').update(content).digest('hex');
      writeFileSync(resolve(root, 'SHA256SUMS'), `${digest}  ${target}\n`, 'utf8');
      expect(verifyShaManifest({ root, path: 'SHA256SUMS', expectedPaths: [target] }).ok).toBe(true);
      writeFileSync(resolve(root, target), '{"ok":false}\n', 'utf8');
      const issues = verifyShaManifest({ root, path: 'SHA256SUMS', expectedPaths: [target] }).issues;
      expect(issues).toContain(`SHA256SUMS mismatch: ${target}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
