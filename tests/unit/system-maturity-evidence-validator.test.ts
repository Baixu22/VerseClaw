import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts/validate-system-maturity-evidence.mjs');
const fixtureRoots: string[] = [];
afterEach(() => {
  for (const fixtureRoot of fixtureRoots.splice(0)) {
    const relative = path.relative(tmpdir(), fixtureRoot);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('fixture escaped temp directory');
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
const probeOutputs = [
  'validate-system-maturity-evidence.json',
  'evidence-index.json',
].map((name) => path.join(root, 'artifacts/system-maturity/P4--EVIDENCE', name));

function run(args: string[] = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  expect(probeOutputs.some((output) => existsSync(output))).toBe(false);
  return result;
}

describe('system-maturity evidence validator', () => {
  it.each([
    ['passed', 'done', 0],
    ['pass', 'done', 0],
    ['failed', 'done', 1],
    ['not-run', 'done', 1],
    ['failed', 'in_progress', 0],
  ] as const)('checks %s acceptance against %s delivery with a valid evidence hash', (result, status, exitCode) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'clawx-matrix-validator-'));
    fixtureRoots.push(fixture);
    for (const file of ['scripts/validate-system-maturity-evidence.mjs', 'scripts/lib/canonical-evidence-hash.mjs']) {
      const target = path.join(fixture, file);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(root, file), target);
    }
    const phase = path.join(fixture, 'plans/system-maturity/phase-fixture');
    mkdirSync(path.join(phase, 'tasks'), { recursive: true });
    writeFileSync(path.join(phase, 'STATUS.json'), JSON.stringify({ phase: 'phase-fixture', tasks: { 'P6-005': status } }));
    writeFileSync(path.join(phase, 'tasks/P6-005.md'), '# Fixture\n- [x] A1: acceptance\n');
    const evidencePath = 'artifacts/system-maturity/P6-005/acceptance-matrix.json';
    mkdirSync(path.dirname(path.join(fixture, evidencePath)), { recursive: true });
    const matrix = JSON.stringify({ taskId: 'P6-005', acceptance: [{ id: 'A1', status: result }] });
    writeFileSync(path.join(fixture, evidencePath), matrix);
    const hash = createHash('sha256').update(matrix).digest('hex');
    writeFileSync(path.join(phase, 'tasks/P6-005.delivery.md'), `TASK_ID: P6-005\nSTATUS: ${status}\nTESTS: fixture\nRESULTS: see matrix\nEVIDENCE: ${evidencePath}#sha256=${hash}\nACCEPTANCE: A1\n`);
    const actual = spawnSync(process.execPath, [path.join(fixture, 'scripts/validate-system-maturity-evidence.mjs')], { cwd: fixture, encoding: 'utf8' });
    expect(actual.status, actual.stdout + actual.stderr).toBe(exitCode);
    if (exitCode !== 0) expect(actual.stderr).toContain('A3 P6-005 done but acceptance matrix has unpassed criteria');
  });

  it('hash-tamper probe fails closed without ReferenceError', () => {
    const result = run(['--probe=hash-tamper', '--task-prefix=P4-']);
    expect(result.status).not.toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toMatch(/sha256File is not defined/);
    expect(combined).toMatch(/hash mismatch|FAILED/i);
  });

  it('missing-file probe fails closed without ReferenceError', () => {
    const result = run(['--probe=missing-file', '--task-prefix=P4-']);
    expect(result.status).not.toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toMatch(/sha256File is not defined/);
    expect(combined).toMatch(/missing|FAILED/i);
  });
});
