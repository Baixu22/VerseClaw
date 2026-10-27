// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * FP-P1-04 / TF-0577 regression: the exec tool must never fail merely because the
 * raw-output capture scratch directory cannot be created. On this Windows host
 * the gateway child cannot mkdtemp under the inherited TEMP, and the throw used
 * to abort the whole exec tool. The tool result was then never written back to
 * the transcript, so the agent turn stalled after the tool call.
 */
describe('bash raw-output capture degraded mode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns a no-op capture instead of throwing when the temp root cannot be created', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        mkdtempSync: vi.fn(() => {
          const error = new Error("EPERM: operation not permitted, mkdtemp 'D:\\\\tmp\\\\openclaw-raw-output-XXXXXX'") as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        }),
      };
    });

    const { createBashRawOutputCapture } = await import('../../openclaw_runtime/src/agents/bash-raw-output-capture');

    expect(() => createBashRawOutputCapture({ sessionId: 'session-1', itemKey: 'item-1' })).not.toThrow();

    const capture = createBashRawOutputCapture({ sessionId: 'session-1', itemKey: 'item-1' });
    expect(() => capture.append('stdout', 'hello')).not.toThrow();
    const result = capture.finalize();
    expect(result?.diagnostics.some((entry) => entry.includes('EPERM'))).toBe(true);
    expect(() => capture.dispose()).not.toThrow();
  });
});
