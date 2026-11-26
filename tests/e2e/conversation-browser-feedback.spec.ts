import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

const sessionKey = 'agent:main:main';
const started = Date.now() - 60_000;
const workspace = { id: 'feedback-project', name: 'Readable Workspace', rootPath: 'D:/tmp/readable-workspace-title',
  agentId: 'main', selectedAgentId: 'main', activeSessionKey: sessionKey,
  permissionMode: 'acceptEdits', createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {}, sessionStates: {} };
const messages = Array.from({ length: 5 }, (_, i) => [
  { id: `prompt-${i}`, role: 'user', content: `Review turn ${i + 1}`, timestamp: started + i * 1000 },
  { id: `progress-${i}`, role: 'assistant', content: [
    { type: 'text', text: 'Read the configuration before continuing.' },
    { type: 'tool_use', id: `read-${i}`, name: 'read_file', input: { path: 'settings/configuration.yml' } },
  ], timestamp: started + i * 1000 + 100 },
  { role: 'toolresult', toolCallId: `read-${i}`, content: 'mode: local', timestamp: started + i * 1000 + 200 },
  { id: `reply-${i}`, role: 'assistant', content: `Turn ${i + 1} completed. The configuration is available.`, timestamp: started + i * 1000 + 300 },
]).flat();

test('annotated conversation controls retain navigation, disclosure and shared tooltips', async ({ launchElectronApp }, info) => {
  test.setTimeout(180_000);
  const app = await launchElectronApp({ skipSetup: true, theme: 'dark' });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, gatewayReady: true },
      gatewayRpcByMethod: { 'sessions.list': { sessions: [{ key: sessionKey, sessionId: 'bookmark-generation', displayName: 'Interaction review' }] },
        'chat.history': { messages }, '*': {} },
      hostApi: {
        '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main', workspace: 'D:/tmp/readable-workspace-title', canonicalSessionKey: sessionKey }], defaultAgentId: 'main' },
        '["workspaces","list",null]': { success: true, profiles: [workspace], activeWorkspaceId: workspace.id, activeWorkspace: workspace },
        '["workspaces","getActive",null]': { success: true, activeWorkspaceId: workspace.id, activeWorkspace: workspace },
      },
    });
    // The workspace fixture must return the draft and panel state it was asked
    // to save when Settings refreshes the active workspace.
    await app.evaluate(({ ipcMain }, fixture) => {
      type Request = { id?: string; module?: string; action?: string;
        payload?: { sessionKey?: string; activeSessionKey?: string; state?: Record<string, unknown> } };
      type Handler = (event: unknown, request: Request) => unknown;
      const previous = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get('host:invoke');
      const saved = { ...fixture, sessionStates: {} as Record<string, Record<string, unknown>> };
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', (event, request: Request) => {
        if (request.module === 'workspaces' && request.action === 'saveState') {
          const key = request.payload?.sessionKey ?? request.payload?.activeSessionKey ?? saved.activeSessionKey;
          saved.sessionStates[key] = { ...saved.sessionStates[key], ...request.payload?.state };
          return { id: request.id, ok: true, data: { success: true } };
        }
        if (request.module === 'workspaces' && ['list', 'getActive'].includes(request.action ?? '')) {
          return { id: request.id, ok: true, data: { success: true, profiles: [saved], activeWorkspaceId: saved.id, activeWorkspace: saved } };
        }
        return previous?.(event, request);
      });
    }, workspace);
    const page = await getStableWindow(app);
    await pinWindowContentSize(app, { width: 1100, height: 850 });
    await page.reload();
    const rail = page.getByTestId('chat-message-nav-rail');
    await expect(rail).toBeVisible();
    const mark = rail.locator('[data-nav-index]').nth(1);
    const index = await mark.getAttribute('data-nav-index');
    await mark.hover();
    const preview = page.getByTestId(`turn-preview-${index}`);
    await preview.getByRole('button', { name: 'Bookmark this turn' }).click();
    await expect(mark).toHaveAttribute('data-bookmarked', 'true');
    await page.reload();
    await expect(mark).toHaveAttribute('data-bookmarked', 'true');
    await page.getByTestId('chat-message-nav-next-bookmark').click();
    await expect(page.getByTestId(`chat-message-${index}`)).toBeInViewport();
    await mark.focus();
    await mark.press('ArrowRight');
    await expect(preview.getByRole('button', { name: 'Remove bookmark' })).toBeFocused();
    await page.screenshot({ path: info.outputPath('bookmarked-turn.png') });
    await preview.getByRole('button', { name: 'Remove bookmark' }).press('Escape');
    await expect(preview).toHaveCount(0);
    const group = page.getByTestId('chat-tool-activity-group').nth(1);
    const toggle = group.getByTestId('chat-tool-activity-toggle');
    await expect(toggle).toHaveCSS('font-size', '14px');
    await toggle.click();
    await expect(group.getByTestId('chat-execution-step-toggle')).toBeVisible();
    await group.getByTestId('chat-execution-step-toggle').click();
    await expect(group.getByTestId('chat-execution-step-detail')).toContainText('mode: local');
    await toggle.click();
    await expect(group.getByTestId('chat-tool-activity-details')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await toggle.click();
    await expect(group.getByTestId('chat-execution-step-toggle')).toBeVisible();
    await toggle.click();
    await expect(group.getByTestId('chat-tool-activity-details')).toHaveCount(0);
    await expect(page.getByTestId('chat-model-picker-button').locator('.lucide-flame')).toHaveCount(0);
    const input = page.getByTestId('chat-composer-input');
    await input.fill('Keep this draft readable.');
    await expect(input).toHaveValue('Keep this draft readable.');
    await expect(input).toHaveCSS('font-size', '15px');
    await page.getByTestId('chat-toolbar-more').click();
    const menu = page.getByTestId('chat-toolbar-more-menu');
    await expect(menu).toBeVisible();
    expect(await menu.evaluate(node => {
      const token = getComputedStyle(node).getPropertyValue('--color-background-control-panel');
      const probe = document.createElement('div'); probe.style.backgroundColor = token; node.append(probe);
      const expected = getComputedStyle(probe).backgroundColor; probe.remove();
      return getComputedStyle(node).backgroundColor === expected;
    })).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByTestId('chat-workspace-toggle').click();
    const files = page.getByTestId('artifact-panel-launcher-files');
    if (await files.isVisible()) await files.click();
    await expect(page.getByTestId('workspace-files-title')).toBeVisible();
    await expect(page.getByTestId('workspace-files-path')).toContainText('readable-workspace-title');
    const close = page.getByTestId('artifact-panel-close');
    await close.hover();
    await expect(page.getByRole('tooltip')).toContainText(await close.getAttribute('aria-label') ?? '');
    await page.screenshot({ path: info.outputPath('workspace-controls.png') });
    await close.click();
    await page.getByTestId('sidebar-nav-settings').click();
    const general = page.getByTestId('settings-nav-general');
    await general.hover();
    await expect(page.getByRole('tooltip')).toContainText('General');
    await expect(general).not.toHaveAttribute('title');
    await page.screenshot({ path: info.outputPath('settings-tooltip.png') });
    await page.getByTestId('settings-back-button').click();
    await pinWindowContentSize(app, { width: 540, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(input).toHaveValue('Keep this draft readable.');
    await page.screenshot({ path: info.outputPath('narrow-conversation.png') });
  } finally { await closeElectronApp(app); }
});
