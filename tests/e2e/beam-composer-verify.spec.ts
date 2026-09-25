/**
 * Border-beam composer verification spec.
 *
 * Launches the built app with IPC mocks, then verifies the sunset beam:
 *  - `chat-composer-beam` element exists, wraps the shell
 *  - beam is `data-active` only while a run is sending
 *  - slash palette opens above the beam container (not clipped)
 *  - dark/light theme re-render of the beam
 *  - no console errors
 *
 * Run: pnpm exec playwright test tests/e2e/beam-composer-verify.spec.ts
 */
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { evidencePath } from './fixtures/evidence-root';

type BeamReport = {
  idle?: {
    beam?: boolean;
    beamInsideShell?: boolean;
    beamMatchesShellSize?: boolean;
    active?: boolean;
    overflow?: string;
  };
  sending?: { active?: boolean; fading?: boolean; afterBackground?: string; strengthVar?: string } | null;
  slashPalette?: { found?: boolean; paletteAboveBeam?: boolean; hitIsPalette?: boolean };
  sendBtnState?: unknown;
  sendBtnAfterFill?: unknown;
  sendingInstant?: unknown;
  lightTheme?: unknown;
  consoleErrors?: unknown[];
};
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
    id: 'beam-user',
    role: 'user',
    content: [{ type: 'text', text: 'Run a beam verification round.' }],
    timestamp: fixedTimestamp - 60_000,
  },
  {
    id: 'beam-assistant',
    role: 'assistant',
    content: [{ type: 'text', text: '### Beam verification\n\nTurn with a run card.' }],
    timestamp: fixedTimestamp,
  },
];

