import { openSessionNavigation } from './fixtures/session-navigation';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import { createEmptySessionActivitySnapshot } from '../../shared/types/session-activity';
import { handoffFirstSendKey, type SessionHandoffOperation } from '../../shared/types/session-handoff';
import type { TaskLedgerSnapshot } from '../../shared/types/task-ledger';
import type { WorkspaceProfile, WorkspaceUiState } from '../../shared/types/workspace';
import { closeElectronApp, expect, getAgentDevHostCalls, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { observeSessionUi, setSessionChainViewport } from './fixtures/session-task-chain';

const SOURCE_A = 'agent:main:scope-source-a';
const NEIGHBOR_A = 'agent:main:scope-neighbor-a';
const SOURCE_B = 'agent:main:scope-source-b';
const WORKSPACE_A = 'scope-workspace-a';
const WORKSPACE_B = 'scope-workspace-b';
const TASK_ID = 'scope-fixture-task';
const ARTIFACT_LABEL = 'Scope fixture result';
const ACTOR = 'playwright-session-chain-scope-faults';

type FixtureSession = { key: string; sessionId: string; displayName: string; parentSessionKey?: string; updatedAt: number; messageCount: number };
type FixtureCall = { id?: string; module?: string; action?: string; payload: Record<string, unknown>; data?: unknown; endedAt?: number; held?: boolean };
type ReplyFault = { module: string; action: string; workspaceId?: string; sessionKey?: string; operationId?: string; draftInput?: string;
  taken: boolean; released: boolean; finished: boolean; release?: () => void };
type ScopeFixture = { profiles: WorkspaceProfile[]; activeWorkspaceId: string; sessions: FixtureSession[];
  ledgers: Record<string, TaskLedgerSnapshot>; operations: Record<string, SessionHandoffOperation | null>;
  calls: FixtureCall[]; fault?: ReplyFault };
type FixtureGlobal = typeof globalThis & { __sessionChainScopeFixture?: ScopeFixture };
type Launch = (options?: { skipSetup?: boolean; deviceScaleFactor?: number; env?: Record<string, string> }) => Promise<ElectronApplication>;

function workspace(id: string, key: string, rootPath: string): WorkspaceProfile {
  const state = { draftInput: id === WORKSPACE_A ? 'Source A draft' : 'Source B draft' };
  return { id, name: id === WORKSPACE_A ? 'Scope Project A' : 'Scope Project B', rootPath,
    agentId: 'main', selectedAgentId: 'main', activeSessionKey: key, projectCoordinatorSessionKey: key,
    agentBindings: { main: { workspaceId: id, agentId: 'main', sessionKey: key } }, permissionMode: 'fullAccess',
    state, sessionStates: { [key]: state, ...(id === WORKSPACE_A ? { [NEIGHBOR_A]: { draftInput: 'Neighbor A draft' } } : {}) },
    sessionFolders: [], sessionFolderAssignments: {}, createdAt: 1, updatedAt: 1, lastOpenedAt: 1 } as WorkspaceProfile;
}

function operation(profile: WorkspaceProfile, phase: SessionHandoffOperation['phase']): SessionHandoffOperation {
  const id = `scope-handoff-${profile.id}`;
  const draftInput = `${profile.name} reviewed handoff draft`;
  return { id, workspaceId: profile.id, agentId: 'main', sourceSessionKey: profile.activeSessionKey,
    sourceGeneration: profile.id === WORKSPACE_A ? 'generation-a-1' : 'generation-b-1',
    sessionKey: `${profile.activeSessionKey}-handoff`, sessionGeneration: `${profile.id}-child-generation`,
    draftInput, draftDigest: createHash('sha256').update(draftInput).digest('hex'), firstSendIdempotencyKey: handoffFirstSendKey(id),
    phase, handoffDepth: 1, handoffRootSessionKey: profile.activeSessionKey, rootHandoffId: id,
    createdAt: '2026-11-08T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' };
}

async function installScopeFixture(app: ElectronApplication, root: string, options: { warning?: boolean; handoff?: boolean; unloadedSource?: boolean }) {
  const profiles = [workspace(WORKSPACE_A, SOURCE_A, join(root, 'a')), workspace(WORKSPACE_B, SOURCE_B, join(root, 'b'))];
  await Promise.all(profiles.map((profile) => mkdir(profile.rootPath, { recursive: true })));
  await writeFile(join(root, 'a', 'result.txt'), 'Agent-driven task navigation fixture\n');
  const sessions: FixtureSession[] = [
    { key: SOURCE_A, sessionId: 'generation-a-1', displayName: 'Scope Source A', updatedAt: 3, messageCount: 2,
      ...(options.unloadedSource ? { parentSessionKey: 'agent:main:scope-unloaded-source' } : {}) },
    { key: NEIGHBOR_A, sessionId: 'neighbor-generation', displayName: 'Scope Neighbor A', updatedAt: 2, messageCount: 2 },
    { key: SOURCE_B, sessionId: 'generation-b-1', displayName: 'Scope Source B', updatedAt: 1, messageCount: 2 },
  ];
  const empty = (id: string): TaskLedgerSnapshot => ({ schemaVersion: 1, workspaceId: `ledger-${id}`, sourceWorkspaceId: id,
    generatedAt: '2026-11-08T00:00:00.000Z', nodes: [], edges: [], rootNodeIds: [], activeNodeIds: [], blockedNodeIds: [],
    reviewNodeIds: [], currentGoalId: null, recentDecisions: [], sessionLinks: [], warnings: [], eventsCount: 0 });
  const ledgerA = empty(WORKSPACE_A);
  ledgerA.nodes = [{ id: TASK_ID, kind: 'task', title: 'Scope fixture task', status: 'todo', createdAt: ledgerA.generatedAt,
    updatedAt: ledgerA.generatedAt, evidenceRefs: [{ type: 'file', ref: join(root, 'a', 'result.txt'), label: ARTIFACT_LABEL }] }];
  ledgerA.rootNodeIds = [TASK_ID];
  ledgerA.sessionLinks = [{ id: 'scope-task-link', sessionKey: SOURCE_A, sessionGeneration: 'generation-a-1', nodeId: TASK_ID, createdAt: ledgerA.generatedAt }];
  ledgerA.eventsCount = 2;
  if (options.warning) ledgerA.warnings = [{ type: 'invalid_event', line: 3, message: 'Agent fixture: one Ledger event is invalid.' }];
  const fixture: ScopeFixture = { profiles, activeWorkspaceId: WORKSPACE_A, sessions,
    ledgers: { [WORKSPACE_A]: ledgerA, [WORKSPACE_B]: empty(WORKSPACE_B) }, calls: [],
    operations: { [WORKSPACE_A]: options.handoff ? operation(profiles[0], 'unknown') : null,
      [WORKSPACE_B]: options.handoff ? operation(profiles[1], 'ready') : null } };
  const key = (module: string, action: string) => JSON.stringify([module, action, null]);
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', port: 18789, gatewayReady: true },
    gatewayRpcByMethod: { '*': {} },
    hostApi: {
      [key('agents', 'list')]: { agents: [{ id: 'main', name: 'Main', isDefault: true, mainSessionKey: SOURCE_A,
        workspace: profiles[0].rootPath, modelRef: 'fixture/model', modelDisplay: 'Fixture model' }], defaultAgentId: 'main', configuredChannelTypes: [] },
      [key('providers', 'accounts')]: [{ id: 'scope-provider', name: 'Scope provider', type: 'custom', vendorId: 'custom', enabled: true, authMode: 'api_key', createdAt: 1, updatedAt: 1 }],
      [key('providers', 'accountKeyInfo')]: [{ accountId: 'scope-provider', hasKey: true, keyMasked: 'fixture' }],
      [key('providers', 'getDefaultAccount')]: { accountId: 'scope-provider' },
      [key('providers', 'vendors')]: [],
      [key('sessions', 'compactionStatus')]: { success: true, available: false, canCompact: false, warnings: [] },
      [key('sessions', 'longTaskControlStatus')]: { success: true, available: false },
      [key('sessions', 'listArchived')]: { success: true, entries: [] },
      [key('usage', 'contextRange')]: { success: true, range: null },
      [key('usage', 'live')]: { success: true, usage: null },
      [key('git', 'status')]: { success: true, status: { isRepository: false } },
      [key('git', 'branches')]: { success: true, branches: [] },
      [key('channels', 'accounts')]: { success: true, channels: [] },
    },
  });
  // Main replies are replayed or delayed here; the renderer and its navigation stay real.
  await app.evaluate(({ ipcMain }, input) => {
    const state: ScopeFixture = input.fixture;
    (globalThis as FixtureGlobal).__sessionChainScopeFixture = state;
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers.get('host:invoke')!;
    const snapshot = () => ({ success: true, profiles: state.profiles, activeWorkspaceId: state.activeWorkspaceId,
      activeWorkspace: state.profiles.find((profile) => profile.id === state.activeWorkspaceId) });
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string; payload?: Record<string, unknown> }) => {
      const payload = request.payload ?? {};
      const call: FixtureCall = { id: request.id, module: request.module, action: request.action, payload };
      state.calls.push(call);
      let data: unknown;
      const profile = state.profiles.find((entry) => entry.id === (payload.id ?? payload.workspaceId ?? state.activeWorkspaceId));
      if (request.module === 'workspaces' && ['list', 'getActive'].includes(request.action ?? '')) data = snapshot();
      else if (request.module === 'workspaces' && request.action === 'switch') { state.activeWorkspaceId = String(payload.id); data = snapshot(); }
      else if (request.module === 'workspaces' && request.action === 'saveState' && profile) {
        const target = String(payload.sessionKey ?? payload.activeSessionKey ?? profile.activeSessionKey);
        const patch = payload.state as WorkspaceUiState | undefined;
        profile.sessionStates = { ...profile.sessionStates, [target]: { ...profile.sessionStates?.[target], ...patch } };
        if (typeof payload.activeSessionKey === 'string') {
          profile.activeSessionKey = payload.activeSessionKey;
          profile.agentBindings = { ...profile.agentBindings, main: { workspaceId: profile.id, agentId: 'main', sessionKey: target } };
        }
        profile.state = profile.sessionStates[profile.activeSessionKey] ?? {};
        data = { success: true };
      } else if (request.module === 'taskLedger' && request.action === 'snapshot') data = { success: true, snapshot: state.ledgers[String(payload.workspaceId)] };
      else if (request.module === 'sessions' && request.action === 'handoffOperation') {
        const value = state.operations[String(payload.workspaceId)];
        data = { success: true, operation: value && [value.sourceSessionKey, value.sessionKey].includes(String(payload.sessionKey)) ? value : null };
      } else if (request.module === 'gateway' && request.action === 'rpc' && payload.method === 'sessions.list') data = { sessions: state.sessions, totalCount: state.sessions.length, hasMore: false };
      else if (request.module === 'gateway' && request.action === 'rpc' && payload.method === 'sessions.describe') {
        const key = String((payload.params as { key?: string } | undefined)?.key);
        const child = Object.values(state.operations).find((operation) => operation?.sessionKey === key);
        data = { session: state.sessions.find((session) => session.key === key) ?? (child ? {
          key, sessionId: child.sessionGeneration, parentSessionKey: child.sourceSessionKey,
        } : null) };
      }
      else if ((request.module === 'gateway' && request.action === 'rpc' && payload.method === 'chat.history')
        || (request.module === 'sessions' && request.action === 'history')) {
        data = { success: true, messages: [{ id: 'scope-user', role: 'user', content: 'Scope fixture discussion', timestamp: 1_700_000_000_000 },
          { id: 'scope-assistant', role: 'assistant', content: 'Scope fixture response', timestamp: 1_700_000_000_001 }] };
      } else if (request.module === 'sessionActivity' && request.action === 'snapshot') {
        data = { success: true, snapshot: { ...input.activity, session: { ...input.activity.session, key: String(payload.sessionKey),
          sessionId: state.sessions.find((entry) => entry.key === payload.sessionKey)?.sessionId } } };
      } else return original(event, request);
      data = structuredClone(data);
      const fault = state.fault;
      if (fault && !fault.taken && fault.module === request.module && fault.action === request.action
        && (!fault.workspaceId || fault.workspaceId === (payload.workspaceId ?? payload.id))
        && (!fault.sessionKey || fault.sessionKey === payload.sessionKey)
        && (!fault.operationId || fault.operationId === payload.operationId)
        && (!fault.draftInput || fault.draftInput === (payload.state as WorkspaceUiState | undefined)?.draftInput)) {
        fault.taken = true; call.held = true;
        await new Promise<void>((resolve) => { fault.release = resolve; });
        fault.finished = true;
      }
      call.data = data; call.endedAt = Date.now();
      return { id: request.id, ok: true, data };
    });
  }, { fixture, activity: createEmptySessionActivitySnapshot(SOURCE_A) });
}

