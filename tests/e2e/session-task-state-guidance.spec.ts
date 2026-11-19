import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { ElectronApplication, TestInfo } from '@playwright/test';
import type { TaskContractInput, TaskPage } from '../../shared/task-system/types';
import type { TaskLedgerSnapshot } from '../../shared/types/task-ledger';
import type { WorkspaceProfile } from '../../shared/types/workspace';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke } from './fixtures/fp-p1-harness';
import { createSessionChainProject, createSessionChainTask } from './fixtures/session-task-chain';

// driven_by: agent
// requested_route: ccs-workbuddy/deepseek-v4.1-flash
// Candidate: real Electron/Main/Gateway owners; case 2 injects only a delayed/denied Host read response.
// The assertions named in acceptance-location.md retain the current UI gaps as failures.
const runs = new Map<string, { app?: ElectronApplication; facts: Record<string, unknown> }>();
type LedgerFault = {
  mode: 'hold' | 'deny' | 'pass';
  releases: Array<() => void>;
  restore: () => void;
  events: Array<{ requestId?: string; phase: string; ownerOk: boolean; sourceWorkspaceId?: string }>;
};
type FaultGlobal = typeof globalThis & { __u2LedgerFault?: LedgerFault };

test.beforeEach(async ({ browserName: _browserName }, info) => {
  test.setTimeout(240_000);
  runs.set(info.testId, { facts: {
    driven_by: 'agent', actor: 'playwright-u2-state-proof',
    requested_route: 'ccs-workbuddy/deepseek-v4.1-flash', case: info.title,
    evidenceType: 'real-electron-production-owners', startedAt: new Date().toISOString(),
  } });
});

test.afterEach(async ({ browserName: _browserName }, info) => {
  const run = runs.get(info.testId)!;
  try {
    if (run.app) {
      run.facts.faultEvents = await run.app.evaluate(() => (globalThis as FaultGlobal).__u2LedgerFault?.events ?? [])
        .catch((error) => ({ readbackError: String(error) }));
      const page = await getStableWindow(run.app).catch(() => null);
      if (page) await page.screenshot({ path: info.outputPath('state-guidance.png'), timeout: 5000 })
        .catch((error) => { run.facts.screenshotError = String(error); });
    }
    await writeFile(info.outputPath('state-guidance.json'), JSON.stringify({ ...run.facts,
      status: info.status, errors: info.errors.map((error) => error.message ?? error.stack),
      finishedAt: new Date().toISOString(),
    }, null, 2) + '\n');
  } finally {
    if (run.app) {
      await run.app.evaluate(() => (globalThis as FaultGlobal).__u2LedgerFault?.restore()).catch(() => undefined);
      await hostInvoke(run.app, 'gateway', 'stop').catch(() => undefined);
      await closeElectronApp(run.app);
    }
    runs.delete(info.testId);
  }
});

function attach(app: ElectronApplication, info: TestInfo) {
  const run = runs.get(info.testId)!;
  run.app = app;
  return run.facts;
}

function contract(objective: string, dependencies: string[] = []): TaskContractInput {
  return { objective, target: 'proof.txt', constraints: [], dependencies,
    acceptance: [{ id: 'artifact', description: 'Read the recorded proof file',
      verification: { kind: 'file-sha256', path: 'proof.txt', sha256: createHash('sha256').update('proof\n').digest('hex') } }],
  };
}

async function holdLedgerRead(app: ElectronApplication, workspaceId: string) {
  await app.evaluate(({ ipcMain }, workspaceId) => {
    type Request = { id?: string; module?: string; action?: string; payload?: { workspaceId?: string } };
    type Reply = { ok: boolean; data?: { snapshot?: { sourceWorkspaceId?: string } } };
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string,
      (event: unknown, request: Request) => Promise<Reply>> })._invokeHandlers.get('host:invoke');
    if (!original) throw new Error('host:invoke missing');
    const state: LedgerFault = { mode: 'hold', releases: [], events: [], restore: () => {
      state.mode = 'pass';
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', original);
      state.releases.splice(0).forEach((release) => release());
    } };
    (globalThis as FaultGlobal).__u2LedgerFault = state;
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Request) => {
      const result = await original(event, request);
      if (request.module !== 'taskLedger' || request.action !== 'snapshot' || request.payload?.workspaceId !== workspaceId) return result;
      const entry = { requestId: request.id, phase: 'owner-returned', ownerOk: result.ok,
        sourceWorkspaceId: result.data?.snapshot?.sourceWorkspaceId };
      state.events.push(entry);
      if (!result.ok) return result;
      if (state.mode === 'hold') {
        entry.phase = 'held';
        await new Promise<void>((resolve) => state.releases.push(resolve));
      }
      if (state.mode === 'deny') {
        entry.phase = 'injected-permission-denial';
        return { id: request.id, ok: false, error: { code: 'FORBIDDEN',
          message: 'Agent-injected permission denial while reading Task Ledger',
          details: { backendCode: 'PERMISSION_DENIED', driven_by: 'agent' } } };
      }
      entry.phase = 'original-response';
      return result;
    });
  }, workspaceId);
}

