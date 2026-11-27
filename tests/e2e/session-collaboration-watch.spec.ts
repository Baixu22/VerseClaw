import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject } from './fixtures/session-collaboration';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { parseSessionCollaborationWatch, type SessionCollaborationWatchResult } from '../../shared/types/session-collaboration-watch';

test('scoped owner watch reads terminal, idle, cancellation, reconnect and reset without model calls', async ({ launchElectronApp }, info) => {
  test.setTimeout(240_000);
  const provider = await startScriptedLlm(() => ({ text: 'Observation has no model invocation.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('watch-project'), 'Watch project');
    const scope = project.scope;
    const query = parseSessionCollaborationQuery({ requester: scope, target: scope, limit: 1 });
    const before = await hostInvoke(app, 'workspaces', 'list'), modelCalls = provider.log.length;
    const runWatch = parseSessionCollaborationWatch({ id: 'e2e-terminal', query, condition: 'run-terminal', timeoutMs: 0,
      run: { runId: project.setupRunId, scope: { workspaceId: scope.workspaceId, projectId: scope.projectId, sessionKey: scope.sessionKey } } });
    const terminal = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', runWatch);
    expect(terminal.watch).toMatchObject({ state: 'satisfied', event: { kind: 'run-terminal', owner: 'runtime', status: 'ok' } });
    const watch = parseSessionCollaborationWatch({ id: 'e2e-idle', query, condition: 'idle', timeoutMs: 0 });
    const idle = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', watch);
    expect(idle.watch.state).toBe('satisfied'); expect(idle.watch.event?.kind).toBe('idle');
    const repeat = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', { ...watch, id: 'e2e-repeat', cursor: idle.watch.cursor });
    expect(repeat.watch.state).toBe('timeout'); expect(repeat.watch.event).toBeNull();
    const pending = hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', { ...watch, id: 'e2e-cancel', condition: 'changed', timeoutMs: 10_000 });
    await expect.poll(async () => (await hostInvoke<{ cancelled: boolean }>(app, 'sessionActivity', 'cancelWatch', { id: 'e2e-cancel', query })).cancelled).toBe(true);
    const cancelled = await pending;
    expect(cancelled.watch.state).toBe('cancelled');
    await hostInvoke(app, 'gateway', 'stop');
    const disconnected = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', { ...watch, id: 'e2e-disconnected' });
    expect(disconnected.watch).toMatchObject({ state: 'unavailable', event: null, page: { reason: 'owner-unavailable' } });
    await startGateway(app);
    const reconnected = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch',
      { ...watch, id: 'e2e-reconnected', cursor: idle.watch.cursor });
    expect(reconnected.watch).toMatchObject({ state: 'timeout', event: null });
    const missingQuery = parseSessionCollaborationQuery({ ...query, requester: { ...scope, sessionKey: 'agent:main:missing-watch-owner' } });
    const missing = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', { ...watch, id: 'e2e-owner-missing', query: missingQuery });
    expect(missing.watch).toMatchObject({ state: 'unavailable', event: null, page: { reason: 'owner-missing' } });
    const after = await hostInvoke(app, 'workspaces', 'list'); expect(after).toEqual(before); expect(provider.log.length).toBe(modelCalls);
    await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.reset', params: { key: project.sessionKey } });
    const stale = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', { ...watch, id: 'e2e-stale' });
    expect(stale.watch.state).toBe('stale'); expect(stale.watch.page.reason).toBe('generation-changed');
    await writeFile(info.outputPath('watch-owner-readbacks.json'), JSON.stringify({ driven_by: 'agent', actor: 'session-collaboration-watch',
      sourceCandidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), before, after,
      terminal, idle, repeat, cancelled, disconnected, reconnected, missing, stale,
      modelCallsBefore: modelCalls, modelCallsAfter: provider.log.length }, null, 2));
  } finally { await closeElectronApp(app); await provider.close(); }
});
