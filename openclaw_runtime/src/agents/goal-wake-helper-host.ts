// Runtime Lifecycle Governance -- detached durable-helper spawner (same
// gateway). The spawned helper is unref'd and survives a Gateway process
// restart; after restart the reconciler watches files instead of attaching a
// Node exit listener to a process this Gateway no longer owns.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  GOAL_WAKE_HELPER_PROTOCOL_VERSION,
  readDurableHelperFiles,
  readDurableHelperTail,
  requestDurableHelperCancellation,
  type DurableHelperExit,
  type DurableHelperProtocolOptions,
  type DurableHelperStarted,
} from "./goal-wake-helper-protocol.js";

export type DurableHelperLaunch = {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
};

export type DurableHelperSpawnInput = {
  /** Host-owned check after asynchronous intent lookup, before helper launch. */
  beforeSpawn?: () => void;
  runId: string;
  rootDir: string;
  nonce: string;
  ownerEpoch: string;
  commandDigest: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs?: number;
  launch?: DurableHelperLaunch;
};

export type DurableHelperSpawnHandle = {
  helperPid: number;
  started: Promise<DurableHelperStarted | undefined>;
  exit: Promise<DurableHelperExit | undefined>;
  cancel: (reason: string) => Promise<void>;
  onStarted: (listener: (started: DurableHelperStarted) => void) => () => void;
  onTail: (listener: (tail: string) => void) => () => void;
  dispose: () => void;
};

const STARTED_WATCH_INTERVAL_MS = 100;
const TAIL_WATCH_INTERVAL_MS = 250;

function isTsxRunner(file: string | undefined): boolean {
  if (!file) return false;
  const normalized = file.replace(/\\/gu, "/");
  return /(?:^|\/)cli\.mjs$/u.test(normalized) || normalized.endsWith("/tsx");
}

/**
 * Reuses the same entry/loader pair that launched this Gateway process. In a
 * packaged Electron build that is `electron.exe <openclaw entry> …` plus
 * `ELECTRON_RUN_AS_NODE`; in the source runtime it is either
 * `node --import tsx src/entry.ts` or `node <tsx cli.mjs> src/entry.ts`.
 * Reusing `process.argv` is what keeps Electron packaging viable without a
 * second bundled helper binary.
 */
export function resolveDurableHelperLaunch(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
  execArgv: string[] = process.execArgv,
  execPath: string = process.execPath,
): DurableHelperLaunch {
  const explicit = env.OPENCLAW_GOAL_WAKE_HELPER_ENTRY?.trim();
  if (explicit) {
    return { file: execPath, args: [explicit] };
  }
  const entry = argv[1];
  if (isTsxRunner(entry) && argv[2]) {
    return { file: execPath, args: [entry, argv[2]] };
  }
  if (entry) {
    // On Windows `node --import D:	sx\loader.mjs` is interpreted as an URL
    // with scheme `d:`; normalize import paths to file URLs like tsx itself.
    const normalizedExecArgv: string[] = [];
    for (let index = 0; index < execArgv.length; index += 1) {
      const arg = execArgv[index];
      if (arg === "--import" && execArgv[index + 1] && path.isAbsolute(execArgv[index + 1])) {
        normalizedExecArgv.push(arg, pathToFileURL(execArgv[index + 1]).href);
        index += 1;
        continue;
      }
      if (arg?.startsWith("--import=")) {
        const value = arg.slice("--import=".length);
        if (path.isAbsolute(value)) {
          normalizedExecArgv.push(`--import=${pathToFileURL(value).href}`);
          continue;
        }
      }
      normalizedExecArgv.push(arg);
    }
    return { file: execPath, args: [...normalizedExecArgv, entry] };
  }
  throw new Error(
    "durable helper launch is unresolved; fail closed and leave the run lost (set OPENCLAW_GOAL_WAKE_HELPER_ENTRY in non-CLI embeds)",
  );
}

function resolveHelperEnv(launch: DurableHelperLaunch): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...process.env, ...(launch.env ?? {}) };
  if (process.versions.electron || process.env.ELECTRON_RUN_AS_NODE) {
    next.ELECTRON_RUN_AS_NODE = "1";
  }
  return next;
}

