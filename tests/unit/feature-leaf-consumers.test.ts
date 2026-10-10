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
    // Spot-check leaves that must be present, including every claimed uftk gate.
    expect(leaves).toContain('coding.staleWriteGuard.enabled');
    expect(leaves).toContain('vtoken.assembly.enabled');
    expect(leaves).toContain('contextRuntimeKit.shadow');
    for (const gate of ['enabled', 'baseVersionGuard', 'auditLog', 'gitCheckpoint', 'concurrencyV2', 'execUndo', 'autoCheckpoint', 'execSideEffects', 'commandApproval']) {
      expect(leaves.some((leaf) => leaf.startsWith(`coding.uftk.${gate}`))).toBe(true);
    }
  });

  it('treats arrays and empty objects as leaves, like listLeafPaths in the source module', () => {
    expect(listLeafPaths({ a: { b: 1 }, c: [1, 2], d: {} }).sort()).toEqual(['a.b', 'c', 'd']);
  });

  it('passes on the real tree: no unpinned zero-consumer leaf', () => {
    expect(realTreeReport.errors).toEqual([]);
    expect(realTreeReport.ok).toBe(true);
    expect(realTreeReport.unpinnedZeroConsumerLeaves).toEqual([]);
    // Deliberately NOT asserting the baseline equals the observed zero-consumer
    // set: resolving #95 by re-wiring OR by deleting the dead uftk leaves must
    // both stay green, so only the check's own verdict is asserted here.
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
    // Mirrors resolving #95 by deleting the dead leaves from the schema.
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
    expect(hasConsumer('coding.uftk.execUndo.enabled', [
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
    expect(FEATURE_LEAF_CONSUMER_BASELINE.every((leaf) => leaf.includes('.coding.uftk.') || leaf.startsWith('coding.') || leaf.startsWith('contextFamily.'))).toBe(true);
    // The negative control must be reproducible in-process, not only via CLI.
    expect(runSelfTest()).toBe(true);
  });
});
