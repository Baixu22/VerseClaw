import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject } from './fixtures/session-collaboration';
import type { SessionCollaborationResources } from '../../shared/types/session-collaboration-resources';

test('reads the current terminal owner without closing its handle and fences the old generation', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  const provider = await startScriptedLlm(() => ({ text: 'Resource fixture ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  let terminal: { sessionId: string; sessionKey: string; workspaceId: string; expectedSessionId: string } | undefined;
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('resource-workspace'), 'Resource workspace');
    const owner = { workspaceId: project.workspaceId, sessionKey: project.sessionKey, expectedSessionId: project.generation };
    const opened = await hostInvoke<{ success: boolean; sessionId: string }>(app, 'terminal', 'open', { ...owner, keepOnLeave: true });
    expect(opened.success).toBe(true);
    terminal = { ...owner, sessionId: opened.sessionId };
    const query = { requester: project.scope, target: project.scope };
    const before = await hostInvoke<{ resources: SessionCollaborationResources }>(app, 'sessionActivity', 'resources', query);
    expect(before.resources.state).toBe('ready');
    expect(before.resources.inventory?.owners).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'terminal', authority: 'managed', generation: project.generation, sessionIds: [opened.sessionId] }),
      expect.objectContaining({ kind: 'shared-gateway', observationScope: 'shared', generation: null, count: null, rssKb: null }),
    ]));
    const old = await hostInvoke<{ resources: SessionCollaborationResources }>(app, 'sessionActivity', 'resources',
      { ...query, target: { ...query.target, sessionGeneration: 'old-generation' } });
    expect(old.resources).toMatchObject({ state: 'stale', inventory: null });
    const page = await getStableWindow(app);
    await page.reload();
    await page.getByTestId('sidebar-nav-system').click();
    await page.getByTestId(`collaboration-row-${encodeURIComponent(project.sessionKey)}`).click();
    const resources = page.getByTestId('collaboration-resources');
    await resources.locator('summary').first().press('Enter');
    await expect(resources.getByTestId('collaboration-resource-terminal')).toHaveAttribute('data-state', 'ready');
    await expect(resources.getByTestId('collaboration-resource-shared-gateway')).toBeVisible();
    const after = await hostInvoke<{ sessions: Array<{ sessionId: string }> }>(app, 'terminal', 'list', owner);
    expect(after.sessions.some(session => session.sessionId === opened.sessionId)).toBe(true);
  } finally {
    if (terminal) await hostInvoke(app, 'terminal', 'close', terminal).catch(() => {});
    await closeElectronApp(app);
    await provider.close();
  }
});
