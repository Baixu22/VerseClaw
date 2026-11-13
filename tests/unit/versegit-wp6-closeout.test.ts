import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MC6_FIXTURE_PATH,
  buildMc6Decision,
  buildWp6Closeout,
  validateMc6Decision,
  validateWp6Report,
  verifyShaManifest,
} from '../../scripts/versegit-wp6-closeout.mjs';

describe('WP6 merged closeout', () => {
  const generatedAt = '2026-10-21T18:00:00.000Z';

  it('preserves a captured failed closeout and its non-GA and MC6 sidecar-only boundary', () => {
    const snapshotBytes = readFileSync(resolve(process.cwd(), 'tests/unit/fixtures/versegit-wp6/9a50-closeout.json'));
    expect(createHash('sha256').update(snapshotBytes).digest('hex')).toBe('93bb3c75b3c743ac5fb3eab9ab4393230cca41bbf50ed3301fb9448eaa4c911e');
    const built = JSON.parse(snapshotBytes.toString('utf8'));
    expect(built.provenance.source).toEqual({
      commit: '9a50ebdf6b08e7db3360ce399169fde2264ede78', tree: 'a345b9657f1ee93d115bc5402ef78b2735ccef7d',
    });
    expect(built.provenance.reconstruction.nativeProviderExecuted).toBe(false);
    expect(built.report.gateSummary).toMatchObject({ required: 12, verified: 12, failed: 0, deprecated: 1, optionalDecision: 1 });
    expect(built.report.requiredGates.map((gate: { role: string }) => gate.role)).toEqual(expect.arrayContaining(['MC0', 'MC1', 'MC2', 'MC3', 'MC4', 'MC5', 'WP0', 'WP1', 'WP2', 'WP3', 'WP4', 'WP5']));
    expect(built.report.evidenceManifests).toMatchObject({ count: 12, reproducible: false });
    expect(built.report.evidenceManifests.entryCount).toBe(78);
    expect(built.report.evidenceManifests.uniqueFileCount).toBe(77);
    expect(built.report.evidenceManifests.items
      .filter((manifest: { mismatches: string[] }) => manifest.mismatches.length > 0)
      .map((manifest: { path: string; mismatches: string[] }) => ({ path: manifest.path, mismatches: manifest.mismatches })))
      .toEqual([
        {
          path: 'harness/specs/fixtures/versegit-planning-correction/mc0-evidence/SHA256SUMS',
          mismatches: ['tests/unit/versegit-mc0-baseline.test.ts: expected d31b01207e07 actual b5e3538cd0d1'],
        },
        {
          path: 'harness/specs/fixtures/versegit-planning-correction/mc3-evidence/SHA256SUMS',
          mismatches: ['tests/unit/versegit-mc3-delivery.test.ts: expected 2b43c7c54523 actual 00d5b3c81ff3'],
        },
        {
          path: 'harness/specs/fixtures/versegit-planning-correction/mc4-evidence/SHA256SUMS',
          mismatches: ['electron/services/versegit-module.ts: expected 15f36a1202e2 actual d7e32f30ee7f'],
        },
        {
          path: 'harness/specs/fixtures/versegit-planning-correction/wp0-evidence/SHA256SUMS',
          mismatches: ['tests/unit/versegit-wp0-contract.test.ts: expected 0e896877a9ff actual fabc979db93a'],
        },
        {
          path: 'harness/specs/fixtures/versegit-planning-correction/wp1-evidence/SHA256SUMS',
          mismatches: ['electron/services/versegit-observation.ts: expected 120fc546cfed actual b060dca0ba83'],
        },
        {
          path: 'harness/specs/fixtures/versegit-planning-correction/wp2-evidence/SHA256SUMS',
          mismatches: [
            'electron/services/versegit-module.ts: expected 15f36a1202e2 actual d7e32f30ee7f',
            'harness/src/profiles.mjs: expected b8b2992c5836 actual 6f52c8ea3176',
            'scripts/versegit-wp2-profile.mjs: expected e058d37262c0 actual 99a551f8e23d',
            'tests/unit/versegit-wp2-profile.test.ts: expected 6d5a0b711969 actual c41c57e81cf0',
          ],
        },
        {
          path: 'harness/specs/fixtures/versegit-planning-correction/wp3-evidence/SHA256SUMS',
          mismatches: ['electron/services/versegit-receipt-bridge.ts: expected af8aebd01759 actual a379784eab4c'],
        },
      ]);
    expect(built.report.authority).toMatchObject({ hostVerdict: 'unchanged', singleGreenLight: false, liveVerseShellReceiptExecuted: false, m4Authorized: false });
    expect(built.report.release).toMatchObject({ defaultOn: false, ga: false, releaseEligible: false, packageStatus: 'rejected', binaryProfile: 'debug' });
    expect(built.report.coverage.coverageVector).toMatchObject({ shellRead: 'unobserved', directFs: 'unobserved', mcpWrite: 'unobserved', browser: 'unobserved' });
    expect(built.report.localMirrorManifests).toMatchObject({ declared: 12, requiredForCleanReplay: false });
    expect(built.report.credentialScan).toMatchObject({ status: 'passed', hits: [] });
    expect(built.report.m4.status).toBe('not_authorized');
    expect(built.report.conflictsPlan.status).toBe('unavailable');
    expect(built.mc6Decision).toMatchObject({ decision: 'sidecar-only', sourceExtractionTriggered: false, passed: true });
    expect(built.mc6Decision.migrationFiles).toEqual([]);
    expect(built.mc6Decision.triggerAssessment.find((entry: { id: string }) => entry.id === 'public-contract-stable')?.evidence).toHaveLength(2);
    expect(built.report.passed).toBe(false);
    expect(built.report.issues).toEqual(expect.arrayContaining([
      'harness/specs/fixtures/versegit-planning-correction/mc3-evidence/SHA256SUMS: 1 digest mismatch(es)',
      'harness/specs/fixtures/versegit-planning-correction/wp0-evidence/SHA256SUMS: 1 digest mismatch(es)',
      'tracked pre-closeout evidence manifests are not reproducible',
    ]));
    expect(validateWp6Report(built.report).issues).toEqual([
      'tracked pre-closeout evidence manifests are not reproducible',
      'an evidence manifest contains missing or stale files',
      'closeout did not pass or retained issues',
    ]);
    expect(validateMc6Decision(built.mc6Decision).issues).toEqual([]);
  });

  it('checks real manifest inputs and rejects missing or changed bytes', () => {
    const root = mkdtempSync(join(tmpdir(), 'wp6-manifest-'));
    try {
      const proof = join(root, 'proof.txt');
      const content = 'retained proof\n';
      const digest = createHash('sha256').update(content).digest('hex');
      writeFileSync(proof, content);
      writeFileSync(join(root, 'SHA256SUMS'), `${digest}  proof.txt\n`);
      const verify = () => verifyShaManifest({ root, path: 'SHA256SUMS', expectedPaths: ['proof.txt'] });
      expect(verify().issues).toEqual([]);
      rmSync(proof);
      expect(verify()).toMatchObject({ missing: ['proof.txt'], issues: ['SHA256SUMS: missing 1 file(s)'] });
      writeFileSync(proof, 'changed proof\n');
      expect(verify().mismatches).toHaveLength(1);
      expect(verify().issues[0]).toContain('proof.txt: expected');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects authority, release, coverage and M4 promotion', () => {
    const built = buildWp6Closeout({ generatedAt });
    const tampered = structuredClone(built.report);
    tampered.authority.singleGreenLight = true;
    tampered.release.releaseEligible = true;
    tampered.m4.status = 'authorized';
    tampered.coverage.coverageVector.directFs = 'host-event';
    tampered.coverage.requiredUnobservedSurfaces = [];
    const issues = validateWp6Report(tampered).issues;
    expect(issues).toEqual(expect.arrayContaining([
      'single green light or default-on promoted',
      'release or product posture promoted',
      'M4 authorization drifted',
      'directFs must remain unobserved',
      'unobserved surfaces removed',
    ]));
  });

  it('refuses selective extraction without measured in-process necessity', () => {
    const built = buildWp6Closeout({ generatedAt });
    const tampered = structuredClone(built.mc6Decision);
    tampered.decision = 'selective-extraction';
    tampered.sourceExtractionTriggered = true;
    tampered.migrationFiles = ['provider.rs'];
    const trigger = tampered.triggerAssessment.find((entry: { id: string }) => entry.id === 'measured-in-process-requirement');
    trigger.observed = true;
    expect(validateMc6Decision(tampered).issues).toEqual(expect.arrayContaining([
      'decision must remain sidecar-only',
      'source extraction must not be triggered',
      'migration files must remain empty',
      'in-process requirement must remain unobserved',
    ]));
  });
  it('fails closed when MC1 contract evidence required by MC6 is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'versegit-mc6-missing-'));
    try {
      const fixture = JSON.parse(readFileSync(resolve(process.cwd(), MC6_FIXTURE_PATH), 'utf8')) as { requiredEvidence: string[] };
      const targetFixture = resolve(root, MC6_FIXTURE_PATH);
      mkdirSync(dirname(targetFixture), { recursive: true });
      copyFileSync(resolve(process.cwd(), MC6_FIXTURE_PATH), targetFixture);
      for (const path of fixture.requiredEvidence.filter((entry) => !entry.includes('mc1-evidence'))) {
        const target = resolve(root, path);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(resolve(process.cwd(), path), target);
      }
      expect(() => buildMc6Decision({ root, fixturePath: targetFixture })).toThrow(/MC6 evidence missing: .*mc1-evidence/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
