/**
 * L02: bounded context-pressure recovery projection.
 *
 * When the loop compacts under token pressure, the Working Context ledger keeps
 * the durable truth (objective / unfinished work / dependencies / recent
 * evidence). This module projects a bounded, deterministic recovery summary from
 * that snapshot so the next turn can recover the live task instead of silently
 * dropping it.
 *
 * Guarantees the acceptance criteria ask for:
 * - **no silent drop**: every section reports how many entries were dropped
 *   (`dropped`) and `truncated` is set whenever the budget cut anything.
 * - **no silent recursion**: a depth guard refuses beyond `maxDepth`.
 * - **no fake completion**: the result never claims the task is complete
 *   (`complete: false` always) and an absent/empty snapshot is `unknown`, not
 *   `recovered`.
 */
import { createHash } from "node:crypto";

import type {
  TaskLedgerWorkingContextField,
  TaskLedgerWorkingContextSnapshot,
} from "../../../shared/types/task-ledger.js";

export type ContextPressureRecoverySection =
  | "objective"
  | "unfinished"
  | "dependencies"
  | "recentEvidence";

export type ContextPressureRecoveryStatus = "recovered" | "unknown" | "depth-exceeded";

export type ContextPressureRecoveryResult = {
  status: ContextPressureRecoveryStatus;
  digest: string;
  budgetChars: number;
  usedChars: number;
  sections: Record<ContextPressureRecoverySection, string[]>;
  dropped: Record<ContextPressureRecoverySection, number>;
  truncated: boolean;
  /** The recovery summary never asserts task completion. */
  complete: false;
  reason?: string;
};

const SECTION_ORDER: readonly ContextPressureRecoverySection[] = [
  "objective",
  "unfinished",
  "dependencies",
  "recentEvidence",
];

const SECTION_FIELDS: Record<ContextPressureRecoverySection, readonly TaskLedgerWorkingContextField[]> = {
  objective: ["Objective"],
  unfinished: ["NextAction", "OpenRisks", "Decisions"],
  dependencies: ["Constraints", "ActiveFiles"],
  recentEvidence: ["Evidence", "ConfirmedFacts"],
};

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => renderValue(entry)).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.ref === "string") return record.ref;
    if (typeof record.type === "string" && typeof record.ref === "string") return `${record.type}:${record.ref}`;
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function collectSection(
  snapshot: TaskLedgerWorkingContextSnapshot,
  section: ContextPressureRecoverySection,
): string[] {
  const lines: string[] = [];
  for (const field of SECTION_FIELDS[section]) {
    const projection = snapshot.fields[field];
    if (!projection) continue;
    if (projection.current) {
      const text = renderValue(projection.current.value);
      if (text) lines.push(`${field}: ${text}`);
    }
    for (const pending of projection.pending) {
      const text = renderValue(pending.value);
      if (text) lines.push(`${field} (pending): ${text}`);
    }
    if (section === "recentEvidence") {
      for (const past of projection.history.slice(-3)) {
        const text = renderValue(past.value);
        if (text) lines.push(`${field} (history): ${text}`);
      }
    }
  }
  return lines;
}

function emptySections(): Record<ContextPressureRecoverySection, string[]> {
  return { objective: [], unfinished: [], dependencies: [], recentEvidence: [] };
}

function emptyDropped(): Record<ContextPressureRecoverySection, number> {
  return { objective: 0, unfinished: 0, dependencies: 0, recentEvidence: 0 };
}

function digestResult(result: Omit<ContextPressureRecoveryResult, "digest">): string {
  return createHash("sha256")
    .update(JSON.stringify({ status: result.status, sections: result.sections, dropped: result.dropped, truncated: result.truncated }))
    .digest("hex");
}

export function buildContextPressureRecovery(input: {
  snapshot?: TaskLedgerWorkingContextSnapshot | null;
  budgetChars: number;
  depth?: number;
  maxDepth?: number;
}): ContextPressureRecoveryResult {
  const budgetChars = Math.max(0, Math.floor(input.budgetChars));
  const maxDepth = input.maxDepth ?? 3;
  const depth = input.depth ?? 0;

  if (depth > maxDepth) {
    const base = {
      status: "depth-exceeded" as const,
      budgetChars,
      usedChars: 0,
      sections: emptySections(),
      dropped: emptyDropped(),
      truncated: false,
      complete: false as const,
      reason: `handoff depth ${depth} exceeds maxDepth ${maxDepth}`,
    };
    return { ...base, digest: digestResult(base) };
  }

  const candidates = input.snapshot
    ? SECTION_ORDER.map((section) => [section, collectSection(input.snapshot!, section)] as const)
    : [];

  if (!input.snapshot || candidates.every(([, lines]) => lines.length === 0)) {
    const base = {
      status: "unknown" as const,
      budgetChars,
      usedChars: 0,
      sections: emptySections(),
      dropped: emptyDropped(),
      truncated: false,
      complete: false as const,
      reason: "no recoverable working-context entries",
    };
    return { ...base, digest: digestResult(base) };
  }

  const sections = emptySections();
  const dropped = emptyDropped();
  let usedChars = 0;
  let truncated = false;
  for (const [section, lines] of candidates) {
    for (const line of lines) {
      const cost = line.length + 1;
      if (usedChars + cost > budgetChars) {
        dropped[section] += 1;
        truncated = true;
        continue;
      }
      sections[section].push(line);
      usedChars += cost;
    }
  }

  const base = {
    status: "recovered" as const,
    budgetChars,
    usedChars,
    sections,
    dropped,
    truncated,
    complete: false as const,
  };
  return { ...base, digest: digestResult(base) };
}