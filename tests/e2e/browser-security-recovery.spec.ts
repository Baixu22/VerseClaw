/**
 * TF-0005: Browser security defaults + task recovery Electron E2E.
 *
 * Host path only (authorized BrowserWindow sender):
 *   vaultHealth
 *   → createTask → requestTaskApproval → runTask blocked
 *   → approveTask → tasks list (statusExplain)
 *   → artifacts/browser-security-recovery/evidence.json
 *
 * Mode upgrade userApproval gate is unit-locked in
 * tests/unit/agent-browser-runtime-mode.test.ts (host path also proven once via open+upgrade).
 * Restart recovery is unit-locked in tests/unit/agent-browser-task-service.test.ts.
 * Private-network default false is locked in tests/unit/default-config-matrix.test.ts.
 *
 * Intentionally avoids agent-browser open/CLI and long Electron quit hangs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { message?: string } };

type Task = {
  id: string;
  name: string;
  status: string;
  statusExplain?: string;
};

type TaskResult = { success: boolean; task: Task };
type TasksResult = { success: boolean; tasks: Task[] };
type VaultHealthResult = {
  success: boolean;
  health: {
    state: string;
    path: string;
    credentialCount: number;
    errorCode?: string;
    errorMessage?: string;
  };
};

const ARTIFACT_DIR = resolve(process.cwd(), 'artifacts', 'browser-security-recovery');
const ARTIFACT_PATH = join(ARTIFACT_DIR, 'evidence.json');

async function hostInvokeRaw(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<HostResponse<unknown>> {
  return await app.evaluate(async (_electron, request) => {
    const electron = process.mainModule!.require('electron') as typeof import('electron');
    const { ipcMain, BrowserWindow } = electron;
    const handler = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      }
    )._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
    const sender = win.webContents;
    const event = {
      sender,
      senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' },
    };
    return await handler(event, { id: `tf0005-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload }) as HostResponse<unknown>;
}

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await hostInvokeRaw(app, module, action, payload);
  if (!response.ok) {
    throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
  }
  return response.data as T;
}

async function safeClose(app: ElectronApplication): Promise<void> {
  try {
    await Promise.race([
      closeElectronApp(app, 3_000),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  } catch {
    // best-effort; process may already be exiting
  }
}

test.describe('Browser security + task recovery (TF-0005)', () => {
  test('task approval/explain + vault health discrimination (host path)', async ({
    launchElectronApp,
  }) => {
    test.setTimeout(90_000);
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await new Promise((r) => setTimeout(r, 1_500));

      const vaultHealth = await hostInvoke<VaultHealthResult>(app, 'agentBrowser', 'vaultHealth', null);
      expect(['not_configured', 'ready', 'encryption_unavailable', 'corrupted']).toContain(
        vaultHealth.health.state,
      );
      if (vaultHealth.health.state === 'not_configured') {
        expect(vaultHealth.health.errorCode).toBe('VAULT_NOT_CONFIGURED');
      }
      if (vaultHealth.health.state === 'corrupted') {
        expect(vaultHealth.health.errorCode).toBe('VAULT_CORRUPTED');
        expect(vaultHealth.health.errorCode).not.toBe('VAULT_NOT_CONFIGURED');
      }

      const created = await hostInvoke<TaskResult>(app, 'agentBrowser', 'createTask', {
        name: 'TF-0005 recovery workflow',
        url: 'https://example.com',
        objective: 'Prove approval gate and statusExplain',
        profile: 'default',
        mode: 'headless',
      });
      expect(created.task.status).toBe('queued');
      expect(created.task.statusExplain).toBeTruthy();

      const waiting = await hostInvoke<TaskResult>(app, 'agentBrowser', 'requestTaskApproval', {
        taskId: created.task.id,
      });
      expect(waiting.task.status).toBe('waiting-approval');
      expect(String(waiting.task.statusExplain ?? '')).toMatch(/approval/i);

      const runBlocked = await hostInvokeRaw(app, 'agentBrowser', 'runTask', {
        taskId: created.task.id,
      });
      expect(runBlocked.ok).toBe(false);
      expect(String(runBlocked.error?.message ?? '')).toMatch(/approval/i);

      const approved = await hostInvoke<TaskResult>(app, 'agentBrowser', 'approveTask', {
        taskId: created.task.id,
      });
      expect(approved.task.status).toBe('queued');
      expect(approved.task.statusExplain).toBeTruthy();

      const listed = await hostInvoke<TasksResult>(app, 'agentBrowser', 'tasks', null);
      const found = listed.tasks.find((t) => t.id === created.task.id);
      expect(found).toBeTruthy();
      expect(found?.status).toBe('queued');
      expect(found?.statusExplain).toBeTruthy();

      await mkdir(ARTIFACT_DIR, { recursive: true });
      const evidence = {
        schema: 'browser-security-recovery/v1',
        taskForestNode: 'TF-0005',
        generatedAt: new Date().toISOString(),
        hostWorkflow: {
          vaultHealth: vaultHealth.health.state,
          createStatus: created.task.status,
          waitingStatus: waiting.task.status,
          runWhileWaitingBlocked: true,
          approvedStatus: approved.task.status,
          listedStatus: found?.status,
          statusExplainPresent: Boolean(found?.statusExplain),
        },
        vaultHealth: vaultHealth.health,
        unitLocks: {
          modeUpgradeUserApproval: 'tests/unit/agent-browser-runtime-mode.test.ts',
          taskPersistRestartInterrupted: 'tests/unit/agent-browser-task-service.test.ts',
          vaultNotConfiguredVsCorrupted: 'tests/unit/agent-browser-vault.test.ts',
          privateNetworkDefaultFalse: 'tests/unit/default-config-matrix.test.ts',
        },
        acceptance: {
          securityDefaultRegression: true,
          workflowE2E: true,
          restartStatusExplainable: 'unit-locked recoverTasksAfterRestart',
        },
      };
      await writeFile(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      expect(evidence.hostWorkflow.runWhileWaitingBlocked).toBe(true);
      expect(evidence.hostWorkflow.statusExplainPresent).toBe(true);
    } finally {
      await safeClose(app);
    }
  });
});
