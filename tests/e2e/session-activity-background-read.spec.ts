/**
 * #121 — Session Activity must show "unknown" instead of an empty card when the
 * background read failed, and must not report a successful empty read as a
 * failure.
 *
 * SCOPE OF THIS SPEC: it pins the renderer half of the pipeline — the host-api
 * result (`sessionActivity.snapshot`) → renderer store → Session Activity panel.
 * The Main-process derivation of `backgroundRead.state` (RPC timeout, owner read
 * exception, missing projection fields, successful empty projection) is pinned
 * by `tests/unit/session-activity-background-read.test.ts`, because the gateway
 * transport is not reachable from the mocked E2E harness and a real gateway RPC
 * would make these assertions environment-dependent.
 *
 * driven_by: agent; actor: p2-issues-batch2.
 */
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-session-activity';
const READ_AT = 1_760_000_000_000;

const PERSISTED_TURN = [
  {
    role: 'user',
    id: 'background-read-user-turn',
    content: [{ type: 'text', text: 'Keep the background read honest' }],
    timestamp: 1_760_000_000,
  },
];

const WORKSPACE = {
  id: WORKSPACE_ID,
  name: 'Session Activity Workspace',
  rootPath: 'C:/workspace-session-activity',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY,
  agentBindings: {
    main: { workspaceId: WORKSPACE_ID, agentId: 'main', sessionKey: SESSION_KEY },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: { [SESSION_KEY]: {} },
};

/** The shape `electron/services/session-activity-api.ts` returns to the store. */
function sessionActivitySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      sessionKey: SESSION_KEY,
      runId: null,
      status: 'idle',
      startedAt: null,
      endedAt: null,
      error: null,
      updatedAt: 0,
    },
    git: null,
    tasks: [],
    subagents: [],
    terminals: [],
    goals: [],
    processes: [],
    lineage: [],
    continuity: { queueCount: 0, contextPressure: null, checkpoint: false, blockedReason: null },
    availability: { git: true, tasks: true, subagents: true, terminals: true, continuity: true },
    backgroundRead: { state: 'unknown', readAt: null, failedAt: null },
    capturedAt: READ_AT,
    ...overrides,
  };
}

const CLEAN_REPOSITORY = {
  isRepository: true,
  workspaceRoot: 'C:/workspace-session-activity',
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
};

function baseHostApiMocks(activityResult: unknown) {
  return {
    [stableStringify(['gateway', 'status', null])]: {
      state: 'running',
      port: 18789,
      pid: 12345,
      gatewayReady: true,
    },
    [stableStringify(['settings', 'getAll', null])]: { success: true, data: {} },
    [stableStringify(['workspaces', 'list', null])]: {
      success: true,
      profiles: [WORKSPACE],
      activeWorkspaceId: WORKSPACE_ID,
      activeWorkspace: WORKSPACE,
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      success: true,
      activeWorkspaceId: WORKSPACE_ID,
      activeWorkspace: WORKSPACE,
    },
    [stableStringify(['/api/workspaces', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE_ID },
      },
    },
    [stableStringify(['agents', 'list', null])]: {
      success: true,
      agents: [{ id: 'main', name: 'main', canonicalSessionKey: SESSION_KEY }],
      defaultAgentId: 'main',
      defaultModelRef: null,
    },
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, agents: [{ id: 'main', name: 'main' }] },
      },
    },
    [stableStringify(['sessions', 'history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
      messages: PERSISTED_TURN,
      hasMore: false,
    },
    [stableStringify(['git', 'status', null])]: { success: true, status: CLEAN_REPOSITORY },
    /* Null payload = wildcard for this module/action; the store sends the
     * active workspace id, which this spec does not need to pin. */
    [stableStringify(['sessionActivity', 'snapshot', null])]: activityResult,
  };
}

