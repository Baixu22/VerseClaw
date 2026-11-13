import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import type { CronJob } from '@shared/types/cron';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, pinWindowContentSize, test } from './fixtures/electron';

const SESSION = 'agent:main:main';
const OTHER = 'agent:main:rareui-review';
const ROOT = 'D:/tmp/rareui-fixture-project';
const artifacts = process.env.CLAWX_RAREUI_ARTIFACTS_DIR
  || join(process.env.CLAWX_E2E_RUN_ROOT || 'D:/tmp', 'rareui-interactions', 'screenshots');
const now = Date.parse('2026-10-21T05:30:00Z');
const markdown = [
  '# Workspace interaction guide',
  'A quiet reading surface with a circular progress control and a stepped document outline.',
  '## Conversation navigation',
  ...Array.from({ length: 12 }, () => 'Each mark belongs to a user prompt. A preview retains just enough of the response to recognize the turn, while the conversation remains the main reading surface.'),
  '### Hover previews',
  ...Array.from({ length: 12 }, () => 'Move toward the rail to reveal neighboring marks. The tooltip shows the question and a short excerpt of the visible response.'),
  '## Workspace reading',
  ...Array.from({ length: 12 }, () => 'Keep the outline folded until it is needed. Selecting a heading moves only the workspace document, leaving the conversation and composer where they were.'),
  '### Nested headings',
  ...Array.from({ length: 12 }, () => 'The stepped rail expresses the hierarchy in the document. Progress follows the heading nearest the reading line.'),
  '## Workspace reading',
  'Duplicate heading names still receive unique anchors.',
  '```md', '# Fenced heading is not a TOC item', '```',
].join('\n\n');

const history = Array.from({ length: 5 }, (_, index) => [
  { id: `rare-user-${index}`, role: 'user', content: `Round ${index + 1}: ${['Inspect the navigation surfaces', 'Keep the conversation rail compact', 'Add a document outline', 'Review the completed activity', 'Finish the interaction checks'][index]}`, timestamp: now - (5 - index) * 120_000 },
  { id: `rare-assistant-${index}`, role: 'assistant', content: `### Round ${index + 1} result\n\n${['The project and session choices retain their current behavior. The hook follows the selected item and stays clear of row controls.', 'The compact marks follow the reading position and reveal neighboring turns as the pointer approaches.', 'Markdown headings form a stepped outline. The circular control keeps it folded until the reader needs it.', 'Completed activity is listed newest first. Each entry returns to the corresponding turn.', 'The interactions retain keyboard access, light and dark surfaces, and reduced-motion behavior.'][index]}\n\n${Array.from({ length: 3 }, () => 'The main conversation remains readable, with enough breathing room around the content and composer.').join('\n\n')}`, timestamp: now - (5 - index) * 120_000 + 35_000 },
]).flat();

