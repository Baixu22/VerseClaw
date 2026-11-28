import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationChild, createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';
import { TaskSystemStore } from '../../shared/task-system/store';
import { resolveTaskDomain } from '../../shared/task-system/identity';
import { materialReference, materialSource, type SessionCollaborationMaterial } from '../../shared/types/session-collaboration-material';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';
import type { SessionCollaborationPage } from '../../shared/types/session-collaboration';
import type { SessionCollaborationMessagePage, SessionCollaborationMessageReceipt } from '../../shared/types/session-collaboration-message';
import type { SessionCollaborationWatchResult } from '../../shared/types/session-collaboration-watch';
import type { SessionCollaborationUsage } from '../../shared/types/session-collaboration-usage';
import type { SessionCollaborationResources } from '../../shared/types/session-collaboration-resources';
import type { TaskMaterialObservation } from '../../shared/task-system/trace';

test('two independent sessions discover, exchange, reuse, read resources and recover on one candidate', async ({ launchElectronApp }, info) => {
  test.setTimeout(420_000);
  expect(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), 'E5 requires a clean source candidate').toBe('');
  const text = 'E5 retained observation: verified-2718';
  const message = 'E5-CONSUME Read the shared observation and return its exact text.';
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'session-collaboration-e5', status: 'running',
    sourceCandidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
    scriptSha256: createHash('sha256').update(await readFile(info.file)).digest('hex'),
    input: { text, message }, inputSha256: createHash('sha256').update(JSON.stringify({ text, message })).digest('hex'), firstFailure: null };
  let material: SessionCollaborationMaterial | undefined;
  const providerInputs: { userText: string; userTextSha256: string; request: unknown }[] = [];
  const provider = await startScriptedLlm((prompt, tools, _index, request) => {
    providerInputs.push({ userText: prompt, userTextSha256: createHash('sha256').update(prompt).digest('hex'), request });
    if (!prompt.includes('E5-CONSUME')) return { text: 'Fixture ready.' };
    if (!material) throw new Error('Fixture material is not published');
    if (!tools['e5-material']) return { toolCall: { id: 'e5-material', name: 'sessions_list',
      args: { materials: { target: materialSource(material), ref: materialReference(material) } } } };
    return { text: tools['e5-material'].includes(text) ? text : 'Shared material missing' };
  });
  const stores: TaskSystemStore[] = [];
  let app: ElectronApplication | undefined;
  try {
    app = await launchElectronApp({ skipSetup: true });
    await configureSessionChainProvider(app, provider.port);
    const consumer = await createCollaborationProject(app, info.outputPath('consumer'), 'E5 consumer');
    const publisher = await createCollaborationProject(app, info.outputPath('publisher'), 'E5 publisher');
    const child = await createCollaborationChild(app, publisher);
    Object.assign(evidence, { publisher: publisher.scope, consumer: consumer.scope, child: child.scope });
    await enableCollaborationFixtureVisibility(app);
    const sender = await hostInvoke<{ source: { scope: AutonomySessionScope } }>(app, 'sessions', 'collaborationSender');
    evidence.sender = sender;
    expect(sender.source.scope).toEqual(publisher.scope);
    const publisherStore = new TaskSystemStore(resolveTaskDomain(publisher.rootPath)); stores.push(publisherStore);
    const consumerStore = new TaskSystemStore(resolveTaskDomain(consumer.rootPath)); stores.push(consumerStore);
    const claim = publisherStore.binding(publisher.sessionKey, publisher.generation)!.claim!;
    expect(publisherStore.binding(child.sessionKey, child.generation)?.referenceOnly).toBe(true);
    material = publisherStore.publishSharedMaterial(claim, { id: 'e5-finding', kind: 'claim', summary: text,
      evidenceRefs: [], sensitivity: 'internal' }, 'agent-fixture-publish', () => publisher.scope);
    const initialCalls = provider.log.length;
    const discovery = await hostInvoke<{ page: SessionCollaborationPage }>(app, 'sessionActivity', 'query', { requester: publisher.scope });
    evidence.discovery = discovery;
    expect(discovery.page.state).toBe('ready');
    expect(discovery.page.items.map(row => row.sessionKey)).toEqual(expect.arrayContaining([publisher.sessionKey, consumer.sessionKey, child.sessionKey]));
    expect(provider.log.length).toBe(initialCalls);
    const intent = { id: randomUUID(), expectedSource: publisher.scope, target: consumer.scope, purpose: 'request', message };
    const sent = await hostInvoke<{ receipt: SessionCollaborationMessageReceipt }>(app, 'sessions', 'sendCollaborationMessage', intent);
    Object.assign(evidence, { intent, sent });
    expect(sent.receipt.message.source).toEqual(publisher.scope);
    expect(sent.receipt.message.target).toEqual(consumer.scope);
    expect(sent.receipt.message.actor).toBe('operator');
    expect(sent.receipt.message.sourceRun).toBeNull();
    expect(sent.receipt.run).toBeTruthy();
    const run = sent.receipt.run!;
    const selected = { requester: publisher.scope, target: consumer.scope };
    const query = { ...selected, limit: 1 };
    const watch = { id: randomUUID(), query, condition: 'run-terminal', run, timeoutMs: 25_000 };
    const observed = await hostInvoke<{ watch: SessionCollaborationWatchResult }>(app, 'sessionActivity', 'watch', watch);
    evidence.observed = observed;
    const terminal = await hostInvoke<{ status: string }>(app, 'gateway', 'rpc', {
      method: 'agent.wait', params: { runId: run.runId, timeoutMs: 60_000 }, timeoutMs: 65_000 });
    evidence.terminal = terminal;
    expect(terminal.status).toBe('ok');
    const completed = observed.watch.state === 'satisfied' ? observed : await hostInvoke<typeof observed>(app, 'sessionActivity', 'watch', { ...watch, id: randomUUID(), timeoutMs: 0 });
    evidence.completed = completed;
    expect(completed.watch).toMatchObject({ state: 'satisfied', event: { kind: 'run-terminal', status: 'ok' } });
    const receiptQuery = { requester: publisher.scope, target: consumer.scope, id: intent.id };
    const activeApp = app;
    const readReceipt = async () => {
      const value = await hostInvoke<{ messages: SessionCollaborationMessagePage }>(activeApp, 'sessions', 'collaborationMessages', receiptQuery);
      evidence.lastReceiptRead = value;
      return value;
    };
    await expect.poll(async () => (await readReceipt()).messages.receipt?.phase, { timeout: 30_000 }).toBe('replied');
    const receipt = (await readReceipt()).messages.receipt!;
    evidence.receipt = receipt;
    expect(receipt.message).toEqual(sent.receipt.message);
    expect(receipt.reply?.text).toBe(text);
    Object.assign(evidence, { intent, receipt, terminal, completed });
    const use = consumerStore.traceSnapshot(consumer.taskNodeId).events.filter(event => event.kind === 'material_observation')
      .map(event => event.payload as TaskMaterialObservation);
    evidence.use = use;
    expect(use.some(item => item.phase === 'prompt-used' && item.run?.runId === run.runId
      && item.reader.sessionKey === consumer.sessionKey && item.reader.sessionGeneration === consumer.generation
      && item.source.sessionKey === publisher.sessionKey && item.source.sessionGeneration === publisher.generation
      && item.ref.contentDigest === material!.contentDigest)).toBe(true);
    const afterMessageCalls = provider.log.length;
    expect(afterMessageCalls).toBe(initialCalls + 2);
    const usage = await hostInvoke<{ usage: SessionCollaborationUsage }>(app, 'sessionActivity', 'modelUsage', selected);
    const resources = await hostInvoke<{ resources: SessionCollaborationResources }>(app, 'sessionActivity', 'resources', selected);
    Object.assign(evidence, { usage, resources });
    expect(usage.usage.session.state).toBe('ready');
    expect(usage.usage.task.state).toBe('ready');
    expect(usage.usage.run).toMatchObject({ state: 'ready', value: { run } });
    expect(usage.usage.calls.some(call => call.run.runId === run.runId)).toBe(true);
    expect(resources.resources.state).toBe('ready');
    expect(provider.log.length).toBe(afterMessageCalls);
    const page = await getStableWindow(app); await page.reload();
    const openMessages = async () => {
      await page.getByTestId('sidebar-nav-system').click();
      await page.getByTestId(`collaboration-row-${encodeURIComponent(consumer.sessionKey)}`).click();
      const messages = page.getByTestId('collaboration-messages');
      if (await messages.getAttribute('open') === null) await messages.locator('summary').click();
    };
    await openMessages();
    const draft = page.getByTestId('collaboration-message-draft');
    await expect(draft).toBeEnabled(); await draft.fill('E5 retained unsent draft');
    await hostInvoke(app, 'gateway', 'stop'); await startGateway(app); await page.reload();
    await openMessages();
    await expect(draft).toHaveValue('E5 retained unsent draft');
    const replay = await hostInvoke<typeof sent>(app, 'sessions', 'sendCollaborationMessage', intent);
    evidence.replay = replay;
    expect(replay.receipt.run).toEqual(run);
    expect((await readReceipt()).messages.receipt?.reply).toEqual(receipt.reply);
    expect(provider.log.length).toBe(afterMessageCalls);
    await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.reset', params: { key: consumer.sessionKey } });
    const stale = await hostInvoke<typeof resources>(app, 'sessionActivity', 'resources', selected);
    evidence.stale = stale;
    expect(stale.resources).toMatchObject({ state: 'stale', inventory: null });
    expect(publisherStore.get(publisher.taskNodeId).claim).toEqual(claim);
    expect(provider.anomalies).toEqual([]);
    const finalCandidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    evidence.finalCandidate = finalCandidate;
    expect(finalCandidate).toBe(evidence.sourceCandidate);
    expect(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
    Object.assign(evidence, { publisher: publisher.scope, consumer: consumer.scope, child: child.scope, discovery,
      intent, receipt, terminal, completed, use, usage, resources, replay, stale,
      modelCallsBefore: initialCalls, modelCallsAfter: provider.log.length, draftRecovered: true, status: 'assertions-passed' });
  } catch (error) {
    evidence.status = 'failed';
    evidence.firstFailure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const scenarioFailed = evidence.firstFailure !== null;
    const cleanupErrors: string[] = [];
    for (const store of stores) {
      try { store.close(); } catch (error) { cleanupErrors.push(String(error)); }
    }
    if (app) {
      try {
        const closed = await closeElectronApp(app);
        evidence.electronClose = closed;
        if (!closed.mainExited || !closed.launcherExited || !closed.closeSettled || closed.errors.length)
          cleanupErrors.push('Electron close did not settle cleanly');
      } catch (error) { cleanupErrors.push(String(error)); }
    }
    try { await provider.close(); evidence.providerClosed = true; }
    catch (error) { cleanupErrors.push(String(error)); evidence.providerClosed = false; }
    evidence.providerRequests = provider.log;
    evidence.providerInputs = providerInputs;
    evidence.providerAnomalies = provider.anomalies;
    evidence.cleanupErrors = cleanupErrors;
    evidence.status = scenarioFailed || cleanupErrors.length ? 'failed' : 'passed';
    if (!scenarioFailed && cleanupErrors.length) evidence.firstFailure = cleanupErrors.join('; ');
    await writeFile(info.outputPath('collaboration-center.json'), JSON.stringify(evidence, null, 2));
    if (!scenarioFailed && cleanupErrors.length) throw new Error(String(evidence.firstFailure));
  }
});
