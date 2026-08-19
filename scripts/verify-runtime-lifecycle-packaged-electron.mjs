#!/usr/bin/env node
// Runtime Lifecycle Governance GA hardening - packaged Electron durable helper proof.
//
// Runs the built runtime entry through the real Electron binary in
// ELECTRON_RUN_AS_NODE mode, which is the same entry/loader shape used by the
// packaged Electron build. Two cycles are executed:
//   1. normal exit
//   2. cancel via control.json
// Both cycles use a random sentinel secret in payload argv/env/cwd and then
// prove the durable helper file protocol never persisted any of it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(repoRoot, "openclaw_runtime", "dist", "entry.js");
const electronPath = require("electron");

function fail(message) {
  console.error(`[runtime-lifecycle-ga] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(entry)) {
  fail("openclaw_runtime/dist/entry.js is missing; run pnpm run build:runtime first");
}
if (typeof electronPath !== "string" || !fs.existsSync(electronPath)) {
  fail(`Electron binary is unavailable at ${String(electronPath)}`);
}

const STARTED_TIMEOUT_MS = 30_000;
const HELPER_TIMEOUT_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.promises.readFile(file, "utf8"));
    } catch {
      await sleep(100);
    }
  }
  return undefined;
}

function allFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(target));
    else out.push(target);
  }
  return out;
}

async function runCycle({ cancelAfterStarted }) {
  const secret = randomUUID();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rlg-ga-electron-"));
  const rootDir = path.join(tempRoot, "background-processes");
  const runId = cancelAfterStarted ? "run_ga_electron_cancel" : "run_ga_electron_normal";
  const nonce = `${runId}_nonce`;
  const runDir = path.join(rootDir, runId);
  await fs.promises.mkdir(runDir, { recursive: true, mode: 0o700 });
  const intent = {
    protocolVersion: 1,
    runId,
    nonce,
    commandDigest: "f".repeat(64),
    policyRevision: "runtime-lifecycle-phase4-host-v1",
    ownerEpoch: "epoch_ga_electron",
    createdAt: new Date().toISOString(),
  };
  await fs.promises.writeFile(path.join(runDir, "intent.json"), `${JSON.stringify(intent)}\n`);

  const childScript = cancelAfterStarted
    ? "setInterval(() => {}, 1000)"
    : "setTimeout(() => process.exit(0), 120)";
  const cwd = path.join(os.tmpdir(), secret);
  await fs.promises.mkdir(cwd, { recursive: true });
  const payload = {
    runId,
    rootDir,
    argv: [process.execPath, "-e", childScript],
    env: { ...process.env, RLG_PACKAGED_ELECTRON_SECRET: secret },
    cwd,
    timeoutMs: 15_000,
    protocolVersion: 1,
  };

  const helper = spawn(electronPath, [entry, "goal-wake-helper-run", runId], {
    cwd: path.join(repoRoot, "openclaw_runtime"),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  helper.stdout.on("data", (chunk) => { stdout += String(chunk); });
  helper.stderr.on("data", (chunk) => { stderr += String(chunk); });

  if (!helper.stdin) {
    helper.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(`${runId}: durable helper stdin is unavailable`);
  }
  const spawned = new Promise((resolve, reject) => {
    helper.once("spawn", resolve);
    helper.once("error", reject);
  });
  helper.stdin.end(`${JSON.stringify(payload)}\n`);
  try {
    await spawned;
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }

  const started = await waitForFile(path.join(runDir, "started.json"), STARTED_TIMEOUT_MS);
  if (!started) {
    helper.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(`${runId}: started.json was not written (stderr: ${stderr.slice(-1000)})`);
  }
  if (started.runNonce !== nonce || started.commandDigest !== intent.commandDigest) {
    helper.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(`${runId}: started.json does not match the intent`);
  }

  if (cancelAfterStarted) {
    await fs.promises.writeFile(
      path.join(runDir, "control.json"),
      `${JSON.stringify({ nonce, action: "cancel", reason: "ga-packaged-electron-cancel" })}\n`,
    );
  }

  const helperExit = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true, code: null, signal: null }), HELPER_TIMEOUT_MS);
    helper.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code, signal });
    });
  });
  if (helperExit.timedOut) {
    helper.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(`${runId}: helper did not exit within ${HELPER_TIMEOUT_MS}ms`);
  }

  const exit = await waitForFile(path.join(runDir, "exit.json"), 5_000);
  if (!exit) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(`${runId}: exit.json was not written`);
  }
  const controlExists = fs.existsSync(path.join(runDir, "control.json"));

  const findings = [];
  for (const file of allFiles(runDir)) {
    const text = await fs.promises.readFile(file, "utf8").catch(() => "");
    if (text.includes(secret) || text.includes("RLG_PACKAGED_ELECTRON_SECRET")) {
      findings.push(path.basename(file));
    }
  }
  const result = {
    runId,
    helperExitCode: helperExit.code,
    exit: { exitCode: exit.exitCode, timedOut: exit.timedOut, outcomeDigest: exit.outcomeDigest },
    controlExists,
    started: { helperPid: started.helperPid, childPid: started.childPid },
    heartbeatExists: fs.existsSync(path.join(runDir, "heartbeat.json")),
    rawSecretPersistenceFindings: findings.length,
    stdoutTail: stdout.slice(-500),
    stderrTail: stderr.slice(-500),
  };
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  return result;
}

try {
  const normal = await runCycle({ cancelAfterStarted: false });
  if (normal.helperExitCode !== 0 || normal.exit.exitCode !== 0 || normal.exit.timedOut) {
    throw new Error(`normal cycle failed: ${JSON.stringify(normal)}`);
  }
  if (normal.rawSecretPersistenceFindings !== 0 || !normal.heartbeatExists) {
    throw new Error(`normal cycle protocol check failed: ${JSON.stringify(normal)}`);
  }
  console.log(
    `[runtime-lifecycle-ga] packagedElectronNormalExit=PASS helperExit=${normal.helperExitCode} childExit=${normal.exit.exitCode}`,
  );

  const cancel = await runCycle({ cancelAfterStarted: true });
  if (!cancel.controlExists || !cancel.exit || cancel.exit.timedOut) {
    throw new Error(`cancel cycle failed: ${JSON.stringify(cancel)}`);
  }
  if (cancel.rawSecretPersistenceFindings !== 0) {
    throw new Error(`cancel cycle protocol check failed: ${JSON.stringify(cancel)}`);
  }
  console.log(
    `[runtime-lifecycle-ga] packagedElectronCancel=PASS helperExit=${cancel.helperExitCode} controlWritten=true childExit=${String(cancel.exit.exitCode)}`,
  );
  console.log(
    `[runtime-lifecycle-ga] packagedElectronRawSecretPersistenceFindings=${normal.rawSecretPersistenceFindings + cancel.rawSecretPersistenceFindings}`,
  );
  console.log(`[runtime-lifecycle-ga] electronBinary=${path.basename(electronPath)}`);
  console.log(`[runtime-lifecycle-ga] runtimeEntry=${path.relative(repoRoot, entry)}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
