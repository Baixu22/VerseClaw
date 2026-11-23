import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { join } from 'node:path';
import type { ElectronApplication, TestInfo } from '@playwright/test';
import type { GatewayStatus } from '../../shared/types/gateway';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { buildMockProviderConfig, hostInvoke, initializeIndependentGitWorkspace, SCRIPTED_LLM_USAGE, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';

function observeProviderRequests(server: Server): Array<{ at: number; body: string }> {
  const requests: Array<{ at: number; body: string }> = [];
  server.on('request', request => {
    if (!request.url?.includes('/chat/completions')) return;
    let body = '';
    request.on('data', data => { body += data; });
    request.on('end', () => { requests.push({ at: Date.now(), body }); });
  });
  return requests;
}

async function captureR1OwnerState(
  app: ElectronApplication, sourceState: string, testInfo: TestInfo, observed: Record<string, unknown>,
): Promise<void> {
  const owner: Record<string, unknown> = {};
  const captureErrors: Record<string, string> = {};
  try {
    const db = new DatabaseSync(join(sourceState, 'state/openclaw.sqlite'), { readOnly: true });
    try {
      for (const table of ['subagent_runs', 'provider_spend_calls', 'provider_spend_allocations']) {
        try { owner[table] = db.prepare(`SELECT * FROM ${table}`).all(); }
        catch (error) { captureErrors[table] = String(error); }
      }
    } finally { db.close(); }
  } catch (error) { captureErrors.database = String(error); }
  let gateway: GatewayStatus | undefined;
  try { gateway = await hostInvoke<GatewayStatus>(app, 'gateway', 'status'); }
  catch (error) { captureErrors.gateway = String(error); }
  const path = testInfo.outputPath('r1-terminal-owner-observation.json');
  await writeFile(path, JSON.stringify({
    driven_by: 'agent', actor: 'codex-r1-electron-observer',
    candidate: process.env.CLAWX_E2E_CANDIDATE ?? 'dirty-development',
    recordedAt: new Date().toISOString(), gateway, owner, captureErrors, ...observed,
  }, null, 2));
  await testInfo.attach('r1-terminal-owner-observation', { path, contentType: 'application/json' });
}

for (const handoffMode of ['off', 'on'] as const) {
test(`R1 real Host/Gateway queues conflicting waves until the prior provider run terminates (handoff ${handoffMode})`, async ({ launchElectronApp, homeDir, userDataDir }, testInfo) => {
  test.setTimeout(360_000);
  let releaseFirst!: () => void;
  const barrier = new Promise<void>(resolve => { releaseFirst = resolve; });
  const calls: Array<{ worker: string; at: number }> = [];
  const llm = await startScriptedLlm(async text => {
    const worker = text.includes('R1-FIRST-WORKER') ? 'first' : text.includes('R1-SECOND-WORKER') ? 'second' : 'other';
    calls.push({ worker, at: Date.now() });
    if (worker === 'first') await barrier;
    return { text: '## Summary\nOWNER-FROZEN-R1-SIGNAL\n## Verification\nAgent-driven controlled provider receipt.' };
  });
  const requests = observeProviderRequests(llm.server);
  const workspace = join(homeDir, 'r1-workspace');
  await mkdir(workspace, { recursive: true });
  initializeIndependentGitWorkspace(workspace);
  const config = buildMockProviderConfig(llm.port, workspace);
  const runtime = config.runtime as Record<string, unknown>;
  runtime.orchestration = { ...(runtime.orchestration as Record<string, unknown> ?? {}), handoffArtifacts: handoffMode };
  const model = (config.models as { providers: { openai: { models: Array<Record<string, unknown>> } } }).providers.openai.models[0];
  model.reasoning = true;
  model.compat = { supportsReasoningEffort: true, supportedReasoningEfforts: ['low', 'medium', 'high'] };
  (config.agents as { defaults: Record<string, unknown> }).defaults.subagents = { maxConcurrent: 2, maxChildrenPerAgent: 2, runTimeoutSeconds: 120 };
  const sourceState = join(userDataDir, 'openclaw-source-state');
  await mkdir(sourceState, { recursive: true });
  await writeFile(join(homeDir, '.openclaw', 'openclaw.json'), JSON.stringify(config));
  await writeFile(join(sourceState, 'openclaw.json'), JSON.stringify(config));
  const app = await launchElectronApp({ skipSetup: true, env: { TEMP: 'D:/tmp', TMP: 'D:/tmp' } });
  const rows = (orchestrationRunId: string) => {
    const db = new DatabaseSync(join(sourceState, 'state/openclaw.sqlite'), { readOnly: true });
    try {
      return (db.prepare('SELECT payload_json FROM subagent_runs').all() as Array<{ payload_json: string }>).map(row => JSON.parse(row.payload_json) as {
        runId: string; startedAt?: number; endedAt?: number; outcome?: { status: string }; execution?: { status: string };
        queuedDispatch?: unknown; orchestration?: { orchestrationRunId: string; taskNodeId: string; executionWave: number; handoffArtifacts?: Array<{ state: string; outputText?: string; outputSha256?: string }> };
      }).filter(row => row.orchestration?.orchestrationRunId === orchestrationRunId);
    } finally { db.close(); }
  };
  try {
    const page = await getStableWindow(app);
    const active = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'getActive');
    // This isolated test workspace uses its existing explicit permission mode.
    await hostInvoke(app, 'workspaces', 'update', { id: active.activeWorkspace.id, rootPath: workspace, permissionMode: 'fullAccess' });
    await startGateway(app);
    await expect.poll(async () => {
      try { await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.list', params: {} }); return true; }
      catch { return false; }
    }, { timeout: 120_000 }).toBe(true);
    const session = await hostInvoke<{ key: string }>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { agentId: 'main', label: 'R1 controlled wave test' } });
    const result = await hostInvoke<{ orchestrationRunId: string; spawnedRunIds: string[]; graphStatus: string; synthesis: { status: string }; schedulerMetrics: { completed: number; scheduled: number }; failures?: unknown[] }>(app, 'gateway', 'rpc', {
      method: 'orchestrator.run', timeoutMs: 60_000, params: { task: 'R1 controlled overlapping work', sessionKey: session.key,
        maxWorkers: 2, includeVerifier: false, graphMode: handoffMode === 'on' ? 'staged' : 'auto', workers: [
          { roleName: handoffMode === 'on' ? 'planner' : 'implementer', task: 'R1-FIRST-WORKER: report the controlled receipt', writeSet: ['shared.txt'] },
          { roleName: handoffMode === 'on' ? 'implementer' : 'docs-writer', task: 'R1-SECOND-WORKER: report the controlled receipt', writeSet: ['shared.txt'] },
        ] },
    });
    await testInfo.attach('r1-orchestration-admission', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.spawnedRunIds).toHaveLength(2);
    expect(result.graphStatus).toBe('running');
    expect(result.synthesis.status).toBe('pending');
    expect(result.schedulerMetrics.completed).toBe(0);
    expect(result.schedulerMetrics.scheduled).toBe(2);
    await expect.poll(() => calls.some(call => call.worker === 'first'), { timeout: 120_000 }).toBe(true);
    const held = rows(result.orchestrationRunId);
    expect(held).toHaveLength(2);
    expect(held.find(row => row.orchestration?.executionWave === 1)?.endedAt).toBeUndefined();
    expect(held.find(row => row.orchestration?.executionWave === 2)?.execution?.status).toBe('queued');
    expect(calls.filter(call => call.worker === 'second')).toHaveLength(0);
    const releasedAt = Date.now();
    releaseFirst();
    await expect.poll(() => rows(result.orchestrationRunId).filter(row => row.outcome?.status === 'ok' && typeof row.endedAt === 'number').length,
      { timeout: 120_000 }).toBe(2);
    const completed = rows(result.orchestrationRunId);
    await writeFile(testInfo.outputPath('r1-waves-preassert.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-r1-electron-wave',
      handoffMode, result, held, completed, requests, calls, releasedAt }, null, 2));
    const first = completed.find(row => row.orchestration?.executionWave === 1)!;
    const second = completed.find(row => row.orchestration?.executionWave === 2)!;
    expect(second.startedAt!).toBeGreaterThanOrEqual(first.endedAt!);
    expect(calls.find(call => call.worker === 'second')!.at).toBeGreaterThanOrEqual(releasedAt);
    if (handoffMode === 'on') {
      expect(second.orchestration?.handoffArtifacts).toHaveLength(1);
      expect(second.orchestration?.handoffArtifacts?.[0].state).toBe('ready');
      expect(second.orchestration?.handoffArtifacts?.[0].outputText).toContain('OWNER-FROZEN-R1-SIGNAL');
      expect(second.orchestration?.handoffArtifacts?.[0].outputSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(requests.some(request => request.body.includes('R1-SECOND-WORKER') && request.body.includes('OWNER-FROZEN-R1-SIGNAL'))).toBe(true);
    }
    expect(llm.anomalies).toEqual([]);
    const evidence = { driven_by: 'agent', actor: 'codex-r1-electron-wave', candidate: process.env.CLAWX_E2E_CANDIDATE ?? 'dirty-development',
      result, held, completed, calls, requests, releasedAt, handoffMode,
      limits: ['scripted local provider; real Host/Gateway/registry/SQLite', 'does not measure live model quality or full R1 budget acceptance'] };
    const file = testInfo.outputPath('r1-waves-owner.json');
    await writeFile(file, JSON.stringify(evidence, null, 2));
    expect(JSON.parse(await readFile(file, 'utf8')).completed).toHaveLength(2);
    await testInfo.attach('r1-waves-owner', { path: file, contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('r1-electron.png') });
    const nativeBefore = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
    if (!nativeBefore.pid) throw new Error('Gateway native owner PID is unavailable');
    if (handoffMode === 'on') {
      await app.evaluate(() => {
        const cp = process.mainModule!.require('node:child_process') as { exec: (command: string, ...args: unknown[]) => unknown };
        const original = cp.exec;
        const fixture = { attempts: 0 };
        (globalThis as Record<PropertyKey, unknown>)[Symbol.for('clawx.r1.taskkill-failure')] = fixture;
        cp.exec = (command, ...args) => {
          if (command.startsWith('taskkill /F /PID ')) {
            fixture.attempts += 1;
            const callback = args.find(value => typeof value === 'function') as (error: Error) => void;
            queueMicrotask(() => callback(new Error('agent-driven taskkill failure')));
            return;
          }
          return original(command, ...args);
        };
        process.mainModule!.require('node:module').syncBuiltinESMExports();
      });
    }
    await hostInvoke(app, 'gateway', 'stop');
    await expect.poll(() => app.evaluate((_electron, pid) => {
      try { process.kill(pid, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
    }, nativeBefore.pid!), { timeout: 15000 }).toBe(false);
    const nativeAfter = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
    const forcedAttempts = handoffMode === 'on' ? await app.evaluate(() => (
      (globalThis as Record<PropertyKey, unknown>)[Symbol.for('clawx.r1.taskkill-failure')] as { attempts: number }
    ).attempts) : 0;
    if (handoffMode === 'on') expect(forcedAttempts).toBe(1);
    await writeFile(testInfo.outputPath('r1-native-stop.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-r1-native-stop',
      mode: handoffMode === 'on' ? 'taskkill-failure' : 'normal', nativeBefore, nativeAfter, forcedAttempts, kernelPidExited: true }, null, 2));
    const sourceDb = join(sourceState, 'state/openclaw.sqlite');
    const retainedDb = testInfo.outputPath('owner.sqlite');
    await copyFile(sourceDb, retainedDb);
    try { await copyFile(sourceDb + '-wal', retainedDb + '-wal'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    // A stopped SQLite owner may still have committed pages in its WAL.
    // Re-open the retained database, not the live connection used by assertions.
    const retained = new DatabaseSync(retainedDb, { readOnly: true });
    try {
      const raw = (retained.prepare('SELECT payload_json FROM subagent_runs').all() as Array<{ payload_json: string }>).map(row => JSON.parse(row.payload_json));
      expect(raw.filter(row => row.orchestration?.orchestrationRunId === result.orchestrationRunId
        && row.outcome?.status === 'ok' && Number.isFinite(row.endedAt))).toHaveLength(2);
    } finally { retained.close(); }
  } finally {
    try { await captureR1OwnerState(app, sourceState, testInfo, { handoffMode, calls, requests, providerLog: llm.log, anomalies: llm.anomalies }); }
    catch (error) { console.error('[r1-owner-observation]', String(error)); }
    releaseFirst();
    await closeElectronApp(app);
    llm.server.closeAllConnections();
    await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
}

for (const spendMode of ['tokens', 'USD'] as const) {
test(`R1 provider owner prevents concurrent host overspend and reconciles actual usage (${spendMode})`, async ({ launchElectronApp, homeDir, userDataDir }, testInfo) => {
  test.setTimeout(360_000);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const llm = await startScriptedLlm(async text => {
    const marker = text.includes('SPEND-CHILD') ? 'child' : text.lastIndexOf('SPEND-AFTER') > text.lastIndexOf('SPEND-SECOND') ? 'after'
      : text.includes('SPEND-SECOND') ? 'second' : 'first';
    calls.push(marker);
    if (marker === 'first') await gate;
    return { text: `## Summary\nSPEND-${marker}-RECEIPT\n## Verification\nAgent-driven scope receipt; no source edits requested.` };
  });
  const requests = observeProviderRequests(llm.server);
  const workspace = join(homeDir, 'r1-budget-workspace');
  await mkdir(workspace, { recursive: true });
  initializeIndependentGitWorkspace(workspace);
  const config = buildMockProviderConfig(llm.port, workspace);
  const spendPolicy = spendMode === 'USD'
    ? { host: { maxTokens: 500000, maxCostUsd: 0.3 }, project: { maxTokens: 500000, maxCostUsd: 1 }, session: { maxTokens: 500000, maxCostUsd: 0.5 } }
    : { host: { maxTokens: 200000 }, project: { maxTokens: 200000 }, session: { maxTokens: 200000 } };
  (config.runtime as Record<string, unknown>).providerBudget = spendPolicy;
  const budgetModel = (config.models as { providers: { openai: { models: Array<Record<string, unknown>> } } }).providers.openai.models[0];
  const fixturePricing = { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 };
  const expectedCostMicros = spendMode === 'USD'
    ? SCRIPTED_LLM_USAGE.prompt_tokens * fixturePricing.input + SCRIPTED_LLM_USAGE.completion_tokens * fixturePricing.output
    : null;
  const expectedTokens = SCRIPTED_LLM_USAGE.total_tokens;
  budgetModel.reasoning = true;
  budgetModel.compat = { supportsReasoningEffort: true, supportedReasoningEfforts: ['low', 'medium', 'high'] };
  if (spendMode === 'USD') budgetModel.cost = fixturePricing;
  const sourceState = join(userDataDir, 'openclaw-source-state');
  await mkdir(sourceState, { recursive: true });
  await writeFile(join(homeDir, '.openclaw/openclaw.json'), JSON.stringify(config));
  await writeFile(join(sourceState, 'openclaw.json'), JSON.stringify(config));
  const app = await launchElectronApp({ skipSetup: true, env: { TEMP: 'D:/tmp', TMP: 'D:/tmp' } });
  const readCalls = () => {
    const db = new DatabaseSync(join(sourceState, 'state/openclaw.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT call_id, run_id, scope_json, state, reserved_tokens, reserved_cost_micros, actual_tokens, actual_cost_micros FROM provider_spend_calls').all(); }
    finally { db.close(); }
  };
  try {
    await getStableWindow(app);
    const active = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'getActive');
    await hostInvoke(app, 'workspaces', 'update', { id: active.activeWorkspace.id, rootPath: workspace, permissionMode: 'fullAccess' });
    await startGateway(app);
    await expect.poll(async () => { try { await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.list', params: {} }); return true; } catch { return false; } }, { timeout: 120_000 }).toBe(true);
    const create = async (label: string) => {
      const result = await hostInvoke<{ key?: string; sessionKey?: string }>(app, 'gateway', 'rpc', { method: 'sessions.create', params: { agentId: 'main', label } });
      const key = result.key ?? result.sessionKey;
      if (!key) throw new Error('Session owner did not return an admitted session identity: ' + JSON.stringify(result));
      return { key };
    };
    const first = await create('R1 first spend'), second = await create('R1 second spend');
    const send = (sessionKey: string, message: string) => hostInvoke<{ runId: string }>(app, 'gateway', 'rpc', {
      method: 'chat.send', params: { sessionKey, message, idempotencyKey: message },
    });
    await expect(hostInvoke(app, 'gateway', 'rpc', { method: 'chat.send', params: { sessionKey: first.key,
      workspaceId: 'forged-project-scope', message: 'SPEND-SCOPE-FORGERY', idempotencyKey: 'scope-forgery' } })).rejects.toThrow(/workspace.*scope|scope.*workspace/i);
    const acceptedFirst = await send(first.key, 'SPEND-FIRST');
    await expect.poll(() => calls.includes('first'), { timeout: 120_000 }).toBe(true);
    const held = readCalls();
    expect(held).toHaveLength(1);
    expect(Number(held[0].reserved_tokens)).toBeGreaterThan(100000);
    if (spendMode === 'USD') expect(Number(held[0].reserved_cost_micros)).toBeGreaterThan(200000);
    const acceptedSecond = await send(second.key, 'SPEND-SECOND');
    const secondEnd = await hostInvoke<{ status: string }>(app, 'gateway', 'rpc', { method: 'agent.wait', timeoutMs: 120_000,
      params: { runId: acceptedSecond.runId, timeoutMs: 60_000 } });
    expect(secondEnd.status).toBe('error');
    expect(calls).toEqual(['first']);
    expect(readCalls()).toHaveLength(1);
    release();
    await expect.poll(() => readCalls().some(row => row.actual_tokens === expectedTokens), { timeout: 120_000 }).toBe(true);
    const after = await send(second.key, 'SPEND-AFTER');
    await expect.poll(() => calls.includes('after'), { timeout: 120_000 }).toBe(true);
    await expect.poll(() => readCalls().filter(row => row.actual_tokens === expectedTokens).length, { timeout: 120_000 }).toBe(2);
    const child = await hostInvoke<{ spawnedRunIds: string[] }>(app, 'gateway', 'rpc', { method: 'orchestrator.run', timeoutMs: 60_000,
      params: { task: 'Verify inherited project budget', sessionKey: first.key, maxWorkers: 1, includeVerifier: false,
        workers: [{ roleName: 'implementer', task: 'SPEND-CHILD: report the controlled scope receipt', writeSet: ['scope-receipt.txt'] }] } });
    expect(child.spawnedRunIds).toHaveLength(1);
    await expect.poll(() => readCalls().filter(row => child.spawnedRunIds.includes(String(row.run_id)) && row.actual_tokens === expectedTokens).length,
      { timeout: 120_000 }).toBe(1);
    const childCalls = readCalls().filter(row => child.spawnedRunIds.includes(String(row.run_id)));
    expect(childCalls.every(row => JSON.parse(String(row.scope_json)).workspaceId === active.activeWorkspace.id)).toBe(true);
    expect(calls).toContain('child');
    const settledState = spendMode === 'USD' ? 'settled' : 'unknown';
    await expect.poll(() => readCalls().every(row => row.actual_tokens === expectedTokens && row.state === settledState), { timeout: 120_000 }).toBe(true);
    const settled = readCalls();
    if (spendMode === 'USD') expect(settled.every(row => Number(row.actual_cost_micros) === expectedCostMicros)).toBe(true);
    else expect(settled.every(row => row.actual_cost_micros === null && row.state === 'unknown')).toBe(true);
    const record = { driven_by: 'agent', actor: 'codex-r1-electron-spend', spendMode, spendPolicy, pricingSource: 'scripted-fixture model configuration', fixtureUsage: SCRIPTED_LLM_USAGE, fixturePricing: budgetModel.cost, expectedCostMicros, expectedTokens, held, settled, calls, acceptedFirst, acceptedSecond, secondEnd, after, child, childCalls,
      limits: ['scripted provider, real Host/Gateway/provider owner', 'same-workspace three-scope allocation; multiple state directories not measured'] };
    await writeFile(testInfo.outputPath('r1-spend-owner.json'), JSON.stringify(record, null, 2));
    await hostInvoke(app, 'gateway', 'stop');
    const source = join(sourceState, 'state/openclaw.sqlite'), retained = testInfo.outputPath('spend.sqlite');
    await copyFile(source, retained);
    try { await copyFile(source + '-wal', retained + '-wal'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const db = new DatabaseSync(retained, { readOnly: true });
    try {
      expect(db.prepare('SELECT actual_tokens FROM provider_spend_calls WHERE actual_tokens = ?').all(expectedTokens).length).toBeGreaterThanOrEqual(3);
      for (const runId of child.spawnedRunIds) expect(db.prepare('SELECT scope_key FROM provider_spend_allocations INNER JOIN provider_spend_calls USING (call_id) WHERE run_id = ?').all(runId)).toHaveLength(3);
    }
    finally { db.close(); }
  } finally {
    try { await captureR1OwnerState(app, sourceState, testInfo, { spendMode, calls, requests, providerLog: llm.log, anomalies: llm.anomalies }); }
    catch (error) { console.error('[r1-owner-observation]', String(error)); }
    release();
    await closeElectronApp(app);
    llm.server.closeAllConnections();
    await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
}
