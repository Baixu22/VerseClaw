/**
 * Stage 6 read-only control-plane explanation projections.
 *
 * These functions are pure and deterministic: they never read the clock,
 * generate randomness, persist data, call providers, or execute effects.
 * They consume PromptPlan/RequestEnvelope/Receipt-shaped refs/digests and
 * sanitized Local Control Plane report projections.
 */
import type { PromptPlan } from "./artifacts.js";

export const STAGE6_PROJECTION_SCHEMA = "ContextControlPlaneStage6Projection/v1" as const;

export type Stage6DiffStatus = "selected" | "omitted";

export type Stage6DiffEntry = {
  id: string;
  refId: string;
  status: Stage6DiffStatus;
  order: number | null;
  basis: string;
  reason: string;
  source: string;
};

export type Stage6PlanProjection = {
  schema: typeof STAGE6_PROJECTION_SCHEMA;
  entries: Stage6DiffEntry[];
  selectedCount: number;
  omittedCount: number;
  policy: {
    digest: string;
    epoch: string;
    ruleId: string;
  };
};

export type Stage6PlanDiffResult =
  | { ok: true; projection: Stage6PlanProjection }
  | {
      ok: false;
      reason: "invalid-plan" | "selected-omitted-overlap" | "order-mismatch";
      message: string;
    };

export type Stage6WhyEntry = {
  refId: string;
  status: Stage6DiffStatus | "not-found";
  reason: string;
  basis: string;
  order: number | null;
  policyDigest: string;
  policyEpoch: string;
  ruleId: string;
};

export type Stage6PolicyPriority = "critical" | "constraint" | "evidence" | "normal" | "optional";

export type Stage6PolicyCandidate = {
  refId: string;
  priority: Stage6PolicyPriority;
  units: number;
  protectedFlag: boolean;
};

export type Stage6PolicyRule = {
  ruleId: string;
  policyDigest: string;
  protectPriorities: readonly Stage6PolicyPriority[];
  budgetUnits: number;
};

export type Stage6SimulationDecision = {
  refId: string;
  decision: "allow" | "drop";
  reason: "protected-rule" | "budget-allow" | "protected-over-budget" | "budget-drop";
  units: number;
};

export type Stage6PolicySimulation = {
  schema: typeof STAGE6_PROJECTION_SCHEMA;
  dryRun: true;
  sideEffects: 0;
  policy: {
    ruleId: string;
    digest: string;
  };
  budgetUnits: number;
  usedUnits: number;
  decisions: Stage6SimulationDecision[];
};

export type Stage6PolicySimulationResult =
  | { ok: true; simulation: Stage6PolicySimulation }
  | { ok: false; reason: "invalid-policy" | "invalid-candidate"; message: string };

export type Stage6ReplayInputProjection = {
  schema: typeof STAGE6_PROJECTION_SCHEMA;
  planId: string | null;
  snapshotId: string | null;
  planDigest: string | null;
  envelopeDigest: string | null;
  receiptIds: string[];
  reportIds: string[];
  evidenceRefs: Array<{ type: string; ref: string }>;
  timestamps: string[];
  effectsReplayed: false;
  rawPayloadIncluded: false;
};

const PRIORITY_ORDER: Record<Stage6PolicyPriority, number> = {
  critical: 0,
  constraint: 1,
  evidence: 2,
  normal: 3,
  optional: 4,
};

