import type { ElectronApplication, Page } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Role orchestration synthesis', () => {
  async function mockRoleOrchestrationRun(electronApp: ElectronApplication, synthesis: Record<string, unknown>, failures: Array<{ roleName: string; error?: string }> = []) {
    await electronApp.evaluate(({ ipcMain }, mock) => {
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
              failures: mock.failures,
              synthesis: mock.synthesis,
            });
          }
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, {});
      });
    }, { synthesis, failures });
  }

  async function runRoleOrchestration(page: Page, task: string) {
    await completeSetup(page);
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();

    await page.getByTestId('role-orchestration-toggle').click();
    await page.getByTestId('role-orchestration-task-input').fill(task);
    await page.getByRole('button', { name: /^Run$/ }).click();
  }

  test('shows pending execution and verification after an accepted dispatch', async ({ electronApp, page }, testInfo) => {
    await mockRoleOrchestrationRun(electronApp, {
      schemaVersion: 1, orchestrationRunId: 'orch_e2e_pending', taskGraphId: 'graph_e2e_pending',
      status: 'pending', summary: 'Execution or verification is pending; 1 role receipt(s).',
      roleContributions: [{ roleName: 'planner', task: 'Plan', status: 'accepted', phase: 'worker', evidenceRefs: [] }],
      evidenceRefs: [], artifactRefs: [], visibleFailures: [],
      verifier: { decision: 'not_required', evidenceRefs: [], reasons: [] }, traceIds: [],
      policy: { toolAccess: 'none', verifierAuthority: 'preserved', memoryWrite: 'none' },
    });
    await runRoleOrchestration(page, 'Show the current execution receipt');
    const synthesis = page.getByTestId('role-orchestration-synthesis');
    await expect(synthesis).toContainText('Pending');
    await expect(synthesis).toContainText('Waiting for execution or verification results.');
    await expect(synthesis).not.toContainText('Verified result');
    await synthesis.scrollIntoViewIfNeeded();
    await synthesis.screenshot({ path: testInfo.outputPath('pending-synthesis.png') });
  });

  test('renders P4 synthesis with verifier failure and evidence detail after a run', async ({ electronApp, page }) => {
    await mockRoleOrchestrationRun(
      electronApp,
      {
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
        blackboardSummary: {
          entryCount: 2,
          unresolvedConflicts: 0,
          openQuestions: 0,
          openRisks: 1,
          memoryProposals: 0,
          evidenceRefs: ['trace:planner'],
          trustBoundaries: ['role-output'],
        },
        policy: { toolAccess: 'none', verifierAuthority: 'preserved', memoryWrite: 'none' },
      },
      [{ roleName: 'tester', error: 'regression test missing' }],
    );

    await runRoleOrchestration(page, 'Summarize verified orchestration evidence');

    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Verifier failed');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('fail');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Evidence: 2');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Traces: 1');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('trace:planner');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('planner');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Blackboard: 2');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Risks: 1');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('regression test missing');
  });

  test('renders verified synthesis with concrete role, evidence, verifier, trace, and blackboard detail', async ({ electronApp, page }) => {
    await mockRoleOrchestrationRun(electronApp, {
      schemaVersion: 1,
      orchestrationRunId: 'orch_e2e_success',
      taskGraphId: 'graph_e2e_success',
      status: 'verified',
      summary: 'Verified result; 2 role contributions, 2 evidence refs, 0 artifacts.',
      roleContributions: [
        { roleName: 'implementer', task: 'Implement', status: 'completed', phase: 'worker', evidenceRefs: [{ type: 'trace', ref: 'trace:implementer' }] },
        { roleName: 'tester', task: 'Verify', status: 'completed', phase: 'worker', evidenceRefs: [{ type: 'test', ref: 'vitest:pass' }] },
      ],
      evidenceRefs: [{ type: 'trace', ref: 'trace:implementer' }, { type: 'test', ref: 'vitest:pass' }],
      artifactRefs: [],
      visibleFailures: [],
      verifier: { decision: 'pass', evidenceRefs: [{ type: 'test', ref: 'vitest:pass' }], reasons: [] },
      traceIds: ['trace_e2e_success'],
      blackboardSummary: {
        entryCount: 2,
        unresolvedConflicts: 0,
        openQuestions: 0,
        openRisks: 0,
        memoryProposals: 0,
        evidenceRefs: ['trace:implementer', 'vitest:pass'],
        trustBoundaries: ['role-output'],
      },
      policy: { toolAccess: 'none', verifierAuthority: 'preserved', memoryWrite: 'none' },
    });

    await runRoleOrchestration(page, 'Show verified orchestration detail');

    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Verified result');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('pass');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('implementer');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('tester');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('vitest:pass');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('trace_e2e_success');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Blackboard: 2');
  });

  test('renders repair-required synthesis without presenting it as verified success', async ({ electronApp, page }) => {
    await mockRoleOrchestrationRun(electronApp, {
      schemaVersion: 1,
      orchestrationRunId: 'orch_e2e_repair',
      taskGraphId: 'graph_e2e_repair',
      status: 'repair_required',
      summary: 'Repair required; bounded attempt 1 must add verifier evidence before completion.',
      roleContributions: [
        { roleName: 'implementer', task: 'Repair evidence gap', status: 'repair_required', phase: 'worker', evidenceRefs: [{ type: 'trace', ref: 'trace:repair-worker' }] },
        { roleName: 'tester', task: 'Verify repair evidence', status: 'blocked', phase: 'verifier', evidenceRefs: [{ type: 'test', ref: 'vitest:repair-needed' }] },
      ],
      evidenceRefs: [{ type: 'trace', ref: 'trace:repair-worker' }, { type: 'test', ref: 'vitest:repair-needed' }],
      artifactRefs: [],
      visibleFailures: [{ code: 'repair_needed', message: 'bounded repair attempt 1 required', roleName: 'tester', evidenceRefs: [{ type: 'test', ref: 'vitest:repair-needed' }] }],
      verifier: { decision: 'repair_required', evidenceRefs: [{ type: 'test', ref: 'vitest:repair-needed' }], reasons: [{ code: 'repair_needed', message: 'bounded repair attempt 1 required', evidenceRefs: [] }] },
      traceIds: ['trace_e2e_repair'],
      policy: { toolAccess: 'none', verifierAuthority: 'preserved', memoryWrite: 'none' },
    });

    await runRoleOrchestration(page, 'Show bounded repair orchestration evidence');

    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Repair required');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('repair_required');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Evidence: 2');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Traces: 1');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Roles: 2');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('bounded repair attempt 1 required');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Policy: tools none / verifier preserved / memory none');
    await expect(page.getByTestId('role-orchestration-synthesis')).not.toContainText('Verified result');
  });

  test('renders repair-after-success as verified while keeping repair evidence visible', async ({ electronApp, page }) => {
    await mockRoleOrchestrationRun(electronApp, {
      schemaVersion: 1,
      orchestrationRunId: 'orch_e2e_repair_success',
      taskGraphId: 'graph_e2e_repair_success',
      status: 'verified',
      summary: 'Verified result after bounded repair; verifier evidence is present.',
      roleContributions: [
        { roleName: 'implementer', task: 'Repair evidence gap', status: 'completed', phase: 'worker', evidenceRefs: [{ type: 'trace', ref: 'trace:repair-success' }] },
        { roleName: 'tester', task: 'Verify repair', status: 'completed', phase: 'verifier', evidenceRefs: [{ type: 'test', ref: 'vitest:repair-pass' }] },
      ],
      evidenceRefs: [{ type: 'trace', ref: 'trace:repair-success' }, { type: 'test', ref: 'vitest:repair-pass' }],
      artifactRefs: [],
      visibleFailures: [],
      verifier: { decision: 'pass', evidenceRefs: [{ type: 'test', ref: 'vitest:repair-pass' }], reasons: [] },
      traceIds: ['trace_e2e_repair_success'],
      blackboardSummary: {
        entryCount: 2,
        unresolvedConflicts: 0,
        openQuestions: 0,
        openRisks: 0,
        memoryProposals: 0,
        evidenceRefs: ['trace:repair-success', 'vitest:repair-pass'],
        trustBoundaries: ['role-output'],
      },
      policy: { toolAccess: 'none', verifierAuthority: 'preserved', memoryWrite: 'none' },
    });

    await runRoleOrchestration(page, 'Show successful repair orchestration evidence');

    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Verified result after bounded repair');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('vitest:repair-pass');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('trace_e2e_repair_success');
    await expect(page.getByTestId('role-orchestration-synthesis')).toContainText('Blackboard: 2');
  });
});
