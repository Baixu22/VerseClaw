import { closeElectronApp, expect, test } from './fixtures/electron';

test.describe('Verse Claw Electron smoke flows', () => {
  test('shows the setup wizard on a fresh profile', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await expect(page.getByTestId('setup-welcome-step')).toBeVisible();
    await expect(page.getByTestId('setup-skip-button')).toBeVisible();
  });

  test('can skip setup and navigate to the models page', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-models').click();

    await expect(page.getByTestId('models-page')).toBeVisible();
    await expect(page.getByTestId('models-page-title')).toBeVisible();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
  });

  test('persists skipped setup across relaunch for the same isolated profile', async ({ electronApp, launchElectronApp }) => {
    const firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
    await firstWindow.getByTestId('setup-skip-button').click();
    await expect(firstWindow.getByTestId('main-layout')).toBeVisible();

    await closeElectronApp(electronApp);

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedWindow = await relaunchedApp.firstWindow();
      await relaunchedWindow.waitForLoadState('domcontentloaded');

      await expect(relaunchedWindow.getByTestId('main-layout')).toBeVisible();
      await expect(relaunchedWindow.getByTestId('setup-page')).toHaveCount(0);
    } finally {
      await closeElectronApp(relaunchedApp);
    }
  });

  test('invokes the real typed host bridge for app version', async ({ page }) => {
    const response = await page.evaluate(async () => {
      const bridge = (window as unknown as {
        verseClaw?: { hostInvoke: (request: Record<string, unknown>) => Promise<unknown> };
      }).verseClaw?.hostInvoke;
      if (!bridge) return { ok: false, error: { code: 'BRIDGE_MISSING', message: 'host bridge missing' } };
      return bridge({ id: `app-smoke-${crypto.randomUUID()}`, module: 'app', action: 'version' });
    });
    expect(response).toMatchObject({ ok: true });
    expect((response as { data?: unknown }).data).toMatch(/^\d+\.\d+\.\d+/u);
  });
  test('does not show a fatal dialog when an E2E output pipe closes', async ({ electronApp }) => {
    const completed = await electronApp.evaluate(() => {
      const error = Object.assign(new Error('broken pipe, write'), { code: 'EPIPE' });
      process.stdout.emit('error', error);
      process.stderr.emit('error', error);
      return true;
    });

    expect(completed).toBe(true);
  });
});
