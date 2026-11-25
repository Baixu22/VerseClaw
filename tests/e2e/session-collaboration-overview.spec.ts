import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, pinWindowContentSize, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';

test('shared overview reads two original workspace owners and preserves focus and navigation', async ({ launchElectronApp }, info) => {
  test.setTimeout(360_000);
  const provider = await startScriptedLlm(() => ({ text: 'Fixture session ready.' }));
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, deviceScaleFactor: 1 });
  try {
    await configureSessionChainProvider(app, provider.port);
    const alpha = await createCollaborationProject(app, info.outputPath('alpha'), 'Alpha');
    const beta = await createCollaborationProject(app, info.outputPath('beta'), 'Beta');
    await enableCollaborationFixtureVisibility(app);
    const page = await getStableWindow(app); await page.reload();
    const before = await hostInvoke(app, 'workspaces', 'list'), modelCalls = provider.log.length;
    await page.getByTestId('sidebar-nav-system').click();
    const panel = page.getByTestId('session-collaboration');
    await expect(panel.getByTestId(`collaboration-row-${encodeURIComponent(alpha.sessionKey)}`)).toBeVisible({ timeout: 45_000 });
    await expect(panel.getByTestId(`collaboration-row-${encodeURIComponent(beta.sessionKey)}`)).toBeVisible();
    const filter = panel.getByTestId('collaboration-search');
    await filter.fill('Beta');
    const row = panel.getByTestId(`collaboration-row-${encodeURIComponent(beta.sessionKey)}`); await row.click();
    await expect(panel.getByTestId('collaboration-detail')).toContainText('Beta collaboration goal');
    await filter.focus(); await panel.getByTestId('collaboration-refresh').click(); await filter.focus();
    await expect(row).toHaveAttribute('aria-pressed', 'true'); await expect(filter).toHaveValue('Beta'); await expect(filter).toBeFocused();
    const frames = [];
    for (const locale of ['en', 'zh', 'ja', 'ru']) for (const theme of ['light', 'dark']) for (const width of [390, 960, 1440]) {
      await hostInvoke(app, 'settings', 'set', { key: 'language', value: locale });
      await hostInvoke(app, 'settings', 'set', { key: 'theme', value: theme });
      await pinWindowContentSize(app, { width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(filter).toHaveValue('Beta'); await expect(row).toHaveAttribute('aria-pressed', 'true');
      const path = info.outputPath(`collaboration-${locale}-${theme}-${width}.png`); await page.screenshot({ path }); frames.push({ locale, theme, width, path });
    }
    const after = await hostInvoke(app, 'workspaces', 'list'); expect(after).toEqual(before); expect(provider.log.length).toBe(modelCalls);
    await writeFile(info.outputPath('overview-readbacks.json'), JSON.stringify({ driven_by: 'agent', actor: 'session-collaboration-overview',
      sourceCandidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), alpha, beta, before, after, frames,
      modelCallsBefore: modelCalls, modelCallsAfter: provider.log.length }, null, 2));
  } finally { await closeElectronApp(app); await provider.close(); }
});
