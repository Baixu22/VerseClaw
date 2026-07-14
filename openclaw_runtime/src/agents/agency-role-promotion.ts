import { createHash } from "node:crypto";
import {
  normalizeRoleContract,
  validateRoleContract,
  type RoleContract,
  type RoleContractValidationIssue,
} from "./role-contract.js";
import type { AgencyDraftRoleEntry } from "./agency-draft-catalog.js";

export type AgencyEvidenceQualification =
  | "unverified"
  | "scenario-verified"
  | "release-qualified";

export type AgencyToolHintDisposition = {
  hint: string;
  disposition: "mapped" | "waived";
  selectedTools: string[];
  reviewerNote: string;
};

export type AgencyPromotionCandidate = {
  contract: RoleContract;
  toolHintDispositions: AgencyToolHintDisposition[];
  evidenceQualification: AgencyEvidenceQualification;
  evidenceRefs: string[];
};

export type AgencyPromotionValidation = {
  ok: boolean;
  issues: RoleContractValidationIssue[];
  contract: RoleContract;
};

const TOOL_HINT_SUGGESTIONS: Record<string, string[]> = {
  read: ["read"],
  search: ["glob", "grep"],
  grep: ["grep"],
  glob: ["glob"],
  write: ["write", "edit"],
  edit: ["edit"],
  bash: ["bash"],
  shell: ["bash"],
};

const TOOL_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.:-]*$/;

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [normalized];
  });
}

function sourceTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function materializedContract(
  entry: AgencyDraftRoleEntry,
  candidate: AgencyPromotionCandidate,
): RoleContract {
  const normalized = normalizeRoleContract(candidate.contract);
  const selectedTools = uniqueStrings(
    candidate.toolHintDispositions.flatMap((disposition) => (
      disposition.disposition === "mapped" ? disposition.selectedTools : []
    )),
  );
  const sourceTags = [
    "agency-source",
    ...(entry.sourceDivision ? [`agency-source:${sourceTag(entry.sourceDivision)}`] : []),
  ];
  return normalizeRoleContract({
    ...normalized,
    tools: selectedTools,
    tags: uniqueStrings([...(normalized.tags ?? []), ...sourceTags]),
  });
}

export function suggestAgencyToolMappings(
  entry: AgencyDraftRoleEntry,
): Array<{ hint: string; candidateTools: string[] }> {
  return entry.toolHints.map((hint) => ({
    hint,
    candidateTools: [...(TOOL_HINT_SUGGESTIONS[hint.trim().toLowerCase()] ?? [])],
  }));
}

export function validateAgencyPromotionCandidate(
  entry: AgencyDraftRoleEntry,
  candidate: AgencyPromotionCandidate,
): AgencyPromotionValidation {
  const issues: RoleContractValidationIssue[] = [];
  const expectedHints = new Set(entry.toolHints);
  const dispositionsByHint = new Map<string, AgencyToolHintDisposition[]>();

  for (const disposition of candidate.toolHintDispositions) {
    const current = dispositionsByHint.get(disposition.hint) ?? [];
    current.push(disposition);
    dispositionsByHint.set(disposition.hint, current);
    if (!expectedHints.has(disposition.hint)) {
      issues.push({
        path: `toolHintDispositions.${disposition.hint}`,
        message: "Disposition does not match a source tool hint.",
      });
    }
  }

  for (const hint of expectedHints) {
    const matches = dispositionsByHint.get(hint) ?? [];
    if (matches.length !== 1) {
      issues.push({
        path: `toolHintDispositions.${hint}`,
        message: matches.length === 0
          ? "Every source tool hint must be explicitly mapped or waived."
          : "Every source tool hint must have exactly one disposition.",
      });
      continue;
    }
    const disposition = matches[0]!;
    const selectedTools = uniqueStrings(disposition.selectedTools);
    if (disposition.disposition === "mapped") {
      if (selectedTools.length === 0) {
        issues.push({
          path: `toolHintDispositions.${hint}.selectedTools`,
          message: "Mapped hints require at least one selected tool.",
        });
      }
      if (selectedTools.some((tool) => !TOOL_ID_PATTERN.test(tool))) {
        issues.push({
          path: `toolHintDispositions.${hint}.selectedTools`,
          message: "Selected tools must use stable identifiers.",
        });
      }
    } else {
      if (selectedTools.length > 0) {
        issues.push({
          path: `toolHintDispositions.${hint}.selectedTools`,
          message: "Waived hints cannot select tools.",
        });
      }
      if (!disposition.reviewerNote.trim()) {
        issues.push({
          path: `toolHintDispositions.${hint}.reviewerNote`,
          message: "Waived hints require a reviewer reason.",
        });
      }
    }
  }

  if (
    candidate.evidenceQualification !== "unverified"
    && uniqueStrings(candidate.evidenceRefs).length === 0
  ) {
    issues.push({
      path: "evidenceRefs",
      message: "Qualified evidence requires at least one evidence reference.",
    });
  }

  const contract = materializedContract(entry, candidate);
  const contractValidation = validateRoleContract(contract);
  issues.push(...contractValidation.issues.map((issue) => ({
    path: `contract.${issue.path}`,
    message: issue.message,
  })));

  return {
    ok: issues.length === 0,
    issues,
    contract,
  };
}

export function materializeAgencyRoleContract(
  entry: AgencyDraftRoleEntry,
  candidate: AgencyPromotionCandidate,
): RoleContract {
  const validation = validateAgencyPromotionCandidate(entry, candidate);
  if (!validation.ok) {
    throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return validation.contract;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

export function fingerprintRoleContract(contract: RoleContract): string {
  const normalized = normalizeRoleContract(contract);
  return createHash("sha256")
    .update(JSON.stringify(sortJsonValue(normalized)))
    .digest("hex");
}
