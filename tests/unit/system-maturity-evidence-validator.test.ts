import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts/validate-system-maturity-evidence.mjs');
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
