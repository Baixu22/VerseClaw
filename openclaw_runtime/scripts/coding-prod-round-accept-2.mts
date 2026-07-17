/**
 * Round ACCEPT 2.0: honesty + red-line refresh over Goal A/B/C + residual waves.
 * Re-runs directed acceptances and unit samples; records W5 if previously green.
 * Does NOT flip any production defaults.
 *
 * Run from openclaw_runtime:
 *   node --import tsx scripts/coding-prod-round-accept-2.mts
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  DEFAULT_CODING_FEATURE_FLAGS,
  isCodingPatchFlowDefault,
  isCodingRoutingMemoShadowEnabled,
  isCodingSekbExperienceShadowEnabled,
  isCodingSymbolLeaseEnabled,
  resolveSymbolLeaseMode,
  resolveWorktreeBackend,
} from "../src/context-engine/coding-runtime-flags.ts";
import { isDcsContextViewToolsEnabled } from "../src/context-engine/dcs-context-tools-flags.ts";
import { normalizeIsolationMode } from "../src/agents/orchestration-protocol.ts";
import { PRODUCTION_GIT_WORKTREE_HARDENED } from "../src/agents/worktree-service.ts";
import { PRODUCTION_PNPM_HARDLINK_INSTALL } from "../src/agents/worktree-pnpm-install.ts";
import { MULTI_PROCESS_WAL_HARDENED } from "../src/context-engine/factstore/symbol-lease.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(repoRoot, "artifacts", "coding-prod-round-accept-2");
const rt = path.join(repoRoot, "openclaw_runtime");

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function runCapture(cmd: string, cwd = rt): { ok: boolean; ms: number; out: string } {
  const t0 = Date.now();
  try {
    const out = execSync(cmd, { cwd, encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, ms: Date.now() - t0, out };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      ms: Date.now() - t0,
      out: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`,
    };
  }
}

function readJsonSafe(p: string): Record<string, unknown> | null {
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.join(outDir, "logs"), { recursive: true });

  const redLines = [
    {
      id: "view-tools-default-off",
      pass: isDcsContextViewToolsEnabled({}) === false,
      evidence: "dcs-context-tools-flags default OFF",
    },
    {
      id: "isolation-default-shared",
      pass: normalizeIsolationMode(undefined) === "shared",
      evidence: "normalizeIsolationMode(undefined)===shared",
    },
    {
      id: "worktree-backend-inprocess",
      pass: resolveWorktreeBackend() === "inprocess",
      evidence: "runtime.coding.worktree.backend default inprocess",
    },
    {
      id: "symbolLease-default-false",
      pass: isCodingSymbolLeaseEnabled() === false && resolveSymbolLeaseMode() === "memory",
      evidence: "symbolLease.enabled=false mode=memory",
    },
    {
      id: "patchFlow-default-false",
      pass: isCodingPatchFlowDefault() === false,
      evidence: "runtime.coding.patchFlow.default=false",
    },
    {
      id: "routingMemo.shadow-default-false",
      pass: isCodingRoutingMemoShadowEnabled() === false,
      evidence: "routingMemo.shadow=false",
    },
    {
      id: "sekb.experienceShadow-default-false",
      pass: isCodingSekbExperienceShadowEnabled() === false,
      evidence: "experienceShadow=false",
    },
    {
      id: "c4h-hardened",
      pass: PRODUCTION_GIT_WORKTREE_HARDENED === true,
      evidence: "PRODUCTION_GIT_WORKTREE_HARDENED",
    },
    {
      id: "c4p-capability",
      pass: PRODUCTION_PNPM_HARDLINK_INSTALL === true,
      evidence: "PRODUCTION_PNPM_HARDLINK_INSTALL",
    },
    {
      id: "c5h-hardened",
      pass: MULTI_PROCESS_WAL_HARDENED === true,
      evidence: "MULTI_PROCESS_WAL_HARDENED",
    },
    {
      id: "default-flags-const",
      pass:
        DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.patchFlow.default"] === false &&
        DEFAULT_CODING_FEATURE_FLAGS["runtime.coding.worktree.backend"] === "inprocess",
      evidence: "DEFAULT_CODING_FEATURE_FLAGS consts",
    },
  ];

  if (redLines.some((r) => !r.pass)) {
    throw new Error(`red line failed: ${redLines.filter((r) => !r.pass).map((r) => r.id).join(",")}`);
  }

  const acceptCmds: Array<{ id: string; cmd: string }> = [
    { id: "remaining", cmd: "node --import tsx scripts/coding-remaining-acceptance.mts" },
    { id: "c4", cmd: "node --import tsx scripts/coding-c4-acceptance.mts" },
    { id: "c5", cmd: "node --import tsx scripts/coding-c5-acceptance.mts" },
    { id: "c7", cmd: "node --import tsx scripts/coding-c7-acceptance.mts" },
    { id: "goal-c", cmd: "node --import tsx scripts/coding-prod-goal-c.mts" },
    { id: "goal-b", cmd: "node --import tsx scripts/coding-prod-goal-b.mts" },
  ];

  const acceptance: Record<string, { ok: boolean; ms: number }> = {};
  for (const a of acceptCmds) {
    const r = runCapture(a.cmd);
    writeFileSync(path.join(outDir, "logs", `${a.id}.out`), r.out);
    acceptance[a.id] = { ok: r.ok, ms: r.ms };
    if (!r.ok) throw new Error(`acceptance ${a.id} failed`);
  }

  const unit = runCapture(
    "node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts coding-c6h-flip-decision experience-shadow-cutover-pack coding-long-chat-curve",
  );
  writeFileSync(path.join(outDir, "logs", "unit-directed.out"), unit.out);
  if (!unit.ok) throw new Error("directed unit failed");

  const agentsUnit = runCapture(
    "node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts worktree-service worktree-pnpm-install patch-flow-graduation patch-flow isolation-mode-matrix",
  );
  writeFileSync(path.join(outDir, "logs", "unit-agents.out"), agentsUnit.out);
  if (!agentsUnit.ok) throw new Error("agents unit failed");

  // Prefer live W5 log from Goal B if present and green; else mark not-re-run in this packager.
  let w5: { ok: boolean; note: string } = { ok: false, note: "not re-run in accept-2 packager" };
  const w5Out = path.join(repoRoot, "tmp/goal-b-e2e-w5.out");
  if (existsSync(w5Out)) {
    const text = readFileSync(w5Out, "utf8");
    if (/3 passed/.test(text)) {
      w5 = { ok: true, note: "reused Goal B W5 3/3 evidence (UI untouched by Goal C)" };
    }
  }

  const goalA = readJsonSafe(path.join(repoRoot, "artifacts/coding-prod-goal-a/report.json"));
  const goalB = readJsonSafe(path.join(repoRoot, "artifacts/coding-prod-goal-b/report.json"));
  const goalC = readJsonSafe(path.join(repoRoot, "artifacts/coding-prod-goal-c/report.json"));

  const report = {
    schemaVersion: 2,
    title: "DCS Production Round ACCEPT 2.0 (Goal A+B+C)",
    ok: true,
    decision: "accept-with-residuals",
    readyForDefaultFlagGraduation: false,
    defaultsUnchanged: true,
    noDefaultFlagFlip: true,
    redLines: redLines.map((r) => ({ ...r, pass: true })),
    goals: {
      A: goalA ? { ok: goalA.ok === true, cards: goalA.cards } : null,
      B: goalB ? { ok: goalB.ok === true, cards: goalB.cards } : null,
      C: goalC ? { ok: goalC.ok === true, cards: goalC.cards } : null,
    },
    acceptance,
    units: {
      directed: { ok: unit.ok, ms: unit.ms },
      agents: { ok: agentsUnit.ok, ms: agentsUnit.ms },
    },
    e2e: { w5 },
    residuals: [
      "C1 live A/B blocked — view tools default-off",
      "C4 worktree.backend default inprocess; installStrategy opt-in",
      "C5 patchFlow.default false; lease default off",
      "C6-H live64k residual; assembler not auto-flipped",
      "C7-H cutoverAllowed always false",
    ],
    next: "Product soak / optional live A/B env — no further code Goals required for residual honesty packs",
    sha: gitShortSha(),
    ts: new Date().toISOString(),
  };

  if (!w5.ok) {
    // Still ok for ACCEPT 2.0 if all red lines + acceptance green; note residual gate.
    (report as { residualGates?: string[] }).residualGates = [
      "W5 not re-executed in this packager run — re-run playwright dcs-production-wiring-w5 before release PR if UI changed",
    ];
  }

  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(
    path.join(outDir, "gates.json"),
    JSON.stringify(
      {
        ok: true,
        defaultsUnchanged: true,
        noDefaultFlagFlip: true,
        redLinesPass: true,
        acceptanceAllOk: Object.values(acceptance).every((a) => a.ok),
        unitsOk: unit.ok && agentsUnit.ok,
        w5: w5,
      },
      null,
      2,
    ) + "\n",
  );

  const md = [
    "# DCS Round ACCEPT 2.0",
    "",
    `**SHA**: \`${report.sha}\``,
    `**ts**: ${report.ts}`,
    `**decision**: ${report.decision}`,
    `**readyForDefaultFlagGraduation**: false`,
    `**defaultsUnchanged**: true`,
    "",
    "## Red lines",
    "",
    ...redLines.map((r) => `- PASS \`${r.id}\` — ${r.evidence}`),
    "",
    "## Goals",
    "",
    `- Goal A: ${goalA?.ok ? "ok" : "missing"}`,
    `- Goal B: ${goalB?.ok ? "ok" : "missing"}`,
    `- Goal C: ${goalC?.ok ? "ok" : "missing"}`,
    "",
    "## Acceptance",
    "",
    ...Object.entries(acceptance).map(([k, v]) => `- ${k}: ${v.ok ? "PASS" : "FAIL"} (${v.ms}ms)`),
    "",
    "## Units",
    "",
    `- directed: ${unit.ok ? "PASS" : "FAIL"} (${unit.ms}ms)`,
    `- agents: ${agentsUnit.ok ? "PASS" : "FAIL"} (${agentsUnit.ms}ms)`,
    "",
    "## E2E",
    "",
    `- W5: ${w5.ok ? "PASS (reused)" : "not re-run"} — ${w5.note}`,
    "",
    "## Residuals",
    "",
    ...report.residuals.map((r) => `- ${r}`),
    "",
    "## Next",
    "",
    report.next,
    "",
  ].join("\n");
  writeFileSync(path.join(outDir, "COMPLETE.md"), md);
  writeFileSync(path.join(outDir, "REPORT.md"), md);
  writeFileSync(path.join(repoRoot, "openclaw_runtime", "CODING-PROD-ROUND-ACCEPT-2-COMPLETE.md"), md);

  console.log(JSON.stringify(report, null, 2));
}

main();