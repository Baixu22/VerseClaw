import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

type HostResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
};
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type CreatedSession = { key?: string; sessionKey?: string };
type Policy = {
  schemaVersion: string;
  generatedAt: string;
  scope: { workspaceId: string; sessionKey: string; agentId: string | null; sessionId: string | null; runId: string | null };
  generation: { state: string; runtimeGeneration: string | null; capabilityProfileGeneration: string | null; observedAt: string | null; reason: string | null };
  backend: { configured: { value: null | { runtime: string; kind: string; ownsNativeCompaction: boolean | null; provider: string | null; model: string | null }; status: string; source: string; reason: string | null }; effective: { value: unknown; status: string; source: string; reason: string | null } };
  harness: { configured: { value: null | { id: string; kind: string }; status: string; source: string; reason: string | null }; effective: { value: unknown; status: string; source: string; reason: string | null } };
  model: { configured: { value: null | { provider: string | null; model: string | null; effort: string | null }; status: string; source: string; reason: string | null }; effective: { value: unknown; status: string; source: string; reason: string | null } };
  grants: { configured: { value: unknown; status: string; source: string; reason: string | null }; effective: { value: null | { total: number; allowed: number; requiresApproval: number; denied: number; unknown: number; actions: Array<{ actionId: string; authorization: string; grantState: string | null }> }; status: string; source: string; reason: string | null } };
  context: { configured: { value: null | { contextTokens: number | null; contextPressure: string | null }; status: string; source: string; reason: string | null }; effective: { value: unknown; status: string; source: string; reason: string | null } };
  queue: { configured: { value: unknown; status: string; source: string; reason: string | null }; effective: { value: unknown; status: string; source: string; reason: string | null } };
  resources: { configured: { value: unknown; status: string; source: string; reason: string | null }; effective: { value: unknown; status: string; source: string; reason: string | null } };
  schedule: { configured: { value: unknown; status: string; source: string; reason: string | null }; effective: { value: unknown; status: string; source: string; reason: string | null } };
  compatibility: Array<{ backend: string; parameter: string; status: string; reason: string | null }>;
  sources: string[];
};
type ActivityResult = { success: boolean; runtimeAvailable?: boolean; snapshot?: { policy?: Policy } };

