import { closeElectronApp, expect, getStableWindow, installIpcMocks, getAgentDevHostCalls, test } from './fixtures/electron';

test('renames a webhook task without replacing its delivery configuration', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const job = { id: 'webhook-review', name: 'Webhook task', message: 'Fixture task body', schedule: { kind: 'cron', expr: '0 9 * * *' },
      enabled: true, agentId: 'main', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      delivery: { mode: 'webhook', to: 'https://example.invalid/hook', bestEffort: true } };
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
      hostApi: { '["cron","list",null]': [job], '["cron","update",null]': { success: true },
        '["cron","deliveryTargets",null]': { success: true, targets: [] },
        '["channels","listAccounts",null]': { success: true, channels: [] } },
    });
    const page = await getStableWindow(app);
    await page.evaluate(() => { window.location.hash = '/cron'; });
    await page.getByTestId('cron-job-card-webhook-review').click();
    await page.getByTestId('cron-detail-panel').getByRole('button', { name: 'Edit configuration', exact: true }).click();
    const dialog = page.getByTestId('cron-task-dialog');
    await expect(dialog).toContainText('Webhook delivery');
    await dialog.locator('#name').fill('Renamed webhook task');
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const calls = await getAgentDevHostCalls(page) as Array<{ module: string; action: string; payload?: { input?: Record<string, unknown> } }>;
    const update = calls.findLast(call => call.module === 'cron' && call.action === 'update');
    expect(JSON.stringify(update)).toContain('Renamed webhook task');
    expect(JSON.stringify(update)).not.toContain('delivery');
  } finally { await closeElectronApp(app); }
});

test('MCP JSON registration preserves headers and exposure through the real Host', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await page.evaluate(() => { window.location.hash = '/settings/skills?tab=mcp'; });
    const panel = page.getByTestId('mcp-services-panel');
    await expect(panel).toBeVisible();
    await panel.locator('textarea').first().fill(JSON.stringify({ mcpServers: { 'review-secure': {
      url: 'https://example.invalid/mcp', transport: 'http', headers: { Authorization: 'Bearer TEST_ONLY' },
      exposure: { agents: ['restricted-agent'] }, sslVerify: true, networkPolicy: 'enabled',
    } } }));
    await panel.getByRole('button', { name: 'Register Service', exact: true }).click();
    await expect(panel.getByText('review-secure', { exact: true }).first()).toBeVisible();
    const result = await page.evaluate(async () => {
      const invoke = async (action: string, payload?: unknown) => {
        const response = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: 'mcp', action, payload });
        if (!response.ok) throw Error(response.error.message);
        return response.data as { servers: Array<{ id: string; name: string; headers?: Record<string, string>; exposure?: { agents?: string[] } }> };
      };
      const server = (await invoke('listServers')).servers.find(server => server.name === 'review-secure')!;
      await invoke('updateServer', { id: server.id, name: 'Renamed secure service', headers: server.headers });
      return { server: (await invoke('listServers')).servers.find(row => row.id === server.id), others: await invoke('resolveForContext', { agentId: 'other-agent' }) };
    });
    expect(result.server?.headers).toEqual({ Authorization: '????' });
    expect(result.server?.exposure?.agents).toEqual(['restricted-agent']);
    expect(result.others.servers.some(server => server.id === result.server?.id)).toBe(false);
  } finally { await closeElectronApp(app); }
});

test('an expired runtime approval releases the composer and preserves its draft', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, { gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
      hostApi: { '["runtimeApprovals","list",null]': { pending: [] } } });
    const page = await getStableWindow(app);
    const input = page.getByTestId('chat-composer-input');
    await input.fill('Draft survives approval expiry');
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('runtime-approvals:requested', {
        approvalId: 'expiry-regression', command: 'echo fixture', agentId: 'main', allowedDecisions: ['deny'],
        createdAtMs: Date.now(), expiresAtMs: Date.now() + 1500,
      });
    });
    await expect(page.getByTestId('runtime-approval-prompt')).toBeVisible();
    await expect(input).toBeHidden();
    await expect(page.getByTestId('runtime-approval-prompt')).not.toBeVisible();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Draft survives approval expiry');
  } finally { await closeElectronApp(app); }
});
