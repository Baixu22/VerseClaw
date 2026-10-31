/**
 * Sidebar session rows and the header activity bell — interaction polish.
 *
 *  - Hover reveals exactly two controls (pin, ⋯); the title stops where they
 *    begin, and a title too long for its row scrolls as a seamless loop that
 *    settles back when the pointer leaves. Reduced motion never scrolls.
 *  - ⋯ opens the session menu anchored under the button; Archive is one click
 *    with an Undo that restores the session.
 *  - The bell carries a live ring while a session runs, and its panel lists
 *    running sessions above the recent activity feed.
 *
 * Agent-driven Electron automation; screenshots are evidence of what was
 * rendered, not human review.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, hoverUntilVisible, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

const MAIN = 'agent:main:main';
const LONG = 'agent:main:long-title';
const RUNNING = 'agent:main:background-run';
const ROOT = 'D:/tmp/sidebar-polish-fixture';
const LONG_TITLE = 'Polish the conversation sidebar so hover shows one clear set of controls and long titles scroll';
const artifacts = process.env.CLAWX_SIDEBAR_POLISH_ARTIFACTS_DIR
  || join(process.env.CLAWX_E2E_RUN_ROOT || 'D:/tmp', 'sidebar-session-row-polish', 'screenshots');
const now = Date.parse('2026-10-30T09:00:00Z');

const workspace = {
  id: 'polish-project', name: 'Sidebar Studio', rootPath: ROOT, agentId: 'main', selectedAgentId: 'main', activeSessionKey: MAIN,
  agentBindings: { main: { workspaceId: 'polish-project', agentId: 'main', sessionKey: MAIN } },
  permissionMode: 'acceptEdits', createdAt: 1, updatedAt: 1, lastOpenedAt: 2, state: {},
  sessionStates: { [MAIN]: {}, [LONG]: {}, [RUNNING]: {} },
};

function stable(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${stable(val)}`).join(',')}}`;
}

async function seed(app: ElectronApplication) {
  const sessions = [
    { key: MAIN, displayName: 'Sidebar review', updatedAt: now },
    { key: LONG, displayName: LONG_TITLE, updatedAt: now - 60_000 },
    { key: RUNNING, displayName: 'Background build', updatedAt: now - 30_000, status: 'running', hasActiveRun: true },
  ];
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
    gatewayRpc: {
      [stable(['sessions.list', {}])]: { success: true, result: { sessions } },
      [stable(['chat.history', null])]: { success: true, result: { messages: [], hasMore: false } },
    },
    hostApi: {
      [stable(['agents', 'list', null])]: { success: true, agents: [{ id: 'main', name: 'Studio Assistant', workspace: ROOT, mainSessionKey: MAIN, isDefault: true, channelTypes: [] }], defaultAgentId: 'main', defaultModelRef: 'deepseek/deepseek-chat', configuredChannelTypes: [] },
      [stable(['settings', 'getAll', null])]: { success: true, data: { setupComplete: true, language: 'en', theme: 'light' } },
      [stable(['workspaces', 'list', null])]: { success: true, profiles: [workspace], activeWorkspaceId: workspace.id, activeWorkspace: workspace },
      [stable(['workspaces', 'getActive', null])]: { success: true, activeWorkspaceId: workspace.id, activeWorkspace: workspace },
      [stable(['workspaces', 'getSessionState', null])]: { success: true, sessionState: {} },
      [stable(['sessions', 'history', null])]: { messages: [], hasMore: false },
      [stable(['sessions', 'archive', null])]: { success: true },
      [stable(['sessions', 'restore', null])]: { success: true },
      [stable(['sessions', 'listArchived', null])]: { success: true, entries: [] },
      [stable(['providers', 'snapshot', null])]: { success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '' },
    },
  });
}

async function capture(page: Page, name: string) {
  await mkdir(artifacts, { recursive: true });
  await page.getByTestId('sidebar').screenshot({ path: join(artifacts, `${name}.png`) });
}

/** Screenshots must not catch a popover mid fade-in. */
async function settleAnimations(page: Page, testId: string) {
  await page.getByTestId(testId).evaluate((element) => Promise.all(
    element.getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished),
  ));
}

