import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const WORKSPACE = {
  id: 'workspace-artifact',
  name: 'Artifact Workspace',
  rootPath: '/tmp/artifact-workspace',
  agentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {
    [SESSION_KEY]: {
      artifactPanel: {
        open: true,
        activeTab: 'artifact',
      },
    },
  },
};

function baseHostApiMocks() {
  return {
    [stableStringify(['gateway', 'status', null])]: {
      state: 'running',
      port: 18789,
      pid: 12345,
      gatewayReady: true,
    },
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, agents: [{ id: 'main', name: 'main', workspace: '/tmp/artifact-workspace' }] },
      },
    },
    [stableStringify(['/api/workspaces', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE.id },
      },
    },
    [stableStringify(['workspaces', 'list', null])]: {
      success: true,
      profiles: [WORKSPACE],
      activeWorkspaceId: WORKSPACE.id,
      activeWorkspace: WORKSPACE,
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      success: true,
      activeWorkspaceId: WORKSPACE.id,
      activeWorkspace: WORKSPACE,
    },
    [stableStringify(['agents', 'list', null])]: {
      success: true,
      agents: [{ id: 'main', name: 'main', canonicalSessionKey: SESSION_KEY, workspace: WORKSPACE.rootPath }],
      defaultAgentId: 'main',
      defaultModelRef: null,
    },
    [stableStringify(['settings', 'getAll', null])]: {
      success: true,
      data: {},
    },
    [stableStringify(['workProviders', 'status', null])]: {
      success: true,
      providers: [],
      capabilities: [],
      kitCapabilities: [],
      summary: { ready: 0, missingDependency: 0, missingConfig: 0, disabled: 0, externalUnavailable: 0 },
    },
  };
}

