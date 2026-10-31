// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { classifyOracleBindings, gitBlob } from '../../scripts/lib/rsi-oracle-bindings.mjs';
import { historicalTaskDefect } from '../../scripts/lib/agent-first-trials.mjs';
import { buildTaskCorpus, validateTaskCorpus } from '../../scripts/lib/rsi-historical-task-corpus.mjs';

const root = process.cwd();
let repo = '';

const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
let marker = 0;
const commit = (message: string) => {
  writeFileSync(join(repo, '.marker'), String((marker += 1)));
  git(['add', '-A']);
  git(['commit', '-q', '-m', message]);
  return git(['rev-parse', 'HEAD']);
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'rsi-oracle-repo-'));
  git(['init', '-q', '--initial-branch=main', '.']);
  git(['config', 'user.email', 'rsi@example.invalid']);
  git(['config', 'user.name', 'rsi fixture']);
  writeFileSync(join(repo, 'app.ts'), 'export const value = 1;\n');
  writeFileSync(join(repo, 'guard.test.ts'), "import { expect, it } from 'vitest';\nit('pre-existing guard', () => expect(1).toBe(1));\n");
  commit('base');
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('sealed oracle binding classification', () => {
  it('separates introduced and modified assertions from pre-existing guards', () => {
    const base = git(['rev-parse', 'HEAD']);
    writeFileSync(join(repo, 'hidden.test.ts'), "import { expect, it } from 'vitest';\nit('hidden signal', () => expect(1).toBe(1));\n");
    writeFileSync(join(repo, 'app.ts'), 'export const value = 2;\n');
    const reference = commit('reference');

    const introduced = classifyOracleBindings(repo, ['hidden.test.ts'], base, reference);
    expect(introduced.hiddenSignalPaths).toEqual(['hidden.test.ts']);
    expect(introduced.preexistingGuardPaths).toEqual([]);

    const modified = classifyOracleBindings(repo, ['app.ts'], base, reference);
    expect(modified.hiddenSignalPaths).toEqual(['app.ts']);

    const guard = classifyOracleBindings(repo, ['guard.test.ts'], base, reference);
    expect(guard.preexistingGuardPaths).toEqual(['guard.test.ts']);
    expect(guard.hiddenSignalPaths).toEqual([]);

    const mixed = classifyOracleBindings(repo, ['guard.test.ts', 'hidden.test.ts'], base, reference);
    expect(mixed.hiddenSignalPaths).toEqual(['hidden.test.ts']);
    expect(mixed.preexistingGuardPaths).toEqual(['guard.test.ts']);
  });

  it('fails closed when an oracle path is absent at the reference revision', () => {
    const base = git(['rev-parse', 'HEAD']);
    const reference = commit('no new work');
    expect(() => classifyOracleBindings(repo, ['never-existed.test.ts'], base, reference)).toThrow(/missing at reference revision/u);
  });

  it('only treats a task as defective when no hidden signal exists', () => {
    const task = {
      id: 'demo',
      oracle: { testPaths: ['guard.test.ts'], hiddenSignalPaths: [] },
      referenceSolution: { baseCommit: 'a'.repeat(40), referenceCommit: 'b'.repeat(40) },
    };
    expect(historicalTaskDefect(task)).toMatch(/no hidden oracle signal/u);
    expect(historicalTaskDefect({ ...task, oracle: { ...task.oracle, hiddenSignalPaths: ['hidden.test.ts'] } })).toBeNull();
    expect(historicalTaskDefect({ ...task, referenceSolution: { baseCommit: null, referenceCommit: 'b'.repeat(40) } })).toMatch(/no base revision/u);
    expect(historicalTaskDefect({ ...task, oracle: { testPaths: [], hiddenSignalPaths: ['x'] } })).toMatch(/no sealed oracle test paths/u);
  });

  it('corpus validation rejects a stripped or inconsistent hidden-signal binding', () => {
    const corpus = buildTaskCorpus(root);
    expect(validateTaskCorpus(corpus, root).passed).toBe(true);

    const stripped = structuredClone(corpus);
    stripped.tasks[0].oracle.hiddenSignalPaths = [];
    expect(validateTaskCorpus(stripped, root).errors).toContain(`oracle-no-hidden-signal:${corpus.tasks[0].id}`);

    const overlap = structuredClone(corpus);
    const target = overlap.tasks.find((task) => task.oracle.preexistingGuardPaths.length > 0)!;
    target.oracle.preexistingGuardPaths = [...new Set([...target.oracle.preexistingGuardPaths, ...target.oracle.hiddenSignalPaths])];
    expect(validateTaskCorpus(overlap, root).errors.some((error) => error.startsWith('oracle-binding-overlap:'))).toBe(true);

    const withGuard = corpus.tasks.find((task) => task.oracle.preexistingGuardPaths.length > 0)!;
    const dropped = structuredClone(corpus);
    dropped.tasks.find((task) => task.id === withGuard.id)!.oracle.preexistingGuardPaths = [];
    expect(validateTaskCorpus(dropped, root).errors.some((error) => error.startsWith('oracle-binding-coverage:'))).toBe(true);
  });

  it('every frozen task keeps at least one hidden assertion and never overlaps guards', () => {
    const corpus = buildTaskCorpus(root);
    for (const task of corpus.tasks) {
      expect(task.oracle.hiddenSignalPaths.length).toBeGreaterThan(0);
      expect(historicalTaskDefect(task)).toBeNull();
      expect(new Set([...task.oracle.hiddenSignalPaths, ...task.oracle.preexistingGuardPaths]).size).toBe(task.oracle.testPaths.length);
    }
  });

  it('reads a blob identity from git and null for absent paths', () => {
    const head = git(['rev-parse', 'HEAD']);
    expect(gitBlob(repo, head, 'app.ts')).toMatch(/^[a-f0-9]{40}$/u);
    expect(gitBlob(repo, head, 'missing.ts')).toBeNull();
    expect(readFileSync(join(repo, 'app.ts'), 'utf8').length).toBeGreaterThan(0);
    expect(existsSync(join(repo, '.git'))).toBe(true);
  });
});