async function translateX(page: Page, key: string): Promise<number> {
  return page.getByTestId(`sidebar-session-${key}`).locator('.task-title__text').evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    return transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m41 : 0;
  });
}

test.describe('Sidebar session rows and activity bell', () => {
  test('hover shows pin + more, long titles loop and settle, and reduced motion keeps them still', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });
    try {
      await seed(app);
      const page = await getStableWindow(app);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await pinWindowContentSize(app, { width: 1280, height: 820 });
      await page.reload();
      const longRow = page.getByTestId(`sidebar-session-${LONG}`);
      await expect(longRow).toBeVisible({ timeout: 30_000 });
      const more = page.getByTestId(`sidebar-session-more-${LONG}`);
      await hoverUntilVisible(longRow, more);

      const longSelectRow = longRow.locator('xpath=ancestor::div[contains(@class, "sidebar-row")][1]');
      const strip = await longSelectRow.evaluate((row) => ({
        buttons: [...row.querySelectorAll('.sidebar-row__actions button')].map((button) => (button as HTMLElement).dataset.testid),
      }));
      expect(strip.buttons).toEqual([`sidebar-session-pin-${LONG}`, `sidebar-session-more-${LONG}`]);
      // The title ends where the controls begin; it never runs underneath them.
      // The title slides clear over ~160ms, so wait for the settled layout.
      await expect.poll(() => longSelectRow.evaluate((row) => (
        row.querySelector('.sidebar-row__actions')!.getBoundingClientRect().left
        - row.querySelector('.task-title')!.getBoundingClientRect().right
      ))).toBeGreaterThanOrEqual(-0.5);

      const clip = longRow.locator('.task-title__clip');
      await expect(clip).toHaveAttribute('data-marquee', 'on', { timeout: 5_000 });
      // It starts moving promptly: no long crawl before the pass gets going.
      await expect.poll(() => translateX(page, LONG), { timeout: 1_500 }).toBeLessThan(-2);
      await capture(page, 'row-hover-marquee-light');

      await page.mouse.move(900, 500);
      await expect(clip).not.toHaveAttribute('data-marquee', 'on', { timeout: 3_000 });
      expect(Math.abs(await translateX(page, LONG))).toBeLessThan(0.5);

      // A title that fits never moves.
      await page.getByTestId(`sidebar-session-${MAIN}`).hover();
      await page.waitForTimeout(900);
      await expect(page.getByTestId(`sidebar-session-${MAIN}`).locator('.task-title__clip')).not.toHaveAttribute('data-marquee', 'on');

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.mouse.move(900, 500);
      await longRow.hover();
      await page.waitForTimeout(900);
      await expect(clip).not.toHaveAttribute('data-marquee', 'on');
      expect(await translateX(page, LONG)).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('more menu opens under its button and archive offers an undo', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });
    try {
      await seed(app);
      const page = await getStableWindow(app);
      await pinWindowContentSize(app, { width: 1280, height: 820 });
      await page.reload();
      const longRow = page.getByTestId(`sidebar-session-${LONG}`);
      await expect(longRow).toBeVisible({ timeout: 30_000 });
      const more = page.getByTestId(`sidebar-session-more-${LONG}`);
      await hoverUntilVisible(longRow, more);
      await more.click();

      const menu = page.getByTestId(`sidebar-session-context-menu-${LONG}`);
      await expect(menu).toBeVisible();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      // Geometry belongs to the settled menu, not the 140ms scale/fade frame.
      await settleAnimations(page, `sidebar-session-context-menu-${LONG}`);
      const [menuBox, moreBox] = await Promise.all([menu.boundingBox(), more.boundingBox()]);
      expect(Math.abs((menuBox!.x + menuBox!.width) - (moreBox!.x + moreBox!.width))).toBeLessThanOrEqual(2);
      expect(menuBox!.y).toBeGreaterThanOrEqual(moreBox!.y + moreBox!.height);
      await capture(page, 'more-menu-light');

      // The keyboard works inside the menu, and Escape closes it.
      await page.keyboard.press('ArrowDown');
      await expect(menu.locator('button:focus')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(more).toHaveAttribute('aria-expanded', 'false');

      await hoverUntilVisible(longRow, more);
      await more.click();
      await page.getByTestId('sidebar-session-context-archive').click();
      await expect(longRow).toBeHidden({ timeout: 5_000 });
      await expect(page.getByTestId('session-delete-dialog')).toHaveCount(0);
      const calls = await app.evaluate(() => (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module: string; action: string; payload: Record<string, unknown> | null }> }).__verseClawE2eHostCalls ?? []);
      expect(calls.find((call) => call.module === 'sessions' && call.action === 'archive')?.payload)
        .toMatchObject({ id: LONG, originalWorkspaceId: 'polish-project' });

      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(longRow).toBeVisible({ timeout: 10_000 });
      expect((await app.evaluate(() => (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module: string; action: string }> }).__verseClawE2eHostCalls ?? []))
        .some((call) => call.module === 'sessions' && call.action === 'restore')).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('bell shows a live ring and lists running sessions above recent activity', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });
    try {
      await seed(app);
      const page = await getStableWindow(app);
      await pinWindowContentSize(app, { width: 1280, height: 820 });
      await page.reload();
      await expect(page.getByTestId(`sidebar-session-status-${RUNNING}`)).toHaveAttribute('data-state', 'running', { timeout: 30_000 });

      const bell = page.getByTestId('chat-completion-bell');
      await expect(bell).toHaveAttribute('data-live', 'running');
      await expect(page.getByTestId('chat-activity-live-ring')).toBeVisible();
      await expect(bell).toHaveAttribute('aria-label', /1 running/);
      await mkdir(artifacts, { recursive: true });
      await bell.screenshot({ path: join(artifacts, 'bell-running-light.png') });

      await bell.click();
      const panel = page.getByTestId('chat-completion-menu');
      await expect(panel).toBeVisible();
      const liveItems = page.getByTestId('chat-activity-live-item');
      await expect(liveItems).toHaveCount(1);
      await expect(liveItems.first()).toContainText('Background build');
      await expect(liveItems.first()).toHaveAttribute('data-state', 'running');
      const bounds = await page.evaluate(() => {
        const sidebar = document.querySelector('[data-testid="sidebar"]')!.getBoundingClientRect();
        const menu = document.querySelector('[data-testid="chat-completion-menu"]')!.getBoundingClientRect();
        const trigger = document.querySelector('[data-testid="chat-completion-bell"]')!.getBoundingClientRect();
        return { sidebarLeft: sidebar.left, sidebarRight: sidebar.right, menuLeft: menu.left, menuRight: menu.right, menuTop: menu.top, triggerBottom: trigger.bottom };
      });
      expect(bounds.menuLeft).toBeGreaterThanOrEqual(bounds.sidebarLeft);
      expect(bounds.menuRight).toBeLessThanOrEqual(bounds.sidebarRight + 1);
      expect(bounds.menuTop).toBeGreaterThan(bounds.triggerBottom);
      await settleAnimations(page, 'chat-completion-menu');
      expect(await panel.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
      await page.screenshot({ path: join(artifacts, 'bell-panel-light.png'), clip: { x: 0, y: 0, width: 420, height: 520 } });

      await liveItems.first().click();
      await expect(panel).toBeHidden();

      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await bell.screenshot({ path: join(artifacts, 'bell-running-dark.png') });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await page.getByTestId('chat-activity-live-ring').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
    } finally {
      await closeElectronApp(app);
    }
  });
});
