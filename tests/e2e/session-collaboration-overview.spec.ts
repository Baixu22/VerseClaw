import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, pinWindowContentSize, publishGatewayStatus, test } from './fixtures/electron';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, instrumentSessionChainHost, readSessionChainHostCalls } from './fixtures/session-task-chain';
import { createCollaborationChild, createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';

test('shared overview reads two original workspace owners and preserves focus and navigation', async ({ launchElectronApp }, info) => {
  test.setTimeout(360_000);
  const provider = await startScriptedLlm(() => ({ text: 'Fixture session ready.' }));
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, deviceScaleFactor: 1 });
  try {
    await configureSessionChainProvider(app, provider.port);
    const alpha = await createCollaborationProject(app, info.outputPath('alpha'), 'Alpha');
    const beta = await createCollaborationProject(app, info.outputPath('beta'), 'Beta');
    const child = await createCollaborationChild(app, alpha);
    await enableCollaborationFixtureVisibility(app);
    await hostInvoke(app, 'workspaces', 'saveState', { id: alpha.workspaceId, sessionKey: alpha.sessionKey, state: {
      artifactPanel: { open: true, expanded: true, tabs: [{ kind: 'agents' }], activeTabKind: 'agents' },
    } });
    await instrumentSessionChainHost(app);
    const page = await getStableWindow(app); await page.reload();
    const before = await hostInvoke(app, 'workspaces', 'list'), modelCalls = provider.log.length;
    await page.getByTestId('sidebar-nav-system').click();
    const panel = page.getByTestId('session-collaboration');
    await expect(panel.getByTestId(`collaboration-row-${encodeURIComponent(alpha.sessionKey)}`)).toBeVisible({ timeout: 45_000 });
    await expect(panel.getByTestId(`collaboration-row-${encodeURIComponent(beta.sessionKey)}`)).toBeVisible();
    await expect(panel.getByTestId(`collaboration-row-${encodeURIComponent(child.sessionKey)}`)).toBeVisible();
    const collaborationReads = async (action: string) => (await readSessionChainHostCalls(app))
      .filter(call => call.module === 'sessionActivity' && call.action === action).length;
    expect(await collaborationReads('read')).toBe(0);
    const filter = panel.getByTestId('collaboration-search');
    await filter.fill('Beta');
    const row = panel.getByTestId(`collaboration-row-${encodeURIComponent(beta.sessionKey)}`);
    const beforeSelection = await collaborationReads('query');
    await row.press('Enter');
    await expect(panel.getByTestId('collaboration-detail')).toContainText('Beta collaboration goal');
    await expect.poll(() => collaborationReads('query')).toBeGreaterThan(beforeSelection);
    expect(await collaborationReads('read')).toBe(0);
    expect(await collaborationReads('resources')).toBe(0);
    expect(await collaborationReads('modelUsage')).toBe(0);
    await filter.focus();
    const queriesBefore = await collaborationReads('query');
    await publishGatewayStatus(app, { state: 'running', gatewayReady: true });
    await expect.poll(() => collaborationReads('query')).toBeGreaterThan(queriesBefore);
    await expect(row).toHaveAttribute('aria-pressed', 'true'); await expect(filter).toHaveValue('Beta'); await expect(filter).toBeFocused();
    const frames = [];
    for (const locale of ['en', 'zh', 'ja', 'ru']) {
      const labels = JSON.parse(await readFile(`shared/i18n/locales/${locale}/agents.json`, 'utf8')).collaboration;
      for (const theme of ['light', 'dark']) {
        await hostInvoke(app, 'settings', 'set', { key: 'language', value: locale });
        await hostInvoke(app, 'settings', 'set', { key: 'theme', value: theme });
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect.poll(() => page.locator('html').evaluate(html => html.classList.contains('dark'))).toBe(theme === 'dark');
        await expect(panel.getByRole('heading', { name: labels.title, exact: true })).toBeVisible();
        await filter.fill('Beta');
        await row.press('Enter');
        for (const width of [390, 960, 1440]) {
          await pinWindowContentSize(app, { width, height: 900 });
          await page.emulateMedia({ reducedMotion: 'reduce' });
          expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
          await expect(filter).toHaveValue('Beta');
          await expect(row).toHaveAttribute('aria-pressed', 'true');
          const path = info.outputPath(`collaboration-${locale}-${theme}-${width}.png`);
          await page.screenshot({ path });
          frames.push({ locale, theme, width, path });
        }
      }
    }
    const after = await hostInvoke(app, 'workspaces', 'list'); expect(after).toEqual(before); expect(provider.log.length).toBe(modelCalls);
    await page.getByTestId(`portfolio-open-${alpha.workspaceId}`).click();
    const project = page.getByTestId('workspace-agents-panel');
    await project.locator('summary').first().press('Enter');
    const projectPanel = project.getByTestId('session-collaboration');
    const projectBefore = await hostInvoke(app, 'workspaces', 'list');
    await expect(projectPanel.getByTestId(`collaboration-row-${encodeURIComponent(alpha.sessionKey)}`)).toBeVisible();
    await expect(projectPanel.getByTestId(`collaboration-row-${encodeURIComponent(child.sessionKey)}`)).toBeVisible();
    await expect(projectPanel.getByTestId(`collaboration-row-${encodeURIComponent(beta.sessionKey)}`)).toHaveCount(0);
    const projectAfter = await hostInvoke(app, 'workspaces', 'list');
    expect(projectAfter).toEqual(projectBefore);
    expect(provider.log.length).toBe(modelCalls);
    await page.getByTestId('sidebar-nav-system').click();
    await filter.fill('Beta'); await row.click();
    await expect(panel.getByTestId('collaboration-detail')).toContainText('Beta collaboration goal');
    const config = await hostInvoke<{ hash: string }>(app, 'gateway', 'rpc', { method: 'config.get' });
    await hostInvoke(app, 'gateway', 'rpc', { method: 'config.patch', params: { baseHash: config.hash,
      raw: JSON.stringify({ tools: { sessions: { visibility: 'self' } } }) } });
    await hostInvoke(app, 'gateway', 'stop'); await startGateway(app);
    await expect(row).toHaveCount(0);
    await expect(panel.getByText('Beta collaboration goal')).toHaveCount(0);
    await expect(panel.getByTestId('collaboration-controls')).toHaveCount(0);
    await writeFile(info.outputPath('overview-readbacks.json'), JSON.stringify({ driven_by: 'agent', actor: 'session-collaboration-overview',
      sourceCandidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), alpha, beta, child, before, after, projectBefore, projectAfter, frames,
      modelCallsBefore: modelCalls, modelCallsAfter: provider.log.length }, null, 2));
  } finally { await closeElectronApp(app); await provider.close(); }
});
