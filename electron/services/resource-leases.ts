import { logger } from '../utils/logger';

export type TerminalResourceLease = {
  leaseKind: 'workspaceExec';
  leaseKey: string;
  queuedMs: number;
  release: () => void;
};

export class TerminalResourceLeaseTimeoutError extends Error {
  readonly code = 'TERMINAL_RESOURCE_LEASE_TIMEOUT';
  readonly leaseKind = 'workspaceExec';
  readonly leaseKey: string;
  readonly timeoutMs: number;

  constructor(params: { leaseKey: string; timeoutMs: number }) {
    super(
      `Timed out waiting for workspaceExec lease (${params.leaseKey}) after ${params.timeoutMs}ms`,
    );
    this.name = 'TerminalResourceLeaseTimeoutError';
    this.leaseKey = params.leaseKey;
    this.timeoutMs = params.timeoutMs;
  }
}

type PendingExecLease = {
  id: number;
  key: string;
  requestedAt: number;
  timeoutMs: number;
  resolve: (lease: TerminalResourceLease) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

const WORKSPACE_EXEC_CAPACITY = 2;
const DEFAULT_EXEC_ACQUIRE_TIMEOUT_MS = 30_000;

let nextTerminalLeaseId = 1;

class TerminalResourceLeaseManager {
  private readonly activeByKey = new Map<string, number>();
  private readonly pending: PendingExecLease[] = [];

  acquireWorkspaceExec(key: string, timeoutMs = DEFAULT_EXEC_ACQUIRE_TIMEOUT_MS): Promise<TerminalResourceLease> {
    const normalizedTimeout = Math.max(1, Math.floor(timeoutMs));
    const id = nextTerminalLeaseId++;
    const requestedAt = Date.now();
    return new Promise<TerminalResourceLease>((resolve, reject) => {
      const request: PendingExecLease = {
        id,
        key,
        requestedAt,
        timeoutMs: normalizedTimeout,
        resolve,
        reject,
        timer: null,
      };
      request.timer = setTimeout(() => this.timeout(request), normalizedTimeout);
      this.pending.push(request);
      this.drain();
    });
  }

  private drain(): void {
    for (const request of [...this.pending]) {
      if (!this.pending.includes(request)) {
        continue;
      }
      if (this.hasEarlierSameKeyPending(request)) {
        continue;
      }
      const active = this.activeByKey.get(request.key) ?? 0;
      if (active >= WORKSPACE_EXEC_CAPACITY) {
        continue;
      }
      this.grant(request);
    }
  }

  private hasEarlierSameKeyPending(request: PendingExecLease): boolean {
    for (const earlier of this.pending) {
      if (earlier === request) {
        return false;
      }
      if (earlier.key === request.key) {
        return true;
      }
    }
    return false;
  }

  private grant(request: PendingExecLease): void {
    if (!this.removePending(request)) {
      return;
    }
    this.activeByKey.set(request.key, (this.activeByKey.get(request.key) ?? 0) + 1);
    const queuedMs = Date.now() - request.requestedAt;
    logger.info('[resource-lease] acquired workspaceExec', {
      id: request.id,
      leaseKind: 'workspaceExec',
      leaseKey: request.key,
      queuedMs,
    });
    let released = false;
    request.resolve({
      leaseKind: 'workspaceExec',
      leaseKey: request.key,
      queuedMs,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.release(request, queuedMs);
      },
    });
  }

  private release(request: PendingExecLease, queuedMs: number): void {
    const active = Math.max(0, (this.activeByKey.get(request.key) ?? 1) - 1);
    if (active === 0) {
      this.activeByKey.delete(request.key);
    } else {
      this.activeByKey.set(request.key, active);
    }
    logger.info('[resource-lease] released workspaceExec', {
      id: request.id,
      leaseKind: 'workspaceExec',
      leaseKey: request.key,
      queuedMs,
    });
    this.drain();
  }

  private timeout(request: PendingExecLease): void {
    if (!this.removePending(request)) {
      return;
    }
    logger.warn('[resource-lease] timeout workspaceExec', {
      id: request.id,
      leaseKind: 'workspaceExec',
      leaseKey: request.key,
      timeoutMs: request.timeoutMs,
      waitMs: Date.now() - request.requestedAt,
    });
    request.reject(
      new TerminalResourceLeaseTimeoutError({
        leaseKey: request.key,
        timeoutMs: request.timeoutMs,
      }),
    );
    this.drain();
  }

  /** Test-only: drop all active and pending leases. */
  resetForTest(): void {
    for (const request of this.pending) {
      if (request.timer) {
        clearTimeout(request.timer);
        request.timer = null;
      }
    }
    this.pending.length = 0;
    this.activeByKey.clear();
  }

  private removePending(request: PendingExecLease): boolean {
    const index = this.pending.indexOf(request);
    if (index < 0) {
      return false;
    }
    this.pending.splice(index, 1);
    if (request.timer) {
      clearTimeout(request.timer);
      request.timer = null;
    }
    return true;
  }
}

const terminalResourceLeases = new TerminalResourceLeaseManager();

export function isTerminalResourceLeaseTimeoutError(
  error: unknown,
): error is TerminalResourceLeaseTimeoutError {
  return error instanceof TerminalResourceLeaseTimeoutError;
}

/** Test-only: clears lease state so suites do not leak capacity across cases. */
export function resetTerminalResourceLeasesForTest(): void {
  terminalResourceLeases.resetForTest();
}

export async function withWorkspaceExecLease<T>(
  workspaceKey: string,
  timeoutMs: number,
  fn: (lease: TerminalResourceLease) => Promise<T>,
): Promise<T> {
  const lease = await terminalResourceLeases.acquireWorkspaceExec(workspaceKey, timeoutMs);
  try {
    return await fn(lease);
  } finally {
    lease.release();
  }
}
