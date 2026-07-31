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
  test('names the workspace inline in the hero and opens the picker upward', async ({ launchElectronApp }) => {
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
        },
      });

      // Empty history is what puts Chat into the welcome state.
      await app.evaluate(async ({ app: _app }) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] },
            };
          }
          if (method === 'chat.history') return { success: true, result: { messages: [] } };
          return { success: true, result: {} };
        });
      });

      const page = await getStableWindow(app);
      await page.reload();
      await page.setViewportSize({ width: 1285, height: 820 });

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-welcome-suggestions')).toBeVisible({ timeout: 15_000 });

      const title = page.getByTestId('chat-welcome-title');
      await expect(title).toBeVisible();

      // Hero type ramp: 28px / 400 / -0.3px, wrapping as one centred flex line.
      const titleStyle = await title.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          display: style.display,
          flexWrap: style.flexWrap,
          justifyContent: style.justifyContent,
        };
      });
      expect(titleStyle).toMatchObject({
        fontSize: '28px',
        fontWeight: '400',
        letterSpacing: '-0.3px',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
      });

      // The workspace name is a real control inside the heading, dotted-underlined.
      const trigger = page.getByTestId('welcome-project-trigger');
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toHaveCSS('text-decoration-style', 'dotted');
      await expect(trigger).toHaveCSS('text-underline-offset', '4px');
      await expect(trigger).toHaveCSS('cursor', 'pointer');
      // Inherits the heading ramp rather than restating it.
      await expect(trigger).toHaveCSS('font-size', '28px');

      // The name is part of the sentence, not a separate line.
      const titleLines = await title.evaluate((element) => {
        const host = element as HTMLElement;
        const button = host.querySelector<HTMLElement>('[data-testid="welcome-project-trigger"]');
        return {
          titleHeight: host.getBoundingClientRect().height,
          buttonHeight: button?.getBoundingClientRect().height ?? 0,
        };
      });
      expect(titleLines.buttonHeight).toBeGreaterThan(0);
      expect(titleLines.titleHeight).toBeLessThanOrEqual(titleLines.buttonHeight * 2);

      await trigger.click();

      const menu = page.getByTestId('welcome-project-menu');
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');

      // Shared menu shell: 260px wide, 15px radius, 29px rows at 12.5px radius.
      await expect(menu).toHaveCSS('width', '260px');
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
      expect(Math.abs(rowBox.height - 29)).toBeLessThanOrEqual(1);
      expect(rowBox.radius).toBe('12.5px');
      expect(rowBox.fontSize).toBe('13px');

      /* Opens upward, left edge flush with the trigger (reference: gap 1px,
       * left delta 0). Measured through offset* rather than
       * getBoundingClientRect: the shared shell has a 140ms scale/translate
       * entry animation, and CSS animations do not advance in this harness
       * window, so a rect-based read is permanently offset by the animation's
       * first keyframe (scale .985, translateY -2px) and reports ~4px. The
       * offset* box is the post-layout, pre-transform geometry, which is the
       * thing this assertion is actually about. */
      const placement = await page.evaluate(() => {
        const trigger = document.querySelector<HTMLElement>('[data-testid="welcome-project-trigger"]')!;
        const menu = document.querySelector<HTMLElement>('[data-testid="welcome-project-menu"]')!;
        return {
          // Menu is absolutely positioned inside the trigger's wrapper.
          offsetParentIsWrap: menu.offsetParent === trigger.parentElement,
          gap: -(menu.offsetTop + menu.offsetHeight),
          alignLeftDelta: menu.offsetLeft,
        };
      });
      expect(placement.offsetParentIsWrap).toBe(true);
      expect(Math.abs(placement.gap - 1)).toBeLessThanOrEqual(1);
      expect(Math.abs(placement.alignLeftDelta)).toBeLessThanOrEqual(1);

      // Escape closes without changing the workspace.
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    } finally {
      await closeElectronApp(app);
    }
  });
});
