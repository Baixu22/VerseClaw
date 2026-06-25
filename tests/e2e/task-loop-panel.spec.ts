import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Agent task loop panel', () => {
  test('starts a task loop through gateway RPC and renders lifecycle state', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        methods: [] as string[],
        taskLoopRuns: 0,
      };

      (globalThis as unknown as { __taskLoopPanelState: typeof state }).__taskLoopPanelState = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
      const emitTaskLoop = (payload: Record<string, unknown>) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('agent:task-loop-lifecycle', payload);
        }
      };

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: { method?: string; params?: Record<string, unknown> };
      }) => {
        const current = (globalThis as unknown as { __taskLoopPanelState: typeof state }).__taskLoopPanelState;

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
                description: 'Plans task-loop work.',
                rolePrompt: 'Plans task-loop work.',
                tools: ['read'],
                effort: 'medium',
              }],
            });
          }

          if (method === 'task_loop.run') {
            current.taskLoopRuns += 1;
            const base = {
              loopRunId: 'loop-e2e',
              sessionKey: 'agent:main:session',
              iteration: 1,
              orchestrationRunId: 'orch-e2e',
              activeRoles: ['implementer', 'tester', 'reviewer'],
              evidenceGate: {
                status: 'pass',
                reasons: [],
                workerCount: 3,
                failedWorkerCount: 0,
                unverifiableWorkerCount: 0,
              },
              roleQualitySummary: {
                good: 3,
                needsAttention: 0,
                poorAttempt: 0,
              },
              filesTouched: ['src/task-loop-controller.ts'],
              testsRun: ['pnpm exec vitest run tests/unit/task-loop-controller.test.ts'],
              ts: Date.now(),
            };
            emitTaskLoop({
              ...base,
              phase: 'self_check',
              status: 'running',
              progress: 72,
            });
            await new Promise((resolve) => setTimeout(resolve, 1500));
            emitTaskLoop({
              ...base,
              phase: 'complete',
              status: 'complete',
              progress: 100,
              selfCheckDecision: 'complete',
              ts: Date.now(),
            });
            return respond(request.id, {
              loop: {
                loopRunId: 'loop-e2e',
                status: 'complete',
                phase: 'complete',
                traceId: 'trace-loop-e2e',
                evidenceGate: {
                  status: 'pass',
                  reasons: [],
                  workerCount: 3,
                  failedWorkerCount: 0,
                  unverifiableWorkerCount: 0,
                  filesTouched: ['src/task-loop-controller.ts'],
                  testsRun: ['pnpm exec vitest run tests/unit/task-loop-controller.test.ts'],
                },
                roleQualitySummary: {
                  good: 3,
                  needsAttention: 0,
                  poorAttempt: 0,
                  roles: [],
                },
              },
            });
          }
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.evaluate(() => {
      window.location.hash = '#/settings/agents';
    });
    await expect(page.getByTestId('agents-page')).toBeVisible();

    await page.getByTestId('role-orchestration-toggle').click();
    await page.getByTestId('role-orchestration-task-input').fill('Ship the task loop MVP safely.');
    await page.getByTestId('role-task-loop-run').click();

    await expect(page.getByTestId('role-task-loop-event')).toContainText('self_check');
    await expect(page.getByTestId('role-task-loop-event')).toContainText('running');
    await expect(page.getByTestId('role-task-loop-event')).toContainText('complete');
    await expect(page.getByTestId('role-task-loop-result')).toContainText('Task loop complete at complete');
    await expect(page.getByTestId('role-task-loop-result-gate')).toContainText('pass');
    await expect(page.getByTestId('role-task-loop-result-quality')).toContainText('3/0/0');
    await expect(page.getByTestId('role-task-loop-files')).toContainText('1');
    await expect(page.getByTestId('role-task-loop-tests')).toContainText('1');
    await expect(page.getByTestId('role-task-loop-trace')).toContainText('trace-loop-e2e');

    const calls = await electronApp.evaluate(() => {
      const state = (globalThis as unknown as { __taskLoopPanelState?: { methods: string[]; taskLoopRuns: number } }).__taskLoopPanelState;
      return { methods: state?.methods ?? [], taskLoopRuns: state?.taskLoopRuns ?? 0 };
    });
    expect(calls.taskLoopRuns).toBe(1);
    expect(calls.methods).toContain('task_loop.run');
  });
});
