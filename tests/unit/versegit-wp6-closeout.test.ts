import { describe, expect, it } from 'vitest';
import {
  buildWp6Closeout,
  validateMc6Decision,
  validateWp6Report,
} from '../../scripts/versegit-wp6-closeout.mjs';

describe('WP6 merged closeout', () => {
  const generatedAt = '2026-10-21T18:00:00.000Z';

  it('aggregates every gate while preserving the non-GA and MC6 sidecar-only boundary', () => {
    const built = buildWp6Closeout({ generatedAt });
    expect(built.report.gateSummary).toMatchObject({ required: 12, verified: 12, failed: 0, deprecated: 1, optionalDecision: 1 });
    expect(built.report.requiredGates.map((gate: { role: string }) => gate.role)).toEqual(expect.arrayContaining(['MC0', 'MC1', 'MC2', 'MC3', 'MC4', 'MC5', 'WP0', 'WP1', 'WP2', 'WP3', 'WP4', 'WP5']));
    expect(built.report.evidenceManifests).toMatchObject({ count: 24, reproducible: true });
    expect(built.report.evidenceManifests.entryCount).toBeGreaterThan(100);
    expect(built.report.authority).toMatchObject({ hostVerdict: 'unchanged', singleGreenLight: false, liveVerseShellReceiptExecuted: false, m4Authorized: false });
    expect(built.report.release).toMatchObject({ defaultOn: false, ga: false, releaseEligible: false, packageStatus: 'rejected', binaryProfile: 'debug' });
    expect(built.report.coverage.coverageVector).toMatchObject({ shellRead: 'unobserved', directFs: 'unobserved', mcpWrite: 'unobserved', browser: 'unobserved' });
    expect(built.report.m4.status).toBe('not_authorized');
    expect(built.report.conflictsPlan.status).toBe('unavailable');
    expect(built.mc6Decision).toMatchObject({ decision: 'sidecar-only', sourceExtractionTriggered: false, passed: true });
    expect(built.mc6Decision.migrationFiles).toEqual([]);
    expect(built.report.passed).toBe(true);
    expect(built.report.issues).toEqual([]);
    expect(validateWp6Report(built.report).issues).toEqual([]);
    expect(validateMc6Decision(built.mc6Decision).issues).toEqual([]);
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
      'in-process requirement must remain unmeasured',
    ]));
  });
});
