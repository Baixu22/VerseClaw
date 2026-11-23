import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';
import type { TaskId } from '../../shared/types/identity-scope';
import type { TaskSessionSnapshot, TaskView } from '../../shared/task-system/types';
import { test, expect, closeElectronApp, getStableWindow, installIpcMocks, pinWindowContentSize, publishGatewayStatus } from './fixtures/electron';

const sessionKey = 'agent:main:chat-ux';
const workspaceId = 'chat-ux-project';
const taskNodeId = '11111111-1111-4111-8111-111111111111' as TaskId;
const at = Date.now();
const task: TaskView = {
  contract: { taskNodeId, objective: '让任务规划与会话输入保持清楚、简单', target: 'src/pages/Chat', state: 'doing',
    constraints: [], acceptance: [], revision: 1, digest: 'a'.repeat(64), domain: 'agent-ui-fixture',
    origin: { source: 'host', requestId: 'chat-ux-fixture' }, createdAt: at - 60000, updatedAt: at },
  claim: null, checkpoint: { completed: [], nextAction: '核对当前任务的验收记录', unresolved: [], artifacts: [] }, pendingOperations: 0,
};
const readback: TaskSessionSnapshot & { success: true } = { success: true, task, children: [] };
const profile = { id: workspaceId, name: 'Verse Claw', rootPath: 'D:/tmp/chat-ux-fixture', agentId: 'main', selectedAgentId: 'main',
  activeSessionKey: sessionKey, sessionStates: {}, sessionFolders: [], sessionFolderAssignments: {}, agentBindings: {},
  permissionMode: 'readOnly', state: {}, createdAt: at, updatedAt: at };
const workspaces = { success: true, profiles: [profile], activeWorkspaceId: workspaceId, activeWorkspace: profile };
const key = (module: string, action: string) => JSON.stringify([module, action, null]);

async function runtime(app: ElectronApplication, event: ChatRuntimeEvent) {
  await app.evaluate(({ BrowserWindow }, value) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:runtime-event', value);
  }, event);
}

