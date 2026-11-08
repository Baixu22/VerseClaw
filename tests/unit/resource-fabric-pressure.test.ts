import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ResourceFabric } from '../../electron/services/resource-fabric';
import { resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ResourceFabric P2 pressure', () => {
  it('runs 20 exec plus 20 history with zero timeouts and a replayable limit trace', async () => {
    resetResourceEnvelopeLedgerForTest();
    const fabric = new ResourceFabric();
    fabric.observeLatency('workspaceExec', 'pressure-ws-0', 200, 0);
    fabric.observeLatency('workspaceExec', 'pressure-ws-0', 5, 1);
    fabric.observeLatency('workspaceExec', 'pressure-ws-0', 5, 1);
    fabric.observeLatency('workspaceExec', 'pressure-ws-0', 5, 1);
    fabric.observeLatency('chatHistory', 'chatHistory', 200, 0);
    fabric.observeLatency('chatHistory', 'chatHistory', 5, 1);
    fabric.observeLatency('chatHistory', 'chatHistory', 5, 1);
    fabric.observeLatency('chatHistory', 'chatHistory', 5, 1);

    let execTimeouts = 0;
    let historyTimeouts = 0;
    let maxActiveExec = 0;
    let maxActiveHistory = 0;
    const startedAt = Date.now();
    const execDurations: number[] = [];
    const historyDurations: number[] = [];

    const exec = Array.from({ length: 20 }, (_, index) => {
      const started = Date.now();
      const workspaceKey = `pressure-ws-${index % 4}`;
      return fabric.runResource(
        'workspaceExec',
        workspaceKey,
        { qos: 'interactive', timeoutMs: 5_000, tenant: workspaceKey },
        async () => {
          const account = fabric.getDiagnostics().accounts[`workspaceExec:${workspaceKey}`];
          maxActiveExec = Math.max(maxActiveExec, account?.active ?? 0);
          await sleep(5);
          execDurations.push(Date.now() - started);
        },
      ).catch(() => { execTimeouts += 1; });
    });

    const history = Array.from({ length: 20 }, (_, index) => {
      const started = Date.now();
      return fabric.runResource(
        'chatHistory',
        `history-${index}`,
        { qos: 'interactive', timeoutMs: 5_000, tenant: `session-${index}` },
        async () => {
          maxActiveHistory = Math.max(maxActiveHistory, fabric.getDiagnostics().chatHistory?.active ?? 0);
          await sleep(5);
          historyDurations.push(Date.now() - started);
        },
      ).catch(() => { historyTimeouts += 1; });
    });

    await Promise.all([...exec, ...history]);
    const diagnostics = fabric.getDiagnostics();
    const report = {
      schema: 'clawx.tf0408.resource-pressure/v1',
      phase: 'after',
      driven_by: 'agent',
      actor: 'codex-tf0408-pressure',
      generatedAt: new Date().toISOString(),
      workload: { exec: 20, history: 20, workspaceKeys: 4, perTaskMs: 5 },
      execTimeouts,
      historyTimeouts,
      maxActiveExec,
      maxActiveHistory,
      execDurations,
      historyDurations,
      totalMs: Date.now() - startedAt,
      fair: diagnostics.fair,
      limitEvents: diagnostics.limitEvents,
      accounts: diagnostics.accounts,
    };
    const output = process.env.RESOURCE_FABRIC_PRESSURE_OUT;
    if (output) {
      const file = resolve(output);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    }
    expect(execTimeouts).toBe(0);
    expect(historyTimeouts).toBe(0);
    expect(diagnostics.fair).toBe(true);
    expect(diagnostics.limitEvents.length).toBeGreaterThan(0);
  });
});
