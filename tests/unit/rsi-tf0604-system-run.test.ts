// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateTrialPack, TF0604_SYSTEM_RUN_DIR } from '../../scripts/lib/rsi-tf0604-system-run.mjs';

const packDir = join(process.cwd(), TF0604_SYSTEM_RUN_DIR);

function reseal(dir) {
  const lines = readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trimEnd().split(/\r?\n/u)
    .map((line) => line.slice(66)).filter(Boolean);
  const sums = lines.map((name) => createHash('sha256').update(readFileSync(join(dir, name))).digest('hex') + '  ' + name);
  writeFileSync(join(dir, 'SHA256SUMS'), sums.join('\n') + '\n');
}

function withCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'tf0604-pack-'));
  cpSync(packDir, dir, { recursive: true });
  mutate(dir);
  const result = validateTrialPack(dir, { root: process.cwd() });
  rmSync(dir, { recursive: true, force: true });
  return result;
}

describe('TF-0604 real trial-run pack readback', () => {
  it('recomputes every seal from disk on the tracked pack', () => {
    const result = validateTrialPack(packDir, { root: process.cwd() });
    expect(result.passed).toBe(true);
    expect(result.expectedTrials).toBe(144);
    expect(result.manifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('rejects a tampered result payload (digest mismatch)', () => {
    const result = withCopy((dir) => {
      const progress = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
      const file = join(dir, progress.completed[0], 'historical-result.json');
      const body = JSON.parse(readFileSync(file, 'utf8'));
      body.grader.verdict = 'pass';
      writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
    });
    expect(result.passed).toBe(false);
    expect(result.errors.some((entry) => entry.code === 'digest-mismatch')).toBe(true);
  });

  it('rejects an unclassified failure even when the sums are re-sealed', () => {
    const result = withCopy((dir) => {
      const progress = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
      const file = join(dir, progress.completed[0], 'historical-result.json');
      const body = JSON.parse(readFileSync(file, 'utf8'));
      body.failureClass = 'bogus';
      body.grader.verdict = 'fail';
      writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
      reseal(dir);
    });
    expect(result.passed).toBe(false);
    expect(result.errors.some((entry) => entry.code === 'unclassified-failure')).toBe(true);
  });
});
