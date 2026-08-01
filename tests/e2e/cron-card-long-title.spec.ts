import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const cronJobs = [
  {
    id: 'job-long-title',
    name: 'Memory Dreaming Promotion With An Unusually Long Title That Should Trigger Truncation',
    message: '__openclaw_memory_core_short_term_promotion_pipeline__step_overflow_check__',
    schedule: { kind: 'cron', expr: '0 3 * * *' },
    source: 'gateway',
    runtime: {
      source: 'gateway',
      sessionTarget: 'isolated',
      wakeMode: 'next-heartbeat',
      payloadKind: 'agentTurn',
    },
    delivery: {
      mode: 'announce',
      channel: 'feishu',
      accountId: 'main-feishu-account-with-a-long-readable-name',
      to: 'chat:oc_extremely_long_delivery_target_that_should_never_push_metadata_outside_the_card',
    },
    enabled: true,
    createdAt: '2026-04-30T03:00:00.000Z',
    updatedAt: '2026-04-30T03:00:00.000Z',
    lastRun: {
      time: '2026-04-30T03:10:00.000Z',
      success: true,
      duration: 1200,
    },
    nextRun: '2026-05-01T03:00:00.000Z',
    agentId: 'main',
  },
  {
    id: 'job-short-title',
    name: '喝水',
    message: '提醒我喝水',
    schedule: { kind: 'cron', expr: '*/5 * * * *' },
    enabled: false,
    createdAt: '2026-04-30T03:00:00.000Z',
    updatedAt: '2026-04-30T03:00:00.000Z',
    agentId: 'main',
  },
];

test.describe('Scheduled task workbench', () => {
  test('keeps long task rows contained and supports detail, status, and search views', async ({ electronApp, page }) => {
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
          data: {
            status: 200,
            ok: true,
            json: cronJobs,
          },
        },
        [stableStringify(['/api/channels/accounts', 'GET'])]: {
          ok: true,
          data: {
            status: 200,
            ok: true,
            json: { success: true, channels: [] },
          },
        },
      },
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-cron').click();

    const card = page.getByTestId('cron-job-card-job-long-title');
    const switchWrapper = page.getByTestId('cron-job-card-switch-job-long-title');
    const title = page.getByTestId('cron-job-card-title-job-long-title');

    await expect(page.getByTestId('cron-assurance-panel')).toBeVisible();
    await expect(page.getByTestId('cron-search-input')).toBeVisible();
    await expect(card).toBeVisible();
    await expect(card.locator('[data-cron-icon="agent-task"]')).toBeVisible();
    await expect(switchWrapper).toBeVisible();
    await expect(title).toBeVisible();

    const cardBox = await card.boundingBox();
    const switchBox = await switchWrapper.boundingBox();
    const titleBox = await title.boundingBox();

    expect(cardBox, 'task row bounding box should be available').not.toBeNull();
    expect(switchBox, 'switch bounding box should be available').not.toBeNull();
    expect(titleBox, 'title bounding box should be available').not.toBeNull();

    if (!cardBox || !switchBox || !titleBox) return;

    // The switch must stay fully inside the card horizontally and not be
    // partially clipped by the card boundary (this is the regression we are
    // guarding against — long titles previously pushed the switch off-card).
    const cardRight = cardBox.x + cardBox.width;
    const switchRight = switchBox.x + switchBox.width;
    expect(switchBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(switchRight).toBeLessThanOrEqual(cardRight + 0.5);

    // The title must shrink before the switch — its right edge should not
    // overlap the switch container.
    const titleRight = titleBox.x + titleBox.width;
    expect(titleRight).toBeLessThanOrEqual(switchBox.x + 0.5);

    await card.click();
    const detailPanel = page.getByTestId('cron-detail-panel');
    await expect(detailPanel).toBeVisible();
    await expect(detailPanel.getByText(cronJobs[0].name, { exact: true })).toBeVisible();
    await expect(detailPanel.locator('[data-cron-icon="pause"]')).toBeVisible();
    await expect(detailPanel.locator('[data-cron-icon="close"]')).toBeVisible();
    await expect(detailPanel.locator('[data-cron-icon="edit"]')).toBeVisible();
    await expect(page.getByTestId('cron-detail-delivery-channel')).toContainText('Feishu / Lark');
    await expect(page.getByTestId('cron-detail-delivery-target')).toContainText(
      'chat:oc_extremely_long_delivery_target_that_should_never_push_metadata_outside_the_card',
    );

    await page.getByTestId('cron-filter-off').click();
    await expect(page.getByTestId('cron-job-card-job-long-title')).toBeHidden();
    await expect(page.getByTestId('cron-job-card-job-short-title')).toBeVisible();

    await page.getByTestId('cron-filter-all').click();
    await page.getByTestId('cron-search-input').fill('喝水');
    await expect(page.getByTestId('cron-job-card-job-long-title')).toBeHidden();
    await expect(page.getByTestId('cron-job-card-job-short-title')).toBeVisible();
  });
});
