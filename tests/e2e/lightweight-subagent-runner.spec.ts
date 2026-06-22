import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Lightweight Subagent Runner', () => {
  test('starts Explorer preset and renders lifecycle, summary, and trace link', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        methods: [] as string[],
        runs: 0,
      };
      (globalThis as unknown as { __subagentRunnerState: typeof state }).__subagentRunnerState = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
      const emitSubagent = (payload: Record<string, unknown>) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('agent:subagent-lifecycle', payload);
        }
      };

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: { method?: string; params?: Record<string, unknown> };
      }) => {
        const current = (globalThis as unknown as { __subagentRunnerState: typeof state }).__subagentRunnerState;

        if (request?.module === 'gateway' && request.action === 'status') {
          return respond(request.id, { state: 'running', port: 18789 });
        }
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, {
            success: true,
            agents: [{ id: 'main', name: 'Main', isDefault: true, mainSessionKey: 'agent:main:session' }],
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
        if (request?.module === 'observability' && request.action === 'queryTraces') {
          return respond(request.id, {
            generatedAt: Date.now(),
            items: [{ id: 'trace-explorer-e2e', status: 'completed', updatedAt: Date.now(), sourceStatus: 'live', issues: [], correlation: { traceId: 'trace-explorer-e2e' } }],
            total: 1,
            page: 1,
            pageSize: 1,
            facets: { status: [], agent: [], role: [], model: [], sourceStatus: [] },
          });
        }
        if (request?.module === 'gateway' && request.action === 'rpc') {
          const method = request.payload?.method ?? '';
          current.methods.push(method);
          if (method === 'roles.list') {
            return respond(request.id, { roles: [{ name: 'planner', displayName: 'Planner', tools: ['read'], effort: 'medium' }] });
          }
          if (method === 'orchestrator.run') {
            current.runs += 1;
            const workers = Array.isArray(request.payload?.params?.workers) ? request.payload.params.workers as Array<{ roleName: string; task: string; label?: string }> : [];
            for (const [index, worker] of workers.entries()) {
              emitSubagent({ roleName: worker.roleName, task: worker.task, status: 'started', ts: Date.now() });
              emitSubagent({ roleName: worker.roleName, task: worker.task, status: 'completed', childRunId: `child-${index + 1}`, ts: Date.now() });
            }
            return respond(request.id, {
              orchestrationRunId: 'orch-explorer-e2e',
              spawnedRunIds: ['child-1', 'child-2'],
              failures: [],
              plan: { workers },
            });
          }
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-agents').click();
    await page.getByTestId('role-orchestration-toggle').click();
    await expect(page.getByTestId('subagent-runner-panel')).toBeVisible();

    await page.getByTestId('subagent-runner-goal').fill('Find a safe implementation path.');
    await page.getByTestId('subagent-runner-start').click();

    await expect(page.getByTestId('subagent-runner-event').first()).toContainText('Options');
    await expect(page.getByTestId('subagent-runner-result')).toContainText('Explorer complete');
    await expect(page.getByTestId('subagent-runner-run-id')).toContainText('orch-explorer-e2e');
    await expect(page.getByTestId('subagent-runner-trace')).toHaveAttribute('href', '#/observability?traceId=trace-explorer-e2e');

    const calls = await electronApp.evaluate(() => {
      const state = (globalThis as unknown as { __subagentRunnerState?: { methods: string[]; runs: number } }).__subagentRunnerState;
      return { methods: state?.methods ?? [], runs: state?.runs ?? 0 };
    });
    expect(calls.runs).toBe(1);
    expect(calls.methods).toContain('orchestrator.run');
  });

  test('starts Reviewer preset with current diff', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
      const state = {
        reviewerTask: '',
        runs: 0,
      };
      (globalThis as unknown as { __subagentReviewerState: typeof state }).__subagentReviewerState = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
      const emitSubagent = (payload: Record<string, unknown>) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send('agent:subagent-lifecycle', payload);
        }
      };

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: { method?: string; params?: Record<string, unknown>; mode?: string };
      }) => {
        const current = (globalThis as unknown as { __subagentReviewerState: typeof state }).__subagentReviewerState;

        if (request?.module === 'gateway' && request.action === 'status') return respond(request.id, { state: 'running', port: 18789 });
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, { success: true, agents: [{ id: 'main', name: 'Main', isDefault: true, mainSessionKey: 'agent:main:session' }] });
        }
        if (request?.module === 'channels' && request.action === 'accounts') return respond(request.id, { success: true, channels: [] });
        if (request?.module === 'providers') {
          if (request.action === 'accounts') return respond(request.id, { success: true, accounts: [] });
          if (request.action === 'accountKeyInfo') return respond(request.id, { success: true, keyInfo: {} });
          if (request.action === 'vendors') return respond(request.id, { success: true, vendors: [] });
          if (request.action === 'getDefaultAccount') return respond(request.id, { success: true, accountId: null });
        }
        if (request?.module === 'git' && request.action === 'diff') {
          const mode = request.payload?.mode;
          return respond(request.id, {
            success: true,
            changes: [],
            patch: mode === 'unstaged' ? 'diff --git a/src/App.tsx b/src/App.tsx\n+new UI' : '',
          });
        }
        if (request?.module === 'observability' && request.action === 'queryTraces') {
          return respond(request.id, {
            generatedAt: Date.now(),
            items: [{ id: 'trace-reviewer-e2e', status: 'completed', updatedAt: Date.now(), sourceStatus: 'live', issues: [], correlation: { traceId: 'trace-reviewer-e2e' } }],
            total: 1,
            page: 1,
            pageSize: 1,
            facets: { status: [], agent: [], role: [], model: [], sourceStatus: [] },
          });
        }
        if (request?.module === 'gateway' && request.action === 'rpc') {
          const method = request.payload?.method ?? '';
          if (method === 'roles.list') return respond(request.id, { roles: [{ name: 'reviewer', displayName: 'Reviewer', tools: ['read'], effort: 'high' }] });
          if (method === 'orchestrator.run') {
            current.runs += 1;
            const workers = request.payload?.params?.workers as Array<{ roleName: string; task: string; label?: string }>;
            current.reviewerTask = workers[0]?.task ?? '';
            emitSubagent({ roleName: 'reviewer', task: workers[0]?.task, status: 'started', ts: Date.now() });
            emitSubagent({ roleName: 'reviewer', task: workers[0]?.task, status: 'completed', childRunId: 'reviewer-child', ts: Date.now() });
            return respond(request.id, {
              orchestrationRunId: 'orch-reviewer-e2e',
              spawnedRunIds: ['reviewer-child'],
              failures: [],
              plan: { workers },
            });
          }
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-agents').click();
    await page.getByTestId('role-orchestration-toggle').click();
    await page.getByTestId('subagent-runner-preset').click();
    await page.getByRole('option', { name: 'Reviewer' }).click();
    await page.getByTestId('subagent-runner-goal').fill('Review this UI change.');
    await page.getByTestId('subagent-runner-start').click();

    await expect(page.getByTestId('subagent-runner-event').first()).toContainText('Diff review');
    await expect(page.getByTestId('subagent-runner-result')).toContainText('Reviewer complete');
    await expect(page.getByTestId('subagent-runner-trace')).toHaveAttribute('href', '#/observability?traceId=trace-reviewer-e2e');

    const state = await electronApp.evaluate(() => {
      return (globalThis as unknown as { __subagentReviewerState?: { reviewerTask: string; runs: number } }).__subagentReviewerState;
    });
    expect(state?.runs).toBe(1);
    expect(state?.reviewerTask).toContain('diff --git');
  });

  test('shows failure when Reviewer has no current diff', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const state = { runs: 0 };
      (globalThis as unknown as { __subagentNoDiffState: typeof state }).__subagentNoDiffState = state;
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: { method?: string; mode?: string };
      }) => {
        const current = (globalThis as unknown as { __subagentNoDiffState: typeof state }).__subagentNoDiffState;
        if (request?.module === 'gateway' && request.action === 'status') return respond(request.id, { state: 'running', port: 18789 });
        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, { success: true, agents: [{ id: 'main', name: 'Main', isDefault: true, mainSessionKey: 'agent:main:session' }] });
        }
        if (request?.module === 'channels' && request.action === 'accounts') return respond(request.id, { success: true, channels: [] });
        if (request?.module === 'providers') {
          if (request.action === 'accounts') return respond(request.id, { success: true, accounts: [] });
          if (request.action === 'accountKeyInfo') return respond(request.id, { success: true, keyInfo: {} });
          if (request.action === 'vendors') return respond(request.id, { success: true, vendors: [] });
          if (request.action === 'getDefaultAccount') return respond(request.id, { success: true, accountId: null });
        }
        if (request?.module === 'git' && request.action === 'diff') return respond(request.id, { success: true, changes: [], patch: '' });
        if (request?.module === 'gateway' && request.action === 'rpc') {
          if (request.payload?.method === 'roles.list') return respond(request.id, { roles: [{ name: 'reviewer', displayName: 'Reviewer', tools: ['read'], effort: 'high' }] });
          if (request.payload?.method === 'orchestrator.run') current.runs += 1;
        }
        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-agents').click();
    await page.getByTestId('role-orchestration-toggle').click();
    await page.getByTestId('subagent-runner-preset').click();
    await page.getByRole('option', { name: 'Reviewer' }).click();
    await page.getByTestId('subagent-runner-goal').fill('Review this UI change.');
    await page.getByTestId('subagent-runner-start').click();

    await expect(page.getByTestId('subagent-runner-failure')).toContainText('No staged or unstaged diff');
    const runs = await electronApp.evaluate(() => {
      return (globalThis as unknown as { __subagentNoDiffState?: { runs: number } }).__subagentNoDiffState?.runs ?? 0;
    });
    expect(runs).toBe(0);
  });
});
