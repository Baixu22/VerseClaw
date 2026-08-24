import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string };
};

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const { BrowserWindow, ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: Record<string, unknown>) => Promise<unknown>>;
    })._invokeHandlers;
    const handler = handlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('main BrowserWindow is not available');

    return await handler({
      sender: window.webContents,
      senderFrame: { url: window.webContents.getURL() },
    }, {
      id: `p0-12-${Date.now()}`,
      module: request.module,
      action: request.action,
      payload: request.payload,
    });
  }, { module, action, payload }) as HostResponse<T>;

  if (!response.ok) {
    throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
  }
  return response.data as T;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test.describe('Plan mode real write challenge', () => {
  test('blocks terminal, file write, and mutating Gateway RPC without side effects', async ({ launchElectronApp }) => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-plan-mode-challenge-'));
    const protectedFile = join(workspaceDir, 'protected.txt');
    const terminalSentinel = join(workspaceDir, 'p0-12-terminal.txt');
    await writeFile(protectedFile, 'original', 'utf8');
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await getStableWindow(app);
      await hostInvoke(app, 'workspaces', 'create', {
        name: 'Plan Mode Challenge',
        rootPath: workspaceDir,
        permissionMode: 'plan',
      });

      const terminalResult = await hostInvoke<{
        success: boolean;
        blocked?: boolean;
        approvalRequired?: boolean;
        reason?: string;
        stdout?: string;
        stderr?: string;
      }>(app, 'terminal', 'run', {
        command: 'node -e "require(\\"fs\\").writeFileSync(\\"p0-12-terminal.txt\\", \\"bad\\")"',
      });
      expect(terminalResult).toMatchObject({ success: false, blocked: true });
      expect(terminalResult.approvalRequired).not.toBe(true);
      expect(`${terminalResult.reason ?? ''} ${terminalResult.stderr ?? ''}`).toMatch(/计划模式|Plan/i);
      await expect(pathExists(terminalSentinel)).resolves.toBe(false);

      const fileResult = await hostInvoke<{
        ok: boolean;
        error?: string;
        approvalRequired?: boolean;
      }>(app, 'files', 'writeText', {
        path: protectedFile,
        content: 'mutated',
      });
      expect(fileResult).toMatchObject({ ok: false, error: 'permissionDenied' });
      expect(fileResult.approvalRequired).not.toBe(true);
      await expect(readFile(protectedFile, 'utf8')).resolves.toBe('original');

      const gatewayResult = await hostInvoke<{
        success: boolean;
        blocked?: boolean;
        approvalRequired?: boolean;
        error?: string;
      }>(app, 'gateway', 'rpc', {
        method: 'tools.exec',
        params: { command: 'git clean -fd' },
      });
      expect(gatewayResult).toMatchObject({ success: false, blocked: true });
      expect(gatewayResult.approvalRequired).not.toBe(true);
      expect(gatewayResult.error ?? '').toMatch(/计划模式|Plan/i);
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  test('read-only mode blocks git --output without touching the target file', async ({ launchElectronApp }) => {
    // `git diff --output=<path>` creates and truncates <path>, and the path is
    // unconstrained, so a whitelisted read subcommand can overwrite a file
    // outside the workspace. readOnly mode allows 'read' with no further
    // checks, so only the classification stops it.
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-readonly-output-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'clawx-readonly-outside-'));
    const victim = join(outsideDir, 'victim.txt');
    await writeFile(victim, 'original', 'utf8');
    const createdInside = join(workspaceDir, 'leaked.patch');
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await getStableWindow(app);
      await hostInvoke(app, 'workspaces', 'create', {
        name: 'Read Only Output Challenge',
        rootPath: workspaceDir,
        permissionMode: 'readOnly',
      });

      const overwrite = await hostInvoke<{ success: boolean; blocked?: boolean }>(
        app,
        'terminal',
        'run',
        { command: `git diff --output=${victim}` },
      );
      expect(overwrite).toMatchObject({ success: false, blocked: true });
      await expect(readFile(victim, 'utf8')).resolves.toBe('original');

      // The space-separated form is the same vector.
      const spaced = await hostInvoke<{ success: boolean; blocked?: boolean }>(
        app,
        'terminal',
        'run',
        { command: `git diff --output ${victim}` },
      );
      expect(spaced).toMatchObject({ success: false, blocked: true });
      await expect(readFile(victim, 'utf8')).resolves.toBe('original');

      const inside = await hostInvoke<{ success: boolean; blocked?: boolean }>(
        app,
        'terminal',
        'run',
        { command: `git log --output=${createdInside}` },
      );
      expect(inside).toMatchObject({ success: false, blocked: true });
      await expect(pathExists(createdInside)).resolves.toBe(false);

      // Inspection must stay allowed.
      const plainStatus = await hostInvoke<{ success: boolean; blocked?: boolean }>(
        app,
        'terminal',
        'run',
        { command: 'git status' },
      );
      expect(plainStatus.blocked).not.toBe(true);
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});
