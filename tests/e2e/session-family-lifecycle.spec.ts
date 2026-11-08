import { readFile, writeFile } from 'node:fs/promises';
import type { TaskLedgerSnapshot } from '../../shared/types/task-ledger';
import { closeElectronApp, expect, getStableWindow, hoverUntilVisible, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { addSessionChainChildren, configureSessionChainProvider, createSessionChainProject, observeSessionUi } from './fixtures/session-task-chain';

test('archiving, restoring and deleting a parent preserves child navigation, tasks and produced files', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(300_000);
  const llm = await startScriptedLlm(() => ({ text: 'Agent lifecycle fixture' }));
  const app = await launchElectronApp({ skipSetup: true });
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'playwright-family-lifecycle', provider: 'local-scripted', status: 'running' };
  try {
    await configureSessionChainProvider(app, llm.port);
    const project = await createSessionChainProject(app, testInfo.outputPath('workspace'), 'Lifecycle project');
    const child = (await addSessionChainChildren(app, project, 0, 1))[0];
    const rpc = <T,>(method: string, params: Record<string, unknown>) => hostInvoke<T>(app, 'gateway', 'rpc', { method, params, timeoutMs: 30_000 });
    await rpc('chat.inject', { sessionKey: project.sessionKey, message: 'Parent lifecycle transcript', label: 'agent fixture' });
    await rpc('chat.inject', { sessionKey: child, message: 'Surviving child transcript', label: 'agent fixture' });
    const file = testInfo.outputPath('workspace', 'result.txt');
    await writeFile(file, 'Retained task evidence\n');
    const ledger = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'createNode', {
      workspaceId: project.workspaceId, node: { kind: 'task', title: 'Retain lifecycle evidence', status: 'todo', evidenceRefs: [{ type: 'file', ref: file }] },
    });
    const task = ledger.snapshot.nodes.find((node) => node.kind === 'task')!;
    await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: project.workspaceId, sessionKey: child, nodeId: task.id });
    const page = await getStableWindow(app); await page.reload();
    const parentRow = page.getByTestId(`sidebar-session-${project.sessionKey}`);
    await expect(parentRow).toBeVisible({ timeout: 30_000 });
    const openDelete = async () => {
      await hoverUntilVisible(parentRow, page.getByTestId(`sidebar-session-more-${project.sessionKey}`));
      await page.getByTestId(`sidebar-session-more-${project.sessionKey}`).click();
      await page.getByTestId('sidebar-session-context-delete').click();
      await expect(page.getByTestId('session-delete-dialog')).toBeVisible();
    };
    await openDelete(); await page.getByTestId('session-delete-dialog-cancel').click();
    expect((await rpc<{ sessions: Array<{ key: string }> }>('sessions.list', {})).sessions.some((session) => session.key === project.sessionKey)).toBe(true);
    await openDelete(); await page.getByTestId('session-delete-dialog-archive').click();
    await expect(parentRow).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId(`sidebar-session-${child}`)).toBeVisible();
    await page.getByTestId(`sidebar-session-${child}`).click();
    await expect(page.getByText('Surviving child transcript', { exact: true })).toBeVisible();
    await expect(page.getByTestId('session-family-source-unloaded')).toContainText('Source unavailable');
    await page.screenshot({ path: testInfo.outputPath('archived-parent-surviving-child.png') });
    const archived = await hostInvoke(app, 'sessions', 'listArchived', { agentId: 'main' });
    await page.getByTestId('sidebar-footer-menu-trigger').click();
    await page.getByTestId('sidebar-archive').click();
    await expect(page.getByTestId(`settings-archived-item-${project.sessionKey}`)).toBeVisible();
    await page.getByTestId(`settings-archived-restore-${project.sessionKey}`).click();
    await expect(page.getByTestId(`settings-archived-item-${project.sessionKey}`)).toHaveCount(0);
    const restored = await rpc<{ session: { sessionId: string } }>('sessions.describe', { key: project.sessionKey });
    expect(restored.session.sessionId).not.toBe(project.generation);
    await page.goBack();
    await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
    await expect(parentRow).toBeVisible();
    await openDelete(); await page.getByTestId('session-delete-dialog-permanent').click();
    await expect(parentRow).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId(`sidebar-session-${child}`)).toBeVisible();
    await page.getByTestId(`sidebar-session-${child}`).click();
    await expect(page.getByText('Surviving child transcript', { exact: true })).toBeVisible();
    const childRead = await rpc<{ session: { parentSessionKey: string } }>('sessions.describe', { key: child });
    expect(childRead.session.parentSessionKey).toBe(project.sessionKey);
    const after = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId: project.workspaceId });
    expect(after.snapshot.nodes.find((node) => node.id === task.id)?.status).toBe('todo');
    expect(await readFile(file, 'utf8')).toBe('Retained task evidence\n');
    evidence.project = project; evidence.child = child; evidence.archived = archived; evidence.restored = restored;
    evidence.childAfterDelete = childRead; evidence.task = after.snapshot.nodes.find((node) => node.id === task.id);
    evidence.status = 'passed';
    await page.screenshot({ path: testInfo.outputPath('deleted-parent-surviving-child.png') });
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    await writeFile(testInfo.outputPath('family-lifecycle.json'), JSON.stringify(evidence, null, 2));
    await captureUi((name) => testInfo.outputPath(name));
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
    llm.server.closeAllConnections(); await new Promise<void>((done) => llm.server.close(() => done()));
  }
});
