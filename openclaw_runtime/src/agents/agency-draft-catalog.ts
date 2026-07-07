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
