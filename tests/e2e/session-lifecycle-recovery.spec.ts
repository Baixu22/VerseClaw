// driven_by: agent; requested_route: ccs-workbuddy/deepseek-v4.1-flash
// Real Electron/Main/Gateway. Inject provider timing, Host reply faults and exact gate-clear write failures.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import type { WorkspaceCoordinatorBindingResult } from '../../shared/host-api/contract';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { closeElectronApp, expect, getStableWindow, hoverUntilVisible, test } from './fixtures/electron';
import { openSessionNavigation } from './fixtures/session-navigation';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, createSessionChainTask } from './fixtures/session-task-chain';

type Launch = (options: { skipSetup: boolean }) => Promise<ElectronApplication>;
type Request = { id?: string; module: string; action: string; payload?: Record<string, unknown> };
type Reply = { ok: boolean; data?: { success?: boolean; [key: string]: unknown }; error?: unknown };
type Fault = { module: string; action: string; sessionKey: string; method?: string; at: 'before' | 'after' | 'observe';
  phase?: string; hits?: number; outcome?: 'reject' | 'drop' | 'pass'; release?: () => void; request?: Request; reply?: Reply };
type GateRecord = { operationId: string; operationKind: 'archive' | 'restore' | 'delete'; sessionKey: string;
  expectedSessionId?: string; requestDigest?: string; localSweepCommitted?: boolean };
type GateFault = { path: string; attempts: GateRecord[]; phase: string; release?: () => void;
  restore: () => void; read: () => Promise<GateRecord | null> };
type Globals = typeof globalThis & { u5Fault?: Fault; u5Calls: Request[]; u5Restore: () => void; u5Gate?: GateFault };
type Context = { app: ElectronApplication; page: Page; project: Awaited<ReturnType<typeof createSessionChainProject>>;
  neighbour: string; facts: Record<string, unknown>; releaseProvider?: () => void; closeProvider?: () => Promise<void> };
const contexts = new Map<string, Context>();
const rpc = <T,>(app: ElectronApplication, method: string, params: Record<string, unknown>) =>
  hostInvoke<T>(app, 'gateway', 'rpc', { method, params, timeoutMs: 30_000 });

async function setup(launch: Launch, info: TestInfo, providerPort?: number) {
  test.setTimeout(300_000);
  const app = await launch({ skipSetup: true });
  const page = await getStableWindow(app);
  if (providerPort) await configureSessionChainProvider(app, providerPort);
  const project = await createSessionChainProject(app, info.outputPath('workspace'), 'U5 lifecycle');
  const neighbour = (await rpc<{ key: string }>(app, 'sessions.create', { agentId: 'main', parentSessionKey: project.sessionKey, label: 'U5 neighbour' })).key;
  for (const [key, draft] of [[project.sessionKey, 'U5 draft A'], [neighbour, 'U5 draft B']]) {
    await rpc(app, 'chat.inject', { sessionKey: key, message: `Transcript ${draft}`, label: 'agent fixture' });
    await hostInvoke(app, 'workspaces', 'saveState', { id: project.workspaceId, sessionKey: key, state: { draftInput: draft } });
  }
  const facts = { driven_by: 'agent', actor: 'playwright-u5-lifecycle', requested_route: 'ccs-workbuddy/deepseek-v4.1-flash',
    case: info.title, project, neighbour, recovery: 'existing owner reads; archive/restore/delete also retry the persisted Main gate operationId',
    faultInjection: 'before: no forwarding; after: real Main success reply held/dropped; gate-clear: temp write fails only after real Runtime commit' };
  const context: Context = { app, page, project, neighbour, facts };
  contexts.set(info.testId, context);
  await app.evaluate(({ ipcMain }) => {
    const state = globalThis as Globals;
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<Reply>> })._invokeHandlers.get('host:invoke');
    if (!original) throw new Error('host:invoke missing');
    state.u5Calls = [];
    state.u5Restore = () => { state.u5Fault?.release?.(); ipcMain.removeHandler('host:invoke'); ipcMain.handle('host:invoke', original); };
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Request) => {
      const payload = request.payload ?? {};
      const params = payload.params as Record<string, unknown> | undefined;
      const f = state.u5Fault;
      const matches = f && request.module === f.module && request.action === f.action
        && (payload.sessionKey ?? payload.id ?? params?.sessionKey) === f.sessionKey
        && (!f.method || payload.method === f.method);
      if (!matches) return original(event, request);
      state.u5Calls.push(request);
      f.hits = (f.hits ?? 0) + 1;
      if (f.hits > 1) return original(event, request);
      f.request = request;
      if (f.at === 'observe') { f.reply = await original(event, request); f.phase = 'finished'; return f.reply; }
      if (f.at === 'after') f.reply = await original(event, request);
      f.phase = f.at === 'before' ? 'before-owner' : 'after-owner';
      await new Promise<void>(resolve => { f.release = resolve; });
      if (f.outcome === 'pass') {
        const result = f.reply ?? await original(event, request); f.reply = result; f.phase = 'finished'; return result;
      }
      f.phase = 'finished';
      return { id: request.id, ok: false, error: { code: f.outcome === 'reject' ? 'FORBIDDEN' : 'TIMEOUT',
        message: `agent-injected ${f.outcome === 'reject' ? 'precommit rejection' : 'reply loss after owner result'}` } };
    });
  });
  await page.reload(); await select(context, project.sessionKey);
  return context;
}

