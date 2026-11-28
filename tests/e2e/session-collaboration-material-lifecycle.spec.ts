import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject } from './fixtures/session-collaboration';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';
import { materialReference } from '../../shared/types/session-collaboration-material';

test('a selected material clears revoked contents and preserves its original owner reference', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  const provider = await startScriptedLlm(() => ({ text: 'Fixture ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('material'), 'Lifecycle project');
    const store = new TaskSystemStore(resolveTaskDomain(project.rootPath));
    try {
      const claim = store.sessionSnapshot(project.sessionKey, project.generation).task?.claim;
      if (!claim) throw new Error('Original material writer unavailable');
      const material = store.publishSharedMaterial(claim, { id: 'published', kind: 'claim', summary: 'Original lifecycle material',
        evidenceRefs: [], sensitivity: 'internal' }, 'agent-driven-publish', () => project.scope);
      const page = await getStableWindow(app);
      await page.reload();
      await page.getByTestId('sidebar-nav-system').click();
      const materials = page.getByTestId('collaboration-materials');
      await materials.locator('summary').click();
      const result = materials.getByRole('button', { name: /Original lifecycle material/ });
      await result.click();
      const detail = materials.getByTestId('collaboration-material-detail');
      await expect(detail).toHaveAttribute('data-material-state', 'claim');
      store.revokeSharedMaterial(claim, materialReference(material), 'Fixture source withdrawn', 'agent-driven-revoke', () => project.scope);
      await expect(detail).toHaveCount(0, { timeout: 35_000 });
      await expect(result).toHaveCount(0);
      expect(store.readSharedMaterial(project.scope, project.scope, materialReference(material))).toEqual(material);
      expect(store.sharedMaterialStatus(material, project.scope, Date.now()).state).toBe('revoked');
    } finally { store.close(); }
  } finally { await closeElectronApp(app); await provider.close(); }
});
