import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const baseStatus = {
  success: true,
  requestedProviderId: 'policy-light',
  effectiveProviderId: 'policy-light',
  runtimeLevel: 'policy',
  degraded: false,
  execPolicy: { host: 'gateway', security: 'allowlist', ask: 'on-miss' },
  networkPolicy: 'disabled',
  workspaceAccess: 'none',
  warnings: ['Policy-light mode relies on permissions and approvals.'],
  providers: [
    { id: 'policy-light', label: 'Policy-light', available: true, runtimeLevel: 'policy', capabilities: [] },
    { id: 'docker-strong', label: 'Docker', available: false, runtimeLevel: 'unavailable', capabilities: [] },
  ],
  permissionMode: 'readOnly',
  summary: 'Policy-light / readOnly / policy / network=disabled',
  updatedAt: Date.now(),
  docker: { cli: false, daemon: false, image: false },
  openClawConfig: {
    agents: { defaults: { sandbox: { mode: 'off', backend: 'openshell', scope: 'session', workspaceAccess: 'none' } } },
    tools: { exec: { host: 'gateway', security: 'allowlist', ask: 'on-miss' }, sandbox: { tools: { alsoAllow: [] } } },
  },
  executionEnvironment: {
    backend: 'host', guarantee: 'policy', network: 'disabled', writableRoots: [], status: 'available', reason: null,
  },
};

test.describe('Settings execution environment', () => {
  test.skip(process.platform !== 'win32', 'Settings sandbox UI is validated on Windows.');

  test('shows policy-light backend, guarantee, network and approval', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, theme: 'light' });
    try {
      await installIpcMocks(app, {
        hostApi: {
          '["sandbox","status",null]': baseStatus,
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
      await expect(page.getByTestId('settings-sandbox-field-backend')).toContainText('host');
      await expect(page.getByTestId('settings-sandbox-field-guarantee')).toContainText('policy');
      await expect(page.getByTestId('settings-sandbox-field-networkPolicy')).toContainText('disabled');
      await expect(page.getByTestId('settings-sandbox-field-approval')).toContainText('gateway');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows an unavailable strong environment with a readable reason', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, theme: 'light' });
    try {
      await installIpcMocks(app, {
        hostApi: {
          '["sandbox","status",null]': {
            ...baseStatus,
            requestedProviderId: 'docker-strong',
            effectiveProviderId: 'policy-light',
            degraded: true,
            degradeReason: 'Docker strong sandbox is unavailable; using policy-light controls.',
            warnings: ['Docker strong sandbox is unavailable; using policy-light controls.'],
            executionEnvironment: {
              backend: 'host', guarantee: 'policy', network: 'disabled', writableRoots: [], status: 'degraded',
              reason: 'Docker strong sandbox is unavailable; using policy-light controls.',
            },
          },
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
      await expect(page.getByTestId('settings-sandbox-field-guarantee')).toContainText('policy');
      await expect(page.getByTestId('settings-sandbox-degrade-reason')).toContainText('Docker strong sandbox is unavailable');
    } finally {
      await closeElectronApp(app);
    }
  });
});
