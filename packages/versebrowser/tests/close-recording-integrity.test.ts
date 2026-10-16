import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { TimelineWriter } from '../src/evidence/timeline.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

it('close reports a recording-save failure and preserves the recorder and browser for retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-close-recording-'));
  const close = vi.fn(async () => ({ success: true }));
  const facade = new AgentBrowserFacade({ evidenceRoot: root, api: {
    getConsoleMessages: async () => ({ success: true, content: '' }), close,
  } as unknown as AgentBrowserHostApi });
  const stop = vi.spyOn(TimelineWriter.prototype, 'stop').mockRejectedValueOnce(new Error('recording disk failure'));
  try {
    expect((await facade.recordStart('s')).ok).toBe(true);
    expect(await facade.close('s')).toMatchObject({ ok: false, error: { code: 'E_CLOSE', message: 'recording disk failure' } });
    expect(close).not.toHaveBeenCalled();
    stop.mockRestore();
    expect((await facade.close('s')).ok).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    stop.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