async function select(c: Context, key: string) {
  const back = c.page.getByTestId('settings-back-button');
  if (await back.isVisible()) { await back.focus(); await back.press('Enter'); }
  const family = c.page.getByTestId(`chat-session-derived-${key}`).or(c.page.getByTestId(`chat-session-item-${key}`));
  if (key === c.neighbour) {
    await openSessionNavigation(c.page);
    const window = await c.app.browserWindow(c.page);
    await window.evaluate(window => { window.show(); window.focus(); }); await window.dispose();
    await c.page.bringToFront();
    await expect(family).toHaveCount(1);
    await expect(family).toBeVisible();
    await family.click();
    try { await expect(c.page.getByTestId('chat-composer-input')).toHaveValue('U5 draft B'); }
    finally {
      const navigation = c.facts.navigation as unknown[] ?? []; c.facts.navigation = navigation;
      navigation.push({ target: key, at: Date.now(), selection: await c.page.getByTestId('chat-header-session-name').textContent(),
        draft: await c.page.getByTestId('chat-composer-input').inputValue(),
        workspace: await hostInvoke(c.app, 'workspaces', 'getActive'),
        selectedRows: await c.page.locator('[data-hook-selected="true"]').evaluateAll(rows => rows.map(row => row.textContent)) });
    }
    return;
  }
  const row = c.page.getByTestId(`sidebar-session-${key}`);
  await expect(row).toBeVisible({ timeout: 30_000 }); await row.focus(); await row.press('Enter');
  await expect(row.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," sidebar-row ")][1]'))
    .toHaveAttribute('data-hook-selected', 'true');
}
async function arm(c: Context, action: string, at: Fault['at']) {
  const f: Fault = { sessionKey: c.project.sessionKey, action, at, module: ['pauseCoordinator', 'bindCoordinator'].includes(action) ? 'workspaces' : 'sessions' };
  if (action === 'chat.abort') Object.assign(f, { module: 'gateway', action: 'rpc', method: action });
  await c.app.evaluate((_electron, value) => { (globalThis as Globals).u5Fault = value; }, f);
}
async function fault(c: Context) {
  return c.app.evaluate(() => { const f = (globalThis as Globals).u5Fault; return f ? { ...f, release: undefined } : null; });
}
async function held(c: Context, at: 'before' | 'after') {
  await expect.poll(async () => (await fault(c))?.phase).toBe(`${at}-owner`);
  if (at === 'after') {
    const result = (await fault(c))!.reply!;
    expect(result.ok).toBe(true); expect(result.data?.success).not.toBe(false);
  }
}
async function release(c: Context, outcome: 'reject' | 'drop' | 'pass') {
  await c.app.evaluate((_electron, value) => { const f = (globalThis as Globals).u5Fault!; f.outcome = value; f.release?.(); }, outcome);
  await expect.poll(async () => (await fault(c))?.phase).toBe('finished');
  expect((await fault(c))?.hits).toBe(1);
}
async function neighbourUnchanged(c: Context, url: string) {
  expect(c.page.url()).toBe(url);
  await expect(c.page.getByTestId('chat-composer-input')).toHaveValue('U5 draft B');
  const profile = await hostInvoke<{ activeWorkspace: WorkspaceProfile }>(c.app, 'workspaces', 'getActive');
  expect(profile.activeWorkspace.activeSessionKey).toBe(c.neighbour);
}
async function openCoordinator(c: Context) {
  if (!await c.page.getByTestId('resource-popover').isVisible()) await c.page.getByTestId('resource-chip').click();
  return c.page.getByTestId('long-session-coordinator');
}
async function ownerBinding(c: Context) {
  return hostInvoke<WorkspaceCoordinatorBindingResult>(c.app, 'workspaces', 'resolveCoordinator', {
    workspaceId: c.project.workspaceId, agentId: 'main', sessionKey: c.project.sessionKey,
  });
}
async function lifecycleRead(c: Context) {
  const live = await rpc<{ sessions: Array<{ key: string; sessionId: string }> }>(c.app, 'sessions.list', {});
  const archived = await hostInvoke<{ entries: Array<{ sessionKey: string; sessionsJsonSnapshot: { sessionId?: string } }> }>(c.app, 'sessions', 'listArchived', { agentId: 'main' });
  const session = live.sessions.find(s => s.key === c.project.sessionKey), entry = archived.entries.find(s => s.sessionKey === c.project.sessionKey);
  if (entry && !entry.sessionsJsonSnapshot?.sessionId) throw new Error('Archive owner omitted the saved session generation');
  return { live: session ? { key: session.key, sessionId: session.sessionId } : null,
    archived: entry ? { sessionKey: entry.sessionKey, sessionId: entry.sessionsJsonSnapshot.sessionId! } : null };
}