test('AC8: an owner-created project without a coordinator names the missing association', async ({ launchElectronApp }, info) => {
  const app = await launchElectronApp({ skipSetup: true });
  const facts = attach(app, info);
  const page = await getStableWindow(app);
  await expect(page.getByTestId('main-layout')).toBeVisible();
  const rootPath = info.outputPath('unbound-workspace');
  await mkdir(rootPath, { recursive: true });
  // Omitting activeSessionKey is the existing owner path for an unbound project.
  const created = await hostInvoke<{ activeWorkspace: WorkspaceProfile }>(app, 'workspaces', 'create', {
    name: 'U2 unbound project', rootPath, agentId: 'main', permissionMode: 'fullAccess',
  });
  const workspace = created.activeWorkspace;
  facts.owner = workspace;
  expect(workspace.projectCoordinatorSessionKey).toBeUndefined();
  expect(workspace.coordinatorBindings?.[workspace.activeSessionKey]).toBeUndefined();
  await page.reload();
  await page.getByTestId(`sidebar-project-open-${workspace.id}`).click();
  const unavailable = page.getByTestId('project-entry-unavailable');
  await expect(unavailable).toBeVisible();
  await expect(page.getByTestId('project-coordinator-entry')).toHaveCount(0);
  await expect(page.getByTestId('session-task-container')).toHaveCount(0);
  facts.ui = await unavailable.innerText();
  await expect(unavailable).toContainText(/No coordinator (?:is )?bound|未绑定负责人/i);
});

test('AC8: a held real Ledger response shows loading, permission denial and a reachable refresh', async ({ launchElectronApp }, info) => {
  const app = await launchElectronApp({ skipSetup: true });
  const facts = attach(app, info);
  const page = await getStableWindow(app);
  await expect(page.getByTestId('main-layout')).toBeVisible();
  const project = await createSessionChainProject(app, info.outputPath('permission-workspace'), 'U2 permission project');
  const task = await createSessionChainTask(app, project.workspaceId, 'u2-permission-task', contract('U2 recorded task'));
  await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: project.workspaceId, nodeId: task.contract.taskNodeId,
    sessionKey: project.sessionKey, sessionGeneration: project.generation, agentId: 'main' });
  await hostInvoke(app, 'workspaces', 'saveState', { id: project.workspaceId, sessionKey: project.sessionKey,
    state: { draftInput: 'U2 draft retained across permission recovery' } });
  facts.owner = { project, task };
  facts.faultInjection = { driven_by: 'agent', boundary: 'Main host:invoke taskLedger.snapshot',
    behavior: 'hold successful real owner response, then substitute PERMISSION_DENIED; restore original handler before refresh' };
  await holdLedgerRead(app, project.workspaceId);
  await page.reload();
  await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
  await expect.poll(() => app.evaluate(() => (globalThis as FaultGlobal).__u2LedgerFault!.events
    .filter((event) => event.phase === 'held' && event.ownerOk).length)).toBeGreaterThan(0);
  const container = page.getByTestId('session-task-container');
  await expect(container).toHaveAttribute('data-state', 'loading');
  await expect(container.getByRole('status')).toHaveText('Loading ledger');
  await page.screenshot({ path: info.outputPath('ledger-loading.png') });
  await app.evaluate(() => {
    const state = (globalThis as FaultGlobal).__u2LedgerFault!;
    state.mode = 'deny';
    state.releases.splice(0).forEach((release) => release());
  });
  await expect(container).toHaveAttribute('data-state', 'unavailable');
  facts.permissionUi = await container.getByRole('status').innerText();
  // Soft assertion preserves the known reason-loss failure while still checking real recovery.
  await expect.soft(container.getByRole('status')).toContainText(/permission|权限/i);
  await page.getByTestId('session-tasks-toggle').click();
  await expect(page.getByTestId(`session-task-select-${task.contract.taskNodeId}`)).toHaveCount(0);
  await expect(page.getByTestId('chat-composer-input')).toHaveValue('U2 draft retained across permission recovery');
  await page.screenshot({ path: info.outputPath('ledger-permission-denied.png') });
  await app.evaluate(() => (globalThis as FaultGlobal).__u2LedgerFault!.restore());
  await container.getByRole('button', { name: 'Refresh task scope', exact: true }).click();
  await expect(container).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('session-task-list')).toContainText(task.contract.objective);
  const recovered = await hostInvoke<{ snapshot: TaskLedgerSnapshot }>(app, 'taskLedger', 'snapshot', { workspaceId: project.workspaceId });
  expect(recovered.snapshot.nodes.some((node) => node.id === task.contract.taskNodeId)).toBe(true);
  facts.recovered = { sourceWorkspaceId: recovered.snapshot.sourceWorkspaceId,
    task: recovered.snapshot.nodes.find((node) => node.id === task.contract.taskNodeId), ui: await container.innerText() };
});

