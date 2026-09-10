// Phase 4 Windows/Node detached helper proof using the real spawner. This test
// intentionally avoids a real 24h TTL and uses a temporary runDir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDurableHelperIntent,
  durableOutcomeDigest,
  readDurableHelperFiles,
} from "./goal-wake-helper-protocol.js";
import {
  resolveDurableHelperLaunch,
  spawnDurableHelperProcess,
  type DurableHelperLaunch,
} from "./goal-wake-helper-host.js";

const tempRoots: string[] = [];
let rootDir = "";
let launch: DurableHelperLaunch;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "durable-helper-host-"));
  tempRoots.push(root);
  rootDir = path.join(root, "background-processes");
  const runtimeRoot = path.resolve(".");
  launch = {
    file: process.execPath,
    args: [
      "--import",
      pathToFileURL(
        path.join(runtimeRoot, "node_modules", "tsx", "dist", "loader.mjs"),
      ).href,
      path.join(runtimeRoot, "src", "entry.ts"),
    ],
    env: { ELECTRON_RUN_AS_NODE: "" },
  };
  delete process.env.ELECTRON_RUN_AS_NODE;
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
});

describe("detached durable helper host", () => {
  it("spawns a detached helper that writes started/exit and survives an unref'd parent handle", async () => {
    const intent = await createDurableHelperIntent(
      {
        runId: "run_detached_exit",
        commandDigest: "d".repeat(64),
        policyRevision: "runtime-lifecycle-phase4-host-v1",
        ownerEpoch: "epoch-host",
      },
      { rootDir },
    );
    const handle = await spawnDurableHelperProcess({
      runId: "run_detached_exit",
      rootDir,
      nonce: intent.nonce,
      ownerEpoch: intent.ownerEpoch,
      commandDigest: intent.commandDigest,
      argv: [process.execPath, "-e", "setTimeout(() => process.exit(0), 80)"],
      env: { ...process.env },
      cwd: os.tmpdir(),
      timeoutMs: 5_000,
      launch,
    });
    expect(handle.helperPid).toBeGreaterThan(0);
    const started = await handle.started;
    expect(started?.helperPid).toBe(handle.helperPid);
    expect(started?.childPid).toBeGreaterThan(0);
    expect(started?.runNonce).toBe(intent.nonce);
    const exit = await handle.exit;
    expect(exit).toBeTruthy();
    expect(exit?.exitCode).toBe(0);
    expect(exit?.timedOut).toBe(false);
    handle.dispose();
  }, 20_000);

  it("cancel writes control.json and the helper terminates the child tree", async () => {
    const intent = await createDurableHelperIntent(
      {
        runId: "run_detached_cancel",
        commandDigest: "e".repeat(64),
        policyRevision: "runtime-lifecycle-phase4-host-v1",
        ownerEpoch: "epoch-host",
      },
      { rootDir },
    );
    const handle = await spawnDurableHelperProcess({
      runId: "run_detached_cancel",
      rootDir,
      nonce: intent.nonce,
      ownerEpoch: intent.ownerEpoch,
      commandDigest: intent.commandDigest,
      argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      env: { ...process.env },
      cwd: os.tmpdir(),
      timeoutMs: 30_000,
      launch,
    });
    const started = await handle.started;
    expect(started?.childPid).toBeGreaterThan(0);
    await handle.cancel("test-cancel");
    const exit = await handle.exit;
    expect(exit?.timedOut).toBe(false);
    const files = await readDurableHelperFiles("run_detached_cancel", { rootDir });
    expect(files.control?.action).toBe("cancel");
    expect(files.exit).toBeTruthy();
    expect(files.exit?.outcomeDigest).toBe(
      durableOutcomeDigest({ exitCode: files.exit?.exitCode ?? null, signal: null, timedOut: false }),
    );
    handle.dispose();
  }, 20_000);

  it("fails closed when the helper entry cannot be resolved", () => {
    expect(() =>
      resolveDurableHelperLaunch({}, [], []),
    ).toThrow(/unresolved/);
  });
});
