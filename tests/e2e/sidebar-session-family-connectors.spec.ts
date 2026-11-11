import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const PARENT = 'agent:main:family-parent';
const CHILD = 'agent:main:family-child';
const ORDINARY = 'agent:main:ordinary';
const OTHER = 'agent:main:other-project';
const workspace = {
  id: 'family-connectors', name: 'Navigation · main', rootPath: 'D:/fixture/family-connectors',
  agentId: 'main', selectedAgentId: 'main', activeSessionKey: PARENT,
  permissionMode: 'readOnly', createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {},
  sessionStates: { [PARENT]: {}, [CHILD]: {}, [ORDINARY]: {} },
};
const otherWorkspace = { ...workspace, id: 'plain-project', name: 'Independent project', rootPath: 'D:/fixture/plain-project', activeSessionKey: OTHER, sessionStates: { [OTHER]: {} } };

for (const theme of ['light', 'dark'] as const) {
  test(`family connectors replace the travelling rail without overlapping disclosure (${theme})`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
        gatewayRpcByMethod: {
          'sessions.list': { success: true, result: { sessions: [
            { key: PARENT, displayName: 'Main conversation', updatedAt: 3 },
            { key: CHILD, displayName: 'Explore card layout', parentSessionKey: PARENT, forkedFromParent: true, updatedAt: 2 },
            { key: ORDINARY, displayName: 'Independent conversation', updatedAt: 1 },
            { key: OTHER, displayName: 'Other project conversation', updatedAt: 1 },
          ] } },
          'chat.history': { success: true, result: { messages: [] } },
          '*': { success: true, result: {} },
        },
        hostApi: {
          '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main', mainSessionKey: PARENT }], defaultAgentId: 'main' },
          '["workspaces","list",null]': { profiles: [workspace, otherWorkspace], activeWorkspaceId: workspace.id, activeWorkspace: workspace },
          '["workspaces","getActive",null]': { activeWorkspaceId: workspace.id, activeWorkspace: workspace },
          '["workspaces","saveState",null]': { success: true },
          '["git","status",null]': { success: true, status: { isRepository: false } },
        },
      });
      const page = await getStableWindow(app);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const project = page.getByTestId(`sidebar-session-project-${workspace.id}`);
      const parent = page.getByTestId(`sidebar-session-${PARENT}`);
      const child = page.getByTestId(`sidebar-session-${CHILD}`);
      const toggle = page.getByTestId(`sidebar-session-children-${PARENT}`);
      const activeRail = page.locator('.task-collection-list > svg [data-slot="hook-sidebar-active"]');
      const hoverRail = page.locator('.task-collection-list > svg [data-slot="hook-sidebar-hover"]');
      await expect(parent).toBeVisible();
      await toggle.click();
      await expect(child).toBeVisible();
      await expect(activeRail).toHaveCSS('opacity', '0');
      await child.hover();
      await expect(hoverRail).toHaveCSS('opacity', '0');
      await project.screenshot({ path: testInfo.outputPath(`${theme}-parent-selected.png`) });

      await child.click();
      await expect(child.locator('xpath=ancestor::div[contains(@class,"sidebar-row")][1]')).toHaveClass(/selected/);
      await expect(activeRail).toHaveCSS('opacity', '0');
      await expect(project.locator('.session-family__connector')).toHaveCount(1);
      await parent.hover();
      await expect(hoverRail).toHaveCSS('opacity', '0');
      await project.screenshot({ path: testInfo.outputPath(`${theme}-child-selected.png`) });

      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(child).toHaveCount(0);
      await expect(activeRail).toHaveCSS('opacity', '0');
      await project.screenshot({ path: testInfo.outputPath(`${theme}-collapsed.png`) });

      await page.getByTestId(`sidebar-session-${ORDINARY}`).click();
      await expect(activeRail).toHaveCSS('opacity', '0');
      await parent.hover();
      await expect(hoverRail).toHaveCSS('opacity', '0');
      await project.screenshot({ path: testInfo.outputPath(`${theme}-ordinary-selected.png`) });
      await page.getByTestId(`sidebar-session-${OTHER}`).hover();
      await expect(hoverRail).toHaveCSS('opacity', '1');
    } finally { await closeElectronApp(app); }
  });
}