// Fail only the removal of the exact persisted gate, before atomic-write can unlink it.
// sessions-api reaches this write after validating the Runtime's committed receipt.
async function failGateClear(c: Context, action: GateRecord['operationKind']) {
  await c.app.evaluate(async (_electron, input) => {
    const fs = process.mainModule!.require('node:fs/promises') as typeof import('node:fs/promises');
    const path = process.mainModule!.require('node:path') as typeof import('node:path');
    const os = process.mainModule!.require('node:os') as typeof import('node:os');
    const { syncBuiltinESMExports } = process.mainModule!.require('node:module') as typeof import('node:module');
    const gatePath = path.resolve(process.env.OPENCLAW_CONFIG_DIR?.trim() || path.join(os.homedir(), '.openclaw'),
      'runtime-lifecycle-governance', 'session-delete-gates.json');
    (globalThis as Globals).u5Gate?.restore();
    const open = fs.open;
    const read = async () => {
      try {
        const doc = JSON.parse(await fs.readFile(gatePath, 'utf8')) as { gates: Record<string, GateRecord> };
        return Object.values(doc.gates).find(g => g.sessionKey === input.sessionKey && g.operationKind === input.action) ?? null;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    };
    const state: GateFault = { path: gatePath, attempts: [], phase: 'armed', read,
      restore: () => { state.release?.(); fs.open = open; syncBuiltinESMExports(); } };
    (globalThis as Globals).u5Gate = state;
    fs.open = async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      const file = path.resolve(String(args[0]));
      if (path.dirname(file) !== path.dirname(gatePath) || !path.basename(file).startsWith('.session-delete-gates.json.') || !file.endsWith('.tmp')) return handle;
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (data, options) => {
        const next = JSON.parse(String(data)) as { gates?: Record<string, GateRecord> };
        const current = await read();
        if (current && next.gates && !next.gates[current.operationId]) {
          state.attempts.push(current);
          if (state.attempts.length === 1) {
            state.phase = 'committed-before-gate-clear';
            await new Promise<void>(resolve => { state.release = resolve; });
            state.phase = 'clear-failed';
            throw Object.assign(new Error('agent-injected gate-clear failure after Runtime commit'), { code: 'EIO' });
          }
          if (current.operationId !== state.attempts[0].operationId) throw new Error('Lifecycle retry changed operationId');
        }
        return write(data, options);
      };
      return handle;
    };
    syncBuiltinESMExports();
  }, { action, sessionKey: c.project.sessionKey });
}
async function gateState(c: Context) {
  return c.app.evaluate(async () => {
    const g = (globalThis as Globals).u5Gate!;
    return { path: g.path, attempts: g.attempts, phase: g.phase, persisted: await g.read() };
  });
}
type LifecycleReceipt = { ok: boolean; key: string; operationId: string; journalState: string;
  archived?: boolean; restored?: boolean; deleted?: boolean; sessionId?: string; previousSessionId?: string;
  entry?: { sessionId: string } };