const PRIORITY_VALUES = new Set<Stage6PolicyPriority>([
  "critical",
  "constraint",
  "evidence",
  "normal",
  "optional",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPromptPlanLike(value: unknown): PromptPlan {
  if (!isRecord(value)) throw new Error("invalid-plan");
  return value as unknown as PromptPlan;
}

/**
 * Project a sealed PromptPlan into selected/omitted/why facts. Overlapping
 * refs and an order that does not match selected refs fail closed.
 */
export function projectStage6DiffFromPromptPlan(value: unknown): Stage6PlanDiffResult {
  try {
    const plan = isPromptPlanLike(value);
    if (!Array.isArray(plan.selected) || plan.selected.length === 0) {
      return { ok: false, reason: "invalid-plan", message: "PromptPlan.selected must be non-empty" };
    }
    if (!Array.isArray(plan.omitted) || !Array.isArray(plan.order) || !isRecord(plan.why)) {
      return { ok: false, reason: "invalid-plan", message: "PromptPlan.omitted/order/why must be present" };
    }
    const selected: Array<{ refId: string; order: number | null; basis: string }> = [];
    for (const value of plan.selected) {
      if (!isRecord(value) || typeof value.refId !== "string" || !value.refId) {
        return { ok: false, reason: "invalid-plan", message: "invalid selected entry" };
      }
      selected.push({
        refId: value.refId,
        order: typeof value.order === "number" && Number.isSafeInteger(value.order) && value.order >= 0
          ? value.order
          : null,
        basis: typeof value.basis === "string" ? value.basis : "unknown",
      });
    }
    const omitted: Array<{ refId: string; reason: string }> = [];
    for (const value of plan.omitted) {
      if (!isRecord(value) || typeof value.refId !== "string" || !value.refId) {
        return { ok: false, reason: "invalid-plan", message: "invalid omitted entry" };
      }
      omitted.push({
        refId: value.refId,
        reason: typeof value.reason === "string" && value.reason ? value.reason : "unknown",
      });
    }
    const selectedRefs = new Set(selected.map((entry) => entry.refId));
    for (const entry of omitted) {
      if (selectedRefs.has(entry.refId)) {
        return { ok: false, reason: "selected-omitted-overlap", message: `ref ${entry.refId} is both selected and omitted` };
      }
    }
    const order: string[] = [];
    for (const value of plan.order) {
      if (typeof value !== "string" || !value) {
        return { ok: false, reason: "invalid-plan", message: "invalid order entry" };
      }
      order.push(value);
    }
    if (order.length !== selected.length) {
      return { ok: false, reason: "order-mismatch", message: "order length must equal selected refs" };
    }
    const orderSet = new Set(order);
    if (orderSet.size !== order.length || [...selectedRefs].some((refId) => !orderSet.has(refId))) {
      return { ok: false, reason: "order-mismatch", message: "order must contain each selected ref exactly once" };
    }
    const entries: Stage6DiffEntry[] = [
      ...selected.map((entry) => ({
        id: `selected:${entry.refId}`,
        refId: entry.refId,
        status: "selected" as const,
        order: order.indexOf(entry.refId),
        basis: entry.basis,
        reason: "selected-by-plan",
        source: "PromptPlan",
      })),
      ...omitted.map((entry) => ({
        id: `omitted:${entry.refId}`,
        refId: entry.refId,
        status: "omitted" as const,
        order: null,
        basis: "unknown",
        reason: entry.reason,
        source: "PromptPlan",
      })),
    ].sort((left, right) => {
      if (left.status !== right.status) return left.status === "selected" ? -1 : 1;
      if (left.status === "selected") return (left.order ?? 0) - (right.order ?? 0);
      return left.refId.localeCompare(right.refId);
    });
    return {
      ok: true,
      projection: {
        schema: STAGE6_PROJECTION_SCHEMA,
        entries,
        selectedCount: selected.length,
        omittedCount: omitted.length,
        policy: {
          digest: typeof plan.why.policyDigest === "string" ? plan.why.policyDigest : "unknown",
          epoch: typeof plan.why.policyEpoch === "string" ? plan.why.policyEpoch : "unknown",
          ruleId: typeof plan.why.ruleId === "string" ? plan.why.ruleId : "unknown",
        },
      },
    };
  } catch {
    return { ok: false, reason: "invalid-plan", message: "invalid PromptPlan shape" };
  }
}

export function explainStage6WhyIncluded(
  projection: Stage6PlanProjection,
  refId: string,
): Stage6WhyEntry {
  const entry = projection.entries.find((candidate) => candidate.refId === refId);
  return {
    refId,
    status: entry?.status ?? "not-found",
    reason: entry?.reason ?? "not-in-plan",
    basis: entry?.basis ?? "unknown",
    order: entry?.order ?? null,
    policyDigest: projection.policy.digest,
    policyEpoch: projection.policy.epoch,
    ruleId: projection.policy.ruleId,
  };
}

function normalizePolicyCandidate(value: unknown): Stage6PolicyCandidate {
  if (!isRecord(value)) throw new Error("invalid-candidate");
  if (typeof value.refId !== "string" || value.refId.length === 0 || value.refId.length > 256) {
    throw new Error("invalid-candidate");
  }
  if (typeof value.priority !== "string" || !PRIORITY_VALUES.has(value.priority as Stage6PolicyPriority)) {
    throw new Error("invalid-candidate");
  }
  if (!Number.isSafeInteger(value.units) || (value.units as number) < 0) {
    throw new Error("invalid-candidate");
  }
  return {
    refId: value.refId,
    priority: value.priority as Stage6PolicyPriority,
    units: value.units as number,
    protectedFlag: value.protectedFlag === true,
  };
}

/**
 * Pure dry-run policy simulation. It returns decisions only and has no
 * observable side effects; repeated calls with equal inputs are deep-equal.
 */
export function simulateStage6Policy(input: {
  policy: Stage6PolicyRule;
  candidates: readonly Stage6PolicyCandidate[];
}): Stage6PolicySimulationResult {
  try {
    const { policy, candidates } = input;
    if (!isRecord(policy) || typeof policy.ruleId !== "string" || !policy.ruleId) {
      return { ok: false, reason: "invalid-policy", message: "policy.ruleId is required" };
    }
    if (typeof policy.policyDigest !== "string" || !policy.policyDigest) {
      return { ok: false, reason: "invalid-policy", message: "policy.policyDigest is required" };
    }
    if (!Array.isArray(policy.protectPriorities) || !policy.protectPriorities.every((entry) => typeof entry === "string" && PRIORITY_VALUES.has(entry as Stage6PolicyPriority))) {
      return { ok: false, reason: "invalid-policy", message: "policy.protectPriorities is invalid" };
    }
    if (!Number.isSafeInteger(policy.budgetUnits) || policy.budgetUnits < 0) {
      return { ok: false, reason: "invalid-policy", message: "policy.budgetUnits is invalid" };
    }
    if (!Array.isArray(candidates)) {
      return { ok: false, reason: "invalid-candidate", message: "candidates must be an array" };
    }
    const normalized = candidates.map(normalizePolicyCandidate);
    const seen = new Set<string>();
    for (const candidate of normalized) {
      if (seen.has(candidate.refId)) {
        return { ok: false, reason: "invalid-candidate", message: `duplicate candidate ${candidate.refId}` };
      }
      seen.add(candidate.refId);
    }
    const ordered = normalized.toSorted((left, right) => {
      const priority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
      return priority || left.refId.localeCompare(right.refId);
    });
    const protect = new Set<Stage6PolicyPriority>(policy.protectPriorities as Stage6PolicyPriority[]);
    let usedUnits = 0;
    const decisions: Stage6SimulationDecision[] = [];
    for (const candidate of ordered) {
      const protectedFlag = candidate.protectedFlag || protect.has(candidate.priority);
      const fits = usedUnits + candidate.units <= policy.budgetUnits;
      if (fits) {
        decisions.push({
          refId: candidate.refId,
          decision: "allow",
          reason: protectedFlag ? "protected-rule" : "budget-allow",
          units: candidate.units,
        });
        usedUnits += candidate.units;
      } else {
        decisions.push({
          refId: candidate.refId,
          decision: "drop",
          reason: protectedFlag ? "protected-over-budget" : "budget-drop",
          units: candidate.units,
        });
      }
    }
    return {
      ok: true,
      simulation: {
        schema: STAGE6_PROJECTION_SCHEMA,
        dryRun: true,
        sideEffects: 0,
        policy: { ruleId: policy.ruleId, digest: policy.policyDigest },
        budgetUnits: policy.budgetUnits,
        usedUnits,
        decisions,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("invalid-candidate")) {
      return { ok: false, reason: "invalid-candidate", message };
    }
    return { ok: false, reason: "invalid-policy", message };
  }
}

export type Stage6ReportLike = {
  id?: unknown;
  kind?: unknown;
  timestamp?: unknown;
  summary?: unknown;
  evidenceRefs?: readonly { type?: unknown; ref?: unknown }[];
  payload?: unknown;
};

type ReportSection = {
  id: string;
  itemCount: number;
  omittedItemCount: number;
  protectedItemCount: number;
};

function normalizeReportSection(value: unknown): ReportSection | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return undefined;
  const itemCount = typeof value.itemCount === "number" && Number.isSafeInteger(value.itemCount) && value.itemCount >= 0
    ? value.itemCount
    : 0;
  const omittedItemCount = typeof value.omittedItemCount === "number" && Number.isSafeInteger(value.omittedItemCount) && value.omittedItemCount >= 0
    ? value.omittedItemCount
    : 0;
  const protectedItemCount = typeof value.protectedItemCount === "number" && Number.isSafeInteger(value.protectedItemCount) && value.protectedItemCount >= 0
    ? value.protectedItemCount
    : 0;
  return { id: value.id, itemCount, omittedItemCount, protectedItemCount };
}

/**
 * Project sanitized Local Control Plane context reports into a diff. Reports
 * carry counts/section ids only, never raw prompt or tool output.
 */
export function projectStage6DiffFromReports(reports: readonly Stage6ReportLike[]): {
  schema: typeof STAGE6_PROJECTION_SCHEMA;
  entries: Stage6DiffEntry[];
  selectedCount: number;
  omittedCount: number;
  reportCount: number;
} {
  const entries: Stage6DiffEntry[] = [];
  for (const report of reports.slice(0, 50)) {
    const reportId = typeof report.id === "string" && report.id ? report.id : `report_${entries.length + 1}`;
    const payload = isRecord(report.payload) ? report.payload : undefined;
    const sections = Array.isArray(payload?.sections)
      ? payload.sections.map(normalizeReportSection).filter((section) => section !== undefined)
      : [];
    if (sections.length === 0) {
      entries.push({
        id: `${reportId}:summary`,
        refId: reportId,
        status: "selected",
        order: entries.filter((entry) => entry.status === "selected").length,
        basis: typeof report.kind === "string" ? report.kind : "unknown",
        reason: "report-summary",
        source: reportId,
      });
      continue;
    }
    for (const section of sections) {
      const selectedCount = Math.max(0, section.itemCount - section.omittedItemCount);
      if (selectedCount > 0) {
        entries.push({
          id: `${reportId}:${section.id}:selected`,
          refId: `${reportId}:${section.id}`,
          status: "selected",
          order: entries.filter((entry) => entry.status === "selected").length,
          basis: typeof report.kind === "string" ? report.kind : "unknown",
          reason: section.protectedItemCount > 0 ? "protected-section" : "selected-by-report",
          source: reportId,
        });
      }
      if (section.omittedItemCount > 0) {
        entries.push({
          id: `${reportId}:${section.id}:omitted`,
          refId: `${reportId}:${section.id}`,
          status: "omitted",
          order: null,
          basis: typeof report.kind === "string" ? report.kind : "unknown",
          reason: "context.truncated_or_omitted",
          source: reportId,
        });
      }
    }
  }
  const sorted = entries.toSorted((left, right) => {
    if (left.status !== right.status) return left.status === "selected" ? -1 : 1;
    if (left.status === "selected") return (left.order ?? 0) - (right.order ?? 0);
    return left.refId.localeCompare(right.refId);
  });
  return {
    schema: STAGE6_PROJECTION_SCHEMA,
    entries: sorted,
    selectedCount: sorted.filter((entry) => entry.status === "selected").length,
    omittedCount: sorted.filter((entry) => entry.status === "omitted").length,
    reportCount: Math.min(reports.length, 50),
  };
}

/**
 * Build an input-only replay projection from plan/report refs. It can never
 * contain raw payload and explicitly carries effectsReplayed=false.
 */
export function projectStage6ReplayInputFromReports(input: {
  reports: readonly Stage6ReportLike[];
  plan?: PromptPlan | null;
  envelopeDigest?: string | null;
  receiptIds?: readonly string[];
}): Stage6ReplayInputProjection {
  const plan = input.plan && isRecord(input.plan) ? input.plan as unknown as PromptPlan : null;
  const evidenceRefs: Array<{ type: string; ref: string }> = [];
  const seen = new Set<string>();
  for (const report of input.reports.slice(0, 50)) {
    for (const ref of Array.isArray(report.evidenceRefs) ? report.evidenceRefs : []) {
      if (!isRecord(ref) || typeof ref.type !== "string" || typeof ref.ref !== "string") continue;
      const key = `${ref.type}:${ref.ref}`;
      if (!seen.has(key)) {
        seen.add(key);
        evidenceRefs.push({ type: ref.type, ref: ref.ref });
      }
    }
  }
  evidenceRefs.sort((left, right) => left.type.localeCompare(right.type) || left.ref.localeCompare(right.ref));
  return {
    schema: STAGE6_PROJECTION_SCHEMA,
    planId: typeof plan?.planId === "string" && plan.planId ? plan.planId : null,
    snapshotId: typeof plan?.snapshotId === "string" && plan.snapshotId ? plan.snapshotId : null,
    planDigest: typeof plan?.planDigest === "string" && plan.planDigest ? plan.planDigest : null,
    envelopeDigest: typeof input.envelopeDigest === "string" && input.envelopeDigest ? input.envelopeDigest : null,
    receiptIds: [...new Set((input.receiptIds ?? []).filter((id) => typeof id === "string" && id.length > 0))].sort(),
    reportIds: input.reports.slice(0, 50).map((report) => typeof report.id === "string" && report.id ? report.id : "unknown").sort(),
    evidenceRefs,
    timestamps: input.reports.slice(0, 50)
      .map((report) => typeof report.timestamp === "string" ? report.timestamp : null)
      .filter((timestamp): timestamp is string => Boolean(timestamp))
      .sort(),
    effectsReplayed: false,
    rawPayloadIncluded: false,
  };
}
