/**
 * Orb visual verification spec — launches the built app with IPC mocks,
 * seeds a rich assistant turn, and verifies:
 *  - 64px TurnSummaryCard orb + tooltip on hover
 *  - 20px OrbStatus rows (tool rows, stream status)
 *  - dark/light ink re-render + no position breakage
 *  - console errors
 *
 * Run: pnpm exec playwright test tests/e2e/orb-visual-verify.spec.ts
 */
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

type OrbReport = {
  canvases?: { total?: number };
  summary?: { orbInsideScrollX?: boolean; canvas?: { w?: number; h?: number } | null; orb?: unknown; card?: unknown; scroll?: unknown };
  inkDark?: { gray?: unknown[]; drawnPixels?: number } | null;
  inkLight?: { gray?: unknown[]; drawnPixels?: number } | null;
  tooltip?: unknown;
  sidebarOrb?: { count?: number };
  inline20px?: { count?: number } | null;
  consoleErrors?: unknown[];
};

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
    id: 'orb-verify-user',
    role: 'user',
    content: [{ type: 'text', text: 'Run the verification round.' }],
    timestamp: fixedTimestamp - 60_000,
  },
  {
    id: 'orb-verify-assistant',
    role: 'assistant',
    content: [{
      type: 'text',
      text: '### Orb verification\n\nThis turn carries a run card so the TurnSummaryCard head renders with its 64px orb.',
    },
    {
      type: 'tool_use',
      id: 'tool-orb-1',
      name: 'bash',
      input: { command: 'echo orb' },
    }],
    timestamp: fixedTimestamp,
  },
  {
    id: 'orb-verify-tool-result',
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: 'tool-orb-1',
      content: 'orb',
    }],
    timestamp: fixedTimestamp + 1000,
  },
];

