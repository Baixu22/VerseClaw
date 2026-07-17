/**
 * SEKB confirm provenance + integrity policy (P3-002 / F-DATA-002, F-DATA-004).
 *
 * Confirmed knowledge must carry session lineage, source system, integrity level,
 * and a revoke key. Summary text alone never elevates integrity to high_trust.
 * Unknown sources cannot enter high-trust context.
 */
export type ConfirmSourceSystem = "sekb" | "ui-confirm" | "batch-distiller" | "unknown";

export type ConfirmIntegrityLevel = "advisory" | "confirmed" | "high_trust";

export type ConfirmProvenance = {
  schema: "sekb-confirm-provenance.v1";
  sessionId: string;
  sourceSystem: ConfirmSourceSystem;
  sourceTrajectoryIds: string[];
  integrity: ConfirmIntegrityLevel;
  confirmedAt: string;
  revokeKey: string;
  taskId: "P3-002";
  findingIds: Array<"F-DATA-002" | "F-DATA-004">;
  summaryOnlyClaimDowngraded: boolean;
  highTrustEligible: boolean;
};

export type ConfirmProvenanceErrorCode =
  | "missing_session"
  | "missing_suggestion"
  | "unknown_source_high_trust"
  | "summary_integrity_claim";

export class ConfirmProvenanceError extends Error {
  readonly code: ConfirmProvenanceErrorCode;

  constructor(code: ConfirmProvenanceErrorCode, message: string) {
    super(message);
    this.name = "ConfirmProvenanceError";
    this.code = code;
  }
}

export function normalizeConfirmSourceSystem(value: unknown): ConfirmSourceSystem {
  if (value === "sekb" || value === "ui-confirm" || value === "batch-distiller") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "sekb") return "sekb";
    if (normalized === "ui" || normalized === "ui-confirm" || normalized === "human") {
      return "ui-confirm";
    }
    if (normalized === "batch" || normalized === "batch-distiller") {
      return "batch-distiller";
    }
  }
  return "unknown";
}

export function normalizeConfirmIntegrityClaim(
  value: unknown,
): ConfirmIntegrityLevel | undefined {
  if (value === "advisory" || value === "confirmed" || value === "high_trust") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/-/g, "_");
    if (normalized === "advisory") return "advisory";
    if (normalized === "confirmed") return "confirmed";
    if (normalized === "high_trust" || normalized === "hightrust") return "high_trust";
  }
  return undefined;
}

export function assertConfirmSession(
  sessionId: unknown,
  options: { requireSession?: boolean } = {},
): string | undefined {
  const requireSession = options.requireSession !== false;
  const normalized = typeof sessionId === "string" ? sessionId.trim() : "";
  if (normalized) return normalized;
  if (requireSession) {
    throw new ConfirmProvenanceError(
      "missing_session",
      "SEKB confirm requires sessionId for provenance/session lineage (P3-002).",
    );
  }
  return undefined;
}

/**
 * Resolve effective integrity for a confirm write.
 * A2: summary-only claims cannot auto-elevate to high_trust.
 * A3: unknown sources cannot reach high_trust.
 */
export function resolveConfirmIntegrity(input: {
  claimed?: ConfirmIntegrityLevel | string | null;
  sourceSystem: ConfirmSourceSystem;
  sessionId?: string | null;
  sourceTrajectoryIds?: string[] | null;
  /** When true, client attempted to elevate integrity from summary text alone. */
  summaryOnly?: boolean;
}): {
  integrity: ConfirmIntegrityLevel;
  reasons: string[];
  summaryOnlyClaimDowngraded: boolean;
  highTrustEligible: boolean;
} {
  const reasons: string[] = [];
  const claimed = normalizeConfirmIntegrityClaim(input.claimed) ?? "confirmed";
  const hasSession = Boolean(input.sessionId?.trim());
  const trajectories = (input.sourceTrajectoryIds ?? []).filter(
    (id) => typeof id === "string" && id.trim(),
  );
  const knownSource = input.sourceSystem !== "unknown";
  const highTrustEligible =
    hasSession && knownSource && trajectories.length > 0 && input.summaryOnly !== true;

  let integrity: ConfirmIntegrityLevel = claimed;
  let summaryOnlyClaimDowngraded = false;

  if (!hasSession) {
    integrity = "advisory";
    reasons.push("missing_session_downgraded_to_advisory");
  }

  if (!knownSource) {
    if (integrity === "high_trust" || integrity === "confirmed") {
      integrity = "advisory";
      reasons.push("unknown_source_capped_to_advisory");
    }
  }

  if (input.summaryOnly === true && claimed === "high_trust") {
    integrity = hasSession && knownSource ? "confirmed" : "advisory";
    summaryOnlyClaimDowngraded = true;
    reasons.push("summary_only_cannot_elevate_high_trust");
  }

  if (integrity === "high_trust" && !highTrustEligible) {
    integrity = hasSession && knownSource ? "confirmed" : "advisory";
    reasons.push("high_trust_requirements_unmet");
  }

  if (integrity === "high_trust" && !knownSource) {
    throw new ConfirmProvenanceError(
      "unknown_source_high_trust",
      "Unknown-source content cannot enter high-trust context (P3-002 / F-DATA-002).",
    );
  }

  return {
    integrity,
    reasons,
    summaryOnlyClaimDowngraded,
    highTrustEligible,
  };
}

export function buildConfirmProvenance(input: {
  sessionId: string;
  sourceSystem: ConfirmSourceSystem;
  sourceTrajectoryIds: string[];
  integrity: ConfirmIntegrityLevel;
  confirmedAt: string;
  principleId: string;
  summaryOnlyClaimDowngraded: boolean;
  highTrustEligible: boolean;
}): ConfirmProvenance {
  return {
    schema: "sekb-confirm-provenance.v1",
    sessionId: input.sessionId,
    sourceSystem: input.sourceSystem,
    sourceTrajectoryIds: [...input.sourceTrajectoryIds],
    integrity: input.integrity,
    confirmedAt: input.confirmedAt,
    revokeKey: `revoke:sekb-principle:${input.principleId}`,
    taskId: "P3-002",
    findingIds: ["F-DATA-002", "F-DATA-004"],
    summaryOnlyClaimDowngraded: input.summaryOnlyClaimDowngraded,
    highTrustEligible: input.highTrustEligible,
  };
}

export function canEnterHighTrustContext(
  provenance: Pick<ConfirmProvenance, "integrity" | "sourceSystem" | "sessionId" | "sourceTrajectoryIds">,
): boolean {
  return (
    provenance.integrity === "high_trust" &&
    provenance.sourceSystem !== "unknown" &&
    Boolean(provenance.sessionId?.trim()) &&
    (provenance.sourceTrajectoryIds?.length ?? 0) > 0
  );
}
