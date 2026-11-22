import { closeElectronApp, completeSetup, expect, getStableWindow, test } from './fixtures/electron';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { hostInvoke, startGateway, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider, createSessionChainProject, createSessionChainTask } from './fixtures/session-task-chain';
import type { MissionRunRecord } from '../../openclaw_runtime/src/agents/mission-control/types';

for (const status of ['paused', 'cancelled'] as const) {
  test(`retains ${status} through an in-flight compiled Gateway Mission`, async ({ launchElectronApp }, info) => {
    test.setTimeout(420_000);
    const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    if (process.env.CLAWX_M2_EXPECTED_HEAD) { expect(candidate).toBe(process.env.CLAWX_M2_EXPECTED_HEAD); expect(dirty).toBe(''); }
    const app = await launchElectronApp({ skipSetup: true });
    let holdModel = false; let modelEntered = false; let releaseModel!: () => void;
    const heldModel = new Promise<void>(resolve => { releaseModel = resolve; });
    let reviewerCalls = 0;
    const llm = await startScriptedLlm(async (text, _results, _index, request) => {
      if (text.includes('You are the OpenClaw Mission Loop reviewer.')) {
        reviewerCalls++;
        return { text: JSON.stringify({ decision: 'complete', confidence: 0.9, reason: 'Fixture completed',
          missingEvidence: [], verificationGaps: [], risks: [], memoryCandidates: [], checkpointSummary: 'Fixture completed' }) };
      }
      if (holdModel && request.stream && !modelEntered) { modelEntered = true; await heldModel; }
      return { text: 'M2_CONTROL_WORKER_DONE' };
    });
    const evidence: Record<string, unknown> = { driven_by: 'agent', actor: 'm2-runtime-control-verifier',
      candidate, dirty, provider: 'local-scripted', realHumanEvidence: false, control: status };
    const rpc = <T,>(method: string, params: Record<string, unknown> = {}) => hostInvoke<T>(app, 'gateway', 'rpc', { method, params });
    let running: Promise<{ mission: MissionRunRecord }> | undefined;
    try {
      await getStableWindow(app); await configureSessionChainProvider(app, llm.port);
      const project = await createSessionChainProject(app, info.outputPath('project'), `M2 Control ${status}`);
      evidence.project = project;
      const config = await rpc<{ hash: string; config: { models: { providers: Record<string, { baseUrl: string }> } } }>('config.get');
      expect(Object.keys(config.config.models.providers)).toEqual(['custom-sessionc']);
      expect(config.config.models.providers['custom-sessionc'].baseUrl).toBe(`http://127.0.0.1:${llm.port}/v1`);
      await rpc('config.patch', { baseHash: config.hash, raw: JSON.stringify({ agents: { defaults: {
        taskLoop: { maxIterations: 1, maxRepairIterations: 0 }, subagents: { maxChildrenPerAgent: 1 },
      } } }), note: 'Agent-driven bounded Mission control regression' });
      await hostInvoke(app, 'gateway', 'stop'); await startGateway(app);
      const task = await createSessionChainTask(app, project.workspaceId, `m2-control-${status}`, {
        objective: 'Review a control receipt', target: 'receipt.txt', constraints: ['Do not invent a receipt'],
        acceptance: [{ id: 'receipt', description: 'Confirm the receipt', verification: { kind: 'owner-receipt', owner: 'mission-control-regression', files: ['receipt.txt'] } }],
      });
      const bound = await hostInvoke<{ success: boolean; error?: string }>(app, 'workspaces', 'bindCoordinator', {
        ...project, agentId: 'main', expectedRevision: 0, taskLedgerNodeIds: [task.contract.taskNodeId],
        environment: { kind: 'local', rootPath: project.rootPath }, archiveRestorePolicy: 'restore',
      });
      expect(bound.success, bound.error).toBe(true);
      const claimed = await hostInvoke<{ result?: { claim?: { generation: string } } }>(app, 'taskLedger', 'command', {
        workspaceId: project.workspaceId, command: { action: 'claim', sessionKey: project.sessionKey,
          taskNodeId: task.contract.taskNodeId, requestId: `m2-control-claim-${status}` },
      });
      expect(claimed.result?.claim?.generation).toBe(project.generation);
      holdModel = true;
      running = rpc('mission.run', { sessionKey: project.sessionKey, workspaceId: project.workspaceId,
        agentId: 'main', objective: task.contract.objective, maxTicks: 1, maxWorkers: 1,
        includeVerifier: false, enableSchedule: false });
      // Observe the original promise even if a preflight assertion fails.
      void running.catch(() => undefined);
      await expect.poll(() => modelEntered, { timeout: 120_000 }).toBe(true);
      const before = await rpc<{ mission: MissionRunRecord }>('mission.status', { sessionKey: project.sessionKey });
      evidence.before = before;
      expect(before.mission).toMatchObject({ status: 'running', phase: 'execute', sessionKey: project.sessionKey });
      const confirmed = await rpc<{ mission: MissionRunRecord }>(status === 'paused' ? 'mission.pause' : 'mission.cancel', { missionId: before.mission.missionId });
      evidence.confirmed = confirmed;
      expect(confirmed.mission.status).toBe(status);
      releaseModel();
      const settled = await running;
      const persisted = await rpc<{ mission: MissionRunRecord }>('mission.status', { missionId: before.mission.missionId });
      evidence.settled = settled; evidence.persisted = persisted;
      expect(settled.mission.status).toBe(status);
      expect(persisted.mission.status).toBe(status);
      expect(persisted.mission.metadata?.controlRevision).toBe(confirmed.mission.metadata?.controlRevision);
      expect(persisted.mission.taskLoopRunId).toBeTruthy();
      expect(persisted.mission.traceId).toBeTruthy();
      expect(persisted.mission.activeTickId).toBeNull();
      expect(reviewerCalls).toBe(0);
    } catch (error) {
      evidence.error = String(error);
      throw error;
    } finally {
      releaseModel();
      if (running) evidence.runSettlementOnExit = await running.catch(error => ({ error: String(error) }));
      evidence.reviewerCalls = reviewerCalls; evidence.modelEntered = modelEntered;
      evidence.modelRequests = llm.log; evidence.providerAnomalies = llm.anomalies;
      await writeFile(info.outputPath('runtime-control.json'), JSON.stringify(evidence, null, 2));
      await hostInvoke(app, 'gateway', 'stop').catch(() => undefined); await closeElectronApp(app);
      llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
    }
  });
}