const workspaceSnapshot = {
  profiles: [{
    id: 'workspace-orb',
    name: 'Orb Workspace',
    rootPath: 'C:\\tmp\\orb-workspace',
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
  activeWorkspaceId: 'workspace-orb',
  activeWorkspace: {
    id: 'workspace-orb',
    name: 'Orb Workspace',
    rootPath: 'C:\\tmp\\orb-workspace',
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

const liveUsage = {
  success: true,
  usage: {
    sessionKey: SESSION_KEY,
    runId: null,
    inputTokens: 1200,
    outputTokens: 345,
    cacheReadTokens: 80,
    cacheWriteTokens: 20,
    totalTokens: 1645,
    estimatedCostUsd: 0.0123,
    updatedAt: fixedTimestamp,
    status: 'final',
  },
};

const contextRange = {
  success: true,
  range: {
    sessionKey: SESSION_KEY,
    modelRef: null,
    maxTokens: 8000,
    usedTokens: 1645,
    visibleMessageStartIndex: 0,
    visibleMessageEndIndex: 0,
    retainedMessageCount: 1,
    truncatedMessageCount: 0,
    summarizedMessageCount: 0,
    status: 'bestEffort',
  },
};

test('orbs render on turn-summary head with tooltip, both themes', async ({ launchElectronApp }) => {
  test.setTimeout(120_000);
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
      gatewayRpc: {
        [stableStringify(['sessions.list', {}])]: {
          success: true,
          result: { sessions: [{ key: SESSION_KEY, displayName: 'main', status: 'running', hasActiveRun: true }] },
        },
        [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
          success: true,
          result: { messages: seededHistory },
        },
        [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
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
        [stableStringify(['workspaces', 'saveState', { id: 'workspace-orb', sessionKey: SESSION_KEY, state: {} }])]: { success: true },
        [stableStringify(['usage', 'live', { sessionKey: SESSION_KEY, runId: null, streaming: false }])]: liveUsage,
        [stableStringify(['usage', 'contextRange', { sessionKey: SESSION_KEY, modelRef: null, messageCount: 1, usedTokens: null }])]: contextRange,
        [stableStringify(['usage', 'contextRange', { sessionKey: SESSION_KEY, modelRef: null, messageCount: 1, usedTokens: 1645 }])]: contextRange,
      },
    });

    const page = await getStableWindow(app);
    page.setDefaultTimeout(20_000);
    try {
      await page.reload();
    } catch (error) {
      if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
    }
    // Kill animations for stable sampling
    await page.addStyleTag({
      content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }',
    });
    await expect(page.getByTestId('chat-page')).toBeVisible();

    // The orb is the run's live "working" indicator, so it only renders while a
    // run is actually open (TurnSummaryCard gates it on status === 'running').
    // Arm the seeded turn with a live runtime run the way the app does — a
    // `run.started` event over the runtime-event channel — so the head shows the
    // working orb. Seeding history alone leaves the turn settled (no orb), which
    // is correct product behaviour on reload.
    await app.evaluate(({ BrowserWindow }, identity) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('chat:runtime-event', { ...identity, type: 'run.started', startedAt: Date.now() });
      }
    }, { runId: 'orb-run', sessionKey: SESSION_KEY });

    await expect(page.getByTestId('chat-turn-summary-orb').first()).toBeVisible();

    const report: OrbReport = {};

    report.canvases = await page.evaluate(() => ({
      total: document.querySelectorAll('canvas[role="img"]').length,
      sizes: [...document.querySelectorAll('canvas[role="img"]')].map((c) => {
        const r = c.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
    }));

    report.summary = await page.evaluate(() => {
      const orb = document.querySelector('[data-testid="chat-turn-summary-orb"]');
      const r = orb?.getBoundingClientRect();
      const canvas = orb?.querySelector('canvas')?.getBoundingClientRect();
      const card = document.querySelector('[data-testid="chat-turn-summary-card"]')?.getBoundingClientRect();
      const scroll = document.querySelector('[data-testid="chat-scroll-container"]')?.getBoundingClientRect();
      return {
        orb: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
        canvas: canvas ? { w: Math.round(canvas.width), h: Math.round(canvas.height) } : null,
        card: card ? { x: Math.round(card.x), y: Math.round(card.y), w: Math.round(card.width), h: Math.round(card.height) } : null,
        scroll: scroll ? { x: Math.round(scroll.x), y: Math.round(scroll.y), w: Math.round(scroll.width), h: Math.round(scroll.height) } : null,
        orbInsideScrollX: !!(r && scroll && r.x >= scroll.x && r.x + r.width <= scroll.x + scroll.width),
      };
    });

    // Ink sample (dark) — the 64px orb canvas pixels
    const sampleInk = () => page.evaluate(() => {
      const c = document.querySelector('[data-testid="chat-turn-summary-orb"] canvas');
      if (!c) return null;
      const canvasEl = c as HTMLCanvasElement;
      const ctx = canvasEl.getContext('2d');
      if (!ctx) return { drawnPixels: 0, gray: [] as number[] };
      const d = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height).data;
      const gray = new Set();
      let drawn = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 100) {
          drawn++;
          gray.add(d[i]);
          if (gray.size > 4) break;
        }
      }
      return { drawnPixels: drawn, gray: [...gray] };
    });

    report.inkDark = await sampleInk();
    await page.screenshot({ path: 'reports/visual-tune/orbs-app-dark.png' });

    // Tooltip on the 64px orb
    await page.getByTestId('chat-turn-summary-orb').first().hover();
    await page.waitForTimeout(500);
    report.tooltip = await page.evaluate(() => {
      const t = document.querySelector('[role="tooltip"]');
      return t ? t.textContent : null;
    });

    // A 20px inline orb — the sidebar session status dot renders an OrbStatus
    // (size 20 preset) per session. It appears after sessions.list is resolved.
    report.sidebarOrb = await page.evaluate(() => {
      const c = [...document.querySelectorAll('canvas[role="img"]')].find((el) => {
        const r = el.getBoundingClientRect();
        return Math.round(r.width) === 20;
      });
      if (!c) return { count: 0 };
      const r = c.getBoundingClientRect();
      const canvasEl = c as HTMLCanvasElement;
      const ctx = canvasEl.getContext('2d');
      if (!ctx) return { drawnPixels: 0, gray: [] as number[] };
      const d = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height).data;
      let drawn = 0;
      const gray = new Set();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 100) {
          drawn++;
          gray.add(d[i]);
        }
      }
      // Where does the 20px orb live? (side bar row / chat header / status)
      const ancestorChain = (() => {
        let el = c.parentElement as HTMLElement | null;
        const out: string[] = [];
        for (let i = 0; i < 5 && el; i++) {
          out.push(el.getAttribute('data-testid') || el.tagName.toLowerCase());
          el = el.parentElement;
        }
        return out;
      })();
      return {
        count: 1,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        drawn, gray: [...gray].slice(0, 4),
        ancestors: ancestorChain,
        inSidebar: !!document.querySelector('.codex-sidebar, [data-testid="sidebar"]')?.contains(c),
      };
    });
    report.inline20px = report.sidebarOrb.count === 1 ? report.sidebarOrb : null;

    // Light theme re-render
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    });
    await page.waitForTimeout(800);
    report.inkLight = await sampleInk();
    await page.screenshot({ path: 'reports/visual-tune/orbs-app-light.png' });

    // Console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text().slice(0, 160));
    });
    page.on('pageerror', (err) => errors.push(String(err).slice(0, 160)));
    await page.waitForTimeout(1200);
    report.consoleErrors = errors.slice(0, 8);

    console.log('ORB_VERIFY_REPORT:', JSON.stringify(report, null, 2));

    // Assertions
    expect(report.canvases.total).toBeGreaterThan(0);
    expect(report.summary.orbInsideScrollX).toBe(true);
    expect(report.summary.canvas?.w).toBeLessThan(64); // md = 28px, not the oversized 64
    expect(report.inkDark?.gray?.length).toBeGreaterThan(0);
    expect(report.inkLight?.gray?.length).toBeGreaterThan(0);
    expect(report.tooltip).toBeTruthy();
    expect(report.tooltip).not.toContain('·');
    expect(report.consoleErrors).toHaveLength(0);
  } finally {
    await closeElectronApp(app);
  }
});
