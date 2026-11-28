import { writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { materialReference } from '../../shared/types/session-collaboration-material';
import type { SessionCollaborationMessagePage } from '../../shared/types/session-collaboration-message';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import type { SessionCollaborationWatchResult } from '../../shared/types/session-collaboration-watch';

test('restores drafts and an unknown original send across reload and Gateway restart without redispatch', async ({ launchElectronApp }, info) => {
  test.setTimeout(360_000);
  const provider = await startScriptedLlm(() => ({ text: 'Original recovery reply.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const target = await createCollaborationProject(app, info.outputPath('target'), 'Recovery target');
    const source = await createCollaborationProject(app, info.outputPath('source'), 'Recovery sender');
    await enableCollaborationFixtureVisibility(app);
    const page = await getStableWindow(app);
    await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'en' });
    const select = async () => {
      await page.getByTestId('sidebar-nav-system').click();
      await page.getByTestId(`collaboration-row-${encodeURIComponent(target.sessionKey)}`).click();
      const messages = page.getByTestId('collaboration-messages'); await messages.locator('summary').click(); return messages;
    };
    await page.reload(); let messages = await select();
    await messages.getByTestId('collaboration-message-draft').fill('Preserve this exact recovery intent.');
    await page.reload(); messages = await select();
    await expect(messages.getByTestId('collaboration-message-draft')).toHaveValue('Preserve this exact recovery intent.');
    // Drop only the reply to a real accepted Host send, leaving the original owner effect intact.
    const dropSendAcknowledgement = () => app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      handlers.set('host:invoke', async (...args) => {
        const request = args[1] as { module?: string; action?: string };
        const result = await original(...args);
        if (request.module === 'sessions' && request.action === 'sendCollaborationMessage') {
          handlers.set('host:invoke', original); throw new Error('E3 injected lost send acknowledgement');
        }
        return result;
      });
    });
    await dropSendAcknowledgement();
    const callsBefore = provider.log.length;
    await messages.getByTestId('collaboration-message-send').click();
    await expect(messages.getByRole('button', { name: 'Read original receipt' })).toBeVisible();
    const before = await hostInvoke<{ messages: SessionCollaborationMessagePage }>(app, 'sessions', 'collaborationMessages', { requester: source.scope, target: target.scope });
    const message = before.messages.items.find(item => item.header.preview.includes('Preserve this exact recovery intent'))!;
    expect(message).toBeTruthy();
    await expect.poll(async () => (await hostInvoke<{ messages: SessionCollaborationMessagePage }>(app, 'sessions', 'collaborationMessages', {
      requester: source.scope, target: target.scope, id: message.header.id,
    })).messages.receipt?.phase, { timeout: 120_000 }).toBe('replied');
    const callsBeforeRestart = provider.log.length;
    expect(callsBeforeRestart).toBe(callsBefore + 1);
    await hostInvoke(app, 'gateway', 'stop'); await startGateway(app); await page.reload(); messages = await select();
    await expect(messages.getByTestId('collaboration-message-draft')).toHaveValue('');
    const callsAfterRestart = provider.log.length;
    expect(callsAfterRestart).toBe(callsBeforeRestart);
    const after = await hostInvoke<{ messages: SessionCollaborationMessagePage }>(app, 'sessions', 'collaborationMessages', { requester: source.scope, target: target.scope, id: message.header.id });
    expect(after.messages.receipt?.message.id).toBe(message.header.id);
    expect(provider.log.length).toBe(callsAfterRestart);
    await messages.getByTestId('collaboration-message-draft').fill('Retain the old generation draft');
    await dropSendAcknowledgement();
    await messages.getByTestId('collaboration-message-send').click();
    await expect(messages.getByRole('button', { name: 'Read original receipt' })).toBeVisible();
    const archived = await hostInvoke<{ messages: SessionCollaborationMessagePage }>(app, 'sessions', 'collaborationMessages', { requester: source.scope, target: target.scope });
    const archivedMessage = archived.messages.items.find(item => item.header.preview.includes('Retain the old generation draft'))!;
    expect(archivedMessage).toBeTruthy();
    await expect.poll(async () => (await hostInvoke<{ messages: SessionCollaborationMessagePage }>(app, 'sessions', 'collaborationMessages', {
      requester: source.scope, target: target.scope, id: archivedMessage.header.id,
    })).messages.receipt?.phase, { timeout: 120_000 }).toBe('replied');
    const callsBeforeSourceReset = provider.log.length;
    expect(callsBeforeSourceReset).toBe(callsBeforeRestart + 1);
    await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.reset', params: { key: source.sessionKey } });
    await page.reload(); await select();
    const recovery = page.getByTestId('collaboration-recovery');
    await recovery.locator('summary').click();
    await expect(recovery.getByText('Retain the old generation draft', { exact: true })).toBeVisible();
    await expect(recovery).toContainText(source.generation);
    await recovery.getByRole('button', { name: 'Read original receipt' }).click();
    await expect(recovery.getByRole('status')).toHaveText('Original receipt: Replied');
    expect(provider.log.length).toBe(callsBeforeSourceReset);
    await recovery.getByRole('button', { name: 'Discard saved draft' }).click();
    await expect(recovery).toHaveCount(0);
    expect(provider.log.length).toBe(callsBeforeSourceReset);
    await writeFile(info.outputPath('message-recovery.json'), JSON.stringify({ driven_by: 'agent', fault: 'lost-ack-after-owner-send', before, after,
      callsBefore, callsBeforeRestart, callsAfterRestart, callsBeforeSourceReset, callsAfterRead: provider.log.length, archivedMessageId: archivedMessage.header.id, oldGenerationDraftDiscarded: true }, null, 2));
  } finally { await closeElectronApp(app); await provider.close(); }
});

