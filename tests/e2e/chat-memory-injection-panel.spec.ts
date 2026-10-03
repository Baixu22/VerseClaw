// R3-2.2 "本轮注入了什么" — Electron E2E for the memory-injection receipt panel.
// Covers the three states the panel must render: injected (receipts with refs),
// none (successful empty read), and timeout (failed read -> retryable error).
//
// The panel reads only hostApi.memory.injectionReceipts (module: 'memory',
// action: 'injectionReceipts'), so the whole surface is driven by stubbing that
// one host route — no runtime, no gateway RPC.
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

const WORKSPACE = {
  id: 'workspace-1',
  name: 'Demo Workspace',
  rootPath: '/tmp/demo-workspace',
  agentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: { [SESSION_KEY]: {} },
};

const WORKSPACE_SNAPSHOT = {
  profiles: [WORKSPACE],
  activeWorkspaceId: WORKSPACE.id,
  activeWorkspace: WORKSPACE,
};

const INJECTED_RECEIPT = {
  sessionKey: SESSION_KEY,
  source: 'compass-pre-reply-retrieval',
  selected: ['ref:memory:fact-a', 'ref:memory:fact-b'],
  omitted: ['ref:memory:fact-c'],
  budgetCharsApplied: 120,
  budgetCharsRequested: 200,
  createdAt: 1_726_000_000_000,
};

// Each mode makes the memory.injectionReceipts host route behave differently.
type ReceiptMode = 'injected' | 'none' | 'timeout';

async function installStubs(app: ElectronApplication, mode: ReceiptMode, receipt: typeof INJECTED_RECEIPT) {
  await app.evaluate(async ({ ipcMain }, args: { mode: ReceiptMode; receipt: typeof INJECTED_RECEIPT; sessionKey: string; snapshot: typeof WORKSPACE_SNAPSHOT }) => {
    const { mode, receipt, sessionKey, snapshot } = args;

    ipcMain.removeHandler('gateway:status');
    ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345, gatewayReady: true }));

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (_event: unknown, request: {
      id?: string; module?: string; action?: string; payload?: Record<string, unknown>;
    }) => {
      const makeResponse = (data: unknown) => ({ id: typeof request.id === 'string' ? request.id : undefined, ok: true, data });
      if (request.module === 'gateway' && request.action === 'status') {
        return makeResponse({ state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      }
      if (request.module === 'gateway' && request.action === 'rpc') {
        const method = typeof request.payload?.method === 'string' ? request.payload.method : '';
        if (method === 'sessions.list') return makeResponse({ success: true, result: { sessions: [{ key: sessionKey, displayName: 'main' }] } });
        if (method === 'chat.history') return makeResponse({ success: true, result: { messages: [] } });
        return makeResponse({ success: true, result: {} });
      }
      if (request.module === 'settings' && request.action === 'get') return makeResponse({ language: 'en', setupComplete: true });
      if (request.module === 'settings' && request.action === 'set') return makeResponse({ success: true });
      if (request.module === 'agents' && request.action === 'list') {
        return makeResponse({
          success: true,
          agents: [{ id: 'main', name: 'Main', isDefault: true, modelDisplay: 'test/model', modelRef: 'test/model', inheritedModel: false, workspace: '~/.openclaw/workspace', agentDir: '~/.openclaw/agents/main/agent', mainSessionKey: sessionKey, channelTypes: [] }],
          defaultAgentId: 'main', defaultModelRef: 'test/model', configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {},
        });
      }
      if (request.module === 'workspaces' && request.action === 'list') return makeResponse(snapshot);
      // The panel's single data source.
      if (request.module === 'memory' && request.action === 'injectionReceipts') {
        if (mode === 'timeout') return makeResponse({ success: false, error: 'RPC timeout after 15000ms' });
        if (mode === 'none') return makeResponse({ success: true, receipts: [] });
        return makeResponse({ success: true, receipts: [receipt] });
      }
      return makeResponse({});
    });
  }, { mode, receipt, sessionKey: SESSION_KEY, snapshot: WORKSPACE_SNAPSHOT });
}

async function openChatAndPanel(app: ElectronApplication) {
  const page = await getStableWindow(app);
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
  });
  await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
  const toggle = page.getByTestId('chat-memory-injection-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  return page;
}

test.describe('R3-2.2 memory-injection panel', () => {
  test('injected: shows the source group with selected refs and budget', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installStubs(app, 'injected', INJECTED_RECEIPT);
      const page = await openChatAndPanel(app);

      const group = page.getByTestId('memory-injection-source-group');
      await expect(group).toBeVisible();
      await expect(group).toHaveAttribute('data-source', 'compass-pre-reply-retrieval');
      await expect(page.getByText('ref:memory:fact-a')).toBeVisible();
      await expect(page.getByTestId('memory-injection-empty')).toHaveCount(0);
      await expect(page.getByTestId('memory-injection-error')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('none: a successful empty read shows the empty state', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installStubs(app, 'none', INJECTED_RECEIPT);
      const page = await openChatAndPanel(app);

      await expect(page.getByTestId('memory-injection-empty')).toBeVisible();
      await expect(page.getByTestId('memory-injection-source-group')).toHaveCount(0);
      await expect(page.getByTestId('memory-injection-error')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('timeout: a failed read shows a retryable error', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installStubs(app, 'timeout', INJECTED_RECEIPT);
      const page = await openChatAndPanel(app);

      await expect(page.getByTestId('memory-injection-error')).toBeVisible();
      await expect(page.getByTestId('memory-injection-empty')).toHaveCount(0);
      await expect(page.getByTestId('memory-injection-source-group')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
