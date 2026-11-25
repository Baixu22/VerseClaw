import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject } from './fixtures/session-collaboration';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { parseSessionCollaborationWatch, type SessionCollaborationWatchResult } from '../../shared/types/session-collaboration-watch';

test('scoped owner watch separates idle, receipt, cancellation and reset without model calls', async ({ launchElectronApp }, info) => {
  test.setTimeout(180_000);
  const provider = await startScriptedLlm(() => ({ text: 'Observation has no model invocation.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('watch-project'), 'Watch project');
    const scope = project.scope;
    const query = parseSessionCollaborationQuery({ requester: scope, target: scope, limit: 1 });
    const before = await hostInvoke(app, 'workspaces', 'list'), modelCalls = provider.log.length;
    const watch = parseSessionCollaborationWatch({ id: 'e2e-idle', query, condition: 'idle', timeoutMs: 0 });
    const idle = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', watch);
    expect(idle.watch.state).toBe('satisfied'); expect(idle.watch.event?.kind).toBe('idle');
    const repeat = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', { ...watch, id: 'e2e-repeat', cursor: idle.watch.cursor });
    expect(repeat.watch.state).toBe('timeout'); expect(repeat.watch.event).toBeNull();
    const pending = hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', { ...watch, id: 'e2e-cancel', condition: 'changed', timeoutMs: 10_000 });
    await expect.poll(async () => (await hostInvoke<{ cancelled: boolean }>(app, 'sessionActivity', 'cancelWatch', { id: 'e2e-cancel', query })).cancelled).toBe(true);
    expect((await pending).watch.state).toBe('cancelled');
    const after = await hostInvoke(app, 'workspaces', 'list'); expect(after).toEqual(before); expect(provider.log.length).toBe(modelCalls);
    await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.reset', params: { key: project.sessionKey } });
    const stale = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', { ...watch, id: 'e2e-stale' });
    expect(stale.watch.state).toBe('stale'); expect(stale.watch.page.reason).toBe('generation-changed');
    await writeFile(info.outputPath('watch-owner-readbacks.json'), JSON.stringify({ driven_by: 'agent', actor: 'session-collaboration-watch',
      sourceCandidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), before, after, idle, repeat, stale,
      modelCallsBefore: modelCalls, modelCallsAfter: provider.log.length }, null, 2));
  } finally { await closeElectronApp(app); await provider.close(); }
});
