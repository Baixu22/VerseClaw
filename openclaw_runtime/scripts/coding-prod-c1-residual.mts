/**
 * Goal C / C1 residual: live A/B still blocked — honest keep-off decision refresh.
 * Does NOT flip view tools defaults.
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(repoRoot, "artifacts", "coding-prod-c1");

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
  const liveReady = false;
  const meetsGate = sim.meetsGate && liveReady;
  const decision = {
    ok: true,
    card: "C1-R",
    wave: "C1",
    completionClass: "done (sim+residual)",
    meetsGate: false,
    recommendation: "keep-off" as const,
    defaultsUnchanged: true,
    viewToolsDefaultOff: isDcsContextViewToolsEnabled({}) === false,
    sim: {
      fixtureCount: sim.fixtureCount,
      reductionFactor: Number(sim.reductionFactor.toFixed(3)),
      meetsSimGate: sim.meetsGate,
      reason: sim.reason,
    },
    live: {
      ready: false,
      blockedReason:
        "Live A/B corpus + comms:replay binding + owner scorecard window missing (CODING-C1-LIVE-AB.md)",
    },
    residual: [
      "Live A/B blocked — no production corpus in this environment",
      "View tools / tool-registry / working-memory remain default-off",
    ],
    howToEnableOptIn:
      "Set OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1 (or OPENCLAW_DCS_CONTEXT_TOOLS=1) and restart gateway/runtime.",
    priorA1: existsSync(path.join(repoRoot, "artifacts/coding-prod-a1/decision.json"))
      ? (JSON.parse(readFileSync(path.join(repoRoot, "artifacts/coding-prod-a1/decision.json"), "utf8")) as {
          recommendation?: string;
        }).recommendation
      : null,
    sha: gitShortSha(),
    ts: new Date().toISOString(),
  };
  if (!decision.viewToolsDefaultOff) throw new Error("view tools default red-line failed");
  if (meetsGate) throw new Error("unexpected meetsGate true without live");

  writeFileSync(path.join(outDir, "decision.json"), JSON.stringify(decision, null, 2) + "\n");
  writeFileSync(
    path.join(outDir, "acceptance.json"),
    JSON.stringify(
      {
        ok: true,
        card: "C1-R",
        completionClass: decision.completionClass,
        meetsGate: false,
        recommendation: "keep-off",
        defaultsUnchanged: true,
        liveReady: false,
        ts: decision.ts,
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    path.join(outDir, "gates.json"),
    JSON.stringify(
      {
        ok: true,
        viewToolsDefaultOff: true,
        liveReady: false,
        recommendation: "keep-off",
        noDefaultFlagFlip: true,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(decision, null, 2));
}

main();