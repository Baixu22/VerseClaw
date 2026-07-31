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

import {
  evaluateTf0009L3Readiness,
  hasSafeTf0009HardBounds,
} from "./lib/tf0009-canary-readiness.mjs";
import {
  validateTf0009AgentSurrogateCharter,
  validateTf0009AgentSurrogateReport,
} from "./lib/tf0009-agent-surrogate.mjs";

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

// --- Unified C1 corpus authority ---
const c1Authority = readJson("artifacts/first-product-preview/FP-P4-05/decision.json");
if (c1Authority.missing) {
  fail("missing authoritative C1 gate decision", "Run: pnpm run dcs:c1:gate:refresh");
} else if (c1Authority.error) {
  fail(
    "authoritative C1 decision parse error: " + c1Authority.error,
    "Re-run pnpm run dcs:c1:gate:refresh",
  );
} else {
  const c = c1Authority.data;
  if (c.authority?.role !== "gate-authority") {
    fail("C1 authority role drifted", "HARD-STOP: restore the real-tool corpus authority");
  } else ok("C1 gate authority=" + c.authority.corpusId);
  if (c.authority?.reductionFactor !== 4.5 || c.decision?.meetsGate !== false) {
    fail("C1 authoritative 4.5x below-threshold result drifted", "HARD-STOP: run C1 gate validation");
  } else ok("C1 authoritative reduction=4.5x; meetsGate=false");
  if (c.references?.some((reference) => reference.eligibleForGateAuthority !== false)) {
    fail("C1 reference corpus gained gate authority", "HARD-STOP: synthetic evidence is reference-only");
  }
  if (
    c.decision?.recommendation !== "keep-off" ||
    c.decision?.defaultOn !== false ||
    c.decision?.liveReady !== false ||
    c.decision?.productApproved !== false
  ) {
    fail("C1 product locks drifted", "HARD-STOP: restore keep-off and false product locks");
  } else ok("C1 unified decision keeps product locks closed");
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

// --- L3 governance readiness ---
const profiles = readJson("artifacts/dcs-deep-test-week1/profiles.json");
if (profiles.error) {
  fail(`profiles.json parse error: ${profiles.error}`, "Fix profiles.json before any L3 task");
} else if (!profiles.missing) {
  if (!hasSafeTf0009HardBounds(profiles.data)) {
    fail("profiles.hardBounds incomplete or illegal", "Restore all fail-closed TF-0009 hard bounds");
  } else ok("profiles.hardBounds fail-closed");
}

const runbookRel = "docs/dev/dcs-ops-canary-runbook.md";
const day1GatesRel = "artifacts/dcs-deep-test-week1/day1-gates.json";
const decisionRel = "artifacts/dcs-deep-test-week1/decision.md";
const runbookPresent = fs.existsSync(path.join(root, runbookRel));
const day1Gates = readJson(day1GatesRel);
const day1GatesPresent = !day1Gates.missing;
if (day1Gates.error) {
  fail(`day1-gates.json parse error: ${day1Gates.error}`, "Regenerate the Day-1 gate record before L3");
}
const decisionPresent = fs.existsSync(path.join(root, decisionRel));
for (const [rel, present] of [
  [runbookRel, runbookPresent],
  [day1GatesRel, day1GatesPresent],
  [decisionRel, decisionPresent],
]) {
  if (present) ok(`present: ${rel}`);
  else warn(`missing: ${rel}`, rel === decisionRel ? "Required at canary close-out" : "Required before L3");
}

const l3Readiness = evaluateTf0009L3Readiness({
  profiles: profiles.data,
  profilesMissing: profiles.missing,
  runbookPresent,
  day1GatesPresent,
  day1Gates: day1Gates.data,
});
for (const blocker of l3Readiness.blockers) {
  warn(`L3 blocked [${blocker.id}]: ${blocker.message}`, blocker.nextStep);
}

// --- Agent-surrogate engineering track (never human/live evidence) ---
const agentCharter = readJson("artifacts/first-product-preview/TF-0009/agent-surrogate-charter.json");
const agentReport = readJson("artifacts/first-product-preview/TF-0009/agent-surrogate-report.json");
let agentSurrogateReady = false;
let agentSurrogateValidation = { ok: false, errors: ["agent surrogate evidence missing"] };
if (agentCharter.error) {
  fail(`agent-surrogate charter parse error: ${agentCharter.error}`, "Fix the tracked TF-0009 agent charter");
} else if (agentReport.error) {
  fail(`agent-surrogate report parse error: ${agentReport.error}`, "Re-run: pnpm run tf0009:agent-surrogate");
} else if (agentCharter.missing || agentReport.missing) {
  warn(
    "agent-surrogate campaign evidence is missing",
    "Run: pnpm run tf0009:agent-surrogate (engineering evidence only)",
  );
} else {
  const charterValidation = validateTf0009AgentSurrogateCharter(agentCharter.data);
  const reportValidation = validateTf0009AgentSurrogateReport(agentReport.data);
  agentSurrogateValidation = {
    ok: charterValidation.ok && reportValidation.ok,
    errors: [...charterValidation.errors, ...reportValidation.errors],
  };
  if (!agentSurrogateValidation.ok) {
    fail(
      `agent-surrogate evidence invalid: ${agentSurrogateValidation.errors.join("; ")}`,
      "Re-run the campaign and keep every human/live/product claim false",
    );
  } else {
    agentSurrogateReady = true;
    ok("agent-surrogate engineering campaign complete: 10/10/10; human runs remain 0/10");
    ok("agent-surrogate status=degraded-engineering-complete; report cannot self-authorize done or TF-0011 release");
  }
}

// --- Optional gate suite ---
const gateResults = [];
if (runGates && !hardStop) {
  const gates = [
    ["dcs:prod-p0:smoke", ["run", "dcs:prod-p0:smoke"]],
    ["dcs:c1:gate:refresh", ["run", "dcs:c1:gate:refresh"]],
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
  l3Ready: !hardStop && l3Readiness.ready,
  l3Blockers: l3Readiness.blockers,
  agentSurrogateReady: !hardStop && agentSurrogateReady,
  agentSurrogateValidation,
  humanEquivalent: false,
  runGates,
  gateResults,
  findings,
  nextStep: hardStop
    ? findings.find((f) => f.level === "fail")?.nextStep || "Fix hard-stop findings before any opt-in"
    : agentSurrogateReady && !l3Readiness.ready
      ? "Agent-surrogate engineering flow is complete. Keep TF-0009 review_needed; any engineering-chain release requires a separate confirmed governance proposal."
    : !l3Readiness.ready
      ? "L2 automation may continue, but do not start L3. Resolve every l3Blocker first."
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
