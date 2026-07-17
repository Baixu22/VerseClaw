/**
 * Goal B / B2: C7-H shadow stable window + manual cutover pack.
 * cutoverAllowed always false; no default flag flips.
 *
 * Run from openclaw_runtime:
 *   node --import tsx scripts/coding-prod-b2-c7h.mts
 */
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  isCodingRoutingMemoShadowEnabled,
  isCodingSekbExperienceShadowEnabled,
} from "../src/context-engine/coding-runtime-flags.ts";
import {
  buildManualCutoverPack,
  seedExperienceShadowStableWindow,
} from "../src/knowledge/sekb/experience-shadow-cutover-pack.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outDir = path.join(repoRoot, "artifacts", "coding-prod-b2");

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main(): void {
  mkdirSync(outDir, { recursive: true });

  assert(isCodingRoutingMemoShadowEnabled() === false, "routingMemo.shadow default false");
  assert(isCodingSekbExperienceShadowEnabled() === false, "experienceShadow default false");

  const root = mkdtempSync(path.join(tmpdir(), "c7h-b2-"));
  const now = Date.UTC(2026, 6, 15, 12, 0, 0);
  try {
    const seeded = seedExperienceShadowStableWindow({
      workspaceRoot: root,
      eventCount: 20,
      windowDays: 15,
      allAccepted: true,
      nowMs: now,
    });

    // Packaging: productReviewRequested false — cutoverRecommended stays false
    const pack = buildManualCutoverPack({
      workspaceRoot: root,
      requiredDays: 14,
      nowMs: now,
      productReviewRequested: false,
    });

    // Also produce an advisory-true sample pack under separate key for docs honesty
    const advisorySample = buildManualCutoverPack({
      workspaceRoot: root,
      requiredDays: 14,
      nowMs: now,
      productReviewRequested: true,
    });

    assert(pack.cutoverAllowed === false, "cutoverAllowed hard false");
    assert(pack.assessment.cutoverAllowed === false, "assessment cutoverAllowed false");
    assert(pack.cutoverRecommended === false, "packaging cutoverRecommended false without product review");
    assert(pack.assessment.stableWindowMet === true, "stable window fixture must meet");
    assert(advisorySample.cutoverAllowed === false, "advisory sample still hard-false cutoverAllowed");
    assert(advisorySample.cutoverRecommended === true, "advisory sample may recommend");
    assert(pack.defaultsUnchanged === true, "defaults unchanged");
    assert(seeded.events.length === 20, "seeded 20 events");

    const acceptance = {
      ok: true,
      card: "B2",
      wave: "C7-H",
      completionClass: pack.completionClass,
      stableWindowMet: pack.assessment.stableWindowMet,
      cutoverAllowed: pack.cutoverAllowed,
      cutoverRecommended: pack.cutoverRecommended,
      defaultsUnchanged: true,
      flagsDefaultOff: {
        "runtime.coding.routingMemo.shadow": isCodingRoutingMemoShadowEnabled(),
        "runtime.coding.sekb.experienceShadow": isCodingSekbExperienceShadowEnabled(),
      },
      assessment: pack.assessment,
      advisorySample: {
        cutoverAllowed: advisorySample.cutoverAllowed,
        cutoverRecommended: advisorySample.cutoverRecommended,
        note: "productReviewRequested=true yields advisory recommend only; cutoverAllowed still false",
      },
      decisionPackageComplete: true,
      sha: gitShortSha(),
      ts: new Date().toISOString(),
    };

    writeFileSync(path.join(outDir, "cutover-pack.json"), JSON.stringify(pack, null, 2) + "\n", "utf8");
    writeFileSync(
      path.join(outDir, "stable-window.json"),
      JSON.stringify(
        {
          eventCount: pack.assessment.eventCount,
          windowDays: pack.assessment.windowDays,
          hitRate: pack.assessment.hitRate,
          harmEvents: pack.assessment.harmEvents,
          stableWindowMet: pack.assessment.stableWindowMet,
          cutoverAllowed: false,
          journalPathPattern: ".openclaw/memory/experience-shadow.jsonl",
          seededEvents: seeded.events.length,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    writeFileSync(path.join(outDir, "acceptance.json"), JSON.stringify(acceptance, null, 2) + "\n", "utf8");
    writeFileSync(
      path.join(outDir, "gates.json"),
      JSON.stringify(
        {
          ok: true,
          card: "B2",
          cutoverAllowed: false,
          cutoverRecommended: false,
          stableWindowMet: pack.assessment.stableWindowMet,
          defaultsUnchanged: true,
          flagsDefaultOff: true,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.log(JSON.stringify(acceptance, null, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
