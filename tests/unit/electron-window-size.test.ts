// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { ElectronApplication } from '@playwright/test';
import { pinWindowContentSize } from '../e2e/fixtures/electron';

it('waits for the visible window and its renderer to settle at the clamped content size', async () => {
  let width = 1280, height = 800, nativeReads = 0, viewportReads = 0;
  const hiddenResize = vi.fn();
  const hidden = {
    isDestroyed: () => false, isVisible: () => false, isMinimized: () => false,
    isFullScreen: () => false, isMaximized: () => false,
    setContentSize: hiddenResize, getContentSize: () => [0, 0],
    webContents: { isDestroyed: () => false, getURL: () => 'about:blank' },
  };
  const window = {
    isDestroyed: () => false, isVisible: () => true, isMinimized: () => false,
    isFullScreen: () => false, isMaximized: () => false,
    getMinimumSize: () => [960, 600],
    getBounds: () => ({ width: 1280, height: 800 }), getContentBounds: () => ({ width: 1280, height: 800 }),
    setContentSize: (requestedWidth: number, requestedHeight: number) => {
      width = Math.max(960, requestedWidth); height = Math.max(600, requestedHeight);
    },
    getContentSize: () => ++nativeReads < 3 ? [0, 0] : [width, height],
    webContents: {
      isDestroyed: () => false, getZoomFactor: () => 1, getURL: () => 'file:///app/index.html',
      executeJavaScript: async () => ++viewportReads < 2 ? { width: 1280, height: 800 } : { width, height },
    },
  };
  const app = { evaluate: async (fn: (electron: unknown, target: unknown) => unknown, target: unknown) =>
    fn({ BrowserWindow: { getAllWindows: () => [hidden, window] } }, target) } as unknown as ElectronApplication;
  await expect(pinWindowContentSize(app, { width: 680, height: 760 })).resolves.toEqual({ width: 960, height: 760 });
  expect(hiddenResize).not.toHaveBeenCalled();
  expect(viewportReads).toBeGreaterThanOrEqual(2);
});