async function committedReceipt(c: Context, action: GateRecord['operationKind'], operationId: string) {
  const receipt = await rpc<LifecycleReceipt>(c.app, `sessions.${action}`, { key: c.project.sessionKey, operationId,
    ...(action === 'delete' ? { deleteTranscript: true } : {}) });
  expect(receipt).toMatchObject({ ok: true, key: c.project.sessionKey, operationId, journalState: 'runtime_committed',
    [action === 'archive' ? 'archived' : action === 'restore' ? 'restored' : 'deleted']: true });
  return receipt;
}
async function archivePage(c: Context) {
  await c.page.getByTestId('sidebar-footer-menu-trigger').click(); await c.page.getByTestId('sidebar-archive').click();
  await expect(c.page.getByTestId('settings-archived-section')).toBeVisible();
}
async function deleteDialog(c: Context) {
  const key = c.project.sessionKey, row = c.page.getByTestId(`sidebar-session-${key}`);
  await hoverUntilVisible(row, c.page.getByTestId(`sidebar-session-more-${key}`));
  await c.page.getByTestId(`sidebar-session-more-${key}`).click();
  await c.page.getByTestId('sidebar-session-context-delete').click();
}

// eslint-disable-next-line no-empty-pattern -- Playwright hooks require a destructured fixture argument.
test.afterEach(async ({}, info) => {
  const c = contexts.get(info.testId); if (!c) return;
  try {
    c.facts.lastFault = await fault(c).catch(error => ({ error: String(error) }));
    c.facts.lastGate = await gateState(c).catch(error => ({ error: String(error) }));
    c.facts.ownerReadback = await lifecycleRead(c).catch(error => ({ error: String(error) }));
    await c.page.screenshot({ path: info.outputPath('lifecycle-state.png'), timeout: 5000 }).catch(() => undefined);
    await writeFile(info.outputPath('lifecycle-proof.json'), JSON.stringify({ ...c.facts, status: info.status,
      errors: info.errors.map(error => error.message ?? error.stack) }, null, 2) + '\n');
  } finally {
    await c.app.evaluate(() => (globalThis as Globals).u5Restore()).catch(() => undefined);
    await c.app.evaluate(() => (globalThis as Globals).u5Gate?.restore()).catch(() => undefined);
    c.releaseProvider?.();
    await hostInvoke(c.app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(c.app);
    await c.closeProvider?.(); contexts.delete(info.testId);
  }
});

test('U5 current-run Stop retries without its old error and reconciles a lost reply without changing the neighbour', async ({ launchElectronApp }, info) => {
  let releaseProvider!: () => void, providerHeld = false;
  const barrier = new Promise<void>(resolve => { releaseProvider = resolve; });
  const llm = await startScriptedLlm(async text => { if (text.includes('U5-HOLD')) { providerHeld = true; await barrier; } return { text: 'U5 provider settled' }; });
  const c = await setup(launchElectronApp, info, llm.port).catch(async error => {
    releaseProvider(); llm.server.closeAllConnections();
    await new Promise<void>(resolve => llm.server.close(() => resolve())); throw error;
  });
  c.releaseProvider = releaseProvider;
  c.closeProvider = async () => { llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve())); };
  const sent = await hostInvoke<{ success: boolean; result: { runId: string } }>(c.app, 'chat', 'sendWithMedia', {
    workspaceId: c.project.workspaceId, sessionKey: c.project.sessionKey, message: 'U5-HOLD', idempotencyKey: 'u5-stop-run',
  });
  expect(sent.success).toBe(true); c.facts.runId = sent.result.runId;
  await expect.poll(() => providerHeld, { timeout: 90_000 }).toBe(true);
  const input = c.page.getByTestId('chat-composer-input'), stop = c.page.getByTestId('chat-composer-send');
  await input.fill(''); await expect(stop).toHaveAttribute('data-send-state', 'running');
  await arm(c, 'chat.abort', 'before'); await stop.focus(); await stop.press('Enter'); await held(c, 'before');
  await expect(stop).not.toHaveAttribute('data-send-state', 'paused');
  const running = await rpc<{ session: { hasActiveRun: boolean } }>(c.app, 'sessions.describe', { key: c.project.sessionKey });
  expect(running.session.hasActiveRun).toBe(true);
  await input.fill('U5 unsent A'); await release(c, 'reject');
  await expect(c.page.getByText('Could not confirm the stop. Refresh the session to check its status.', { exact: true })).toBeVisible();
  await expect(input).toHaveValue('U5 unsent A'); await expect(stop).not.toHaveAttribute('data-send-state', 'paused');
  c.facts.rejection = await fault(c);
  await c.page.waitForTimeout(100);
  await input.fill(''); await expect(stop).toHaveAttribute('data-send-state', 'running'); await arm(c, 'chat.abort', 'before'); await stop.focus(); await stop.press('Enter'); await held(c, 'before');
  await expect(c.page.getByTestId('chat-error')).toHaveCount(0);
  await expect(stop).not.toHaveAttribute('data-send-state', 'paused');
  await input.fill('U5 unsent A'); await release(c, 'pass');
  const retriedStop = await fault(c);
  expect(retriedStop?.request?.payload?.params).toMatchObject({ sessionKey: c.project.sessionKey, runId: sent.result.runId });
  expect(retriedStop?.reply?.data).toMatchObject({ aborted: true, runIds: [sent.result.runId] });
  await expect(stop).toHaveAttribute('data-send-state', 'paused');
  await expect(c.page.getByTestId('chat-error')).toHaveCount(0);
  await expect(input).toHaveValue('U5 unsent A');
  expect((await rpc<{ session: { hasActiveRun: boolean; sessionId: string } }>(c.app, 'sessions.describe', { key: c.project.sessionKey })).session)
    .toMatchObject({ hasActiveRun: false, sessionId: c.project.generation });
  c.facts.sameRunRetry = { fault: retriedStop, paused: true, staleErrorVisible: false,
    operationId: 'not_applicable: chat.abort accepts sessionKey/runId only' };

  // A second real run exercises post-commit reply loss separately from the rejected call.
  await stop.focus(); await stop.press('Enter'); await expect(stop).not.toHaveAttribute('data-send-state', 'paused');
  providerHeld = false;
  const second = await hostInvoke<{ success: boolean; result: { runId: string } }>(c.app, 'chat', 'sendWithMedia', {
    workspaceId: c.project.workspaceId, sessionKey: c.project.sessionKey, message: 'U5-HOLD-SECOND', idempotencyKey: 'u5-stop-second-run',
  });
  expect(second.success).toBe(true); expect(second.result.runId).not.toBe(sent.result.runId);
  await expect.poll(() => providerHeld, { timeout: 90_000 }).toBe(true);
  await input.fill(''); await expect(stop).toHaveAttribute('data-send-state', 'running');
  await arm(c, 'chat.abort', 'after'); await stop.focus(); await stop.press('Enter'); await held(c, 'after');
  expect((await fault(c))!.reply?.data).toMatchObject({ aborted: true, runIds: [second.result.runId] });
  await input.fill('U5 unsent A'); await select(c, c.neighbour); const neighbourUrl = c.page.url();
  await release(c, 'drop'); await neighbourUnchanged(c, neighbourUrl);
  c.facts.lostSuccess = await fault(c);
  await select(c, c.project.sessionKey); await c.page.getByTestId('chat-toolbar-more').click(); await c.page.getByTestId('chat-toolbar-refresh').click();
  await expect.poll(async () => (await rpc<{ session: { hasActiveRun: boolean } }>(c.app, 'sessions.describe', { key: c.project.sessionKey })).session.hasActiveRun).toBe(false);
  await expect(stop).not.toHaveAttribute('data-send-state', /^(running|running-with-draft|starting)$/);
  await expect(input).toHaveValue('U5 unsent A');
  c.facts.reconciled = { sessionKey: c.project.sessionKey, activeRun: false, via: 'existing refresh + sessions.describe', operationReplay: 'not_applicable: chat.abort has no lifecycle operationId' };
});