function gatewayRpcMocks() {
  return {
    [stableStringify(['sessions.list', {}])]: {
      success: true,
      result: { sessions: [{ key: SESSION_KEY, displayName: 'Background read' }] },
    },
    [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
      success: true,
      result: { sessions: [{ key: SESSION_KEY, displayName: 'Background read' }] },
    },
    [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500_000 }])]: {
      success: true,
      result: { messages: PERSISTED_TURN },
    },
    [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
      success: true,
      result: { messages: PERSISTED_TURN },
    },
  };
}

test.describe('Session activity background read state', () => {
  test('unifies session process rows and the opened output pane', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    const runId = 'process-visual-run';
    const output = Array.from({ length: 60 }, (_, index) => `Check ${index + 1}: retained output`).join('\n') + '\n';
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: gatewayRpcMocks(),
        hostApi: baseHostApiMocks({
          success: true, runtimeAvailable: true,
          snapshot: sessionActivitySnapshot({ git: CLEAN_REPOSITORY, backgroundRead: { state: 'known', readAt: READ_AT, failedAt: null } }),
        }),
      });
      const page = await getStableWindow(app);
      // Install the host fixtures before session hydration; launch may already
      // have read the real profile by the time the IPC handlers are replaced.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Keep the background read honest')).toBeVisible({ timeout: 30_000 });
      await app.evaluate(({ BrowserWindow }, data) => {
        const identity = { runId: data.runId, sessionKey: data.sessionKey };
        for (const win of BrowserWindow.getAllWindows()) {
          const send = (event: Record<string, unknown>) => win.webContents.send('chat:runtime-event', { ...identity, ts: Date.now(), ...event });
          send({ type: 'run.started', startedAt: Date.now() });
          send({ type: 'tool.started', toolCallId: 'finished-command', name: 'exec', args: { command: 'pnpm lint' } });
          send({ type: 'command.output', toolCallId: 'finished-command', itemId: 'finished-command', title: 'pnpm lint', output: 'Lint passed\n', status: 'completed', exitCode: 0 });
          send({ type: 'tool.completed', toolCallId: 'finished-command', name: 'exec', result: { exitCode: 0 } });
          send({ type: 'tool.started', toolCallId: 'live-command', name: 'exec', args: { command: 'pnpm test --watch', cwd: 'C:/workspace-session-activity' } });
          send({ type: 'command.output', toolCallId: 'live-command', itemId: 'live-command', title: 'pnpm test --watch', output: data.output, status: 'running' });
        }
      }, { runId, sessionKey: SESSION_KEY, output });
      const activityToggle = page.getByTestId('chat-session-activity-toggle');
      if (await activityToggle.getAttribute('aria-expanded') !== 'true') await activityToggle.click();
      const activity = page.getByTestId('session-activity-panel');
      const live = page.getByTestId('session-activity-process-live-command');
      const recent = page.getByTestId('session-activity-recent-processes');
      await expect(live).toBeVisible();
      await expect(page.getByTestId('session-activity-process-output-live-command')).toBeVisible();
      await expect(recent).not.toHaveAttribute('open');
      await expect(page.getByTestId('session-activity-process-finished-command')).not.toBeVisible();
      await recent.locator('summary').press('Enter');
      await expect(page.getByTestId('session-activity-process-finished-command')).toBeVisible();
      await recent.locator('summary').press('Enter');
      for (const theme of ['light', 'dark']) {
        await page.evaluate(dark => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.classList.toggle('light', !dark);
        }, theme === 'dark');
        expect(await activity.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        await activity.screenshot({ path: testInfo.outputPath(`session-status-${theme}.png`), animations: 'disabled' });
      }
      // The card toggles its output in place; the page opens from its own action.
      await page.getByTestId('session-activity-process-open-live-command').click();
      const process = page.getByTestId('workspace-process-panel');
      const terminal = process.locator('[data-slot="terminal"]');
      const region = process.getByTestId('terminal-output');
      await expect(process).toBeVisible();
      await expect(terminal).toContainText('pnpm test --watch');
      await expect(terminal).toContainText('Running');
      await expect.poll(() => region.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2);
      await region.press('Home');
      await expect.poll(() => region.evaluate(el => el.scrollTop)).toBe(0);
      const nextOutput = output + 'New output while reviewing earlier lines\n';
      await app.evaluate(({ BrowserWindow }, data) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:runtime-event', {
          runId: data.runId, sessionKey: data.sessionKey, type: 'command.output', ts: Date.now(),
          toolCallId: 'live-command', itemId: 'live-command', output: data.output, status: 'running',
        });
      }, { runId, sessionKey: SESSION_KEY, output: nextOutput });
      await expect(region).toContainText('New output while reviewing earlier lines');
      expect(await region.evaluate(el => el.scrollTop)).toBe(0);
      await process.getByRole('button', { name: 'Copy output' }).click();
      await expect.poll(() => app.evaluate(async ({ clipboard }) => (await clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(nextOutput);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(dark => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.classList.toggle('light', !dark);
        }, theme === 'dark');
        await page.screenshot({ path: testInfo.outputPath(`process-output-${theme}.png`), animations: 'disabled' });
      }
      await page.setViewportSize({ width: 800, height: 900 });
      expect(await process.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await process.screenshot({ path: testInfo.outputPath('process-output-narrow.png'), animations: 'disabled' });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the unknown state and its retry when the background read failed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: gatewayRpcMocks(),
        hostApi: baseHostApiMocks({
          success: true,
          runtimeAvailable: false,
          snapshot: sessionActivitySnapshot({
            backgroundRead: { state: 'unknown', readAt: null, failedAt: READ_AT },
          }),
        }),
      });

      const page = await getStableWindow(app);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Keep the background read honest')).toBeVisible({ timeout: 30_000 });

      const toggle = page.getByTestId('chat-session-activity-toggle');
      await expect(toggle).toBeVisible();
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();

      await expect(page.getByTestId('session-activity-panel')).toBeVisible();
      const unknown = page.getByTestId('session-activity-background-unknown');
      await expect(unknown).toBeVisible();
      await expect(unknown).toContainText(/unknown/i);
      /* The unknown state reuses the card's existing retry affordance. */
      await expect(page.getByTestId('session-activity-retry')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not report a successful empty read as a failure', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: gatewayRpcMocks(),
        hostApi: baseHostApiMocks({
          success: true,
          runtimeAvailable: true,
          snapshot: sessionActivitySnapshot({
            git: CLEAN_REPOSITORY,
            backgroundRead: { state: 'known', readAt: READ_AT, failedAt: null },
          }),
        }),
      });

      const page = await getStableWindow(app);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Keep the background read honest')).toBeVisible({ timeout: 30_000 });

      // A clean repository and a successful empty read leave no environment entry.
      await expect(page.getByTestId('chat-session-activity-toggle')).toHaveCount(0);
      await expect(page.getByTestId('session-activity-panel')).toHaveCount(0);
      await expect(page.getByTestId('session-activity-background-unknown')).toHaveCount(0);
      await expect(page.getByTestId('session-activity-background-stale')).toHaveCount(0);
      await expect(page.getByTestId('session-activity-alert')).toHaveCount(0);
      await expect(page.getByTestId('session-activity-retry')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});

