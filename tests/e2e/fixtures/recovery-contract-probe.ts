import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ElectronApplication } from "@playwright/test";
import { hostInvoke } from "./fp-p1-harness";
import { closeElectronApp } from "./electron";

export const MAIN_RECOVERY_KEY = "agent:main:main";
export type SessionRow = {
  sessionId: string;
  sessionFile?: string;
  status?: string;
  abortedLastRun?: boolean;
  label?: string;
  spawnedBy?: string;
  pendingFinalDelivery?: boolean;
  pendingFinalDeliveryText?: string | null;
};

function query(file: string, sql: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}
export function readRecoveryDisk(stateDir: string, sessionKey = MAIN_RECOVERY_KEY) {
  const agentDb = join(stateDir, "agents/main/agent/openclaw-agent.sqlite");
  const stateDb = join(stateDir, "state/openclaw.sqlite");
  const sessions = Object.fromEntries(
    query(agentDb, "SELECT key,value_json FROM cache_entries WHERE scope='session_entries'").map(
      (row) => [String(row.key), JSON.parse(String(row.value_json)) as SessionRow],
    ),
  );
  const main = sessions[sessionKey] as SessionRow | undefined;
  const sessionFile = main?.sessionFile
    ? isAbsolute(main.sessionFile)
      ? main.sessionFile
      : join(stateDir, "agents/main/sessions", main.sessionFile)
    : main?.sessionId
      ? join(stateDir, "agents/main/sessions", `${main.sessionId}.jsonl`)
      : undefined;
  const raw = sessionFile && existsSync(sessionFile) ? readFileSync(sessionFile, "utf8") : "";
  const entries = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const byId = new Map(
    entries.filter((entry) => entry.type !== "session").map((entry) => [entry.id, entry]),
  );
  const branch = [];
  let leaf = entries.findLast((entry) => entry.type !== "session");
  const seen = new Set<string>();
  while (leaf && !seen.has(leaf.id)) {
    seen.add(leaf.id);
    branch.unshift(leaf);
    leaf = byId.get(leaf.parentId);
  }
  const flows = query(
    stateDb,
    "SELECT flow_id,controller_id,status,execution_phase,revision,state_json FROM flow_runs WHERE controller_id='tool-execution'",
  );
  const children = query(stateDb, "SELECT * FROM subagent_runs");
  return {
    main,
    sessions,
    sessionFile,
    entries,
    branch,
    flows,
    children,
    transcriptSha256: createHash("sha256").update(raw).digest("hex"),
  };
}
/** A transcript answer can precede final delivery cleanup and lifecycle settlement. */
export function isRecoveryWarmupSettled(
  disk: ReturnType<typeof readRecoveryDisk>,
  terminalStatus: string,
): boolean {
  return (
    terminalStatus === "ok" &&
    disk.main?.status === "done" &&
    !disk.main.pendingFinalDelivery &&
    !disk.main.pendingFinalDeliveryText &&
    disk.branch.some(
      (entry) =>
        entry.message?.role === "assistant" &&
        entry.message.stopReason === "stop" &&
        JSON.stringify(entry.message).includes("warmup complete"),
    )
  );
}

/** Reconciliation is complete when the original execution phase records it. */
export function isRecoveryDiskVerdictSettled(value: {
  disk: Pick<ReturnType<typeof readRecoveryDisk>, "main" | "flows">;
  decisions: Array<{ action: string }>;
}): boolean {
  const main = value.disk.main;
  if (!main?.status) return false;
  return (
    main.status !== "running" ||
    (main.abortedLastRun === true &&
      value.decisions.some((decision) => decision.action === "reconcile") &&
      value.disk.flows.some(
        (flow) =>
          flow.execution_phase === "effect_pending" &&
          JSON.parse(String(flow.state_json))?.recovery?.needsReconciliation === true,
      ))
  );
}

