// Provides synchronous SQLite transaction helpers with nested savepoints.
import type { DatabaseSync } from "node:sqlite";
import { createSubsystemLogger } from "../logging/subsystem.js";

const logger = createSubsystemLogger("runtime-memory");

const transactionDepthByDatabase = new WeakMap<DatabaseSync, number>();

/** The shared depth also covers Node 22, before DatabaseSync.isTransaction existed. */
export function isSqliteTransactionActive(db: DatabaseSync): boolean {
  return (transactionDepthByDatabase.get(db) ?? 0) > 0 || db.isTransaction === true;
}

const RETRYABLE_COMMIT_ERROR_CODES = new Set(["SQLITE_BUSY", "SQLITE_LOCKED"]);
const MAX_COMMIT_ATTEMPTS = 8;
const MAX_BEGIN_ATTEMPTS = 8;
const BEGIN_BASE_DELAY_MS = 1;

export type SqliteImmediateTransactionRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  now?: () => number;
};

export function runSqliteImmediateTransactionWithRetrySync<T>(
  db: DatabaseSync,
  operation: () => T,
  options?: SqliteImmediateTransactionRetryOptions,
): T {
  const maxAttempts = options?.maxAttempts ?? MAX_BEGIN_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? BEGIN_BASE_DELAY_MS;
  const depth = getTransactionDepth(db);
  if (depth > 0) {
    return runSqliteImmediateTransactionSync(db, operation);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      db.exec("BEGIN IMMEDIATE");
    } catch (error) {
      lastError = error;
      if (!isRetryableCommitError(error) || attempt >= maxAttempts) {
        logger.error("transaction_retry_exhausted", {
          phase: "begin",
          attempts: attempt,
          error: String(error),
        });
        throw error;
      }
      logger.warn("transaction_retry", {
        phase: "begin",
        attempt,
        error: String(error),
      });
      const delay = baseDelayMs * 2 ** (attempt - 1);
      sleepSyncForBeginRetry(delay, options?.now);
      continue;
    }
    setTransactionDepth(db, 1);
    let transactionStillActive = true;
    let result: T;
    try {
      result = operation();
      assertSyncTransactionResult(result);
    } catch (error) {
      try {
        abortImmediateTransaction(db);
        transactionStillActive = false;
      } catch {
        // Preserve the original error; rollback failure is secondary.
      }
      throw error;
    } finally {
      if (!transactionStillActive) {
        setTransactionDepth(db, 0);
      }
    }

    try {
      commitImmediateTransaction(db);
      transactionStillActive = false;
      return result;
    } catch (error) {
      try {
        abortImmediateTransaction(db);
        transactionStillActive = false;
      } catch {
        // Preserve the original error; rollback failure is secondary.
      }
      throw error;
    } finally {
      if (!transactionStillActive) {
        setTransactionDepth(db, 0);
      }
    }
  }
  throw lastError ?? new Error("runSqliteImmediateTransactionWithRetrySync exhausted retries");
}

function sleepSyncForBeginRetry(ms: number, now?: () => number): void {
  const timeoutMs = Math.max(0, Math.floor(ms));
  if (timeoutMs <= 0) {
    return;
  }
  try {
    const lock = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(lock, 0, 0, timeoutMs);
  } catch {
    const start = (now ?? Date.now)();
    while ((now ?? Date.now)() - start < timeoutMs) {
      // Best-effort fallback when Atomics.wait is unavailable.
    }
  }
}

let nextSavepointId = 0;

function nextSavepointName(): string {
  nextSavepointId += 1;
  return `openclaw_tx_${nextSavepointId}`;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof (value as { then?: unknown }).then === "function");
}

function assertSyncTransactionResult(value: unknown): void {
  if (isPromiseLike(value)) {
    throw new Error(
      "SQLite write transactions must be synchronous; Promise returns are not supported.",
    );
  }
}

function isRetryableCommitError(error: unknown): boolean {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && RETRYABLE_COMMIT_ERROR_CODES.has(code);
}

function commitImmediateTransaction(db: DatabaseSync): void {
  for (const attempt of Array.from({ length: MAX_COMMIT_ATTEMPTS }, (_, index) => index + 1)) {
    try {
      db.exec("COMMIT");
      return;
    } catch (error) {
      if (!isRetryableCommitError(error) || attempt >= MAX_COMMIT_ATTEMPTS) {
        logger.error("transaction_retry_exhausted", {
          phase: "commit",
          attempts: attempt,
          error: String(error),
        });
        throw error;
      }
      logger.warn("transaction_retry", {
        phase: "commit",
        attempt,
        error: String(error),
      });
    }
  }
}

function abortImmediateTransaction(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // If rollback itself fails, close the handle so callers cannot keep using a
    // connection that may still hold an abandoned write transaction.
    try {
      db.close();
    } catch {
      // Preserve the original transaction error; close failure is secondary.
    }
  }
}

function getTransactionDepth(db: DatabaseSync): number {
  return transactionDepthByDatabase.get(db) ?? 0;
}

function setTransactionDepth(db: DatabaseSync, depth: number): void {
  if (depth <= 0) {
    transactionDepthByDatabase.delete(db);
    return;
  }
  transactionDepthByDatabase.set(db, depth);
}

export function runSqliteImmediateTransactionSync<T>(db: DatabaseSync, operation: () => T): T {
  const depth = getTransactionDepth(db);
  if (depth > 0) {
    const savepointName = nextSavepointName();
    db.exec(`SAVEPOINT ${savepointName}`);
    setTransactionDepth(db, depth + 1);
    try {
      const result = operation();
      assertSyncTransactionResult(result);
      db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      return result;
    } catch (error) {
      try {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      } finally {
        db.exec(`RELEASE SAVEPOINT ${savepointName}`);
      }
      throw error;
    } finally {
      setTransactionDepth(db, depth);
    }
  }

  db.exec("BEGIN IMMEDIATE");
  setTransactionDepth(db, 1);
  let transactionStillActive = true;
  let result: T;
  try {
    result = operation();
    assertSyncTransactionResult(result);
  } catch (error) {
    try {
      abortImmediateTransaction(db);
      transactionStillActive = false;
    } catch {
      // Preserve the original error; rollback failure is secondary.
    }
    throw error;
  } finally {
    if (!transactionStillActive) {
      setTransactionDepth(db, 0);
    }
  }

  try {
    commitImmediateTransaction(db);
    transactionStillActive = false;
    return result;
  } catch (error) {
    try {
      abortImmediateTransaction(db);
      transactionStillActive = false;
    } catch {
      // Preserve the original error; rollback failure is secondary.
    }
    throw error;
  } finally {
    if (!transactionStillActive) {
      setTransactionDepth(db, 0);
    }
  }
}
