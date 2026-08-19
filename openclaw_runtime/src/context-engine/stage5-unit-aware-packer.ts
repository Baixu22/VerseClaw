/** Deterministic, atomic context-unit packer for Stage 5. */

export type Stage5UnitKind = "text" | "tool_schema" | "multimodal" | "output_reserve";
export type Stage5UnitPriority = "critical" | "constraint" | "evidence" | "high" | "normal" | "optional";

export type Stage5ContextUnit = {
  id: string;
  kind: Exclude<Stage5UnitKind, "output_reserve">;
  priority: Stage5UnitPriority;
  tokenCount: number;
  sourceRef: string;
};

export type Stage5PackReason =
  | "selected"
  | "output-reserve"
  | "critical-over-window"
  | "constraint-over-window"
  | "evidence-over-window"
  | "budget-drop";

export type Stage5PackDecision = {
  unitId: string;
  decision: "selected" | "omitted";
  reason: Stage5PackReason;
  tokenCount: number;
};

export type Stage5PackResult = {
  status: "ok" | "degraded" | "failed";
  budgetTokens: number;
  outputReserveTokens: number;
  usedTokens: number;
  decisions: readonly Stage5PackDecision[];
  selected: readonly Stage5ContextUnit[];
  omitted: readonly Stage5ContextUnit[];
  reasons: readonly string[];
};

const PRIORITY_ORDER: Record<Stage5UnitPriority, number> = {
  critical: 0,
  constraint: 1,
  evidence: 2,
  high: 3,
  normal: 4,
  optional: 5,
};

const MAX_ID_LENGTH = 256;
const MAX_REFERENCE_LENGTH = 512;
const MAX_TOKEN_COUNT = Number.MAX_SAFE_INTEGER;

// Same boundaries as the Stage 0 id/reference schemas: no leading separators,
// no whitespace/newline/wildcards, bounded length.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@%+_-]*$/;

const UNIT_KIND_VALUES = new Set<Stage5ContextUnit["kind"]>(["text", "tool_schema", "multimodal"]);
const PRIORITY_VALUES = new Set<Stage5UnitPriority>([
  "critical",
  "constraint",
  "evidence",
  "high",
  "normal",
  "optional",
]);

function fail(reason: string): never {
  throw new Error(reason);
}

function validateTokenCount(field: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOKEN_COUNT) {
    fail(`invalid-${field}`);
  }
  return value;
}

function validateUnitId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH || !ID_RE.test(value)) {
    fail("invalid-unit-id");
  }
  return value;
}

function validateSourceRef(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_REFERENCE_LENGTH ||
    !REFERENCE_RE.test(value)
  ) {
    fail("invalid-unit-source-ref");
  }
  return value;
}

function normalizeUnit(unit: Stage5ContextUnit): Stage5ContextUnit {
  if (!unit || typeof unit !== "object" || Array.isArray(unit)) fail("invalid-unit");
  if (!UNIT_KIND_VALUES.has(unit.kind)) fail("invalid-unit-kind");
  if (!PRIORITY_VALUES.has(unit.priority)) fail("invalid-unit-priority");
  return {
    id: validateUnitId(unit.id),
    kind: unit.kind,
    priority: unit.priority,
    tokenCount: validateTokenCount("token-count", unit.tokenCount),
    sourceRef: validateSourceRef(unit.sourceRef),
  };
}

function overflowReason(priority: Stage5UnitPriority): Stage5PackReason | undefined {
  if (priority === "critical") return "critical-over-window";
  if (priority === "constraint") return "constraint-over-window";
  if (priority === "evidence") return "evidence-over-window";
  return undefined;
}

export function packStage5ContextUnits(params: {
  budgetTokens: number;
  outputReserveTokens: number;
  units: readonly Stage5ContextUnit[];
}): Stage5PackResult {
  const budgetTokens = validateTokenCount("budget-tokens", params.budgetTokens);
  const outputReserveTokens = validateTokenCount("output-reserve-tokens", params.outputReserveTokens);
  if (!Array.isArray(params.units)) fail("invalid-units");
  const units = params.units.map(normalizeUnit);
  const seenIds = new Set<string>();
  for (const unit of units) {
    if (seenIds.has(unit.id)) fail(`duplicate-unit-id:${unit.id}`);
    seenIds.add(unit.id);
  }
  if (outputReserveTokens > budgetTokens) {
    return {
      status: "failed",
      budgetTokens,
      outputReserveTokens,
      usedTokens: 0,
      decisions: [],
      selected: [],
      omitted: units,
      reasons: ["output-reserve-exceeds-budget"],
    };
  }

  const availableTokens = budgetTokens - outputReserveTokens;
  const orderedUnits = units.toSorted((left, right) => {
    const priority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    return priority || left.id.localeCompare(right.id);
  });
  const selected: Stage5ContextUnit[] = [];
  const omitted: Stage5ContextUnit[] = [];
  const decisions: Stage5PackDecision[] = [];
  const reasons: string[] = [];
  let usedTokens = 0;
  let failed = false;

  for (const unit of orderedUnits) {
    const fits = usedTokens + unit.tokenCount <= availableTokens;
    if (fits) {
      selected.push(unit);
      usedTokens += unit.tokenCount;
      decisions.push({ unitId: unit.id, decision: "selected", reason: "selected", tokenCount: unit.tokenCount });
      continue;
    }
    omitted.push(unit);
    const requiredReason = overflowReason(unit.priority);
    const reason = requiredReason ?? "budget-drop";
    decisions.push({ unitId: unit.id, decision: "omitted", reason, tokenCount: unit.tokenCount });
    if (requiredReason) {
      failed = true;
      reasons.push(`${reason}:${unit.id}`);
    }
  }

  if (outputReserveTokens > 0) reasons.push(`output-reserve:${outputReserveTokens}`);
  return {
    status: failed ? "failed" : omitted.length > 0 ? "degraded" : "ok",
    budgetTokens,
    outputReserveTokens,
    usedTokens,
    decisions,
    selected,
    omitted,
    reasons,
  };
}
