import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WP9_EVIDENCE_REPORT_PATH,
  WP9_FIXTURE_PATH,
  WP9_GRAPH_CONFIG_PATH,
  buildWp9GlobalAcceptance,
  documentDigest,
} from '../../scripts/versegit-wp9-global-acceptance.mjs';
import {
  validateWp9Report,
  verifyShaManifest,
  verifyWp9Artifacts,
} from '../../scripts/verify-versegit-wp9.mjs';
import { normalizeEvidenceIssues } from '../../scripts/versegit-product-a1-evidence.mjs';

interface StoredReport {
  acceptance: Array<{ evidence: unknown[]; status: string; criterion: string }>;
  taskForest: {
    children: Array<{ self?: boolean; status: string }>;
    self: { status: string };
    parent: { status: string; acceptanceCriteria: string[] };
  };
  p1: unknown[];
  review: {
    wp8: { verdict: string };
    wp9: { actor: string; verdict: string; p0: number; p1: number; p2: number; passed: boolean };
  };
  authority: Record<string, boolean>;
  lifecycle: Record<string, boolean>;
  inputs: Array<{ sha256: string }>;
  digest?: string;
  [key: string]: unknown;
}

function stored(): StoredReport {
  return JSON.parse(readFileSync(resolve(process.cwd(), WP9_EVIDENCE_REPORT_PATH), 'utf8')) as StoredReport;
}

function fixture(): { graphHash: string; parent: { acceptanceCriteria: string[] } } {
  return JSON.parse(readFileSync(resolve(process.cwd(), WP9_FIXTURE_PATH), 'utf8')) as { graphHash: string; parent: { acceptanceCriteria: string[] } };
}

