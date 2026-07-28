/**
 * DCS ops canary preflight (TF-0009).
 * Runs hard-veto checks + optional gate suite. Never flips defaults.
 *
 *   node scripts/dcs-ops-preflight.mjs
 *   node scripts/dcs-ops-preflight.mjs --gates
 *   pnpm run dcs:ops:preflight
 *   pnpm run dcs:ops:preflight:gates
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runGates = process.argv.includes("--gates");
const outDir = path.join(root, "artifacts/dcs-deep-test-week1");
const findings = [];
let hardStop = false;

function fail(msg, nextStep) {
  findings.push({ level: "fail", msg, nextStep });
  hardStop = true;
}
function warn(msg, nextStep) {
  findings.push({ level: "warn", msg, nextStep });
}
function ok(msg) {
  findings.push({ level: "ok", msg });
}

function readJson(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return { missing: true, path: rel };
  try {
    return { path: rel, data: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (e) {
    return { path: rel, error: String(e) };
  }
}

// --- Hard veto from packaging report ---
const report = readJson("artifacts/coding-prod-p0/report.json");
if (report.missing) {
  fail(
    "missing artifacts/coding-prod-p0/report.json",
    "Run: pnpm run dcs:prod-p0:smoke  (writes packaging report)",
  );
} else if (report.error) {
  fail(`report.json parse error: ${report.error}`, "Re-run pnpm run dcs:prod-p0");
} else {
  const d = report.data;
  if (d.defaultsUnchanged !== true) {
    fail("defaultsUnchanged !== true", "HARD-STOP: restore defaults; do not continue canary");
  } else ok("defaultsUnchanged=true");
  if (d.readyForDefaultFlagGraduation === true) {
    fail("readyForDefaultFlagGraduation=true", "HARD-STOP: revoke graduation claim; re-run packaging");
  } else ok("readyForDefaultFlagGraduation=false");
  if (d.productionMode && d.productionMode !== "opt-in") {
    warn(`productionMode=${d.productionMode}`, "Confirm packaging still opt-in only");
  } else ok(`productionMode=${d.productionMode || "opt-in"}`);
  const rl = d.redLines || {};
  const expectTrue = [
    "viewToolsDefaultOff",
    "staleWriteGuardDefaultFalse",
    "isolationDefaultShared",
    "worktreeBackendInprocess",
    "symbolLeaseDefaultFalse",
    "patchFlowDefaultFalse",
    "routingMemoShadowDefaultFalse",
    "sekbExperienceShadowDefaultFalse",
  ];
  for (const k of expectTrue) {
    if (rl[k] !== true) {
      fail(`redLines.${k} !== true (got ${rl[k]})`, "HARD-STOP: inspect packaging redLines; fix defaults");
    }
  }
  if (!hardStop) ok("packaging redLines all safe");
}

// --- Canary decision honesty ---
const canary = readJson("artifacts/dcs-canary/c1/decision.json");
if (canary.missing) {
  warn("missing C1 canary decision", "Run: pnpm run dcs:canary:c1");
} else if (canary.error) {
  fail(`canary decision parse error: ${canary.error}`, "Re-run pnpm run dcs:canary:c1");
} else {
  const c = canary.data;
  if (c.recommendation === "default-on") {
    fail("canary recommendation=default-on", "HARD-STOP: refuse; C1 must keep-off without product approval");
  } else ok(`canary recommendation=${c.recommendation}`);
  if (c.liveReady === true) {
    fail("canary liveReady=true", "HARD-STOP: synthetic canary cannot be liveReady");
  } else ok("canary liveReady=false");
  if (c.productApproved === true) {
    fail("canary productApproved=true", "HARD-STOP: product approval must be external evidence, not canary script");
  } else ok("canary productApproved=false");
  if (c.defaultsUnchanged === false) {
    fail("canary defaultsUnchanged=false", "HARD-STOP: defaults drifted");
  } else if (c.defaultsUnchanged === true) ok("canary defaultsUnchanged=true");
  if (c.metrics?.live === true) {
    warn("canary metrics.live=true", "Verify this is not synthetic corpus mislabeled");
  }
}

// --- TF-0006 still blocked ---
const tf6 = readJson("artifacts/tf0006-evidence-upgrade/status.json");
if (!tf6.missing && !tf6.error) {
  if (tf6.data.status !== "blocked") {
    fail(`TF-0006 status=${tf6.data.status} (expected blocked)`, "Do not graduate without four evidence files");
  } else ok("TF-0006 remains blocked");
  const g = tf6.data.gates || {};
  for (const k of ["liveReady", "productApproved", "readyForDefaultFlagGraduation"]) {
    if (g[k] === true) fail(`TF-0006.gates.${k}=true`, "HARD-STOP: clear illegal graduation flags");
  }
}

// --- Profiles hard bounds ---
const profiles = readJson("artifacts/dcs-deep-test-week1/profiles.json");
if (profiles.missing) {
  warn("profiles.json missing", "Fill artifacts/dcs-deep-test-week1/profiles.json before L3");
} else if (!profiles.error) {
  const hb = profiles.data.hardBounds || {};
  if (hb.liveReady === true || hb.productApproved === true || hb.defaultsUnchanged === false) {
    fail("profiles.hardBounds illegal", "Restore hardBounds to fail-closed values");
  } else ok("profiles.hardBounds fail-closed");
  const ids = (profiles.data.profiles || []).map((p) => p.id);
  for (const need of ["dcs-coding", "sekb-assisted", "browser-supervised"]) {
    if (!ids.includes(need)) fail(`profile missing: ${need}`, "Complete profiles.json three-profile table");
    else {
      const p = profiles.data.profiles.find((x) => x.id === need);
      const hasOwner = p.owner || profiles.data.roles?.owner;
      const hasKill = p.kill || p.kill;
      const hasBudget = p.budget || p.budgetTasks != null;
      const hasPrivacy = p.privacy != null;
      const hasMetrics = Array.isArray(p.metrics) ? p.metrics.length > 0 : false;
      if (!hasOwner || !hasKill || !hasBudget || !hasPrivacy || !hasMetrics) {
        warn(`profile ${need} incomplete fields`, "Ensure owner/budget/privacy/metrics/kill/rollback/stop present");
      }
    }
  }
}

// --- Ops pack presence ---
for (const rel of [
  "docs/dev/dcs-ops-canary-runbook.md",
  "artifacts/dcs-deep-test-week1/day1-gates.json",
  "artifacts/dcs-deep-test-week1/decision.md",
]) {
  if (fs.existsSync(path.join(root, rel))) ok(`present: ${rel}`);
  else warn(`missing: ${rel}`, "Complete overnight ops pack artifacts");
}

// --- Optional gate suite ---
const gateResults = [];
if (runGates && !hardStop) {
  const gates = [
    ["dcs:prod-p0:smoke", ["run", "dcs:prod-p0:smoke"]],
    ["dcs:canary:c1", ["run", "dcs:canary:c1"]],
  ];
  for (const [name, args] of gates) {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const r = spawnSync(pnpm, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    const code = r.status ?? 1;
    gateResults.push({ name, exitCode: code, ok: code === 0 });
    if (code !== 0) {
      fail(`gate ${name} exit=${code}`, `Re-run: pnpm ${args.join(" ")} and fix first error in output`);
    } else ok(`gate ${name} pass`);
  }
}

const summary = {
  schema: "dcs-ops-preflight/v1",
  generatedAt: new Date().toISOString(),
  ok: !hardStop && findings.every((f) => f.level !== "fail"),
  hardStop,
  runGates,
  gateResults,
  findings,
  nextStep: hardStop
    ? findings.find((f) => f.level === "fail")?.nextStep || "Fix hard-stop findings before any opt-in"
    : runGates
      ? "Preflight+gates green. Proceed to L2 E2E or first L3 opt-in per docs/dev/dcs-ops-canary-runbook.md"
      : "Hard-veto checks green. For full gate run: pnpm run dcs:ops:preflight:gates",
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "preflight-last.json"), JSON.stringify(summary, null, 2) + "\n");

console.log("\n=== DCS ops preflight ===");
for (const f of findings) {
  const tag = f.level === "ok" ? "OK  " : f.level === "warn" ? "WARN" : "FAIL";
  console.log(`[${tag}] ${f.msg}`);
  if (f.nextStep) console.log(`       next: ${f.nextStep}`);
}
console.log(`\nresult: ${summary.ok ? "PASS" : "FAIL"} hardStop=${hardStop}`);
console.log(`nextStep: ${summary.nextStep}`);
console.log(`wrote: artifacts/dcs-deep-test-week1/preflight-last.json`);

if (!summary.ok) process.exit(1);