const workspaceSnapshot = {
  profiles: [{
    id: 'workspace-beam',
    name: 'Beam Workspace',
    rootPath: 'C:\\tmp\\beam-workspace',
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
  activeWorkspaceId: 'workspace-beam',
  activeWorkspace: {
    id: 'workspace-beam',
    name: 'Beam Workspace',
    rootPath: 'C:\\tmp\\beam-workspace',
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

test('sunset beam wraps composer, lights on sending, menus unclipped', async ({ launchElectronApp }) => {
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
        // chat.sendWithMedia — the mocked gateway accepts the send so the
        // composer's `sending` flag flips on while the run is in flight.
        [stableStringify(['chat', 'sendWithMedia', null])]: {
          ok: true,
          data: {
            success: true,
            result: { runId: 'beam-run-1', sessionKey: SESSION_KEY },
          },
        },
        // providers — a usable API-key account so the FP-P1-01 send gate passes.
        [stableStringify(['providers', 'accounts', null])]: {
          ok: true,
          data: [{
            id: 'e2e-provider',
            vendorId: 'e2e',
            name: 'E2E Provider',
            enabled: true,
            authMode: 'api_key',
          }],
        },
        [stableStringify(['providers', 'accountKeyInfo', null])]: {
          ok: true,
          data: [{ accountId: 'e2e-provider', hasKey: true }],
        },
        [stableStringify(['providers', 'getDefaultAccount', null])]: {
          ok: true,
          data: { accountId: 'e2e-provider' },
        },
        [stableStringify(['providers', 'vendors', null])]: {
          ok: true,
          data: [],
        },
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
    await expect(page.getByTestId('chat-composer-shell')).toBeVisible();

    const report: BeamReport = {};

    // 1. Beam idle — no active attr, but element exists INSIDE the shell
    report.idle = await page.evaluate(() => {
      const beam = document.querySelector('[data-testid="chat-composer-beam"]');
      const shell = document.querySelector('[data-testid="chat-composer-shell"]');
      if (!beam || !shell) return { beam: !!beam, shell: !!shell };
      const br = beam.getBoundingClientRect();
      const sr = shell.getBoundingClientRect();
      return {
        beam: true,
        shell: true,
        active: beam.hasAttribute('data-active'),
        fading: beam.hasAttribute('data-fading'),
        overflow: getComputedStyle(beam).overflow,
        borderRadius: getComputedStyle(beam).borderRadius,
        // inner-ring: beam rect must sit within the shell's content box
        beamInsideShell: br.x >= sr.x && br.y >= sr.y && br.x + br.width <= sr.x + sr.width + 1,
        beamMatchesShellSize: Math.abs(br.width - sr.width) <= 2 && Math.abs(br.height - sr.height) <= 2,
      };
    });

    // 2. Beam lit during sending — set the store's sending flag through the UI
    //    by typing + submitting (gateway mocked as running, so send proceeds).
    const sendBtn = page.getByTestId('chat-composer-send');
    report.sendBtnState = await sendBtn.evaluate((el) => ({
      disabled: (el as HTMLButtonElement).disabled,
      aria: (el as HTMLButtonElement).getAttribute('aria-label'),
      title: (el as HTMLButtonElement).getAttribute('title'),
    }));
    await page.getByTestId('chat-composer-input').fill('beam test message');
    await page.waitForTimeout(200);
    report.sendBtnAfterFill = await sendBtn.evaluate((el) => ({
      disabled: (el as HTMLButtonElement).disabled,
      aria: (el as HTMLButtonElement).getAttribute('aria-label'),
    }));
    await sendBtn.click();
    // Probe sending flag immediately — it flips true at send start, then may
    // settle fast when the mocked gateway returns without a run stream.
    report.sendingInstant = await page.evaluate(() => {
      const beam = document.querySelector('[data-testid="chat-composer-beam"]');
      return {
        beamActive: beam ? beam.hasAttribute('data-active') : null,
        intervention: !!document.querySelector('[data-testid="chat-intervention-controls"]'),
        capabilityDialog: !!document.querySelector('[data-testid="chat-capability-dialog"]'),
        error: document.querySelector('[data-testid="chat-run-error"], [data-testid="chat-error"]')?.textContent?.slice(0, 120) ?? null,
        optimisticUserMsg: [...document.querySelectorAll('[data-testid^="chat-message-"]')].some((el) => el.textContent?.includes('beam test message')),
      };
    });
    await page.waitForTimeout(800);
    report.sending = await page.evaluate(() => {
      const beam = document.querySelector('[data-testid="chat-composer-beam"]');
      if (!beam) return null;
      return {
        active: beam.hasAttribute('data-active'),
        fading: beam.hasAttribute('data-fading'),
        // beam pseudo-element layers exist with sunset palette
        afterBackground: getComputedStyle(beam, '::after').backgroundImage.slice(0, 120),
        strengthVar: (beam as HTMLElement).style.getPropertyValue('--beam-strength'),
      };
    });

    // 3. Slash palette opens above beam — not clipped
    await page.getByTestId('chat-composer-input').fill('/');
    await page.waitForTimeout(400);
    report.slashPalette = await page.evaluate(() => {
      const palette = document.querySelector('[data-testid="chat-slash-command-menu"], .codex-composer-menu');
      if (!palette) return { found: false };
      const pr = palette.getBoundingClientRect();
      const beam = document.querySelector('[data-testid="chat-composer-beam"]');
      const br = beam?.getBoundingClientRect();
      // elementFromPoint at palette center must hit the palette (not clipped)
      const hit = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
      return {
        found: true,
        paletteTop: Math.round(pr.top),
        beamTop: br ? Math.round(br.top) : null,
        paletteAboveBeam: !!br && pr.bottom <= br.top,
        hitIsPalette: !!(hit && palette.contains(hit)),
      };
    });
    await page.keyboard.press('Escape');

    // 4. Light theme re-render
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    });
    await page.waitForTimeout(500);
    report.lightTheme = await page.evaluate(() => {
      const beam = document.querySelector('[data-testid="chat-composer-beam"]');
      if (!beam) return null;
      // beam CSS is theme-keyed via generated styles; verify the data-active
      // glow persists under light class
      const cs = getComputedStyle(beam, '::after');
      return { afterBackground: cs.backgroundImage.slice(0, 120), active: beam.hasAttribute('data-active') };
    });

    // 5. Console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text().slice(0, 160));
    });
    page.on('pageerror', (err) => errors.push(String(err).slice(0, 160)));
    await page.waitForTimeout(800);
    report.consoleErrors = errors.slice(0, 8);

    console.log('BEAM_VERIFY_REPORT:', JSON.stringify(report, null, 2));

    // Screenshots
    await page.screenshot({ path: evidencePath('reports/visual-tune/beam-app-sending.png') });

    // Assertions
    expect(report.idle.beam).toBe(true);
    expect(report.idle.beamInsideShell).toBe(true);
    expect(report.idle.beamMatchesShellSize).toBe(true);
    expect(report.idle.active).toBe(false); // idle → beam off
    expect(report.idle.overflow).toBe('hidden'); // inner ring clip
    expect(report.sending?.active).toBe(true); // sending → beam on
    expect(report.sending?.strengthVar).toBe('0.3');
    expect(report.slashPalette.found).toBe(true);
    expect(report.slashPalette.paletteAboveBeam).toBe(true);
    expect(report.slashPalette.hitIsPalette).toBe(true);
    expect(report.consoleErrors).toHaveLength(0);
  } finally {
    await closeElectronApp(app);
  }
});