test.describe('Mission Control panel', () => {
  test('starts Mission Control through gateway RPC and renders lifecycle state', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        methods: [] as string[],
        missionRuns: 0,
      };

      (globalThis as unknown as { __missionPanelState: typeof state }).__missionPanelState = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
      const emitMission = (payload: Record<string, unknown>) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('agent:mission-lifecycle', payload);
        }
      };

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: { method?: string; params?: Record<string, unknown> };
      }) => {
        const current = (globalThis as unknown as { __missionPanelState: typeof state }).__missionPanelState;

        if (request?.module === 'gateway' && request.action === 'status') {
          return respond(request.id, { state: 'running', port: 18789 });
        }

        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, {
            success: true,
            agents: [{
              id: 'main',
              name: 'Main',
              isDefault: true,
              mainSessionKey: 'agent:main:session',
            }],
          });
        }

        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, { success: true, channels: [] });
        }

        if (request?.module === 'providers') {
          if (request.action === 'accounts') return respond(request.id, { success: true, accounts: [] });
          if (request.action === 'accountKeyInfo') return respond(request.id, { success: true, keyInfo: {} });
          if (request.action === 'vendors') return respond(request.id, { success: true, vendors: [] });
          if (request.action === 'getDefaultAccount') return respond(request.id, { success: true, accountId: null });
        }

        if (request?.module === 'gateway' && request.action === 'rpc') {
          const method = request.payload?.method ?? '';
          current.methods.push(method);

          if (method === 'roles.list') {
            return respond(request.id, {
              roles: [{
                name: 'planner',
                displayName: 'Planner',
                description: 'Plans mission work.',
                rolePrompt: 'Plans mission work.',
                tools: ['read'],
                effort: 'medium',
              }],
            });
          }

          if (method === 'mission.run') {
            current.missionRuns += 1;
            const base = {
              missionId: 'mission-e2e',
              sessionKey: 'agent:main:session',
              agentId: 'main',
              tick: 1,
              ts: Date.now(),
            };
            emitMission({
              ...base,
              phase: 'reflect',
              status: 'running',
              progress: 72,
              taskLoopRunId: 'loop-e2e',
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
            emitMission({
              ...base,
              phase: 'complete',
              status: 'complete',
              progress: 100,
              reviewerDecision: 'complete',
              traceId: 'trace-mission-e2e',
              taskLoopRunId: 'loop-e2e',
              ts: Date.now(),
            });
            return respond(request.id, {
              mission: {
                missionId: 'mission-e2e',
                status: 'complete',
                phase: 'complete',
                tick: 1,
                lastDecision: 'complete',
                traceId: 'trace-mission-e2e',
                taskLoopRunId: 'loop-e2e',
              },
            });
          }
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();

    await page.getByTestId('role-orchestration-toggle').click();
    await page.getByTestId('role-orchestration-task-input').fill('Keep shipping Mission Control safely.');
    await page.getByTestId('role-mission-run').click();

    await expect(page.getByTestId('role-mission-progress')).toContainText('reflect');
    await expect(page.getByTestId('role-mission-progress')).toContainText('complete');
    await expect(page.getByTestId('role-mission-result')).toContainText('Mission complete at complete');
    await expect(page.getByTestId('role-mission-trace')).toContainText('trace-mission-e2e');

    const calls = await electronApp.evaluate(() => {
      const state = (globalThis as unknown as { __missionPanelState?: { methods: string[]; missionRuns: number } }).__missionPanelState;
      return { methods: state?.methods ?? [], missionRuns: state?.missionRuns ?? 0 };
    });
    expect(calls.missionRuns).toBe(1);
    expect(calls.methods).toContain('mission.run');
  });

  for (const holdRun of [false, true]) {
    test(holdRun ? 'keeps pause and cancel available while the Mission request is pending' : 'pauses, resumes, and cancels a Mission from the panel', async ({ electronApp, page }, info) => {
      const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
      if (process.env.CLAWX_M2_EXPECTED_HEAD) { expect(candidate).toBe(process.env.CLAWX_M2_EXPECTED_HEAD); expect(dirty).toBe(''); }
      await electronApp.evaluate(({ ipcMain, BrowserWindow }, pendingRun) => {
        const state = {
          methods: [] as string[],
          controlsWhilePending: [] as string[],
          controlMissionIds: [] as unknown[],
          releaseRun: null as (() => void) | null,
          runSettled: false,
          runBudget: 0,
        };

        (globalThis as unknown as { __missionControlState: typeof state }).__missionControlState = state;

        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
        const emitMission = (status: string, phase = 'schedule', sessionKey = 'agent:main:session', missionId = 'mission-control-e2e') => {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send('agent:mission-lifecycle', {
              missionId,
              sessionKey,
              phase,
              status,
              tick: 1,
              progress: status === 'cancelled' ? 100 : 94,
              ts: Date.now(),
            });
          }
        };

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: { method?: string; params?: Record<string, unknown> };
          deadline?: { timeoutMs?: number };
        }) => {
          const current = (globalThis as unknown as { __missionControlState: typeof state }).__missionControlState;

          if (request?.module === 'gateway' && request.action === 'status') {
            return respond(request.id, { state: 'running', port: 18789 });
          }

          if (request?.module === 'agents' && request.action === 'list') {
            return respond(request.id, {
              success: true,
              agents: [{
                id: 'main',
                name: 'Main',
                isDefault: true,
                mainSessionKey: 'agent:main:session',
              }],
            });
          }

          if (request?.module === 'channels' && request.action === 'accounts') {
            return respond(request.id, { success: true, channels: [] });
          }

          if (request?.module === 'providers') {
            if (request.action === 'accounts') return respond(request.id, { success: true, accounts: [] });
            if (request.action === 'accountKeyInfo') return respond(request.id, { success: true, keyInfo: {} });
            if (request.action === 'vendors') return respond(request.id, { success: true, vendors: [] });
            if (request.action === 'getDefaultAccount') return respond(request.id, { success: true, accountId: null });
          }

          if (request?.module === 'gateway' && request.action === 'rpc') {
            const method = request.payload?.method ?? '';
            current.methods.push(method);
            if (['mission.pause', 'mission.resume', 'mission.cancel'].includes(method)) {
              current.controlMissionIds.push(request.payload?.params?.missionId);
            }

            if (method === 'roles.list') {
              return respond(request.id, { roles: [] });
            }

            if (method === 'mission.run') {
              current.runBudget = request.deadline?.timeoutMs ?? 0;
              emitMission('blocked', 'blocked', 'agent:main:foreign', 'foreign-mission');
              emitMission(pendingRun ? 'running' : 'sleeping', pendingRun ? 'execute' : 'schedule');
              if (pendingRun) await new Promise<void>((resolve) => { current.releaseRun = resolve; });
              current.runSettled = true;
              return respond(request.id, {
                mission: {
                  missionId: 'mission-control-e2e',
                  // Deliver the pre-control snapshot after accepted controls to test stale-response fencing.
                  status: pendingRun ? 'running' : 'sleeping',
                  phase: pendingRun ? 'execute' : 'schedule',
                  tick: 1,
                },
              });
            }

            if (method === 'mission.pause') {
              if (!current.runSettled) current.controlsWhilePending.push(method);
              emitMission('paused');
              return respond(request.id, { mission: { missionId: 'mission-control-e2e', status: 'paused', phase: 'schedule', tick: 1 } });
            }

            if (method === 'mission.resume') {
              emitMission('sleeping');
              return respond(request.id, { mission: { missionId: 'mission-control-e2e', status: 'sleeping', phase: 'schedule', tick: 1 } });
            }

            if (method === 'mission.cancel') {
              if (!current.runSettled) current.controlsWhilePending.push(method);
              emitMission('cancelled', 'blocked');
              return respond(request.id, { mission: { missionId: 'mission-control-e2e', status: 'cancelled', phase: 'blocked', tick: 1 } });
            }
          }

          return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
        });
      }, holdRun);

      await completeSetup(page);
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-agents').click();
      await page.getByTestId('role-orchestration-toggle').click();
      await page.getByTestId('role-orchestration-task-input').fill('Schedule this mission.');
      await page.getByTestId('role-mission-run').click();

      try {
        await expect(page.getByTestId('role-mission-result')).toContainText(holdRun ? 'Mission running' : 'Mission sleeping');
        await expect(page.getByTestId('role-mission-pause')).toBeEnabled();
        if (holdRun) {
          await expect(page.getByTestId('role-mission-run')).toBeDisabled();
          await expect(page.getByTestId('role-mission-run')).toHaveAttribute('aria-busy', 'true');
        }
        await page.getByTestId('role-mission-pause').click();
        await expect(page.getByTestId('role-mission-result')).toContainText('Mission paused');
        if (holdRun) {
          await expect(page.getByTestId('role-mission-resume')).toBeDisabled();
          await expect(page.getByTestId('role-mission-cancel')).toBeEnabled();
        } else {
          await page.getByTestId('role-mission-resume').click();
          await expect(page.getByTestId('role-mission-result')).toContainText('Mission sleeping');
        }
        await page.getByTestId('role-mission-cancel').click();
        await expect(page.getByTestId('role-mission-result')).toContainText('Mission cancelled');
      } finally {
        if (holdRun) await electronApp.evaluate(() => {
          (globalThis as unknown as { __missionControlState?: { releaseRun?: (() => void) | null } }).__missionControlState?.releaseRun?.();
        });
      }
      await expect(page.getByTestId('role-mission-run')).toBeEnabled();
      await expect(page.getByTestId('role-mission-run')).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByTestId('role-mission-result')).toContainText('Mission cancelled');

      const calls = await electronApp.evaluate(() => {
        const state = (globalThis as unknown as { __missionControlState?: { methods: string[]; controlsWhilePending: string[]; controlMissionIds: unknown[]; runSettled: boolean; runBudget: number } }).__missionControlState;
        return { methods: state?.methods ?? [], controlsWhilePending: state?.controlsWhilePending ?? [], controlMissionIds: state?.controlMissionIds ?? [], runSettled: state?.runSettled, runBudget: state?.runBudget };
      });
      expect(calls.methods).toEqual(expect.arrayContaining(holdRun ? ['mission.run', 'mission.pause', 'mission.cancel'] : ['mission.run', 'mission.pause', 'mission.resume', 'mission.cancel']));
      expect(calls.controlsWhilePending).toEqual(holdRun ? ['mission.pause', 'mission.cancel'] : []);
      expect(calls.controlMissionIds).toEqual(Array(holdRun ? 2 : 3).fill('mission-control-e2e'));
      expect(calls.runSettled).toBe(true);
      expect(calls.runBudget).toBe(15 * 60_000);
      await writeFile(info.outputPath('mission-control-ui.json'), JSON.stringify({ driven_by: 'agent', actor: 'm2-mission-ui-verifier',
        realHumanEvidence: false, provider: 'host-rpc-stub', candidate, dirty, holdRun, calls, status: 'passed', finalMissionStatus: 'cancelled' }, null, 2));
    });
  }

  test('refreshes Mission scope when the default Agent changes', async ({ electronApp, page }, info) => {
    const candidate = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    if (process.env.CLAWX_M2_EXPECTED_HEAD) { expect(candidate).toBe(process.env.CLAWX_M2_EXPECTED_HEAD); expect(dirty).toBe(''); }
    await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = { defaultAgent: 'main', requests: [] as Array<{ method: string; params: Record<string, unknown> }>,
        releaseOldRun: null as (() => void) | null, oldRunSettled: false };
      (globalThis as unknown as { __missionScopeState: typeof state }).__missionScopeState = state;
      const original = (ipcMain as unknown as { _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id, ok: true, data });
      const emit = (missionId: string, sessionKey: string, status: string) => {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent:mission-lifecycle', {
          missionId, sessionKey, status, phase: 'execute', tick: 1, ts: Date.now(), traceId: `trace-${missionId}`,
        });
      };
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: { id?: string; module?: string; action?: string; payload?: { method?: string; params?: Record<string, unknown> } }) => {
        if (request.module === 'gateway' && request.action === 'status') return respond(request.id, { state: 'running', port: 18789 });
        if (request.module === 'agents' && request.action === 'list') return respond(request.id, {
          success: true, agents: ['main', 'other'].map(id => ({ id, name: id, isDefault: id === state.defaultAgent, mainSessionKey: `agent:${id}:scope` })),
        });
        if (request.module === 'channels' && request.action === 'accounts') return respond(request.id, { success: true, channels: [] });
        if (request.module === 'providers') {
          if (request.action === 'accounts') return respond(request.id, { success: true, accounts: [] });
          if (request.action === 'vendors') return respond(request.id, { success: true, vendors: [] });
          if (request.action === 'getDefaultAccount') return respond(request.id, { success: true, accountId: null });
          if (request.action === 'accountKeyInfo') return respond(request.id, { success: true, keyInfo: {} });
        }
        if (request.module === 'gateway' && request.action === 'rpc') {
          const method = request.payload?.method ?? ''; const params = request.payload?.params ?? {};
          if (method === 'roles.list') return respond(request.id, { roles: [] });
          if (method === 'mission.run') {
            state.requests.push({ method, params });
            const old = params.sessionKey === 'agent:main:scope'; const id = old ? 'scope-a' : 'scope-b';
            emit(id, String(params.sessionKey), 'running');
            if (old) { await new Promise<void>(resolve => { state.releaseOldRun = resolve; }); state.oldRunSettled = true; }
            return respond(request.id, { mission: { missionId: id, status: old ? 'complete' : 'running', phase: 'execute', tick: 1, traceId: `trace-${id}` } });
          }
          if (method === 'mission.pause') {
            state.requests.push({ method, params });
            if (params.missionId !== 'scope-b') return { id: request.id, ok: false, error: { code: 'SCOPE_MISMATCH', message: 'Control reached the previous session' } };
            emit('scope-b', 'agent:other:scope', 'paused');
            return respond(request.id, { mission: { missionId: 'scope-b', status: 'paused', phase: 'execute', tick: 1, traceId: 'trace-scope-b' } });
          }
        }
        return original?.(event, request) ?? respond(request.id, {});
      });
    });
    await completeSetup(page);
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-agents').click();
    await page.getByTestId('role-orchestration-toggle').click();
    await page.getByTestId('role-orchestration-task-input').fill('Keep each Mission in its own session.');
    await page.getByTestId('role-mission-run').click();
    try {
      await expect(page.getByTestId('role-mission-trace')).toHaveText('trace-scope-a');
      await electronApp.evaluate(() => { (globalThis as unknown as { __missionScopeState: { defaultAgent: string } }).__missionScopeState.defaultAgent = 'other'; });
      await page.getByTestId('agents-page').getByRole('button', { name: 'Refresh', exact: true }).first().click();
      await expect(page.getByTestId('role-mission-result')).toHaveCount(0);
      await expect(page.getByTestId('role-mission-run')).toBeEnabled();
      await page.getByTestId('role-mission-run').click();
      await expect(page.getByTestId('role-mission-trace')).toHaveText('trace-scope-b');
      await electronApp.evaluate(() => { (globalThis as unknown as { __missionScopeState: { releaseOldRun?: (() => void) | null } }).__missionScopeState.releaseOldRun?.(); });
      await expect.poll(() => electronApp.evaluate(() => (globalThis as unknown as { __missionScopeState: { oldRunSettled: boolean } }).__missionScopeState.oldRunSettled)).toBe(true);
      await page.getByTestId('role-mission-pause').click();
      await expect(page.getByTestId('role-mission-result')).toContainText('Mission paused');
      await expect(page.getByTestId('role-mission-trace')).toHaveText('trace-scope-b');
      const requests = await electronApp.evaluate(() => (globalThis as unknown as { __missionScopeState: { requests: Array<{ method: string; params: Record<string, unknown> }> } }).__missionScopeState.requests);
      expect(requests.filter(row => row.method === 'mission.run')).toEqual([
        { method: 'mission.run', params: expect.objectContaining({ sessionKey: 'agent:main:scope', agentId: 'main' }) },
        { method: 'mission.run', params: expect.objectContaining({ sessionKey: 'agent:other:scope', agentId: 'other' }) },
      ]);
      expect(requests.filter(row => row.method === 'mission.run')[1].params).not.toHaveProperty('missionId');
      expect(requests.filter(row => row.method === 'mission.pause')).toEqual([{ method: 'mission.pause', params: { missionId: 'scope-b' } }]);
      await writeFile(info.outputPath('mission-scope-refresh.json'), JSON.stringify({ driven_by: 'agent', actor: 'm2-mission-scope-verifier',
        realHumanEvidence: false, provider: 'host-rpc-stub', candidate, dirty, requests, status: 'passed' }, null, 2));
    } finally {
      await electronApp.evaluate(() => { (globalThis as unknown as { __missionScopeState: { releaseOldRun?: (() => void) | null } }).__missionScopeState.releaseOldRun?.(); });
    }
  });
});