test('U5 coordinator pause and resume reject before commit and recover lost acknowledgements through the scoped owner read', async ({ launchElectronApp }, info) => {
  const c = await setup(launchElectronApp, info);
  const task = await createSessionChainTask(c.app, c.project.workspaceId, 'u5-coordinator-task', { objective: 'U5 coordinator control',
    target: 'proof.txt', constraints: [], acceptance: [{ id: 'proof', description: 'Exact proof',
      verification: { kind: 'file-sha256', path: 'proof.txt', sha256: createHash('sha256').update('proof').digest('hex') } }] });
  await hostInvoke(c.app, 'taskLedger', 'linkSession', { workspaceId: c.project.workspaceId, sessionKey: c.project.sessionKey,
    sessionGeneration: c.project.generation, nodeId: task.contract.taskNodeId });
  await hostInvoke(c.app, 'workspaces', 'bindCoordinator', { workspaceId: c.project.workspaceId, agentId: 'main',
    sessionKey: c.project.sessionKey, expectedRevision: 0, taskLedgerNodeIds: [task.contract.taskNodeId],
    environment: { kind: 'local', rootPath: c.project.rootPath }, archiveRestorePolicy: 'restore' });
  await c.page.reload(); await select(c, c.project.sessionKey);
  const observations: Array<Record<string, unknown>> = []; c.facts.coordinator = observations;
  for (const [button, action, before, after] of [['pause', 'pauseCoordinator', 'active', 'paused'], ['resume', 'bindCoordinator', 'paused', 'active']] as const) {
    const panel = await openCoordinator(c), control = c.page.getByTestId(`coordinator-${button}`);
    const prior = await ownerBinding(c);
    await expect(panel).toHaveAttribute('data-state', before);
    await arm(c, action, 'before'); await control.click(); await held(c, 'before');
    await expect(control).toBeDisabled(); await expect(panel).toHaveAttribute('data-state', before);
    expect((await ownerBinding(c)).binding?.bindingRevision).toBe(prior.binding?.bindingRevision);
    await release(c, 'reject'); await expect(c.page.getByTestId('coordinator-error')).toBeVisible();
    await expect(control).toBeEnabled(); await expect(c.page.getByTestId('chat-composer-input')).toHaveValue('U5 draft A');
    const rejection = await fault(c);
    await arm(c, action, 'after'); await control.click(); await held(c, 'after');
    const committed = await ownerBinding(c); expect(committed.binding?.state).toBe(after);
    await c.page.getByTestId('resource-popover-close').click(); await select(c, c.neighbour); const url = c.page.url();
    await release(c, 'drop'); await neighbourUnchanged(c, url); const lost = await fault(c);
    await select(c, c.project.sessionKey);
    await expect(await openCoordinator(c)).toHaveAttribute('data-state', after);
    const reread = await ownerBinding(c); expect(reread.binding?.bindingRevision).toBe(committed.binding?.bindingRevision);
    expect((lost?.request?.payload as { expectedRevision?: number }).expectedRevision).toBe(prior.binding?.bindingRevision);
    expect(reread.binding?.sessionGeneration).toBe(c.project.generation);
    observations.push({ action, rejection, lost, committed, reread, via: 'resolveCoordinator on existing resource-chip entry',
      operationId: 'not_applicable: coordinator writes use expectedRevision; do not replay a stale revision as a new action' });
  }
});

