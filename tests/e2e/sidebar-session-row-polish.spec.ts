/**
 * Sidebar session rows and the header activity bell — interaction polish.
 *
 *  - Hover reveals exactly two controls (pin, ⋯); the title stops where they
 *    begin, and a title too long for its row scrolls as a seamless loop that
 *    settles back when the pointer leaves. Reduced motion never scrolls.
 *  - ⋯ opens the session menu anchored under the button; Archive is one click
 *    with an Undo that restores the session.
 *  - The bell swings while a session runs, and its panel lists
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

async function seed(app: ElectronApplication, hierarchy = false) {
  const childKey = 'agent:main:hierarchy-child';
  const profile = hierarchy ? { ...workspace,
    coordinatorBindings: { [MAIN]: { activeTaskNodeId: 'hierarchy-task', bindingRevision: 1 } },
    sessionStates: { ...workspace.sessionStates, [childKey]: {} },
  } : workspace;
  const profiles = hierarchy ? [profile, { ...workspace, id: 'migration-target', name: 'Migration target', rootPath: ROOT + '-target' }] : [profile];
  const sessions = [
    { key: MAIN, sessionId: 'sidebar-generation', displayName: 'Sidebar review', updatedAt: now },
    { key: LONG, displayName: LONG_TITLE, updatedAt: now - 60_000 },
    { key: RUNNING, displayName: 'Background build', updatedAt: now - 30_000, status: 'running', hasActiveRun: true },
    ...(hierarchy ? [{ key: childKey, displayName: 'Related design review', parentSessionKey: MAIN, forkedFromParent: true, updatedAt: now - 90_000 }] : []),
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
      [stable(['workspaces', 'list', null])]: { success: true, profiles, activeWorkspaceId: workspace.id, activeWorkspace: profile },
      [stable(['workspaces', 'getActive', null])]: { success: true, activeWorkspaceId: workspace.id, activeWorkspace: profile },
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
  test('keeps the header compact, separates navigation from actions, and retains migration dialogs', async ({ launchElectronApp }, info) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });
    try {
      await seed(app, true);
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('chat-header-session-name')).toContainText('Sidebar review');
      const header = page.getByTestId('chat-toolbar-shell');
      await expect(header.locator('select')).toHaveCount(0);
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
        for (const width of [1280, 960, 720]) {
          await pinWindowContentSize(app, { width, height: 820 });
          expect((await header.boundingBox())!.height).toBeLessThanOrEqual(42);
          await page.getByTestId('chat-header-session-name').click();
          const menu = page.getByTestId('chat-session-navigation-menu');
          await expect(menu).toBeInViewport();
          await expect(menu.locator('[data-testid="chat-session-fork"]')).toHaveCount(0);
          const search = page.getByTestId('chat-session-navigation-search');
          await expect(search).toBeFocused();
          await search.fill('Related design');
          await expect(page.getByTestId('chat-session-derived-agent:main:hierarchy-child')).toBeVisible();
          await page.keyboard.press('ArrowDown');
          await expect(page.getByTestId('chat-session-derived-agent:main:hierarchy-child')).toBeFocused();
          await page.screenshot({ path: info.outputPath(`navigation-${theme}-${width}.png`) });
          await page.keyboard.press('Escape');
          await expect(page.getByTestId('chat-header-session-name')).toBeFocused();
          await page.getByTestId('chat-toolbar-more').click();
          await expect(page.getByTestId('chat-toolbar-more-menu')).toBeInViewport();
          if (theme === 'dark') {
            const surfaces = await page.evaluate(() => {
              const color = (selector: string) => getComputedStyle(document.querySelector(selector)!).backgroundColor;
              const tone = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number).reduce((a, b) => a + b) / 3;
              const canvas = color('[data-testid="chat-page"]');
              return { canvas: tone(canvas), sidebar: tone(color('[data-testid="sidebar"]')),
                composer: tone(color('.codex-composer-shell')), menu: tone(color('[data-testid="chat-toolbar-more-menu"]')),
                headerMatchesCanvas: color('[data-testid="chat-toolbar-shell"]') === canvas };
            });
            expect(surfaces.canvas).toBeGreaterThan(surfaces.sidebar + 3);
            expect(surfaces.composer).toBeGreaterThan(surfaces.canvas + 15);
            expect(surfaces.menu).toBeGreaterThan(surfaces.canvas + 8);
            expect(surfaces.headerMatchesCanvas).toBe(true);
          }
          await expect(page.getByTestId('chat-session-checkpoints')).toBeVisible();
          await expect(page.getByTestId('chat-session-fork')).toBeVisible();
          await expect(page.getByTestId('chat-session-handoff')).toBeVisible();
          await page.keyboard.press('Escape');
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
      }
      const sidebarToggle = page.getByTestId('sidebar-collapse-toggle');
      if (await sidebarToggle.getAttribute('aria-label') === 'Expand sidebar') await sidebarToggle.click();
      await expect.poll(async () => (await page.getByTestId('sidebar').boundingBox())!.width).toBeGreaterThan(250);
      await page.getByTestId(`sidebar-session-${LONG}`).click();
      await expect(page.getByTestId('chat-header-session-name')).toHaveText(LONG_TITLE);
      await expect.poll(() => page.evaluate(() => {
        const title = document.querySelector('[data-testid="chat-header-session-name"]')!.getBoundingClientRect();
        const actions = document.querySelector('[data-testid="chat-toolbar-actions"]')!.getBoundingClientRect();
        return title.right <= actions.left;
      })).toBe(true);
      await page.screenshot({ path: info.outputPath('long-title-expanded-sidebar-720.png') });
      await page.getByTestId(`sidebar-session-${MAIN}`).click();
      await page.getByTestId('chat-toolbar-more').click();
      await page.getByTestId('execution-migration-open').click();
      await expect(page.getByTestId('execution-migration-dialog')).toBeVisible();
      await expect(page.getByTestId('chat-toolbar-more-menu')).toBeHidden();
      await page.getByTestId('execution-migration-target').click();
      await page.getByRole('option', { name: 'Migration target' }).click();
      await page.screenshot({ path: info.outputPath('migration-dialog.png') });
      await page.getByTestId('execution-migration-dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByTestId('chat-toolbar-more')).toBeFocused();
      const calls = await app.evaluate(() => (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module: string; action: string }> }).__verseClawE2eHostCalls ?? []);
      expect(calls.some(call => call.action === 'migrateExecution')).toBe(false);
    } finally { await closeElectronApp(app); }
  });

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

  test('bell swings, rests while open, and stays aligned in the collapsed sidebar', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });
    try {
      await seed(app);
      const page = await getStableWindow(app);
      await pinWindowContentSize(app, { width: 1280, height: 820 });
      await page.reload();
      await expect(page.getByTestId(`sidebar-session-status-${RUNNING}`)).toHaveAttribute('data-state', 'running', { timeout: 30_000 });
      await expect(page.getByTestId('chat-toolbar-refresh')).toBeHidden();
      await expect(page.getByTestId('chat-memory-injection-toggle')).toBeHidden();
      await page.getByTestId('chat-toolbar-more').click();
      await expect(page.getByTestId('chat-toolbar-refresh')).toBeVisible();
      await expect(page.getByTestId('chat-session-settings')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('chat-toolbar-more')).toBeFocused();

      const bell = page.getByTestId('chat-completion-bell');
      await expect(bell).toHaveAttribute('data-live', 'running');
      await expect(page.getByTestId('chat-activity-live-ring')).toHaveCount(0);
      const icon = page.getByTestId('chat-activity-bell-icon');
      await expect(icon).toBeVisible();
      // Sample a full swing and pause: both directions must be visible.
      const angles = await icon.evaluate((element) => new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const start = performance.now();
        const sample = () => {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
          values.push(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
          if (performance.now() - start < 2200) requestAnimationFrame(sample);
          else resolve(values);
        };
        sample();
      }));
      expect(Math.min(...angles)).toBeLessThan(-2);
      expect(Math.max(...angles)).toBeGreaterThan(2);
      await expect(bell).toHaveAttribute('aria-label', /1 running/);
      await mkdir(artifacts, { recursive: true });
      await bell.screenshot({ path: join(artifacts, 'bell-running-light.png') });

      await bell.click();
      const panel = page.getByTestId('chat-completion-menu');
      await expect(panel).toBeVisible();
      await expect(icon).toHaveCSS('transform', 'none');
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
      await expect(icon).toHaveCSS('transform', 'none');
      await page.getByTestId('sidebar-collapse-toggle').click();
      const collapse = page.getByTestId('sidebar-collapse-toggle');
      await expect(collapse).toHaveAttribute('aria-label', 'Expand sidebar');
      const [bellBox, collapseBox, sidebarBox] = await Promise.all([bell.boundingBox(), collapse.boundingBox(), page.getByTestId('sidebar').boundingBox()]);
      expect(bellBox!.y).toBeGreaterThanOrEqual(collapseBox!.y + collapseBox!.height);
      expect(Math.abs(bellBox!.x - collapseBox!.x)).toBeLessThanOrEqual(1);
      expect(bellBox!.x + bellBox!.width).toBeLessThan(sidebarBox!.x + sidebarBox!.width);
      await bell.click();
      await expect(panel).toBeVisible();
      const panelBox = await panel.boundingBox();
      expect(panelBox!.x).toBeGreaterThanOrEqual(0);
      expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(1280);
      await capture(page, 'bell-collapsed-dark');
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(bell).toBeFocused();
    } finally {
      await closeElectronApp(app);
    }
  });
});
