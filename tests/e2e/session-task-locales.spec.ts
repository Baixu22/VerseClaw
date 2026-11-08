import { readFile, writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { addSessionChainChildren, configureSessionChainProvider, createSessionChainProject, createSessionChainTask } from './fixtures/session-task-chain';

test('project tasks and family navigation remain usable in all four interface languages', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  const llm = await startScriptedLlm(() => ({ text: 'Agent locale fixture' }));
  const app = await launchElectronApp({ skipSetup: true, deviceScaleFactor: 1 });
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-session-locales', provider: 'local-scripted', locales: [] };
  try {
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'Locale project');
    const child = (await addSessionChainChildren(app, project, 0, 1))[0];
    const task = await createSessionChainTask(app, project.workspaceId, 'locale-task', {
      objective: 'Traceable locale task', target: 'Read task and session references', constraints: ['Retain the original owner'],
      acceptance: [{ id: 'owner', description: 'Owner readback', verification: { kind: 'owner-receipt', owner: 'evidence-verifier', requires: ['test'] } }],
    });
    await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: project.workspaceId, sessionKey: project.sessionKey,
      sessionGeneration: project.generation, nodeId: task.contract.taskNodeId });
    await hostInvoke(app, 'gateway', 'rpc', { method: 'chat.inject', params: { sessionKey: project.sessionKey,
      message: 'Agent locale fixture context', label: 'agent fixture' } });
    const page = await getStableWindow(app);
    for (const language of ['en', 'zh', 'ja', 'ru']) {
      const chat = JSON.parse(await readFile(`shared/i18n/locales/${language}/chat.json`, 'utf8'));
      const ledger = JSON.parse(await readFile(`shared/i18n/locales/${language}/taskLedger.json`, 'utf8'));
      await hostInvoke(app, 'settings', 'set', { key: 'language', value: language });
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
      await expect(page.getByTestId('project-coordinator-entry')).toContainText(chat.projectEntry.coordinator.replace('{{name}}', 'Locale project'));
      await expect(page.getByTestId('session-task-container')).toHaveAttribute('data-state', 'ready');
      await expect(page.getByTestId('session-tasks-toggle')).toContainText(ledger.summary.projectTasks);
      await page.getByTestId('session-tasks-toggle').click();
      await expect(page.getByTestId('session-task-list')).toContainText(task.contract.objective);
      await expect(page.getByTestId('session-task-ledger-open')).toHaveText(ledger.summary.open);
      await page.getByTestId('session-family-children').selectOption(child);
      await expect(page.getByTestId('session-family-source')).toBeVisible();
      await expect(page.getByTestId('session-family-navigation')).toHaveAttribute('aria-label', chat.sessionFamily.navigation);
      await page.getByTestId('session-family-source').click();
      await expect(page.getByTestId('session-family-children')).toBeVisible();
      await page.getByTestId('chat-project-session-header').getByRole('button').nth(1).click();
      await page.getByTestId('chat-session-handoff').click();
      const dialog = page.getByTestId('chat-handoff-dialog');
      await expect(dialog).toContainText(chat.composer.handoff.dialogDescription);
      await expect(page.getByTestId('chat-handoff-create')).toHaveText(chat.composer.handoff.create);
      await page.screenshot({ path: testInfo.outputPath(`handoff-${language}.png`) });
      await dialog.getByRole('button', { name: chat.composer.handoff.cancel, exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`session-task-${language}.png`) });
      (evidence.locales as unknown[]).push({ language, project: project.workspaceId, session: project.sessionKey,
        child, taskNodeId: task.contract.taskNodeId, status: 'passed' });
    }
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    await writeFile(testInfo.outputPath('session-task-locales.json'), JSON.stringify(evidence, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>((resolve) => llm.server.close(() => resolve()));
  }
});
