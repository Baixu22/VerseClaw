import type { ElectronApplication } from '@playwright/test';
import { hostInvoke } from './fp-p1-harness';
import { checkWindowsProcesses, type WindowsProcessIdentity } from './windows-process';

type RecoveryGatewayProcess = { pid: number; creationTime?: number };

/** Bind the paused fault probe to this app's current Gateway before terminating it. */
export async function captureRecoveryGatewayProcess(
  app: ElectronApplication,
  hit: { pid: number; observedAt: number },
): Promise<RecoveryGatewayProcess> {
  if (!Number.isSafeInteger(hit.pid) || hit.pid <= 0 || !Number.isFinite(hit.observedAt) || hit.observedAt <= 0) {
    throw new Error('No verified Gateway fault process');
  }
  const status = await hostInvoke<{ pid?: number }>(app, 'gateway', 'status');
  if (status.pid !== hit.pid) throw new Error('Fault probe no longer belongs to the current Gateway');
  if (process.platform !== 'win32') return { pid: hit.pid };
  const metric = await app.evaluate(({ app: electronApp }, pid) => {
    const process = electronApp.getAppMetrics().find((entry) => entry.pid === pid && entry.type === 'Utility');
    return process ? { pid: process.pid, creationTime: process.creationTime } : null;
  }, hit.pid);
  if (!metric || !Number.isFinite(metric.creationTime) || metric.creationTime <= 0 || metric.creationTime > hit.observedAt) {
    throw new Error('Fault probe Gateway identity is missing or was replaced');
  }
  return metric;
}

export async function terminateRecoveryGatewayProcess(identity: RecoveryGatewayProcess) {
  if (!Number.isSafeInteger(identity.pid) || identity.pid <= 0) throw new Error('No verified Gateway PID');
  if (process.platform !== 'win32') {
    process.kill(identity.pid, 'SIGKILL');
    return { ...identity, status: 'terminated', method: 'SIGKILL' };
  }
  if (!Number.isFinite(identity.creationTime) || (identity.creationTime ?? 0) <= 0) {
    throw new Error('Gateway creation time is required for fault injection');
  }
  // Hold the verified native handle through Kill(true); taskkill can hang before injection.
  const observations = await checkWindowsProcesses([identity as WindowsProcessIdentity], true, { entireProcessTree: true });
  let result = observations[0];
  // Kill is asynchronous. Recheck exit only; never repeat an uncertain termination.
  for (let attempt = 0; result.status === 'alive' && attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const [observed] = await checkWindowsProcesses([identity as WindowsProcessIdentity]).catch((error: unknown) => {
      throw new Error(`Gateway exit observation failed after ${JSON.stringify(observations)}: ${String(error)}`, { cause: error });
    });
    observations.push(observed);
    result = observed.status === 'exited' || observed.status === 'replaced'
      ? { ...observed, status: 'terminated' }
      : observed;
  }
  if (result.status !== 'terminated') {
    throw new Error(`Gateway fault injection did not confirm exit: ${JSON.stringify(observations)}`);
  }
  return { ...result, method: 'native-process-tree', observations };
}