const SECOND_SESSION_KEY = 'agent:main:policy-secondary';
const READ_AT = 1_792_700_000_000;
const PRIMARY_MARKER = 'Primary session policy surface';
const SECONDARY_MARKER = 'Secondary session policy surface';

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.subarray(1, 4).toString('ascii') !== 'PNG') throw new Error('screenshot is not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    const handler = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
    const sender = win.webContents;
    const event = {
      sender,
      senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' },
    };
    return await handler(event, { id: `policy-surface-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'host invoke failed'}`);
  }
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  let started = false;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
    if (status.gatewayReady === true || status.state === 'running') return;
    if (!started && status.state !== 'starting') {
      started = true;
      await hostInvoke(app, 'gateway', 'start');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('Gateway did not become ready for the policy surface E2E');
}

async function activeWorkspace(app: ElectronApplication): Promise<{ id: string; rootPath?: string; name?: string }> {
  const active = await hostInvoke<{ activeWorkspace?: { id?: string; rootPath?: string; name?: string }; id?: string; rootPath?: string; name?: string }>(
    app,
    'workspaces',
    'getActive',
  );
  const workspace = active.activeWorkspace ?? active;
  if (!workspace.id) throw new Error('Active workspace has no id');
  await hostInvoke(app, 'workspaces', 'update', { id: workspace.id, permissionMode: 'fullAccess' });
  return { id: workspace.id, rootPath: workspace.rootPath, name: workspace.name };
}

function clonePolicy(policy: Policy): Policy {
  return JSON.parse(JSON.stringify(policy)) as Policy;
}

function policyFor(primary: Policy, sessionKey: string, runtime: 'openclaw' | 'codex', model: string): Policy {
  const policy = clonePolicy(primary);
  policy.scope = { ...policy.scope, sessionKey };
  policy.generatedAt = new Date(READ_AT).toISOString();
  policy.backend.configured = {
    ...policy.backend.configured,
    value: {
      runtime,
      kind: runtime === 'codex' ? 'native' : 'openclaw',
      ownsNativeCompaction: runtime === 'codex',
      provider: primary.backend.configured.value?.provider ?? 'openai',
      model,
    },
    source: sessionKey === SECOND_SESSION_KEY ? 'session.runtime.secondary' : 'session.runtime',
  };
  policy.harness.configured = {
    ...policy.harness.configured,
    value: { id: runtime, kind: runtime === 'codex' ? 'native' : 'openclaw' },
  };
  policy.model.configured = {
    ...policy.model.configured,
    value: {
      provider: primary.model.configured.value?.provider ?? 'openai',
      model,
      effort: primary.model.configured.value?.effort ?? 'high',
    },
  };
  policy.grants.effective = {
    value: {
      total: 3,
      allowed: 1,
      requiresApproval: 1,
      denied: 1,
      unknown: 0,
      actions: [
        { actionId: 'exec', authorization: 'allowed', grantState: 'active' },
        { actionId: 'write', authorization: 'requires-approval', grantState: null },
        { actionId: 'browser', authorization: 'denied', grantState: 'revoked' },
      ],
    },
    status: 'effective',
    source: 'runtime-effective-capability.observation',
    reason: null,
  };
  policy.compatibility = runtime === 'codex'
    ? [
        { backend: 'codex', parameter: 'automatic-compaction', status: 'ignored', reason: 'the native backend owns automatic compaction' },
        { backend: 'codex', parameter: 'compaction.reserveTokens', status: 'unsupported', reason: 'native compaction does not consume OpenClaw reserve-token arguments' },
      ]
    : primary.compatibility;
  return policy;
}

function snapshot(sessionKey: string, policy: Policy) {
  return {
    session: {
      sessionKey,
      runId: null,
      status: 'idle',
      startedAt: null,
      endedAt: null,
      error: null,
      updatedAt: READ_AT,
    },
    git: {
      isRepository: true,
      workspaceRoot: 'C:/policy-surface',
      branch: 'main',
      ahead: 0,
      behind: 0,
      clean: true,
      hasConflicts: false,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      changes: [],
    },
    tasks: [],
    subagents: [],
    terminals: [],
    goals: [],
    processes: [],
    lineage: [],
    policy,
    continuity: { queueCount: 0, contextPressure: null, checkpoint: false, blockedReason: null },
    availability: { git: true, tasks: true, subagents: true, terminals: true, continuity: true },
    backgroundRead: { state: 'known', readAt: READ_AT, failedAt: null },
    capturedAt: READ_AT,
  };
}

function history(text: string, id: string) {
  return [{
    id,
    role: 'user',
    content: text,
    timestamp: READ_AT / 1000,
  }];
}

function uiMocks(workspaceId: string, sessionKey: string, primary: Policy, secondary: Policy) {
  const workspace = {
    id: workspaceId,
    name: 'Policy Surface Workspace',
    rootPath: 'C:/policy-surface',
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: sessionKey,
    permissionMode: 'acceptEdits' as const,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
    sessionStates: { [sessionKey]: {}, [SECOND_SESSION_KEY]: {} },
  };
  const sessions = [
    { key: sessionKey, displayName: 'Policy primary', updatedAt: READ_AT },
    { key: SECOND_SESSION_KEY, displayName: 'Policy secondary', updatedAt: READ_AT + 1 },
  ];
  return {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: { success: true, result: { sessions } },
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: { success: true, result: { sessions } },
      [stableStringify(['chat.history', { sessionKey, limit: 200, maxChars: 500_000 }])]: { success: true, result: { messages: history(PRIMARY_MARKER, 'policy-primary') } },
      [stableStringify(['chat.history', { sessionKey: SECOND_SESSION_KEY, limit: 200, maxChars: 500_000 }])]: { success: true, result: { messages: history(SECONDARY_MARKER, 'policy-secondary') } },
      [stableStringify(['chat.history', { sessionKey: SECOND_SESSION_KEY, limit: 1000 }])]: { success: true, result: { messages: history(SECONDARY_MARKER, 'policy-secondary') } },
    },
    hostApi: {
      [stableStringify(['/api/settings', 'GET'])]: { ok: true, data: { status: 200, ok: true, json: { language: 'en', theme: 'light', setupComplete: true } } },
      [stableStringify(['settings', 'getAll', null])]: { language: 'en', theme: 'light', setupComplete: true },
      [stableStringify(['gateway', 'status', null])]: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      [stableStringify(['/api/gateway/status', 'GET'])]: { ok: true, data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true } } },
      [stableStringify(['/api/agents', 'GET'])]: { ok: true, data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'main' }] } } },
      [stableStringify(['agents', 'list', null])]: { success: true, agents: [{ id: 'main', name: 'main', canonicalSessionKey: sessionKey }], defaultAgentId: 'main', defaultModelRef: null },
      [stableStringify(['workspaces', 'getActive', null])]: { success: true, activeWorkspaceId: workspaceId, activeWorkspace: workspace },
      [stableStringify(['workspaces', 'list', null])]: { success: true, profiles: [workspace], activeWorkspaceId: workspaceId, activeWorkspace: workspace },
      [stableStringify(['/api/workspaces', 'GET'])]: { ok: true, data: { status: 200, ok: true, json: { success: true, workspaces: [workspace], activeWorkspaceId: workspaceId } } },
      [stableStringify(['workspaces', 'saveState', { id: workspaceId, sessionKey, state: {} }])]: { success: true },
      [stableStringify(['sessions', 'history', { sessionKey, limit: 200 }])]: { messages: history(PRIMARY_MARKER, 'policy-primary'), hasMore: false },
      [stableStringify(['sessions', 'history', { sessionKey: SECOND_SESSION_KEY, limit: 200 }])]: { messages: history(SECONDARY_MARKER, 'policy-secondary'), hasMore: false },
      [stableStringify(['git', 'status', null])]: { success: false },
      [stableStringify(['sessionActivity', 'snapshot', { workspaceId, sessionKey }])]: { success: true, runtimeAvailable: true, snapshot: snapshot(sessionKey, primary) },
      [stableStringify(['sessionActivity', 'snapshot', { workspaceId, sessionKey: SECOND_SESSION_KEY }])]: { success: true, runtimeAvailable: true, snapshot: snapshot(SECOND_SESSION_KEY, secondary) },
    },
  };
}

