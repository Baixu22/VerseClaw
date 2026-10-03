import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const sessionKey = 'agent:main:main';
const workspace = {
  id: 'workspace-layout', name: 'Workspace layout', rootPath: '/workspace/demo',
  permissionMode: 'readOnly', activeSessionKey: sessionKey, state: {}, sessionStates: {},
};

for (const theme of ['light', 'dark'] as const) {
  test(`workspace controls fit both supported widths in ${theme}`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, theme });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [JSON.stringify(['sessions.list', {}])]: {
            success: true, result: { sessions: [{ key: sessionKey, displayName: 'main' }] },
          },
        },
        hostApi: Object.fromEntries([
          ['agents', 'list', { success: true, agents: [{ id: 'main', name: 'Main', isDefault: true, workspace: workspace.rootPath, mainSessionKey: sessionKey, channelTypes: [] }], defaultAgentId: 'main', configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {} }],
          ['workspaces', 'list', { profiles: [workspace], activeWorkspaceId: workspace.id, activeWorkspace: workspace }],
          ['workspaces', 'getActive', { activeWorkspaceId: workspace.id, activeWorkspace: workspace }],
          ['workspaces', 'saveState', { success: true }],
          ['files', 'listTree', { ok: true, root: { name: 'demo', relPath: '', absPath: workspace.rootPath, isDir: true, children: [{ name: 'layout.md', relPath: 'layout.md', absPath: `${workspace.rootPath}/layout.md`, isDir: false, size: 48 }] } }],
          ['files', 'readText', { ok: true, content: '# Workspace preview\n\nFile content stays readable.' }],
          ['terminal', 'status', { success: true, status: 'idle', sessionId: null }],
          ['git', 'status', { ok: true, status: { isRepository: false } }],
          ['git', 'branches', { success: true, branches: [] }],
          ['git', 'reflog', { success: true, entries: [] }],
          ['permissions', 'approvals', { success: true, approvals: [] }],
        ].map(([module, action, response]) => [JSON.stringify([module, action, null]), response])),
      });
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/);
      await page.getByTestId('chat-workspace-toggle').click();
      const panel = page.getByTestId('artifact-panel');
      await expect(panel).toBeVisible();

      for (const width of [1280, 960]) {
        await page.setViewportSize({ width, height: 800 });
        for (const kind of ['files', 'review', 'terminal', 'browser', 'artifact', 'audit']) {
          if (kind === 'files') {
            await panel.getByTestId('artifact-panel-tab-files').click();
            const back = panel.getByRole('button', { name: 'Back to files' });
            if (await back.isVisible()) await back.click();
            await panel.getByTestId('ai-file-tree-file').getByRole('button', { name: 'layout.md' }).click();
            await expect(panel.getByRole('heading', { name: 'Workspace preview' })).toBeVisible();
            await expect(panel.getByTestId('ai-file-tree-file')).toBeVisible({ visible: width > 960 });
          } else {
            await panel.getByTestId('artifact-panel-new-tab').click();
            await page.getByTestId(`artifact-panel-new-tab-${kind}`).click();
          }
          await expect(panel.getByTestId(`artifact-panel-tab-${kind}`)).toHaveAttribute('aria-selected', 'true');
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
          await expect.poll(() => panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
          const escapedControls = await panel.locator('button:visible, input:visible, select:visible').evaluateAll((controls) => controls.flatMap((control) => {
            const bounds = control.getBoundingClientRect();
            return bounds.left < -1 || bounds.right > window.innerWidth + 1
              ? [control.getAttribute('data-testid') ?? control.textContent?.trim()]
              : [];
          }));
          expect(escapedControls).toEqual([]);
          await page.screenshot({ path: testInfo.outputPath(`workspace-${theme}-${width}-${kind}.png`), animations: 'disabled' });
          if (kind !== 'files') await panel.getByTestId(`artifact-panel-tab-close-${kind}`).click();
        }
      }
    } finally {
      await closeElectronApp(app);
    }
  });
}
