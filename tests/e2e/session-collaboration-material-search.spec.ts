import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { TaskSystemStore } from '../../shared/task-system/store';

type MaterialReadGate = { waiting: boolean; returned: boolean; release?: () => void };

test('searches TaskSystem materials and reads their exact detail on selection', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  const provider = await startScriptedLlm(() => ({ text: 'Fixture session ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    await createCollaborationProject(app, info.outputPath('earlier-project'), 'Earlier project');
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
    await app.evaluate(({ ipcMain }) => {
      type Request = { module: string; action: string; payload?: { ref?: unknown } };
      const handlers = (ipcMain as unknown as {
        _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<unknown>>;
      })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      const gate: MaterialReadGate = { waiting: false, returned: false };
      (globalThis as unknown as { __materialReadGate: MaterialReadGate }).__materialReadGate = gate;
      handlers.set('host:invoke', async (event, request) => {
        const response = await original(event, request);
        if (request.module === 'sessions' && request.action === 'collaborationMaterials' && request.payload?.ref) {
          handlers.set('host:invoke', original);
          gate.waiting = true;
          await new Promise<void>(resolve => { gate.release = resolve; });
          gate.returned = true;
        }
        return response;
      });
    });
    await result.focus();
    await result.press('Enter');
    await expect.poll(() => app.evaluate(() =>
      (globalThis as unknown as { __materialReadGate: MaterialReadGate }).__materialReadGate.waiting)).toBe(true);
    await materials.locator('summary').click();
    await app.evaluate(() => (globalThis as unknown as { __materialReadGate: MaterialReadGate }).__materialReadGate.release!());
    await expect.poll(() => app.evaluate(() =>
      (globalThis as unknown as { __materialReadGate: MaterialReadGate }).__materialReadGate.returned)).toBe(true);
    await materials.locator('summary').click();
    const detail = materials.getByTestId('collaboration-material-detail');
    await expect(detail).toContainText('Full original summary ending.');
    await expect(detail).toContainText('Windows fixture');
    await expect(materials.locator('summary')).toBeFocused();
    await search.fill('A topic with no result');
    await search.press('Enter');
    await expect(result).toHaveCount(0);
    await expect(materials.getByTestId('collaboration-material-status')).not.toBeEmpty();
  } finally { await closeElectronApp(app); await provider.close(); }
});
