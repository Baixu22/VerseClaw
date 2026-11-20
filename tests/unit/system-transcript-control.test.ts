// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranscriptsTool } from '../../openclaw_runtime/src/agents/tools/transcripts-tool';
import { executeManagedTaskTool } from '../../openclaw_runtime/src/agents/execution-checkout-tools';

const provider = vi.hoisted(() => ({ stop: vi.fn(async () => ({ ok: true })),
  start: vi.fn(async (request: { session: unknown }) => ({ ok: true, session: request.session })) }));
vi.mock('../../openclaw_runtime/src/transcripts/provider-registry', () => ({
  getTranscriptSourceProvider: () => ({ id: 'fixture-capture', ...provider }), listTranscriptSourceProviders: () => [],
}));
vi.mock('../../openclaw_runtime/src/config/sessions/store', () => ({ getSessionEntry: ({ sessionKey }: { sessionKey: string }) => ({ sessionId: `g-${sessionKey}` }) }));
afterEach(() => { vi.unstubAllEnvs(); provider.stop.mockClear(); provider.start.mockClear(); });
describe('global pause transcript ownership', () => {
  it('hides foreign captures and refuses foreign stop while allowing the original owner during pause', async () => {
    const root = mkdtempSync(join(tmpdir(), 's2-transcript-owner-'));
    const tool = (sessionKey: string) => createTranscriptsTool({ stateDir: root, config: { transcripts: { enabled: true } },
      owner: { sessionKey, generation: `g-${sessionKey}`, workspace: `D:/${sessionKey}` } });
    const a = tool('alpha'), b = tool('beta');
    try {
      const started = await a.execute('start', { action: 'start', providerId: 'fixture-capture' });
      const sessionId = (started.details as { sessionId: string }).sessionId;
      const path = join(root, 'workspaces.json');
      writeFileSync(path, JSON.stringify({ systemControl: { revision: 1, paused: true, inFlightPolicy: 'settle-admitted-effects', recentRequests: [] } }));
      vi.stubEnv('CLAWX_WORKSPACE_OWNER_PATH', path);
      const invoke = (target: typeof a, action: string) => executeManagedTaskTool(undefined, null, action, 'transcripts', { action, sessionId }, undefined,
        () => target.execute(action, { action, sessionId }));
      expect((await invoke(b, 'status')).details).toMatchObject({ active: [] });
      await expect(invoke(b, 'stop')).rejects.toThrow('TRANSCRIPTS_CAPTURE_OWNER_MISMATCH');
      expect(provider.stop).not.toHaveBeenCalled();
      expect((await invoke(a, 'stop')).details).toMatchObject({ sessionId });
      expect(provider.stop).toHaveBeenCalledOnce();
      await expect(tool('alpha').execute('stale', { action: 'summarize', sessionId: 'missing' })).rejects.toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
