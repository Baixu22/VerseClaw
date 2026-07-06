import { describe, expect, it } from 'vitest';

import {
  type ToolRiskLevel,
  type WriteRiskProfile,
  MissingWriteRiskProfileError,
  assertWriteRiskProfileForTool,
  requiresApproval,
  requiresFullFsDiff,
  validateWriteRiskProfile,
} from '../../openclaw_runtime/src/shared/tool-registration';

/**
 * Stage 2 acceptance 2.2 — Tool registration rejects undeclared write tools.
 *
 * The `assertWriteRiskProfileForTool` function is the enforcement seam called
 * by `registerTool` in loader.ts. When a write/destructive tool lacks a valid
 * `writeRiskProfile`, it must throw `MissingWriteRiskProfileError` with a named
 * field (`field='writeRiskProfile'`).
 *
 * Run: pnpm test tool-registration
 */
describe('assertWriteRiskProfileForTool (A1 Stage 2 acceptance 2.2)', () => {
  // -------------------------------------------------------------------------
  // readonly tools: profile optional
  // -------------------------------------------------------------------------

  describe('readonly tools', () => {
    it('passes with no profile (omitted)', () => {
      expect(() => assertWriteRiskProfileForTool('readonly', undefined)).not.toThrow();
    });

    it('passes with no_writes profile', () => {
      const profile: WriteRiskProfile = { kind: 'no_writes' };
      expect(() => assertWriteRiskProfileForTool('readonly', profile)).not.toThrow();
    });

    it('passes even with a declared_paths profile (harmless override)', () => {
      const profile: WriteRiskProfile = { kind: 'declared_paths', writePaths: ['x.txt'] };
      expect(() => assertWriteRiskProfileForTool('readonly', profile)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // write tools: profile REQUIRED
  // -------------------------------------------------------------------------

  describe('write tools (profile required)', () => {
    it('throws MissingWriteRiskProfileError when profile is undefined', () => {
      try {
        assertWriteRiskProfileForTool('write', undefined);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MissingWriteRiskProfileError);
        expect((err as MissingWriteRiskProfileError).field).toBe('writeRiskProfile');
        expect((err as MissingWriteRiskProfileError).message).toContain('required');
      }
    });

    it('throws when profile is null', () => {
      try {
        assertWriteRiskProfileForTool('write', null);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MissingWriteRiskProfileError);
        expect((err as MissingWriteRiskProfileError).field).toBe('writeRiskProfile');
      }
    });

    it('passes with declared_paths profile', () => {
      const profile: WriteRiskProfile = { kind: 'declared_paths', writePaths: ['out.txt'] };
      expect(() => assertWriteRiskProfileForTool('write', profile)).not.toThrow();
    });

    it('passes with pattern_writes profile', () => {
      const profile: WriteRiskProfile = { kind: 'pattern_writes', writePattern: '*.log' };
      expect(() => assertWriteRiskProfileForTool('write', profile)).not.toThrow();
    });

    it('passes with dynamic_writes profile', () => {
      const profile: WriteRiskProfile = { kind: 'dynamic_writes', requiresApproval: true };
      expect(() => assertWriteRiskProfileForTool('write', profile)).not.toThrow();
    });

    it('throws when declared_paths has empty writePaths array', () => {
      const invalid = { kind: 'declared_paths', writePaths: [] };
      try {
        assertWriteRiskProfileForTool('write', invalid);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MissingWriteRiskProfileError);
        expect((err as MissingWriteRiskProfileError).field).toBe('writeRiskProfile');
      }
    });

    it('throws when pattern_writes has empty writePattern', () => {
      const invalid = { kind: 'pattern_writes', writePattern: '' };
      expect(() => assertWriteRiskProfileForTool('write', invalid)).toThrow(
        MissingWriteRiskProfileError,
      );
    });

    it('throws when dynamic_writes lacks requiresApproval=true', () => {
      const invalid = { kind: 'dynamic_writes', requiresApproval: false };
      expect(() => assertWriteRiskProfileForTool('write', invalid)).toThrow(
        MissingWriteRiskProfileError,
      );
    });

    it('throws when kind is invalid', () => {
      const invalid = { kind: 'unknown_kind' };
      expect(() => assertWriteRiskProfileForTool('write', invalid)).toThrow(
        MissingWriteRiskProfileError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // destructive tools: profile REQUIRED + must be dynamic_writes
  // -------------------------------------------------------------------------

  describe('destructive tools (must be dynamic_writes)', () => {
    it('throws when profile is undefined', () => {
      try {
        assertWriteRiskProfileForTool('destructive', undefined);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MissingWriteRiskProfileError);
        expect((err as MissingWriteRiskProfileError).field).toBe('writeRiskProfile');
      }
    });

    it('passes with dynamic_writes profile', () => {
      const profile: WriteRiskProfile = { kind: 'dynamic_writes', requiresApproval: true };
      expect(() => assertWriteRiskProfileForTool('destructive', profile)).not.toThrow();
    });

    it('throws when profile is declared_paths (not dynamic_writes)', () => {
      const profile: WriteRiskProfile = {
        kind: 'declared_paths',
        writePaths: ['x.txt'],
      };
      try {
        assertWriteRiskProfileForTool('destructive', profile);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MissingWriteRiskProfileError);
        expect((err as MissingWriteRiskProfileError).field).toBe('writeRiskProfile');
        expect((err as MissingWriteRiskProfileError).message).toContain('dynamic_writes');
      }
    });

    it('throws when profile is pattern_writes (not dynamic_writes)', () => {
      const profile: WriteRiskProfile = { kind: 'pattern_writes', writePattern: '*.log' };
      expect(() => assertWriteRiskProfileForTool('destructive', profile)).toThrow(
        MissingWriteRiskProfileError,
      );
    });

    it('throws when profile is no_writes (not dynamic_writes)', () => {
      const profile: WriteRiskProfile = { kind: 'no_writes' };
      expect(() => assertWriteRiskProfileForTool('destructive', profile)).toThrow(
        MissingWriteRiskProfileError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Named field error (acceptance 0.4)
  // -------------------------------------------------------------------------

  describe('named field error', () => {
    it('MissingWriteRiskProfileError has field="writeRiskProfile"', () => {
      try {
        assertWriteRiskProfileForTool('write', undefined);
        throw new Error('expected throw');
      } catch (err) {
        const e = err as MissingWriteRiskProfileError;
        expect(e.field).toBe('writeRiskProfile');
        expect(e.name).toBe('MissingWriteRiskProfileError');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Helper functions
  // -------------------------------------------------------------------------

  describe('helper functions', () => {
    it('requiresFullFsDiff returns true only for dynamic_writes', () => {
      expect(requiresFullFsDiff({ kind: 'dynamic_writes', requiresApproval: true })).toBe(true);
      expect(requiresFullFsDiff({ kind: 'no_writes' })).toBe(false);
      expect(requiresFullFsDiff({ kind: 'declared_paths', writePaths: ['x'] })).toBe(false);
      expect(requiresFullFsDiff({ kind: 'pattern_writes', writePattern: '*.log' })).toBe(false);
    });

    it('requiresApproval returns true only for dynamic_writes with requiresApproval=true', () => {
      expect(requiresApproval({ kind: 'dynamic_writes', requiresApproval: true })).toBe(true);
      expect(requiresApproval({ kind: 'no_writes' })).toBe(false);
      expect(requiresApproval({ kind: 'declared_paths', writePaths: ['x'] })).toBe(false);
    });

    it('validateWriteRiskProfile returns null for valid profiles', () => {
      expect(validateWriteRiskProfile({ kind: 'no_writes' })).toBeNull();
      expect(
        validateWriteRiskProfile({ kind: 'declared_paths', writePaths: ['x.txt'] }),
      ).toBeNull();
      expect(validateWriteRiskProfile({ kind: 'pattern_writes', writePattern: '*.log' })).toBeNull();
      expect(
        validateWriteRiskProfile({ kind: 'dynamic_writes', requiresApproval: true }),
      ).toBeNull();
    });

    it('validateWriteRiskProfile returns error message for invalid profiles', () => {
      expect(validateWriteRiskProfile(undefined)).toContain('required');
      expect(validateWriteRiskProfile(null)).toContain('required');
      expect(validateWriteRiskProfile({ kind: 'declared_paths', writePaths: [] })).toContain(
        'writePaths',
      );
      expect(validateWriteRiskProfile({ kind: 'pattern_writes', writePattern: '' })).toContain(
        'writePattern',
      );
      expect(validateWriteRiskProfile({ kind: 'dynamic_writes' })).toContain('requiresApproval');
      expect(validateWriteRiskProfile({ kind: 'unknown' })).toContain('must be one of');
    });
  });
});
