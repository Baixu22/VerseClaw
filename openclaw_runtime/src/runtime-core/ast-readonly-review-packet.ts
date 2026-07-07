import {
  generateAstGrepEditPlanReadonlyCandidates,
  type AstGrepEditPlanAdapterResult,
  type AstGrepEditPlanRule,
  type AstGrepEditPlanTargetFile,
} from "./ast-grep-edit-plan-adapter.js";
import type { EditPlanOperation } from "./ast-edit-plan.js";

export type AstReadonlyReviewPacketScenarioId =
  | "api_rename"
  | "import_rewrite"
  | "deprecated_option_removal"
  | "react_prop_rename"
  | "ipc_host_api_route_rename";

export type AstReadonlyReviewPacketStatus =
  | "ready_for_internal_review"
  | "held_for_contract_review"
  | "review_required"
  | "invalid";

export type AstReadonlyReviewPacketInput = {
  scenarioId: AstReadonlyReviewPacketScenarioId;
  rule: AstGrepEditPlanRule | unknown;
  targetFiles: readonly AstGrepEditPlanTargetFile[];
  maxMatchesPerBatch?: number;
  maxPreviewDiffBytes?: number;
  semanticContext?: {
    routeContractOwnerEvidence?: boolean;
  };
};

export type AstReadonlyReviewPacket = {
  schemaVersion: 1;
  source: "runtime.ast_readonly_review_packet";
  status: AstReadonlyReviewPacketStatus;
  scenarioId: AstReadonlyReviewPacketScenarioId;
  positioning: {
    explicitInvocationOnly: true;
    internalReviewOnly: true;
    readonly: true;
    planningOnly: true;
    noPatchApply: true;
    noWorkspaceMutation: true;
    noSymbolMutation: true;
    noTaskLoopInvocation: true;
    noGatewayIntegration: true;
    noProviderTransportChange: true;
    noPromptOrModelMessageInsertion: true;
    noPersistence: true;
    noDefaultOnBehavior: true;
    notRuntimeDecisionInput: true;
  };
  semanticPrecheck: {
    status: "satisfied" | "contract_review_required";
    reasons: string[];
  };
  evidenceQuality: {
    explicitTargetCoverageRate: number;
    batchCompletenessRate: number;
    failClosed: boolean;
    authorityClean: boolean;
    reviewPacketComplete: boolean;
  };
  batchCount: number;
  targetFileCount: number;
  candidateOperationCount: number;
  candidateOperations: EditPlanOperation[];
  diagnostics: string[];
  failureResponse: {
    trigger: string;
    response: string;
    fallback: string;
  };
  allowedNextStep:
    | "human_review_packet"
    | "contract_owner_review"
    | "narrow_rule_or_targets"
    | "fix_rule_or_input";
};

const POSITIONING = {
  explicitInvocationOnly: true,
  internalReviewOnly: true,
  readonly: true,
  planningOnly: true,
  noPatchApply: true,
  noWorkspaceMutation: true,
  noSymbolMutation: true,
  noTaskLoopInvocation: true,
  noGatewayIntegration: true,
  noProviderTransportChange: true,
  noPromptOrModelMessageInsertion: true,
  noPersistence: true,
  noDefaultOnBehavior: true,
  notRuntimeDecisionInput: true,
} as const;

