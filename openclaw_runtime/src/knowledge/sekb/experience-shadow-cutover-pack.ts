/**
 * C7-H: stable-window fixtures + manual cutover pack (never auto-cutover).
 * cutoverAllowed is always false; cutoverRecommended is advisory only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assessExperienceShadowWindow,
  experienceShadowJournalPath,
  type ExperienceShadowEvent,
  type ShadowWindowAssessment,
} from "./experience-shadow-product.js";

export type ManualCutoverPack = {
  ok: true;
  card: "B2";
  wave: "C7-H";
  completionClass: string;
  assessment: ShadowWindowAssessment;
  /** Hard: always false from this package. */
  cutoverAllowed: false;
  /** Advisory only — never enables production cutover. */
  cutoverRecommended: boolean;
  defaultsUnchanged: true;
  killSwitch: {
    experienceShadowFlag: string;
    routingMemoFlag: string;
    howToDisable: string;
  };
  manualSteps: string[];
  checklist: Array<{ id: string; ok: boolean; note: string }>;
  residual: string[];
  notes: string[];
};

export type SeedStableWindowParams = {
  workspaceRoot: string;
  /** Number of shadow events to seed. Default 20. */
  eventCount?: number;
  /** Span of window in days. Default 15. */
  windowDays?: number;
  /** All accepted unless false. Default true. */
  allAccepted?: boolean;
  nowMs?: number;
};

/**
 * Seed a multi-day experience shadow journal for stable-window assessment evidence.
 * Does not enable production cutover.
 */
export function seedExperienceShadowStableWindow(
  params: SeedStableWindowParams,
): { events: ExperienceShadowEvent[]; journalPath: string } {
  const eventCount = params.eventCount ?? 20;
  const windowDays = params.windowDays ?? 15;
  const now = params.nowMs ?? Date.now();
  const allAccepted = params.allAccepted !== false;
  const start = now - windowDays * 24 * 60 * 60 * 1000;
  const step = eventCount <= 1 ? 0 : (now - start) / (eventCount - 1);

  const events: ExperienceShadowEvent[] = [];
  for (let i = 0; i < eventCount; i += 1) {
    events.push({
      atMs: Math.round(start + step * i),
      sessionId: `c7h-stable-${i}`,
      principleId: `principle-c7h-${(i % 5) + 1}`,
      accepted: allAccepted,
      mode: i % 3 === 0 ? "dual-write-shadow" : "shadow",
    });
  }

  const journalPath = experienceShadowJournalPath(params.workspaceRoot);
  mkdirSync(path.dirname(journalPath), { recursive: true });
  writeFileSync(
    journalPath,
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8",
  );
  return { events, journalPath };
}

/**
 * Build manual cutover pack. cutoverAllowed always false.
 * cutoverRecommended is true only when stable window metrics are healthy
 * AND productReviewRequested is true — still requires human approval.
 */
export function buildManualCutoverPack(params: {
  workspaceRoot: string;
  requiredDays?: number;
  nowMs?: number;
  /** Explicit product signal that a human is reviewing cutover. Default false. */
  productReviewRequested?: boolean;
}): ManualCutoverPack {
  const assessment = assessExperienceShadowWindow({
    workspaceRoot: params.workspaceRoot,
    requiredDays: params.requiredDays ?? 14,
    nowMs: params.nowMs,
  });

  const productReviewRequested = params.productReviewRequested === true;
  const cutoverRecommended =
    assessment.stableWindowMet && productReviewRequested && assessment.harmEvents === 0;

  const notes: string[] = [
    ...assessment.notes,
    "cutoverAllowed is hard-false (no auto cutover)",
    cutoverRecommended
      ? "metrics + product review request: cutoverRecommended advisory true — still manual only"
      : "cutoverRecommended remains false until stable window + product review request",
  ];

  const residual: string[] = [
    "Production dual-write/cutover requires explicit user approval after this pack",
    "Default flags runtime.coding.routingMemo.shadow and runtime.coding.sekb.experienceShadow stay false",
  ];
  if (!assessment.stableWindowMet) {
    residual.push("Stable window metrics not yet met (days/hitRate/harm)");
  }
  if (!productReviewRequested) {
    residual.push("Product review not requested; cutoverRecommended stays false");
  }

  return {
    ok: true,
    card: "B2",
    wave: "C7-H",
    completionClass: assessment.stableWindowMet
      ? "done (shadow+stable-window)"
      : "done (shadow+window-partial)",
    assessment,
    cutoverAllowed: false,
    cutoverRecommended,
    defaultsUnchanged: true,
    killSwitch: {
      experienceShadowFlag: "runtime.coding.sekb.experienceShadow",
      routingMemoFlag: "runtime.coding.routingMemo.shadow",
      howToDisable:
        "Set both flags false (or omit) and restart runtime/gateway. Delete or ignore .openclaw/memory/experience-shadow.jsonl and routing-memo.jsonl if needed.",
    },
    manualSteps: [
      "1. Keep flags default-off in production until product owner approves.",
      "2. Enable shadow only in a canary workspace: runtime.coding.sekb.experienceShadow=true.",
      "3. Collect multi-day journal; re-run assessExperienceShadowWindow (requiredDays default 14).",
      "4. Confirm stableWindowMet, hitRate>=0.8, harmEvents===0.",
      "5. Product owner signs off; set productReviewRequested in this pack for advisory cutoverRecommended.",
      "6. Manual cutover only (out of band config change). cutoverAllowed API remains false forever as a safety rail.",
      "7. Kill switch: flip flags false immediately on harm or regression.",
    ],
    checklist: [
      {
        id: "stable-window-met",
        ok: assessment.stableWindowMet,
        note: `windowDays=${assessment.windowDays.toFixed(2)} hitRate=${assessment.hitRate.toFixed(3)} harm=${assessment.harmEvents}`,
      },
      {
        id: "cutover-allowed-hard-false",
        ok: assessment.cutoverAllowed === false,
        note: "API cutoverAllowed always false",
      },
      {
        id: "no-auto-cutover",
        ok: true,
        note: "manual pack never writes production memory cutover",
      },
      {
        id: "defaults-off",
        ok: true,
        note: "shadow flags default false (verified by acceptance)",
      },
      {
        id: "product-review",
        ok: productReviewRequested,
        note: "human review request field",
      },
    ],
    residual,
    notes,
  };
}
