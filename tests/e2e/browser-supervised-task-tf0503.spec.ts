/**
 * TF-0503: Browser as a natural supervised task capability (real Electron path).
 *
 * Unlike the workspace preview spec (which records mocked host responses), this
 * spec talks to the REAL `host:invoke` handler registered by Electron Main, so it
 * exercises the real navigation guard, the real capability snapshot and the real
 * private-network default-deny. It deliberately never needs a page to load:
 * private navigation is refused before the module is touched.
 *
 * Evidence: artifacts/browser-supervised-tf0503/evidence.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, test } from './fixtures/electron';
import { evidencePath } from './fixtures/evidence-root';

type HostResponse<T> = { ok: boolean; data?: T; error?: { message?: string; code?: string } };
type StatusData = {
  capabilities?: {
    supervision?: string;
    unsupervisedActions?: string[];
    actions?: Array<{ action: string; supervised: boolean }>;
  };
};

const GUARD_REASON = 'private-network-default-deny';
const ARTIFACT_DIR = resolve(evidencePath('artifacts/browser-supervised-tf0503'));
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
    return await handler(event, { id: 'tf0503', ...request });
  }, { module, action, payload }) as HostResponse<unknown>;
}

async function safeClose(app: ElectronApplication): Promise<void> {
  try {
    await Promise.race([
      closeElectronApp(app, 3_000),
      new Promise<void>((done) => setTimeout(done, 5_000)),
    ]);
  } catch {
    // best-effort; the process may already be exiting
  }
}

test.describe('Browser supervised task capability (TF-0503)', () => {
  test('real Main path: supervised self-description and private-network default deny', async ({
    launchElectronApp,
  }) => {
    test.setTimeout(120_000);
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await new Promise((done) => setTimeout(done, 1_500));

      // 1. Model-facing self-description must say Browser needs supervised permission.
      const status = await hostInvokeRaw(app, 'agentBrowser', 'status', null);
      expect(status.ok).toBe(true);
      const capabilities = (status.data as StatusData).capabilities;
      expect(capabilities?.supervision).toBe('required');
      const supervisedActions = (capabilities?.actions ?? []).filter((entry) => entry.supervised);
      const supervisedNames = supervisedActions.map((entry) => entry.action);
      for (const risky of ['click', 'type', 'evaluate', 'navigate', 'uploadFiles']) {
        expect(supervisedNames, `expected ${risky} to be supervised`).toContain(risky);
      }
      expect((capabilities?.unsupervisedActions ?? []).length).toBeGreaterThan(0);

      // 2. Private-network navigation is refused by the real guard, and refused
      //    specifically by the private-network reason (not an unrelated failure).
      const denials: Array<{ url: string; code: string | null; message: string }> = [];
      for (const url of [
        'http://127.0.0.1:18789/admin',
        'http://169.254.169.254/latest/meta-data',
        'http://192.168.1.1/',
        'http://10.0.0.5/',
        'http://[::1]:9000/',
      ]) {
        const blocked = await hostInvokeRaw(app, 'agentBrowser', 'open', { url, mode: 'headless' });
        expect(blocked.ok, `expected ${url} to be refused`).toBe(false);
        const message = String(blocked.error?.message ?? '');
        expect(message, `expected the guard reason in: ${message}`).toContain(GUARD_REASON);
        denials.push({ url, code: blocked.error?.code ?? null, message });
      }

      // 3. A public navigation is NOT blocked by the private-network guard. It may
      //    still fail for driver/environment reasons; only the guard matters here.
      const publicAttempt = await hostInvokeRaw(app, 'agentBrowser', 'open', {
        url: 'https://example.com/',
        mode: 'headless',
      });
      const publicMessage = String(publicAttempt.error?.message ?? '');
      expect(publicMessage).not.toContain(GUARD_REASON);


      // 4. The shutdown reaper must be registered in the real Main process, so a
      //    cancel/timeout/restart cannot leave an orphan browser session behind.
      const willQuitListeners = await app.evaluate(() => {
        const electron = process.mainModule!.require('electron') as typeof import('electron');
        return electron.app.listenerCount('will-quit');
      });
      expect(willQuitListeners).toBeGreaterThan(0);

      await mkdir(ARTIFACT_DIR, { recursive: true });
      const evidence = {
        schema: 'browser-supervised-tf0503/v1',
        taskForestNode: 'TF-0503',
        generatedAt: new Date().toISOString(),
        driven_by: 'agent',
        actor: 'codex',
        realHostPath: true,
        modelSelfDescription: {
          supervision: capabilities?.supervision ?? null,
          supervisedActionCount: supervisedActions.length,
          unsupervisedActionCount: (capabilities?.unsupervisedActions ?? []).length,
          riskyActionsSupervised: supervisedNames.filter((name) =>
            ['click', 'type', 'evaluate', 'navigate', 'uploadFiles'].includes(name),
          ),
        },
        privateNetwork: {
          guardReason: GUARD_REASON,
          deniedUrls: denials.length,
          allDeniedByGuardReason: denials.every((entry) => entry.message.includes(GUARD_REASON)),
          denials,
        },
        publicNavigationNotGuardBlocked: !publicMessage.includes(GUARD_REASON),
        publicAttemptOk: publicAttempt.ok,
        shutdownReaperRegistered: willQuitListeners > 0,
        nonClaims: {
          humanEvidence: false,
          publicRelease: false,
          ga: false,
          liveReady: false,
          productApproved: false,
          productDefaultChanged: false,
        },
      };
      await writeFile(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      expect(evidence.privateNetwork.allDeniedByGuardReason).toBe(true);
      expect(evidence.modelSelfDescription.supervision).toBe('required');
    } finally {
      await safeClose(app);
    }
  });
});