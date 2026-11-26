import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';

test('searches TaskSystem materials and reads their exact detail on selection', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  const provider = await startScriptedLlm(() => ({ text: 'Fixture session ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('materials'), 'Materials project');
    await enableCollaborationFixtureVisibility(app);
    const store = new TaskSystemStore(resolveTaskDomain(project.rootPath));
    try {
      const claim = store.sessionSnapshot(project.sessionKey, project.generation).task?.claim;
      if (!claim) throw new Error('Original material writer missing');
      store.publishSharedMaterial(claim, { id: 'fixture-result', kind: 'claim',
        summary: `Owner-backed search fixture. ${'Bounded preview '.repeat(25)}Full original summary ending.`,
        evidenceRefs: [], sensitivity: 'internal', applicability: ['Windows fixture'],
      }, 'agent-driven-material-fixture', () => project.scope);
    } finally { store.close(); }

    const source = await hostInvoke<{ source: { scope: typeof project.scope } }>(app, 'sessions', 'collaborationSender');
    expect(source.source.scope).toEqual(project.scope);
    const page = await getStableWindow(app);
    await page.reload();
    await page.getByTestId('sidebar-nav-system').click();
    const materials = page.getByTestId('collaboration-materials');
    await materials.locator('summary').click();
    const search = materials.getByTestId('collaboration-material-search');
    await search.fill('Owner-backed search fixture');
    await search.press('Enter');
    const result = materials.getByRole('button', { name: /Owner-backed search fixture/ });
    await expect(result).toBeVisible();
    await expect(result).not.toContainText('Full original summary ending.');
    await expect(materials.getByTestId('collaboration-material-detail')).toHaveCount(0);
    await result.focus();
    await result.press('Enter');
    const detail = materials.getByTestId('collaboration-material-detail');
    await expect(detail).toContainText('Full original summary ending.');
    await expect(detail).toContainText('Windows fixture');
    await expect(result).toBeFocused();
    await search.fill('A topic with no result');
    await search.press('Enter');
    await expect(result).toHaveCount(0);
    await expect(materials.getByTestId('collaboration-material-status')).not.toBeEmpty();
  } finally { await closeElectronApp(app); await provider.close(); }
});
