import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const untrustedHooks = {
  success: true,
  hooks: [{
    hookKey: 'demo',
    name: 'Demo Hook',
    source: 'openclaw-workspace',
    managed: false,
    trustState: 'untrusted',
    hash: 'a'.repeat(64),
    expectedHash: null,
    enabled: true,
    loadable: false,
    reason: 'workspace hook has not been trusted',
    filePath: 'hooks/demo/handler.ts',
  }, {
    hookKey: 'bundled',
    name: 'Bundled Hook',
    source: 'openclaw-bundled',
    managed: true,
    trustState: 'trusted',
    hash: 'b'.repeat(64),
    expectedHash: null,
    enabled: true,
    loadable: true,
    reason: 'owner trust policy satisfied',
    filePath: 'hooks/bundled/handler.js',
  }],
};

const trustedHooks = {
  ...untrustedHooks,
  hooks: untrustedHooks.hooks.map((hook) => hook.hookKey === 'demo'
    ? { ...hook, trustState: 'trusted', expectedHash: hook.hash, loadable: true, reason: 'owner trust policy satisfied' }
    : hook),
};

test.describe('Settings hooks trust center', () => {
  test.skip(process.platform !== 'win32', 'Settings hooks UI is validated on Windows.');

  test('lists hook source, hash, managed state and records a trust action', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, theme: 'light' });
    try {
      await installIpcMocks(app, {
        hostApi: {
          '["hooks","list",null]': untrustedHooks,
          '["hooks","setTrusted",{"hookKey":"demo","trusted":true}]': { ...trustedHooks, hookKey: 'demo', trustState: 'trusted' },
        },
      });
      const page = await getStableWindow(app);
      const url = new URL(page.url());
      url.hash = '#/settings/developer';
      await page.goto(url.toString());
      const devSwitch = page.getByTestId('settings-dev-mode-switch');
      await expect(devSwitch).toBeVisible();
      if ((await devSwitch.getAttribute('data-state')) !== 'checked') await devSwitch.click();
      await page.getByTestId('settings-nav-system').click();

      const demo = page.getByTestId('settings-hook-demo');
      await expect(demo).toContainText('openclaw-workspace');
      await expect(demo).toContainText('untrusted');
      await expect(demo).toContainText('sha256: aaaaaaaaaa');
      await expect(page.getByTestId('settings-hook-trust-demo')).toContainText('Trust');
      await page.getByTestId('settings-hook-trust-demo').click();
      await expect(demo).toContainText('trusted');

      const managed = page.getByTestId('settings-hook-bundled');
      await expect(managed).toContainText('managed');
      await expect(managed.getByTestId('settings-hook-enable-bundled')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
