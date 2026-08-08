/**
 * Plus menu morph verification spec.
 *
 * Launches the built app with IPC mocks, then verifies the morph menu on the
 * composer's plus button (manba #20 "Plus menu morph"):
 *  - clicking the plus morphs the 32px circle into the measured menu panel
 *  - the panel shows the action items (attach / knowledge / more)
 *  - the morph occupies its own layout slot (no overlap with neighbours)
 *  - clicking outside closes; Escape closes
 *  - no console errors
 *
 * Run: pnpm exec playwright test tests/e2e/morph-plus-verify.spec.ts
 */
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const fixedTimestamp = 1_772_000_000_000;

const seededHistory = [
  {
    id: 'morph-user',
    role: 'user',
    content: [{ type: 'text', text: 'Run the morph verification round.' }],
    timestamp: fixedTimestamp - 60_000,
  },
  {
    id: 'morph-assistant',
    role: 'assistant',
    content: [{ type: 'text', text: '### Morph verification\n\nTurn with a run card.' }],
    timestamp: fixedTimestamp,
  },
];

const workspaceSnapshot = {
  profiles: [{
    id: 'workspace-morph',
    name: 'Morph Workspace',
    rootPath: 'C:\\tmp\\morph-workspace',
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: SESSION_KEY,
    permissionMode: 'acceptEdits',
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
    lastOpenedAt: fixedTimestamp,
    state: {},
    sessionStates: {},
  }],
  activeWorkspaceId: 'workspace-morph',
  activeWorkspace: {
    id: 'workspace-morph',
    name: 'Morph Workspace',
    rootPath: 'C:\\tmp\\morph-workspace',
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: SESSION_KEY,
    permissionMode: 'acceptEdits',
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
    lastOpenedAt: fixedTimestamp,
    state: {},
    sessionStates: {},
  },
};

