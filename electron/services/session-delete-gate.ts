import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getOpenClawConfigDir } from "../utils/paths";
import { logger } from "../utils/logger";

export type SessionDeleteGateRecord = {
  operationId: string;
  sessionKey: string;
  agentId: string;
  createdAt: number;
  updatedAt: number;
};

type SessionDeleteGateFile = {
  version: 1;
  gates: Record<string, SessionDeleteGateRecord>;
};

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
    if (parsed && typeof parsed === "object" && (parsed as { gates?: unknown }).gates) {
      return parsed as SessionDeleteGateFile;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(`[session-delete-gate] Could not read gate file: ${String(error)}`);
    }
  }
  return { version: 1, gates: {} };
}

async function writeGateFile(file: SessionDeleteGateFile): Promise<void> {
  const filePath = resolveSessionDeleteGatePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(file, null, 2), "utf8");
}

/**
 * Electron mirror gate. The caller must persist an operationId before the
 * first sessions.delete RPC; on RPC unknown/failure the gate remains open and
 * the next delete for the same session reuses that operationId.
 */
export async function findSessionDeleteGateBySession(
  sessionKey: string,
): Promise<SessionDeleteGateRecord | undefined> {
  const file = await readGateFile();
  return Object.values(file.gates).find((gate) => gate.sessionKey === sessionKey);
}

export async function persistSessionDeleteGate(
  sessionKey: string,
  agentId: string,
): Promise<SessionDeleteGateRecord> {
  const now = Date.now();
  const gate: SessionDeleteGateRecord = {
    operationId: randomUUID(),
    sessionKey,
    agentId,
    createdAt: now,
    updatedAt: now,
  };
  const file = await readGateFile();
  file.gates[gate.operationId] = gate;
  await writeGateFile(file);
  logger.info(`[session-delete-gate] Persisted operationId=${gate.operationId} sessionKey=${sessionKey}`);
  return gate;
}

export async function clearSessionDeleteGate(operationId: string): Promise<void> {
  const file = await readGateFile();
  if (file.gates[operationId]) {
    delete file.gates[operationId];
    await writeGateFile(file);
    logger.info(`[session-delete-gate] Cleared operationId=${operationId}`);
  }
}