test.describe('Chat artifact panel', () => {
  test('shows artifact tab button in the artifact panel', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: [], hasMore: false },
          },
          [stableStringify(['workspaces.getSessionState', { workspaceId: WORKSPACE.id, sessionKey: SESSION_KEY }])]: {
            success: true,
            result: {
              artifactPanel: { open: true, activeTab: 'artifact' },
            },
          },
        },
        hostApi: baseHostApiMocks(),
      });

      const page = await getStableWindow(app);
      await page.waitForTimeout(3000);

      const artifactTabButton = page.locator('[data-testid="artifact-panel-tab-artifact"]');
      await expect(page.getByTestId('artifact-panel-aside')).toHaveAttribute('data-expanded', 'false');
      await expect(artifactTabButton).toBeVisible();
      await expect(artifactTabButton).toContainText('Artifacts');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows managed structured artifacts through the host gateway seam', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: [], hasMore: false },
          },
          [stableStringify(['workspaces.getSessionState', { workspaceId: WORKSPACE.id, sessionKey: SESSION_KEY }])]: {
            success: true,
            result: { artifactPanel: { open: true, activeTab: 'artifact' } },
          },
          [stableStringify(['verseconf.artifacts.list', { workspaceDir: WORKSPACE.rootPath }])]: {
            success: true,
            result: {
              artifacts: [{ artifactId: 'artifact-research', kind: 'research-table', sourcePath: 'research.json', currentRevisionId: 'rev-2', updatedAt: 2 }],
            },
          },
          [stableStringify(['verseconf.artifacts.history', { workspaceDir: WORKSPACE.rootPath, artifactId: 'artifact-research' }])]: {
            success: true,
            result: {
              artifact: { artifactId: 'artifact-research', kind: 'research-table', sourcePath: 'research.json', currentRevisionId: 'rev-2', updatedAt: 2 },
              revisions: [{ revisionId: 'rev-1', sequence: 1, sourceSha256: 'before', status: 'committed', createdAt: 1 }, { revisionId: 'rev-2', sequence: 2, sourceSha256: 'after', status: 'committed', createdAt: 2 }],
              outputs: [{ outputId: 'out-1', revisionId: 'rev-2', format: 'xlsx', path: '.openclaw/structured-artifacts/artifact-research/rev-2.xlsx', validationStatus: 'passed', journalRef: 'write-journal:session:1' }],
            },
          },
        },
        hostApi: baseHostApiMocks(),
      });

      const page = await getStableWindow(app);
      await page.waitForTimeout(3000);
      const managed = page.getByTestId('structured-artifacts-view');
      await expect(managed).toBeVisible({ timeout: 10_000 });
      await expect(managed).toContainText('artifact-research');
      await managed.getByRole('button', { name: 'artifact-research' }).click();
      await expect(managed).toContainText('Revision 2');
      await expect(managed).toContainText('XLSX');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows empty state when no artifacts exist', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: [], hasMore: false },
          },
          [stableStringify(['workspaces.getSessionState', { workspaceId: WORKSPACE.id, sessionKey: SESSION_KEY }])]: {
            success: true,
            result: {
              artifactPanel: { open: true, activeTab: 'artifact' },
            },
          },
        },
        hostApi: baseHostApiMocks(),
      });

      const page = await getStableWindow(app);
      await page.waitForTimeout(3000);

      // The artifact panel should be open with the artifact tab active.
      // Look for the empty state text inside the artifact view.
      const artifactView = page.locator('[data-testid="artifact-view"]');
      await expect(artifactView).toBeVisible({ timeout: 5_000 });

      // The left sidebar shows empty state text
      // Use a more specific locator scoped to the artifact view
      await expect(artifactView.locator('text=No artifacts generated yet')).toBeVisible({ timeout: 5_000 });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the artifact view with title', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
            success: true,
            result: { messages: [], hasMore: false },
          },
          [stableStringify(['workspaces.getSessionState', { workspaceId: WORKSPACE.id, sessionKey: SESSION_KEY }])]: {
            success: true,
            result: {
              artifactPanel: { open: true, activeTab: 'artifact' },
            },
          },
        },
        hostApi: baseHostApiMocks(),
      });

      const page = await getStableWindow(app);
      await page.waitForTimeout(3000);

      // The artifact view should show the "Artifacts" title in the panel header
      const artifactView = page.locator('[data-testid="artifact-view"]');
      await expect(artifactView).toBeVisible({ timeout: 5_000 });

      // Verify the artifact title text
      await expect(artifactView.locator('text=Artifacts').first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});

