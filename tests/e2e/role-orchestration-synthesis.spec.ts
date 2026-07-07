import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Role orchestration synthesis', () => {
  test('renders P4 synthesis with verifier and evidence detail after a run', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: {
        id?: string;
        module?: string;
        action?: string;
        payload?: { method?: string; params?: Record<string, unknown> };
      }) => {
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
              mainSessionKey: 'agent:main:synthesis',
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
          const method = request.payload?.method;

          if (method === 'roles.list') {
            return respond(request.id, {
              roles: [{
                name: 'planner',
                displayName: 'Planner',
                description: 'Plans bounded orchestration.',
                rolePrompt: 'Plans bounded orchestration.',
                tools: ['read'],
                effort: 'medium',
              }],
            });
          }

          if (method === 'orchestrator.run') {
            return respond(request.id, {
              orchestrationRunId: 'orch_e2e_synthesis',
              spawnedRunIds: ['run_worker_1'],
              failures: [{ roleName: 'tester', error: 'regression test missing' }],
              synthesis: {
                schemaVersion: 1,
                orchestrationRunId: 'orch_e2e_synthesis',
                taskGraphId: 'graph_e2e_synthesis',
                status: 'failed',
                summary: 'Verifier failed; 1 failure, 2 evidence refs, 1 trace.',
                roleContributions: [
                  { roleName: 'planner', task: 'Plan', status: 'completed', phase: 'worker', evidenceRefs: [{ type: 'trace', ref: 'trace:planner' }] },
                ],
                evidenceRefs: [{ type: 'trace', ref: 'trace:planner' }, { type: 'test', ref: 'vitest:missing' }],
                artifactRefs: [],
                visibleFailures: [{ code: 'missing_required_test', message: 'regression test missing', roleName: 'tester', evidenceRefs: [] }],
                verifier: { decision: 'fail', evidenceRefs: [{ type: 'test', ref: 'vitest:missing' }], reasons: [] },
                traceIds: ['trace_e2e_synthesis'],
                policy: { toolAccess: 'none', verifierAuthority: 'preserved', memoryWrite: 'none' },
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
    await page.getByTestId('role-orchestration-task-input').fill('Summarize verified orchestration evidence');
    await page.getByRole('button', { name: /^Run$/ }).click();

    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Verifier failed');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('fail');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Evidence: 2');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Traces: 1');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('regression test missing');
  });
});
