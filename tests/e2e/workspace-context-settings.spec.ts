import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, installIpcMocks, openAgentDevScenario } from './fixtures/electron';

test.describe('Workspace Context user settings', () => {
  test('exposes one default-on profile and keeps low-level flags out of General settings', async ({ electronApp, page, homeDir }) => {
    await writeFile(join(homeDir, '.openclaw', 'openclaw.json'), JSON.stringify({
      runtime: {
        contextBlock: {
          'working-memory': { enabled: true },
          'tool-registry': { enabled: true },
        },
      },
    }, null, 2));
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    });
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(60_000);
    await openAgentDevScenario(page, 'chat-empty', { visualMode: true });
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const settingsUrl = new URL(page.url());
    settingsUrl.searchParams.delete('devScenario');
    settingsUrl.hash = '/settings/general';
    await page.goto(settingsUrl.toString());
    await expect(page.getByTestId('settings-workspace-context')).toBeVisible();

    const workspaceSwitch = page.getByTestId('settings-workspace-context-switch');
    await expect(workspaceSwitch).toHaveAttribute('data-state', 'checked');
    await expect(page.getByTestId('settings-workspace-context-model-summary')).toContainText(
      /Workspace context is (enabled|saved but not yet confirmed)/i,
    );
    await expect(page.getByTestId('settings-dcs-prod-flags')).toHaveCount(0);
    await expect(page.getByTestId('settings-dcs-prod-flag-working-memory')).toHaveCount(0);
    await expect(page.getByTestId('settings-dcs-prod-flag-tool-registry')).toHaveCount(0);

    await workspaceSwitch.click();
    await expect(workspaceSwitch).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByTestId('settings-workspace-context-model-summary')).toContainText(
      /Workspace context is off/i,
    );
  });
});