describe('WP9 whole-goal acceptance', () => {
  it('aggregates seven criteria, seventeen done children and one explicit retirement', () => {
    const configPath = resolve(process.cwd(), WP9_GRAPH_CONFIG_PATH);
    const hasPrecloseGraph = existsSync(configPath)
      && (JSON.parse(readFileSync(configPath, 'utf8')) as { graph_hash?: string }).graph_hash === fixture().graphHash;
    const report = hasPrecloseGraph
      ? buildWp9GlobalAcceptance({ generatedAt: '2026-10-22T00:00:00.000Z' })
      : stored();
    expect(report.passed).toBe(true);
    expect(report.globalVerdict).toBe('PASS_WITH_GAPS');
    expect(report.acceptanceSummary).toMatchObject({ required: 7, verified: 7, withoutEvidence: 0 });
    expect(report.childGateSummary).toMatchObject({ total: 18, done: 17, deprecated: 1, openOrBlocked: [], unresolvedDependencies: [] });
    expect(report.p0).toEqual([]);
    expect(report.p1).toEqual([]);
    expect(report.p2).toHaveLength(3);
    expect(report.review.wp8).toMatchObject({ verdict: 'PASS_WITH_GAPS', p0: 0, p1: 0, p2: 3, verifierPassed: true });
    expect(report.review.wp9).toMatchObject({ actor: 'ccs-hub/gpt-6.1-sol', verdict: 'PASS_WITH_GAPS', p0: 0, p1: 0, p2: 3, passed: true });
    expect(report.authority).toMatchObject({ humanEvidence: false, singleGreenLight: false, defaultOn: false, ga: false, releaseEligible: false, m4Authorized: false });
    expect(report.lifecycle).toMatchObject({ m3BoundedHostSliceObserved: true, m3ProductComplete: false, m4Authorized: false });
    expect(validateWp9Report(report, { root: process.cwd() }).issues).toEqual([
      'AC2-opt-in-adapter: input digest mismatch harness/src/profiles.mjs',
      'AC2-opt-in-adapter: input digest mismatch electron/services/versegit-module.ts',
      'input: input digest mismatch electron/services/versegit-module.ts',
      'input: input digest mismatch harness/src/profiles.mjs',
    ]);
  });

  it('replays the retained report and reports exact historical drift without re-sealing it', () => {
    const wp6CurrentHash = createHash('sha256').update(readFileSync(resolve('tests/unit/versegit-wp6-closeout.test.ts'))).digest('hex').slice(0, 12);
    const result = verifyWp9Artifacts({ root: process.cwd() });
    const hasWp6Mirror = existsSync(resolve(process.cwd(), 'artifacts/versegit/wp6/SHA256SUMS'));
    const hasMc6Mirror = existsSync(resolve(process.cwd(), 'artifacts/versegit/mc6/SHA256SUMS'));
    const hasWp9Mirror = existsSync(resolve(process.cwd(), 'artifacts/versegit/wp9/SHA256SUMS'));
    expect(normalizeEvidenceIssues(process.cwd(), result.issues)).toEqual([
      'AC2-opt-in-adapter: input digest mismatch harness/src/profiles.mjs',
      'AC2-opt-in-adapter: input digest mismatch electron/services/versegit-module.ts',
      'input: input digest mismatch electron/services/versegit-module.ts',
      'input: input digest mismatch harness/src/profiles.mjs',
      'WP6 verifier: stored report digest differs from the live closeout replay',
      `WP6 verifier: wp6-evidence-sums: <worktree>/harness/specs/fixtures/versegit-planning-correction/wp6-evidence/SHA256SUMS: tests/unit/versegit-wp6-closeout.test.ts: expected 3378fe8ee8cd actual ${wp6CurrentHash}`,
      ...(hasWp6Mirror ? [`WP6 verifier: wp6-artifact-sums: <worktree>/artifacts/versegit/wp6/SHA256SUMS: tests/unit/versegit-wp6-closeout.test.ts: expected 3378fe8ee8cd actual ${wp6CurrentHash}`] : []),
      `WP6 verifier: mc6-evidence-sums: <worktree>/harness/specs/fixtures/versegit-planning-correction/mc6-evidence/SHA256SUMS: tests/unit/versegit-wp6-closeout.test.ts: expected 3378fe8ee8cd actual ${wp6CurrentHash}`,
      ...(hasMc6Mirror ? [`WP6 verifier: mc6-artifact-sums: <worktree>/artifacts/versegit/mc6/SHA256SUMS: tests/unit/versegit-wp6-closeout.test.ts: expected 3378fe8ee8cd actual ${wp6CurrentHash}`] : []),
      'WP8 verifier: input digest mismatch: scripts/versegit-wp7-host-vertical.mts',
      'WP8 verifier: input digest mismatch: electron/services/versegit-receipt-bridge.ts',
      'WP8 verifier: input digest mismatch: electron/services/versegit-receipt-evidence.ts',
      'WP8 verifier: input digest mismatch: electron/services/versegit-module.ts',
      'WP8 verifier: input digest mismatch: electron/services/versegit-observation.ts',
      'WP8 verifier: input digest mismatch: tests/unit/versegit-wp7-host-vertical.test.ts',
      'WP8 verifier: input digest mismatch: tests/unit/versegit-receipt-authority.test.ts',
      'WP8 verifier: SHA256SUMS mismatch: electron/services/versegit-module.ts',
      'WP8 verifier: SHA256SUMS mismatch: electron/services/versegit-observation.ts',
      'WP8 verifier: SHA256SUMS mismatch: electron/services/versegit-receipt-bridge.ts',
      'WP8 verifier: SHA256SUMS mismatch: electron/services/versegit-receipt-evidence.ts',
      'WP8 verifier: SHA256SUMS mismatch: scripts/versegit-wp7-host-vertical.mts',
      'WP8 verifier: SHA256SUMS mismatch: tests/unit/versegit-receipt-authority.test.ts',
      'WP8 verifier: SHA256SUMS mismatch: tests/unit/versegit-wp7-host-vertical.test.ts',
      'WP8 verifier: SHA256SUMS mismatch: tests/unit/versegit-wp8-review.test.ts',
      'curated: SHA256SUMS mismatch: docs/dev/versegit-validation-layer/README.md',
      'curated: SHA256SUMS mismatch: tests/unit/versegit-wp9-global-acceptance.test.ts',
      ...(hasWp9Mirror ? [
        'artifact: SHA256SUMS mismatch: docs/dev/versegit-validation-layer/README.md',
        'artifact: SHA256SUMS mismatch: tests/unit/versegit-wp9-global-acceptance.test.ts',
      ] : []),
    ]);
    expect(result.ok).toBe(false);
    expect(result.report.acceptanceSummary.verified).toBe(7);
    expect(result.manifest.children.total).toBe(18);
  });
  it('rejects missing evidence, open children and promoted lifecycle authority', () => {
    const report = structuredClone(stored());
    report.acceptance[0].evidence = [];
    const child = report.taskForest.children.find((entry: Record<string, unknown>) => entry.self !== true)!;
    child.status = 'ready';
    report.taskForest.children.find((entry: Record<string, unknown>) => entry.self === true)!.status = 'blocked';
    report.taskForest.self.status = 'blocked';
    report.taskForest.parent.status = 'blocked';
    report.p1.push({ id: 'P1-open' });
    report.review.wp8.verdict = 'FAIL';
    report.review.wp9.p0 = 1;
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
      'WP9 independent review findings mismatch',
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

  it('rejects re-sealed criterion, self-snapshot and count mismatches', () => {
    const report = structuredClone(stored());
    report.acceptance[0].evidence = structuredClone(report.acceptance[1].evidence);
    report.acceptance[0].status = 'unverified';
    report.acceptance[0].criterion = 'replacement criterion';
    report.taskForest.children.find((entry) => entry.self === true)!.status = 'done';
    report.digest = documentDigest(report);
    const issues = validateWp9Report(report, { root: process.cwd() }).issues;
    expect(issues).toEqual(expect.arrayContaining([
      'AC1-contract-identity: evidence mapping drifted',
      'AC1-contract-identity: criterion differs from Task Forest snapshot',
      'self snapshot contradiction',
      'acceptance summary is incomplete or self-reported',
    ]));
  });

  it('rejects coordinated criterion and snapshot replacement against the fixture', () => {
    const report = structuredClone(stored());
    const replacement = 'coordinated replacement criterion';
    report.acceptance[0].criterion = replacement;
    report.taskForest.parent.acceptanceCriteria[0] = replacement;
    report.digest = documentDigest(report);
    const issues = validateWp9Report(report, { root: process.cwd(), fixture: fixture() }).issues;
    expect(issues).toContain('acceptance criterion text differs from fixture');
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
