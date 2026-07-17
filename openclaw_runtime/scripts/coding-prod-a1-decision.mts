/**
 * Goal A / A1: C1 graduation decision package (honest).
 * Sim fixtures may meet reduction gate; live A/B remains blocked => meetsGate false for default flip.
 * Does NOT flip any production defaults.
 *
 * Run: node --import tsx scripts/coding-prod-a1-decision.mts
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  CODING_AB_FIXTURES,
  evaluateAbGate,
  simulateAbArm,
} from "../src/context-engine/coding-ab-fixtures.ts";
import { isDcsContextViewToolsEnabled } from "../src/context-engine/dcs-context-tools-flags.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outDir = path.join(repoRoot, "artifacts", "coding-prod-a1");

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function main(): void {
  mkdirSync(outDir, { recursive: true });

  const abResults = CODING_AB_FIXTURES.flatMap((f) => [
    simulateAbArm(f, "baseline"),
    simulateAbArm(f, "factstore"),
    simulateAbArm(f, "mcp_control"),
  ]);
  const sim = evaluateAbGate(abResults);

  // Optional historic packaging metrics (may be older 4-arm set).
  let packagingMetrics: Record<string, unknown> | null = null;
  const packagingPath = path.join(repoRoot, "artifacts", "coding-c1", "ab-metrics.json");
  if (existsSync(packagingPath)) {
    try {
      packagingMetrics = JSON.parse(readFileSync(packagingPath, "utf8")) as Record<string, unknown>;
    } catch {
      packagingMetrics = null;
    }
  }

  const liveReady = false;
  const liveBlockedReason =
    "Live A/B corpus + comms:replay binding + owner scorecard window missing (see reports/CODING-C1-LIVE-AB.md)";

  // Graduation gate for default flip requires sim AND live.
  const meetsGate = sim.meetsGate && liveReady;
  const recommendation = meetsGate ? "default-on" : "keep-off";
  const completionClass = liveReady ? "done (loop)" : "done (sim)";

  const viewToolsDefaultOff = isDcsContextViewToolsEnabled({}) === false;

  const decision = {
    ok: true,
    card: "A1",
    wave: "C1",
    completionClass,
    meetsGate,
    recommendation,
    defaultsUnchanged: true,
    viewToolsDefaultOff,
    sim: {
      fixtureCount: sim.fixtureCount,
      reductionFactor: Number(sim.reductionFactor.toFixed(3)),
      meetsSimGate: sim.meetsGate,
      baselineAvgCalls: sim.baselineAvgCalls,
      factstoreAvgCalls: sim.factstoreAvgCalls,
      factstorePassRate: sim.factstorePassRate,
      routingAccuracy: sim.routingAccuracy,
      reason: sim.reason,
    },
    packagingMetricsSummary: packagingMetrics
      ? {
          avgReduction: packagingMetrics.avgReduction,
          meetsGate: packagingMetrics.meetsGate,
          judgment: packagingMetrics.judgment,
        }
      : null,
    live: {
      ready: liveReady,
      blockedReason: liveBlockedReason,
    },
    decisionRationale: meetsGate
      ? "Sim and live gates both green; product may consider default-on with kill switch."
      : "Keep view tools / tool-registry / working-memory default-off. Sim-only evidence is not enough for production default flip.",
    howToEnableOptIn:
      "Set OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1 (or OPENCLAW_DCS_CONTEXT_TOOLS=1) and restart gateway/runtime.",
    sha: gitShortSha(),
    ts: new Date().toISOString(),
  };

  writeFileSync(path.join(outDir, "decision.json"), JSON.stringify(decision, null, 2) + "\n", "utf8");
  writeFileSync(
    path.join(outDir, "acceptance.json"),
    JSON.stringify(
      {
        ok: true,
        card: "A1",
        completionClass,
        meetsGate,
        recommendation,
        defaultsUnchanged: true,
        decisionPackageComplete: true,
        ts: decision.ts,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  writeFileSync(
    path.join(outDir, "gates.json"),
    JSON.stringify(
      {
        ok: true,
        honesty: {
          completionClass,
          meetsGate,
          recommendation,
          liveReady,
          defaultsUnchanged: true,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  writeFileSync(
    path.join(outDir, "COMPLETE.md"),
    [
      "# Goal A / A1 COMPLETE — C1 graduation decision",
      "",
      `**SHA**: \`${decision.sha}\``,
      `**completionClass**: \`${completionClass}\``,
      `**meetsGate**: ${meetsGate}`,
      `**recommendation**: \`${recommendation}\``,
      `**defaultsUnchanged**: true`,
      "",
      "## Evidence",
      "",
      `- Sim fixtures: ${sim.fixtureCount}, reduction ${sim.reductionFactor.toFixed(3)}x, simGate=${sim.meetsGate}`,
      `- Live A/B: blocked (${liveBlockedReason})`,
      `- View tools default: OFF`,
      "",
      "## Decision",
      "",
      decision.decisionRationale,
      "",
      "## Artifacts",
      "",
      "- `artifacts/coding-prod-a1/decision.json`",
      "- `artifacts/coding-prod-a1/acceptance.json`",
      "- `artifacts/coding-prod-a1/gates.json`",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(JSON.stringify(decision, null, 2));
  if (!viewToolsDefaultOff) {
    process.exitCode = 1;
    throw new Error("red-line: view tools must remain default off");
  }
}

main();