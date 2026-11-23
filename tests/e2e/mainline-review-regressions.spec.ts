import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

test('exports ledger HTML as literal text through the real Host service', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  const attack = '<img src="data:," onerror="window.reviewInjected=true">';
  try {
    const page = await getStableWindow(app);
    const exportedPath = await page.evaluate(async (title) => {
      const workspaceId = 'review-export-regression';
      const invoke = async (action: string, payload: unknown) => {
        const result = await window.verseClaw!.hostInvoke<{ path?: string }>({ id: crypto.randomUUID(), module: 'taskLedger', action, payload });
        if (!result.ok) throw Error(result.error.message);
        return result.data;
      };
      const createdAt = new Date().toISOString();
      await invoke('appendEvents', { workspaceId, events: [
        { type: 'node_created', actor: 'assistant', payload: { node: { id: 'unsafe-node', title, description: title, kind: 'task', status: 'review', createdAt, updatedAt: createdAt } } },
        { type: 'node_created', actor: 'assistant', payload: { node: { id: title, title, kind: 'task', status: 'todo', createdAt, updatedAt: createdAt } } },
        { type: 'review_requested', actor: 'assistant', payload: { nodeId: 'unsafe-node', reviewReason: title } },
        { type: 'dependency_added', actor: 'assistant', payload: { edge: { id: title, from: 'unsafe-node', to: title, type: 'depends_on', createdAt } } },
      ] });
      return (await invoke('exportHtml', { workspaceId, includeHistory: true })).path!;
    }, attack);
    const report = await app.evaluate(async ({ BrowserWindow }, path) => {
      const view = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
      try {
        await view.loadFile(path);
        return await view.webContents.executeJavaScript(`({
          injected: window.reviewInjected === true,
          markup: document.querySelectorAll('img,svg').length,
          views: ['tree','dag','history','review'].map(id => document.getElementById(id).textContent)
        })`);
      } finally { view.destroy(); }
    }, exportedPath);
    expect(report.injected).toBe(false);
    expect(report.markup).toBe(0);
    for (const index of [0, 1, 3]) expect(report.views[index]).toContain(attack);
    expect(report.views[2]).toContain(JSON.stringify(attack).slice(1, -1));
  } finally { await closeElectronApp(app); }
});

test('shows separate chronological year labels for daily model usage', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const now = new Date();
    const prior = new Date(now); prior.setFullYear(now.getFullYear() - 1);
    const entries = [prior, now].map((date, index) => ({ timestamp: date.toISOString(), sessionId: `year-${index}`, agentId: 'main',
      model: 'fixture-model', inputTokens: (index + 1) * 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: (index + 1) * 100 }));
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      hostApi: { '["usage","recentTokenHistory",null]': entries },
    });
    const page = await getStableWindow(app);
    await page.evaluate(() => { window.location.hash = '/settings/models'; });
    const models = page.getByTestId('models-page');
    await expect(models).toBeVisible();
    await models.getByRole('button', { name: 'All', exact: true }).click();
    await models.getByRole('button', { name: 'By time', exact: true }).click();
    const labels = await page.evaluate((timestamps) => timestamps.map(timestamp => new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(timestamp))), entries.map(entry => entry.timestamp));
    for (const label of labels) await expect(models.getByText(label, { exact: true })).toBeVisible();
    const visibleLabels = await models.locator('span').allTextContents();
    expect(visibleLabels.indexOf(labels[0])).toBeLessThan(visibleLabels.indexOf(labels[1]));
    await expect(models.getByTestId('token-usage-entry')).toHaveCount(2);
  } finally { await closeElectronApp(app); }
});
