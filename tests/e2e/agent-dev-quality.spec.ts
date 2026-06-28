import { test, expect, openAgentDevScenario } from './fixtures/electron';
import { scanBasicAccessibility } from './fixtures/a11y';
import { writeFile } from 'node:fs/promises';

test.describe('agent dev quality gates', () => {
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
});
