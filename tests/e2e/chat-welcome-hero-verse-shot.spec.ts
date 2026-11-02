/**
 * Screenshot harness for the verse-style chat welcome hero, plus the one
 * behavioural contract screenshots cannot express (chip retraction).
 *
 * The `verse welcome hero screenshot` tests are not assertion specs — they
 * exist to produce reviewable PNGs of the empty state (dark + light) for
 * design audit. Reference-geometry contracts live in
 * chat-welcome-hero-fakecoding.spec.ts; nothing here should duplicate them.
 *
 * Output goes to .design-staging/verse-hero/.
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  closeElectronApp,
  expect,
  getStableWindow,
  installIpcMocks,
  test,
} from './fixtures/electron';
import { evidencePath } from './fixtures/evidence-root';

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

// The context row only renders a branch chip when git reports a repository.
// Long enough on purpose: the row's 24-char truncation is part of what the
// screenshot is meant to show.
const GIT_STATUS = {
  success: true,
  status: {
    isRepository: true,
    branch: 'codex/ui-polish-verse-hero',
    detached: false,
    clean: false,
    hasConflicts: false,
    stagedCount: 2,
    unstagedCount: 3,
    untrackedCount: 1,
    conflictedCount: 0,
    repoRoot: 'D:\\work\\ClawX',
    workspaceRoot: 'D:\\work\\ClawX',
  },
};

function mocks() {
  return {
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
        data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'main' }] } },
      },
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
      // hostApi.git.status() -> invokeHost('git', 'status') with no payload.
      [stableStringify(['git', 'status', null])]: GIT_STATUS,
      [stableStringify(['git', 'capabilities', null])]: {
        success: true,
        capabilities: { git: true, gh: false },
      },
      [stableStringify(['git', 'branches', null])]: {
        success: true,
        branches: [
          { name: 'codex/ui-polish-verse-hero', current: true },
          { name: 'main', current: false },
        ],
      },
      [stableStringify(['git', 'worktrees', null])]: { success: true, worktrees: [] },
    },
  };
}

async function seedEmptyHistory(app: Parameters<typeof installIpcMocks>[0]) {
  await app.evaluate(async () => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
  });
}

const OUT_DIR = resolve(evidencePath('.design-staging/verse-hero'));

for (const theme of ['dark', 'light'] as const) {
  test(`verse welcome hero screenshot — ${theme}`, async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme });

    try {
      await installIpcMocks(app, mocks());
      await seedEmptyHistory(app);

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
      await expect(page.getByTestId('chat-welcome-context')).toBeVisible();

      // Entry animations are 200-600ms staggered; settle before capturing.
      await page.waitForTimeout(1200);

      await mkdir(OUT_DIR, { recursive: true });
      await page.screenshot({ path: join(OUT_DIR, `welcome-${theme}.png`), fullPage: false });

      // Second frame: composer focused, so the audit can see the focus ring and
      // the placeholder/toolbar state as well as the resting hero.
      await page.getByTestId('chat-composer-shell').click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT_DIR, `welcome-${theme}-focused.png`), fullPage: false });

      // Third frame: draft typed, so the audit can see the retracted chip row
      // and confirm the composer did not shift when the chips left.
      await page.keyboard.type('refactor the run loop');
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(OUT_DIR, `welcome-${theme}-drafting.png`), fullPage: false });
    } finally {
      await closeElectronApp(app);
    }
  });
}

/* The one behavioural contract the screenshots cannot express: the chips leave
 * while the composer holds text and come back when it is cleared, without the
 * composer moving. Lives here rather than in the fakecoding spec because it is
 * about this build's interaction, not about matching reference geometry. */
test('chips retract while the composer holds a draft and return when it is cleared', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'dark' });

  try {
    await installIpcMocks(app, mocks());
    await seedEmptyHistory(app);

    const page = await getStableWindow(app);
    await page.reload();
    await page.setViewportSize({ width: 1285, height: 820 });

    const chips = page.getByTestId('chat-welcome-suggestions');
    await expect(chips).toBeVisible({ timeout: 15_000 });
    await expect(chips).not.toHaveAttribute('data-retracted', 'true');

    const composerTop = async () => {
      const box = await page.getByTestId('chat-composer-shell').boundingBox();
      return box?.y ?? -1;
    };
    const restingTop = await composerTop();
    expect(restingTop).toBeGreaterThan(0);

    await page.getByTestId('chat-composer-shell').click();
    await page.keyboard.type('refactor the run loop');
    await expect(chips).toHaveAttribute('data-retracted', 'true');

    // Stagger is 110ms + a 260ms fade; settle past both before reading.
    await page.waitForTimeout(700);
    const firstChip = page.getByTestId('chat-welcome-suggestions').locator('button').first();
    await expect(firstChip).toBeHidden();

    // The row keeps its box, so the composer above it must not have moved.
    expect(Math.abs((await composerTop()) - restingTop)).toBeLessThanOrEqual(1);

    // Clearing the draft brings them back.
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await expect(chips).not.toHaveAttribute('data-retracted', 'true');
    await expect(firstChip).toBeVisible();
    expect(Math.abs((await composerTop()) - restingTop)).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 600, height: 820 });
    await expect(chips.locator('button:visible')).toHaveCount(2);

    await page.setViewportSize({ width: 400, height: 820 });
    await expect(chips.locator('button:visible')).toHaveCount(1);
  } finally {
    await closeElectronApp(app);
  }
});
