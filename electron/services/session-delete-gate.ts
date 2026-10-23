import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getOpenClawConfigDir } from "../utils/paths";
import { logger } from "../utils/logger";
import { withFileLock, writeFileAtomic } from "../utils/atomic-write";

export type SessionLifecycleMutationKind = "delete" | "archive" | "restore";

export type SessionDeleteGateRecord = {
  operationId: string;
  operationKind: SessionLifecycleMutationKind;
  requestDigest?: string;
  sessionKey: string;
  agentId: string;
  expectedSessionId?: string;
  terminalClosed?: boolean;
  localSweepCommitted?: boolean;
  /**
   * Why the local mirror sweep was skipped even though the Gateway commit
   * succeeded (for example: this runtime keeps no legacy sessions.json).
   * A skipped sweep is not a failed delete, but it must stay auditable.
   */
  localSweepSkipped?: string;
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
      const file = parsed as SessionDeleteGateFile;
      for (const gate of Object.values(file.gates)) {
        gate.operationKind ??= "delete";
      }
      return file;
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


export function buildSessionMutationRequestDigest(
  operationKind: SessionLifecycleMutationKind,
  payload: Record<string, unknown>,
): string {
  const ordered = Object.fromEntries(
    Object.entries({ operationKind, ...payload })
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
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


export async function persistSessionMutationGate(input: {
  sessionKey: string;
  agentId: string;
  operationKind: SessionLifecycleMutationKind;
  requestDigest: string;
}): Promise<SessionDeleteGateRecord> {
  return withGateFileLock(async () => {
    const file = await readGateFile();
    const existing = Object.values(file.gates).find((gate) => gate.sessionKey === input.sessionKey);
    if (existing) {
      if (
        (existing.operationKind ?? "delete") !== input.operationKind ||
        (existing.requestDigest && existing.requestDigest !== input.requestDigest)
      ) {
        throw new Error(
          `Session ${input.sessionKey} has a pending ${existing.operationKind ?? "delete"} operation ${existing.operationId}`,
        );
      }
      return existing;
    }
    const now = Date.now();
    const gate: SessionDeleteGateRecord = {
      operationId: randomUUID(),
      operationKind: input.operationKind,
      requestDigest: input.requestDigest,
      sessionKey: input.sessionKey,
      agentId: input.agentId,
      createdAt: now,
      updatedAt: now,
    };
    file.gates[gate.operationId] = gate;
    await writeGateFile(file);
    logger.info(
      `[session-delete-gate] Persisted kind=${gate.operationKind} operationId=${gate.operationId} sessionKey=${gate.sessionKey}`,
    );
    return gate;
  });
}

export async function persistSessionDeleteGate(
  sessionKey: string,
  agentId: string,
): Promise<SessionDeleteGateRecord> {
  return persistSessionMutationGate({
    sessionKey,
    agentId,
    operationKind: "delete",
    requestDigest: buildSessionMutationRequestDigest("delete", { sessionKey, agentId }),
  });
}

export async function updateSessionDeleteGate(
  operationId: string,
  patch: Partial<Pick<SessionDeleteGateRecord,
    'expectedSessionId' | 'terminalClosed' | 'localSweepCommitted' | 'localSweepSkipped'>>,
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
