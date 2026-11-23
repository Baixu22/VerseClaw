import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { createHash } from 'node:crypto';

const modelNames = ['deepseek-reasoner', 'grok-4-fast-reasoning', 'qwen/qwen3-coder-480b-a35b-instruct-long-context-preview-with-complete-model-name:free'];
const accounts = modelNames.map((model, index) => ({
  id: `visual-${index}`, vendorId: 'custom', label: `Provider ${index + 1}`, model,
  authMode: 'local', enabled: true, isDefault: index === 0,
  createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z',
}));

// Agent-driven fixtures exercise the production Electron renderer and host facade.
for (const theme of ['light', 'dark'] as const) {
  test(`composer menus share motion, stay in bounds and dismiss accessibly (${theme})`, async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme });
    try {
      const sessionKey = 'agent:main:main';
      const workspace = { id: 'popover-review', name: 'ClawX', rootPath: 'D:/work/ClawX', agentId: 'main', activeSessionKey: sessionKey, permissionMode: 'readOnly', createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {} };
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpcByMethod: {
          'sessions.list': { success: true, result: { sessions: [{ key: sessionKey, displayName: 'Main' }] } },
          'chat.history': { success: true, result: { messages: [] } },
          '*': { success: true, result: {} },
        },
        hostApi: {
          '["agents","list",null]': { success: true, agents: [{ id: 'main', name: 'Main', modelRef: 'custom-visual-0/deepseek-reasoner', modelDisplay: 'deepseek-reasoner', mainSessionKey: sessionKey, reasoningEffort: 'high' }], defaultAgentId: 'main', defaultModelRef: 'custom-visual-0/deepseek-reasoner' },
          '["providers","accounts",null]': accounts,
          '["providers","list",null]': accounts.map((account) => ({ id: account.id, type: 'custom', name: account.label, enabled: true, hasKey: true })),
          '["providers","accountKeyInfo",null]': accounts.map((account) => ({ accountId: account.id, hasKey: true })),
          '["providers","vendors",null]': [],
          '["providers","getDefaultAccount",null]': { accountId: accounts[0].id },
          '["sessions","patchRuntimeModel",null]': { success: true },
          '["workspaces","list",null]': { profiles: [workspace], activeWorkspaceId: workspace.id, activeWorkspace: workspace },
          '["git","status",null]': { success: true, status: { isRepository: true, workspaceRoot: workspace.rootPath, repoRoot: workspace.rootPath, branch: 'feature/cards', detached: false, clean: true, hasConflicts: false, ahead: 0, behind: 0, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0, changes: [] } },
          '["git","branches",null]': { success: true, branches: [{ name: 'feature/cards', current: true }, { name: 'main', current: false }] },
          '["git","worktrees",null]': { success: true, worktrees: [{ path: 'D:/work/ClawX-main', branch: 'main', head: 'abcdef1' }, { path: workspace.rootPath, branch: 'feature/cards', head: '1234567' }] },
        },
      });
      const page = await getStableWindow(app);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const menus = [
        ['chat-composer-permission-mode', 'chat-composer-permission-menu'],
        ['chat-knowledge-scope-button', 'chat-knowledge-scope-menu'],
        ['chat-model-picker-button', 'chat-model-picker-menu'],
      ];
      for (const size of [{ width: 1280, height: 800 }, { width: 760, height: 560 }]) {
        await page.setViewportSize(size);
        await expect.poll(() => page.getByTestId('chat-composer-morph').evaluate((element) => {
          const ring = element.getBoundingClientRect();
          const icon = element.querySelector('.pm-morph-plus svg')!.getBoundingClientRect();
          return Math.max(Math.abs(icon.x + icon.width / 2 - ring.x - ring.width / 2), Math.abs(icon.y + icon.height / 2 - ring.y - ring.height / 2));
        })).toBeLessThan(0.25);
        await page.getByTestId('chat-composer-actions').click();
        await expect(page.getByTestId('chat-composer-morph')).toHaveAttribute('data-open', 'true');
        await expect(page.getByTestId('chat-composer-action-knowledge')).toBeVisible();
        await expect(page.locator('.pm-morph-menu')).toHaveCSS('filter', 'blur(0px)');
        await expect.poll(() => page.getByTestId('chat-composer-morph').evaluate((element) => (
          element.clientWidth >= element.querySelector<HTMLElement>('.pm-morph-menu')!.offsetWidth - 2
        ))).toBe(true);
        if (size.width === 1280) {
          await page.screenshot({ path: testInfo.outputPath(`${theme}-add.png`) });
        }
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('chat-composer-morph')).toHaveAttribute('data-open', 'false');
        for (const [triggerId, menuId] of menus) {
          const trigger = page.getByTestId(triggerId);
          await trigger.click();
          const menu = page.getByTestId(menuId);
          await expect(menu).toHaveAttribute('data-state', 'open');
          await expect(menu).toHaveCSS('filter', 'none');
          await expect(page.locator('.codex-composer-popover[data-state="open"]')).toHaveCount(1);
          await expect(page.getByTestId('chat-composer-morph')).toHaveAttribute('data-open', 'false');
          const rect = await menu.boundingBox();
          expect(rect).not.toBeNull();
          expect(rect!.x).toBeGreaterThanOrEqual(7);
          const toolbar = await page.getByTestId('chat-toolbar-shell').boundingBox();
          expect(rect!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height + 7);
          expect(rect!.x + rect!.width).toBeLessThanOrEqual(size.width - 7);
          expect(rect!.y + rect!.height).toBeLessThanOrEqual(size.height - 7);
          await expect(menu).toHaveCSS('border-radius', '20px');
          await expect(menu).toHaveCSS('backdrop-filter', 'none');
          await page.screenshot({ path: testInfo.outputPath(`${theme}-${size.width}-${menuId}.png`) });
          // Pixel evidence: changing a saturated layer beneath the card must
          // not change any interior pixels, including on software rendering.
          if (size.width === 1280) {
            const clip = { x: rect!.x + 22, y: rect!.y + 22, width: rect!.width - 44, height: rect!.height - 44 };
            await menu.evaluate((element) => {
              const underlay = document.createElement('div');
              underlay.id = 'material-audit-underlay';
              underlay.style.cssText = 'position:absolute;inset:-2000px;background:#ff00ff;z-index:0;pointer-events:none';
              element.parentElement!.prepend(underlay);
            });
            const before = await page.screenshot({ clip, animations: 'disabled' });
            await page.locator('#material-audit-underlay').evaluate((element) => { element.style.background = '#00ff00'; });
            const after = await page.screenshot({ clip, animations: 'disabled' });
            await page.locator('#material-audit-underlay').evaluate((element) => element.remove());
            expect(createHash('sha256').update(before).digest('hex')).toBe(createHash('sha256').update(after).digest('hex'));
          }
          if (menuId === 'chat-knowledge-scope-menu') {
            const search = page.getByTestId('chat-knowledge-search-input');
            await search.scrollIntoViewIfNeeded();
            await expect(search).toBeInViewport();
            await search.fill('design');
            await expect(page.getByTestId('chat-knowledge-search-submit')).toBeEnabled();
            await expect(menu).toHaveAttribute('data-side', 'top');
            await page.screenshot({ path: testInfo.outputPath(`${theme}-${size.width}-knowledge-search.png`) });
          }
          if (menuId === 'chat-model-picker-menu') {
            await expect(page.getByTestId('chat-model-scope-selector')).toHaveCount(0);
            await expect(page.getByTestId('chat-model-options')).toBeVisible();
            await expect(page.getByTestId('chat-model-options').getByRole('button').first()).toBeVisible();
            await expect(page.getByTestId('chat-model-options')).toHaveCSS('filter', 'none');
            await expect(page.getByTestId('chat-model-options')).toHaveCSS('opacity', '1');
            await expect(menu.locator('[data-brand="deepseek"]')).toBeVisible();
            await expect(menu.locator('[data-brand="grok"]')).toBeVisible();
            const longName = menu.locator('.codex-model-option__name').filter({ hasText: 'qwen3-coder' });
            await longName.scrollIntoViewIfNeeded();
            expect(await longName.evaluate((element) => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1)).toBe(true);
            await expect(page.getByTestId('chat-model-picker-label')).toBeVisible();
            await expect(page.getByTestId('chat-model-picker-label')).toHaveCSS('white-space', 'nowrap');
            await page.screenshot({ path: testInfo.outputPath(`${theme}-${size.width}-model-options.png`) });
            await longName.click();
            await expect(menu).toHaveCount(0);
            await expect(page.getByTestId('chat-model-picker-label')).toHaveText(modelNames[2].split('/').at(-1)!);
            expect(await page.getByTestId('chat-model-picker-button').getAttribute('title')).toContain(modelNames[2]);
            await expect(page.getByTestId('chat-model-picker-label')).toBeVisible();
            const labelBox = await page.getByTestId('chat-model-picker-label').evaluate(element => {
              const css = getComputedStyle(element);
              return { height: element.getBoundingClientRect().height, lineHeight: parseFloat(css.lineHeight),
                overflow: css.overflow, ellipsis: css.textOverflow, clipped: element.scrollWidth > element.clientWidth };
            });
            expect(labelBox.height).toBeLessThanOrEqual(labelBox.lineHeight + 1);
            expect(labelBox).toMatchObject({ overflow: 'hidden', ellipsis: 'ellipsis', clipped: true });
            await page.screenshot({ path: testInfo.outputPath(`${theme}-${size.width}-selected-long-model.png`) });
          }
        }
        await page.keyboard.press('Escape');
        await expect(page.locator('.codex-composer-popover')).toHaveCount(0);
        await expect(page.getByTestId('chat-composer-input')).toBeFocused();
      }
      // Sample real frames: an opening menu resolves blur, and its closing
      // surface becomes inert immediately while the reverse transition runs.
      const motion = await page.evaluate(async () => {
        const button = document.querySelector<HTMLButtonElement>('[data-testid="chat-knowledge-scope-button"]')!;
        const sample = async (phase: 'opening' | 'closing') => {
          const frames: Array<{ time: number; filter: string; opacity: number; state: string | undefined; inert: boolean; pointerEvents: string }> = [];
          const start = performance.now();
          do {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const panel = document.querySelector<HTMLElement>('[data-testid="chat-knowledge-scope-menu"]');
            if (panel) {
              const style = getComputedStyle(panel);
              frames.push({ time: performance.now() - start, filter: style.filter, opacity: Number(style.opacity), state: panel.dataset.state, inert: panel.inert, pointerEvents: style.pointerEvents });
              if (phase === 'opening' && style.filter === 'none' && Number(style.opacity) === 1) break;
            } else if (phase === 'closing') {
              break;
            }
          } while (performance.now() - start < 1500);
          return frames;
        };
        button.click();
        const opening = await sample('opening');
        button.click();
        const closing = await sample('closing');
        return { opening, closing };
      });
      await testInfo.attach('menu-motion-frames', { body: JSON.stringify(motion, null, 2), contentType: 'application/json' });
      expect(motion.opening.some((frame) => frame.filter.startsWith('blur(') && parseFloat(frame.filter.slice(5)) > 0)).toBe(true);
      expect(motion.opening.at(-1)?.filter).toBe('none');
      expect(motion.closing.length).toBeGreaterThan(0);
      expect(motion.closing.every((frame) => frame.inert && frame.state === 'closed' && frame.pointerEvents === 'none')).toBe(true);
      // Reopening during exit must cancel that exit and preserve the live menu.
      await page.evaluate(async () => {
        const button = document.querySelector<HTMLButtonElement>('[data-testid="chat-knowledge-scope-button"]')!;
        button.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        button.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        button.click();
      });
      await expect(page.getByTestId('chat-knowledge-scope-menu')).toHaveAttribute('data-state', 'open');
      await expect(page.getByTestId('chat-knowledge-scope-menu')).not.toHaveAttribute('inert');
      await expect(page.getByTestId('chat-knowledge-scope-menu')).toHaveCSS('filter', 'none');
      await page.keyboard.press('Escape');
      await expect(page.locator('.codex-composer-popover')).toHaveCount(0);
      const trigger = page.getByTestId('chat-knowledge-scope-button');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('chat-knowledge-scope-menu')).toHaveCSS('filter', 'none');
      // The centered welcome input can sit behind the open menu. Click the
      // empty titlebar area, which is outside both the trigger and the panel.
      await page.mouse.click(8, 8);
      await expect(page.getByTestId('chat-knowledge-scope-menu')).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByTestId('chat-agent-effort-button').click();
      await expect(page.getByTestId('chat-agent-effort-slider')).toBeVisible();
      await expect(page.getByTestId('chat-agent-effort-slider')).toBeInViewport();
      await expect(page.getByTestId('chat-model-picker-menu')).toHaveCSS('transform', 'none');
      await expect(page.getByTestId('chat-model-picker-menu')).toHaveCSS('filter', 'none');
      await page.screenshot({ path: testInfo.outputPath(`${theme}-reasoning-reduced-motion.png`) });
      await page.keyboard.press('Escape');
      for (const size of [{ width: 1280, height: 800 }, { width: 760, height: 560 }]) {
        await page.setViewportSize(size);
        await expect(page.getByTestId('welcome-branch-trigger')).toHaveCount(0);
        await page.getByTestId('welcome-project-trigger').click();
        const projectMenu = page.getByTestId('welcome-project-menu');
        await expect(projectMenu).toBeInViewport();
        await expect(projectMenu).toHaveCSS('backdrop-filter', 'none');
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${size.width}-welcome-project-menu.png`) });
        await page.keyboard.press('Escape');
        const worktreeTrigger = page.getByTestId('session-worktree-trigger');
        await expect(worktreeTrigger).toHaveAttribute('data-git-kind', 'worktree');
        await worktreeTrigger.click();
        const worktreeMenu = page.getByTestId('session-worktree-menu');
        await expect(worktreeMenu).toBeInViewport();
        await expect(projectMenu).toHaveCount(0);
        await expect.poll(() => worktreeMenu.evaluate((element) => element.parentElement?.id)).toBe('app-overlay-root');
        await expect(worktreeMenu).toHaveCSS('backdrop-filter', 'none');
        await expect(worktreeMenu.getByTestId('session-worktree-option-1')).toBeDisabled();
        await expect(worktreeMenu.getByTestId('session-worktree-option-0')).toBeEnabled();
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${size.width}-session-worktree-menu.png`) });
        await worktreeMenu.getByTestId('session-worktree-create').click();
        await worktreeMenu.getByTestId('session-worktree-branch').fill('codex/visible-worktree');
        const submit = worktreeMenu.getByTestId('session-worktree-submit');
        await expect(worktreeMenu).toHaveCSS('overflow-y', 'auto');
        await submit.scrollIntoViewIfNeeded();
        await expect(submit).toBeInViewport();
        const geometry = await worktreeMenu.evaluate((menu) => {
          const bounds = menu.getBoundingClientRect();
          const action = menu.querySelector<HTMLElement>('[data-testid="session-worktree-submit"]')!.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom,
            actionTop: action.top, actionBottom: action.bottom };
        });
        expect(geometry.x).toBeGreaterThanOrEqual(7);
        expect(geometry.y).toBeGreaterThanOrEqual(7);
        expect(geometry.right).toBeLessThanOrEqual(size.width - 7);
        expect(geometry.bottom).toBeLessThanOrEqual(size.height - 7);
        expect(geometry.actionTop).toBeGreaterThanOrEqual(geometry.y);
        expect(geometry.actionBottom).toBeLessThanOrEqual(geometry.bottom + 1);
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${size.width}-session-worktree-create.png`) });
        await page.keyboard.press('Escape');
        await expect(worktreeMenu).toHaveCount(0);
        await expect(worktreeTrigger).toBeFocused();
        await expect(projectMenu).toHaveCount(0);
      }
    } finally {
      await closeElectronApp(app);
    }
  });
}


test('touch composer targets fit at 375px and the closed add menu skips its actions', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await page.setViewportSize({ width: 375, height: 812 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await installIpcMocks(app, { gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 } });
    await page.reload();
    await expect.poll(() => page.getByTestId('sidebar').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBeLessThanOrEqual(64);
    const add = page.getByTestId('chat-composer-actions');
    const first = page.getByTestId('chat-composer-action-attach-files');
    const buttons = ['chat-composer-actions', 'chat-composer-permission-mode', 'chat-knowledge-scope-button', 'chat-model-picker-button', 'chat-composer-send'];
    for (const id of buttons) {
      const control = page.getByTestId(id);
      await expect(control).toBeVisible();
      const box = await control.evaluate(el => el.getBoundingClientRect().toJSON());
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.top).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
    await add.focus(); await page.keyboard.press('Enter');
    await expect(first).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(add).toBeFocused();
    await expect(first.locator('..')).toHaveAttribute('inert', '');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('chat-composer-permission-mode')).toBeFocused();
  } finally { await closeElectronApp(app); }
});