test('conversation planning, settings and decisions share a compact input surface', async ({ launchElectronApp, userDataDir }, info) => {
  test.setTimeout(240000);
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en', theme: 'light', gatewayAutoStart: false }));
  const app = await launchElectronApp({ skipSetup: true });
  const pageErrors: string[] = [];
  const shots: Array<{ name: string; sha256: string; width: number; height: number }> = [];
  const steps: Record<string, boolean> = {};
  const materials: Array<Record<string, unknown>> = [];
  const captureRoot = process.env.CLAWX_CHAT_UX_CAPTURE_DIR ?? info.outputPath('screenshots');
  await mkdir(captureRoot, { recursive: true });
  try {
    const page = await getStableWindow(app);
    page.on('pageerror', error => pageErrors.push(error.message));
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
      gatewayRpcByMethod: {
        'sessions.list': { sessions: [{ key: sessionKey, sessionId: 'chat-ux-generation', displayName: '会话任务与交互设计' }] },
        'chat.history': { sessionKey, sessionId: 'chat-ux-generation', messages: [
          { id: 'ux-user', role: 'user', content: '请把任务规划和会话操作整理得更清楚。', timestamp: at },
          { id: 'ux-answer', role: 'assistant', content: '先整理当前步骤，完成后核对任务结果。', timestamp: at + 1 },
        ] }, 'chat.abort': { aborted: true, runIds: ['chat-ux-controls'] }, '*': {},
      },
      hostApi: {
        [key('agents', 'list')]: { success: true, agents: [{ id: 'main', name: 'main', canonicalSessionKey: sessionKey }], defaultAgentId: 'main', defaultModelRef: 'anthropic/claude-sonnet-4-6' },
        [key('providers', 'accounts')]: [{ id: 'ux-provider', vendorId: 'anthropic', label: 'Agent UI fixture', authMode: 'api_key', enabled: true, isDefault: true, model: 'claude-sonnet-4-6', createdAt: at, updatedAt: at }],
        [key('providers', 'accountKeyInfo')]: [{ accountId: 'ux-provider', hasKey: true, keyMasked: 'fixture' }],
        [key('providers', 'vendors')]: [], [key('providers', 'getDefaultAccount')]: { accountId: 'ux-provider' },
        [key('settings', 'getAll')]: { success: true, data: { language: 'en', theme: 'light' } },
        [key('workProviders', 'status')]: { success: true, providers: [], capabilities: [], kitCapabilities: [], summary: { ready: 0, missingDependency: 0, missingConfig: 0, disabled: 0, externalUnavailable: 0 } },
        [key('workspaces', 'list')]: workspaces, [key('workspaces', 'getActive')]: { success: true, profile }, [key('workspaces', 'saveState')]: workspaces,
        [key('git', 'status')]: { success: true, status: { isRepository: false, workspaceRoot: profile.rootPath, clean: true, changes: [], hasConflicts: false, ahead: 0, behind: 0, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 } },
        [key('taskLedger', 'snapshot')]: { success: true, snapshot: { schemaVersion: 1, workspaceId, sourceWorkspaceId: workspaceId, generatedAt: new Date(at).toISOString(), nodes: [], edges: [], sessionLinks: [], rootNodeIds: [], activeNodeIds: [], blockedNodeIds: [], reviewNodeIds: [], recentDecisions: [], eventsCount: 0, warnings: [] } },
        [key('taskLedger', 'sessionTask')]: readback,
        [key('sessions', 'longTaskControlStatus')]: { success: true, available: true, queueCount: 0, warnings: [] },
        [key('runtimeApprovals', 'list')]: { success: true, pending: [] },
        [key('runtimeApprovals', 'resolve')]: { success: true },
      },
    });
    await app.evaluate((_electron, initial) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: any) => Promise<unknown>> })._invokeHandlers.get('host:invoke')!;
      const state = { readback: initial, failTaskReads: true, gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 }, taskReads: [] as unknown[], parameterWrites: [] as unknown[] };
      (globalThis as unknown as { __chatUxFixture: typeof state }).__chatUxFixture = state;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request) => {
        if (request.module === 'taskLedger' && request.action === 'sessionTask') {
          state.taskReads.push(request.payload);
          return { id: request.id, ok: true, data: state.failTaskReads ? { success: false } : state.readback };
        }
        if (request.module === 'gateway' && request.action === 'status') return { id: request.id, ok: true, data: state.gatewayStatus };
        if (['setPermissionMode', 'setKnowledgeScope', 'updateModel', 'updateAgentModel'].includes(request.action)) state.parameterWrites.push({ module: request.module, action: request.action });
        return original(event, request);
      });
    }, readback);
    await pinWindowContentSize(app, { width: 1280, height: 800 });
    await page.reload();
    const capture = async (name: string) => {
      const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      const shell = page.getByTestId('chat-composer-shell');
      const bubble = page.getByTestId('chat-user-message-bubble').first();
      if (await shell.isVisible()) {
        await expect(shell).toHaveCSS('background-color', dark ? 'rgb(53, 53, 51)' : 'rgb(255, 255, 255)');
        await expect(shell).toHaveCSS('backdrop-filter', 'none');
        await expect(page.locator('.codex-composer-stack')).toHaveCSS('border-radius', '16px');
        await expect(page.locator('.codex-composer-stack')).toHaveCSS('border-top-width', '1px');
        await expect(shell).toHaveCSS('border-top-width', '0px');
      }
      await expect(bubble).toHaveCSS('background-color', dark ? 'rgb(54, 54, 52)' : 'rgb(244, 244, 241)');
      await expect(bubble).toHaveCSS('border-radius', '12px');
      await expect(bubble).toHaveCSS('padding', '9px 14px');
      await expect(bubble).toHaveCSS('backdrop-filter', 'none');
      await expect(page.getByTestId('chat-composer-beam')).toHaveCount(0);
      materials.push({ name, dark, ...await page.evaluate(() => {
        const values = (selector: string) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const css = getComputedStyle(element);
          return { background: css.backgroundColor, border: css.borderColor, radius: css.borderRadius, shadow: css.boxShadow, backdropFilter: css.backdropFilter };
        };
        return { shell: values('[data-testid="chat-composer-shell"]'), frame: values('.codex-composer-stack'),
          task: values('[data-testid="session-task-panel"]'), message: values('[data-testid="chat-user-message-bubble"]') };
      }) });
      const bytes = await page.screenshot({ path: join(captureRoot, `${name}.png`), animations: 'disabled' });
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      shots.push({ name, sha256: createHash('sha256').update(bytes).digest('hex'), ...viewport });
    };
    const openKnowledge = async () => {
      const trigger = page.getByTestId('chat-knowledge-scope-button');
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
      await expect(page.getByTestId('chat-knowledge-scope-menu')).toHaveAttribute('data-state', 'open');
    };
    const revealOptions = async () => {
      await openKnowledge();
      if (!(await page.getByTestId('chat-knowledge-interaction').isVisible())) await page.getByTestId('chat-knowledge-options-toggle').click();
    };
    const selectMode = async (value: string) => { await revealOptions(); await page.getByTestId('chat-knowledge-interaction').selectOption(value); };
    const selectProfile = async (value: string) => { await revealOptions(); await page.getByTestId('chat-knowledge-profile').selectOption(value); };

    const input = page.getByTestId('chat-composer-input');
    await expect(page.getByTestId('session-task-dock')).toHaveAttribute('data-state', 'unavailable');
    await input.fill('任务状态恢复时保留这段草稿');
    await capture('task-unavailable-light-1280');
    await app.evaluate(() => { (globalThis as unknown as { __chatUxFixture: { failTaskReads: boolean } }).__chatUxFixture.failTaskReads = false; });
    await page.getByTestId('session-task-retry').click();
    await expect(page.getByTestId('session-task-title')).toHaveText(task.contract.objective);
    await expect(input).toHaveValue('任务状态恢复时保留这段草稿');
    await input.fill('');
    steps.initialTaskReadRecoveryPreservesDraft = true;
    await expect(page.getByTestId('session-task-panel')).toBeVisible();
    await expect(page.getByTestId('session-task-container')).toHaveAttribute('data-state', 'empty');
    await expect(page.getByTestId('session-tasks-toggle')).toHaveCount(0);
    await expect(page.getByTestId('chat-knowledge-profile')).toHaveCount(0);
    await expect(page.getByTestId('chat-knowledge-interaction')).toHaveCount(0);
    const anchors = await page.getByTestId('chat-composer-shell').locator('[data-testid="chat-composer-actions"], [data-testid="chat-composer-permission-mode"], [data-testid="chat-knowledge-scope-button"], [data-testid="chat-model-picker-button"], [data-testid="chat-composer-send"], [data-testid="chat-composer-stop"]').count();
    expect(anchors).toBeLessThanOrEqual(5);
    await capture('rest-light-1280');
    const modelBefore = await page.getByTestId('chat-model-picker-label').textContent();
    expect(modelBefore).toBe('claude-sonnet-4-6');
    expect(await page.getByTestId('chat-model-picker-label').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(page.getByTestId('chat-model-picker-button')).toHaveAttribute('title', 'anthropic/claude-sonnet-4-6');
    const permissionBefore = await page.getByTestId('chat-composer-permission-mode').textContent();
    await openKnowledge();
    await expect(page.getByTestId('chat-knowledge-interaction')).toHaveValue('off');
    await expect(page.getByTestId('chat-knowledge-profile')).toHaveValue('local');
    await capture('knowledge-light-1280');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chat-model-picker-label')).toHaveText(modelBefore!);
    await expect(page.getByTestId('chat-composer-permission-mode')).toHaveText(permissionBefore!);
    const openingWrites = await app.evaluate(() => (globalThis as unknown as { __chatUxFixture: { parameterWrites: unknown[] } }).__chatUxFixture.parameterWrites);
    expect(openingWrites).toEqual([]);
    steps.settingsDoNotChangeParameters = true;
    await revealOptions();
    const menuBounds = await page.getByTestId('chat-knowledge-scope-menu').boundingBox();
    expect(menuBounds!.height).toBeLessThanOrEqual(520.1);
    await capture('knowledge-options-light-1280');
    await selectMode('manual');
    await selectProfile('quality');
    await expect(page.getByTestId('chat-knowledge-paid-profile')).toHaveText('Quality');
    await selectProfile('local');
    await selectMode('suggest');
    await selectMode('off');
    await page.keyboard.press('Escape');
    steps.explicitCostProfileVisible = true;
    const runId = 'chat-ux-run';
    const plan = [{ step: '整理当前组件与交互入口', status: 'completed' }, { step: '核验会话规划和输入框的衔接', status: 'in_progress' }];
    await runtime(app, { type: 'run.started', runId, sessionKey, ts: at + 2, startedAt: at + 2 });
    await runtime(app, { type: 'tool.started', runId, sessionKey, ts: at + 3, toolCallId: 'ux-plan', name: 'update_plan', args: { plan } });
    await expect(page.getByTestId('session-task-dock')).toHaveAttribute('data-step-source', 'run-plan');
    await expect(page.getByTestId('session-task-current')).toHaveCount(0);
    await expect(page.getByTestId('session-task-count')).toHaveText('1/2');
    await expect(page.getByTestId('session-task-status')).toHaveClass(/sr-only/);
    await expect(page.getByTestId('chat-composer-beam')).toHaveCount(0);
    await expect(page.getByTestId('chat-run-plan')).toHaveCount(0);
    await capture('running-light-1280');
    await pinWindowContentSize(app, { width: 960, height: 800 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.getByTestId('session-task-title').locator('xpath=ancestor::button[1]').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('session-task-steps')).toContainText(plan[1].step);
    await expect(page.getByTestId('session-task-id')).toHaveCount(0);
    await capture('running-expanded-dark-960');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.session-task-spinner')).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const enclosure = await page.evaluate(() => {
      const taskPanel = document.querySelector('[data-testid="session-task-panel"]')!.getBoundingClientRect();
      const input = document.querySelector('[data-testid="chat-composer-shell"]')!.getBoundingClientRect();
      return { widthDifference: Math.abs(taskPanel.width - input.width), gap: input.top - taskPanel.bottom };
    });
    expect(enclosure.widthDifference).toBeLessThan(1); expect(Math.abs(enclosure.gap)).toBeLessThan(1);
    const completedPlan = plan.map(item => ({ ...item, status: 'completed' }));
    await runtime(app, { type: 'tool.started', runId, sessionKey, ts: at + 4, toolCallId: 'ux-plan-final', name: 'update_plan', args: { plan: completedPlan } });
    await runtime(app, { type: 'tool.completed', runId, sessionKey, ts: at + 5, toolCallId: 'ux-plan-final', name: 'update_plan', result: { success: true } });
    await expect(page.getByTestId('session-task-dock')).toHaveAttribute('data-state', 'doing');
    await expect(page.getByTestId('session-task-progress')).toHaveAttribute('aria-valuenow', '100');
    steps.runCompletionDoesNotAcceptTask = true;
    await runtime(app, { type: 'run.ended', runId, sessionKey, ts: at + 5, status: 'completed', endedAt: at + 5 });
    await expect(page.getByTestId('session-task-dock')).toHaveAttribute('data-step-source', 'task');
    await expect(page.getByTestId('session-task-status')).toContainText('In progress');
    await page.getByTestId('session-task-menu').click();
    await page.getByTestId('session-task-close').click();
    await input.fill('任务暂停时保留这段草稿');
    await app.evaluate((_electron, value) => { (globalThis as unknown as { __chatUxFixture: { readback: TaskSessionSnapshot } }).__chatUxFixture.readback = value; },
      { ...readback, task: { ...task, contract: { ...task.contract, state: 'paused' as const }, checkpoint: { ...task.checkpoint!, unresolved: ['核对仍未完成的产物'] } } });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('session-task-dock')).toHaveAttribute('data-state', 'paused');
    await expect(page.getByTestId('session-task-blockers')).toBeVisible();
    await expect(input).toHaveValue('任务暂停时保留这段草稿');
    await expect(page.getByTestId('session-task-status')).toHaveClass(/sr-only/);
    await expect(page.getByTestId('session-task-blockers')).toHaveCSS('border-radius', '6px');
    await capture('task-paused-dark-960');
    await page.getByTestId('session-task-title').click();
    steps.hiddenPausedTaskReappearsWithDraft = true;
    await app.evaluate((_electron, value) => { (globalThis as unknown as { __chatUxFixture: { readback: TaskSessionSnapshot } }).__chatUxFixture.readback = value; },
      { ...readback, task: { ...task, contract: { ...task.contract, state: 'done' as const, revision: 2 }, checkpoint: { ...task.checkpoint!, completed: ['验收记录已核对'], nextAction: '' } } });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('session-task-dock')).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('session-task-details')).toHaveCount(0);
    await capture('accepted-dark-960');
    steps.ownerAcceptanceFoldsReceipt = true;
    await input.fill('保留这段尚未发送的跟进');
    const action = page.getByTestId('chat-composer-send');
    const actionStyles: Record<string, unknown> = {};
    const captureAction = async (state: string) => {
      await expect(action).toHaveAttribute('data-send-state', state);
      await page.mouse.move(20, 120);
      await expect(action).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      const style = await action.evaluate(element => {
        const box = element.getBoundingClientRect(), css = getComputedStyle(element);
        return { width: box.width, height: box.height, radius: css.borderRadius, background: css.backgroundColor, color: css.color };
      });
      expect(style.width).toBeCloseTo(style.height, 1);
      expect(style.radius).toBe('50%');
      expect(style.background).toBe('rgb(255, 255, 255)');
      actionStyles[state] = style;
      await capture(`action-${state}-dark-960`);
    };
    await captureAction('ready');
    await input.fill('');
    await runtime(app, { type: 'run.started', runId: 'chat-ux-controls', sessionKey, ts: Date.now(), startedAt: Date.now() });
    await captureAction('running');
    await action.click();
    await captureAction('paused');
    await action.click();
    await expect(action).toHaveAttribute('data-send-state', 'idle');
    await input.fill('保留这段尚未发送的跟进');
    steps.roundSendStopResume = true;
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('runtime-approvals:requested', {
      approvalId: 'ux-approval', sessionKey: value, agentId: 'main', command: 'node --test', cwd: 'D:/tmp/chat-ux-fixture',
      allowedDecisions: ['allow-once', 'deny'], createdAtMs: Date.now(), expiresAtMs: Date.now() + 60000,
    }), sessionKey);
    await expect(page.getByTestId('runtime-approval-prompt')).toBeVisible();
    await expect(input).toBeHidden();
    await capture('approval-dark-960');
    await page.getByTestId('runtime-approval-deny').click();
    await expect(input).toBeVisible(); await expect(input).toHaveValue('保留这段尚未发送的跟进');
    steps.approvalPreservesDraft = true;
    await app.evaluate(() => {
      (globalThis as unknown as { __chatUxFixture: { gatewayStatus: { state: string; gatewayReady: boolean; port: number } } }).__chatUxFixture.gatewayStatus = { state: 'stopped', gatewayReady: false, port: 18789 };
    });
    await publishGatewayStatus(app, { state: 'stopped', port: 18789 });
    await expect(page.getByTestId('chat-composer-connection-settings')).toBeVisible(); await expect(input).toHaveValue('保留这段尚未发送的跟进');
    await capture('disconnected-dark-960');
    await app.evaluate(() => {
      (globalThis as unknown as { __chatUxFixture: { gatewayStatus: { state: string; gatewayReady: boolean; port: number } } }).__chatUxFixture.gatewayStatus = { state: 'running', gatewayReady: true, port: 18789 };
    });
    await publishGatewayStatus(app, { state: 'running', gatewayReady: true, port: 18789 });
    steps.connectionFailureVisible = true;
    for (const [language, label] of [['zh', '中文'], ['ja', '日本語'], ['ru', 'Русский']] as const) {
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-language-select').click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await page.evaluate(() => { location.hash = '#/'; });
      await expect(input).toBeVisible();
      await expect(page.getByTestId('chat-knowledge-profile')).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow).toBe(false);
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10000 });
      await capture(`rest-${language}-dark-960`);
    }
    steps.fourLocalesAndNarrowThemes = true;
    expect(pageErrors).toEqual([]);
    await writeFile(info.outputPath('chat-ux-journey.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-chat-ux', dataSource: 'agent-fixed Task and typed Runtime events', steps, shots, materials, enclosure, actionStyles, defaultAnchorCount: anchors, pageErrors }, null, 2));
  } finally { await closeElectronApp(app); }
});
