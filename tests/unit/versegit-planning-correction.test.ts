import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateVerseGitPlanningCorrection } from '../../scripts/validate-versegit-planning-correction.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});
function cloneRoot() {
  const root = mkdtempSync(join(tmpdir(), 'versegit-planning-'));
  roots.push(root);
  for (const dir of ['harness/specs/fixtures/versegit-planning-correction']) {
    cpSync(dir, join(root, dir), { recursive: true });
  }
  const graphDir = join(root, '.agent-workbench/task-forest/graph');
  mkdirSync(graphDir, { recursive: true });
  const implementationIds = [
    'TF-0466','TF-0467','TF-0468','TF-0469','TF-0470','TF-0471','TF-0472',
    'TF-0473','TF-0474','TF-0475','TF-0476','TF-0477','TF-0478','TF-0479',
  ];
  const nodes = Object.fromEntries(implementationIds.map((id) => [id, { id, status: id === 'TF-0479' ? 'proposed' : 'done' }]));
  Object.assign(nodes, {
    'TF-0465': { id: 'TF-0465', status: 'in_progress' },
    'TF-0480': { id: 'TF-0480', status: 'deprecated' },
    'TF-0481': { id: 'TF-0481', status: 'done' },
  });
  const requiredEdges = [
    ['TF-0466','TF-0476'], ['TF-0478','TF-0466'], ['TF-0477','TF-0478'],
    ['TF-0467','TF-0477'], ['TF-0468','TF-0477'], ['TF-0469','TF-0477'],
  ];
  const edges = Object.fromEntries(requiredEdges.map(([from, to], index) => [`synthetic-${index}`, {
    id: `synthetic-${index}`, from, to, type: 'depends_on',
  }]));
  writeFileSync(join(graphDir, 'forest.json'), `${JSON.stringify({ nodes, edges, status_queues: { ready: [] } }, null, 2)}\n`, 'utf8');
  return root;
}
function rewrite(root: string, relative: string, edit: (value: any) => void) {
  const path = join(root, relative);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  edit(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('verseGit planning correction contract', () => {
  it('accepts the checked-in bundle and live graph', () => {
    expect(validateVerseGitPlanningCorrection({ root: cloneRoot() })).toMatchObject({ ok: true, issues: [] });
  });
  it('rejects a live-graph bypass edge', () => {
    const root = cloneRoot();
    rewrite(root, '.agent-workbench/task-forest/graph/forest.json', (value) => {
      value.edges['fixture-bypass'] = { id: 'fixture-bypass', from: 'TF-0478', to: 'TF-0477', type: 'depends_on' };
    });
    const result = validateVerseGitPlanningCorrection({ root });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('dag: live graph contains forbidden TF-0478->TF-0477');
  });
  it('rejects treating existing doctor as pure diagnostic', () => {
    const root = cloneRoot();
    rewrite(root, 'harness/specs/fixtures/versegit-planning-correction/m1-effect-matrix.json', (value) => {
      value.existing_cli.find((entry: any) => entry.entry === 'doctor').pure_diagnostic = true;
    });
    const result = validateVerseGitPlanningCorrection({ root });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('m1: existing doctor must be non-pure');
  });
  it('rejects a receipt without plan connectivity', () => {
    const root = cloneRoot();
    rewrite(root, 'harness/specs/fixtures/versegit-planning-correction/execution-receipt-contract.json', (value) => {
      value.required_bindings = value.required_bindings.filter((binding: string) => binding !== 'planDigest');
    });
    const result = validateVerseGitPlanningCorrection({ root });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('receipt: missing planDigest');
  });
  it('rejects an execution node that still points only at the planning verifier', () => {
    const root = cloneRoot();
    rewrite(root, 'harness/specs/fixtures/versegit-planning-correction/node-acceptance-matrix.json', (value) => {
      value.nodes.find((entry: any) => entry.id === 'TF-0473').executionVerifier = 'scripts/validate-versegit-planning-correction.mjs --node TF-0473';
    });
    const result = validateVerseGitPlanningCorrection({ root });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('node:TF-0473: planning verifier cannot serve as execution verifier');
  });
  it('rejects a missing per-node fixture', () => {
    const root = cloneRoot();
    rmSync(join(root, 'harness/specs/fixtures/versegit-planning-correction/mc0-baseline-fixture.json'), { force: true });
    const result = validateVerseGitPlanningCorrection({ root });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('node:TF-0473: fixture not found mc0-baseline-fixture.json');
  });
});
