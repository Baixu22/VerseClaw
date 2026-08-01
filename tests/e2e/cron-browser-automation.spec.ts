import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Cron browser automation', () => {
  test('creates a browser automation scheduled task from the cron dialog', async ({ electronApp, page }) => {
    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {},
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
          },
        },
        [stableStringify(['/api/cron/jobs', 'GET'])]: {
          ok: true,
          data: { status: 200, ok: true, json: [] },
        },
        [stableStringify(['/api/channels/accounts', 'GET'])]: {
          ok: true,
          data: { status: 200, ok: true, json: { success: true, channels: [] } },
        },
        [stableStringify(['agentBrowser', 'profiles', null])]: {
          success: true,
          profiles: [{ profile: 'default', label: 'Default', authStateName: 'default', source: 'metadata' }],
        },
        [stableStringify(['agentBrowser', 'validate', null])]: {
          success: true,
          ok: true,
          url: 'https://example.com/check-in',
          title: 'Example check-in',
          textSample: 'Already signed in',
        },
        [stableStringify(['cron', 'create', null])]: {
          id: 'browser-cron-1',
          name: 'Daily web check-in',
          message: 'Check in if needed and report the result.',
          taskKind: 'browserAutomation',
          browserAutomation: {
            url: 'https://example.com/check-in',
            objective: 'Check in if needed and report the result.',
            successCondition: 'Page shows already signed in.',
            failureCondition: 'Login is required.',
            template: 'checkIn',
            profile: 'work',
            authPersistence: 'session-name',
            mode: 'headless',
            sensitiveActionPolicy: 'draft-only',
            retryOnTransientFailure: true,
          },
          toolsAllow: ['agent_browser'],
          schedule: { kind: 'cron', expr: '0 9 * * *' },
          delivery: { mode: 'none' },
          enabled: true,
          createdAt: '2026-06-24T01:00:00.000Z',
          updatedAt: '2026-06-24T01:00:00.000Z',
          agentId: 'main',
        },
        [stableStringify(['cron', 'sessionHistory', null])]: {
          messages: [
            {
              id: 'run-1',
              role: 'assistant',
              content: 'Check-in completed successfully.',
              timestamp: 1782253200000,
            },
          ],
          browserAutomationRuns: [
            {
              schemaVersion: 1,
              runId: 'browser-run-1',
              status: 'success',
              startedAt: '2026-06-24T01:00:00.000Z',
              endedAt: '2026-06-24T01:00:01.000Z',
              profile: 'work',
              finalUrl: 'https://example.com/check-in',
              title: 'Example check-in',
              loginState: 'authenticated',
              steps: [{ id: 'open', label: 'Open page', status: 'passed' }],
              evidence: {
                textSample: 'Already signed in',
                artifacts: [{ id: 'shot', kind: 'screenshot', label: 'Screenshot', path: 'C:/tmp/shot.png', createdAt: '2026-06-24T01:00:01.000Z' }],
              },
            },
          ],
        },
      },
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-cron').click();
    await page.getByTestId('cron-new-task-button').click();

    const dialog = page.getByTestId('cron-task-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Task Name').fill('Daily web check-in');
    await dialog.getByTestId('cron-task-type-browser').click();
    await dialog.getByTestId('cron-browser-url').fill('https://example.com/check-in');
    await dialog.getByTestId('cron-browser-objective').fill('Check in if needed and report the result.');
    await dialog.getByTestId('cron-browser-success-condition').fill('Page shows already signed in.');
    await dialog.getByTestId('cron-browser-failure-condition').fill('Login is required.');
    await dialog.getByTestId('cron-browser-profile').fill('work');
    await dialog.getByTestId('cron-browser-validate').click();
    await expect(dialog.getByTestId('cron-browser-validation-result')).toContainText('Validation passed');
    await dialog.getByRole('button', { name: 'Create Task' }).click();

    const browserTask = page.getByTestId('cron-job-card-browser-cron-1');
    await expect(browserTask).toBeVisible();
    await expect(browserTask.locator('[data-cron-icon="browser-task"]')).toBeVisible();
    await browserTask.click();

    const detailPanel = page.getByTestId('cron-detail-panel');
    await expect(detailPanel).toBeVisible();
    await expect(page.getByTestId('cron-detail-browser-url')).toContainText('https://example.com/check-in');
    await expect(page.getByTestId('cron-detail-browser-profile')).toContainText('work');
    await expect(page.getByTestId('cron-detail-browser-sensitive-policy')).toContainText('Draft / verify only');
    await expect(page.getByTestId('cron-detail-allowed-tools')).toContainText('agent_browser');
    await detailPanel.getByLabel('Close details').click();

    await browserTask.getByLabel('Run Details').click();
    await expect(page.getByTestId('cron-browser-run-result')).toContainText('Structured result');
    await expect(page.getByTestId('cron-browser-run-result')).toContainText('authenticated');
    await expect(page.getByTestId('cron-browser-run-result')).toContainText('Diagnostic evidence');
    await expect(page.getByTestId('cron-browser-run-result')).toContainText('Screenshot');
    await expect(page.getByText('Check-in completed successfully.')).toBeVisible();

    const hostCalls = await electronApp.evaluate(() => (
      globalThis as unknown as {
        __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }>;
      }
    ).__verseClawE2eHostCalls ?? []);
    const createCall = hostCalls.find((call) => call.module === 'cron' && call.action === 'create');
    const validateCall = hostCalls.find((call) => call.module === 'agentBrowser' && call.action === 'validate');
    const historyCall = hostCalls.find((call) => call.module === 'cron' && call.action === 'sessionHistory');
    expect(validateCall?.payload).toMatchObject({
      url: 'https://example.com/check-in',
      profile: 'work',
      authPersistence: 'session-name',
      connectionMode: 'managed',
      expectedDomains: ['example.com'],
    });
    expect(historyCall?.payload).toMatchObject({
      sessionKey: 'agent:main:cron:browser-cron-1',
      limit: 20,
    });
    expect(createCall?.payload).toMatchObject({
      name: 'Daily web check-in',
      message: 'Check in if needed and report the result.',
      taskKind: 'browserAutomation',
      toolsAllow: ['agent_browser'],
      browserAutomation: {
        url: 'https://example.com/check-in',
        objective: 'Check in if needed and report the result.',
        successCondition: 'Page shows already signed in.',
        failureCondition: 'Login is required.',
        template: 'checkIn',
        profile: 'work',
        authPersistence: 'session-name',
        mode: 'headless',
        sensitiveActionPolicy: 'draft-only',
        retryOnTransientFailure: true,
      },
      delivery: { mode: 'none' },
    });
  });
});
