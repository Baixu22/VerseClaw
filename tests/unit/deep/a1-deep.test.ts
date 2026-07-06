import { describe, expect, it } from 'vitest';

import {
  type WriteRiskProfile,
  DEFAULT_WRITE_RISK_PROFILE,
  MissingWriteRiskProfileError,
  assertWriteRiskProfileForTool,
  requiresApproval,
  requiresFullFsDiff,
  validateWriteRiskProfile,
} from '../../../openclaw_runtime/src/shared/tool-registration.js';
import {
  beginSnapshot,
  collectDeclaredWritePaths,
} from '../../../openclaw_runtime/src/agents/sessions/extensions/policy-light-snapshotter.js';
import {
  ShadowWriteEventRecorder,
  detectUndeclaredWrites,
} from '../../../openclaw_runtime/src/agents/sessions/extensions/shadow-write-event-recorder.js';

/**
 * A1 deep tests — Layered Execution Isolation.
 *
 * Covers three source modules:
 * - shared/tool-registration.ts (WriteRiskProfile enforcement)
 * - sessions/extensions/policy-light-snapshotter.ts (declared-path collection + snapshot)
 * - sessions/extensions/shadow-write-event-recorder.ts (undeclared-write detection)
 *
 * Note on import depth: tests live in tests/unit/deep/, so the relative path to
 * the runtime tree is ../../../openclaw_runtime/src/... (three levels up to root).
 */