test('U5 archive restore and confirmed delete retry their retained operationId after Runtime commit and a Main gate-clear failure', async ({ launchElectronApp }, info) => {
  const c = await setup(launchElectronApp, info); const records: Array<Record<string, unknown>> = []; c.facts.lifecycle = records;
  const key = c.project.sessionKey;
  for (const action of ['archive', 'restore', 'delete'] as const) {
    if (action === 'restore') await archivePage(c); else await select(c, key);
    const invokeUi = async () => {
      if (action === 'restore') await c.page.getByTestId(`settings-archived-restore-${key}`).click();
      else { await deleteDialog(c); await c.page.getByTestId(action === 'archive' ? 'session-delete-dialog-archive' : 'session-delete-dialog-permanent').click(); }
    };
    const before = await lifecycleRead(c);
    if (action === 'delete') {
      await deleteDialog(c); await c.page.getByTestId('session-delete-dialog-cancel').click();
      expect(await lifecycleRead(c)).toEqual(before);
    }
    await arm(c, action, 'before'); await invokeUi(); await held(c, 'before');
    expect(await lifecycleRead(c)).toEqual(before);
    await expect(c.page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    if (action === 'restore') await expect(c.page.getByTestId(`settings-archived-restore-${key}`)).toBeDisabled();
    else { await expect(c.page.getByTestId(`sidebar-session-${key}`)).toBeVisible(); await expect(c.page.getByTestId('chat-composer-input')).toHaveValue('U5 draft A'); }
    await release(c, 'reject'); expect(await lifecycleRead(c)).toEqual(before);
    if (action === 'restore') {
      await expect(c.page.getByText('Could not confirm the operation. Refresh the list to check the current state.', { exact: true })).toBeVisible();
      await expect(c.page.getByTestId(`settings-archived-restore-${key}`)).toBeEnabled();
    } else await expect(c.page.getByTestId('chat-composer-input')).toHaveValue('U5 draft A');
    const rejection = await fault(c);
    const record: Record<string, unknown> = { action, before, rejection }; records.push(record);
    await arm(c, action, 'observe'); await failGateClear(c, action); await invokeUi();
    await expect.poll(async () => (await gateState(c)).phase).toBe('committed-before-gate-clear');
    const pendingGate = await gateState(c);
    const operationId = pendingGate.persisted!.operationId;
    expect(pendingGate.persisted).toMatchObject({ sessionKey: key, operationKind: action });
    // This is an original Runtime journal replay. It must return the stored committed receipt.
    const receipt = await committedReceipt(c, action, operationId);
    Object.assign(record, { pendingGate, runtimeCommittedReceipt: receipt });
    await select(c, c.neighbour); const url = c.page.url();
    await c.app.evaluate(() => (globalThis as Globals).u5Gate!.release!());
    await expect.poll(async () => (await fault(c))?.phase).toBe('finished');
    const failedHost = await fault(c);
    expect(failedHost?.reply?.ok).toBe(true);
    expect(failedHost?.reply?.data?.success).toBe(false);
    expect(JSON.stringify(failedHost?.reply)).toContain('agent-injected gate-clear failure after Runtime commit');
    const retained = await gateState(c);
    expect(retained.persisted).toMatchObject({ sessionKey: key, operationId, operationKind: action });
    await neighbourUnchanged(c, url);
    const committed = await lifecycleRead(c);
    if (action === 'archive') { expect(committed.live).toBeNull(); expect(committed.archived).not.toBeNull(); }
    if (action === 'restore') { expect(committed.archived).toBeNull(); expect(committed.live?.sessionId).toBeTruthy(); expect(committed.live?.sessionId).not.toBe(c.project.generation); }
    if (action === 'delete') { expect(committed.live).toBeNull(); expect(committed.archived).toBeNull(); }
    expect(action === 'restore' ? receipt.previousSessionId : receipt.sessionId)
      .toBe(action === 'restore' ? before.archived!.sessionId : before.live!.sessionId);
    if (action === 'restore') expect(receipt.entry?.sessionId).toBe(committed.live?.sessionId);
    Object.assign(record, { pendingGate, runtimeCommittedReceipt: receipt, committed });
    Object.assign(record, { failedHost, retainedGate: retained });

    // The saved operation remains reachable even after the original session row disappears.
    await archivePage(c);
    await c.page.getByTestId('settings-archived-refresh').click();
    await expect(c.page.getByTestId(`settings-resume-mutation-${operationId}`)).toBeVisible();
    if (action === 'archive') {
      for (const language of ['en', 'zh', 'ja', 'ru'] as const) {
        const locale = JSON.parse(await readFile('shared/i18n/locales/' + language + '/chat.json', 'utf8'));
        await hostInvoke(c.app, 'settings', 'set', { key: 'language', value: language }); await c.page.reload();
        await expect(c.page.locator('html')).toHaveAttribute('lang', language);
        await expect(c.page.getByTestId('settings-resume-mutation-' + operationId)).toHaveText(locale.archive.resumeMutation);
        await c.page.screenshot({ path: info.outputPath('pending-operation-' + language + '.png') });
      }
      await hostInvoke(c.app, 'settings', 'set', { key: 'language', value: 'en' }); await c.page.reload();
      await expect(c.page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(c.page.getByTestId('settings-resume-mutation-' + operationId)).toHaveText('Check and continue');
    }
    await arm(c, action, 'after');
    const retry = c.page.getByTestId(`settings-resume-mutation-${operationId}`).click();
    void retry.catch(() => undefined);
    try {
      await held(c, 'after');
      expect((await fault(c))?.reply?.data?.success).toBe(true);
      const cleared = await gateState(c);
      expect(cleared.attempts.map(g => g.operationId)).toEqual([operationId, operationId]);
      expect(cleared.persisted).toBeNull();
      expect(await committedReceipt(c, action, operationId)).toEqual(receipt);
      expect(await lifecycleRead(c)).toEqual(committed);
      await select(c, c.neighbour);
      await neighbourUnchanged(c, url); // success reply is still held
      await release(c, 'pass'); await retry;
      await expect.poll(async () => (await fault(c))?.phase).toBe('finished');
      expect((await fault(c))?.reply?.data?.success).toBe(true);
      await neighbourUnchanged(c, url);
      Object.assign(record, { retry: await fault(c), clearedGate: cleared,
        recovered: true, recovery: 'same persisted operationId, original Runtime committed receipt, original Main retry and owner queries',
        retryEntry: 'Archive pending operation row invokes the existing Host action with the exact stored operationId' });
    } finally {
      await c.app.evaluate(() => (globalThis as Globals).u5Gate?.restore());
      await c.app.evaluate(() => { const f = (globalThis as Globals).u5Fault; if (f?.release) { f.outcome = 'pass'; f.release(); } });
      await retry.catch(() => undefined);
    }
    await c.page.getByTestId('chat-toolbar-more').click(); await c.page.getByTestId('chat-toolbar-refresh').click();
    if (action === 'restore') { await archivePage(c); await c.page.getByTestId('settings-archived-refresh').click(); await expect(c.page.getByTestId(`settings-archived-item-${key}`)).toHaveCount(0); await select(c, c.neighbour); }
    else await expect(c.page.getByTestId(`sidebar-session-${key}`)).toHaveCount(0);
    expect(await lifecycleRead(c)).toEqual(committed);
  }
});
