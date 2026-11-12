import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, publishGatewayStatus, test } from './fixtures/electron';
import { hostInvoke } from './fixtures/fp-p1-harness';
import type { RoleContract } from '../../openclaw_runtime/src/agents/role-contract';
import type { OrchestrationRunResult } from '../../openclaw_runtime/src/agents/orchestrator-run-observed';
import type { SessionDelegationAdmission } from '../../shared/types/session-delegation';
import { createEmptySessionActivitySnapshot } from '../../shared/types/session-activity';

// Agent-driven UI proof: real scheduler + receipt builder, Host fixture delivery.
// No live worker is launched and no OS capacity exhaustion is claimed.
test('U2 shows owner-generated dispatch capacity reasons and opens resource storage', async ({ launchElectronApp }, testInfo) => {
  const [{ scheduleResourceAwareWaves }, { buildDelegationReceipt }] = await Promise.all([
    import('../../openclaw_runtime/src/agents/orchestration-resource-scheduler'),
    import('../../openclaw_runtime/src/agents/long-session-delegation-receipt'),
  ]);
  const key = 'agent:main:capacity-proof', generation = 'capacity-generation', child = 'agent:main:capacity-child';
  const app = await launchElectronApp({ skipSetup: true });
  const evidence: Record<string, unknown> = {
    driven_by: 'agent', actor: 'playwright-u2-capacity', scheduler: 'production function',
    receipt: 'production builder', transport: 'Host fixture', liveCapacityExhaustion: false, status: 'running',
  };
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
      gatewayRpcByMethod: {
        'sessions.list': { sessions: [{ key, sessionId: generation, label: 'Capacity proof', hasActiveRun: false }] },
        'chat.history': { messages: [{ id: 'capacity-context', role: 'assistant', content: 'Capacity dispatch explanation fixture.' }] },
        '*': {},
      },
    });
    const root = testInfo.outputPath('workspace'); await mkdir(root, { recursive: true });
    const created = await hostInvoke<{ activeWorkspace: { id: string } }>(app, 'workspaces', 'create', {
      rootPath: root, name: 'Capacity proof', agentId: 'main', activeSessionKey: key, permissionMode: 'fullAccess',
    });
    const workspaceId = created.activeWorkspace.id;
    const role: RoleContract = {
      name: 'planner', displayName: 'Planner', rolePrompt: 'Read context.', tools: ['read'],
      capabilities: ['task-analysis'], toolRequirements: [], riskProfile: 'medium', canModifyScope: false,
      permissions: { filesystem: 'read', network: 'none', commands: [] }, model: { default: null, fallback: [] },
      effort: 'medium', outputSchema: { format: 'markdown' }, handoff: { to: [], from: [] }, tags: [],
    };
    const nodes = ['first', 'second'].map(taskNodeId => ({
      taskNodeId, roleName: role.name, task: 'Read context', phase: 'worker' as const, dependsOn: [],
      scope: taskNodeId, requiredCapabilities: ['task-analysis'],
      attemptPolicy: { maxRepairAttempts: 1, maxRedoAttempts: 1 }, status: 'ready' as const,
    }));
    const taskGraph = { graphRunId: 'capacity-plan', mode: 'staged' as const, status: 'planned' as const, nodes, edges: [] };
    const schedule = scheduleResourceAwareWaves({ graph: taskGraph, roles: [role], options: { maxActiveRoles: 1 } });
    expect(schedule.waves[0].deferredReasons).toContain('concurrency-cap');
    const admission: SessionDelegationAdmission = {
      schemaVersion: 'clawx.session-delegation-admission/v1', admissionId: 'capacity-proof', idempotencyKey: 'capacity-proof',
      coordinator: { workspaceId, sessionKey: key, sessionGeneration: generation, agentId: 'main', bindingRevision: 1 },
      taskRef: 'capacity-task', parentEnvironment: { kind: 'local', backend: 'local-workspace', canonicalRoot: root,
        branch: null, detachedHead: false, setupProfile: null },
    };
    const receipt = buildDelegationReceipt({ admission, orchestrationRunId: 'capacity-proof', maxWorkers: 1,
      result: { taskGraph, executionWaves: schedule.waves, schedulerMetrics: schedule.metrics, failures: [],
        outcomes: nodes.map((node, index) => ({ roleName: role.name, task: node.task,
          ledger: { taskNodeId: node.taskNodeId, taskId: node.taskNodeId, roleInstanceId: node.taskNodeId, executionWave: index + 1 },
          spawn: { status: 'accepted', result: { childSessionKey: index === 0 ? child : child + '-2', runId: node.taskNodeId } },
        })),
      } as unknown as OrchestrationRunResult });
    expect(receipt.scheduler!.executionWaves).toEqual(schedule.waves);
    const snapshot = createEmptySessionActivitySnapshot(key);
    snapshot.session.sessionId = generation; snapshot.session.updatedAt = Date.now();
    snapshot.availability.continuity = true; snapshot.availability.subagents = true;
    snapshot.subagents = [{ id: 'capacity-worker', childSessionKey: child, role: 'planner',
      status: 'completed', updatedAt: Date.now(), source: 'snapshot' }];
    snapshot.continuity.queueCount = 0; snapshot.capturedAt = Date.now();
    await app.evaluate((_electron, input) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request) => {
        const { module, action, payload } = request;
        if (module === 'sessionActivity' && action === 'snapshot' && payload?.workspaceId === input.workspaceId && payload?.sessionKey === input.key)
          return { ok: true, data: { success: true, snapshot: input.snapshot } };
        if (module === 'workspaces' && action === 'resolveCoordinator')
          return { ok: true, data: { success: true, recovery: { state: 'ready' }, binding: {
            ...input.receipt.coordinator, activeTaskNodeId: 'capacity-task', taskLedgerReferences: [],
          } } };
        if (module === 'sessions' && action === 'history')
          return { ok: true, data: { success: true, sessionGeneration: 'child-generation', messages: [] } };
        if (module === 'sessions' && action === 'delegate') {
          if (payload?.workspaceId !== input.workspaceId || payload?.sessionKey !== input.key
            || payload?.expectedSessionGeneration !== input.generation) throw new Error('Capacity fixture scope mismatch');
          return { ok: true, data: { success: true, status: 'accepted', receipt: {
            ...input.receipt, idempotencyKey: payload.idempotencyKey,
          } } };
        }
        return original(event, request);
      });
    }, { workspaceId, key, generation, receipt, snapshot });
    await hostInvoke(app, 'workspaces', 'saveState', { id: workspaceId, sessionKey: key, state: {
      artifactPanel: { open: true, expanded: true, tabs: [{ kind: 'agents' }], activeTabKind: 'agents' },
    } });
    const page = await getStableWindow(app);
    evidence.locales=[];
    for(const language of ['en','zh','ja','ru']){
    const labels=JSON.parse(await readFile(`shared/i18n/locales/${language}/chat.json`,'utf8')).delegationStages.capacity;
    await hostInvoke(app, 'settings', 'set', { key: 'language', value: language });await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    await publishGatewayStatus(app, { state: 'running', gatewayReady: true, port: 18789 });
    await expect(page.getByTestId('workspace-agents-panel')).toBeVisible();
    await expect(page.getByTestId('delegation-current-queue')).toHaveAttribute('data-count', '0');
    await page.getByTestId('workspace-agents-dispatch-input').fill('Show the recorded capacity plan');
    await page.getByTestId('workspace-agents-dispatch').click();
    await expect(page.getByTestId('delegation-receipt-plan')).toHaveAttribute('data-plan-time', 'receipt');
    await expect(page.getByTestId('delegation-receipt-plan')).toContainText(labels.planTitle);
    await expect(page.getByTestId('delegation-receipt-plan')).toContainText(labels.planDescription);
    await expect(page.getByTestId('delegation-plan-reason-1')).toHaveText(schedule.waves[0].reason);
    await expect(page.locator('[data-deferred-reason="concurrency-cap"]')).toHaveText(labels.reason.concurrencyCap);
    await expect(page.getByTestId('delegation-current-queue')).toHaveAttribute('data-count', '0');
    await page.screenshot({ path: testInfo.outputPath(`capacity-receipt-plan-${language}.png`) });
    (evidence.locales as unknown[]).push({language,status:'passed'});
    }
    await page.getByTestId('delegation-open-resources').click();
    await expect(page.getByTestId('storage-page')).toBeVisible();
    const route = await page.evaluate(() => window.location.hash);
    expect(route).toContain('/settings/storage?');
    expect(route).toContain('workspaceId=' + encodeURIComponent(workspaceId));
    expect(route).toContain('sessionKey=' + encodeURIComponent(key));
    evidence.schedule = schedule; evidence.receipt = receipt; evidence.snapshot = snapshot; evidence.route = route; evidence.status = 'passed';
  } catch (error) { evidence.status = 'failed'; evidence.error = String(error); throw error; }
  finally {
    await writeFile(testInfo.outputPath('u2-capacity.json'), JSON.stringify(evidence, null, 2));
    await closeElectronApp(app);
  }
});
