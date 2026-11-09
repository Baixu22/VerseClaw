/**
 * NET-E (TF-0442): ambient logical deadline for the Main process.
 *
 * The host dispatcher enters this context for the duration of one host action,
 * so nested Main-side work (for example gateway RPCs started by an action
 * handler) can clamp its own timeout to the sender's remaining budget instead of
 * starting a fresh full timeout. The context never crosses the process boundary;
 * cross-process layers receive the deadline as request metadata instead.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { HostDeadline } from '@shared/host-api/host-deadline';

const storage = new AsyncLocalStorage<HostDeadline>();

export function runWithHostDeadline<T>(deadline: HostDeadline | undefined, run: () => T): T {
  if (!deadline) {
    return run();
  }
  return storage.run(deadline, run);
}

export function getHostDeadline(): HostDeadline | undefined {
  return storage.getStore();
}

/** Runtime callbacks are independent of the host action that opened their socket. */
export function runOutsideHostDeadline<T>(run: () => T): T {
  return storage.exit(run);
}
