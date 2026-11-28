import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, createCollaborationChild, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';

test('opens inherited original material in four locales and keeps the fork an observer', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  const provider = await startScriptedLlm(() => ({ text: 'Fixture ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const source = await createCollaborationProject(app, info.outputPath('continuity'), 'Continuity project');
    await enableCollaborationFixtureVisibility(app);
    const store = new TaskSystemStore(resolveTaskDomain(source.rootPath));
    try {
      const claim = store.binding(source.sessionKey, source.generation)!.claim!;
      store.publishSharedMaterial(claim, { id: 'continuity-evidence', kind: 'claim', summary: 'Original continuity finding',
        sensitivity: 'internal', evidenceRefs: [] }, source.setupRunId, () => source.scope);
      const child = await createCollaborationChild(app, source);
      const before = store.get(source.taskNodeId).claim;
      const page = await getStableWindow(app);
      for (const [language, title] of [['en', 'Continuity and recovery'], ['zh', '连续性与恢复'], ['ja', '継続と復旧'], ['ru', 'Продолжение и восстановление']]) {
        await hostInvoke(app, 'settings', 'set', { key: 'language', value: language }); await page.reload();
        await page.setViewportSize({ width: language === 'zh' ? 420 : 1280, height: 900 });
        await page.getByTestId('sidebar-nav-system').click();
        await page.getByTestId(`collaboration-row-${encodeURIComponent(child.sessionKey)}`).click();
        const hints = page.getByTestId('collaboration-hints'); await hints.locator('summary').focus(); await hints.locator('summary').press('Enter');
        const continuity = hints.getByTestId('collaboration-continuity'); await expect(continuity.getByRole('heading')).toHaveText(title);
        await continuity.getByRole('button').filter({ hasText: 'continuity-evidence' }).click();
        await expect(continuity.getByTestId('collaboration-material-detail')).toContainText('Original continuity finding');
        await page.screenshot({ path: info.outputPath(`continuity-${language}.png`) });
      }
      expect(store.binding(child.sessionKey, child.generation)?.referenceOnly).toBe(true);
      expect(store.get(source.taskNodeId).claim).toEqual(before);
    } finally { store.close(); }
  } finally { await closeElectronApp(app); await provider.close(); }
});
