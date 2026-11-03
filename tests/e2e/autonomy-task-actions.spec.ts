import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TaskLedgerAgentActionPayload, TaskLedgerAgentActionResult } from '@shared/host-api/contract';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { buildMockProviderConfig, hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';

test('TF-0671 Main admits owner-derived agent operations and replays the same persistent log', async ({ launchElectronApp, homeDir }, testInfo) => {
  test.setTimeout(300_000);
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(app);
    await startGateway(app);
    await expect.poll(async () => {
      try { await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.list', params: {} }); return true; }
      catch (error) { if (String(error).includes('unavailable during gateway startup')) return false; throw error; }
    }, { timeout: 120_000 }).toBe(true);
    const active = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace.id;
    // sessions.create is a governed write. Configure only this isolated test
    // workspace before exercising the actual Gateway, as coordinator E2Es do.
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess' });
    const created = await hostInvoke<{ key?: string; sessionKey?: string }>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { agentId: 'main', label: 'A2 trusted task action' } });
    await testInfo.attach('session-create-result', { body: JSON.stringify(created), contentType: 'application/json' });
    const sessionKey = created.key ?? created.sessionKey;
    if (!sessionKey) throw new Error('No actual owner session');
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, activeSessionKey: sessionKey, sessionKey });
    const snapshot = await hostInvoke<{ snapshot: { session: { sessionId: string }; policy: { scope: { agentId: string } } } }>(app, 'gateway', 'rpc', { method: 'session.activitySnapshot', params: { workspaceId, sessionKey } });
    const ack = await hostInvoke<{ childPid: number; gatewayGeneration: string }>(app, 'gateway', 'rpc', { method: 'runtime.flags.ack', params: {} });
    const gatewayStatus = await hostInvoke<{ connectedAt: number }>(app, 'gateway', 'status');
    expect(ack.childPid).toBeGreaterThan(0);
    const before = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId });
    const base = {
      operationId: 'a2-actual-create', expectedRevision: before.snapshot.eventsCount,
      runtimeGeneration: ack.gatewayGeneration,
      runtimeOwner: { childPid: ack.childPid, connectedAt: gatewayStatus.connectedAt },
      scope: { workspaceId, projectId: workspaceId, sessionKey, sessionGeneration: snapshot.snapshot.session.sessionId },
      action: { type: 'create', node: { title: 'A2 owner-derived task' } },
    } as TaskLedgerAgentActionPayload;
    const intentPath = testInfo.outputPath('task-action-intent.json');
    await writeFile(intentPath, JSON.stringify(base));
    await testInfo.attach('persistent-task-action-intent', { path: intentPath, contentType: 'application/json' });
    const apply = (payload: TaskLedgerAgentActionPayload) => hostInvoke<TaskLedgerAgentActionResult>(app, 'taskLedger', 'applyAgentAction', payload);
    await expect(apply({ ...base, actor: 'system' } as TaskLedgerAgentActionPayload)).rejects.toThrow(/VALIDATION/);
    await expect(apply({ ...base, runtimeOwner: { ...base.runtimeOwner, childPid: -1 } })).rejects.toThrow(/VALIDATION/);
    const first = await apply(base);
    const taskNodeId = first.snapshot.nodes.find(node => node.title === 'A2 owner-derived task')?.id;
    if (!taskNodeId) throw new Error('Committed node missing');
    expect(first.receipt.identity).toMatchObject({ actor: 'assistant', agentId: snapshot.snapshot.policy.scope.agentId, scope: base.scope });
    const revision = first.receipt.revision;
    const linked = await apply({ ...base, operationId: 'a2-actual-link', expectedRevision: revision, action: { type: 'link', taskNodeId } });
    const updated = await apply({ ...base, operationId: 'a2-actual-update', expectedRevision: linked.receipt.revision, action: { type: 'update', taskNodeId, patch: { title: 'A2 updated task', status: 'doing' } } });
    expect(updated.snapshot.sessionLinks).toContainEqual(expect.objectContaining({ nodeId: taskNodeId, sessionKey }));
    const stateDir = join(homeDir, '.openclaw', 'task-ledgers', 'workspaces', updated.snapshot.workspaceId);
    await writeFile(join(stateDir, 'snapshot.json'), '{damaged derived projection');
    const replay = await apply(JSON.parse(await readFile(intentPath, 'utf8')) as TaskLedgerAgentActionPayload);
    expect(replay.receipt).toMatchObject({ ...first.receipt, replayed: true });
    expect(replay.snapshot.eventsCount).toBe(updated.snapshot.eventsCount);
    await expect(apply({ ...base, action: { type: 'create', node: { title: 'same ID different intent' } } })).rejects.toThrow(/VALIDATION/);
    const staleRevision = replay.snapshot.eventsCount;
    const race = await Promise.allSettled([
      apply({ ...base, operationId: 'a2-race-one', expectedRevision: staleRevision }),
      apply({ ...base, operationId: 'a2-race-two', expectedRevision: staleRevision }),
    ]);
    expect(race.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(race.filter(row => row.status === 'rejected')).toHaveLength(1);
    await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.reset', params: { key: sessionKey, reason: 'reset' } });
    const resetSnapshot = await hostInvoke<{ snapshot: { session: { sessionId: string } } }>(app, 'gateway', 'rpc', {
      method: 'session.activitySnapshot', params: { workspaceId, sessionKey },
    });
    expect(resetSnapshot.snapshot.session.sessionId).not.toBe(base.scope.sessionGeneration);
    const resetReplay = await apply(base);
    expect(resetReplay.receipt).toEqual({ ...first.receipt, replayed: true });
    await expect(apply({ ...base, operationId: 'old-uncommitted-after-reset', expectedRevision: resetReplay.snapshot.eventsCount })).rejects.toThrow(/VALIDATION/);
    const journal = await readFile(join(stateDir, 'events.jsonl'), 'utf8');
    const frames = journal.trim().split(/\r?\n/).map(line => JSON.parse(line) as { operation?: unknown; events?: Array<{ actor: string }> });
    expect(frames.filter(frame => frame.operation).flatMap(frame => frame.events ?? []).every(event => event.actor === 'assistant')).toBe(true);
    await hostInvoke(app, 'gateway', 'stop');
    const offlineReplay = await apply(JSON.parse(await readFile(intentPath, 'utf8')) as TaskLedgerAgentActionPayload);
    expect(offlineReplay.receipt).toEqual({ ...first.receipt, replayed: true });
    await startGateway(app);
    const restartedReplay = await apply(JSON.parse(await readFile(intentPath, 'utf8')) as TaskLedgerAgentActionPayload);
    expect(restartedReplay.receipt).toEqual({ ...first.receipt, replayed: true });
    await expect(apply({ ...base, operationId: 'old-uncommitted-after-restart', expectedRevision: restartedReplay.snapshot.eventsCount })).rejects.toThrow(/VALIDATION/);
    const file = testInfo.outputPath('task-action-receipts.json');
    await writeFile(file, JSON.stringify({
      driven_by: 'agent', actor: 'codex-a2-playwright', candidate: process.env.CLAWX_E2E_CANDIDATE ?? null,
      transport: 'actual Electron/Main typed Host API -> current Gateway session/ack -> existing Task Ledger log',
      owner: { childPid: ack.childPid, scope: base.scope, agentId: snapshot.snapshot.policy.scope.agentId },
      receipts: [first.receipt, linked.receipt, updated.receipt, replay.receipt, resetReplay.receipt, offlineReplay.receipt, restartedReplay.receipt], race: race.map(row => row.status),
      journalOperationCount: frames.filter(frame => frame.operation).length, forgedActorRejected: true,
      projectionRebuilt: true, sameIdDifferentPayloadRejected: true, committedReplayWithoutGateway: true,
      committedReplayAfterGatewayRestart: true, staleUncommittedAfterRestartRejected: true,
      reset: { before: base.scope.sessionGeneration, after: resetSnapshot.snapshot.session.sessionId, oldUncommittedRejected: true },
      limitations: ['agent-driven host interaction, no model quality claim', 'task action receipt does not accept task completion', 'fault-injection/cross-process crash checks are recorded separately'],
    }, null, 2));
    await testInfo.attach('task-action-receipts', { path: file, contentType: 'application/json' });
  } finally { await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app); }
});