const workspace = {
  id: 'rareui-project', name: 'Interaction Studio', rootPath: ROOT, agentId: 'main', selectedAgentId: 'main', activeSessionKey: SESSION,
  agentBindings: { main: { workspaceId: 'rareui-project', agentId: 'main', sessionKey: SESSION } },
  permissionMode: 'acceptEdits', createdAt: 1, updatedAt: 1, lastOpenedAt: 2, state: {}, sessionStates: { [SESSION]: {}, [OTHER]: {} },
};
const secondWorkspace = { ...workspace, id: 'rareui-reference', name: 'Reference Notes', rootPath: 'D:/tmp/rareui-reference-project', activeSessionKey: OTHER, lastOpenedAt: 1 };
const agents = [{ id: 'main', name: 'Studio Assistant', workspace: ROOT, mainSessionKey: SESSION, isDefault: true, channelTypes: [] }];
const jobs: CronJob[] = [
  { id: 'rareui-daily', name: 'Morning review', message: 'Review the workspace and summarize the changes.', schedule: { kind: 'cron', expr: '15 9 * * 1', tz: 'Asia/Shanghai' }, enabled: true, agentId: 'main', source: 'gateway', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', nextRun: '2026-10-26T01:15:00Z' },
  { id: 'rareui-every', name: 'Repeating pulse', message: 'Check for new work.', schedule: { kind: 'every', everyMs: 900_000, anchorMs: now }, enabled: true, agentId: 'main', source: 'gateway', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z' },
];

function stable(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => `${JSON.stringify(key)}:${stable(val)}`).join(',')}}`;
}

async function seed(app: ElectronApplication, count = 5) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
    gatewayRpc: {
      [stable(['sessions.list', {}])]: { success: true, result: { sessions: [{ key: SESSION, displayName: 'Interaction review', updatedAt: now }, { key: OTHER, displayName: 'Reference notes', updatedAt: now - 500_000 }] } },
      [stable(['chat.history', null])]: { success: true, result: { messages: history.slice(0, count * 2), hasMore: false } },
    },
    hostApi: {
      [stable(['agents', 'list', null])]: { success: true, agents, defaultAgentId: 'main', defaultModelRef: 'deepseek/deepseek-chat', configuredChannelTypes: [] },
      [stable(['settings', 'getAll', null])]: { success: true, data: { setupComplete: true, language: 'en', theme: 'light' } },
      [stable(['workspaces', 'list', null])]: { success: true, profiles: [workspace, secondWorkspace], activeWorkspaceId: workspace.id, activeWorkspace: workspace },
      [stable(['workspaces', 'getActive', null])]: { success: true, activeWorkspaceId: workspace.id, activeWorkspace: workspace },
      [stable(['workspaces', 'getSessionState', null])]: { success: true, sessionState: {} },
      [stable(['sessions', 'history', null])]: { messages: history.slice(0, count * 2), hasMore: false },
      [stable(['providers', 'snapshot', null])]: { success: true, accounts: [], statuses: [], vendors: [], defaultAccountId: '' },
      [stable(['sessionActivity', 'snapshot', null])]: { success: true, snapshot: {
        session: { sessionKey: SESSION, runId: null, status: 'idle', startedAt: null, endedAt: null, error: null, updatedAt: now },
        git: null, tasks: [], subagents: [], terminals: [], goals: [], processes: [], lineage: [],
        continuity: { queueCount: 0, contextPressure: null, checkpoint: false, blockedReason: null },
        availability: { git: true, tasks: true, subagents: true, terminals: true, continuity: true },
        backgroundRead: { state: 'known', readAt: now, failedAt: null }, capturedAt: now,
      } },
      [stable(['git', 'status', null])]: { success: true, status: { isRepository: false, branch: null, changes: [], clean: true, workspaceRoot: ROOT } },
      [stable(['files', 'listTree', null])]: { ok: true, root: { name: 'studio', relPath: '', absPath: ROOT, isDir: true, children: [{ name: 'interaction-guide.md', relPath: 'interaction-guide.md', absPath: `${ROOT}/interaction-guide.md`, isDir: false, size: markdown.length }] } },
      [stable(['files', 'stat', null])]: { ok: true, isFile: true, isDirectory: false, size: markdown.length, readOnly: false },
      [stable(['files', 'readText', null])]: { ok: true, content: markdown, size: markdown.length, readOnly: false },
      [stable(['cron', 'list', null])]: jobs,
      [stable(['cron', 'deliveryTargets', null])]: { success: true, channels: [] },
      [stable(['agentBrowser', 'tasks', null])]: { success: true, tasks: [] },
      [stable(['channels', 'accounts', null])]: { success: true, channels: [] },
    },
  });
  await app.evaluate(({ ipcMain }, fixtureJobs) => {
    const main = globalThis as typeof globalThis & {
      __rareUiJobs?: CronJob[];
      __rareUiCalls?: Array<{ action: string; payload: unknown }>;
    };
    main.__rareUiJobs = fixtureJobs;
    main.__rareUiCalls = [];
    type HostRequest = {
      id?: string;
      module?: string;
      action?: string;
      payload?: { id?: string; input?: Record<string, unknown> };
    };
    type HostHandler = (event: unknown, request: HostRequest) => unknown;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, HostHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: HostRequest) => {
      if (request.module !== 'cron' || !['update', 'delete'].includes(request.action ?? '')) {
        return originalHostInvoke?.(event, request);
      }
      main.__rareUiCalls!.push({ action: request.action!, payload: request.payload });
      let result: unknown;
      if (request.action === 'update') {
        const payload = request.payload;
        main.__rareUiJobs = main.__rareUiJobs!.map((job) => job.id === payload?.id
          ? {
            ...job,
            ...payload.input,
            schedule: typeof payload.input?.schedule === 'string'
              ? { kind: 'cron', expr: payload.input.schedule, tz: 'Asia/Shanghai' }
              : job.schedule,
          } as CronJob
          : job);
        result = main.__rareUiJobs.find((job) => job.id === payload?.id);
      } else {
        main.__rareUiJobs = main.__rareUiJobs!.filter((job) => job.id !== request.payload?.id);
        result = { success: true };
      }
      return { id: request.id, ok: true, data: result };
    });
  }, jobs);
}

async function capture(page: Page, name: string) {
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({ path: join(artifacts, `${name}.png`), animations: 'disabled' });
}

async function assertLayout(page: Page) {
  const bounds = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="chat-message-nav-rail"]')?.getBoundingClientRect();
    const conversation = document.querySelector('[data-testid="chat-message-layout"]')?.getBoundingClientRect();
    const sidebar = document.querySelector('[data-testid="sidebar"]')?.getBoundingClientRect();
    const scroll = document.querySelector<HTMLElement>('[data-testid="chat-scroll-container"]');
    const bell = document.querySelector('[data-testid="chat-completion-bell"]');
    return {
      rail: rail ? { x: rail.x, width: rail.width, right: rail.right } : null,
      conversation: conversation ? { x: conversation.x, width: conversation.width } : null,
      sidebar: sidebar ? { right: sidebar.right } : null,
      bellInSidebar: Boolean(bell?.closest('[data-testid="sidebar"]')),
      overflow: scroll ? scroll.scrollWidth > scroll.clientWidth + 1 : false,
    };
  });
  expect(bounds.rail?.width).toBe(28);
  expect(Math.abs(bounds.rail!.x - bounds.sidebar!.right)).toBeLessThan(2);
  expect(bounds.rail!.x).toBeLessThan(bounds.conversation!.x);
  expect(bounds.bellInSidebar).toBe(true);
  expect(bounds.overflow).toBe(false);
  return bounds;
}

test('conversation rail, hook selection, completion bell and Markdown TOC have real Electron screenshot evidence', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true, visualMode: true, theme: 'light' });
  try {
    await seed(app, 3);
    const page = await getStableWindow(app);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await pinWindowContentSize(app, { width: 1440, height: 960 });
    await page.reload();
    await expect(page.getByTestId('chat-message-4')).toBeVisible();
    await expect(page.getByTestId('chat-message-nav-rail')).toHaveCount(0);
    expect(await page.getByTestId('chat-completion-bell').evaluate((element) => Boolean(element.closest('[data-testid="sidebar"]')))).toBe(true);
    await seed(app, 5);
    await page.reload();
    await expect(page.getByTestId('chat-message-nav-rail')).toBeVisible();
    await expect(page.locator('[data-nav-index]')).toHaveCount(5);
    await page.getByTestId('chat-message-nav-rail-item-2').hover();
    await expect(page.getByTestId('turn-preview-2').first()).toContainText('Round 2');
    await expect(page.getByTestId('turn-preview-2').first()).toContainText('compact marks');
    await capture(page, 'conversation-proximity-light');
    await page.getByTestId('chat-message-nav-rail-item-0').click();
    await expect.poll(() => page.getByTestId('chat-scroll-container').evaluate((el) => el.scrollTop)).toBeLessThan(80);
    await page.getByTestId('chat-completion-bell').click();
    await expect(page.getByTestId('chat-completion-item')).toHaveCount(5);
    await expect(page.getByTestId('chat-completion-desktop-toggle')).toBeChecked();
    await expect(page.getByTestId('chat-completion-desktop-state')).toContainText('Desktop alerts on');
    await page.getByTestId('chat-completion-desktop-toggle').click();
    await expect(page.getByTestId('chat-completion-desktop-state')).toContainText('Desktop alerts off');
    await page.getByTestId('chat-completion-desktop-toggle').click();
    await expect(page.getByTestId('chat-completion-desktop-state')).toContainText('Desktop alerts on');
    const menuBounds = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="sidebar"]')?.getBoundingClientRect();
      const menu = document.querySelector('[data-testid="chat-completion-menu"]')?.getBoundingClientRect();
      return sidebar && menu ? { sidebarLeft: sidebar.left, sidebarRight: sidebar.right, menuLeft: menu.left, menuRight: menu.right } : null;
    });
    expect(menuBounds).not.toBeNull();
    expect(menuBounds!.menuLeft).toBeGreaterThanOrEqual(menuBounds!.sidebarLeft);
    expect(menuBounds!.menuRight).toBeLessThanOrEqual(menuBounds!.sidebarRight + 1);
    const completionTimes = await page.getByTestId('chat-completion-item').evaluateAll((items) => items.map((item) => Number(item.getAttribute('data-completed-at'))));
    expect(completionTimes).toEqual([...completionTimes].sort((a, b) => b - a));
    await capture(page, 'completion-bell-light');
    await page.getByTestId('chat-completion-item').first().click();
    await expect(page.getByTestId('chat-message-nav-rail-item-8')).toHaveAttribute('data-active', 'true');
    await page.getByTestId('chat-header-session-name').click();
    const sessionMenu = page.getByTestId('chat-session-navigation-menu');
    await expect(sessionMenu).toBeVisible();
    await sessionMenu.locator('[data-hook-key]').last().hover();
    await capture(page, 'session-hook-light');
    await page.keyboard.press('Escape');
    await page.getByTestId('chat-workspace-toggle').click();
    await page.getByText('interaction-guide.md', { exact: true }).first().click();
    await expect(page.getByTestId('markdown-toc-toggle')).toBeVisible();
    await page.getByTestId('markdown-toc-toggle').click();
    const toc = page.getByTestId('markdown-toc-panel');
    await expect(toc.locator('nav button')).toHaveCount(6);
    await expect(toc).not.toContainText('Fenced heading');
    const tocGeometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector)?.getBoundingClientRect();
        return element ? { top: element.top, right: element.right, bottom: element.bottom, width: element.width, height: element.height } : null;
      };
      return { panel: rect('[data-testid="markdown-toc-panel"]'), shell: rect('[data-testid="markdown-preview"]') };
    });
    expect(tocGeometry.panel).toBeTruthy();
    expect(Math.abs(tocGeometry.shell!.right - tocGeometry.panel!.right)).toBeLessThan(12);
    expect(Math.abs(tocGeometry.shell!.bottom - tocGeometry.panel!.bottom)).toBeLessThan(60);
    expect(tocGeometry.panel!.width).toBeLessThan(tocGeometry.shell!.width * 0.8);
    expect(tocGeometry.panel!.height).toBeLessThan(tocGeometry.shell!.height * 0.75);
    const transcriptTop = await page.getByTestId('chat-scroll-container').evaluate((el) => el.scrollTop);
    await toc.getByRole('button', { name: 'Nested headings', exact: true }).click();
    await expect.poll(() => page.getByTestId('markdown-preview-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(200);
    expect(await page.getByTestId('chat-scroll-container').evaluate((el) => el.scrollTop)).toBe(transcriptTop);
    await capture(page, 'markdown-toc-light');
    await page.keyboard.press('Escape');
    await expect(toc).toHaveCount(0);
    await page.getByTestId('markdown-toc-toggle').click();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await capture(page, 'markdown-toc-dark');
    await page.keyboard.press('Escape');
    const boundsWide = await assertLayout(page);
    await pinWindowContentSize(app, { width: 1000, height: 760 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.getByTestId('chat-completion-bell')).toBeVisible();
    await page.getByTestId('chat-message-nav-rail-item-0').click();
    await capture(page, 'conversation-narrow-reduced-dark');
    const boundsNarrow = await assertLayout(page);
    expect(errors).toEqual([]);
    await writeFile(join(artifacts, '..', 'interaction-results.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex', electron: true, threshold: { threeHidden: true, fiveVisible: true }, tooltip: { prompt: true, response: true }, completionTimes, markdown: { headings: 6, isolatedScroll: true, escape: true }, boundsWide, boundsNarrow, errors }, null, 2));
  } finally { await closeElectronApp(app); }
});

test('Cron time edits persist and animated deletion retains confirmation and cancellation', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true, theme: 'light' });
  try {
    await seed(app);
    const page = await getStableWindow(app);
    await pinWindowContentSize(app, { width: 1440, height: 960 });
    await page.reload();
    await page.getByTestId('sidebar-nav-cron').click();
    await page.getByTestId('cron-job-card-rareui-daily').click();
    await page.getByRole('button', { name: 'Edit configuration', exact: true }).click();
    await expect(page.getByTestId('cron-duration-picker')).toBeVisible();
    await page.getByTestId('duration-picker-edit').click();
    await page.getByTestId('duration-picker-hours').fill('10');
    await page.getByTestId('duration-picker-minutes').fill('30');
    await capture(page, 'cron-duration-edit-light');
    await page.getByTestId('duration-picker-edit').click();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByTestId('cron-task-dialog')).toHaveCount(0);
    const calls = await app.evaluate(() => (globalThis as typeof globalThis & { __rareUiCalls?: Array<{ action: string; payload: { input?: { schedule?: string } } }> }).__rareUiCalls ?? []);
    expect(calls.find((call) => call.action === 'update')?.payload.input?.schedule).toBe('30 10 * * 1');
    await page.getByRole('button', { name: 'Edit configuration', exact: true }).click();
    await expect(page.getByTestId('duration-picker-hours')).toHaveValue('10');
    await expect(page.getByTestId('duration-picker-minutes')).toHaveValue('30');
    await page.keyboard.press('Escape');
    const deletion = page.getByTestId('cron-detail-panel').locator('[data-slot="delete-button"]');
    await deletion.hover();
    await capture(page, 'delete-hover-light');
    await deletion.click();
    await expect(page.getByTestId('confirm-dialog-cancel-button')).toBeVisible();
    await capture(page, 'delete-confirmation-light');
    await page.getByTestId('confirm-dialog-cancel-button').click();
    const deletesAfterCancel = await app.evaluate(() => (globalThis as typeof globalThis & { __rareUiCalls?: Array<{ action: string }> }).__rareUiCalls?.filter((call) => call.action === 'delete').length ?? 0);
    expect(deletesAfterCancel).toBe(0);
    await page.getByTestId('cron-job-card-rareui-every').click();
    await page.getByRole('button', { name: 'Edit configuration', exact: true }).click();
    await expect(page.getByTestId('cron-preserved-schedule')).toBeVisible();
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const latestUpdate = await app.evaluate(() => (globalThis as typeof globalThis & { __rareUiCalls?: Array<{ action: string; payload: { input?: Record<string, unknown> } }> }).__rareUiCalls?.filter((call) => call.action === 'update').at(-1));
    expect(latestUpdate?.payload.input).not.toHaveProperty('schedule');
    await deletion.click();
    await page.getByTestId('confirm-dialog-confirm-button').click();
    await expect(page.getByTestId('cron-job-card-rareui-every')).toHaveCount(0);
    await writeFile(join(artifacts, '..', 'schedule-results.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex', dailyEdit: '30 10 * * 1', reopened: true, everyPreserved: true, deletesAfterCancel, confirmedDeletion: true }, null, 2));
  } finally { await closeElectronApp(app); }
});
