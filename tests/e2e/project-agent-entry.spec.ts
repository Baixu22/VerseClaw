import { writeFile } from 'node:fs/promises';
import type { TaskLedgerSnapshot } from '../../shared/types/task-ledger';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { addSessionChainChildren, configureSessionChainProvider, createSessionChainProject, observeSessionUi, setSessionChainViewport } from './fixtures/session-task-chain';

test('project entry keeps its coordinator, task scope and session drafts while disclosure only folds the list', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  const llm = await startScriptedLlm(() => ({ text: 'Agent-driven discussion response.' }));
  const app = await launchElectronApp({ skipSetup: true, deviceScaleFactor: 1 });
  const captureUi = await observeSessionUi(app);
  const observations: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-project-entry', provider: 'local-scripted' };
  try {
    await expect((await getStableWindow(app)).getByTestId('main-layout')).toBeVisible({ timeout: 10_000 });
    await configureSessionChainProvider(app, llm.port);
    const a = await createSessionChainProject(app, testInfo.outputPath('project-a'), 'Project A');
    const child = (await addSessionChainChildren(app, a, 0, 1))[0];
    const grandchild = (await addSessionChainChildren(app, { ...a, sessionKey: child }, 0, 1))[0];
    const artifact = testInfo.outputPath('project-a', 'task-result.txt');
    await writeFile(artifact, 'Verified task result remains navigable.\n');
    const created = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'createNode', {
      workspaceId: a.workspaceId, node: { title: 'Project A existing task', kind: 'task', status: 'done',
        description: 'Validate the recorded result before accepting the task.', evidenceRefs: [{ type: 'file', ref: artifact, label: 'Task result file' }] },
    });
    const task = created.snapshot.nodes.find((node) => node.kind === 'task')!;
    await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: a.workspaceId, sessionKey: a.sessionKey,
      nodeId: task.id, sessionGeneration: a.generation });
    await hostInvoke(app, 'workspaces', 'saveState', { id: a.workspaceId, sessionKey: a.sessionKey, state: { draftInput: 'Source draft preserved' } });
    const b = await createSessionChainProject(app, testInfo.outputPath('project-b'), 'Project B');
    const page = await getStableWindow(app); await page.reload();
    await expect(page.getByTestId(`sidebar-project-open-${a.workspaceId}`)).toBeVisible({ timeout: 30_000 });
    const disclosure = page.getByTestId(`sidebar-session-project-toggle-${a.workspaceId}`);
    const previousUrl = page.url();
    await disclosure.click();
    expect(page.url()).toBe(previousUrl);
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.click();
    await page.getByTestId(`sidebar-project-open-${a.workspaceId}`).click();
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Project A');
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Source draft preserved');
    await page.getByTestId('session-tasks-toggle').click();
    await expect(page.getByTestId('session-task-list')).toContainText(task.title);
    await page.getByTestId(`session-task-select-${task.id}`).click();
    await expect(page.getByTestId(`session-task-select-${task.id}`)).toHaveText('Selected');
    await page.getByTestId('session-task-list').getByRole('link', { name: task.title }).click();
    await expect(page).toHaveURL(new RegExp(`workspaceId=${a.workspaceId}`));
    await expect(page.getByTestId('task-ledger-tree')).toContainText(task.title);
    await page.getByTestId(`task-ledger-evidence-${task.id}`).getByRole('button', { name: 'Task result file' }).click();
    await expect(page.getByText('Verified task result remains navigable.', { exact: false })).toBeVisible();
    await page.getByTestId('artifact-panel-tab-close-files').click();
    await page.getByTestId('session-tasks-toggle').click();
    await page.getByTestId('session-task-list').getByRole('link', { name: task.title }).click();
    await page.getByTestId('task-ledger-return-session').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Source draft preserved');
    expect(await setSessionChainViewport(app, { width: 960, height: 800 })).toEqual({ width: 960, height: 800 });
    await page.getByTestId('session-tasks-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('session-task-drawer')).toBeVisible();
    await expect(page.getByTestId('session-task-drawer')).toContainText(task.title);
    await page.screenshot({ path: testInfo.outputPath('task-drawer-keyboard.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('session-tasks-toggle')).toBeFocused();
    await setSessionChainViewport(app, { width: 1280, height: 800 });
    await page.getByTestId('session-family-children').selectOption(child);
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Child 1 draft');
    await page.getByTestId('chat-composer-input').fill('Child edited draft');
    await page.getByTestId('session-family-children').selectOption(grandchild);
    await page.getByTestId('session-family-relations').locator('summary').click();
    await expect(page.getByTestId('session-family-relations')).toContainText('Project A coordinator');
    await page.getByTestId('session-family-source').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Child edited draft');
    await page.getByTestId('session-family-source').click();
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Source draft preserved');
    await page.getByTestId(`sidebar-project-open-${b.workspaceId}`).click();
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Project B');
    await expect(page.getByTestId('session-task-container')).toHaveAttribute('data-state', 'empty');
    await expect(page.getByText(task.title, { exact: true })).toHaveCount(0);
    await page.getByTestId(`sidebar-project-open-${a.workspaceId}`).click();
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Project A');
    await expect(page.getByTestId('chat-composer-input')).toHaveValue('Source draft preserved');
    const after = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId: a.workspaceId });
    expect(after.snapshot.nodes.find((node) => node.id === task.id)?.status).toBe('done');
    observations.projects = { a, b, child, grandchild, taskId: task.id };
    observations.status = 'passed';
    await page.screenshot({ path: testInfo.outputPath('project-entry.png') });
  } catch (error) { observations.status = 'failed'; observations.error = String(error); throw error; }
  finally {
    await captureUi((name) => testInfo.outputPath(name));
    await writeFile(testInfo.outputPath('project-entry.json'), JSON.stringify(observations, null, 2));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>((done) => llm.server.close(() => done()));
  }
});
