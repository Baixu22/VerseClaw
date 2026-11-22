import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

const PARENT = 'agent:main:family-parent';
const CHILD = 'agent:main:family-child';
const ORDINARY = 'agent:main:ordinary';
const OTHER = 'agent:main:other-project';
const workspace = {
  id: 'family-connectors', name: 'Navigation · main', rootPath: 'D:/fixture/family-connectors',
  agentId: 'main', selectedAgentId: 'main', activeSessionKey: PARENT,
  permissionMode: 'readOnly', createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {},
  sessionStates: { [PARENT]: {}, [CHILD]: {}, [ORDINARY]: {} },
  sessionFolders: [{ id: 'design-group', name: 'Design exploration', parentId: null, order: 0, kind: 'workgroup', createdAt: 1, updatedAt: 1 }],
  sessionFolderAssignments: { [PARENT]: 'design-group', [CHILD]: 'design-group', [ORDINARY]: 'design-group' },
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
      const toggle = page.getByTestId(`session-family-toggle-${PARENT}`);
      const activeRail = page.locator('.task-collection-list > svg [data-slot="hook-sidebar-active"]');
      const hoverRail = page.locator('.task-collection-list > svg [data-slot="hook-sidebar-hover"]');
      await expect(parent).toBeVisible();
      const groupHeader = project.getByTestId('sidebar-folder-toggle-design-group').locator('..');
      const groupMembers = project.locator('.ws-stream .ws-members');
      expect(await groupHeader.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      expect(await groupHeader.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
      expect(await groupMembers.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      await toggle.click();
      await expect(child).toBeVisible();
      await expect(activeRail).toHaveCSS('opacity', '0');
      await child.hover();
      await expect(hoverRail).toHaveCSS('opacity', '0');
      await project.screenshot({ path: testInfo.outputPath(`${theme}-parent-selected.png`) });

      const sessionTrigger = page.getByTestId('chat-header-session-name');
      await expect(sessionTrigger).toHaveAttribute('aria-expanded', 'false');
      await sessionTrigger.click();
      await expect(sessionTrigger).toHaveAttribute('aria-expanded', 'true');
      await expect(sessionTrigger).toHaveClass(/is-open/);
      const sessionMenu = page.getByTestId('chat-session-navigation-menu');
      await expect(sessionMenu).toContainText('Conversations in this workspace');
      await expect(page.getByTestId(`chat-session-item-${PARENT}`)).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId(`chat-session-derived-${CHILD}`)).toHaveAttribute('data-derived', 'true');
      await expect(sessionMenu).toBeInViewport();
      expect(await sessionMenu.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
      expect(await sessionMenu.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(61, 61, 59)');
      await page.mouse.move(8, 8);
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
      });
      await page.screenshot({ path: testInfo.outputPath(`${theme}-session-dropdown.png`) });
      await page.keyboard.press('Escape');
      await expect(sessionMenu).toHaveCount(0);
      await expect(sessionTrigger).toBeFocused();

      const projectTrigger = page.locator('.chat-header-project-trigger');
      await projectTrigger.click();
      await expect(projectTrigger).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('chat-header-workspace-menu')).toBeInViewport();
      await page.mouse.move(8, 8);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-project-dropdown.png`) });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('chat-header-workspace-menu')).toHaveCount(0);
      await expect(projectTrigger).toHaveAttribute('aria-expanded', 'false');

      await pinWindowContentSize(app, { width: 960, height: 800 });
      await expect(projectTrigger).toBeHidden();
      await sessionTrigger.click();
      await expect(sessionMenu).toBeInViewport();
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await pinWindowContentSize(app, { width: 1280, height: 800 });
      await expect(projectTrigger).toBeVisible();
      await page.mouse.move(8, 8);
      await toggle.click();
      await expect(child).toBeVisible();
      await page.mouse.move(8, 8);

      await child.click();
      await expect(child.locator('xpath=ancestor::div[contains(@class,"sidebar-row")][1]')).toHaveClass(/selected/);
      await expect(activeRail).toHaveCSS('opacity', '0');
      const familyChildren = project.locator('.session-family__children');
      await expect(familyChildren).toHaveCount(1);
      expect(await familyChildren.evaluate(element => getComputedStyle(element, '::before').width)).toBe('1px');
      expect(await familyChildren.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      expect(await familyChildren.evaluate(element => getComputedStyle(element, '::before').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      await expect(familyChildren.locator('.ws-family-kind')).toHaveCount(0);
      await expect(child.locator('xpath=ancestor::div[contains(@class,"ws-family-row")][1]').locator('.ws-family-kind')).toHaveCount(0);
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
