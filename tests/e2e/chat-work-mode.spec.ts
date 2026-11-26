import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import type { ElectronApplication } from '@playwright/test';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

// FP-P1-01 added a first-send provider gate: when no usable provider exists the
// composer intercepts the send instead of dispatching it. Any test that actually
// sends a message must present a configured, keyed default account, otherwise the
// send never happens and no chat payload is ever recorded.
const PROVIDER_TIMESTAMP = '2026-01-01T00:00:00.000Z';
const PROVIDER_HOST_API_MOCKS: Record<string, unknown> = {
  [stableStringify(['providers', 'accounts', null])]: [
    {
      id: 'anthropic-e2e',
      vendorId: 'anthropic',
      label: 'Anthropic',
      authMode: 'api_key',
      model: 'claude-opus-4',
      enabled: true,
      isDefault: true,
      createdAt: PROVIDER_TIMESTAMP,
      updatedAt: PROVIDER_TIMESTAMP,
    },
  ],
  [stableStringify(['providers', 'accountKeyInfo', null])]: [
    { accountId: 'anthropic-e2e', hasKey: true, keyMasked: 'sk-***' },
  ],
  [stableStringify(['providers', 'vendors', null])]: [],
  [stableStringify(['providers', 'getDefaultAccount', null])]: { accountId: 'anthropic-e2e' },
};

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
  sessionStates: {
    [SESSION_KEY]: {},
  },
};

const WORKSPACE_SNAPSHOT = {
  profiles: [WORKSPACE],
  activeWorkspaceId: WORKSPACE.id,
  activeWorkspace: WORKSPACE,
};

async function installHostInvokeRecorder(app: ElectronApplication) {
  await app.evaluate(async () => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: Record<string, unknown>) => Promise<unknown>>;
    })._invokeHandlers;
    const previous = handlers?.get('host:invoke');
    if (!previous) return;
    (globalThis as unknown as {
      __clawxLastChatPayload?: unknown;
    }).__clawxLastChatPayload = undefined;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Record<string, unknown>) => {
      const module = request.module;
      const action = request.action;
      const payload = request.payload as Record<string, unknown> | undefined;
      if (module === 'workspaces' && action === 'saveState') {
        return { id: request.id as string | undefined, ok: true, data: { success: true } };
      }
      if (module === 'workProviders' && action === 'status') {
        return {
          id: request.id as string | undefined,
          ok: true,
          data: {
            success: true,
            providers: [],
            capabilities: [],
            kitCapabilities: [
              {
                kit: 'reports',
                capability: 'document.write',
                providerIds: ['office-document-js'],
                statuses: ['ready'],
                sourceKinds: ['builtInLibrary'],
              },
              {
                kit: 'sheets',
                capability: 'sheet.read',
                providerIds: ['office-sheet-js'],
                statuses: ['ready'],
                sourceKinds: ['builtInLibrary'],
              },
              {
                kit: 'slides',
                capability: 'slide.write',
                providerIds: ['office-slide-js'],
                statuses: ['ready'],
                sourceKinds: ['builtInLibrary'],
              },
              {
                kit: 'pdf',
                capability: 'pdf.validate',
                providerIds: ['pdf-js'],
                statuses: ['ready'],
                sourceKinds: ['builtInLibrary'],
              },
            ],
            summary: {
              ready: 4,
              missingDependency: 0,
              missingConfig: 0,
              disabled: 0,
              externalUnavailable: 0,
              runtimeUnavailable: 0,
            },
            sourceSummary: {
              builtInLibrary: 4,
              optionalPackage: 0,
              externalBinary: 0,
              externalService: 0,
              customHttp: 0,
              runtimeSkill: 0,
              mcpServer: 0,
              openClawPlugin: 0,
            },
          },
        };
      }
      if (module === 'chat' && action === 'sendWithMedia') {
        (globalThis as unknown as { __clawxLastChatPayload?: unknown }).__clawxLastChatPayload = payload;
        return { id: request.id as string | undefined, ok: true, data: { success: true, result: { runId: 'run-work-mode' } } };
      }
      return previous(event, request);
    });
  });
}

test.describe('Verse Claw chat without Work Mode', () => {
  test('hides Work Mode UI and sends payload without workMode', async ({ launchElectronApp }) => {
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
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          ...PROVIDER_HOST_API_MOCKS,
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { language: 'en', setupComplete: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
          [stableStringify(['workspaces', 'list', null])]: WORKSPACE_SNAPSHOT,
          [stableStringify(['taskLedger', 'snapshot', { workspaceId: WORKSPACE.id }])]: {
            snapshot: {
              workspaceId: WORKSPACE.id,
              nodes: [],
              edges: [],
              eventsCount: 0,
              activeNodeIds: [],
              blockedNodeIds: [],
              reviewNodeIds: [],
              recentDecisions: [],
            },
          },
          [stableStringify(['/api/skills/quick-access', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, skills: [] },
            },
          },
        },
      });
      await installHostInvokeRecorder(app);

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-work-mode-button')).toHaveCount(0);
      await expect(page.getByTestId('work-mode-summary-panel')).toHaveCount(0);
      await expect(page.getByTestId('chat-model-picker-button')).toBeVisible();

      await page.getByTestId('chat-composer-permission-mode').click();
      await expect(page.getByTestId('chat-composer-permission-menu')).toBeVisible();
      await expect(page.getByTestId('chat-composer-permission-option-acceptEdits')).toBeVisible();
      await page.keyboard.press('Escape');

      await page.getByTestId('chat-composer-input').fill('Summarize this spreadsheet');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('work-mode-summary-panel')).toHaveCount(0);

      await expect.poll(async () => await app.evaluate(() => (
        Boolean((globalThis as unknown as { __clawxLastChatPayload?: unknown }).__clawxLastChatPayload)
      ))).toBe(true);
      const payload = await app.evaluate(() => (
        (globalThis as unknown as { __clawxLastChatPayload?: Record<string, unknown> }).__clawxLastChatPayload ?? null
      ));
      expect(payload).toMatchObject({ message: 'Summarize this spreadsheet' });
      expect(payload).not.toHaveProperty('workMode');
    } finally {
      await closeElectronApp(app);
    }
  });
});
