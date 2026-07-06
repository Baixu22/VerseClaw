import { describe, expect, it } from 'vitest';

import {
  type UndeclaredWriteEvent,
  ShadowWriteEventRecorder,
  detectUndeclaredWrites,
} from '../../openclaw_runtime/src/agents/sessions/extensions/shadow-write-event-recorder';
import type { WriteRiskProfile } from '../../openclaw_runtime/src/shared/tool-registration';

/**
 * Stage 2 Stream 2C acceptance criteria:
 * - 2.7: Shadow records `undeclared_write_event` when a tool writes to a path
 *   not in `declaredWritePaths` → event recorded.
 * - 2.8: Shadow: 0 `undeclared_write_event` when all tools declare correctly.
 *
 * Run: pnpm test shadow-write-event
 */
describe('ShadowWriteEventRecorder (A1 Stage 2 Stream 2C)', () => {
  // -------------------------------------------------------------------------
  // detectUndeclaredWrites (pure function)
  // -------------------------------------------------------------------------

  describe('detectUndeclaredWrites (pure)', () => {
    it('returns empty when all actual paths are declared', () => {
      const result = detectUndeclaredWrites(['output.txt', 'logs/app.log'], [
        'output.txt',
        'logs/app.log',
      ]);
      expect(result.undeclaredPaths).toEqual([]);
      expect(result.hasUndeclared).toBe(false);
    });

    it('detects undeclared paths', () => {
      const result = detectUndeclaredWrites(['output.txt'], [
        'output.txt',
        'unexpected.txt',
      ]);
      expect(result.undeclaredPaths).toEqual(['unexpected.txt']);
      expect(result.hasUndeclared).toBe(true);
    });

    it('handles directory prefix matching (declared dir covers subdir files)', () => {
      const result = detectUndeclaredWrites(['output/'], [
        'output/file1.txt',
        'output/sub/file2.txt',
      ]);
      expect(result.undeclaredPaths).toEqual([]);
      expect(result.hasUndeclared).toBe(false);
    });

    it('handles directory prefix matching without trailing slash', () => {
      const result = detectUndeclaredWrites(['output'], [
        'output/file1.txt',
        'other/file2.txt',
      ]);
      expect(result.undeclaredPaths).toEqual(['other/file2.txt']);
    });

    it('normalizes backslashes to forward slashes (Windows compat)', () => {
      const result = detectUndeclaredWrites(['output/file.txt'], [
        'output\\file.txt',
      ]);
      expect(result.undeclaredPaths).toEqual([]);
    });

    it('case-insensitive matching (Windows compat)', () => {
      const result = detectUndeclaredWrites(['Output/File.txt'], [
        'output/file.txt',
      ]);
      expect(result.undeclaredPaths).toEqual([]);
    });

    it('returns all actual paths as undeclared when declared is empty', () => {
      const result = detectUndeclaredWrites([], ['a.txt', 'b.txt']);
      expect(result.undeclaredPaths).toEqual(['a.txt', 'b.txt']);
      expect(result.hasUndeclared).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // ShadowWriteEventRecorder
  // -------------------------------------------------------------------------

  describe('ShadowWriteEventRecorder', () => {
    // -------------------------------------------------------------------------
    // Acceptance 2.7: records undeclared_write_event
    // -------------------------------------------------------------------------

    describe('acceptance 2.7 — records undeclared_write_event', () => {
      it('records event when declared_paths tool writes outside declared paths', () => {
        const recorder = new ShadowWriteEventRecorder([
          {
            name: 'write_file',
            profile: {
              kind: 'declared_paths',
              writePaths: ['output.txt'],
            } as WriteRiskProfile,
          },
        ]);

        // Tool writes to an undeclared path.
        recorder.recordActualWrites('write_file', ['output.txt', 'unexpected.txt']);

        const events = recorder.getEvents();
        expect(events).toHaveLength(1);
        expect(events[0].toolName).toBe('write_file');
        expect(events[0].path).toBe('unexpected.txt');
        expect(events[0].declaredPaths).toEqual(['output.txt']);
        expect(typeof events[0].timestamp).toBe('number');
      });

      it('records multiple events for multiple undeclared writes', () => {
        const recorder = new ShadowWriteEventRecorder([
          {
            name: 'write_file',
            profile: {
              kind: 'declared_paths',
              writePaths: ['output.txt'],
            } as WriteRiskProfile,
          },
        ]);

        recorder.recordActualWrites('write_file', [
          'unexpected1.txt',
          'unexpected2.txt',
          'unexpected3.txt',
        ]);

        expect(recorder.getEventCount()).toBe(3);
      });

      it('records event when no_writes tool performs any write', () => {
        const recorder = new ShadowWriteEventRecorder([
          {
            name: 'readonly_tool',
            profile: { kind: 'no_writes' } as WriteRiskProfile,
          },
        ]);

        recorder.recordActualWrites('readonly_tool', ['any_file.txt']);

        const events = recorder.getEvents();
        expect(events).toHaveLength(1);
        expect(events[0].toolName).toBe('readonly_tool');
        expect(events[0].path).toBe('any_file.txt');
        expect(events[0].declaredPaths).toEqual([]);
      });

      it('records events across multiple turns (accumulates)', () => {
        const recorder = new ShadowWriteEventRecorder([
          {
            name: 'write_file',
            profile: {
              kind: 'declared_paths',
              writePaths: ['output.txt'],
            } as WriteRiskProfile,
          },
        ]);

        // Turn 1: one undeclared write.
        recorder.recordActualWrites('write_file', ['bad1.txt']);
        // Turn 2: another undeclared write.
        recorder.recordActualWrites('write_file', ['bad2.txt']);

        expect(recorder.getEventCount()).toBe(2);
      });
    });

    // -------------------------------------------------------------------------
    // Acceptance 2.8: 0 events when all tools declare correctly
    // -------------------------------------------------------------------------

    describe('acceptance 2.8 — 0 events when all tools declare correctly', () => {
      it('records 0 events when declared_paths tool writes only to declared paths', () => {
        const recorder = new ShadowWriteEventRecorder([
          {
            name: 'write_file',
            profile: {
              kind: 'declared_paths',
              writePaths: ['output.txt', 'logs/app.log'],
            } as WriteRiskProfile,
          },
        ]);

        recorder.recordActualWrites('write_file', ['output.txt', 'logs/app.log']);

        expect(recorder.getEventCount()).toBe(0);
        expect(recorder.hasEvents()).toBe(false);
      });

      it('records 0 events for dynamic_writes tool (declared dynamic)', () => {
        const recorder = new ShadowWriteEventRecorder([
          {
            name: 'shell',
            profile: {
              kind: 'dynamic_writes',
              requiresApproval: true,
            } as WriteRiskProfile,
          },
        ]);

        // dynamic_writes tools can write anywhere — never flagged.
        recorder.recordActualWrites('shell', ['any/path/here.txt', 'another.txt']);

        expect(recorder.getEventCount()).toBe(0);
      });

      it('records 0 events for pattern_writes tool (patterns accepted as-is)', () => {
        const recorder = new ShadowWriteEventRecorder([
          {
            name: 'logger',
            profile: {
              kind: 'pattern_writes',
              writePattern: '*.log',
            } as WriteRiskProfile,
          },
        ]);

        recorder.recordActualWrites('logger', ['app.log', 'debug.log']);

        expect(recorder.getEventCount()).toBe(0);
      });

      it('integration: 10-turn session with correctly-declared tools → 0 events', () => {
        // Simulate a 10-turn session with multiple tools that all declare
        // their write paths correctly.
        const recorder = new ShadowWriteEventRecorder([
          {
            name: 'write_file',
            profile: {
              kind: 'declared_paths',
              writePaths: ['output.txt', 'data.json'],
            } as WriteRiskProfile,
          },
          {
            name: 'logger',
            profile: {
              kind: 'declared_paths',
              writePaths: ['logs/'],
            } as WriteRiskProfile,
          },
          {
            name: 'shell',
            profile: {
              kind: 'dynamic_writes',
              requiresApproval: true,
            } as WriteRiskProfile,
          },
        ]);

        // 10 turns, each writing only to declared paths.
        for (let turn = 0; turn < 10; turn++) {
          recorder.recordActualWrites('write_file', ['output.txt', 'data.json']);
          recorder.recordActualWrites('logger', [`logs/turn-${turn}.log`]);
          recorder.recordActualWrites('shell', ['/tmp/scratch.txt']); // dynamic, OK
        }

        expect(recorder.getEventCount()).toBe(0);
        expect(recorder.hasEvents()).toBe(false);
      });
    });

    // -------------------------------------------------------------------------
    // clear() and utility methods
    // -------------------------------------------------------------------------

    describe('utility methods', () => {
      it('clear() removes all events', () => {
        const recorder = new ShadowWriteEventRecorder([
          {
            name: 'write_file',
            profile: {
              kind: 'declared_paths',
              writePaths: ['output.txt'],
            } as WriteRiskProfile,
          },
        ]);

        recorder.recordActualWrites('write_file', ['bad.txt']);
        expect(recorder.getEventCount()).toBe(1);

        recorder.clear();
        expect(recorder.getEventCount()).toBe(0);
        expect(recorder.hasEvents()).toBe(false);
      });

      it('getEvents() returns readonly array', () => {
        const recorder = new ShadowWriteEventRecorder([
          {
            name: 'write_file',
            profile: {
              kind: 'declared_paths',
              writePaths: ['output.txt'],
            } as WriteRiskProfile,
          },
        ]);

        recorder.recordActualWrites('write_file', ['bad.txt']);
        const events = recorder.getEvents();
        expect(Array.isArray(events)).toBe(true);
        // readonly type — should not be mutable at the type level.
        expect(events.length).toBe(1);
      });
    });
  });
});