test('keeps the conversation column in place until the workspace panel expands', async ({ launchElectronApp }, testInfo) => {
  const app = await launchElectronApp({ skipSetup: true });

  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
      gatewayRpc: {
        [stableStringify(['sessions.list', {}])]: {
          success: true,
          result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
        },
        [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
          success: true,
          result: { messages: [], hasMore: false },
        },
        [stableStringify(['workspaces.getSessionState', { workspaceId: WORKSPACE.id, sessionKey: SESSION_KEY }])]: {
          success: true,
          // Open the panel on the artifact tab (collapsed — no `expanded` flag)
          // so the aside renders without needing a workspace file tree. Opening
          // it via the composer toggle instead would fight this same restored
          // session state (which re-applies on load), so the panel is seeded
          // open here exactly like the sibling tests above.
          result: { artifactPanel: { open: true, activeTab: 'artifact' } },
        },
      },
      hostApi: baseHostApiMocks(),
    });

    const page = await getStableWindow(app);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(3000);

    const panel = page.getByTestId('artifact-panel-aside');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toHaveAttribute('data-expanded', 'false');
    // The workspace panel used to float as an `absolute` overlay while
    // collapsed and only become a `relative` layout sibling once expanded. It
    // was redesigned to always be a `relative` flex sibling of the conversation
    // (see the aside comment in src/pages/Chat/index.tsx): collapsing/expanding
    // now changes how MUCH width it takes, not which layer it lives on. So even
    // collapsed it occupies real layout width and squeezes the conversation.
    await expect.poll(async () => panel.evaluate((element) => getComputedStyle(element).position)).toBe('relative');

    const collapsedWidths = await page.evaluate(() => {
      const pageEl = document.querySelector<HTMLElement>('[data-testid="chat-page"]');
      const conversation = document.querySelector<HTMLElement>('[data-testid="chat-conversation-column"]');
      const aside = document.querySelector<HTMLElement>('[data-testid="artifact-panel-aside"]');
      return {
        page: pageEl?.getBoundingClientRect().width ?? 0,
        conversation: conversation?.getBoundingClientRect().width ?? 0,
        panel: aside?.getBoundingClientRect().width ?? 0,
      };
    });
    // A collapsed panel already takes real width, so the conversation is
    // narrower than the full page by roughly the panel's width.
    expect(collapsedWidths.panel).toBeGreaterThan(0);
    expect(collapsedWidths.conversation).toBeLessThan(collapsedWidths.page - 100);

    await page.getByTestId('artifact-panel-expand').click();
    await expect(panel).toHaveAttribute('data-expanded', 'true');
    await expect.poll(async () => panel.evaluate((element) => getComputedStyle(element).position)).toBe('relative');

    const expandedWidths = await page.evaluate(() => {
      const conversation = document.querySelector<HTMLElement>('[data-testid="chat-conversation-column"]');
      return conversation?.getBoundingClientRect().width ?? 0;
    });
    // Expanding takes even more width from the conversation column.
    expect(expandedWidths).toBeLessThan(collapsedWidths.conversation - 100);
    await page.screenshot({ path: testInfo.outputPath('workspace-expanded.png'), animations: 'disabled' });

    const artifactTab = page.getByTestId('artifact-panel-tab-artifact');
    await artifactTab.evaluate(element => { element.setAttribute('data-retained-tab', 'yes'); });
    await page.getByTestId('artifact-panel-close').click();
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('chat-workspace-toggle')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('workspace-hidden.png'), animations: 'disabled' });
    await page.getByTestId('chat-workspace-toggle').click();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-expanded', 'true');
    await expect(artifactTab).toHaveAttribute('data-retained-tab', 'yes');
    await expect(artifactTab).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('artifact-panel-expand').click();
    await expect(panel).toHaveAttribute('data-expanded', 'false');
    await page.getByTestId('chat-workspace-toggle').click();
    await expect(panel).toBeHidden();
    await page.getByTestId('chat-workspace-toggle').click();
    await expect(artifactTab).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('artifact-panel-new-tab').click();
    await expect(page.getByTestId('artifact-panel-new-tab-menu')).toBeVisible();
    await page.getByTestId('chat-workspace-toggle').focus();
    await page.getByTestId('chat-workspace-toggle').press('Enter');
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('artifact-panel-new-tab-menu')).toHaveCount(0);
    await page.getByTestId('chat-workspace-toggle').click();
    await expect(artifactTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('artifact-panel-new-tab-menu')).toHaveCount(0);
  } finally {
    await closeElectronApp(app);
  }
});

test('reaps an owned Windows child before closing the Electron pipe', async ({ launchElectronApp }) => {
  test.skip(process.platform !== 'win32', 'Exercises the Windows taskkill process-tree path.');
  const app = await launchElectronApp({ skipSetup: true });
  let childPid: number | undefined;
  let childReaped = false;
  let appClosed = false;
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  };
  try {
    childPid = await app.evaluate(async () => {
      const { spawn } = process.mainModule!.require('node:child_process') as typeof import('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'inherit', windowsHide: true,
      });
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      if (!child.pid) throw new Error('Owned child did not start');
      return child.pid;
    });
    expect(alive(childPid)).toBe(true);
    await closeElectronApp(app);
    appClosed = true;
    await expect.poll(() => alive(childPid!)).toBe(false);
    childReaped = true;
  } finally {
    if (childPid && !childReaped) {
      try { process.kill(childPid, 'SIGKILL'); } catch { /* already exited */ }
    }
    if (!appClosed) await closeElectronApp(app);
  }
});
