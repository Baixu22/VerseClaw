import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const CHECKPOINT_ID = 'mission:m1:tick:3';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function checkpointPayload() {
  return {
    sessionKey: SESSION_KEY,
    agentId: 'main',
    limit: 20,
  };
}

function makeCheckpoint(id: string, createdAt: string) {
  return {
    id,
    sessionKey: SESSION_KEY,
    trigger: 'guide',
    status: 'repair',
    checkpoint: {
      schemaVersion: 1,
      id,
      sessionKey: SESSION_KEY,
      trigger: 'guide',
      objective: 'Implement checkpoint restore flow',
      activeTask: 'Verify the implementation',
      filesTouched: ['src/a.ts', 'src/b.ts'],
      testsRun: ['pnpm test'],
      decisions: ['use sqlite'],
      openBlockers: [],
      deviations: [],
      reviewNeededItems: [],
      evidenceRefs: [],
      createdAt,
    },
    createdAt: Date.parse(createdAt),
    updatedAt: Date.parse(createdAt),
  };
}

function baseHostApiMocks() {
  const workspace = {
    id: 'workspace-a',
    name: 'Checkpoints Workspace',
    rootPath: '/tmp/checkpoints-workspace',
    agentId: 'main',
    activeSessionKey: SESSION_KEY,
    permissionMode: 'acceptEdits' as const,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
  };
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
        json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
      },
    },
    [stableStringify(['/api/workspaces', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, workspaces: [workspace], activeWorkspaceId: 'workspace-a' },
      },
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      success: true,
      activeWorkspaceId: 'workspace-a',
      activeWorkspace: workspace,
    },
    [stableStringify(['workspaces', 'list', null])]: {
      success: true,
      profiles: [workspace],
      activeWorkspaceId: 'workspace-a',
      activeWorkspace: workspace,
    },
    [stableStringify(['sessions', 'resumeCheckpoints', checkpointPayload()])]: {
      success: true,
      key: SESSION_KEY,
      checkpoints: [makeCheckpoint(CHECKPOINT_ID, '2026-07-31T00:00:00.000Z')],
    },
    [stableStringify(['sessions', 'restoreCheckpoint', {
      sessionKey: SESSION_KEY,
      agentId: 'main',
      checkpointId: CHECKPOINT_ID,
    }])]: {
      success: true,
      key: SESSION_KEY,
      checkpointId: CHECKPOINT_ID,
      rolledBackTo: `checkpoint:${CHECKPOINT_ID}`,
      mode: 'legacy_checkpoint_fallback',
      evidenceSummary: `Restored from checkpoint "${CHECKPOINT_ID}"`,
    },
    [stableStringify(['sessions', 'checkpointDiff', {
      sessionKey: SESSION_KEY,
      agentId: 'main',
      checkpointId: CHECKPOINT_ID,
    }])]: {
      success: true,
      key: SESSION_KEY,
      checkpointId: CHECKPOINT_ID,
      files: [
        {
          filePath: 'src/a.ts',
          status: 'modified',
          unifiedDiff: '--- src/a.ts\n+++ src/a.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;\n',
        },
      ],
      errors: [],
    },
  };
}

test('checkpoints dialog lists and restores a session checkpoint', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    gatewayRpc: {
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
        success: true,
        result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: {
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: [{ type: 'text', text: 'Implement the checkpoint restore flow.' }],
              timestamp: 1711111110000,
            },
          ],
        },
      },
    },
    hostApi: baseHostApiMocks(),
  });

  try {
    const page = await getStableWindow(app);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Wait for the chat surface to settle before opening the session menu.
    await expect(page.getByText('Implement the checkpoint restore flow.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('chat-page')).toHaveAttribute('data-session-generation', EXPECTED_SESSION_ID, { timeout: 30_000 });
    await page.getByTestId('chat-toolbar-more').click();
    await expect(page.getByTestId('chat-session-checkpoints')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('chat-session-checkpoints').click();

    // Dialog lists the checkpoint with its summary.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Session checkpoints' })).toBeVisible();
    await expect(page.getByText('Implement checkpoint restore flow')).toBeVisible();

    // Restore the checkpoint.
    await page.getByTestId(`chat-checkpoint-restore-${CHECKPOINT_ID}`).click();
    await expect(page.getByText(`Restored from checkpoint "${CHECKPOINT_ID}"`)).toBeVisible({ timeout: 30_000 });

    // View what the checkpoint would undo (content diff panel).
    await page.getByTestId(`chat-checkpoint-diff-${CHECKPOINT_ID}`).click();
    await expect(page.getByTestId(`chat-checkpoint-diff-panel-${CHECKPOINT_ID}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/src\/a\.ts/).first()).toBeVisible();
    await expect(page.getByText('-const x = 1;')).toBeVisible();

    await page.keyboard.press('Escape');
  } finally {
    await closeElectronApp(app);
  }
});
