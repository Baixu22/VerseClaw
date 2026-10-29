import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { writeFile } from 'node:fs/promises';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}

const APPROVAL_ID = 'approval-e2e-1';

const requestedFrame = {
  approvalId: APPROVAL_ID,
  command: 'node --test',
  commandPreview: null,
  cwd: 'C:/workspace',
  host: 'gateway',
  agentId: 'main',
  sessionKey: 'agent:main:main',
  allowedDecisions: ['allow-once', 'deny'],
  createdAtMs: 1,
  expiresAtMs: 2,
};

test.describe('Runtime approval bridge', () => {
  test('covers the composer without a modal and restores its draft after approval', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true });
    const approvalId = 'approval-visual';
    const command = '& "C:\\workspace\\sample project\\.acceptance-venv\\Scripts\\python.exe" -m pytest tests/test_frozen_contract.py -q';
    const cwd = 'D:\\workspace\\.tmp\\acceptance-projects\\project-live-5tBmVp\\demo\\user_api';

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          [stableStringify(['runtimeApprovals', 'list', null])]: { pending: [] },
          [stableStringify(['runtimeApprovals', 'resolve', { approvalId, decision: 'deny' }])]: {
            success: true, approvalId, decision: 'deny',
          },
        },
      });
      const page = await getStableWindow(app);
      const composer = page.getByTestId('chat-composer-input');
      const slot = page.getByTestId('chat-composer-slot');
      await expect(composer).toBeVisible();
      await composer.fill('Preserve this unfinished message.');
      const originalInput = await composer.elementHandle();
      const originalBox = (await page.getByTestId('chat-composer-shell').boundingBox())!;
      await app.evaluate(({ BrowserWindow }, frame) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('runtime-approvals:requested', frame);
        }
      }, { ...requestedFrame, approvalId, command, cwd, allowedDecisions: ['allow-once', 'allow-always', 'deny'] });

      const prompt = page.getByTestId('runtime-approval-prompt');
      const title = prompt.getByRole('heading', { name: 'Runtime approval required' });
      const commandView = page.getByTestId('runtime-approval-command');
      await expect(prompt).toBeVisible();
      await expect(composer).toBeHidden();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.verse-claw-dialog-overlay')).toHaveCount(0);
      await expect(slot.getByTestId('runtime-approval-prompt')).toBeVisible();
      const approvalBox = (await prompt.boundingBox())!;
      expect(Math.abs(approvalBox.x - originalBox.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(approvalBox.width - originalBox.width)).toBeLessThanOrEqual(1);
      await expect(title).toBeFocused();
      await expect(title).toHaveCSS('font-size', '14px');
      await expect(title).toHaveCSS('font-weight', '600');
      expect(await commandView.textContent()).toBe(command);
      await expect(commandView).toHaveCSS('white-space', 'pre');
      await page.keyboard.press('Escape');
      await page.getByTestId('chat-page').click({ position: { x: 20, y: 20 } });
      await expect(prompt).toBeVisible();

      await prompt.getByRole('button', { name: 'Copy command', exact: true }).click();
      await expect.poll(() => app.evaluate(async ({ clipboard }) => (await clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(command);
      const calls = await app.evaluate(() => (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module: string; action: string }> }).__verseClawE2eHostCalls ?? []);
      expect(calls.filter(call => call.module === 'runtimeApprovals' && call.action === 'resolve')).toEqual([]);
      await title.focus();

      for (const layout of [
        { name: 'light', width: 1280, height: 800, dark: false, zoom: 1 },
        { name: 'dark', width: 1280, height: 800, dark: true, zoom: 1 },
        { name: 'narrow', width: 640, height: 700, dark: false, zoom: 1 },
        { name: 'zoom150', width: 960, height: 800, dark: false, zoom: 1.5 },
      ]) {
        if (layout.zoom === 1) {
          await page.setViewportSize({ width: layout.width, height: layout.height });
        } else {
          // Native zoom uses the real content size, not a CSS viewport override.
          const session = await page.context().newCDPSession(page);
          await session.send('Emulation.clearDeviceMetricsOverride');
          await session.detach();
          await app.evaluate(({ BrowserWindow }, size) => {
            const window = BrowserWindow.getAllWindows()[0];
            window.setContentSize(size.width, size.height);
            window.webContents.setZoomFactor(size.zoom);
          }, layout);
          await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(layout.width / layout.zoom + 1);
        }
        await page.evaluate(dark => {
          document.documentElement.classList.toggle('dark', dark);
          document.documentElement.classList.toggle('light', !dark);
        }, layout.dark);
        await title.focus();
        await expect.poll(async () => {
          const box = await prompt.boundingBox();
          const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
          if (!box) return false;
          return box.x >= 12
            && box.y >= 12
            && box.x + box.width <= viewport.width - 12
            && box.y + box.height <= viewport.height - 12;
        }, { timeout: 5_000 }).toBe(true);
        const promptBox = (await prompt.boundingBox())!;
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        expect(await prompt.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        for (const testId of ['runtime-approval-command', 'runtime-approval-deny', 'runtime-approval-allow-always', 'runtime-approval-allow-once']) {
          const box = (await page.getByTestId(testId).boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(promptBox.x + 14);
          expect(box.x + box.width).toBeLessThanOrEqual(promptBox.x + promptBox.width - 14);
          expect(box.y + box.height).toBeLessThanOrEqual(promptBox.y + promptBox.height - 10);
        }
        expect(await commandView.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
        if (layout.zoom === 1) {
          await prompt.screenshot({ path: testInfo.outputPath(`runtime-approval-${layout.name}.png`) });
          await page.screenshot({ path: testInfo.outputPath(`runtime-approval-page-${layout.name}.png`) });
        } else {
          const nativeCapture = await app.evaluate(async ({ BrowserWindow }) => {
            const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
            return image.toPNG().toString('base64');
          });
          await writeFile(testInfo.outputPath(`runtime-approval-${layout.name}.png`), Buffer.from(nativeCapture, 'base64'));
        }
      }

      await page.getByTestId('runtime-approval-deny').click();
      await expect(prompt).toHaveCount(0);
      await expect(composer).toBeVisible();
      await expect(composer).toHaveValue('Preserve this unfinished message.');
      expect(await originalInput!.evaluate(element => element.isConnected)).toBe(true);
      await expect(page.locator('.verse-claw-dialog-overlay')).toHaveCount(0);
      const decisions = await app.evaluate(() => (globalThis as unknown as { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls ?? []);
      expect(decisions).toContainEqual({ module: 'runtimeApprovals', action: 'resolve', payload: { approvalId, decision: 'deny' } });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('answers a pending runtime approval from the conversation input area', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          [stableStringify(['runtimeApprovals', 'list', null])]: { pending: [] },
          [stableStringify(['runtimeApprovals', 'resolve', {
            approvalId: APPROVAL_ID,
            decision: 'allow-once',
          }])]: { success: true, approvalId: APPROVAL_ID, decision: 'allow-once' },
        },
      });

      const page = await getStableWindow(app);

      // The prompt only exists once the renderer has mounted and subscribed.
      await expect(page.getByTestId('chat-composer-input')).toBeVisible();

      // Send the exact frame the production main process forwards when the Gateway
      // broadcasts exec.approval.requested.
      await app.evaluate(({ BrowserWindow }, frame) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('runtime-approvals:requested', frame);
        }
      }, requestedFrame);

      const prompt = page.getByTestId('runtime-approval-prompt');
      await expect(prompt).toBeVisible();
      await expect(prompt).toContainText('node --test');
      await expect(prompt).toContainText('C:/workspace');

      await page.getByTestId('runtime-approval-allow-once').click();

      // The prompt clears only after the host accepted the decision.
      await expect(page.getByTestId('runtime-approval-prompt')).toHaveCount(0);

      const calls = await app.evaluate(
        () => (globalThis as unknown as { __verseClawE2eHostCalls?: unknown[] }).__verseClawE2eHostCalls ?? [],
      );
      expect(calls).toContainEqual({
        module: 'runtimeApprovals',
        action: 'resolve',
        payload: { approvalId: APPROVAL_ID, decision: 'allow-once' },
      });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('offers only the decisions the runtime listed for the request', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          [stableStringify(['runtimeApprovals', 'list', null])]: { pending: [] },
        },
      });

      const page = await getStableWindow(app);

      await expect(page.getByTestId('chat-composer-input')).toBeVisible();

      await app.evaluate(({ BrowserWindow }, frame) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('runtime-approvals:requested', frame);
        }
      }, { ...requestedFrame, approvalId: 'approval-e2e-deny-only', allowedDecisions: ['deny'] });

      await expect(page.getByTestId('runtime-approval-deny')).toBeVisible();
      await expect(page.getByTestId('runtime-approval-allow-once')).toHaveCount(0);
      await expect(page.getByTestId('runtime-approval-allow-always')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
