import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getOpenClawConfigDir } from "../utils/paths";
import { logger } from "../utils/logger";
import { withFileLock, writeFileAtomic } from "../utils/atomic-write";

export type SessionDeleteGateRecord = {
  operationId: string;
  sessionKey: string;
  agentId: string;
  expectedSessionId?: string;
  terminalClosed?: boolean;
  localSweepCommitted?: boolean;
  createdAt: number;
  updatedAt: number;
};

type SessionDeleteGateFile = {
  version: 1;
  gates: Record<string, SessionDeleteGateRecord>;
};

const sessionDeleteGateLocks = new Map<string, Promise<unknown>>();

function resolveSessionDeleteGatePath(): string {
  return path.join(
    getOpenClawConfigDir(),
    "runtime-lifecycle-governance",
    "session-delete-gates.json",
  );
}

async function readGateFile(): Promise<SessionDeleteGateFile> {
  const filePath = resolveSessionDeleteGatePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as { version?: unknown }).version === 1 &&
      (parsed as { gates?: unknown }).gates &&
      typeof (parsed as { gates: unknown }).gates === "object"
    ) {
      return parsed as SessionDeleteGateFile;
    }
    throw new Error(`Invalid session delete gate schema at ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, gates: {} };
    }
    logger.warn(`[session-delete-gate] Could not read gate file: ${String(error)}`);
    throw error;
  }
}

async function writeGateFile(file: SessionDeleteGateFile): Promise<void> {
  const filePath = resolveSessionDeleteGatePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(file, null, 2)}\n`, {
    keepBackup: false,
    skipMeta: true,
  });
}

async function withGateFileLock<T>(fn: () => Promise<T>): Promise<T> {
  return withFileLock(resolveSessionDeleteGatePath(), fn, {
    timeoutMs: 15_000,
    staleMs: 30_000,
  });
}

/**
 * Shared per-session critical section for delete and terminal-open admission.
 * The file lock protects cross-process gate updates; this lock closes the
 * check-then-open race inside the Electron main process.
 */
export function withSessionDeleteGateLock<T>(
  sessionKey: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = sessionDeleteGateLocks.get(sessionKey);
  const current = (previous ?? Promise.resolve()).then(fn, fn);
  sessionDeleteGateLocks.set(sessionKey, current);
  void current.then(
    () => {
      if (sessionDeleteGateLocks.get(sessionKey) === current) {
        sessionDeleteGateLocks.delete(sessionKey);
      }
    },
    () => {
      if (sessionDeleteGateLocks.get(sessionKey) === current) {
        sessionDeleteGateLocks.delete(sessionKey);
      }
    },
  );
  return current;
}

/** Try the same critical section without allowing an admission caller to wait. */
export function tryWithSessionDeleteGateLock<T>(
  sessionKey: string,
  fn: () => Promise<T> | T,
): Promise<T> | undefined {
  if (sessionDeleteGateLocks.has(sessionKey)) {
    return undefined;
  }
  return withSessionDeleteGateLock(sessionKey, fn);
}

/**
 * Electron mirror gate. The caller must persist an operationId before the
 * first sessions.delete RPC; on RPC unknown/failure the gate remains open and
 * the next delete for the same session reuses that operationId.
 */
export async function findSessionDeleteGateBySession(
  sessionKey: string,
): Promise<SessionDeleteGateRecord | undefined> {
  return withGateFileLock(async () => {
    const file = await readGateFile();
    return Object.values(file.gates).find((gate) => gate.sessionKey === sessionKey);
  });
}

export async function persistSessionDeleteGate(
  sessionKey: string,
  agentId: string,
): Promise<SessionDeleteGateRecord> {
  return withGateFileLock(async () => {
    const file = await readGateFile();
    const existing = Object.values(file.gates).find((gate) => gate.sessionKey === sessionKey);
    if (existing) return existing;
    const now = Date.now();
    const gate: SessionDeleteGateRecord = {
      operationId: randomUUID(),
      sessionKey,
      agentId,
      createdAt: now,
      updatedAt: now,
    };
    file.gates[gate.operationId] = gate;
    await writeGateFile(file);
    logger.info(`[session-delete-gate] Persisted operationId=${gate.operationId} sessionKey=${sessionKey}`);
    return gate;
  });
}

export async function updateSessionDeleteGate(
  operationId: string,
  patch: Partial<Pick<SessionDeleteGateRecord,
    'expectedSessionId' | 'terminalClosed' | 'localSweepCommitted'>>,
): Promise<SessionDeleteGateRecord | undefined> {
  return withGateFileLock(async () => {
    const file = await readGateFile();
    const current = file.gates[operationId];
    if (!current) return undefined;
    const updated: SessionDeleteGateRecord = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    file.gates[operationId] = updated;
    await writeGateFile(file);
    return updated;
  });
}

export async function clearSessionDeleteGate(operationId: string): Promise<void> {
  await withGateFileLock(async () => {
    const file = await readGateFile();
    if (file.gates[operationId]) {
      delete file.gates[operationId];
      await writeGateFile(file);
      logger.info(`[session-delete-gate] Cleared operationId=${operationId}`);
    }
  });
}
