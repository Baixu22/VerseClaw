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

test('keeps the conversation column in place until the workspace panel expands', async ({ launchElectronApp }) => {
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
  } finally {
    await closeElectronApp(app);
  }
});