async function fixtureState(app: ElectronApplication) {
  return app.evaluate(() => {
    const state = (globalThis as FixtureGlobal).__sessionChainScopeFixture!;
    return { ...state, fault: state.fault ? { ...state.fault, release: undefined } : null };
  });
}

async function armReplyFault(app: ElectronApplication, match: Omit<ReplyFault, 'taken' | 'released' | 'finished' | 'release'>) {
  await app.evaluate((_electron, fault) => {
    (globalThis as FixtureGlobal).__sessionChainScopeFixture!.fault = { ...fault, taken: false, released: false, finished: false };
  }, match);
}

async function releaseReply(app: ElectronApplication) {
  await app.evaluate(() => {
    const fault = (globalThis as FixtureGlobal).__sessionChainScopeFixture?.fault;
    if (fault?.taken && !fault.released) { fault.released = true; fault.release?.(); }
  });
}

async function renderedScope(page: Page) {
  return page.evaluate(() => {
    type Fiber = { return?: Fiber | null; child?: Fiber | null; sibling?: Fiber | null; alternate?: Fiber | null;
      stateNode?: { current?: Fiber }; memoizedProps?: { currentSessionKey?: string; workspaceId?: string;
      sessions?: Array<{ key: string; sessionId?: string }> } };
    const element = document.querySelector('[data-testid="chat-project-session-header"]');
    if (!element) return null;
    const properties = element as unknown as Record<string, unknown>;
    const key = Object.keys(properties).find((name) => name.startsWith('__reactFiber$'));
    let root = key ? properties[key] as Fiber | undefined : undefined;
    let header: Fiber | undefined;
    for (let hop = 0; root && hop < 64; hop += 1) {
      if (typeof root.memoizedProps?.currentSessionKey === 'string' && typeof root.memoizedProps.workspaceId === 'string') header ??= root;
      if (!root.return) break;
      root = root.return;
    }
    // DOM attachments can retain the alternate; read props from the committed root.
    const stack = root?.stateNode?.current ? [root.stateNode.current] : [];
    while (stack.length) {
      const fiber = stack.pop()!;
      const props = fiber.memoizedProps;
      if (header && (fiber === header || fiber === header.alternate)
        && typeof props?.currentSessionKey === 'string' && typeof props.workspaceId === 'string') return {
        sessionKey: props.currentSessionKey, workspaceId: props.workspaceId,
        generation: props.sessions?.find((session) => session.key === props.currentSessionKey)?.sessionId,
        route: window.location.hash.slice(1).split('?')[0] || '/',
        selectedSessionKey: document.querySelector<HTMLElement>('[data-hook-selected="true"][data-hook-key^="agent:"]')?.dataset.hookKey,
      };
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return null;
  });
}

async function expectCurrentScope(page: Page, sessionKey: string, draft: string) {
  await expect.poll(() => renderedScope(page)).toMatchObject({ sessionKey, workspaceId: sessionKey === SOURCE_B ? WORKSPACE_B : WORKSPACE_A });
  // Sidebar selection is gated to /; project pages use their coordinator plus the live Chat header scope.
  if ((await renderedScope(page))?.route === '/') await expect(page.getByTestId(`sidebar-session-${sessionKey}`)
    .locator('xpath=ancestor::div[@data-hook-key][1]')).toHaveAttribute('data-hook-selected', 'true');
  await expect(page.getByTestId('chat-composer-input')).toHaveValue(draft);
}

async function finishDelayedReply(app: ElectronApplication, page: Page) {
  const held = (await fixtureState(app)).calls.findLast((call) => call.held && !call.endedAt);
  if (!held?.id) throw new Error('No held Main request to reconcile');
  await releaseReply(app);
  await expect.poll(async () => (await getAgentDevHostCalls(page)).some((value) => {
    const call = value as { id?: string; endedAt?: number; ok?: boolean };
    return call.id === held.id && typeof call.endedAt === 'number' && call.ok === true;
  })).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function withScopeFixture(launch: Launch, testInfo: TestInfo, options: Parameters<typeof installScopeFixture>[2],
  body: (app: ElectronApplication, page: Page, evidence: Record<string, unknown>) => Promise<void>) {
  test.setTimeout(120_000);
  await mkdir('D:/tmp', { recursive: true });
  const root = await mkdtemp('D:/tmp/session-chain-scope-faults-');
  const app = await launch({ skipSetup: true, deviceScaleFactor: 1, env: { TEMP: 'D:/tmp', TMP: 'D:/tmp' } });
  const captureUi = await observeSessionUi(app);
  const evidence: Record<string, unknown> = { driven_by: 'agent', actor: ACTOR, evidenceType: 'electron-host-fixture',
    case: testInfo.title, faultOwner: 'Main host:invoke fixture', status: 'running', artifactRoot: root };
  try {
    await installScopeFixture(app, root, options);
    const page = await getStableWindow(app); await page.reload();
    await expectCurrentScope(page, SOURCE_A, 'Source A draft');
    evidence.rendererScopeBefore = await renderedScope(page);
    await body(app, page, evidence);
    evidence.rendererScopeAfter = await renderedScope(page);
    evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    await releaseReply(app).catch(() => undefined);
    evidence.ownerReadback = await fixtureState(app).catch(String);
    await captureUi((name) => join(root, name));
    const path = join(root, 'scope-faults.json');
    await writeFile(path, JSON.stringify(evidence, null, 2));
    await testInfo.attach('session-chain-scope-faults', { path, contentType: 'application/json' });
    await closeElectronApp(app);
  }
}

test('project Ledger warnings stay unavailable in the task drawer and preserve the current draft', async ({ launchElectronApp }, testInfo) => {
  await withScopeFixture(launchElectronApp, testInfo, { warning: true }, async (app, page, evidence) => {
    await page.getByTestId(`sidebar-project-open-${WORKSPACE_A}`).click();
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Scope Project A');
    await expect(page.getByTestId('session-task-container')).toHaveAttribute('data-state', 'unavailable');
    expect(await setSessionChainViewport(app, { width: 960, height: 800 })).toEqual({ width: 960, height: 800 });
    await page.getByTestId('session-tasks-toggle').click();
    await expect(page.getByTestId('session-task-drawer')).toBeVisible();
    await expect(page.getByTestId('session-task-container')).toHaveAttribute('data-state', 'unavailable');
    await expect(page.getByTestId('session-task-drawer')).toContainText('Task owner unavailable');
    for (const button of await page.locator('[data-testid^="session-task-select-"]').all()) await expect(button).toBeDisabled();
    await expectCurrentScope(page, SOURCE_A, 'Source A draft');
    const owner = await fixtureState(app);
    expect(owner.ledgers[WORKSPACE_A].warnings).toHaveLength(1);
    expect(owner.calls.filter((call) => call.module === 'workspaces' && call.action === 'selectSessionTask')).toHaveLength(0);
    evidence.assertions = { ownerWarnings: owner.ledgers[WORKSPACE_A].warnings, taskContainer: 'unavailable', sessionKey: SOURCE_A, draft: 'Source A draft' };
  });
});

test('Ledger transcript navigation rejects a replaced session generation', async ({ launchElectronApp }, testInfo) => {
  await withScopeFixture(launchElectronApp, testInfo, {}, async (app, page, evidence) => {
    await page.getByTestId('session-tasks-toggle').click();
    await page.getByTestId('session-task-list').getByRole('link', { name: 'Scope fixture task', exact: true }).click();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await app.evaluate(() => {
      const state = (globalThis as FixtureGlobal).__sessionChainScopeFixture!;
      state.sessions.find(session => session.key === 'agent:main:scope-source-a')!.sessionId = 'generation-a-2';
    });
    const before = (await fixtureState(app)).calls.length;
    await page.getByTestId('task-ledger-open-session-scope-task-link').click();
    await expect(page.getByText('Task scope changed · refresh required', { exact: true })).toBeVisible();
    await expect(page.getByTestId('task-ledger-page')).toBeVisible();
    const calls = (await fixtureState(app)).calls.slice(before);
    expect(calls.some(call => call.module === 'workspaces' && ['switch', 'saveState'].includes(call.action ?? ''))).toBe(false);
    evidence.assertions = { recordedGeneration: 'generation-a-1', ownerGeneration: 'generation-a-2', navigationCommitted: false, calls };
  });
});

for (const destination of ['artifact', 'return-session'] as const) {
  test(`leaving Task Ledger cancels a pending ${destination} navigation after a delayed Main save reply`, async ({ launchElectronApp }, testInfo) => {
    await withScopeFixture(launchElectronApp, testInfo, {}, async (app, page, evidence) => {
      const draft = `Preserve source draft for ${destination}`;
      await armReplyFault(app, { module: 'workspaces', action: 'saveState', workspaceId: WORKSPACE_A, sessionKey: SOURCE_A, draftInput: draft });
      await page.getByTestId('chat-composer-input').fill(draft);
      await expect.poll(async () => (await fixtureState(app)).fault?.taken).toBe(true);
      await page.getByTestId('session-task-ledger-open').click();
      await expect(page.getByTestId('task-ledger-page')).toBeVisible();
      if (destination === 'artifact') await page.getByTestId(`task-ledger-evidence-${TASK_ID}`).getByRole('button', { name: ARTIFACT_LABEL }).click();
      else await page.getByTestId('task-ledger-return-session').click();
      await expect(page.getByTestId('task-ledger-page')).toBeVisible();
      await page.getByTestId('sidebar-footer-menu-trigger').click();
      await page.getByTestId('sidebar-archive').click();
      await expect(page.getByTestId('settings-archived-section')).toBeVisible();
      await expect(page.getByTestId('task-ledger-page')).toHaveCount(0);
      const currentInput = `Current archive search after ${destination}`;
      await page.getByTestId('settings-archived-search').fill(currentInput);
      await finishDelayedReply(app, page);
      await expect(page.getByTestId('settings-archived-section')).toBeVisible();
      await expect(page).toHaveURL(/settings\/archived/);
      await expect(page.getByTestId('settings-archived-search')).toHaveValue(currentInput);
      await expect(page.getByTestId('artifact-panel-tab-close-files')).toHaveCount(0);
      await expect(page.getByTestId('task-ledger-page')).toHaveCount(0);
      await expect.poll(async () => (await fixtureState(app)).profiles[0].sessionStates?.[SOURCE_A]?.draftInput).toBe(draft);
      const owner = await fixtureState(app);
      expect(owner.activeWorkspaceId).toBe(WORKSPACE_A);
      expect(await renderedScope(page)).toBeNull();
      await page.getByRole('button', { name: 'Back to app', exact: true }).click();
      await expect(page.getByTestId('settings-archived-section')).toHaveCount(0);
      await page.getByTestId(`sidebar-project-open-${WORKSPACE_A}`).click();
      await expectCurrentScope(page, SOURCE_A, draft);
      evidence.assertions = { destination, sourceDraft: draft, currentWorkspaceId: WORKSPACE_A,
        currentSessionKey: SOURCE_A, preservedRoute: 'settings/archived', currentInput, restoredSourceDraft: draft, artifactOpened: false };
    });
  });
}

test('automatic Handoff reconciliation ignores an old generation reply after refreshing the same session key', async ({ launchElectronApp }, testInfo) => {
  await withScopeFixture(launchElectronApp, testInfo, { handoff: true, unloadedSource: true }, async (app, page, evidence) => {
    await armReplyFault(app, { module: 'sessions', action: 'handoffOperation', workspaceId: WORKSPACE_A, sessionKey: SOURCE_A });
    await page.reload();
    await expect.poll(async () => (await fixtureState(app)).fault?.taken).toBe(true);
    const draft = 'Keep this draft while the same key changes generation';
    await page.getByTestId('chat-composer-input').fill(draft);
    await expect.poll(async () => (await fixtureState(app)).profiles[0].sessionStates?.[SOURCE_A]?.draftInput).toBe(draft);
    await app.evaluate((_electron, { key, workspaceId }) => {
      const state = (globalThis as FixtureGlobal).__sessionChainScopeFixture!;
      state.sessions.find((session) => session.key === key)!.sessionId = 'generation-a-2';
      state.operations[workspaceId] = { ...state.operations[workspaceId]!, id: 'scope-generation-two-intent', sourceGeneration: 'generation-a-2',
        sessionKey: `${key}-generation-two-child`, sessionGeneration: 'generation-two-child', firstSendIdempotencyKey: 'handoff-first:scope-generation-two-intent',
        rootHandoffId: 'scope-generation-two-intent', createdAt: '2026-11-08T00:01:00.000Z', updatedAt: '2026-11-08T00:01:00.000Z', phase: 'sent' };
    }, { key: SOURCE_A, workspaceId: WORKSPACE_A });
    // loadSessions has a 1200 ms cooldown; repeat its existing read-only UI entry until the owner refresh completes.
    await expect.poll(async () => {
      await openSessionNavigation(page);
      await page.getByTestId('session-family-source-unloaded').click();
      return (await fixtureState(app)).calls.some((call) => call.endedAt && call.module === 'gateway'
        && call.payload.method === 'sessions.list' && (call.data as { sessions?: FixtureSession[] })?.sessions?.some((session) => session.key === SOURCE_A && session.sessionId === 'generation-a-2'));
    }).toBe(true);
    await expect.poll(() => renderedScope(page)).toMatchObject({ sessionKey: SOURCE_A, workspaceId: WORKSPACE_A, generation: 'generation-a-2' });
    await expect.poll(async () => (await fixtureState(app)).calls.some((call) => call.endedAt && call.module === 'sessions'
      && call.action === 'handoffOperation' && call.payload.workspaceId === WORKSPACE_A && call.payload.sessionKey === SOURCE_A
      && (call.data as { operation?: SessionHandoffOperation })?.operation?.sourceGeneration === 'generation-a-2')).toBe(true);
    await finishDelayedReply(app, page);
    await expect(page.getByTestId('handoff-recovery')).toHaveCount(0);
    await expectCurrentScope(page, SOURCE_A, draft);
    evidence.assertions = { sessionKey: SOURCE_A, oldGeneration: 'generation-a-1', currentGeneration: 'generation-a-2', currentDraft: draft, staleRecoveryVisible: false };
  });
});

test('manual Handoff verification keeps Project B and its input when Project A replies late', async ({ launchElectronApp }, testInfo) => {
  await withScopeFixture(launchElectronApp, testInfo, { handoff: true }, async (app, page, evidence) => {
    await expect(page.getByTestId('handoff-recovery')).toHaveAttribute('data-phase', 'unknown');
    const source = (await fixtureState(app)).operations[WORKSPACE_A]!;
    await armReplyFault(app, { module: 'sessions', action: 'handoffOperation', workspaceId: WORKSPACE_A, sessionKey: SOURCE_A, operationId: source.id });
    await page.getByTestId('handoff-recovery-check').click();
    await expect.poll(async () => (await fixtureState(app)).fault?.taken).toBe(true);
    await page.getByTestId(`sidebar-project-open-${WORKSPACE_B}`).click();
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Scope Project B');
    await expectCurrentScope(page, SOURCE_B, 'Source B draft');
    const draft = 'Keep the current Project B draft';
    await page.getByTestId('chat-composer-input').fill(draft);
    await expect(page.getByTestId('handoff-recovery')).toHaveAttribute('data-phase', 'ready');
    await finishDelayedReply(app, page);
    await expect(page.getByTestId('project-coordinator-entry')).toContainText('Scope Project B');
    await expectCurrentScope(page, SOURCE_B, draft);
    await expect(page.getByTestId('handoff-recovery')).toHaveAttribute('data-phase', 'ready');
    await page.getByTestId('handoff-recovery-resume').click();
    await expect(page.getByTestId('chat-handoff-draft')).toHaveValue('Scope Project B reviewed handoff draft');
    await page.getByTestId('chat-handoff-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expectCurrentScope(page, SOURCE_B, draft);
    expect((await fixtureState(app)).activeWorkspaceId).toBe(WORKSPACE_B);
    evidence.assertions = { sourceWorkspaceId: WORKSPACE_A, currentWorkspaceId: WORKSPACE_B, currentSessionKey: SOURCE_B,
      currentDraft: draft, recoveryPhase: 'ready', recoveryDraft: 'Scope Project B reviewed handoff draft' };
  });
});
