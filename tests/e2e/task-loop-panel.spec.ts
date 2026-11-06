import { completeSetup, expect, test } from './fixtures/electron';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { parseCodingRunJsonl } from '../../shared/types/coding-run';

test.describe('Agent task loop panel', () => {
  for (const withGate of [true, false]) {
  test(`starts a task loop through gateway RPC and exports evidence (gate=${withGate})`, async ({ electronApp, page }, testInfo) => {
    await electronApp.evaluate(({ ipcMain, BrowserWindow }, withGate) => {
      const state = {
        methods: [] as string[],
        taskLoopRuns: 0,
      };

      (globalThis as unknown as { __taskLoopPanelState: typeof state }).__taskLoopPanelState = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => {
        if (!withGate && data && typeof data === 'object' && 'loop' in data) {
          delete (data.loop as { evidenceGate?: unknown }).evidenceGate;
        }
        return { id: typeof id === 'string' ? id : undefined, ok: true, data };
      };
      const emitTaskLoop = (payload: Record<string, unknown>) => {
        if (!withGate) delete payload.evidenceGate;
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
    }, withGate);

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
    await expect(page.getByTestId('role-task-loop-result')).toContainText(withGate ? 'Task loop complete (verified) at complete' : 'Task loop complete at complete');
    if (withGate) await expect(page.getByTestId('role-task-loop-result-gate')).toContainText('pass');
    else await expect(page.getByTestId('role-task-loop-result-gate')).toHaveCount(0);
    await expect(page.getByTestId('role-task-loop-result')).not.toHaveAttribute('data-completion-authority', 'task-ledger');
    if (withGate) await expect(page.getByTestId('role-task-loop-result-quality')).toContainText('3/0/0');
    if (withGate) {
      await expect(page.getByTestId('role-task-loop-files')).toContainText('1');
      await expect(page.getByTestId('role-task-loop-tests')).toContainText('1');
    } else {
      await expect(page.getByTestId('role-task-loop-files')).toHaveCount(0);
      await expect(page.getByTestId('role-task-loop-tests')).toHaveCount(0);
    }
    await expect(page.getByTestId('role-task-loop-trace')).toContainText('trace-loop-e2e');
    await page.getByTestId('role-task-loop-coding-run').locator('summary').click();
    await expect(page.getByTestId('role-task-loop-coding-run')).toContainText('"type":"verification"');
    const jsonl = await page.getByTestId('role-task-loop-coding-run').locator('pre').innerText();
    const exportFile = testInfo.outputPath('coding-run.jsonl');
    await writeFile(exportFile, jsonl, 'utf8');
    expect(parseCodingRunJsonl(jsonl).status).toBe('ok');
    const cli = spawnSync(process.execPath, ['scripts/coding-run-summary.mjs', exportFile], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true });
    expect(cli.status, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({ codingRunId: 'task-loop:loop-e2e', finalStatus: withGate ? 'completed' : 'unavailable' });
    await writeFile(testInfo.outputPath('coding-run-cli.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex-coding-p1',
      realHumanEvidence: false, boundary: 'Electron UI with injected host RPC', withGate, exitCode: cli.status, summary: JSON.parse(cli.stdout) }, null, 2));
    await page.getByTestId('role-task-loop-result').screenshot({ path: testInfo.outputPath('coding-run-panel.png') });

    const calls = await electronApp.evaluate(() => {
      const state = (globalThis as unknown as { __taskLoopPanelState?: { methods: string[]; taskLoopRuns: number } }).__taskLoopPanelState;
      return { methods: state?.methods ?? [], taskLoopRuns: state?.taskLoopRuns ?? 0 };
    });
    expect(calls.taskLoopRuns).toBe(1);
    expect(calls.methods).toContain('task_loop.run');
  });
  }
});
