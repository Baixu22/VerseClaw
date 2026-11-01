// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { excerptLog, validateTrialPack, TF0604_SYSTEM_RUN_DIR } from '../../scripts/lib/rsi-tf0604-system-run.mjs';

const packDir = join(process.cwd(), TF0604_SYSTEM_RUN_DIR);

function reseal(dir: string) {
  const lines = readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trimEnd().split(/\r?\n/u)
    .map((line) => line.slice(66)).filter(Boolean);
  const sums = lines.map((name) => createHash('sha256').update(readFileSync(join(dir, name))).digest('hex') + '  ' + name);
  writeFileSync(join(dir, 'SHA256SUMS'), sums.join('\n') + '\n');
}

function withCopy(mutate: (dir: string) => void) {
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
    const result = withCopy((dir: string) => {
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

describe('TF-0604 agent log excerpting', () => {
  it('keeps the head and tail with a full-digest marker instead of the whole log', () => {
    const head = Buffer.from('A'.repeat(40 * 1024));
    const tail = Buffer.from('B'.repeat(40 * 1024));
    const body = Buffer.concat([head, Buffer.from('MIDDLE'), tail]);
    const excerpt = excerptLog(body);
    expect(excerpt.length).toBeLessThan(body.length);
    expect(excerpt.length).toBeGreaterThan(64 * 1024);
    expect(excerpt.subarray(0, 16).toString()).toBe('A'.repeat(16));
    expect(excerpt.subarray(-16).toString()).toBe('B'.repeat(16));
    const text = excerpt.toString();
    expect(text).toContain('[truncated: ' + body.length + ' bytes total');
    expect(text).toMatch(/full sha256 [a-f0-9]{64}/u);
  });
});

describe('TF-0604 unscored failure sealing', () => {
  function firstScoredTrial(dir: string) {
    const progress = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
    for (const trialId of progress.completed as string[]) {
      const result = JSON.parse(readFileSync(join(dir, trialId, 'historical-result.json'), 'utf8'));
      if (['pass', 'fail', 'unknown'].includes(result.grader?.verdict) && existsSync(join(dir, trialId, 'oracle'))) return trialId;
    }
    throw new Error('pack has no scored trial with receipts');
  }

  it('accepts a recorded failure that never reached grading but still demands receipts for a scored trial', () => {
    const tracked = validateTrialPack(packDir, { root: process.cwd() });
    expect(tracked.passed).toBe(true);
    const result = withCopy((dir) => {
      rmSync(join(dir, firstScoredTrial(dir), 'oracle'), { recursive: true, force: true });
    });
    expect(result.passed).toBe(false);
    expect(result.errors.some((entry) => entry.code === 'missing-receipt')).toBe(true);
  });
});
