// Runtime Lifecycle Governance -- Phase 4 durable helper file protocol.
//
// This module deliberately owns only the durable artifact boundary. It never
// receives argv, cwd, or environment values, so those values cannot leak into
// the persisted protocol files by accident.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { redactSensitiveText } from "../logging/redact.js";

export const GOAL_WAKE_HELPER_PROTOCOL_VERSION = 1;
export const DURABLE_HELPER_DIRECTORY_NAME = "background-processes";
export const DURABLE_HELPER_TAIL_BYTES = 8 * 1024;
export const DURABLE_HELPER_LOG_BYTES = 10 * 1024 * 1024;

export type DurableHelperIntent = {
  protocolVersion: typeof GOAL_WAKE_HELPER_PROTOCOL_VERSION;
  runId: string;
  nonce: string;
  commandDigest: string;
  policyRevision: string;
  ownerEpoch: string;
  createdAt: string;
};

export type DurableHelperStarted = {
  protocolVersion: typeof GOAL_WAKE_HELPER_PROTOCOL_VERSION;
  runNonce: string;
  helperPid: number;
  childPid: number;
  startedAtMs: number;
  commandDigest: string;
};

export type DurableHelperExit = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  endedAtMs: number;
  outcomeDigest: string;
};

export type DurableHelperControl = {
  nonce: string;
  action: "cancel";
  reason: string;
};

export type DurableHelperHeartbeat = {
  protocolVersion: typeof GOAL_WAKE_HELPER_PROTOCOL_VERSION;
  runNonce: string;
  helperPid: number;
  childPid: number;
  atMs: number;
};

export type DurableHelperFiles = {
  intent?: DurableHelperIntent;
  started?: DurableHelperStarted;
  exit?: DurableHelperExit;
  control?: DurableHelperControl;
  heartbeat?: DurableHelperHeartbeat;
};

export type DurableHelperProtocolOptions = {
  rootDir: string;
  now?: () => Date;
};

function requireSafeId(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(normalized)) {
    throw new Error(`${field} must be a safe non-empty identifier`);
  }
  return normalized;
}

function requireDigest(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^[a-f0-9]{16,128}$/iu.test(normalized)) {
    throw new Error(`${field} must be a digest, not raw command text`);
  }
  return normalized.toLowerCase();
}

function runDir(rootDir: string, runId: string): string {
  const root = path.resolve(rootDir);
  const target = path.resolve(root, requireSafeId(runId, "runId"));
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error("runDir escapes durable helper root");
  }
  return target;
}

function filePath(rootDir: string, runId: string, name: string): string {
  return path.join(runDir(rootDir, runId), name);
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  // chmod is intentionally repeated: mkdir honors umask and an existing
  // directory may have been created by an older runtime.
  await fs.chmod(directory, 0o700);
}