test('opens an environment only after observed sources and respects a manual dismissal', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: gatewayRpcMocks(),
      hostApi: baseHostApiMocks({ success: true, runtimeAvailable: true, snapshot: sessionActivitySnapshot({
        git: CLEAN_REPOSITORY,
        backgroundRead: { state: 'known', readAt: READ_AT, failedAt: null },
      }) }),
    });
    const page = await getStableWindow(app);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(page.getByText('Keep the background read honest')).toBeVisible();
    const toggle = page.getByTestId('chat-session-activity-toggle');
    const rail = page.getByTestId('chat-session-status-rail');
    await expect(toggle).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }, sessionKey) => {
      for (const win of BrowserWindow.getAllWindows()) {
        const identity = { runId: 'source-run', sessionKey, ts: Date.now() };
        win.webContents.send('chat:runtime-event', { ...identity, type: 'run.started', startedAt: Date.now() });
        win.webContents.send('chat:runtime-event', { ...identity, type: 'tool.started', toolCallId: 'source-docs', name: 'mcp__docs__search', args: { query: 'environment card', token: 'never-show-in-environment' } });
      }
    }, SESSION_KEY);
    // Observed sources make the environment available, but it opens only on
    // request: no passive sidebar and no inset transcript.
    const scroll = page.getByTestId('chat-scroll-container');
    await expect(toggle).toBeVisible();
    await expect(rail).toHaveCount(0);
    await expect(scroll).toHaveAttribute('data-rail', 'collapsed');
    const transcriptWidth = (await scroll.boundingBox())?.width;
    await toggle.click();
    await expect(rail).toHaveAttribute('data-layer', 'overlay');
    await expect(scroll).toHaveAttribute('data-rail', 'collapsed');
    expect((await scroll.boundingBox())?.width).toBe(transcriptWidth);
    await expect(page.getByTestId('session-activity-sources')).toContainText('docs');
    await expect(rail).not.toContainText('never-show-in-environment');
    await page.screenshot({ path: testInfo.outputPath('environment-requested-light.png'), animations: 'disabled' });
    await page.getByTestId('session-activity-close').click();
    await expect(rail).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }, sessionKey) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:runtime-event', {
        type: 'tool.started', runId: 'source-run', sessionKey, ts: Date.now(),
        toolCallId: 'source-skill', name: 'read', args: { path: 'C:/skills/review/SKILL.md' },
      });
    }, SESSION_KEY);
    await expect(rail).toHaveCount(0);
    await toggle.click();
    await expect(rail).toHaveAttribute('data-layer', 'overlay');
    await expect(page.getByTestId('session-activity-sources')).toContainText('review');
    await expect(page.getByTestId('chat-scroll-container')).toHaveAttribute('data-rail', 'collapsed');
    await page.keyboard.press('Escape');
    await expect(rail).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.getByTestId('chat-scroll-container').click({ position: { x: 8, y: 8 } });
    await expect(rail).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await toggle.click();
    await expect(rail).toHaveCSS('animation-name', 'none');
  } finally {
    await closeElectronApp(app);
  }
});

