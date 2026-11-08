// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CODING_FEATURE_FLAGS, isCodingPatchFlowDefault, isCodingSymbolLeaseEnabled,
} from '../../openclaw_runtime/src/context-engine/coding-runtime-flags';
import { recommendIsolationMode } from '../../openclaw_runtime/src/agents/isolation-mode-matrix';

describe('TF-0774 retired coding controls', () => {
  it.each([false, true])('ignores legacy config and override values %s', (enabled) => {
    const cfg = { runtime: { coding: { patchFlow: { default: enabled }, symbolLease: { enabled } } } };
    expect(isCodingPatchFlowDefault(cfg, { patchFlowDefault: enabled })).toBe(false);
    expect(isCodingSymbolLeaseEnabled(cfg, { symbolLeaseEnabled: enabled })).toBe(false);
  });
  it('keeps the existing frozen defaults', () => {
    expect(DEFAULT_CODING_FEATURE_FLAGS['runtime.coding.patchFlow.default']).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS['runtime.coding.symbolLease.enabled']).toBe(false);
    expect(DEFAULT_CODING_FEATURE_FLAGS['runtime.coding.worktree.backend']).toBe('inprocess');
  });
  it('recommends a supported path for dense concurrent coding', () => {
    expect(recommendIsolationMode({ durationMinutes: 45, workerCount: 4, writeDensity: 0.7, writeSetOverlapRisk: 0.6 }).mode).toBe('worktree');
    expect(recommendIsolationMode({ durationMinutes: 5, workerCount: 1, writeDensity: 0.1 }).mode).toBe('shared');
  });
});