async function atomicWriteFile(target: string, contents: string, overwrite = false): Promise<void> {
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.chmod(temp, 0o600);
    if (!overwrite) {
      try {
        await fs.access(target);
        throw new Error(`refusing to overwrite ${path.basename(target)}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("refusing")) throw error;
      }
    }
    await fs.rename(temp, target);
    await fs.chmod(target, 0o600);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

async function readJson<T>(target: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function validateIntent(value: DurableHelperIntent | undefined): DurableHelperIntent | undefined {
  if (!value || value.protocolVersion !== GOAL_WAKE_HELPER_PROTOCOL_VERSION) return undefined;
  try {
    return {
      protocolVersion: GOAL_WAKE_HELPER_PROTOCOL_VERSION,
      runId: requireSafeId(value.runId, "intent.runId"),
      nonce: requireSafeId(value.nonce, "intent.nonce"),
      commandDigest: requireDigest(value.commandDigest, "intent.commandDigest"),
      policyRevision: requireSafeId(value.policyRevision, "intent.policyRevision"),
      ownerEpoch: requireSafeId(value.ownerEpoch, "intent.ownerEpoch"),
      createdAt: new Date(value.createdAt).toISOString(),
    };
  } catch {
    return undefined;
  }
}

function validateStarted(value: DurableHelperStarted | undefined): DurableHelperStarted | undefined {
  if (!value || value.protocolVersion !== GOAL_WAKE_HELPER_PROTOCOL_VERSION) return undefined;
  if (!Number.isInteger(value.helperPid) || value.helperPid <= 0) return undefined;
  if (!Number.isInteger(value.childPid) || value.childPid <= 0) return undefined;
  if (!Number.isFinite(value.startedAtMs) || value.startedAtMs < 0) return undefined;
  try {
    return {
      protocolVersion: GOAL_WAKE_HELPER_PROTOCOL_VERSION,
      runNonce: requireSafeId(value.runNonce, "started.runNonce"),
      helperPid: value.helperPid,
      childPid: value.childPid,
      startedAtMs: value.startedAtMs,
      commandDigest: requireDigest(value.commandDigest, "started.commandDigest"),
    };
  } catch {
    return undefined;
  }
}

function validateExit(value: DurableHelperExit | undefined): DurableHelperExit | undefined {
  if (!value || !Number.isFinite(value.endedAtMs) || value.endedAtMs < 0) return undefined;
  if (value.exitCode !== null && !Number.isInteger(value.exitCode)) return undefined;
  if (value.signal !== null && typeof value.signal !== "string") return undefined;
  if (typeof value.timedOut !== "boolean") return undefined;
  try {
    return {
      exitCode: value.exitCode,
      signal: value.signal,
      timedOut: value.timedOut,
      endedAtMs: value.endedAtMs,
      outcomeDigest: requireDigest(value.outcomeDigest, "exit.outcomeDigest"),
    };
  } catch {
    return undefined;
  }
}

export function resolveDurableHelperRoot(configDir: string): string {
  return path.join(path.resolve(configDir), DURABLE_HELPER_DIRECTORY_NAME);
}

export async function createDurableHelperIntent(
  params: {
    runId: string;
    nonce?: string;
    commandDigest: string;
    policyRevision: string;
    ownerEpoch: string;
  },
  options: DurableHelperProtocolOptions,
): Promise<DurableHelperIntent> {
  const intent: DurableHelperIntent = {
    protocolVersion: GOAL_WAKE_HELPER_PROTOCOL_VERSION,
    runId: requireSafeId(params.runId, "runId"),
    nonce: requireSafeId(params.nonce ?? randomUUID(), "nonce"),
    commandDigest: requireDigest(params.commandDigest, "commandDigest"),
    policyRevision: requireSafeId(params.policyRevision, "policyRevision"),
    ownerEpoch: requireSafeId(params.ownerEpoch, "ownerEpoch"),
    createdAt: (options.now?.() ?? new Date()).toISOString(),
  };
  await ensurePrivateDirectory(options.rootDir);
  const directory = runDir(options.rootDir, intent.runId);
  await ensurePrivateDirectory(directory);
  await atomicWriteFile(
    path.join(directory, "intent.json"),
    `${JSON.stringify(intent)}\n`,
  );
  return intent;
}

export async function readDurableHelperFiles(
  runId: string,
  options: DurableHelperProtocolOptions,
): Promise<DurableHelperFiles> {
  const [intent, started, exit, control, heartbeat] = await Promise.all([
    readJson<DurableHelperIntent>(filePath(options.rootDir, runId, "intent.json")),
    readJson<DurableHelperStarted>(filePath(options.rootDir, runId, "started.json")),
    readJson<DurableHelperExit>(filePath(options.rootDir, runId, "exit.json")),
    readJson<DurableHelperControl>(filePath(options.rootDir, runId, "control.json")),
    readJson<DurableHelperHeartbeat>(filePath(options.rootDir, runId, "heartbeat.json")),
  ]);
  return {
    ...(validateIntent(intent) ? { intent: validateIntent(intent) } : {}),
    ...(validateStarted(started) ? { started: validateStarted(started) } : {}),
    ...(validateExit(exit) ? { exit: validateExit(exit) } : {}),
    ...(control && typeof control.nonce === "string" ? { control } : {}),
    ...(heartbeat && heartbeat.protocolVersion === GOAL_WAKE_HELPER_PROTOCOL_VERSION
      ? { heartbeat }
      : {}),
  };
}

export async function writeDurableHelperStarted(
  params: Omit<DurableHelperStarted, "protocolVersion"> & { runId: string },
  options: DurableHelperProtocolOptions,
): Promise<DurableHelperStarted> {
  const files = await readDurableHelperFiles(params.runId, options);
  if (!files.intent) throw new Error("durable helper intent is missing or invalid");
  const started = validateStarted({ ...params, protocolVersion: GOAL_WAKE_HELPER_PROTOCOL_VERSION });
  if (!started) throw new Error("invalid durable helper started record");
  if (started.runNonce !== files.intent.nonce || started.commandDigest !== files.intent.commandDigest) {
    throw new Error("durable helper started record does not match intent claim");
  }
  await atomicWriteFile(
    filePath(options.rootDir, params.runId, "started.json"),
    `${JSON.stringify(started)}\n`,
  );
  return started;
}

export async function writeDurableHelperExit(
  params: DurableHelperExit & { runId: string; nonce: string },
  options: DurableHelperProtocolOptions,
): Promise<DurableHelperExit> {
  const files = await readDurableHelperFiles(params.runId, options);
  if (!files.intent) throw new Error("durable helper intent is missing or invalid");
  if (requireSafeId(params.nonce, "nonce") !== files.intent.nonce) {
    throw new Error("durable helper exit nonce does not match intent");
  }
  const exit = validateExit(params);
  if (!exit) throw new Error("invalid durable helper exit record");
  if (files.exit) return files.exit;
  await atomicWriteFile(
    filePath(options.rootDir, params.runId, "exit.json"),
    `${JSON.stringify(exit)}\n`,
  );
  return exit;
}

export async function requestDurableHelperCancellation(
  params: { runId: string; nonce: string; ownerEpoch: string; reason: string },
  options: DurableHelperProtocolOptions,
): Promise<DurableHelperControl> {
  const files = await readDurableHelperFiles(params.runId, options);
  if (!files.intent) throw new Error("durable helper intent is missing or invalid");
  if (
    requireSafeId(params.nonce, "nonce") !== files.intent.nonce ||
    requireSafeId(params.ownerEpoch, "ownerEpoch") !== files.intent.ownerEpoch
  ) {
    throw new Error("durable helper cancellation claim is stale");
  }
  const control: DurableHelperControl = {
    nonce: files.intent.nonce,
    action: "cancel",
    // Control data must be human-safe and bounded; raw command data is never accepted here.
    reason: params.reason.replace(/[\r\n]/gu, " ").slice(0, 240),
  };
  await atomicWriteFile(
    filePath(options.rootDir, params.runId, "control.json"),
    `${JSON.stringify(control)}\n`,
    true,
  );
  return control;
}

function redactTail(value: string): string {
  try {
    return redactSensitiveText(value, { mode: "tools" });
  } catch {
    // Tail redaction must never make recovery fail: protocol-level patterns
    // still cover the common secret shapes when logging config is unavailable.
    return value
      .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/giu, "$1 [REDACTED]")
      .replace(/\b(api[_-]?key|token|password|secret)\b\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]");
  }
}

export async function appendDurableHelperOutput(
  params: { runId: string; output: string },
  options: DurableHelperProtocolOptions,
): Promise<void> {
  const directory = runDir(options.rootDir, params.runId);
  const output = String(params.output);
  const logPath = path.join(directory, "stdout.log");
  const tailPath = path.join(directory, "tail.txt");
  let oldLog = "";
  try {
    oldLog = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const nextLog = `${oldLog}${output}`.slice(-DURABLE_HELPER_LOG_BYTES);
  const nextTail = redactTail(nextLog.slice(-DURABLE_HELPER_TAIL_BYTES));
  await atomicWriteFile(logPath, nextLog, true);
  await atomicWriteFile(tailPath, nextTail, true);
}

export async function writeDurableHelperHeartbeat(
  params: {
    runId: string;
    nonce: string;
    helperPid: number;
    childPid: number;
  },
  options: DurableHelperProtocolOptions,
): Promise<DurableHelperHeartbeat> {
  const files = await readDurableHelperFiles(params.runId, options);
  if (!files.intent) throw new Error("durable helper intent is missing or invalid");
  if (requireSafeId(params.nonce, "nonce") !== files.intent.nonce) {
    throw new Error("durable helper heartbeat nonce does not match intent");
  }
  const heartbeat: DurableHelperHeartbeat = {
    protocolVersion: GOAL_WAKE_HELPER_PROTOCOL_VERSION,
    runNonce: files.intent.nonce,
    helperPid: params.helperPid,
    childPid: params.childPid,
    atMs: Date.now(),
  };
  await atomicWriteFile(
    filePath(options.rootDir, params.runId, "heartbeat.json"),
    `${JSON.stringify(heartbeat)}
`,
    true,
  );
  return heartbeat;
}

/** Reads the redacted wake-facing tail. stdout.log is intentionally never read here. */
export async function readDurableHelperTail(
  runId: string,
  options: DurableHelperProtocolOptions,
  maxChars = DURABLE_HELPER_TAIL_BYTES,
): Promise<string> {
  try {
    const raw = await fs.readFile(filePath(options.rootDir, runId, "tail.txt"), "utf8");
    return redactTail(raw).slice(-Math.max(1, Math.floor(maxChars)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

export async function durableRunOutputBytes(
  runId: string,
  options: DurableHelperProtocolOptions,
): Promise<number> {
  try {
    const stat = await fs.stat(filePath(options.rootDir, runId, "stdout.log"));
    return stat.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export async function listDurableHelperRunIds(options: DurableHelperProtocolOptions): Promise<string[]> {
  await ensurePrivateDirectory(options.rootDir);
  const entries = await fs.readdir(options.rootDir, { withFileTypes: true });
  const runIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name)) continue;
    const files = await readDurableHelperFiles(entry.name, options).catch(() => undefined);
    if (files?.intent) runIds.push(files.intent.runId);
  }
  return runIds.sort();
}

export async function removeDurableHelperRunDir(
  runId: string,
  options: DurableHelperProtocolOptions,
): Promise<void> {
  await fs.rm(runDir(options.rootDir, runId), { recursive: true, force: true, maxRetries: 2 });
}

export function durableOutcomeDigest(input: {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
