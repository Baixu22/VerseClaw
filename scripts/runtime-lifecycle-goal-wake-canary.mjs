#!/usr/bin/env node
// Runtime Lifecycle Governance GA hardening - real-process goal-wake canary.
//
// Repeats the existing real OS process trace fixture
// (openclaw_runtime/scripts/goal-wake-e2e-trace.ts) for N cycles. Each cycle
// spawns a real supervisor child, runs the flag-off parity checks, arms the
// goal-wake path, finalizes the process, dispatches the wake, and asserts the
// duplicate-wake contract. This is engineering canary evidence only; it is not
// human/live canary evidence and does not change any default.
import { spawnSync } from "node:child_process";

const CYCLES = Number.parseInt(process.env.RLG_GA_CANARY_CYCLES ?? "10", 10);
if (!Number.isInteger(CYCLES) || CYCLES < 1) {
  console.error("[runtime-lifecycle-ga] RLG_GA_CANARY_CYCLES must be a positive integer");
  process.exit(1);
}

const readAudit = (stdout, name) => {
  const match = stdout.match(new RegExp(`\\[runtime-lifecycle-audit\\] ${name}=(\\d+|true|false)`));
  return match ? match[1] : null;
};

const failures = [];
let pollCalls = 0;
let duplicateTicks = 0;
for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
  const started = Date.now();
  const run = spawnSync(
    "pnpm",
    ["--dir", "openclaw_runtime", "exec", "tsx", "scripts/goal-wake-e2e-trace.ts"],
    {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: "utf8",
      windowsHide: true,
      timeout: 180_000,
      shell: process.platform === "win32",
    },
  );
  const stdout = String(run.stdout ?? "");
  const stderr = String(run.stderr ?? "");
  const poll = readAudit(stdout, "processPollToolCalls");
  const dupTicks = readAudit(stdout, "duplicateWakeTickCount");
  const flagOffBlocked = readAudit(stdout, "flagOffGoalWaitBlocked");
  const backgroundUnchanged = readAudit(stdout, "flagOffBackgroundDefaultUnchanged");
  const ok =
    run.status === 0 &&
    poll === "0" &&
    dupTicks === "1" &&
    flagOffBlocked === "true" &&
    backgroundUnchanged === "true";
  if (!ok) {
    failures.push({
      cycle,
      status: run.status,
      poll,
      dupTicks,
      flagOffBlocked,
      backgroundUnchanged,
      stderrTail: stderr.slice(-800),
      stdoutTail: stdout.slice(-800),
    });
  } else {
    pollCalls += Number(poll);
    duplicateTicks += Number(dupTicks);
  }
  console.log(
    `[runtime-lifecycle-ga] canaryCycle=${cycle} pass=${ok} durationMs=${Date.now() - started} ` +
      `processPollToolCalls=${poll} duplicateWakeTickCount=${dupTicks} ` +
      `flagOffGoalWaitBlocked=${flagOffBlocked} flagOffBackgroundDefaultUnchanged=${backgroundUnchanged}`,
  );
}

if (failures.length > 0) {
  console.error(`[runtime-lifecycle-ga] canaryFailures=${failures.length}`);
  for (const failure of failures) {
    console.error(JSON.stringify(failure));
  }
  process.exit(1);
}
console.log(`[runtime-lifecycle-ga] goalWakeCanaryCycles=${CYCLES} pass=true`);
console.log(`[runtime-lifecycle-ga] goalWakeCanaryProcessPollToolCalls=${pollCalls}`);
console.log(`[runtime-lifecycle-ga] goalWakeCanaryDuplicateWakeTickCount=${duplicateTicks}`);
