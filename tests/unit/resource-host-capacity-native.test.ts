// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { managedProcessReservations, releaseManagedProcessReservation, setManagedProcessHostPressure } from '../../openclaw_runtime/src/agents/verseshell/managed-process-reservation';

type Receipt = {
  phase: 'refused' | 'started' | 'terminal';
  ownerPid?: number;
  nativePid?: number;
  reservationId?: string;
  nativeStarted?: boolean;
  nativeExitCode?: number;
  released?: boolean;
  limit?: number;
  admission?: { live: number; limit: number; ok: boolean };
};

function startWorker() {
  const child = spawn(process.execPath, ['--import', 'tsx', join(process.cwd(), 'tests/unit/fixtures/resource-host-capacity-worker.mts')], {
    cwd: join(process.cwd(), 'openclaw_runtime'), env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const receipts: Receipt[] = [];
  const waiting: Array<{ resolve: (receipt: Receipt) => void; reject: (error: Error) => void }> = [];
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const receipt = JSON.parse(line) as Receipt;
    const waiter = waiting.shift();
    if (waiter) waiter.resolve(receipt); else receipts.push(receipt);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => {
      lines.close();
      waiting.splice(0).forEach(waiter => waiter.reject(new Error(`Worker closed before receipt: ${stderr}`)));
      resolve(code);
    });
  });
  const next = () => receipts.length ? Promise.resolve(receipts.shift()!)
    : new Promise<Receipt>((resolve, reject) => { waiting.push({ resolve, reject }); });
  return { child, next, exited, finish: () => child.stdin.end('finish\n') };
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('shared host capacity with native processes', () => {
  it('shares pressure across Main/Gateway owners and releases slots only after native close', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'resource-host-native-'));
    vi.stubEnv('CLAWX_EXECUTION_STATE_PATH', join(directory, 'execution.sqlite'));
    vi.stubEnv('OPENCLAW_VERSESHELL_MAX_LIVE_PROCESSES', '2');
    const workers: ReturnType<typeof startWorker>[] = [];
    const receipts: Receipt[] = [];
    try {
      setManagedProcessHostPressure(true);
      const first = startWorker(); workers.push(first);
      const started = await first.next(); receipts.push(started);
      expect(started).toMatchObject({ phase: 'started', nativeStarted: true, limit: 1 });
      process.kill(started.nativePid!, 0);
      const second = startWorker(); workers.push(second);
      const refused = await second.next(); receipts.push(refused);
      expect(refused).toMatchObject({ phase: 'refused', nativeStarted: false, admission: { ok: false, live: 1, limit: 1 } });
      expect(await second.exited).toBe(0);
      expect(() => releaseManagedProcessReservation(started.reservationId!)).toThrow('E_PROCESS_RESERVATION_OWNER');
      expect(managedProcessReservations()).toContainEqual(expect.objectContaining({ id: started.reservationId, phase: 'observed', rootPids: [started.nativePid], limit: 2 }));
      setManagedProcessHostPressure(false);
      const recovered = startWorker(); workers.push(recovered);
      const recoveredStart = await recovered.next(); receipts.push(recoveredStart);
      expect(recoveredStart).toMatchObject({ phase: 'started', nativeStarted: true, limit: 2 });
      expect(managedProcessReservations()).toHaveLength(2);
      const full = startWorker(); workers.push(full);
      const fullReceipt = await full.next(); receipts.push(fullReceipt);
      expect(fullReceipt).toMatchObject({ phase: 'refused', nativeStarted: false, admission: { ok: false, live: 2, limit: 2 } });
      expect(await full.exited).toBe(0);
      first.finish();
      const firstExit = await first.next(); receipts.push(firstExit);
      expect(firstExit).toMatchObject({ phase: 'terminal', nativeExitCode: 0, released: true });
      expect(await first.exited).toBe(0);
      expect(managedProcessReservations()).toHaveLength(1);
      recovered.finish();
      const recoveredExit = await recovered.next(); receipts.push(recoveredExit);
      expect(recoveredExit).toMatchObject({ phase: 'terminal', nativeExitCode: 0, released: true });
      expect(await recovered.exited).toBe(0);
      expect(managedProcessReservations()).toEqual([]);
      const evidence = { driven_by: 'agent', actor: 'codex-resource-host-native', receipts, finalReservations: managedProcessReservations() };
      const evidencePath = process.env.RESOURCE_SCHEDULING_NATIVE_REPORT ?? join(directory, 'native-receipts.json');
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
      expect(JSON.parse(readFileSync(evidencePath, 'utf8')).finalReservations).toEqual([]);
    } finally {
      setManagedProcessHostPressure(false);
      for (const worker of workers) {
        if (worker.child.exitCode === null) worker.finish();
        await worker.exited;
      }
    }
  }, 60_000);
});
