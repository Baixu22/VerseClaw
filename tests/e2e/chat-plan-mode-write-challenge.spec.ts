import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, test } from './fixtures/electron';

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
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: Record<string, unknown>) => Promise<unknown>>;
    })._invokeHandlers;
    const handler = handlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');

    return await handler({}, {
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
});
