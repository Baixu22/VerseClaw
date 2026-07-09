import {
  validateRoleContract,
  type RoleContract,
  type RoleContractValidationIssue,
  type RoleContractValidationResult,
} from "./role-contract.js";

export type AgencyDraftStatus = "draft" | "reviewed" | "active";

export type AgencyDraftRoleEntry = {
  id: string;
  status: AgencyDraftStatus;
  source: "agency";
  sourceDivision?: string;
  sourceAgentName: string;
  roleName: string;
  displayName: string;
  description?: string;
  capabilityHints: string[];
  toolHints: string[];
  handoffHints: string[];
  roleCandidate?: RoleContract;
  validationIssues: RoleContractValidationIssue[];
};

export function canSpawnAgencyDraft(_entry: AgencyDraftRoleEntry): false {
  return false;
}

export function validateAgencyDraftPromotion(entry: AgencyDraftRoleEntry): RoleContractValidationResult {
  if (!entry.roleCandidate) {
    return {
      ok: false,
      issues: [{ path: "roleCandidate", message: "A RoleContract candidate is required before activation." }],
    };
  }
  return validateRoleContract(entry.roleCandidate);
}

export type AgencyDraftPromotionReviewInput = {
  reviewer: string;
  reviewedAt: string;
};

export type AgencyDraftPromotionReview = {
  draftId: string;
  reviewer: string;
  reviewedAt: string;
  approvedForRuntime: false;
  validation: RoleContractValidationResult;
};

export function reviewAgencyDraftPromotion(
  entry: AgencyDraftRoleEntry,
  input: AgencyDraftPromotionReviewInput,
): AgencyDraftPromotionReview {
  return {
    draftId: entry.id,
    reviewer: input.reviewer,
    reviewedAt: input.reviewedAt,
    approvedForRuntime: false,
    validation: validateAgencyDraftPromotion(entry),
  };
}
