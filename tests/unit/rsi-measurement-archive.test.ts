// @vitest-environment node
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEASUREMENT_ARCHIVE_DIR, MEASUREMENT_REVALIDATION_DIR, validateMeasurementArchive } from '../../scripts/rsi-measurement-archive.mjs';
import { sha256File } from '../../scripts/rsi-tf0604-baseline.mjs';

describe('retained real-provider measurement', () => {
  it('recomputes the historic failure and the prospective controls from retained inputs', () => {
    const originalDigest = sha256File(join(MEASUREMENT_ARCHIVE_DIR, 'verification.v1.json'));
    expect(validateMeasurementArchive()).toMatchObject({ passed: true, recordedTrialSlots: 144, originalStatus: 'fail', reproducedStatus: 'fail', reanalysisStatus: 'fail', promotionReady: false });
    const current = JSON.parse(readFileSync(join(MEASUREMENT_REVALIDATION_DIR, 'verification.v2.json'), 'utf8'));
    expect(current.originalDigests['verification.v1.json']).toBe(originalDigest);
    expect(sha256File(join(MEASUREMENT_ARCHIVE_DIR, 'verification.v1.json'))).toBe(originalDigest);
    const verification = JSON.parse(readFileSync(join(MEASUREMENT_ARCHIVE_DIR, 'verification.v1.json'), 'utf8'));
    expect(verification.originalProtocol.power.requiredCasesApprox).toBe(992);
    expect(verification.decisionControls.results).toHaveLength(5);
    expect(verification.decisionControls.results.every((entry: { passed: boolean }) => entry.passed)).toBe(true);
  });

  it('rejects changed trial outcomes even when an attacker rehashes the pack', () => {
    const temp = mkdtempSync('D:/tmp/rsi-archive-test-');
    try {
      cpSync(MEASUREMENT_ARCHIVE_DIR, join(temp, MEASUREMENT_ARCHIVE_DIR), { recursive: true });
      cpSync(MEASUREMENT_REVALIDATION_DIR, join(temp, MEASUREMENT_REVALIDATION_DIR), { recursive: true });
      const verification = JSON.parse(readFileSync(join(MEASUREMENT_ARCHIVE_DIR, 'verification.v1.json'), 'utf8'));
      for (const source of Object.keys(verification.evaluatorInputHashes)) {
        mkdirSync(dirname(join(temp, source)), { recursive: true });
        copyFileSync(source, join(temp, source));
      }
      expect(validateMeasurementArchive(temp).passed).toBe(true);
      const pack = join(temp, MEASUREMENT_ARCHIVE_DIR);
      const rawPath = join(pack, 'raw-trials.v1.json');
      const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
      raw.cases[0].trials[0].outcome = 'pass';
      raw.cases[0].trials[0].failureClass = null;
      writeFileSync(rawPath, JSON.stringify(raw));
      const sums = readFileSync(join(pack, 'SHA256SUMS'), 'utf8').trim().split('\n');
      writeFileSync(join(pack, 'SHA256SUMS'), sums.map((line) => `${sha256File(join(pack, line.slice(66)))}  ${line.slice(66)}`).join('\n') + '\n');
      expect(validateMeasurementArchive(temp).errors).toContain('historical-trial-projection');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
