import path from "node:path";

const fileLocks = new Map<string, Promise<void>>();

export function normalizePatchLockPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Acquire overlapping file leases in stable order to prevent batch deadlocks. */
export async function acquirePatchBatchLocks(resolvedPaths: string[]): Promise<() => void> {
  const keys = [...new Set(resolvedPaths.map(normalizePatchLockPath))].sort();
  const held: Array<{ key: string; tail: Promise<void>; release: () => void }> = [];

  for (const key of keys) {
    const previous = fileLocks.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    fileLocks.set(key, tail);
    await previous;
    held.push({ key, tail, release });
  }

  return () => {
    for (const lock of held.toReversed()) {
      lock.release();
      void lock.tail.then(() => {
        if (fileLocks.get(lock.key) === lock.tail) {
          fileLocks.delete(lock.key);
        }
      });
    }
  };
}

export function __resetBatchLocks(): void {
  fileLocks.clear();
}
