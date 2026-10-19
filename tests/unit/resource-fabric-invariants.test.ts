import { describe, expect, it } from 'vitest';
import { ResourceFabric } from '../../electron/services/resource-fabric';
import { getResourceEnvelopeLedger, resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ResourceFabric invariants', () => {
  it('I1: interactive work is never rejected by the account limit', async () => {
    resetResourceEnvelopeLedgerForTest();
    const fabric = new ResourceFabric({
      accounts: { workspaceExec: { initialLimit: 1, minLimit: 1, maxLimit: 1 } },
    });
    const hold = new Promise<void>((resolve) => setTimeout(resolve, 30));
    const background = fabric.runResource(
      'workspaceExec',
      'interactive-hold',
      { qos: 'background', tenant: 'background-tenant' },
      () => hold,
    );
    const results: number[] = [];
    const interactive = Array.from({ length: 12 }, (_, index) => fabric.runResource(
      'workspaceExec',
      `interactive-${index}`,
      { qos: 'interactive', timeoutMs: 2_000, tenant: 'interactive-tenant' },
      async () => {
        await sleep(1);
        results.push(index);
      },
    ));
    await Promise.all([background, ...interactive]);
    expect(results).toHaveLength(12);
    expect(fabric.getDiagnostics().accounts['workspaceExec:interactive-hold']?.active).toBe(0);
  });

  it('I2: active usage never exceeds the current account limit', async () => {
    resetResourceEnvelopeLedgerForTest();
    const fabric = new ResourceFabric({
      accounts: { chatHistory: { initialLimit: 2, minLimit: 1, maxLimit: 2 } },
    });
    const violations: string[] = [];
    await Promise.all(Array.from({ length: 10 }, (_, index) => fabric.runResource(
      'chatHistory',
      `history-${index}`,
      { qos: 'interactive', timeoutMs: 2_000, tenant: `session-${index}` },
      async () => {
        const account = fabric.getDiagnostics().chatHistory;
        if (account && account.active > account.limit) {
          violations.push(`active=${account.active} limit=${account.limit}`);
        }
        await sleep(2);
      },
    )));
    expect(violations).toEqual([]);
  });

  it('I3: DRF-lite share stays within the two-times fairness bound', async () => {
    resetResourceEnvelopeLedgerForTest();
    const fabric = new ResourceFabric();
    const runs = ['a', 'b', 'c'].flatMap((tenant) => (
      Array.from({ length: 2 }, (_, index) => fabric.runResource(
        'workspaceExec',
        `${tenant}-${index}`,
        { qos: 'background', timeoutMs: 2_000, tenant },
        async () => sleep(2),
      ))
    ));
    await Promise.all(runs);
    expect(fabric.isFair(2)).toBe(true);
  });

  it('writes each limit adjustment into the resource-envelope ledger', () => {
    resetResourceEnvelopeLedgerForTest();
    const fabric = new ResourceFabric();
    fabric.observeLatency('workspaceExec', 'ledger-ws', 200, 0);
    const event = fabric.observeLatency('workspaceExec', 'ledger-ws', 5, 1);
    expect(event).toMatchObject({ from: 2, to: 3 });
    const entry = getResourceEnvelopeLedger().get('main:terminal-exec:ledger-ws');
    expect(entry?.limits.concurrencySlots).toBe(3);
    expect(entry?.limitHistory).toEqual([expect.objectContaining({ from: 2, to: 3 })]);
  });
});