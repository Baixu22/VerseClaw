import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateVerseGitPlanningCorrection } from '../../scripts/validate-versegit-planning-correction.mjs';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
});

function createTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'versegit-planning-correction-'));
  temporaryRoots.push(root);
  cpSync('harness/specs/fixtures/versegit-planning-correction', join(root, 'harness/specs/fixtures/versegit-planning-correction'), { recursive: true });
  return root;
}

describe('validateVerseGitPlanningCorrection', () => {
  it('accepts the checked-in planning contract bundle', () => {
    const result = validateVerseGitPlanningCorrection();
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('resolves a requested node contract', () => {
    const result = validateVerseGitPlanningCorrection({ node: 'TF-0478' });
    expect(result.ok).toBe(true);
    expect(result.node).toBe('TF-0478');
  });

  it('rejects a missing required DAG edge', () => {
    const root = createTemporaryRoot();
    const path = join(root, 'harness/specs/fixtures/versegit-planning-correction/planning-contract.json');
    const value = JSON.parse(readFileSync(path, 'utf8')) as { dag: { required_edges: Array<{ from: string; to: string }> } };
    value.dag.required_edges = value.dag.required_edges.filter((edge) => !(edge.from === 'TF-0477' && edge.to === 'TF-0478'));
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    const result = validateVerseGitPlanningCorrection({ root });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('dag: missing required edge TF-0477->TF-0478');
  });

  it('rejects a pure diagnostic entry with a forbidden effect', () => {
    const root = createTemporaryRoot();
    const path = join(root, 'harness/specs/fixtures/versegit-planning-correction/m1-effect-matrix.json');
    const value = JSON.parse(readFileSync(path, 'utf8')) as { entries: Array<{ entry: string; effects: Record<string, boolean> }> };
    const capabilities = value.entries.find((entry) => entry.entry === 'capabilities');
    if (!capabilities) throw new Error('missing capabilities fixture');
    capabilities.effects.execute = true;
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    const result = validateVerseGitPlanningCorrection({ root });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('m1:capabilities: pure diagnostic entry has a forbidden effect');
  });

  it('rejects a missing receipt binding', () => {
    const root = createTemporaryRoot();
    const path = join(root, 'harness/specs/fixtures/versegit-planning-correction/execution-receipt-contract.json');
    const value = JSON.parse(readFileSync(path, 'utf8')) as { required_bindings: string[] };
    value.required_bindings = value.required_bindings.filter((binding) => binding !== 'candidateId');
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    const result = validateVerseGitPlanningCorrection({ root });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('receipt: missing binding candidateId');
  });
});