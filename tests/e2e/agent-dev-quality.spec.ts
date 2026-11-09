import { test, expect, installIpcMocks, openAgentDevScenario } from './fixtures/electron';
import { scanBasicAccessibility } from './fixtures/a11y';
import { writeFile } from 'node:fs/promises';

test.describe('agent dev quality gates', () => {
  test.describe.configure({ mode: 'parallel' });

  test('produces an accessibility report for a seeded scenario', async ({ page }, testInfo) => {
    await openAgentDevScenario(page, 'chat-empty', { visualMode: true });
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const report = await scanBasicAccessibility(page);
    const reportPath = testInfo.outputPath('agent-dev-a11y-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    await testInfo.attach('agent-dev-a11y-report', {
      path: reportPath,
      contentType: 'application/json',
    });

    const maxIssues = Number(process.env.CLAWX_A11Y_MAX_ISSUES ?? Number.POSITIVE_INFINITY);
    expect(report.issueCount).toBeLessThanOrEqual(maxIssues);
  });

  test('renders assistant-ui welcome suggestions with aligned card styling', async ({ electronApp, page }, testInfo) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: {
        state: 'running',
        port: 18789,
        pid: 12345,
        connectedAt: Date.now(),
        gatewayReady: true,
      },
      gatewayRpc: {
        '["sessions.list",null]': { sessions: [] },
        '["chat.history",null]': { messages: [] },
      },
    });
    await openAgentDevScenario(page, 'chat-empty', { visualMode: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const suggestions = page.getByTestId('chat-welcome-suggestions');
    await expect(suggestions).toBeVisible();
    await expect(suggestions.locator('button')).toHaveCount(3);
    await expect(suggestions.locator('button').first()).toContainText('Handle Tasks');
    await expect(suggestions.locator('button').first()).toContainText('Work on task-oriented requests');
    const chipIcons = suggestions.locator('svg.codex-welcome-chip__icon');
    await expect(chipIcons).toHaveCount(3);
    const uniqueIcons = await chipIcons.evaluateAll((icons) => new Set(icons.map((icon) => icon.outerHTML)).size);
    expect(uniqueIcons).toBe(3);

    const screenshotPath = testInfo.outputPath('chat-welcome-suggestions.png');
    await suggestions.screenshot({ path: screenshotPath, animations: 'disabled' });
    await testInfo.attach('chat-welcome-suggestions', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });

  test('captures a stable visual artifact for a seeded scenario', async ({ page }, testInfo) => {
    await openAgentDevScenario(page, 'doctor-failed', { visualMode: true, flags: ['visual'] });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId('main-layout')).toBeVisible();

    const screenshot = await page.screenshot({ fullPage: true, animations: 'disabled' });
    const screenshotPath = testInfo.outputPath('agent-dev-visual-doctor-failed.png');
    await writeFile(screenshotPath, screenshot);
    await testInfo.attach('agent-dev-visual-doctor-failed', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });

  test('loads the in-app Agent Dev Workbench through host-api and records a scenario', async ({ page }) => {
    const settingsUrl = new URL(page.url());
    settingsUrl.searchParams.delete('devScenario');
    settingsUrl.searchParams.set('e2eSkipSetup', '1');
    settingsUrl.searchParams.set('visual', '1');
    settingsUrl.hash = '/settings/developer';
    await page.goto(settingsUrl.toString());
    await expect(page.getByTestId('settings-developer-section')).toBeVisible();

    const workbench = page.getByTestId('settings-agent-dev-workbench');
    if (await workbench.count() === 0) {
      await page.getByTestId('settings-dev-mode-switch').click();
    }

    await expect(workbench).toBeVisible();
    await expect(page.getByTestId('settings-agent-dev-workbench-scenarios')).toContainText(/\d+/);
    await expect(page.getByTestId('settings-agent-dev-workbench-contract-gaps')).toContainText('0');
    await expect(page.getByTestId('settings-agent-dev-workbench-diagnostics')).toBeVisible();
    // R5-2: 面板必须展示证据年龄(或 unavailable)与 deep-test 决策,数据来自真实报告字段。
    await expect(page.getByTestId('settings-agent-dev-workbench-evidence-age')).toBeVisible();
    await expect(page.getByTestId('settings-agent-dev-workbench-decision')).toBeVisible();

    await page.getByTestId('settings-agent-dev-workbench-record').click();
    await expect(page.getByTestId('settings-agent-dev-workbench-refresh')).toBeEnabled();
  });
});