export function effectLines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean) : [];
}
export function writeProbe(configPath: string, config: Record<string, unknown>) {
  writeFileSync(configPath, JSON.stringify(config), { encoding: "utf8", flush: true });
}
export function readProbeFiles(dir: string, prefix: string) {
  return readdirSync(dir)
    .filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
    .map(
      (file) =>
        ({ file, ...JSON.parse(readFileSync(join(dir, file), "utf8")) }) as {
          file: string;
          pid: number;
          point?: string;
          action: string;
          id: string;
          observedAt: number;
          facts?: Record<string, unknown>;
        },
    )
    .sort((left, right) => left.observedAt - right.observedAt || left.file.localeCompare(right.file));
}
export function readRecoveryFaultBoundary(
  probeDir: string,
  point: string,
  seenPids: ReadonlySet<number>,
  requiredEffectPath?: string,
) {
  const hit = readProbeFiles(probeDir, "hit-").find((entry) => entry.point === point && !seenPids.has(entry.pid));
  // exec may return a running process before its effect lands. Keep the same boundary wait budget.
  if (hit && requiredEffectPath && effectLines(requiredEffectPath).length === 0) return undefined;
  return hit;
}
export async function eventually<T>(
  read: () => T | Promise<T>,
  accept: (value: T) => boolean,
  label: string,
  timeout = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  let value: T | undefined;
  let error: unknown;
  while (Date.now() < deadline) {
    try {
      value = await read();
      if (accept(value)) return value;
    } catch (e) {
      error = e;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out: ${error ?? JSON.stringify(value)?.slice(0, 1000)}`);
}
/** Retain a real negative observation after an injected fault instead of dropping its trial. */
export async function observeRecoveryVerdict<T>(
  read: () => T | Promise<T>,
  accept: (value: T) => boolean,
  timeout = 150_000,
) {
  try {
    return {
      value: await eventually(read, accept, "terminal/reconciliation disk state", timeout),
      timedOut: false,
      error: "",
    };
  } catch (error) {
    return { value: await read(), timedOut: true, error: String(error) };
  }
}
export function persistEvidence(dir: string, name: string, value: unknown) {
  mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(value, null, 2) + "\n";
  const path = join(dir, name);
  writeFileSync(path, text, { encoding: "utf8", flush: true });
  return {
    path,
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text),
  };
}

/** Preserve a failure during a multi-crash sequence, even if its final snapshot is unreadable. */
export function persistFailedRecoveryObservation(
  dir: string, reads: Record<string, () => unknown>, error: unknown, name = "failed-observation.json",
) {
  const value: Record<string, unknown> = {};
  const snapshotErrors: Record<string, string> = {};
  for (const [name, read] of Object.entries(reads)) {
    try {
      value[name] = read();
    } catch (failure) {
      value[name] = null;
      snapshotErrors[name] = String(failure);
    }
  }
  return persistEvidence(dir, name, {
    error: String(error), value, snapshotErrors,
    driven_by: "agent", actor: "recovery-contract-matrix", realHumanEvidence: false,
  });
}

/** Attempt every cleanup and retain the original trial error alongside cleanup failures. */
export async function finishRecoveryTrialCleanup(
  trialErrors: readonly unknown[],
  cleanups: Array<() => unknown | Promise<unknown>>,
) {
  const errors = [...trialErrors];
  for (const cleanup of cleanups) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, errors.map(String).join("\n"));
}

/** Close the live child before closing Playwright's owning app connection. */
export async function closeRecoveryApp(app: ElectronApplication): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      hostInvoke(app, "gateway", "stop"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("recovery app cleanup timed out")), 15_000);
      }),
    ]);
  } catch {
    // The fixture's bounded cleanup below owns the native process tree.
  } finally {
    if (timer) clearTimeout(timer);
  }
  // This owner closes Playwright once; a second concurrent close can force a blocking taskkill.
  const closed = await closeElectronApp(app, 1_000);
  if (!closed.mainExited || !closed.launcherExited || !closed.closeSettled) {
    throw new Error(`Recovery app cleanup incomplete: ${JSON.stringify(closed)}`);
  }
}
