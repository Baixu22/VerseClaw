/**
 * Shared DCS graduation / default-on decision hard-rules helper.
 * Used by C1 canary and reusable for C4/C5/C6/C7 packaging paths.
 *
 * Hard rules:
 * - productApproved !== true - meetsGate = false and recommendation must not be "default-on"
 * - packaging path always defaultsUnchanged = true (never auto-flips runtime defaults)
 * - liveReady is never inferred; caller supplies it explicitly
 */
export type GraduationRecommendation =
  | "keep-off"
  | "opt-in"
  | "consider-default-on"
  | "default-on";

export type GraduationMetrics = Record<string, number | boolean | string | null | undefined>;

export type GraduationDecision = {
  flagId: string;
  completionClass: string;
  metrics: GraduationMetrics;
  meetsGate: boolean;
  recommendation: GraduationRecommendation;
  productApproved: boolean;
  defaultsUnchanged: true;
  killSwitch: string;
  residual: string[];
  howToEnable: string;
  ts: string;
  /** C1 honesty: live A/B readiness (never true unless caller sets it). */
  liveReady: boolean;
  notes?: string[];
};

export type BuildGraduationDecisionInput = {
  flagId: string;
  /** Raw metric gate before product hard-rules (e.g. sim A/B reduction gate). */
  metricsGate: boolean;
  metrics: GraduationMetrics;
  /**
   * Explicit product approval for default-on consideration.
   * Default false - never inferred from metrics.
   */
  productApproved?: boolean;
  /**
   * Desired recommendation when gates + approval are green.
   * Packaging hard-rules may downgrade this.
   */
  desiredRecommendation?: GraduationRecommendation;
  /** Explicit live readiness. Default false. */
  liveReady?: boolean;
  completionClass?: string;
  residual?: string[];
  howToEnable: string;
  killSwitch: string;
  notes?: string[];
  /** ISO timestamp override (tests). */
  ts?: string;
  /**
   * Packaging path must keep defaults unchanged.
   * When true (default), force defaultsUnchanged=true and never emit recommendation=default-on
   * unless productApproved && metricsGate && liveReady (still never auto-applies).
   */
  packagingPath?: boolean;
};

/**
 * Enforce productApproved hard rule on a candidate decision surface.
 * - productApproved !== true - meetsGate=false, recommendation cannot be default-on
 */
export function applyProductApprovalHardRules(params: {
  productApproved: boolean;
  metricsGate: boolean;
  liveReady: boolean;
  desiredRecommendation: GraduationRecommendation;
  packagingPath?: boolean;
}): {
  meetsGate: boolean;
  recommendation: GraduationRecommendation;
  defaultsUnchanged: true;
} {
  const packagingPath = params.packagingPath !== false;
  const productApproved = params.productApproved === true;

  // Packaging path: never claim auto default-on graduation; keep defaults unchanged.
  if (packagingPath) {
    if (!productApproved) {
      return {
        meetsGate: false,
        recommendation:
          params.desiredRecommendation === "default-on"
            ? "keep-off"
            : params.desiredRecommendation === "consider-default-on"
              ? "keep-off"
              : params.desiredRecommendation,
        defaultsUnchanged: true,
      };
    }
    // Approved: may recommend consider-default-on only when metrics+live ready;
    // still never returns default-on from packaging (auto-flip forbidden).
    const green = params.metricsGate && params.liveReady;
    const rec: GraduationRecommendation = green
      ? "consider-default-on"
      : params.desiredRecommendation === "default-on"
        ? "keep-off"
        : params.desiredRecommendation === "consider-default-on"
          ? "opt-in"
          : params.desiredRecommendation;
    return {
      // Packaging never sets meetsGate true for default-on auto-flip.
      meetsGate: false,
      recommendation: rec,
      defaultsUnchanged: true,
    };
  }

  // Non-packaging advisory path (still hard-blocks default-on without approval).
  if (!productApproved) {
    return {
      meetsGate: false,
      recommendation:
        params.desiredRecommendation === "default-on"
          ? "keep-off"
          : params.desiredRecommendation,
      defaultsUnchanged: true,
    };
  }
  const meetsGate = params.metricsGate && params.liveReady && productApproved;
  let recommendation = params.desiredRecommendation;
  if (recommendation === "default-on" && !meetsGate) {
    recommendation = "consider-default-on";
  }
  return {
    meetsGate,
    recommendation,
    defaultsUnchanged: true,
  };
}

/**
 * Build a unified graduation decision package.
 */
export function buildGraduationDecision(
  input: BuildGraduationDecisionInput,
): GraduationDecision {
  const productApproved = input.productApproved === true;
  const liveReady = input.liveReady === true;
  const packagingPath = input.packagingPath !== false;
  const desiredRecommendation = input.desiredRecommendation ?? "keep-off";

  const hard = applyProductApprovalHardRules({
    productApproved,
    metricsGate: input.metricsGate,
    liveReady,
    desiredRecommendation,
    packagingPath,
  });

  const residual = [
    ...(input.residual ?? []),
    ...(liveReady ? [] : ["liveReady=false - not production live A/B"]),
    ...(productApproved
      ? []
      : ["productApproved=false - default-on blocked by hard rule"]),
    packagingPath
      ? "packaging path: defaultsUnchanged=true; no auto default flip"
      : "non-packaging advisory path",
  ];

  return {
    flagId: input.flagId,
    completionClass:
      input.completionClass ??
      (hard.recommendation === "keep-off"
        ? "done (sim+keep-off)"
        : "done (sim+advisory)"),
    metrics: input.metrics,
    meetsGate: hard.meetsGate,
    recommendation: hard.recommendation,
    productApproved,
    defaultsUnchanged: hard.defaultsUnchanged,
    killSwitch: input.killSwitch,
    residual,
    howToEnable: input.howToEnable,
    ts: input.ts ?? new Date().toISOString(),
    liveReady,
    notes: input.notes,
  };
}

/**
 * Assert packaging path invariant: defaultsUnchanged must be true.
 * Throws if violated (function-layer detection for tests / runners).
 */
export function assertPackagingDefaultsUnchanged(
  decision: Pick<GraduationDecision, "defaultsUnchanged">,
): void {
  if (decision.defaultsUnchanged !== true) {
    throw new Error(
      "packaging hard rule violated: defaultsUnchanged must be true on packaging path",
    );
  }
}

/**
 * Assert product-approval hard rules on a decision.
 */
export function assertProductApprovalHardRules(
  decision: Pick<
    GraduationDecision,
    "productApproved" | "meetsGate" | "recommendation"
  >,
): void {
  if (decision.productApproved !== true) {
    if (decision.meetsGate !== false) {
      throw new Error(
        "hard rule violated: productApproved!==true requires meetsGate=false",
      );
    }
    if (decision.recommendation === "default-on") {
      throw new Error(
        "hard rule violated: productApproved!==true forbids recommendation=default-on",
      );
    }
  }
}