test('TF-0671 source Gateway writes long-task facts into the actual Main-owned journal', async ({ launchElectronApp, homeDir, userDataDir }, testInfo) => {
  test.setTimeout(180_000);
  const llm = await startScriptedLlm(() => ({ text: 'Agent-driven Task Ledger owner path probe.' }));
  const workspaceDir = join(homeDir, 'a2-runtime-workspace');
  const sourceStateDir = join(userDataDir, 'openclaw-source-state');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(sourceStateDir, { recursive: true });
  const config = JSON.stringify(buildMockProviderConfig(llm.port, workspaceDir));
  await writeFile(join(homeDir, '.openclaw', 'openclaw.json'), config);
  await writeFile(join(sourceStateDir, 'openclaw.json'), config);
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(app);
    await startGateway(app);
    await expect.poll(async () => {
      try { await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.list', params: {} }); return true; }
      catch (error) { if (String(error).includes('unavailable during gateway startup')) return false; throw error; }
    }, { timeout: 120_000 }).toBe(true);
    const active = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'getActive');
    const workspaceId = active.activeWorkspace.id;
    await hostInvoke(app, 'workspaces', 'update', { id: workspaceId, permissionMode: 'fullAccess', rootPath: workspaceDir });
    const created = await hostInvoke<{ key: string }>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { agentId: 'main' } });
    const taskLedgerRootId = 'a2-source-runtime-owner-root';
    // Use the existing runtime owner path. Only journal creation/readback is
    // asserted; scripted output does not prove Task Loop task completion.
    const runtimeCall = hostInvoke(app, 'gateway', 'rpc', { method: 'task_loop.run', timeoutMs: 30_000, params: {
      task: 'A2 runtime owner journal probe', sessionKey: created.key, workspaceId, taskLedgerRootId,
      agentId: 'main', includeVerifier: false, maxWorkers: 1,
    } }).then(result => ({ result }), error => ({ error: String(error) }));
    let visible: TaskLedgerSnapshot | undefined;
    await expect.poll(async () => {
      visible = (await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId })).snapshot;
      return visible.nodes.some(node => node.id === taskLedgerRootId && node.tags?.includes('long-task'));
    }, { timeout: 30_000 }).toBe(true);
    const root = visible?.nodes.find(node => node.id === taskLedgerRootId);
    expect(root?.metadata).toMatchObject({ taskLedgerRootId, source: 'task_loop' });
    expect(visible?.sessionLinks).toContainEqual(expect.objectContaining({ nodeId: taskLedgerRootId, sessionKey: created.key }));
    const journalPath = join(homeDir, '.openclaw', 'task-ledgers', 'workspaces', visible!.workspaceId, 'events.jsonl');
    const journal = await readFile(journalPath, 'utf8');
    expect(journal).toContain(taskLedgerRootId);
    await hostInvoke(app, 'gateway', 'stop');
    const outcome = await runtimeCall;
    const evidence = testInfo.outputPath('main-runtime-owner-journal.json');
    await writeFile(evidence, JSON.stringify({ driven_by: 'agent', actor: 'codex-a2-playwright', candidate: process.env.CLAWX_E2E_CANDIDATE ?? null,
      workspaceId, taskLedgerRootId, mainJournal: journalPath, sourceRuntimeStateDir: sourceStateDir, root,
      sessionLinks: visible?.sessionLinks, runtimeOutcome: outcome, scriptedProviderRequests: llm.log.length,
      limitation: 'Existing runtime owner created and Main read the same facts; no Task Loop completion or model-quality acceptance.',
    }, null, 2));
    await testInfo.attach('main-runtime-owner-journal', { path: evidence, contentType: 'application/json' });
  } finally {
    await hostInvoke(app, 'gateway', 'stop').catch(() => undefined);
    await closeElectronApp(app);
    llm.server.closeAllConnections();
    await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
