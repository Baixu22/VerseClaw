import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject } from './fixtures/session-collaboration';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import type { SessionCollaborationUsage } from '../../shared/types/session-collaboration-usage';

test('keeps usage scopes separate and opens model usage on demand', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  const provider = await startScriptedLlm(() => ({ text: 'Agent-driven usage fixture.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('usage-workspace'), 'Usage workspace');
    const domain = resolveTaskDomain(project.rootPath);
    const run = normalizeRunScope({ runId: 'agent-fixture-usage-run', scope: project.scope });
    const writer = new TaskSystemStore(domain, Date.now, { domain, assertCurrent: () => {}, resolveRelated: resolveTaskDomain,
      runProvenance: () => ({ run }) });
    try {
      const claim = writer.sessionSnapshot(project.sessionKey, project.generation).task?.claim;
      if (!claim) throw new Error('TaskSystem fixture claim is unavailable');
      writer.beginModelCall(claim, { callId: 'agent-fixture-call', runId: run.runId, provider: 'fixture', model: 'coordination-fixture',
        attemptIndex: 1, category: 'coordination' });
      writer.recordModelUsage(claim, 'agent-fixture-call', { terminal: 'done', usage: { input: 8, output: 4, cacheRead: 2, cacheWrite: 1, total: 15 },
        costUsd: 0.001, priceVersion: 'fixture-price-v1', endedAt: Date.now(), toolCallIdHashes: [] });
    } finally { writer.close(); }

    const response = await hostInvoke<{ usage: SessionCollaborationUsage }>(app, 'sessionActivity', 'modelUsage',
      { requester: project.scope, target: project.scope });
    expect(response.usage).toMatchObject({ session: { owner: 'session-transcript', state: 'ready' },
      task: { owner: 'TaskSystem', state: 'ready', value: { coordination: { calls: 1, totalTokens: 15 } } },
      run: { owner: 'TaskSystem', state: 'ready', value: { run, totals: { totalTokens: 15 } } },
    });
    const page = await getStableWindow(app);
    await page.reload();
    await page.getByTestId('sidebar-nav-system').click();
    await page.getByTestId(`collaboration-row-${encodeURIComponent(project.sessionKey)}`).click();
    const section = page.getByTestId('collaboration-model-usage');
    await expect(section.locator('summary').first()).toBeVisible();
    await expect(section.getByTestId('collaboration-model-usage-session')).toHaveCount(0);
    await section.locator('summary').first().focus();
    await section.locator('summary').first().press('Enter');
    await expect(section.getByTestId('collaboration-model-usage-session')).toBeVisible();
    await expect(section.getByTestId('collaboration-model-usage-task')).toBeVisible();
    await expect(section.getByTestId('collaboration-model-usage-run')).toContainText(run.runId);
    await section.locator('details').last().locator('summary').click();
    await expect(section.getByTestId('collaboration-model-call').filter({ hasText: 'coordination-fixture' })).toContainText('fixture-price-v1');
  } finally { await closeElectronApp(app); await provider.close(); }
});
