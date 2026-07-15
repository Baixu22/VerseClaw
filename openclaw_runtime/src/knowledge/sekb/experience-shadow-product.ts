/**
 * C7-H / C7-2: experience Block productization helpers (shadow-safe).
 *
 * - Dual-write journal is optional and default-off
 * - No production cutover; shadow path only
 * - Stable window assessment is advisory metrics, never auto-enables cutover
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ContextBlock } from "../../context-engine/block.js";
import { buildExperienceBlock, type BuildExperienceBlockParams } from "./experience-block-bridge.js";

export type ExperienceShadowEvent = {
  atMs: number;
  sessionId: string;
  principleId: string;
  accepted?: boolean;
  mode: "shadow" | "dual-write-shadow";
};

export type ShadowWindowAssessment = {
  eventCount: number;
  windowDays: number;
  hitRate: number;
  harmEvents: number;
  stableWindowMet: boolean;
  cutoverAllowed: false; // hard: never auto-allow
  notes: string[];
};

export function experienceShadowJournalPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".openclaw", "memory", "experience-shadow.jsonl");
}

export function appendExperienceShadowEvent(
  workspaceRoot: string,
  event: ExperienceShadowEvent,
): void {
  const file = experienceShadowJournalPath(workspaceRoot);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
}

export function readExperienceShadowEvents(workspaceRoot: string): ExperienceShadowEvent[] {
  const file = experienceShadowJournalPath(workspaceRoot);
  if (!existsSync(file)) return [];
  const out: ExperienceShadowEvent[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as ExperienceShadowEvent);
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * Productized shadow path: build experience block + optional dual-write journal.
 * Never writes to production memory cutover.
 */
export function productizeExperienceShadow(params: {
  workspaceRoot: string;
  enabled: boolean;
  dualWrite: boolean;
  build: BuildExperienceBlockParams;
}): { block?: ContextBlock; journaled: boolean } {
  if (!params.enabled) {
    return { journaled: false };
  }
  const block = buildExperienceBlock(params.build);
  appendExperienceShadowEvent(params.workspaceRoot, {
    atMs: Date.now(),
    sessionId: params.build.sessionId,
    principleId: params.build.principle.principle_id,
    mode: params.dualWrite ? "dual-write-shadow" : "shadow",
  });
  return { block, journaled: true };
}

/**
 * Assess shadow stability. Always returns cutoverAllowed=false (product decision required).
 */
export function assessExperienceShadowWindow(params: {
  workspaceRoot: string;
  requiredDays?: number;
  nowMs?: number;
}): ShadowWindowAssessment {
  const requiredDays = params.requiredDays ?? 14;
  const now = params.nowMs ?? Date.now();
  const events = readExperienceShadowEvents(params.workspaceRoot);
  if (events.length === 0) {
    return {
      eventCount: 0,
      windowDays: 0,
      hitRate: 0,
      harmEvents: 0,
      stableWindowMet: false,
      cutoverAllowed: false,
      notes: ["no shadow events"],
    };
  }
  const times = events.map((e) => e.atMs).sort((a, b) => a - b);
  const windowDays = (now - times[0]!) / (24 * 60 * 60 * 1000);
  const accepted = events.filter((e) => e.accepted === true).length;
  const hitRate = accepted / events.length;
  const harmEvents = events.filter((e) => e.accepted === false).length;
  const stableWindowMet = windowDays >= requiredDays && hitRate >= 0.8 && harmEvents === 0;
  return {
    eventCount: events.length,
    windowDays,
    hitRate,
    harmEvents,
    stableWindowMet,
    cutoverAllowed: false,
    notes: [
      stableWindowMet
        ? "shadow window metrics look healthy; product decision still required for cutover"
        : "shadow window not yet met or metrics insufficient",
      "default cutover remains OFF",
    ],
  };
}
