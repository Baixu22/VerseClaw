import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function makeWorkspace(id: string, name: string, rootPath: string, lastOpenedAt: number) {
  return {
    id,
    name,
    rootPath,
    agentId: 'main',
    activeSessionKey: 'agent:main:main',
    permissionMode: 'readOnly',
    createdAt: 1,
    updatedAt: lastOpenedAt,
    lastOpenedAt,
    state: {},
  };
}

const WORKSPACES = [
  makeWorkspace('ws-clawx', 'ClawX', 'D:\\work\\ClawX', 200),
  makeWorkspace('ws-verse', 'verseshell', 'D:\\work\\verseshell', 100),
];

/* Geometry is asserted against values measured off the running FakeCoding
 * reference (web/, :5199) with getComputedStyle at 1285x820 in the dark theme,
 * not against the reference's source CSS — several declarations there are
 * overridden by later blocks, so the source and the screen disagree. See the
 * header of src/styles/codex-welcome-hero.css. */
test.describe('FakeCoding chat welcome hero alignment', () => {
  test('names the workspace as a context-row token and opens the shared picker upward', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark' });

    try {
      await installIpcMocks(app, {
        gatewayStatus: {
          state: 'running',
          gatewayReady: true,
          port: 18789,
          pid: 12345,
          connectedAt: Date.now(),
        },
        gatewayRpc: {},
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'main' }] },
            },
          },
          // The hero only names a project when a workspace is active; a fresh
          // E2E profile has none, so seed two to exercise the picker as well.
          [stableStringify(['/api/workspaces', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                profiles: WORKSPACES,
                activeWorkspaceId: 'ws-clawx',
                activeWorkspace: WORKSPACES[0],
              },
            },
          },
          [stableStringify(['/api/workspaces/active', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                profiles: WORKSPACES,
                activeWorkspaceId: 'ws-clawx',
                activeWorkspace: WORKSPACES[0],
              },
            },
          },
          [stableStringify(['git', 'status', null])]: {
            success: true,
            status: {
              isRepository: true,
              branch: 'main',
              detached: false,
              workspaceRoot: 'D:\\work\\ClawX',
              ahead: 0,
              behind: 0,
              clean: true,
              hasConflicts: false,
              changes: [],
              stagedCount: 0,
              unstagedCount: 0,
              untrackedCount: 0,
              conflictedCount: 0,
            },
          },
          [stableStringify(['git', 'branches', null])]: {
            success: true,
            branches: [
              { name: 'main', current: true },
              { name: 'feature/ui-polish', current: false },
            ],
          },
        },
      });

      // Empty history is what puts Chat into the welcome state.
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpcByMethod: {
          'sessions.list': { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } },
          'chat.history': { success: true, result: { messages: [] } },
          '*': { success: true, result: {} },
        },
      });
      const page = await getStableWindow(app);
      await page.reload();
      await page.setViewportSize({ width: 1285, height: 820 });

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-welcome-suggestions')).toBeVisible({ timeout: 15_000 });

      // The workspace name is a real control in the context row under the
      // composer, shaped as a pill to match the branch token beside it. There
      // is no hero heading: the `verse` watermark is the empty state's display
      // type, and a second one competed with it.
      await expect(page.getByTestId('chat-welcome-title')).toHaveCount(0);
      await expect(page.getByTestId('chat-welcome-context')).toBeVisible();

      const trigger = page.getByTestId('welcome-project-trigger');
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toHaveCSS('cursor', 'pointer');
      await expect(trigger).toHaveCSS('border-radius', '10px');

      // The project and branch controls share a compact 32px environment group.
      const triggerBox = await trigger.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          height: (element as HTMLElement).offsetHeight,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          display: style.display,
        };
      });
      expect(Math.abs(triggerBox.height - 26)).toBeLessThanOrEqual(1);
      expect(triggerBox.paddingLeft).toBe('8px');
      expect(triggerBox.paddingRight).toBe('8px');
      expect(triggerBox.display).toBe('flex');

      await trigger.click();

      const menu = page.getByTestId('welcome-project-menu');
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');

      // The welcome and header selectors share this same opaque menu shell.
      await page.waitForTimeout(180);
      await expect(menu).toHaveCSS('width', '288px');
      await expect(menu).toHaveCSS('border-radius', '15px');

      const row = page.getByTestId('welcome-project-item').first();
      await expect(row).toBeVisible();
      // offsetHeight for the same reason as the placement read below.
      const rowBox = await row.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          height: (element as HTMLElement).offsetHeight,
          radius: style.borderTopLeftRadius,
          fontSize: style.fontSize,
        };
      });
      expect(Math.abs(rowBox.height - 40)).toBeLessThanOrEqual(1);
      expect(rowBox.radius).toBe('12.5px');
      expect(rowBox.fontSize).toBe('13px');

      // It remains centred on its trigger, but opens upward to preserve the
      // composer and suggestion controls below it.
      const placement = await page.evaluate(() => {
        const trigger = document.querySelector<HTMLElement>('[data-testid="welcome-project-trigger"]')!;
        const menu = document.querySelector<HTMLElement>('[data-testid="welcome-project-menu"]')!;
        const triggerRect = trigger.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        return {
          offsetParentIsWrap: menu.offsetParent === trigger.parentElement,
          gap: triggerRect.top - menuRect.bottom,
          centreDelta: (menuRect.left + menuRect.width / 2)
            - (triggerRect.left + triggerRect.width / 2),
        };
      });
      expect(placement.offsetParentIsWrap).toBe(true);
      expect(Math.abs(placement.gap - 8)).toBeLessThanOrEqual(1);
      expect(Math.abs(placement.centreDelta)).toBeLessThanOrEqual(1);

      const branchTrigger = page.getByTestId('welcome-branch-trigger');
      await expect(branchTrigger).toBeVisible();
      await branchTrigger.click();
      await expect(page.getByTestId('welcome-branch-menu')).toBeVisible();
      await expect(page.getByTestId('welcome-branch-item-feature-ui-polish')).toBeVisible();

      // Escape closes without changing the workspace.
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    } finally {
      await closeElectronApp(app);
    }
  });
});
