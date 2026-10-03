// Runtime Lifecycle Governance -- detached durable-helper process entry.
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { promisify } from "node:util";

import {
  appendDurableHelperOutput,
  durableOutcomeDigest,
  readDurableHelperFiles,
  writeDurableHelperExit,
  writeDurableHelperHeartbeat,
  writeDurableHelperStarted,
  type DurableHelperProtocolOptions,
} from "./goal-wake-helper-protocol.js";

const execFileAsync = promisify(execFile);
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_CONTROL_WATCH_INTERVAL_MS = 250;

type DurableHelperPayload = {
  runId: string;
  rootDir: string;
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  timeoutMs?: number;
};

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killChildTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    const result = await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 64 * 1024,
    }).catch(() => null);
    if (result) return;
  } else if (process.platform === "linux" || process.platform === "darwin") {
    try {
      process.kill(-pid, "SIGTERM");
      return;
    } catch {
      // Fall back to direct signal below.
    }
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // The child is already gone; killing a dead tree is idempotent.
  }
}

async function readControlJson(
  file: string,
): Promise<{ nonce: string; action: "cancel" } | undefined> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(file, "utf8")) as {
      nonce?: unknown;
      action?: unknown;
    };
    if (typeof parsed.nonce === "string" && parsed.action === "cancel") {
      return { nonce: parsed.nonce, action: "cancel" };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return undefined;
  }
  return undefined;
}

export async function runGoalWakeHelperEntry(
  io: {
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
  } = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  },
): Promise<number> {
  const fail = (message: string): number => {
    io.stderr.write(`[durable-helper] ${message}\n`);
    return 1;
  };

  let payloadRaw = "";
  for await (const chunk of io.stdin) {
    payloadRaw += String(chunk);
    if (payloadRaw.length > 8 * 1024 * 1024) {
      return fail("payload exceeds helper stdin limit");
    }
  }
  let payload: DurableHelperPayload;
  try {
    payload = JSON.parse(payloadRaw) as DurableHelperPayload;
  } catch {
    return fail("payload is not valid JSON");
  }
  if (
    !payload ||
    typeof payload.runId !== "string" ||
    typeof payload.rootDir !== "string" ||
    !Array.isArray(payload.argv) ||
    payload.argv.length === 0 ||
    !payload.argv.every((value) => typeof value === "string") ||
    typeof payload.env !== "object" ||
    payload.env === null ||
    typeof payload.cwd !== "string"
  ) {
    return fail("payload is missing required helper fields");
  }

  const options: DurableHelperProtocolOptions = { rootDir: payload.rootDir };
  const files = await readDurableHelperFiles(payload.runId, options).catch(() => undefined);
  const intent = files?.intent;
  if (!intent) {
    return fail("intent.json is missing or invalid");
  }
  if (files.started) {
    return fail("started.json already exists; refusing a duplicate helper claim");
  }

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(payload.argv[0], payload.argv.slice(1), {
      cwd: payload.cwd,
      env: payload.env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    await writeDurableHelperExit(
      {
        runId: payload.runId,
        nonce: intent.nonce,
        exitCode: null,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: null, signal: null, timedOut: false }),
      },
      options,
    ).catch(() => undefined);
    return fail(error instanceof Error ? error.message : String(error));
  }

  const childPid = child.pid ?? 0;
  if (!childPid || !child.stdout || !child.stderr) {
    await writeDurableHelperExit(
      {
        runId: payload.runId,
        nonce: intent.nonce,
        exitCode: null,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: null, signal: null, timedOut: false }),
      },
      options,
    ).catch(() => undefined);
    return fail("helper could not resolve the command child");
  }

  // started.json is the exclusive helper claim and is written exactly once.
  const started = await writeDurableHelperStarted(
    {
      runId: payload.runId,
      runNonce: intent.nonce,
      helperPid: process.pid,
      childPid,
      startedAtMs: Date.now(),
      commandDigest: intent.commandDigest,
    },
    options,
  ).catch(async () => {
    await killChildTree(childPid);
    await writeDurableHelperExit(
      {
        runId: payload.runId,
        nonce: intent.nonce,
        exitCode: null,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: null, signal: null, timedOut: false }),
      },
      options,
    ).catch(() => undefined);
    return undefined;
  });
  if (!started) {
    return fail("helper could not claim started.json");
  }

  let heartbeatTimer: NodeJS.Timeout | null = null;
  const writeHeartbeat = async () => {
    if (!isAlive(childPid)) return;
    await writeDurableHelperHeartbeat(
      {
        runId: payload.runId,
        nonce: intent.nonce,
        helperPid: process.pid,
        childPid,
      },
      options,
    ).catch(() => undefined);
    heartbeatTimer = setTimeout(() => {
      void writeHeartbeat();
    }, DEFAULT_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  };
  await writeHeartbeat();

  let outputChain = Promise.resolve();
  const append = (output: string) => {
    outputChain = outputChain.then(() =>
      appendDurableHelperOutput({ runId: payload.runId, output }, options).catch(() => undefined),
    );
  };
  child.stdout.on("data", (chunk: Buffer) => append(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => append(chunk.toString("utf8")));

  let cancelled = false;
  let controlTimer: NodeJS.Timeout | null = null;
  const controlPath = `${options.rootDir}/${payload.runId}/control.json`;
  const checkControl = async () => {
    if (cancelled) return;
    const control = await readControlJson(controlPath);
    if (!control || control.nonce !== intent.nonce) return;
    cancelled = true;
    await killChildTree(childPid);
  };
  const scheduleControlCheck = () => {
    if (cancelled) return;
    controlTimer = setTimeout(() => {
      void checkControl().finally(() => scheduleControlCheck());
    }, DEFAULT_CONTROL_WATCH_INTERVAL_MS);
    controlTimer.unref?.();
  };
  let controlWatcher: fs.FSWatcher | null;
  try {
    controlWatcher = fs.watch(`${options.rootDir}/${payload.runId}`, () => {
      void checkControl();
    });
  } catch {
    controlWatcher = null;
  }
  scheduleControlCheck();

  let timedOut = false;
  let timeoutTimer: NodeJS.Timeout | null = null;
  if (payload.timeoutMs && payload.timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      void killChildTree(childPid);
    }, payload.timeoutMs);
    timeoutTimer.unref?.();
  }

  try {
    const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (controlTimer) clearTimeout(controlTimer);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    controlWatcher?.close();
    await outputChain;
    await writeDurableHelperExit(
      {
        runId: payload.runId,
        nonce: intent.nonce,
        exitCode: timedOut ? null : code,
        signal: timedOut ? null : signal,
        timedOut,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({
          exitCode: timedOut ? null : code,
          signal: timedOut ? null : signal,
          timedOut,
        }),
      },
      options,
    );
    return 0;
  } catch (error) {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (controlTimer) clearTimeout(controlTimer);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    controlWatcher?.close();
    await killChildTree(childPid);
    await writeDurableHelperExit(
      {
        runId: payload.runId,
        nonce: intent.nonce,
        exitCode: null,
        signal: null,
        timedOut,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: null, signal: null, timedOut }),
      },
      options,
    ).catch(() => undefined);
    return fail(error instanceof Error ? error.message : String(error));
  }
}
