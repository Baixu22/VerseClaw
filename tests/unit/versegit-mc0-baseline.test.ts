import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectMc0Baseline, validateMc0Baseline } from '../../scripts/versegit-mc0-baseline.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
});

describe('MC0 baseline contract', () => {
  it('rejects dirty source as a deliverable baseline', () => {
    const baseline = collectMc0Baseline({ repo: 'D:/Projects/VerseGit' });
    expect(baseline.source.status).toBe('dirty');
    expect(baseline.deliverable).toBe('rejected');
    expect(baseline.blockers).toContain('source_worktree_dirty');
    expect(validateMc0Baseline(baseline).ok).toBe(true);
    expect(validateMc0Baseline(baseline, { requireDeliverable: true }).ok).toBe(false);
  });

  it('contains the source, schema, binary and golden identity', () => {
    const baseline = collectMc0Baseline({ repo: 'D:/Projects/VerseGit' });
    expect(baseline.source.head).toMatch(/^[0-9a-f]{40}$/u);
    expect(baseline.vgSchema.schema_version).toBe(1);
    expect(baseline.vgSchema.ledger_schema_version).toBe(2);
    expect(baseline.binary.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(baseline.golden.length).toBeGreaterThanOrEqual(2);
    expect(baseline.boundaries.source_tree_copied).toBe(false);
  });

  it('rejects a baseline whose dirty source is relabeled eligible', () => {
    const baseline = collectMc0Baseline({ repo: 'D:/Projects/VerseGit' });
    const mutated = structuredClone(baseline);
    mutated.deliverable = 'eligible';
    const result = validateMc0Baseline(mutated, { requireDeliverable: true });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('dirty source cannot be deliverable');
  });
});