import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { TaskView } from '../../shared/task-system/types';
import type { TaskId } from '../../shared/types/identity-scope';
import type { TaskTraceReport } from '../../shared/task-system/trace';
import en from '../../shared/i18n/locales/en/taskLedger.json';
import { test, expect, getStableWindow, installIpcMocks, closeElectronApp, pinWindowContentSize } from './fixtures/electron';

const workspaceId = 'ws-task-ui';
const sessionKey = 'agent:main:task-ui';
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const at = Date.now();
function task(index: number, objective: string, state: TaskView['contract']['state']): TaskView {
  const taskNodeId = ids[index] as TaskId;
  return {
    contract: { taskNodeId, objective, target: `src/tasks/step-${index + 1}.ts`, state,
      constraints: ['保留已有任务归属与验收记录'],
      acceptance: [{ id: 'check', description: '相关交互与类型检查通过', verification: { kind: 'tool-result', tool: 'exec', command: 'pnpm run typecheck', files: ['src/tasks/step-1.ts'], exitCode: 0 } }],
      revision: 1, digest: 'a'.repeat(64), domain: 'task-ui-fixture', origin: { source: 'host', requestId: `ui-${index}` }, createdAt: at - 600_000, updatedAt: at - index * 60_000 },
    claim: null,
    checkpoint: { nextAction: state === 'doing' ? '检查任务详情和执行追踪的呈现' : '', completed: state === 'done' ? ['检查通过'] : [], unresolved: [], artifacts: [] },
    pendingOperations: 0,
  };
}
const tasks = [task(0, '统一任务工作台与执行追踪', 'doing'), task(1, '整理前端资源并接通项目任务入口', 'done'), task(2, '核验任务菜单与窄窗口交互', 'ready')];
const snapshot = {
  schemaVersion: 1, workspaceId, sourceWorkspaceId: workspaceId, generatedAt: new Date(at).toISOString(),
  nodes: tasks.map((view, index) => ({ id: view.contract.taskNodeId, workspaceId,
    parentId: index === 0 ? null : ids[0],
    kind: index === 0 ? 'goal' : 'task', title: view.contract.objective,
    description: index === 0 ? '目标、当前步骤与结果从同一任务入口查看。' : '',
    status: view.contract.state === 'ready' ? 'todo' : view.contract.state,
    createdAt: new Date(at - 600_000).toISOString(), updatedAt: new Date(at - 120_000).toISOString() })),
  edges: ids.slice(1).map((id, index) => ({ id: `edge-${index}`, from: id, to: ids[0], type: 'child_of' })),
  sessionLinks: [{ id: 'session-link', workspaceId, sessionKey, taskNodeIds: ids, summary: '任务工作台设计与验证', createdAt: new Date(at).toISOString() }],
  rootNodeIds: [ids[0]], reviewNodeIds: [], activeNodeIds: [ids[0]], blockedNodeIds: [], currentGoalId: ids[0], recentDecisions: [], eventsCount: 12, warnings: [],
};
const trace: TaskTraceReport = {
  schemaVersion: 1, authorityId: 'task-ui-fixture', generatedAt: at, status: 'current', task: tasks[0],
  ancestors: [], revisions: [], claims: [], runs: [], operations: [], delegations: [], candidates: [], checks: [],
  costs: { scope: 'task-subtree', state: 'unknown', totalUsd: null, knownSubtotalUsd: 0, totalTokens: null, knownTokens: 0, calls: 0, unknownCalls: 0, duplicateObservations: 0, records: [] },
  phases: { queue: { durationMs: 800, intervals: [] }, execution: { durationMs: 42_000, intervals: [] }, verification: { durationMs: null, intervals: [] }, recovery: { durationMs: null, intervals: [] } },
  cleanup: [], diagnostics: [], events: [],
};
const profile = { id: workspaceId, name: 'Verse Claw', rootPath: 'D:\\task-ui-fixture', agentId: 'main', selectedAgentId: 'main', activeSessionKey: sessionKey, sessionStates: {}, sessionFolders: [], sessionFolderAssignments: {}, agentBindings: {}, state: {}, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() };
const workspaceSnapshot = { success: true, profiles: [profile], activeWorkspaceId: workspaceId, activeWorkspace: profile };
const key = (module: string, action: string) => JSON.stringify([module, action, null]);

