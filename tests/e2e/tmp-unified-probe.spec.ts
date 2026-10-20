import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

const outDir = 'D:\\tmp\\unified-probe';

test('probe boot shell sketch', async ({ launchElectronApp }) => {
  await mkdir(outDir, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, bootHoldMs: 4_000 });
  try {
    const page = await getStableWindow(app);
    const boot = page.getByTestId('boot-shell');
    await expect(boot).toBeVisible();
    const box = await boot.boundingBox();
    const samples: unknown[] = [];
    for (const wait of [120, 260, 420]) {
      await page.waitForTimeout(wait);
      samples.push(await boot.evaluate((shell) => ({
        shimmer: shell.querySelectorAll('.boot-shimmer').length,
        sketches: shell.querySelectorAll('.boot-sketch').length,
        offsets: Array.from(shell.querySelectorAll('.boot-sketch rect')).map((node) => Number.parseFloat(getComputedStyle(node).strokeDashoffset)),
        animations: Array.from(shell.querySelectorAll('*')).filter((node) => getComputedStyle(node).animationName !== 'none').length,
      })));
      await page.screenshot({ path: join(outDir, `boot-${wait}.png`), clip: box ?? undefined });
    }
    await writeFile(join(outDir, 'boot.json'), JSON.stringify(samples, null, 2));
  } finally {
    await closeElectronApp(app);
  }
});

test('probe chat skeleton sketch', async ({ launchElectronApp }) => {
  await mkdir(outDir, { recursive: true });
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345, connectedAt: Date.now() },
      gatewayRpc: {},
    });
    await app.evaluate(async ({ app: _app }) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      ipcMain.removeHandler('gateway:rpc');
      ipcMain.handle('gateway:rpc', async (_event: unknown, method: string) => {
        if (method === 'sessions.list') return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
        if (method === 'chat.history') {
          await new Promise((resolve) => setTimeout(resolve, 30_000));
          return { success: true, result: { messages: [] } };
        }
        return { success: true, result: {} };
      });
    });
    const page = await getStableWindow(app);
    await pinWindowContentSize(app, { width: 1280, height: 900 });
    await page.reload();
    const skeleton = page.getByTestId('chat-startup-skeleton');
    await expect(skeleton).toBeVisible({ timeout: 10_000 });
    const box = await skeleton.boundingBox();
    const samples: unknown[] = [];
    for (const wait of [120, 300, 520]) {
      await page.waitForTimeout(wait);
      samples.push(await skeleton.evaluate((node) => ({
        sketches: node.querySelectorAll('[data-structural-sketch]').length,
        offsets: Array.from(node.querySelectorAll('[data-structural-sketch] rect')).map((rect) => Number.parseFloat(getComputedStyle(rect).strokeDashoffset)),
        shimmer: node.querySelectorAll('[data-testid="ai-element-shimmer"]').length,
      })));
      await page.screenshot({ path: join(outDir, `chat-${wait}.png`), clip: box ?? undefined });
    }
    await writeFile(join(outDir, 'chat.json'), JSON.stringify(samples, null, 2));
  } finally {
    await closeElectronApp(app);
  }
});
