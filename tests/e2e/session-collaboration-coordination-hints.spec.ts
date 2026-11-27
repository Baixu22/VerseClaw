import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';

test('reads coordination hints in four locales without changing the task and opens its original entry', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  const provider = await startScriptedLlm(() => ({ text: 'Fixture ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('coordination'), 'Coordination project');
    await enableCollaborationFixtureVisibility(app);
    const page = await getStableWindow(app);
    const store = new TaskSystemStore(resolveTaskDomain(project.rootPath));
    try {
      const before = store.db.prepare('SELECT * FROM task_events ORDER BY seq').all();
      for (const [language, title] of [['en', 'Coordination hints'], ['zh', '协作提示'], ['ja', '連携のヒント'], ['ru', 'Подсказки для совместной работы']]) {
        await hostInvoke(app, 'settings', 'set', { key: 'language', value: language });
        await page.reload();
        await page.setViewportSize({ width: language === 'zh' ? 420 : 1280, height: 900 });
        await page.getByTestId('sidebar-nav-system').click();
        await page.getByTestId(`collaboration-row-${encodeURIComponent(project.sessionKey)}`).click();
        const hints = page.getByTestId('collaboration-hints');
        const summary = hints.locator('summary');
        await expect(summary).toHaveText(title);
        await summary.focus(); await summary.press('Enter');
        const link = hints.getByTestId('collaboration-hints-open-task');
        await expect(link).toHaveAttribute('href', `/task-ledger?workspaceId=${encodeURIComponent(project.workspaceId)}&nodeId=${encodeURIComponent(project.taskNodeId)}`);
        await expect(hints.getByTestId('collaboration-hints-admission')).toBeVisible();
        await page.screenshot({ path: info.outputPath(`coordination-${language}.png`) });
      }
      expect(store.db.prepare('SELECT * FROM task_events ORDER BY seq').all()).toEqual(before);
      await page.getByTestId('collaboration-hints-open-task').click();
      await expect(page).toHaveURL(/task-ledger\?/);
    } finally { store.close(); }
  } finally { await closeElectronApp(app); await provider.close(); }
});