test('task workbench, trace and composer share accessible wide and narrow surfaces', async ({ launchElectronApp, userDataDir }, info) => {
  test.setTimeout(240_000);
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en', theme: 'light', gatewayAutoStart: false }));
  const app = await launchElectronApp({ skipSetup: true });
  let observedPage: Awaited<ReturnType<typeof getStableWindow>> | undefined;
  const pageErrors: string[] = [];
  try {
    const page = await getStableWindow(app);
    observedPage = page;
    page.on('pageerror', error => pageErrors.push(error.message));
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789 },
      gatewayRpcByMethod: {
        'sessions.list': { sessions: [{ key: sessionKey, displayName: '任务工作台设计与验证', sessionId: 'ui-generation' }] },
        'chat.history': { sessionKey, sessionId: 'ui-generation', messages: [{ id: 'u1', role: 'user', content: '请整理任务体系，让进度和结果更清楚。', timestamp: at - 120_000 }, { id: 'a1', role: 'assistant', content: '资源已整合，正在核验任务详情与执行追踪。', timestamp: at - 90_000 }] },
        '*': {},
      },
      hostApi: {
        [key('agents', 'list')]: { success: true, agents: [{ id: 'main', name: 'main', canonicalSessionKey: sessionKey }], defaultAgentId: 'main', defaultModelRef: 'anthropic/claude-sonnet-4-6' },
        [key('providers', 'accounts')]: [{ id: 'ui-provider', vendorId: 'anthropic', label: 'Design fixture', authMode: 'api_key', enabled: true, isDefault: true, model: 'claude-sonnet-4-6', createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() }],
        [key('providers', 'accountKeyInfo')]: [{ accountId: 'ui-provider', hasKey: true, keyMasked: 'fixture' }],
        [key('providers', 'vendors')]: [],
        [key('providers', 'getDefaultAccount')]: { accountId: 'ui-provider' },
        [key('settings', 'getAll')]: { success: true, data: { language: 'en', theme: 'light' } },
        [key('workProviders', 'status')]: { success: true, providers: [], capabilities: [], kitCapabilities: [], summary: { ready: 0, missingDependency: 0, missingConfig: 0, disabled: 0, externalUnavailable: 0 } },
        [key('git', 'status')]: { success: true, status: { isRepository: false, workspaceRoot: profile.rootPath, ahead: 0, behind: 0, clean: true, hasConflicts: false, changes: [], stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0 } },
        [key('workspaces', 'list')]: workspaceSnapshot,
        [key('workspaces', 'getActive')]: { success: true, profile },
        [key('workspaces', 'saveState')]: workspaceSnapshot,
        [key('taskLedger', 'snapshot')]: { success: true, snapshot },
        [key('taskLedger', 'queryTasks')]: { success: true, tasks, total: tasks.length },
        [key('taskLedger', 'sessionTask')]: { success: true, task: tasks[0], children: tasks.slice(1), generation: 'ui-generation' },
        [key('taskLedger', 'trace')]: { success: true, report: trace },
        [key('taskLedger', 'contextHint')]: { success: true, hint: { status: 'disabled' } },
        [key('workspaces', 'portfolio')]: { scope: 'system', profiles: [{ id: workspaceId, name: profile.name, ownerKey: 'ui-owner' }] },
        [key('workspaces', 'projectSummary')]: { scope: 'project', workspaceId, ownerKey: 'ui-owner', observedAt: at,
          coordinator: { sessionKey, generation: 'ui-generation', bindingRevision: 1, state: 'ready' },
          plan: { taskNodeId: ids[0], objective: tasks[0].contract.objective, state: 'doing', revision: 1, nextAction: '核验任务详情和窄窗口交互', nextTaskNodeId: ids[2], pendingDecisions: [], tasks: tasks.map(view => ({ taskNodeId: view.contract.taskNodeId, objective: view.contract.objective, state: view.contract.state, revision: 1 })) },
          resources: { activeTaskClaims: 1, pendingEffects: 0, costUsd: null, observations: [] }, evidence: [] },
        [key('workspaces', 'systemControl')]: { revision: 1, paused: false },
        [key('workspaces', 'configurationOperations')]: [],
      },
    });
    const root = process.env.CLAWX_TASK_UI_CAPTURE_DIR || info.outputPath('screenshots');
    await mkdir(root, { recursive: true });
    const screenshots: Array<{ name: string; sha256: string; viewport: { width: number; height: number } }> = [];
    const capture = async (name: string) => {
      const bytes = await page.screenshot({ path: join(root, `${name}.png`) });
      screenshots.push({ name, sha256: createHash('sha256').update(bytes).digest('hex'), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })) });
    };
    const size = async (width: number) => {
      await pinWindowContentSize(app, { width, height: 800 });
    };
    const route = async (path: string) => {
      await page.evaluate(value => { location.hash = value; }, path);
    };
    await size(1280);
    await page.reload();
    await route(`/task-ledger?workspaceId=${workspaceId}&sessionKey=${encodeURIComponent(sessionKey)}`);
    await page.getByRole('tab', { name: en.managed.tab, exact: true }).click({ timeout: 6000 });
    await expect(page.getByTestId('managed-task')).toHaveCount(3);
    await capture('ledger-light-1280');
    const report = page.getByTestId('task-trace-panel').first();
    await report.locator('summary').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('task-trace-summary').first()).toBeVisible();
    await capture('trace-light-1280');
    await page.getByTestId('task-trace-metrics').first().locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('task-trace-cost').first()).toBeVisible();
    await page.getByRole('tab', { name: en.tabs.tree, exact: true }).click();
    await expect(page.getByTestId('task-ledger-tree')).toBeVisible();
    await capture('tree-light-1280');
    await route('/system');
    await expect(page.getByTestId(`portfolio-project-${workspaceId}`)).toBeVisible();
    await capture('projects-light-1280');
    await size(960);
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await route(`/task-ledger?workspaceId=${workspaceId}&sessionKey=${encodeURIComponent(sessionKey)}`);
    await page.getByRole('tab', { name: en.managed.tab, exact: true }).click();
    await expect(page.getByTestId('managed-task')).toHaveCount(3);
    await capture('ledger-dark-960');
    await route('/');
    await expect(page.getByTestId('session-task-panel')).toBeVisible();
    await capture('tray-dark-960');
    await page.getByTestId('session-task-title').locator('xpath=ancestor::button[1]').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('session-task-details')).toBeVisible();
    await capture('tray-expanded-dark-960');
    await expect(page.getByTestId('session-task-dock')).toHaveAttribute('data-placement', 'composer');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    for (const [language, name] of [['zh', '中文'], ['ja', '日本語'], ['ru', 'Русский']] as const) {
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-language-select').click();
      await page.getByRole('option', { name, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await page.getByTestId('settings-back-button').click();
      const labels = JSON.parse(await readFile(join(process.cwd(), 'shared/i18n/locales', language, 'taskLedger.json'), 'utf8'));
      await route(`/task-ledger?workspaceId=${workspaceId}&sessionKey=${encodeURIComponent(sessionKey)}`);
      await page.getByRole('tab', { name: labels.managed.tab, exact: true }).click();
      await expect(page.getByTestId('managed-task')).toHaveCount(3);
      await expect(page.getByTestId('task-ledger-page').locator('h1')).toHaveCSS('font-size', '24px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await capture(`ledger-${language}-960`);
    }
    await writeFile(info.outputPath('task-ui-capture.json'), JSON.stringify({ driven_by: 'agent', actor: 'playwright-task-ui', data: 'scripted Task owner responses', screenshots }, null, 2));
  } catch (error) {
    if (observedPage && !observedPage.isClosed()) {
      await observedPage.screenshot({ path: info.outputPath('failure.png') });
      await writeFile(info.outputPath('failure-state.json'), JSON.stringify({ url: observedPage.url(), body: await observedPage.locator('body').innerText(), pageErrors }, null, 2));
      console.log(JSON.stringify({ url: observedPage.url(), body: (await observedPage.locator('body').innerText()).slice(0, 5000), pageErrors }));
    }
    throw error;
  } finally {
    await closeElectronApp(app);
  }
});