describe('A1 deep — tool-registration / policy-light-snapshotter / shadow-write-event-recorder', () => {
  // -------------------------------------------------------------------------
  // 1. 功能完整性 (4 tests)
  // -------------------------------------------------------------------------
  describe('功能完整性', () => {
    it('requiresFullFsDiff returns false for no_writes / declared_paths / pattern_writes', () => {
      expect(requiresFullFsDiff({ kind: 'no_writes' })).toBe(false);
      expect(requiresFullFsDiff({ kind: 'declared_paths', writePaths: ['a.txt'] })).toBe(false);
      expect(requiresFullFsDiff({ kind: 'pattern_writes', writePattern: '*.log' })).toBe(false);
    });

    it('requiresFullFsDiff returns true only for dynamic_writes', () => {
      expect(requiresFullFsDiff({ kind: 'dynamic_writes', requiresApproval: true })).toBe(true);
    });

    it('requiresApproval returns false for no_writes / declared_paths / pattern_writes', () => {
      expect(requiresApproval({ kind: 'no_writes' })).toBe(false);
      expect(requiresApproval({ kind: 'declared_paths', writePaths: ['a.txt'] })).toBe(false);
      expect(requiresApproval({ kind: 'pattern_writes', writePattern: '*.log' })).toBe(false);
    });

    it('requiresApproval returns true for dynamic_writes and DEFAULT_WRITE_RISK_PROFILE', () => {
      expect(requiresApproval({ kind: 'dynamic_writes', requiresApproval: true })).toBe(true);
      expect(requiresApproval(DEFAULT_WRITE_RISK_PROFILE)).toBe(true);
      expect(DEFAULT_WRITE_RISK_PROFILE.kind).toBe('dynamic_writes');
    });
  });

  // -------------------------------------------------------------------------
  // 2. 边界条件 (5 tests)
  // -------------------------------------------------------------------------
  describe('边界条件', () => {
    it('declared_paths with an empty writePaths array fails validation', () => {
      const error = validateWriteRiskProfile({ kind: 'declared_paths', writePaths: [] });
      expect(error).not.toBeNull();
      expect(error).toContain('writePaths');
    });

    it('declared_paths without a writePaths field fails validation', () => {
      expect(validateWriteRiskProfile({ kind: 'declared_paths' })).not.toBeNull();
    });

    it('pattern_writes without a writePattern (or empty) fails validation', () => {
      expect(validateWriteRiskProfile({ kind: 'pattern_writes' })).not.toBeNull();
      expect(validateWriteRiskProfile({ kind: 'pattern_writes', writePattern: '' })).toContain(
        'writePattern',
      );
    });

    it('collectDeclaredWritePaths with empty input returns empty declared paths and dynamic tools', () => {
      const result = collectDeclaredWritePaths([]);
      expect(result.declaredPaths).toEqual([]);
      expect(result.dynamicTools).toEqual([]);
    });

    it('collectDeclaredWritePaths with mixed kinds separates declared paths from dynamic tools', () => {
      const result = collectDeclaredWritePaths([
        { name: 'readonly', profile: { kind: 'no_writes' } },
        { name: 'writer', profile: { kind: 'declared_paths', writePaths: ['a.txt', 'b.txt'] } },
        { name: 'patterner', profile: { kind: 'pattern_writes', writePattern: '*.log' } },
        { name: 'dynamic', profile: { kind: 'dynamic_writes', requiresApproval: true } },
      ]);
      // Patterns are folded into declaredPaths (git-diff interprets them); no_writes contributes nothing.
      expect(result.declaredPaths).toEqual(['a.txt', 'b.txt', '*.log']);
      expect(result.dynamicTools).toEqual(['dynamic']);
    });
  });

  // -------------------------------------------------------------------------
  // 3. 错误路径 (5 tests)
  // -------------------------------------------------------------------------
  describe('错误路径', () => {
    it('assertWriteRiskProfileForTool does not throw for readonly + undefined profile', () => {
      expect(() => assertWriteRiskProfileForTool('readonly', undefined)).not.toThrow();
      expect(() => assertWriteRiskProfileForTool('readonly', { kind: 'no_writes' })).not.toThrow();
    });

    it('assertWriteRiskProfileForTool throws MissingWriteRiskProfileError (field="writeRiskProfile") for write + undefined', () => {
      try {
        assertWriteRiskProfileForTool('write', undefined);
        throw new Error('expected assertWriteRiskProfileForTool to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MissingWriteRiskProfileError);
        expect((err as MissingWriteRiskProfileError).field).toBe('writeRiskProfile');
      }
    });

    it('assertWriteRiskProfileForTool throws for destructive + declared_paths (destructive requires dynamic_writes)', () => {
      expect(() =>
        assertWriteRiskProfileForTool('destructive', {
          kind: 'declared_paths',
          writePaths: ['a.txt'],
        }),
      ).toThrow(MissingWriteRiskProfileError);
    });

    it('validateWriteRiskProfile returns the required-message for null input', () => {
      expect(validateWriteRiskProfile(null)).toBe(
        'writeRiskProfile is required for write-capable tools',
      );
    });

    it('validateWriteRiskProfile returns errors for non-object input and missing-kind input', () => {
      expect(validateWriteRiskProfile('not-an-object')).toBe(
        'writeRiskProfile is required for write-capable tools',
      );
      expect(validateWriteRiskProfile({})).toMatch(/kind must be one of/);
    });
  });

  // -------------------------------------------------------------------------
  // 4. 属性测试 (3 tests)
  // -------------------------------------------------------------------------
  describe('属性测试', () => {
    it('dynamic_writes tools never produce undeclared write events (recorder short-circuits)', () => {
      // The dynamic_writes short-circuit lives in ShadowWriteEventRecorder, not the
      // pure detectUndeclaredWrites (which has no profile notion and only compares paths).
      const recorder = new ShadowWriteEventRecorder([
        { name: 'dyn', profile: { kind: 'dynamic_writes', requiresApproval: true } },
      ]);
      recorder.recordActualWrites('dyn', [
        'anywhere/file.txt',
        'another/path.ts',
        'x/y/z.json',
      ]);
      expect(recorder.getEvents()).toEqual([]);
      expect(recorder.hasEvents()).toBe(false);
    });

    it('no_writes scenario flags every actual write as undeclared (pure detectUndeclaredWrites with empty declared set)', () => {
      const result = detectUndeclaredWrites([], ['a.txt', 'dir/b.txt']);
      expect(result.hasUndeclared).toBe(true);
      expect(result.undeclaredPaths).toEqual(['a.txt', 'dir/b.txt']);
    });

    it('detectUndeclaredWrites normalizes backslashes to forward slashes and matches case-insensitively', () => {
      // Declared 'Output/File.txt' should cover 'output\file.txt' and 'OUTPUT\FILE.TXT'
      // (normalizePath: backslash -> forward slash, lowercase).
      const result = detectUndeclaredWrites(
        ['Output/File.txt'],
        ['output\\file.txt', 'OUTPUT\\FILE.TXT'],
      );
      expect(result.undeclaredPaths).toEqual([]);
      expect(result.hasUndeclared).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 5. 并发测试 (3 tests)
  // -------------------------------------------------------------------------
  describe('并发测试', () => {
    it('interleaved recordActualWrites calls for different tools do not interfere', () => {
      const recorder = new ShadowWriteEventRecorder([
        { name: 'w1', profile: { kind: 'declared_paths', writePaths: ['only-w1.txt'] } },
        { name: 'w2', profile: { kind: 'declared_paths', writePaths: ['only-w2.txt'] } },
      ]);
      // Two "workers" recording writes in interleaved order.
      recorder.recordActualWrites('w1', ['only-w1.txt', 'leak-to-w2.txt']);
      recorder.recordActualWrites('w2', ['only-w2.txt', 'leak-to-w1.txt']);
      const events = recorder.getEvents();
      const w1Paths = events.filter((e) => e.toolName === 'w1').map((e) => e.path);
      const w2Paths = events.filter((e) => e.toolName === 'w2').map((e) => e.path);
      expect(w1Paths).toEqual(['leak-to-w2.txt']);
      expect(w2Paths).toEqual(['leak-to-w1.txt']);
    });

    it('clear() empties recorded events', () => {
      const recorder = new ShadowWriteEventRecorder([
        { name: 'nw', profile: { kind: 'no_writes' } },
      ]);
      recorder.recordActualWrites('nw', ['a.txt']);
      expect(recorder.hasEvents()).toBe(true);
      recorder.clear();
      expect(recorder.getEvents()).toEqual([]);
      expect(recorder.hasEvents()).toBe(false);
      expect(recorder.getEventCount()).toBe(0);
    });

    it('getEventCount and hasEvents stay consistent across mutations', () => {
      const recorder = new ShadowWriteEventRecorder([
        { name: 'nw', profile: { kind: 'no_writes' } },
      ]);
      expect(recorder.getEventCount()).toBe(0);
      expect(recorder.hasEvents()).toBe(false);
      recorder.recordActualWrites('nw', ['a', 'b', 'c']);
      expect(recorder.getEventCount()).toBe(3);
      expect(recorder.hasEvents()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 6. 压力测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('压力测试', () => {
    it('collectDeclaredWritePaths handles 1000 declared paths under 50ms', () => {
      const tools = Array.from({ length: 1000 }, (_, i) => ({
        name: `tool-${i}`,
        profile: {
          kind: 'declared_paths' as const,
          writePaths: [`path-${i}.txt`],
        },
      }));
      const start = Date.now();
      const result = collectDeclaredWritePaths(tools);
      const elapsed = Date.now() - start;
      expect(result.declaredPaths.length).toBe(1000);
      expect(elapsed).toBeLessThan(50);
    });

    it('ShadowWriteEventRecorder processes 10000 actual writes without crashing', () => {
      const recorder = new ShadowWriteEventRecorder([
        { name: 'nw', profile: { kind: 'no_writes' } },
      ]);
      const paths = Array.from({ length: 10000 }, (_, i) => `file-${i}.txt`);
      expect(() => recorder.recordActualWrites('nw', paths)).not.toThrow();
      expect(recorder.getEventCount()).toBe(10000);
    });
  });

  // -------------------------------------------------------------------------
  // 7. 集成测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('集成测试', () => {
    it('assertWriteRiskProfileForTool simulates a realistic tool registration flow (and beginSnapshot flag-off parity)', async () => {
      // readonly tool without a profile -> pass.
      expect(() => assertWriteRiskProfileForTool('readonly', undefined)).not.toThrow();
      // write tool with dynamic_writes -> pass.
      expect(() =>
        assertWriteRiskProfileForTool('write', {
          kind: 'dynamic_writes',
          requiresApproval: true,
        } satisfies WriteRiskProfile),
      ).not.toThrow();
      // destructive tool with dynamic_writes -> pass.
      expect(() =>
        assertWriteRiskProfileForTool('destructive', {
          kind: 'dynamic_writes',
          requiresApproval: true,
        } satisfies WriteRiskProfile),
      ).not.toThrow();
      // S2 fix (P0): write tool with no_writes profile is now REJECTED
      // (semantic incompatibility — write-capable tool cannot declare no_writes).
      expect(() => assertWriteRiskProfileForTool('write', { kind: 'no_writes' })).toThrow(
        MissingWriteRiskProfileError,
      );

      // beginSnapshot flag-off parity: with a1 disabled it returns a no-op handle
      // without touching the filesystem or git (covers beginSnapshot / SnapshotHandle / SnapshotPlan).
      const snap = await beginSnapshot([], { workspaceRoot: '.', a1Enabled: false });
      expect(snap.ok).toBe(true);
      if (snap.ok) {
        expect(typeof snap.handle.commit).toBe('function');
        expect(snap.handle.plan.mode).toBe('copy-on-write');
        expect(snap.handle.plan.declaredWritePaths).toEqual([]);
      }
    });

    it('MissingWriteRiskProfileError is an Error subclass and carries field="writeRiskProfile"', () => {
      const err = new MissingWriteRiskProfileError('boom');
      expect(err).toBeInstanceOf(Error);
      expect(err.field).toBe('writeRiskProfile');
      expect(err.name).toBe('MissingWriteRiskProfileError');

      // A thrown instance preserves the prototype chain.
      try {
        assertWriteRiskProfileForTool('write', undefined);
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(MissingWriteRiskProfileError);
      }
    });
  });
});
