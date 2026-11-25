import { spawn } from 'node:child_process';
import { ManagedProcessCapacityError, startManagedChildProcess, managedProcessCapacityStats } from '../../../openclaw_runtime/src/agents/verseshell/managed-process-capacity.js';
import { managedProcessReservations, observeManagedProcessReservation } from '../../../openclaw_runtime/src/agents/verseshell/managed-process-reservation.js';

const report = (value: unknown, exit = false) => process.stdout.write(JSON.stringify(value) + '\n', () => {
  if (exit) process.exit(0);
});
let native: ReturnType<typeof spawn> | undefined;
try {
  native = startManagedChildProcess(() => spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n"); process.stdin.once("data", () => process.exit(0)); process.stdin.resume();'], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  }), `native-capacity-worker:${process.pid}`);
} catch (error) {
  if (!(error instanceof ManagedProcessCapacityError)) throw error;
  report({ phase: 'refused', admission: { ok: false, reason: 'capacity', live: error.live, limit: error.limit }, ownerPid: process.pid, nativeStarted: false }, true);
}
if (native) {
  const child = native;
  const reservation = managedProcessReservations().find(record => record.ownerPid === process.pid)!;
  child.once('error', error => process.stderr.write(String(error)));
  child.stdout!.once('data', async () => {
    await observeManagedProcessReservation(reservation.id, child.pid!);
    report({ phase: 'started', ownerPid: process.pid, nativePid: child.pid, reservationId: reservation.id, limit: managedProcessCapacityStats().limit, nativeStarted: true });
  });
  process.stdin.once('data', () => child.stdin!.end('finish\n'));
  process.stdin.resume();
  child.once('close', code => {
    const released = !managedProcessReservations().some(record => record.id === reservation.id);
    report({ phase: 'terminal', nativeExitCode: code, released, stats: managedProcessCapacityStats() }, true);
  });
}