test('keeps acknowledged material cursors through restart and isolates an unreadable project', async ({ launchElectronApp }, info) => {
  test.setTimeout(360_000);
  const provider = await startScriptedLlm(() => ({ text: 'Fixture ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const target = await createCollaborationProject(app, info.outputPath('materials'), 'Recovery materials');
    const other = await createCollaborationProject(app, info.outputPath('other'), 'Healthy project');
    await enableCollaborationFixtureVisibility(app);
    const store = new TaskSystemStore(resolveTaskDomain(target.rootPath));
    try {
      const claim = store.binding(target.sessionKey, target.generation)!.claim!;
      const material = store.publishSharedMaterial(claim, { id: 'recovery-material', kind: 'claim', summary: 'Original recovery material', evidenceRefs: [], sensitivity: 'internal' }, 'publish-run', () => target.scope);
      const query = parseSessionCollaborationQuery({ requester: target.scope, target: target.scope, limit: 1 });
      const watch = { id: 'before-restart', query, condition: 'material-changed', materialRef: materialReference(material), observedMaterialState: 'claim', timeoutMs: 0 };
      const calls = provider.log.length;
      store.revokeSharedMaterial(claim, materialReference(material), 'Injected source withdrawal', 'revoke-run', () => target.scope);
      const changed = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', watch);
      expect(changed.watch.event?.materialState).toBe('revoked');
      await hostInvoke(app, 'gateway', 'stop'); await startGateway(app);
      const resumed = await hostInvoke<typeof changed>(app, 'sessionActivity', 'watch', { ...watch, id: 'after-restart', cursor: changed.watch.cursor });
      expect(resumed.watch).toMatchObject({ state: 'timeout', event: null });
      store.db.exec('PRAGMA user_version=999');
      const healthy = await hostInvoke<{ page: { state: string; items: unknown[] } }>(app, 'sessionActivity', 'query', {
        requester: other.scope, target: other.scope, limit: 1 });
      expect(healthy.page.state).toBe('ready'); expect(healthy.page.items).toHaveLength(1);
      store.db.exec('PRAGMA user_version=7');
      await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.reset', params: { key: target.sessionKey } });
      const stale = await hostInvoke<typeof changed>(app, 'sessionActivity', 'watch', { ...watch, id: 'after-reset' });
      expect(stale.watch).toMatchObject({ state: 'stale', event: null });
      expect(provider.log.length).toBe(calls);
      await writeFile(info.outputPath('owner-recovery.json'), JSON.stringify({ driven_by: 'agent', changed, resumed, healthy, stale, callsBefore: calls, callsAfter: provider.log.length }, null, 2));
    } finally { store.close(); }
  } finally { await closeElectronApp(app); await provider.close(); }
});
