import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  FEATURE_LEAF_CONSUMER_BASELINE,
  RUNTIME_FEATURE_LEAVES_SOURCE,
  checkFeatureLeafConsumers,
  extractRuntimeFeatureLeaves,
  hasConsumer,
  listLeafPaths,
  runSelfTest,
} from '../../scripts/check-feature-leaf-consumers.mjs';

// Vitest runs with the repo root as cwd; resolve explicitly so the scan is
// independent of the module URL scheme.
const repoRoot = resolve(process.cwd());
const realLeafSource = readFileSync(join(repoRoot, RUNTIME_FEATURE_LEAVES_SOURCE), 'utf8');

/**
 * Positive control on the real tree. Scanned once: the heuristic walks ~5k
 * source files, so repeating it per assertion would dominate the suite.
 */
const realTreeReport = checkFeatureLeafConsumers({ root: repoRoot });

/** Minimal synthetic consumer corpus; `alpha` is consumed, `beta` is not. */
const syntheticSources = [
  { path: 'openclaw_runtime/src/consumer.ts', text: 'const gate = cfg.runtime?.alpha?.enabled === true;' },
];

describe('check-feature-leaf-consumers', () => {
  it('enumerates the runtime feature leaves from the real machine-readable source', () => {
    const leaves = extractRuntimeFeatureLeaves(realLeafSource);
    expect(leaves.length).toBeGreaterThan(100);
    // Deterministic ordering and no duplicates.
    expect(leaves).toEqual([...leaves].sort());
    expect(new Set(leaves).size).toBe(leaves.length);
    // Spot-check live leaves, and lock in the issue #95 removal: the dead
    // `coding.uftk` subtree must not reappear in the tree without a consumer
    // (re-adding it would fail this assertion and the guard's fatal condition).
    expect(leaves).toContain('coding.staleWriteGuard.enabled');
    expect(leaves).toContain('vtoken.assembly.enabled');
    expect(leaves).toContain('contextRuntimeKit.shadow');
    expect(leaves.some((leaf) => leaf.startsWith('coding.uftk.'))).toBe(false);
  });

  it('treats arrays and empty objects as leaves, like listLeafPaths in the source module', () => {
    expect(listLeafPaths({ a: { b: 1 }, c: [1, 2], d: {} }).sort()).toEqual(['a.b', 'c', 'd']);
  });

  it('passes on the real tree: no unpinned zero-consumer leaf', () => {
    expect(realTreeReport.errors).toEqual([]);
    expect(realTreeReport.ok).toBe(true);
    expect(realTreeReport.unpinnedZeroConsumerLeaves).toEqual([]);
    // Deliberately NOT asserting the baseline equals the observed zero-consumer
    // set: a future wiring OR removal of a pinned leaf must both stay green, so
    // only the check's own verdict is asserted here.
    expect(realTreeReport.leafCount).toBeGreaterThan(100);
  });

  it('treats a pinned leaf that gained a consumer as informational and stays green', () => {
    const report = checkFeatureLeafConsumers({
      leafPaths: ['alpha.enabled'],
      sources: syntheticSources,
      baseline: ['alpha.enabled'],
    });
    expect(report.ok).toBe(true);
    expect(report.baselineLeavesNowConsumed).toEqual(['alpha.enabled']);
  });

  it('treats a pinned leaf that no longer exists as informational and stays green', () => {
    // This is how issue #95 resolved the uftk debt: the leaves were deleted, so
    // the stale pins must not fail a check that never owned the removal.
    const report = checkFeatureLeafConsumers({
      leafPaths: ['alpha.enabled'],
      sources: syntheticSources,
      baseline: ['alpha.enabled', 'ghost.leaf.enabled'],
    });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.staleBaselineEntries).toEqual(['ghost.leaf.enabled']);
  });

  it('fails closed on a NEW leaf with no consumer, naming the leaf', () => {
    const report = checkFeatureLeafConsumers({
      leafPaths: ['alpha.enabled', 'beta.enabled'],
      sources: syntheticSources,
      baseline: ['alpha.enabled'],
    });
    expect(report.ok).toBe(false);
    expect(report.unpinnedZeroConsumerLeaves).toEqual(['beta.enabled']);
    expect(report.errors.join('\n')).toContain('beta.enabled');
    expect(report.errors.join('\n')).toContain('no visible consumer');
  });

  it('stays green when the same new leaf is wired to a real reader', () => {
    const report = checkFeatureLeafConsumers({
      leafPaths: ['alpha.enabled', 'beta.enabled'],
      sources: [
        ...syntheticSources,
        { path: 'openclaw_runtime/src/beta-consumer.ts', text: 'if (cfg.runtime?.beta?.enabled) { run(); }' },
      ],
      baseline: ['alpha.enabled'],
    });
    expect(report.ok).toBe(true);
    expect(report.unpinnedZeroConsumerLeaves).toEqual([]);
  });

  it('does not treat a generic gate word alone as evidence of consumption', () => {
    expect(hasConsumer('demoFeature.execUndo.enabled', [
      { path: 'c.ts', text: 'const enabled = true; const shadow = false;' },
    ])).toBe(false);
  });

  it('flags a brand-new leaf with no consumer even under a well-known parent', () => {
    const report = checkFeatureLeafConsumers({
      leafPaths: ['resilience.brandNewUnwiredPilot'],
      sources: [{ path: 'openclaw_runtime/src/resilience/reader.ts', text: 'const p = cfg.runtime?.resilience?.anomalyClassifierPilot;' }],
      baseline: [],
    });
    expect(report.ok).toBe(false);
    expect(report.unpinnedZeroConsumerLeaves).toEqual(['resilience.brandNewUnwiredPilot']);
  });

  it('shares the frozen production baseline and self-test with the CLI', () => {
    expect(FEATURE_LEAF_CONSUMER_BASELINE.length).toBeGreaterThan(0);
    // The uftk debt was resolved by removal (#95); no pin may name it again.
    expect(FEATURE_LEAF_CONSUMER_BASELINE.some((leaf) => leaf.includes('.coding.uftk.'))).toBe(false);
    expect(FEATURE_LEAF_CONSUMER_BASELINE.every((leaf) => leaf.startsWith('coding.') || leaf.startsWith('contextFamily.'))).toBe(true);
    // The negative control must be reproducible in-process, not only via CLI.
    expect(runSelfTest()).toBe(true);
  });
});
