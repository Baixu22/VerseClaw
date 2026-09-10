import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const snapshot = {
  schemaVersion: 1,
  workspaceId: 'default-0000000000',
  generatedAt: '2026-06-16T10:00:00.000Z',
  nodes: [
    {
      id: 'goal-1',
      title: 'Ship long task ledger',
      kind: 'goal',
      status: 'doing',
      parentId: null,
      createdAt: '2026-06-16T09:00:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
    {
      id: 'task-active',
      title: 'Wire automatic turn records',
      kind: 'task',
      status: 'doing',
      parentId: 'goal-1',
      createdAt: '2026-06-16T09:12:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
    {
      id: 'task-1',
      title: 'Resolve export blocker',
      kind: 'task',
      status: 'blocked',
      parentId: 'goal-1',
      createdAt: '2026-06-16T09:10:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
    {
      id: 'task-2',
      title: 'Review agent-neutral schema',
      kind: 'review',
      status: 'review',
      parentId: 'goal-1',
      createdAt: '2026-06-16T09:20:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
    {
      id: 'decision-1',
      title: 'Use append-only JSONL',
      kind: 'decision',
      status: 'done',
      parentId: 'goal-1',
      createdAt: '2026-06-16T09:30:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
    {
      id: 'plan-projection',
      title: 'planner: Plan the stabilization',
      kind: 'task',
      status: 'todo',
      parentId: 'goal-1',
      createdAt: '2026-06-16T09:35:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
      metadata: {
        readonlyProjection: true,
        source: 'orchestrator.plan',
      },
    },
  ],
  edges: [
    {
      id: 'edge-1',
      from: 'task-1',
      to: 'goal-1',
      type: 'depends_on',
      createdAt: '2026-06-16T09:40:00.000Z',
    },
  ],
  sessionLinks: [
    {
      id: 'link-1',
      nodeId: 'task-1',
      sessionKey: 'agent:main:main',
      summary: 'Implementation session',
      createdAt: '2026-06-16T09:50:00.000Z',
    },
  ],
  rootNodeIds: ['goal-1'],
  reviewNodeIds: ['task-2'],
  activeNodeIds: ['goal-1', 'task-active'],
  blockedNodeIds: ['task-1'],
  currentGoalId: 'goal-1',
  recentDecisions: [
    {
      id: 'decision-1',
      title: 'Use append-only JSONL',
      kind: 'decision',
      status: 'done',
      parentId: 'goal-1',
      createdAt: '2026-06-16T09:30:00.000Z',
      updatedAt: '2026-06-16T10:00:00.000Z',
    },
  ],
  eventsCount: 8,
  warnings: [],
};

const WORKSPACE = {
  id: 'default',
  name: 'Default Workspace',
  rootPath: 'C:\\Users\\27933\\Desktop\\clawx\\ClawX',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: 'agent:main:main',
  permissionMode: 'acceptEdits',
  createdAt: '2026-06-16T09:00:00.000Z',
  updatedAt: '2026-06-16T10:00:00.000Z',
  agentBindings: {},
  sessionStates: {},
  state: {},
};

function baseHostApiMocks() {
  return {
    [stableStringify(['gateway', 'status', null])]: {
      state: 'running',
      port: 18789,
      pid: 12345,
      gatewayReady: true,
    },
    [stableStringify(['workspaces', 'list', null])]: {
      success: true,
      profiles: [WORKSPACE],
      activeWorkspaceId: WORKSPACE.id,
      activeWorkspace: WORKSPACE,
    },
    [stableStringify(['/api/workspaces', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          workspaces: [WORKSPACE],
          activeWorkspaceId: WORKSPACE.id,
          activeWorkspace: WORKSPACE,
        },
      },
    },
    [stableStringify(['agents', 'list', null])]: {
      success: true,
      agents: [{ id: 'main', name: 'main', canonicalSessionKey: 'agent:main:main' }],
      defaultAgentId: 'main',
      defaultModelRef: null,
    },
    [stableStringify(['providers', 'accounts', null])]: [{
      id: 'task-ledger-e2e',
      vendorId: 'anthropic',
      label: 'Task Ledger E2E',
      authMode: 'api_key',
      model: 'claude-opus-4',
      enabled: true,
      isDefault: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    [stableStringify(['providers', 'accountKeyInfo', null])]: [
      { accountId: 'task-ledger-e2e', hasKey: true, keyMasked: 'sk-***' },
    ],
    [stableStringify(['providers', 'vendors', null])]: [],
    [stableStringify(['providers', 'getDefaultAccount', null])]: { accountId: 'task-ledger-e2e' },
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, agents: [{ id: 'main', name: 'main' }] },
      },
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
    [stableStringify(['git', 'status', null])]: {
      success: true,
      status: {
        isRepository: false,
        workspaceRoot: WORKSPACE.rootPath,
        ahead: 0,
        behind: 0,
        clean: true,
        hasConflicts: false,
        changes: [],
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        conflictedCount: 0,
      },
    },
  };
}

test.describe('Task ledger', () => {
  test('shows task ledger page tabs without restoring the legacy chat context bar', async ({ launchElectronApp }) => {
    const electronApp = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(electronApp, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] },
          },
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: {
              messages: [{ role: 'user', content: [{ type: 'text', text: 'Work on long task ledger' }], timestamp: Date.now() }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200 }])]: {
            success: true,
            result: {
              messages: [{ role: 'user', content: [{ type: 'text', text: 'Work on long task ledger' }], timestamp: Date.now() }],
            },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
        [stableStringify(['sessions', 'history', { sessionKey: 'agent:main:main', limit: 200 }])]: {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Work on long task ledger' }], timestamp: Date.now() }],
        },
        [stableStringify(['taskLedger', 'snapshot', { workspaceId: 'default' }])]: {
          success: true,
          snapshot,
        },
        [stableStringify(['taskLedger', 'snapshot', { workspaceId: null }])]: {
          success: true,
          snapshot,
        },
        [stableStringify(['taskLedger', 'exportHtml', { workspaceId: 'default', includeHistory: true }])]: {
          success: true,
          path: '/tmp/task-ledger.html',
        },
        },
      });

      const page = await getStableWindow(electronApp);

      await page.getByTestId('sidebar-footer-menu-trigger').click();
      await page.getByTestId('sidebar-more-task-ledger').click();
      await expect(page.getByTestId('task-ledger-page')).toBeVisible();
      await expect(page.getByTestId('task-ledger-tree')).toContainText('Ship long task ledger');
      await expect(page.getByTestId('task-ledger-status-plan-projection')).toBeDisabled();
      await page.getByRole('tab', { name: /DAG/ }).click();
      await expect(page.getByTestId('task-ledger-dag')).toContainText('depends on');
      await page.getByRole('tab', { name: 'History' }).click();
      await expect(page.getByTestId('task-ledger-history')).toContainText('8 event records');
      await page.getByRole('tab', { name: 'Review' }).click();
      await expect(page.getByTestId('task-ledger-review')).toContainText('Review agent-neutral schema');

      await page.evaluate(() => {
        window.location.hash = '/';
      });
      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page.getByTestId('work-context-bar')).toHaveCount(0);
    } finally {
      await closeElectronApp(electronApp);
    }
  });

  test('passes the selected task node through chat send and records final turns', async ({ launchElectronApp }) => {
    const electronApp = await launchElectronApp({ skipSetup: true });
    const persistedTurnMessages = [
      {
        role: 'user',
        id: 'persisted-user-ledger',
        content: [{ type: 'text', text: 'Previously persisted turn' }],
        timestamp: 1782215900,
      },
      {
        role: 'assistant',
        id: 'persisted-assistant-ledger',
        content: [{ type: 'text', text: '## Summary\n- Rebuilt Task Ledger projection from persisted transcript' }],
        timestamp: 1782215901,
      },
    ];
    try {
      await installIpcMocks(electronApp, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] },
          },
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: persistedTurnMessages },
          },
          [stableStringify(['chat.history', { sessionKey: 'agent:main:main', limit: 200 }])]: {
            success: true,
            result: { messages: persistedTurnMessages },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
        [stableStringify(['sessions', 'history', { sessionKey: 'agent:main:main', limit: 200 }])]: {
          messages: persistedTurnMessages,
        },
        [stableStringify(['taskLedger', 'snapshot', { workspaceId: 'default' }])]: {
          success: true,
          snapshot,
        },
        [stableStringify(['taskLedger', 'snapshot', { workspaceId: null }])]: {
          success: true,
          snapshot,
        },
        [stableStringify(['chat', 'sendWithMedia', null])]: {
          success: true,
          result: { runId: 'run-ledger-e2e' },
        },
        [stableStringify(['taskLedger', 'appendEvents', null])]: {
          success: true,
          snapshot,
        },
        },
      });

      const page = await getStableWindow(electronApp);
      await page.reload();
      await page.evaluate(() => {
        window.location.hash = '#/';
      });
      await expect.poll(() => new URL(page.url()).hash).toBe('#/');
      await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled();

      await page.getByTestId('chat-composer-actions').click();
      await page.getByTestId('chat-composer-action-more').click();
      await expect(page.getByTestId('task-node-selector')).toBeVisible();
      await page.getByTestId('task-node-selector-trigger').hover();
      await page.getByTestId('task-node-selector-option-task-active').click();
      await expect(page.getByText('Wire automatic turn records')).toBeVisible();

      await page.getByTestId('chat-composer-input').fill('Record this turn');
      await page.getByTestId('chat-composer-send').click();

      await expect.poll(async () => {
        return await electronApp.evaluate(() => {
          const calls = (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> | null }> }).__verseClawE2eHostCalls ?? [];
          return calls.find((call) => call.module === 'chat' && call.action === 'sendWithMedia')?.payload ?? null;
        });
      }).toMatchObject({
        workspaceId: 'default',
        activeTaskNodeId: 'task-active',
        message: 'Record this turn',
      });

      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('aria-label', /Stop|停止/);

      await electronApp.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'tool.started',
            runId: 'run-ledger-e2e',
            sessionKey: 'agent:main:main',
            toolCallId: 'tool-read-1',
            name: 'read',
            args: { filePath: 'src/stores/chat.ts' },
          });
          win.webContents.send('chat:runtime-event', {
            type: 'patch.completed',
            runId: 'run-ledger-e2e',
            sessionKey: 'agent:main:main',
            toolCallId: 'tool-patch-1',
            name: 'apply_patch',
            summary: 'modified tests/e2e/task-ledger.spec.ts',
          });
          win.webContents.send('chat:runtime-event', {
            type: 'approval.updated',
            runId: 'run-ledger-e2e',
            sessionKey: 'agent:main:main',
            itemId: 'approval-1',
            kind: 'command',
            status: 'approved',
            message: 'Allowed structured runtime evidence',
          });
          win.webContents.send('gateway:chat-message', {
            runId: 'run-ledger-e2e',
            message: {
              role: 'assistant',
              id: 'assistant-ledger-final',
              content: [{
                type: 'text',
                text: [
                  '```task-ledger',
                  JSON.stringify({
                    outcome: 'completed',
                    summary: 'Recorded the ordinary chat turn into Task Ledger.',
                    decisions: ['Use Task Ledger as durable turn projection.'],
                    filesTouched: ['src/stores/chat/runtime-event-handlers.ts'],
                    toolsUsed: ['read', 'apply_patch'],
                    reviewNeeded: false,
                  }),
                  '```',
                ].join('\n'),
              }],
              stopReason: 'stop',
            },
          });
        }
      });

      await expect.poll(async () => {
        return await electronApp.evaluate(() => {
          const calls = (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> | null }> }).__verseClawE2eHostCalls ?? [];
          const appendCall = calls.findLast((call) => call.module === 'taskLedger' && call.action === 'appendEvents');
          return appendCall?.payload ?? null;
        });
      }).toMatchObject({
        workspaceId: 'default',
        events: expect.arrayContaining([
          expect.objectContaining({
            type: 'node_created',
            payload: expect.objectContaining({
              node: expect.objectContaining({
                kind: 'check',
                status: 'done',
                parentId: 'task-active',
                tags: expect.arrayContaining(['read', 'apply_patch']),
                evidenceRefs: expect.arrayContaining([
                  expect.objectContaining({ type: 'tool', ref: 'tool-read-1', label: 'read' }),
                  expect.objectContaining({ type: 'tool', ref: 'tool-patch-1', label: 'apply_patch' }),
                  expect.objectContaining({ type: 'file', ref: 'src/stores/chat.ts' }),
                  expect.objectContaining({ type: 'file', ref: 'tests/e2e/task-ledger.spec.ts' }),
                ]),
                metadata: expect.objectContaining({
                  approvals: expect.arrayContaining(['command: approved: Allowed structured runtime evidence']),
                }),
              }),
            }),
          }),
          expect.objectContaining({
            type: 'session_linked',
            payload: expect.objectContaining({
              sessionLink: expect.objectContaining({
                sessionKey: 'agent:main:main',
                relation: 'related',
              }),
            }),
          }),
        ]),
      });

      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('aria-label', /Send|发送/);

      await page.reload();
      await expect(page.getByTestId('chat-page')).toBeVisible();

      await expect.poll(async () => {
        return await electronApp.evaluate(() => {
          const calls = (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> | null }> }).__verseClawE2eHostCalls ?? [];
          const appendCalls = calls.filter((call) => call.module === 'taskLedger' && call.action === 'appendEvents');
          return appendCalls.length;
        });
      }).toBeGreaterThanOrEqual(2);

      const reloadAppendPayload = await electronApp.evaluate(() => {
        const calls = (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> | null }> }).__verseClawE2eHostCalls ?? [];
        const appendCalls = calls.filter((call) => call.module === 'taskLedger' && call.action === 'appendEvents');
        return appendCalls.at(-1)?.payload ?? null;
      });
      expect(reloadAppendPayload).toMatchObject({
        workspaceId: 'default',
        events: expect.arrayContaining([
          expect.objectContaining({
            type: 'node_created',
            payload: expect.objectContaining({
              node: expect.objectContaining({
                kind: 'check',
                status: 'done',
              }),
            }),
          }),
          expect.objectContaining({
            type: 'session_linked',
            payload: expect.objectContaining({
              sessionLink: expect.objectContaining({
                sessionKey: 'agent:main:main',
              }),
            }),
          }),
        ]),
      });
    } finally {
      await closeElectronApp(electronApp);
    }
  });
});