test('AC9: a real dependency rejection names the prerequisite and opens its existing task action', async ({ launchElectronApp }, info) => {
  const app = await launchElectronApp({ skipSetup: true });
  const facts = attach(app, info);
  const page = await getStableWindow(app);
  await expect(page.getByTestId('main-layout')).toBeVisible();
  const project = await createSessionChainProject(app, info.outputPath('dependency-workspace'), 'U2 dependency project');
  const prerequisite = await createSessionChainTask(app, project.workspaceId, 'u2-prerequisite', contract('U2 prepare input'));
  const dependent = await createSessionChainTask(app, project.workspaceId, 'u2-dependent',
    contract('U2 consume input', [prerequisite.contract.taskNodeId]));
  await hostInvoke(app,'workspaces','bindCoordinator',{workspaceId:project.workspaceId,sessionKey:project.sessionKey,agentId:'main',
    expectedRevision:0,taskLedgerNodeIds:[dependent.contract.taskNodeId],environment:{kind:'local',rootPath:project.rootPath},archiveRestorePolicy:'restore'});
  await hostInvoke(app, 'taskLedger', 'linkSession', { workspaceId: project.workspaceId, nodeId: dependent.contract.taskNodeId,
    sessionKey: project.sessionKey, sessionGeneration: project.generation, agentId: 'main' });
  const rejected = await hostInvoke<{ success: boolean; error?: string }>(app, 'taskLedger', 'command', {
    workspaceId: project.workspaceId, command: { action: 'claim', taskNodeId: dependent.contract.taskNodeId,
      sessionKey: project.sessionKey, requestId: 'u2-dependency-rejection' },
  });
  facts.owner = { project, prerequisite, dependent, rejected };
  expect(rejected.success).toBe(false);
  expect(rejected.error).toContain('TASK_DEPENDENCY_UNSATISFIED');
  const readback = await hostInvoke<TaskPage>(app, 'taskLedger', 'queryTasks', { workspaceId: project.workspaceId, limit: 50 });
  expect(readback.tasks.find((task) => task.contract.taskNodeId === dependent.contract.taskNodeId)?.claim).toBeNull();
  await page.reload();
  await page.getByTestId(`sidebar-project-open-${project.workspaceId}`).click();
  await page.getByTestId('session-tasks-toggle').click();
  await page.getByTestId('session-task-list').getByRole('link', { name: dependent.contract.objective, exact: true }).click();
  await page.getByRole('tab', { name: 'Persistent tasks', exact: true }).click();
  const dependentCard = page.getByTestId('managed-task').filter({ has: page.getByRole('heading', { name: dependent.contract.objective, exact: true }) });
  await expect(dependentCard).toBeVisible();
  facts.dependentUi = await dependentCard.innerText();
  await expect.soft(dependentCard).toContainText(/Waiting for dependency|等待依赖/i);
  const openDependency = dependentCard.getByRole('button', { name: `Open dependency: ${prerequisite.contract.objective}`, exact: true });
  await expect(openDependency).toBeVisible();
  await openDependency.click();
  const prerequisiteCard = page.getByTestId('managed-task').filter({ has: page.getByRole('heading', { name: prerequisite.contract.objective, exact: true }) });
  await expect(prerequisiteCard).toBeVisible();
  await prerequisiteCard.getByRole('button', { name: 'Claim for this session', exact: true }).click();
  await expect(prerequisiteCard.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const after = await hostInvoke<TaskPage>(app, 'taskLedger', 'queryTasks', { workspaceId: project.workspaceId, limit: 50 });
  expect(after.tasks.find((task) => task.contract.taskNodeId === prerequisite.contract.taskNodeId)?.claim?.sessionKey).toBe(project.sessionKey);
  expect(after.tasks.find((task) => task.contract.taskNodeId === dependent.contract.taskNodeId)?.claim).toBeNull();
  facts.nextAction = { via: 'dependency title button -> existing claim button', tasks: after.tasks };
});
