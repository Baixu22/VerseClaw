#!/usr/bin/env node
/** Serial real-process matrix. Keeps every receipt and failure; never changes the frozen workload. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecoveryContractManifest } from "../shared/recovery-contract-eval.ts";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (key, fallback) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? fallback : process.argv[i + 1];
};
const out = resolve(arg("--out", "D:/tmp/recovery-formal-matrix"));
const arms =
  arg("--arm", "both") === "both" ? ["legacy", "candidate"] : [arg("--arm", "candidate")];
const repeats = Number(arg("--repeats", "3"));
const manifest = buildRecoveryContractManifest();
const selected = arg("--windows", "").split(",").filter(Boolean);
const windows = manifest.windows.filter((w) => !selected.length || selected.includes(w.id));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3 || !windows.length)
  throw new Error("invalid matrix selection");
mkdirSync(out, { recursive: true });
const runs = [];
if (process.argv.includes("--batch")) {
  // One serial worker reuses only test compilation. Every case still receives
  // a fresh home, user-data directory, Electron process, Gateway and workspace.
  const caseFile = join(out, "frozen-cases.json");
  const requested = arg("--cases-file", "");
  const cases = requested
    ? JSON.parse(readFileSync(resolve(requested), "utf8"))
    : arms.flatMap((arm) =>
        windows.flatMap((window) =>
          Array.from({ length: repeats }, (_, index) => ({ arm, windowId: window.id, index })),
        ),
      );
  if (
    !cases.length ||
    cases.some(
      (item) =>
        !["legacy", "candidate"].includes(item.arm) ||
        !manifest.windows.some((w) => w.id === item.windowId) ||
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index > 2,
    )
  )
    throw new Error("invalid frozen batch");
  if (new Set(cases.map((item) => JSON.stringify(item))).size !== cases.length)
    throw new Error("duplicate frozen trial");
  writeFileSync(caseFile, JSON.stringify(cases, null, 2) + "\n");
  const reportFile = join(out, "playwright.json"),
    logFile = join(out, "playwright-stderr.log");
  const reportFd = openSync(reportFile, "w"),
    logFd = openSync(logFile, "w");
  const start = Date.now();
  const child = spawn(
    process.execPath,
    [
      join(root, "node_modules/@playwright/test/cli.js"),
      "test",
      "tests/e2e/recovery-contract-eval.spec.ts",
      "--reporter=json",
      "--retries=0",
      `--output=${join(out, "test-results")}`,
    ],
    {
      cwd: root,
      windowsHide: true,
      stdio: ["ignore", reportFd, logFd],
      env: {
        ...process.env,
        TEMP: "D:/tmp",
        TMP: "D:/tmp",
        RECOVERY_MATRIX_FILE: caseFile,
        RECOVERY_OUT: out,
        CLAWX_E2E_KEEP_TEMP: "1",
        CLAWX_E2E_APP_LOGS: "1",
      },
    },
  );
  const runnerExit = await new Promise((resolveRun, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveRun({ code, signal }));
  });
  closeSync(reportFd);
  closeSync(logFd);
  let report;
  try {
    report = JSON.parse(readFileSync(reportFile, "utf8"));
  } catch {
    report = { suites: [] };
  }
  const specs = [];
  const walk = (suite) => {
    specs.push(...(suite.specs ?? []));
    for (const nested of suite.suites ?? []) walk(nested);
  };
  for (const suite of report.suites ?? []) walk(suite);
  for (const item of cases) {
    const spec = specs.find((spec) => spec.title === `${item.arm}/${item.windowId}/${item.index}`);
    const result = spec?.tests?.[0]?.results?.at(-1);
    const dir = join(out, item.arm);
    mkdirSync(dir, { recursive: true });
    const receiptFile = join(dir, `trial-${item.windowId}-${item.index}.json`);
    const receipt = existsSync(receiptFile) ? JSON.parse(readFileSync(receiptFile, "utf8")) : null;
    const log = join(dir, `${item.windowId}-${item.index}.log`);
    const render = (chunks) =>
      (chunks ?? [])
        .map((chunk) => chunk.text ?? Buffer.from(chunk.buffer ?? "", "base64").toString("utf8"))
        .join("");
    writeFileSync(
      log,
      render(result?.stdout) +
        render(result?.stderr) +
        "\n" +
        JSON.stringify({ status: result?.status, errors: result?.errors }, null, 2) +
        "\n",
    );
    runs.push({
      ...item,
      exit: runnerExit,
      testStatus: result?.status ?? "not-reported",
      elapsedMs: result?.duration ?? null,
      setupWaitMs: receipt?.setupWaitMs ?? null,
      log,
      receiptFile,
      measurement: receipt
        ? {
            lostTasks: receipt.lostTasks,
            duplicateEffects: receipt.duplicateEffects,
            terminalCorrect: receipt.terminalCorrect,
            recoveryLatencyMs: receipt.recoveryLatencyMs,
          }
        : null,
      receiptSha256: receipt
        ? createHash("sha256").update(readFileSync(receiptFile)).digest("hex")
        : null,
    });
  }
  writeFileSync(
    join(out, "matrix-run.json"),
    JSON.stringify(
      {
        schema: "RecoveryMatrixRun/v3",
        mode: "serial-worker-batch",
        runnerExit,
        totalDurationMs: Date.now() - start,
        driven_by: "agent",
        actor: "recovery-matrix-runner",
        realHumanEvidence: false,
        manifestHash: manifest.manifestHash,
        runs,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      runnerExit,
      trials: runs.length,
      receipts: runs.filter((run) => run.measurement).length,
      testStatuses: runs.map((run) => run.testStatus),
    }),
  );
  process.exit(
    runnerExit.code === 0 && runs.every((run) => run.testStatus === "passed" && run.measurement)
      ? 0
      : 1,
  );
}
for (const arm of arms)
  for (const window of windows)
    for (let index = 0; index < repeats; index++) {
      // Do not compete with another local acceptance run's large export/build.
      let waited = 0;
      while (freemem() < 1500 * 1024 * 1024 && waited < 300_000) {
        console.log(`[matrix] waiting for memory (${Math.round(freemem() / 1024 / 1024)} MB)`);
        await new Promise((r) => setTimeout(r, 15_000));
        waited += 15_000;
      }
      const dir = join(out, arm);
      mkdirSync(dir, { recursive: true });
      const log = join(dir, `${window.id}-${index}.log`);
      const fd = openSync(log, "w");
      const start = Date.now();
      console.log(`[matrix] ${arm} ${window.id} ${index + 1}/${repeats}`);
      const child = spawn(
        process.execPath,
        [
          join(root, "node_modules/@playwright/test/cli.js"),
          "test",
          "tests/e2e/recovery-contract-eval.spec.ts",
          "--reporter=list",
          "--retries=0",
          `--output=${join(dir, `test-results-${window.id}-${index}`)}`,
        ],
        {
          cwd: root,
          windowsHide: true,
          stdio: ["ignore", fd, fd],
          env: {
            ...process.env,
            TEMP: "D:/tmp",
            TMP: "D:/tmp",
            RECOVERY_WINDOW: window.id,
            RECOVERY_TRIAL_INDEX: String(index),
            RECOVERY_ARM: arm,
            RECOVERY_OUT: dir,
            CLAWX_E2E_KEEP_TEMP: "1",
            CLAWX_E2E_APP_LOGS: "1",
          },
        },
      );
      const exit = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      closeSync(fd);
      const receiptFile = join(dir, `trial-${window.id}-${index}.json`);
      const receipt = existsSync(receiptFile)
        ? JSON.parse(readFileSync(receiptFile, "utf8"))
        : null;
      const run = {
        arm,
        windowId: window.id,
        index,
        exit,
        elapsedMs: Date.now() - start,
        setupWaitMs: waited,
        log,
        receiptFile,
        measurement: receipt
          ? {
              lostTasks: receipt.lostTasks,
              duplicateEffects: receipt.duplicateEffects,
              terminalCorrect: receipt.terminalCorrect,
              recoveryLatencyMs: receipt.recoveryLatencyMs,
            }
          : null,
        receiptSha256: receipt
          ? createHash("sha256").update(readFileSync(receiptFile)).digest("hex")
          : null,
      };
      runs.push(run);
      console.log(JSON.stringify(run));
      writeFileSync(
        join(out, "matrix-run.json"),
        JSON.stringify(
          {
            schema: "RecoveryMatrixRun/v2",
            driven_by: "agent",
            actor: "recovery-matrix-runner",
            realHumanEvidence: false,
            manifestHash: manifest.manifestHash,
            runs,
          },
          null,
          2,
        ) + "\n",
      );
    }
process.exitCode = runs.every((r) => r.exit.code === 0 && r.measurement) ? 0 : 1;