function watchJsonFile<T>(file: string, intervalMs: number): {
  promise: Promise<T | undefined>;
  stop: () => void;
} {
  let settled = false;
  let resolvePromise: (value: T | undefined) => void = () => {};
  const promise = new Promise<T | undefined>((resolve) => {
    resolvePromise = resolve;
  });
  const read = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as T;
      if (parsed !== null && typeof parsed === "object") {
        settled = true;
        stop();
        resolvePromise(parsed);
      }
    } catch {
      // Not present yet; keep watching.
    }
  };
  const stop = () => {
    fs.unwatchFile(file);
  };
  read();
  if (!settled) {
    fs.watchFile(file, { interval: intervalMs }, read);
  }
  return { promise, stop };
}

/** Spawns exactly one detached helper. The caller must already own intent.json. */
export async function spawnDurableHelperProcess(
  input: DurableHelperSpawnInput,
): Promise<DurableHelperSpawnHandle> {
  const options: DurableHelperProtocolOptions = { rootDir: input.rootDir };
  const files = await readDurableHelperFiles(input.runId, options);
  if (!files.intent) throw new Error("durable helper intent is missing or invalid");
  if (files.intent.nonce !== input.nonce || files.intent.ownerEpoch !== input.ownerEpoch) {
    throw new Error("durable helper spawn claim does not match intent");
  }
  if (files.started || files.exit) {
    throw new Error("durable helper run was already claimed");
  }

  const launch = input.launch ?? resolveDurableHelperLaunch();
  input.beforeSpawn?.();
  const child = spawn(
    launch.file,
    [...launch.args, "goal-wake-helper-run", input.runId],
    {
      cwd: input.cwd,
      env: resolveHelperEnv(launch),
      detached: true,
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  child.unref();
  if (!child.stdin) {
    child.kill();
    throw new Error("durable helper stdin is unavailable");
  }
  const payload = `${JSON.stringify({
    runId: input.runId,
    rootDir: input.rootDir,
    argv: input.argv,
    env: input.env,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    protocolVersion: GOAL_WAKE_HELPER_PROTOCOL_VERSION,
  })}\n`;
  child.stdin.write(payload);
  child.stdin.end();

  const runDir = path.join(input.rootDir, input.runId);
  const startedWatcher = watchJsonFile<DurableHelperStarted>(
    path.join(runDir, "started.json"),
    STARTED_WATCH_INTERVAL_MS,
  );
  let tailWatcher: fs.StatWatcher | null = null;
  let lastTail = "";
  const startedListeners = new Set<(started: DurableHelperStarted) => void>();
  const tailListeners = new Set<(tail: string) => void>();
  const checkTail = async () => {
    const tail = await readDurableHelperTail(input.runId, options).catch(() => "");
    if (tail === lastTail) return;
    lastTail = tail;
    for (const listener of tailListeners) listener(tail);
  };
  try {
    tailWatcher = fs.watchFile(
      path.join(runDir, "tail.txt"),
      { interval: TAIL_WATCH_INTERVAL_MS },
      () => {
        void checkTail();
      },
    );
  } catch {
    // fs.watch/watchFile are best-effort accelerators; sweep reconciles.
  }
  void checkTail();

  void startedWatcher.promise.then((started) => {
    if (!started) return;
    for (const listener of startedListeners) listener(started);
  });

  let settled = false;
  const exit = new Promise<DurableHelperExit | undefined>((resolve) => {
    const settle = async (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) {
        resolve(undefined);
        return;
      }
      const next = await readDurableHelperFiles(input.runId, options).catch(() => undefined);
      resolve(next?.exit);
    };
    child.once("error", (error) => {
      void settle(error);
    });
    child.once("exit", () => {
      void settle();
    });
  });

  return {
    helperPid: child.pid ?? 0,
    started: startedWatcher.promise,
    exit,
    cancel: async (reason) => {
      await requestDurableHelperCancellation(
        {
          runId: input.runId,
          nonce: input.nonce,
          ownerEpoch: input.ownerEpoch,
          reason,
        },
        options,
      );
    },
    onStarted: (listener) => {
      startedListeners.add(listener);
      return () => startedListeners.delete(listener);
    },
    onTail: (listener) => {
      tailListeners.add(listener);
      return () => tailListeners.delete(listener);
    },
    dispose: () => {
      startedWatcher.stop();
      if (tailWatcher) fs.unwatchFile(path.join(runDir, "tail.txt"));
      tailListeners.clear();
      startedListeners.clear();
    },
  };
}
