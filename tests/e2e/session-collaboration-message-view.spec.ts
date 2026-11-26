import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';
test('message view previews the original sender and clears a draft only after owner acceptance', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  const provider = await startScriptedLlm(() => ({ text: 'Message reply recorded.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const target = await createCollaborationProject(app, info.outputPath('target'), 'Message target');
    await createCollaborationProject(app, info.outputPath('source'), 'Message source'); await enableCollaborationFixtureVisibility(app);
    const page = await getStableWindow(app); await page.reload(); await page.getByTestId('sidebar-nav-system').click();
    await page.getByTestId(`collaboration-row-${encodeURIComponent(target.sessionKey)}`).click();
    const messages = page.getByTestId('collaboration-messages'); await messages.locator('summary').click();
    const draft = messages.getByTestId('collaboration-message-draft'); await expect(draft).toBeEnabled();
    await draft.fill('A scoped message from the actual current owner.');
    const taskFilter = messages.getByTestId('collaboration-message-task-filter');
    await taskFilter.selectOption(target.taskNodeId);
    await expect(taskFilter).toHaveValue(target.taskNodeId);
    await expect(draft).toHaveValue('A scoped message from the actual current owner.');
    await messages.getByTestId('collaboration-message-send').click();
    await expect(draft).toHaveValue(''); await expect(messages.getByTestId('collaboration-message-receipt')).toContainText('A scoped message from the actual current owner.');
  } finally { await closeElectronApp(app); await provider.close(); }
});
