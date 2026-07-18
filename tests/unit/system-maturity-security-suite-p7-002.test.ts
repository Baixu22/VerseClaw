import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  planSecuritySuite,
  runSecuritySuite,
  validateSecuritySuiteManifest,
  validateSecuritySuiteReport,
} from '../../scripts/lib/system-maturity-security-suite.mjs';

function write(root: string, relative: string, content = '') {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'clawx-p7-security-'));
  write(root, 'tests/unit/security.test.ts', 'export {};\n');
  const manifest = {
    schemaVersion: 1,
    modes: ['pr', 'full'],
    scenarios: [{
      id: 'SM-P0-ONE',
      priority: 'P0',
      owner: 'qa-governance',
      findings: ['F-SEC-001'],
      commandIds: ['unit'],
      testFiles: ['tests/unit/security.test.ts'],
      expected: 'deny',
    }],
    commands: [
      { id: 'unit', modes: ['pr', 'full'], kind: 'unit', run: 'test tests/unit/security.test.ts' },
      { id: 'replay', modes: ['full'], kind: 'comms-replay', run: 'test replay' },
      { id: 'compare', modes: ['full'], kind: 'comms-compare', run: 'test compare' },
      { id: 'e2e', modes: ['full'], kind: 'electron-e2e', run: 'test e2e' },
    ],
  };
  return { root, manifest };
}

describe('P7-002 security regression suite', () => {
  it('registers every P0/P1 scenario in PR mode with real tests', () => {
    const { root, manifest } = fixture();
    expect(validateSecuritySuiteManifest({ root, manifest })).toEqual([]);
    expect(planSecuritySuite({ root, manifest, mode: 'pr' })).toMatchObject({
      errors: [],
      scenarios: [{ id: 'SM-P0-ONE' }],
      commands: [{ id: 'unit' }],
    });
  });

  it('fails missing commands and empty selections', () => {
    const { root, manifest } = fixture();
    manifest.scenarios[0].commandIds = ['missing'];
    expect(validateSecuritySuiteManifest({ root, manifest }).join('\n')).toContain('missing command missing');
    expect(planSecuritySuite({ root, manifest: { ...manifest, scenarios: [] }, mode: 'pr' }).errors.join('\n')).toContain('selected no scenarios');
  });

  it('returns non-zero evidence when an underlying command fails', () => {
    const { root, manifest } = fixture();
    const outDir = join(root, 'artifacts');
    const report = runSecuritySuite({
      root,
      manifest,
      mode: 'pr',
      outDir,
      runCommand: () => ({ status: 9, stdout: 'no\n', stderr: 'denied\n' }),
    });
    expect(report.ok).toBe(false);
    expect(report.failedCommandIds).toEqual(['unit']);
    expect(validateSecuritySuiteReport({ root, outDir, report })).toContain('report is not successful');
  });

  it('detects tampered captured output in an otherwise successful report', () => {
    const { root, manifest } = fixture();
    const outDir = join(root, 'artifacts');
    const report = runSecuritySuite({
      root,
      manifest,
      mode: 'pr',
      outDir,
      runCommand: () => ({ status: 0, stdout: 'ok\n', stderr: '' }),
    });
    expect(report.ok).toBe(true);
    writeFileSync(join(outDir, report.commands[0].stdoutPath), 'tampered\n');
    expect(validateSecuritySuiteReport({ root, outDir, report }).join('\n')).toContain('stdout hash mismatch');
  });

  it('keeps the checked-in suite manifest structurally valid', () => {
    const root = process.cwd();
    const manifest = JSON.parse(readFileSync(join(root, 'plans/system-maturity/security-regression-suite.json'), 'utf8'));
    expect(validateSecuritySuiteManifest({ root, manifest })).toEqual([]);
    const ids = manifest.scenarios.map((scenario: { id: string }) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(createHash('sha256').update(JSON.stringify(ids)).digest('hex')).toHaveLength(64);
  });
});
