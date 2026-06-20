import { completeSetup, expect, test } from './fixtures/electron';

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
    await page.getByTestId('sidebar-nav-agents').click();
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

  test('pauses, resumes, and cancels a Mission from the panel', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        methods: [] as string[],
      };

      (globalThis as unknown as { __missionControlState: typeof state }).__missionControlState = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
      const emitMission = (status: string, phase = 'schedule') => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('agent:mission-lifecycle', {
            missionId: 'mission-control-e2e',
            sessionKey: 'agent:main:session',
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

          if (method === 'roles.list') {
            return respond(request.id, { roles: [] });
          }

          if (method === 'mission.run') {
            emitMission('sleeping');
            return respond(request.id, {
              mission: {
                missionId: 'mission-control-e2e',
                status: 'sleeping',
                phase: 'schedule',
                tick: 1,
              },
            });
          }

          if (method === 'mission.pause') {
            emitMission('paused');
            return respond(request.id, { mission: { missionId: 'mission-control-e2e', status: 'paused', phase: 'schedule', tick: 1 } });
          }

          if (method === 'mission.resume') {
            emitMission('sleeping');
            return respond(request.id, { mission: { missionId: 'mission-control-e2e', status: 'sleeping', phase: 'schedule', tick: 1 } });
          }

          if (method === 'mission.cancel') {
            emitMission('cancelled', 'blocked');
            return respond(request.id, { mission: { missionId: 'mission-control-e2e', status: 'cancelled', phase: 'blocked', tick: 1 } });
          }
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-agents').click();
    await page.getByTestId('role-orchestration-toggle').click();
    await page.getByTestId('role-orchestration-task-input').fill('Schedule this mission.');
    await page.getByTestId('role-mission-run').click();

    await expect(page.getByTestId('role-mission-result')).toContainText('Mission sleeping');
    await page.getByTestId('role-mission-pause').click();
    await expect(page.getByTestId('role-mission-result')).toContainText('Mission paused');
    await page.getByTestId('role-mission-resume').click();
    await expect(page.getByTestId('role-mission-result')).toContainText('Mission sleeping');
    await page.getByTestId('role-mission-cancel').click();
    await expect(page.getByTestId('role-mission-result')).toContainText('Mission cancelled');

    const calls = await electronApp.evaluate(() => {
      const state = (globalThis as unknown as { __missionControlState?: { methods: string[] } }).__missionControlState;
      return state?.methods ?? [];
    });
    expect(calls).toEqual(expect.arrayContaining(['mission.run', 'mission.pause', 'mission.resume', 'mission.cancel']));
  });
});
