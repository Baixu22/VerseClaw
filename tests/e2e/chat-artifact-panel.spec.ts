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

const WORKSPACE_FILES = {
  ...WORKSPACE,
  rootPath: '/tmp/artifact-workspace',
  sessionStates: {
    [SESSION_KEY]: {
      artifactPanel: {
        open: true,
        activeTab: 'browser',
        workspaceView: 'files',
        selectedPath: 'src/main.ts',
      },
    },
  },
};

const WORKSPACE_TREE = {
  ok: true,
  truncated: false,
  root: {
    name: 'artifact-workspace',
    relPath: '',
    absPath: '/tmp/artifact-workspace',
    isDir: true,
    children: [
      {
        name: 'src',
        relPath: 'src',
        absPath: '/tmp/artifact-workspace/src',
        isDir: true,
        children: [
          {
            name: 'main.ts',
            relPath: 'src/main.ts',
            absPath: '/tmp/artifact-workspace/src/main.ts',
            isDir: false,
            size: 1280,
            mtime: 1,
          },
        ],
      },
      {
        name: 'package.json',
        relPath: 'package.json',
        absPath: '/tmp/artifact-workspace/package.json',
        isDir: false,
        size: 640,
        mtime: 1,
      },
    ],
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
        json: { success: true, agents: [{ id: 'main', name: 'main' }] },
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
    [stableStringify(['system', 'info', null])]: {
      ram: { totalBytes: 16_000_000_000, freeBytes: 8_000_000_000 },
      disk: [{ mount: 'C:', totalBytes: 1_000_000_000_000, freeBytes: 500_000_000_000 }],
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

  test('renders the compact workspace tree and selected file path', async ({ launchElectronApp }) => {
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
            result: WORKSPACE_FILES.sessionStates[SESSION_KEY],
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['workspaces', 'list', null])]: {
            success: true,
            profiles: [WORKSPACE_FILES],
            activeWorkspaceId: WORKSPACE_FILES.id,
            activeWorkspace: WORKSPACE_FILES,
          },
          [stableStringify(['files', 'listTree', {
            path: WORKSPACE_FILES.rootPath,
            opts: { maxDepth: undefined, maxNodes: undefined, includeHidden: false },
          }])]: WORKSPACE_TREE,
          [stableStringify(['files', 'stat', {
            path: '/tmp/artifact-workspace/src/main.ts',
          }])]: { ok: true, size: 1280 },
          [stableStringify(['files', 'readText', {
            path: '/tmp/artifact-workspace/src/main.ts',
          }])]: { ok: true, content: 'export const ready = true;\n', size: 27, readOnly: true },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('artifact-panel-tab-browser')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('artifact-panel-tab-browser').click();
      await expect(page.getByTestId('workspace-file-tree-pane')).toBeVisible();
      await expect(page.getByTestId('ai-file-tree')).toHaveAttribute('data-density', 'compact');
      await expect(page.getByTestId('workspace-panel-path')).toHaveText(WORKSPACE_FILES.rootPath);
      await expect(page.getByTestId('workspace-file-preview-path')).toContainText('src/main.ts');
      await expect(page.getByTestId('artifact-panel')).toHaveScreenshot('codex-workspace-tree-light.png', {
        animations: 'disabled',
        caret: 'hide',
      });
      await page.evaluate(() => {
        localStorage.setItem('verse-claw-settings', JSON.stringify({
          state: { theme: 'dark' },
          version: 0,
        }));
      });
      await page.reload();
      await expect(page.getByTestId('artifact-panel-tab-browser')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('artifact-panel-tab-browser').click();
      await expect(page.getByTestId('workspace-file-preview-path')).toContainText('src/main.ts');
      await expect(page.getByTestId('artifact-panel')).toHaveScreenshot('codex-workspace-tree-dark.png', {
        animations: 'disabled',
        caret: 'hide',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