export function buildAstReadonlyReviewPacket(
  input: AstReadonlyReviewPacketInput,
): AstReadonlyReviewPacket {
  const batchSize = normalizeLimit(input.maxMatchesPerBatch, 8);
  const batches = chunk(input.targetFiles, batchSize);
  const results = batches.length === 0
    ? [
        generateAstGrepEditPlanReadonlyCandidates({
          rule: input.rule,
          targetFiles: input.targetFiles,
          maxMatches: batchSize,
          maxPreviewDiffBytes: input.maxPreviewDiffBytes,
        }),
      ]
    : batches.map((targetFiles) =>
        generateAstGrepEditPlanReadonlyCandidates({
          rule: input.rule,
          targetFiles,
          maxMatches: batchSize,
          maxPreviewDiffBytes: input.maxPreviewDiffBytes,
        })
      );
  const semanticPrecheck = semanticPrecheckFor(input);
  const candidateOperations = results.flatMap((result) => result.editPlan.orderedOperations);
  const diagnostics = [...new Set(results.flatMap((result) => result.diagnostics.map((item) => item.code)))];
  const allAuthorityClean = results.every((result) => authorityClean(result));
  const invalid = results.some((result) => result.status === "invalid_rule" || result.status === "invalid_input");
  const reviewRequired = results.some((result) => result.status === "review_required" || result.status === "scan_failed");
  const held = semanticPrecheck.status === "contract_review_required";
  const status: AstReadonlyReviewPacketStatus = invalid
    ? "invalid"
    : held
      ? "held_for_contract_review"
      : reviewRequired
        ? "review_required"
        : "ready_for_internal_review";
  const failClosed = invalid && candidateOperations.length === 0;
  const reviewPacketComplete = status === "ready_for_internal_review" &&
    candidateOperations.length > 0 &&
    allAuthorityClean;

  return {
    schemaVersion: 1,
    source: "runtime.ast_readonly_review_packet",
    status,
    scenarioId: input.scenarioId,
    positioning: POSITIONING,
    semanticPrecheck,
    evidenceQuality: {
      explicitTargetCoverageRate: input.targetFiles.length > 0 ? 1 : 0,
      batchCompletenessRate: status === "review_required" ? 0 : 1,
      failClosed,
      authorityClean: allAuthorityClean,
      reviewPacketComplete,
    },
    batchCount: results.length,
    targetFileCount: input.targetFiles.length,
    candidateOperationCount: candidateOperations.length,
    candidateOperations,
    diagnostics,
    failureResponse: failureResponseFor(status, semanticPrecheck.status),
    allowedNextStep: allowedNextStepFor(status),
  };
}

function semanticPrecheckFor(input: AstReadonlyReviewPacketInput): AstReadonlyReviewPacket["semanticPrecheck"] {
  if (
    input.scenarioId === "ipc_host_api_route_rename" &&
    input.semanticContext?.routeContractOwnerEvidence !== true
  ) {
    return {
      status: "contract_review_required",
      reasons: ["route_literal_detected", "contract_owner_evidence_required"],
    };
  }
  return {
    status: "satisfied",
    reasons: ["explicit_target_scope", `${input.scenarioId}_shape_detected`],
  };
}

function failureResponseFor(
  status: AstReadonlyReviewPacketStatus,
  semanticStatus: AstReadonlyReviewPacket["semanticPrecheck"]["status"],
): AstReadonlyReviewPacket["failureResponse"] {
  if (status === "invalid") {
    return {
      trigger: "invalid_rule_or_input",
      response: "Return zero candidate operations and keep the packet in invalid state.",
      fallback: "Fix the rule or explicit target list, then rebuild the readonly packet.",
    };
  }
  if (semanticStatus === "contract_review_required") {
    return {
      trigger: "route_contract_gap",
      response: "Hold the packet for contract owner review.",
      fallback: "Provide route ownership evidence before reconsidering the scenario.",
    };
  }
  if (status === "review_required") {
    return {
      trigger: "budget_or_conflict_pressure",
      response: "Keep bounded evidence and require narrower targets or rule constraints.",
      fallback: "Split inputs further or reduce rule scope before rebuilding the packet.",
    };
  }
  return {
    trigger: "none",
    response: "Packet is ready for internal human review.",
    fallback: "Discard the packet after review; do not execute it automatically.",
  };
}

function allowedNextStepFor(status: AstReadonlyReviewPacketStatus): AstReadonlyReviewPacket["allowedNextStep"] {
  switch (status) {
    case "ready_for_internal_review":
      return "human_review_packet";
    case "held_for_contract_review":
      return "contract_owner_review";
    case "review_required":
      return "narrow_rule_or_targets";
    case "invalid":
      return "fix_rule_or_input";
  }
}

function authorityClean(result: AstGrepEditPlanAdapterResult): boolean {
  const authority = result.editPlan.authority;
  return authority.readonly === true &&
    authority.planningOnly === true &&
    authority.noPatchApply === true &&
    authority.noWorkspaceMutation === true &&
    authority.noSymbolMutation === true &&
    authority.noTaskLoopInvocation === true &&
    authority.noGatewayIntegration === true &&
    authority.noProviderTransportChange === true &&
    authority.noPromptOrModelMessageInsertion === true &&
    authority.noPersistence === true &&
    authority.noDefaultOnBehavior === true &&
    authority.editPlanIsNotTaskCompletionEvidence === true;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback;
}