test('keeps environment summaries bounded and opens a worker only on demand', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const hostApi: Record<string, unknown> = baseHostApiMocks({ success: true, runtimeAvailable: true, snapshot: sessionActivitySnapshot({
      git: { ...CLEAN_REPOSITORY, clean: false, unstagedCount: 1, changes: [{
        path: 'src/pages/Chat/SessionActivityPanel.tsx', absolutePath: 'C:/workspace-session-activity/src/pages/Chat/SessionActivityPanel.tsx',
        status: 'M', staged: false, unstaged: true, untracked: false, conflicted: false, bucket: 'unstaged', additions: 48, deletions: 8,
      }] },
      subagents: Array.from({ length: 7 }, (_, index) => ({
        id: `environment-worker-${index}`, childSessionKey: `agent:worker:environment-${index}`,
        role: index === 0 ? 'reviewer' : 'explorer', task: index === 0 ? 'Review the environment changes' : `Inspect source ${index}`,
        status: index === 0 ? 'started' : 'completed', updatedAt: Date.now(), source: 'snapshot',
      })),
      backgroundRead: { state: 'known', readAt: READ_AT, failedAt: null },
    }) });
    hostApi[stableStringify(['sessions', 'history', { sessionKey: 'agent:worker:environment-0', agentId: 'worker', expectedParentSessionKey: SESSION_KEY }])] = {
      success: true, sessionGeneration: 'environment-worker-generation-0',
      messages: [{ role: 'assistant', content: 'Worker evidence opened from the environment' }], hasMore: false,
    };
    hostApi[stableStringify(['settings', 'getAll', null])] = { success: true, data: { language: 'zh' } };
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: gatewayRpcMocks(), hostApi,
    });
    const page = await getStableWindow(app);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(page.getByText('Keep the background read honest')).toBeVisible();
    await expect(page.getByTestId('artifact-panel-aside')).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }, sessionKey) => {
      for (const win of BrowserWindow.getAllWindows()) {
        const identity = { runId: 'environment-run', sessionKey, ts: Date.now() };
        win.webContents.send('chat:runtime-event', { ...identity, type: 'run.started', startedAt: Date.now() });
        for (const [index, name] of ['mcp__docs__search', 'read', 'exa__contents', 'browser__inspect', 'files__read_file'].entries()) {
          win.webContents.send('chat:runtime-event', { ...identity, type: 'tool.started', toolCallId: `environment-call-${index}`, name, args: { path: 'C:/skills/review/SKILL.md' } });
          win.webContents.send('chat:runtime-event', { ...identity, type: 'tool.completed', toolCallId: `environment-call-${index}`, name, result: { ok: true } });
        }
      }
    }, SESSION_KEY);
    const rail = page.getByTestId('chat-session-status-rail');
    const toggle = page.getByTestId('chat-session-activity-toggle');
    // Changes, workers and sources stay behind the toggle until asked for.
    await expect(toggle).toBeVisible();
    await expect(rail).toHaveCount(0);
    await toggle.click();
    await expect(rail).toHaveAttribute('data-layer', 'overlay');
    await expect(page.getByTestId('chat-scroll-container')).toHaveAttribute('data-rail', 'collapsed');
    await page.setViewportSize({ width: 390, height: 720 });
    const railBounds = await rail.boundingBox();
    expect(railBounds).not.toBeNull();
    expect(railBounds!.x).toBeGreaterThanOrEqual(0);
    expect(railBounds!.x + railBounds!.width).toBeLessThanOrEqual(390);
    expect(await rail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('session-status-rail-narrow.png') });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(page.getByTestId('session-activity-sources')).toContainText('review');
    await expect(page.getByTestId('session-activity-subagent-environment-worker-0')).toBeVisible();
    await expect(page.getByTestId('session-activity-subagent-environment-worker-1')).toBeHidden();
    await page.getByTestId('session-activity-more-subagents').locator(':scope > summary').press('Enter');
    await expect(page.getByTestId('session-activity-subagent-environment-worker-1')).toBeVisible();
    await page.getByTestId('session-activity-more-subagents').locator(':scope > summary').press('Enter');
    // Sources live behind the Connectors row; open it before its overflow list.
    await page.getByTestId('session-activity-sources-toggle').press('Enter');
    await expect(page.getByTestId('session-activity-sources-toggle')).toContainText(/in use|在用/);
    await page.getByTestId('session-activity-more-sources').locator(':scope > summary').press('Enter');
    await expect(rail.getByText('browser', { exact: true })).toBeVisible();
    await page.getByTestId('session-activity-more-sources').locator(':scope > summary').press('Enter');
    await page.getByTestId('session-activity-sources-toggle').press('Enter');
    // Closing and reopening keeps the same compact overlay.
    await page.getByTestId('session-activity-close').click();
    await expect(rail).toHaveCount(0);
    await toggle.click();
    await expect(rail).toHaveAttribute('data-layer', 'overlay');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(dark => {
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.classList.toggle('light', !dark);
      }, theme === 'dark');
      expect(await rail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await rail.screenshot({ path: testInfo.outputPath(`environment-overlay-${theme}.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(rail).toHaveAttribute('data-layer', 'overlay');
    expect(await rail.evaluate(el => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('environment-narrow.png'), animations: 'disabled' });
    await page.getByTestId('session-activity-subagent-environment-worker-0').click();
    await expect(rail).toHaveCount(0);
    await expect(page.getByTestId('workspace-subagent-panel')).toBeVisible();
    await expect(page.getByText('Worker evidence opened from the environment')).toBeVisible();
    await expect(page.locator('[data-testid^="artifact-panel-tab-subagent-"]')).toHaveCount(1);
  } finally {
    await closeElectronApp(app);
  }
});