test('plus menu morph expands panel, occupies slot, closes on outside click / Esc', async ({ launchElectronApp }) => {
  test.setTimeout(120_000);
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
      gatewayRpc: {
        [stableStringify(['sessions.list', {}])]: {
          success: true,
          result: { sessions: [{ key: SESSION_KEY, displayName: 'main', status: 'completed', hasActiveRun: false }] },
        },
        [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
          success: true,
          result: { messages: seededHistory },
        },
      },
      hostApi: {
        [stableStringify(['/api/gateway/status', 'GET'])]: {
          ok: true,
          data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345 } },
        },
        [stableStringify(['/api/agents', 'GET'])]: {
          ok: true,
          data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'main' }] } },
        },
        [stableStringify(['workspaces', 'list', null])]: workspaceSnapshot,
        [stableStringify(['workspaces', 'getActive', null])]: workspaceSnapshot,
      },
    });

    const page = await getStableWindow(app);
    page.setDefaultTimeout(20_000);
    try {
      await page.reload();
    } catch (error) {
      if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
    }
    await page.addStyleTag({
      content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }',
    });
    await expect(page.getByTestId('chat-page')).toBeVisible();
    await expect(page.getByTestId('chat-composer-actions')).toBeVisible();

    const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
    await sessionRow.hover();
    await expect(page.getByTestId(`sidebar-session-tooltip-${SESSION_KEY}`)).toBeVisible();
    await expect(page.getByTestId(`sidebar-session-tooltip-branch-${SESSION_KEY}`)).toHaveCount(0);
    await expect(sessionRow).not.toHaveAttribute('title');

    const report: Record<string, unknown> = {};

    // 1. Idle: compact closed circle, plus visible.
    report.idle = await page.evaluate(() => {
      const morph = document.querySelector('[data-testid="chat-composer-morph"]');
      const slot = document.querySelector('[data-testid="chat-composer-morph-slot"]');
      const plus = document.querySelector('[data-testid="chat-composer-actions"]');
      if (!morph || !plus) return { morph: !!morph, plus: !!plus, slot: !!slot };
      const mr = morph.getBoundingClientRect();
      const pr = plus.getBoundingClientRect();
      return {
        open: morph.getAttribute('data-open'),
        morphSize: { w: Math.round(mr.width), h: Math.round(mr.height) },
        morphRect: { x: Math.round(mr.x), y: Math.round(mr.y), right: Math.round(mr.right), bottom: Math.round(mr.bottom) },
        slotRect: (() => {
          const slot = morph.parentElement?.getBoundingClientRect();
          return slot && { x: Math.round(slot.x), y: Math.round(slot.y), right: Math.round(slot.right), bottom: Math.round(slot.bottom) };
        })(),
        borderRadius: getComputedStyle(morph).borderRadius,
        overflow: getComputedStyle(morph).overflow,
        plusVisible: pr.width > 0 && pr.height > 0,
        menuButtons: morph.querySelectorAll('.pm-morph-menu button').length,
        // morph is an absolute overlay on its 40×40 slot
        position: getComputedStyle(morph).position,
        zIndex: getComputedStyle(morph).zIndex,
      };
    });

    // 2. Open: expands to the real item bounds, up and right into the composer.
    const peersBefore = await page.evaluate(() => {
      const row = document.querySelector('.pm-morph-slot')?.parentElement;
      if (!row) return null;
      // peers = the sibling controls in the action row (permission mode etc.)
      return [...row.children].filter((el) => el !== document.querySelector('.pm-morph-slot')).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      });
    });
    await page.getByTestId('chat-composer-actions').click();
    await page.waitForTimeout(600);
    report.open = await page.evaluate(() => {
      const morph = document.querySelector('[data-testid="chat-composer-morph"]');
      if (!morph) return null;
      const mr = morph.getBoundingClientRect();
      const shell = document.querySelector('[data-testid="chat-composer-shell"]')?.getBoundingClientRect();
      const menu = morph.querySelector('.pm-morph-menu');
      const menuStyle = menu ? getComputedStyle(menu) : null;
      return {
        open: morph.getAttribute('data-open'),
        morphSize: { w: Math.round(mr.width), h: Math.round(mr.height) },
        morphRect: { x: Math.round(mr.x), y: Math.round(mr.y), right: Math.round(mr.right), bottom: Math.round(mr.bottom) },
        slotRect: (() => {
          const slot = morph.parentElement?.getBoundingClientRect();
          return slot && { x: Math.round(slot.x), y: Math.round(slot.y), right: Math.round(slot.right), bottom: Math.round(slot.bottom) };
        })(),
        shellRect: shell && { x: Math.round(shell.x), right: Math.round(shell.right) },
        borderRadius: getComputedStyle(morph).borderRadius,
        plusOpacity: getComputedStyle(morph.querySelector('.pm-morph-plus') as HTMLElement).opacity,
        menuOpacity: menuStyle?.opacity ?? null,
        menuPointerEvents: menuStyle?.pointerEvents ?? null,
        ariaExpanded: morph.querySelector('.pm-morph-plus')?.getAttribute('aria-expanded'),
        labels: [...morph.querySelectorAll('.pm-morph-menu button')].map((button) => button.textContent?.trim()),
      };
    });
    report.peersAfter = await page.evaluate(() => {
      const row = document.querySelector('.pm-morph-slot')?.parentElement;
      if (!row) return null;
      return [...row.children].filter((el) => el !== document.querySelector('.pm-morph-slot')).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      });
    });
    report.noLayoutShift = JSON.stringify(peersBefore) === JSON.stringify(report.peersAfter);

    // menu item hit-test (real button on top)
    report.menuHit = await page.evaluate(() => {
      const morph = document.querySelector('[data-testid="chat-composer-morph"]');
      if (!morph) return null;
      const first = morph.querySelector('.pm-morph-menu button');
      if (!first) return null;
      const r = first.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { hitIsButton: !!(hit && first.contains(hit)) };
    });

    await page.screenshot({ path: 'reports/visual-tune/morph-open.png' });

    // 3. Outside click closes
    await page.mouse.click(500, 200);
    await page.waitForTimeout(400);
    report.closedByOutside = await page.evaluate(() => document.querySelector('[data-testid="chat-composer-morph"]')?.getAttribute('data-open'));

    // 4. Reopen, then Escape closes
    await page.getByTestId('chat-composer-actions').click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    report.closedByEsc = await page.evaluate(() => document.querySelector('[data-testid="chat-composer-morph"]')?.getAttribute('data-open'));

    // Focus stays neutral and the main chat surface uses the local tooltip system.
    report.composerFocus = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('[data-testid="chat-composer-shell"]');
      const input = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-composer-input"]');
      if (!shell || !input) return null;
      input.blur();
      const before = getComputedStyle(shell);
      const idle = { border: before.borderColor, shadow: before.boxShadow };
      input.focus();
      const focused = getComputedStyle(shell);
      return {
        idle,
        focused: { border: focused.borderColor, shadow: focused.boxShadow },
        nativeTitleCount: document.querySelectorAll('main [title]').length,
      };
    });

    // 5. "More" item opens the full panel
    await page.getByTestId('chat-composer-actions').click();
    await page.waitForTimeout(400);
    await page.getByTestId('chat-composer-action-more').click();
    await page.waitForTimeout(400);
    report.morePanel = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="chat-composer-actions-menu"]');
      return panel ? { visible: panel.getBoundingClientRect().height > 0 } : null;
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // 6. Console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text().slice(0, 160));
    });
    page.on('pageerror', (err) => errors.push(String(err).slice(0, 160)));
    await page.waitForTimeout(600);
    report.consoleErrors = errors.slice(0, 8);

    console.log('MORPH_VERIFY_REPORT:', JSON.stringify(report, null, 2));

    // Assertions
    expect(report.idle.open).toBe('false');
    expect(report.idle.morphSize.w).toBe(32);
    expect(report.idle.morphSize.h).toBe(32);
    expect(report.idle.borderRadius).toBe('999px');
    expect(report.idle.overflow).toBe('hidden');
    expect(report.idle.menuButtons).toBeGreaterThanOrEqual(3);
    expect(report.idle.position).toBe('absolute');
    expect(report.idle.zIndex).toBe('30');
    expect(report.open.open).toBe('true');
    expect(report.open.morphSize.w).toBeGreaterThan(150);
    expect(report.open.morphSize.h).toBeGreaterThan(90);
    expect(report.open.morphSize.h).toBeLessThanOrEqual(160);
    expect(report.open.borderRadius).toBe('15px');
    expect(report.open.morphRect.x).toBe(report.open.slotRect?.x);
    expect(report.open.morphRect.bottom).toBe(report.open.slotRect?.bottom);
    expect(report.open.morphRect.right).toBeGreaterThan(report.open.slotRect?.right ?? 0);
    expect(report.open.morphRect.x).toBeGreaterThanOrEqual(report.open.shellRect?.x ?? 0);
    expect(report.open.morphRect.right).toBeLessThanOrEqual(report.open.shellRect?.right ?? Number.POSITIVE_INFINITY);
    expect(report.open.morphRect.y).toBeLessThan(report.open.slotRect?.y ?? Number.POSITIVE_INFINITY);
    expect(report.open.labels).toContain('More');
    expect(report.open.labels).not.toContain('composer.actions.more');
    expect(report.open.plusOpacity).toBe('0');
    expect(report.open.menuOpacity).toBe('1');
    expect(report.open.menuPointerEvents).toBe('auto');
    expect(report.open.ariaExpanded).toBe('true');
    expect(report.noLayoutShift).toBe(true);
    expect(report.menuHit?.hitIsButton).toBe(true);
    expect(report.closedByOutside).toBe('false');
    expect(report.closedByEsc).toBe('false');
    expect(report.composerFocus?.focused).toEqual(report.composerFocus?.idle);
    expect(report.composerFocus?.nativeTitleCount).toBe(0);
    expect(report.morePanel?.visible).toBe(true);
    expect(report.consoleErrors).toHaveLength(0);
  } finally {
    await closeElectronApp(app);
  }
});