test('policy surface explains provenance, lifecycle boundaries, narrow layout, and session scope', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(240_000);
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await getStableWindow(app);
    await ensureGatewayReady(app);
    const workspace = await activeWorkspace(app);
    const created = await hostInvoke<CreatedSession>(app, 'gateway', 'rpc', {
      method: 'sessions.create',
      params: { agentId: 'main', label: `policy-surface-${Date.now()}` },
      timeoutMs: 60_000,
    });
    const sessionKey = created.key ?? created.sessionKey;
    if (!sessionKey) throw new Error(`sessions.create returned no key: ${JSON.stringify(created)}`);

    const beforeRestart = await hostInvoke<ActivityResult>(app, 'sessionActivity', 'snapshot', {
      workspaceId: workspace.id,
      sessionKey,
    });
    expect(beforeRestart.success).toBe(true);
    const actualPolicy = beforeRestart.snapshot?.policy;
    expect(actualPolicy?.schemaVersion).toBe('SessionEffectivePolicy/v1');
    expect(actualPolicy?.scope.workspaceId).toBe(workspace.id);
    expect(actualPolicy?.scope.sessionKey).toBe(sessionKey);
    expect(actualPolicy?.backend.configured.status).toBe('configured');
    expect(actualPolicy?.backend.effective.status).toBe('unverified');
    expect(actualPolicy?.sources.length).toBeGreaterThan(0);

    await hostInvoke(app, 'gateway', 'stop');
    await ensureGatewayReady(app);
    const afterRestart = await hostInvoke<ActivityResult>(app, 'sessionActivity', 'snapshot', {
      workspaceId: workspace.id,
      sessionKey,
    });
    expect(afterRestart.success).toBe(true);
    expect(afterRestart.snapshot?.policy?.scope.workspaceId).toBe(workspace.id);
    expect(afterRestart.snapshot?.policy?.scope.sessionKey).toBe(sessionKey);

    const primaryPolicy = policyFor(actualPolicy!, sessionKey, 'codex', 'gpt-policy-primary');
    const secondaryPolicy = policyFor(actualPolicy!, SECOND_SESSION_KEY, 'openclaw', 'gpt-policy-secondary');
    await installIpcMocks(app, uiMocks(workspace.id, sessionKey, primaryPolicy, secondaryPolicy));
    const page = await getStableWindow(app);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('chat-user-message-bubble').getByText(PRIMARY_MARKER)).toBeVisible({ timeout: 30_000 });

    const toggle = page.getByTestId('chat-session-activity-toggle');
    await expect(toggle).toBeVisible();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('session-activity-panel')).toBeVisible();

    const configured = page.getByTestId('session-activity-policy-backend');
    await expect(configured).toContainText('codex');
    await expect(configured).toContainText('session.runtime');
    await expect(page.getByTestId('session-activity-policy-harness')).toContainText('codex');
    await expect(page.getByTestId('session-activity-policy-harness')).toContainText(/unverified/i);
    await expect(page.getByTestId('session-activity-policy-effective')).toContainText(/unverified/i);
    await expect(page.getByTestId('session-activity-boundary-abort')).toContainText(/session, stored transcript/i);
    await expect(page.getByTestId('session-activity-boundary-stop')).toContainText(/retaining the session/i);
    await expect(page.getByTestId('session-activity-boundary-activity')).toContainText(/view-only window/i);
    await expect(page.getByTestId('session-activity-boundary-fork')).toContainText(/does not create a Git branch or worktree/i);

    const policyDetailsSummary = page.getByTestId('session-activity-policy-details').locator('summary');
    await policyDetailsSummary.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('session-activity-policy-sources')).toContainText('runtime-effective-capability.observation');
    await expect(page.getByTestId('session-activity-policy-unverified-facts')).toContainText(/no capability observation exists/i);
    await expect(page.getByTestId('session-activity-policy-compatibility')).toContainText(/unsupported/i);
    await expect(page.getByTestId('session-activity-policy-compatibility')).toContainText(/native backend does not consume/i);
    const actionDetailsSummary = page.getByTestId('session-activity-policy-action-details').locator('summary');
    await actionDetailsSummary.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('session-activity-policy-action-details')).toContainText('approval required');

    const widePath = testInfo.outputPath('policy-surface-wide.png');
    await page.screenshot({ path: widePath, fullPage: true });
    await testInfo.attach('policy-surface-wide', { path: widePath, contentType: 'image/png' });

    const secondaryRow = page.getByTestId(`sidebar-session-${SECOND_SESSION_KEY}`);
    await expect(secondaryRow).toBeVisible();
    await secondaryRow.click();
    await expect(page.getByTestId('chat-user-message-bubble').getByText(SECONDARY_MARKER)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('chat-session-activity-toggle').click();
    await expect(page.getByTestId('session-activity-policy-backend')).toContainText('openclaw');
    await expect(page.getByTestId('session-activity-policy-backend')).toContainText('session.runtime.secondary');
    await expect(page.getByTestId('session-activity-policy-harness')).toContainText('openclaw');
    await expect(page.getByTestId('session-activity-policy-harness')).toContainText(/unverified/i);
    await expect(page.getByTestId('session-activity-policy-backend')).not.toContainText('codex');

    await page.setViewportSize({ width: 680, height: 760 });
    await expect(page.getByTestId('chat-session-activity-toggle')).toBeVisible();
    const panel = page.getByTestId('session-activity-panel');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(680.5);

    const narrowPath = testInfo.outputPath('policy-surface-narrow.png');
    await page.screenshot({ path: narrowPath, fullPage: true });
    await testInfo.attach('policy-surface-narrow', { path: narrowPath, contentType: 'image/png' });

    const wideBytes = await readFile(widePath);
    const narrowBytes = await readFile(narrowPath);
    const widePixels = pngDimensions(wideBytes);
    const narrowPixels = pngDimensions(narrowBytes);
    const screenshots = [
      { name: 'policy-surface-wide', path: widePath, viewport: { width: 1280, height: 800 }, pixels: widePixels, sha256: createHash('sha256').update(wideBytes).digest('hex') },
      { name: 'policy-surface-narrow', path: narrowPath, viewport: { width: 680, height: 760 }, pixels: narrowPixels, sha256: createHash('sha256').update(narrowBytes).digest('hex') },
    ];
    const screenshotsOutput = testInfo.outputPath('policy-ui-screenshots.json');
    await writeFile(screenshotsOutput, `${JSON.stringify({ schema: 'clawx.long-session.policy-ui-screenshots/v1', driven_by: 'agent', actor: process.env.COMPASS_AGENT_NAME ?? 'clawx-e2e-agent', screenshots }, null, 2)}\n`);
    await testInfo.attach('policy-ui-screenshots', { path: screenshotsOutput, contentType: 'application/json' });

    const resultsOutput = testInfo.outputPath('policy-ui-results.json');
    await writeFile(resultsOutput, `${JSON.stringify({
      schema: 'clawx.long-session.policy-ui-results/v1',
      driven_by: 'agent',
      actor: process.env.COMPASS_AGENT_NAME ?? 'clawx-e2e-agent',
      workspaceId: workspace.id,
      primarySessionKey: sessionKey,
      secondarySessionKey: SECOND_SESSION_KEY,
      actualHostGateway: {
        beforeRestart: { generationState: actualPolicy?.generation.state, backend: actualPolicy?.backend.configured.value, effectiveStatus: actualPolicy?.backend.effective.status, sources: actualPolicy?.sources },
        afterRestart: { generationState: afterRestart.snapshot?.policy?.generation.state, workspaceId: afterRestart.snapshot?.policy?.scope.workspaceId, sessionKey: afterRestart.snapshot?.policy?.scope.sessionKey },
      },
      uiScenario: {
        primaryRuntime: 'codex',
        secondaryRuntime: 'openclaw',
        keyboardOpened: true,
        sourceDetailsOpened: true,
        actionDetailsOpened: true,
        narrowViewport: { width: 680, height: 760, panelBounded: true, toggleVisible: true },
      },
      transport: 'built Electron host:invoke -> actual Gateway; renderer host replay for deterministic two-session UI',
      screenshots,
    }, null, 2)}\n`);
    await testInfo.attach('policy-ui-results', { path: resultsOutput, contentType: 'application/json' });
  } finally {
    await closeElectronApp(app);
  }
});
