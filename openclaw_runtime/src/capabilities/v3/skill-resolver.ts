import {
  hashCapabilityMetadata,
  type CapabilityDescriptor,
} from "./capability-descriptor.js";
import {
  buildCapabilityShadowCatalog,
  type CapabilityShadowCatalogSnapshot,
} from "./shadow-catalog.js";

export const CAPABILITY_SKILL_RESOLVER_SCHEMA_VERSION =
  "capability-skill-resolver/v1" as const;

export type CapabilitySkillResolverBudget = {
  /** Character size of the caller's complete context window. */
  contextWindowCharacters: number;
  /** Portion of that window reserved for L0 catalog navigation. */
  l0ContextWindowShare: number;
  /** Maximum number of whole category entries emitted at L0. */
  l0MaxEntries: number;
  /** Explicit structural cap for aggregated trigger keywords in one L0 entry. */
  l0MaxTriggerKeywordsPerEntry: number;
};

export type CapabilitySkillDirectProjectionPolicy = {
  /** The caller has established that this catalog is sufficiently stable. */
  stable: boolean;
  /** Calibrated maximum number of Skill candidates for direct projection. */
  maxCandidates: number;
  /** Calibrated maximum character count for complete candidate metadata. */
  maxCharacters: number;
};

export type CapabilitySkillResolverInput = {
  /** V3-02 is inert unless an explicit caller enables this pure projection. */
  enabled?: boolean;
  /** Caller-owned V3 shadow snapshot. The resolver does not retain or publish it. */
  catalog: CapabilityShadowCatalogSnapshot;
  budget: CapabilitySkillResolverBudget;
  /** Omit to require hierarchical discovery even for a small catalog. */
  directProjection?: CapabilitySkillDirectProjectionPolicy;
};

export type CapabilitySkillResolverDiagnosticCode =
  | "invalid-budget"
  | "invalid-direct-projection-policy"
  | "l0-entry-cap-reached"
  | "l0-character-budget-reached";

export type CapabilitySkillResolverDiagnostic = {
  code: CapabilitySkillResolverDiagnosticCode;
  severity: "info" | "error";
  message: string;
};

export type CapabilitySkillCandidate = {
  capabilityId: string;
  category: string;
  workflowNamespace: string;
  title: string;
  description: string;
  triggerKeywords: string[];
  revision: string;
  manifestHash: string;
  source: {
    owner: string;
    type: string;
    provenance: string;
  };
  dependsOn?: string[];
  permissions?: string[];
};

export type CapabilitySkillCategory = {
  category: string;
  triggerKeywords: string[];
  workflowNamespaceCount: number;
  candidateCount: number;
};

export type CapabilitySkillNamespace = {
  category: string;
  workflowNamespace: string;
  triggerKeywords: string[];
  candidateCount: number;
};

export type CapabilitySkillL0Projection = {
  characterBudget: number;
  characterCount: number;
  entryCap: number;
  entries: CapabilitySkillCategory[];
  omittedCategoryCount: number;
};

export type CapabilitySkillResolverReadyResult = {
  enabled: true;
  mode: "hierarchical" | "direct-projection";
  schemaVersion: typeof CAPABILITY_SKILL_RESOLVER_SCHEMA_VERSION;
  catalogSnapshotHash: string;
  resolverHash: string;
  l0: CapabilitySkillL0Projection;
  namespaces: CapabilitySkillNamespace[];
  candidates: CapabilitySkillCandidate[];
  directProjectionCharacterCount: number;
  diagnostics: CapabilitySkillResolverDiagnostic[];
};

export type CapabilitySkillResolverDisabledResult = {
  enabled: false;
  mode: "disabled";
  diagnostics: [];
};

export type CapabilitySkillResolverInvalidResult = {
  enabled: true;
  mode: "invalid";
  diagnostics: CapabilitySkillResolverDiagnostic[];
};

export type CapabilitySkillResolverResult =
  | CapabilitySkillResolverReadyResult
  | CapabilitySkillResolverDisabledResult
  | CapabilitySkillResolverInvalidResult;

export type CapabilitySkillSearchResult = {
  categories: CapabilitySkillCategory[];
  namespaces: CapabilitySkillNamespace[];
  candidates: CapabilitySkillCandidate[];
};

type KeywordFrequency = {
  keyword: string;
  count: number;
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCandidates(left: CapabilitySkillCandidate, right: CapabilitySkillCandidate): number {
  return (
    compareStrings(left.category, right.category) ||
    compareStrings(left.workflowNamespace, right.workflowNamespace) ||
    compareStrings(left.capabilityId, right.capabilityId)
  );
}

function asCandidate(descriptor: CapabilityDescriptor): CapabilitySkillCandidate {
  return {
    capabilityId: descriptor.capabilityId,
    category: descriptor.category,
    workflowNamespace: descriptor.workflowNamespace,
    title: descriptor.title,
    description: descriptor.description,
    triggerKeywords: [...descriptor.triggerKeywords],
    revision: descriptor.revision,
    manifestHash: descriptor.manifestHash,
    source: { ...descriptor.source },
    ...(descriptor.dependsOn ? { dependsOn: [...descriptor.dependsOn] } : {}),
    ...(descriptor.permissions ? { permissions: [...descriptor.permissions] } : {}),
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateBudget(
  budget: CapabilitySkillResolverBudget | undefined,
): CapabilitySkillResolverDiagnostic[] {
  if (!budget) {
    return [
      {
        code: "invalid-budget",
        severity: "error",
        message: "a Skill resolver budget is required when resolution is enabled",
      },
    ];
  }
  const valid =
    isNonNegativeInteger(budget.contextWindowCharacters) &&
    typeof budget.l0ContextWindowShare === "number" &&
    Number.isFinite(budget.l0ContextWindowShare) &&
    budget.l0ContextWindowShare > 0 &&
    budget.l0ContextWindowShare <= 1 &&
    isNonNegativeInteger(budget.l0MaxEntries) &&
    isPositiveInteger(budget.l0MaxTriggerKeywordsPerEntry);
  return valid
    ? []
    : [
        {
          code: "invalid-budget",
          severity: "error",
          message:
            "budget requires non-negative integer character and entry caps, a share in (0, 1], and a positive keyword cap",
        },
      ];
}

function validateDirectProjectionPolicy(
  policy: CapabilitySkillDirectProjectionPolicy | undefined,
): CapabilitySkillResolverDiagnostic[] {
  if (!policy) {
    return [];
  }
  return typeof policy.stable === "boolean" &&
    isNonNegativeInteger(policy.maxCandidates) &&
    isNonNegativeInteger(policy.maxCharacters)
    ? []
    : [
        {
          code: "invalid-direct-projection-policy",
          severity: "error",
          message:
            "direct projection requires a stability decision and non-negative calibrated candidate and character caps",
        },
      ];
}

function collectKeywords(
  candidates: readonly CapabilitySkillCandidate[],
  maxKeywords: number,
): string[] {
  const frequencies = new Map<string, number>();
  for (const candidate of candidates) {
    for (const keyword of candidate.triggerKeywords) {
      frequencies.set(keyword, (frequencies.get(keyword) ?? 0) + 1);
    }
  }
  return [...frequencies.entries()]
    .map(([keyword, count]): KeywordFrequency => ({ keyword, count }))
    .toSorted((left, right) => right.count - left.count || compareStrings(left.keyword, right.keyword))
    .slice(0, maxKeywords)
    .map((entry) => entry.keyword);
}

function buildNamespaces(candidates: readonly CapabilitySkillCandidate[]): CapabilitySkillNamespace[] {
  const groups = new Map<string, CapabilitySkillCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.workflowNamespace) ?? [];
    group.push(candidate);
    groups.set(candidate.workflowNamespace, group);
  }
  return [...groups.entries()]
    .map(([workflowNamespace, group]) => ({
      category: group[0]?.category ?? "",
      workflowNamespace,
      triggerKeywords: collectKeywords(group, Number.MAX_SAFE_INTEGER),
      candidateCount: group.length,
    }))
    .toSorted(
      (left, right) =>
        compareStrings(left.category, right.category) ||
        compareStrings(left.workflowNamespace, right.workflowNamespace),
    );
}

function buildCategories(
  candidates: readonly CapabilitySkillCandidate[],
  maxKeywords: number,
): CapabilitySkillCategory[] {
  const groups = new Map<string, CapabilitySkillCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.category) ?? [];
    group.push(candidate);
    groups.set(candidate.category, group);
  }
  return [...groups.entries()]
    .map(([category, group]) => ({
      category,
      triggerKeywords: collectKeywords(group, maxKeywords),
      workflowNamespaceCount: new Set(group.map((candidate) => candidate.workflowNamespace)).size,
      candidateCount: group.length,
    }))
    .toSorted((left, right) => compareStrings(left.category, right.category));
}

function serializedLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function buildL0Projection(
  categories: readonly CapabilitySkillCategory[],
  budget: CapabilitySkillResolverBudget,
): { projection: CapabilitySkillL0Projection; diagnostics: CapabilitySkillResolverDiagnostic[] } {
  const characterBudget = Math.floor(budget.contextWindowCharacters * budget.l0ContextWindowShare);
  const entries: CapabilitySkillCategory[] = [];
  const diagnostics: CapabilitySkillResolverDiagnostic[] = [];
  let characterCount = 0;
  let stoppedByEntryCap = false;
  let stoppedByCharacterBudget = false;

  for (const category of categories) {
    if (entries.length >= budget.l0MaxEntries) {
      stoppedByEntryCap = true;
      break;
    }
    const separator = entries.length === 0 ? 0 : 1;
    const candidateLength = serializedLength(category);
    if (characterCount + separator + candidateLength > characterBudget) {
      stoppedByCharacterBudget = true;
      continue;
    }
    entries.push(category);
    characterCount += separator + candidateLength;
  }

  if (stoppedByEntryCap) {
    diagnostics.push({
      code: "l0-entry-cap-reached",
      severity: "info",
      message: "L0 category output reached the caller-provided entry cap",
    });
  }
  if (stoppedByCharacterBudget) {
    diagnostics.push({
      code: "l0-character-budget-reached",
      severity: "info",
      message: "L0 category output omitted whole entries that exceed the caller-provided character budget",
    });
  }
  return {
    projection: {
      characterBudget,
      characterCount,
      entryCap: budget.l0MaxEntries,
      entries,
      omittedCategoryCount: categories.length - entries.length,
    },
    diagnostics,
  };
}

function directProjectionCharacterCount(candidates: readonly CapabilitySkillCandidate[]): number {
  return candidates.map((candidate) => JSON.stringify(candidate)).join("\n").length;
}

function canUseDirectProjection(params: {
  candidates: readonly CapabilitySkillCandidate[];
  characterCount: number;
  sourceDiagnostics: readonly { severity: "warning" | "error" }[];
  policy?: CapabilitySkillDirectProjectionPolicy;
}): boolean {
  const { policy } = params;
  return Boolean(
    policy?.stable &&
      !params.sourceDiagnostics.some((diagnostic) => diagnostic.severity === "error") &&
      params.candidates.length <= policy.maxCandidates &&
      params.characterCount <= policy.maxCharacters,
  );
}

function normalizeSearchTokens(value: string): string[] {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "before",
    "current",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "the",
    "this",
    "to",
    "with",
  ]);
  return (
    value
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.map((token) => (token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token))
      .filter((token) => token.length > 2 && !stopWords.has(token)) ?? []
  );
}

function weightedTokenScore(queryTokens: readonly string[], values: readonly [string, number][]): number {
  let score = 0;
  for (const [value, weight] of values) {
    const available = new Set(normalizeSearchTokens(value));
    score += queryTokens.filter((token) => available.has(token)).length * weight;
  }
  return score;
}

function candidateScore(candidate: CapabilitySkillCandidate, queryTokens: readonly string[]): number {
  return weightedTokenScore(queryTokens, [
    [candidate.title, 8],
    [candidate.triggerKeywords.join(" "), 6],
    [candidate.description, 3],
    [candidate.workflowNamespace.replaceAll(".", " "), 2],
    [candidate.category, 1],
  ]);
}

function rankCandidates(
  candidates: readonly CapabilitySkillCandidate[],
  queryTokens: readonly string[],
): CapabilitySkillCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, score: candidateScore(candidate, queryTokens) }))
    .toSorted(
      (left, right) => right.score - left.score || compareCandidates(left.candidate, right.candidate),
    )
    .map((entry) => entry.candidate);
}

function rankCategories(
  categories: readonly CapabilitySkillCategory[],
  candidates: readonly CapabilitySkillCandidate[],
  queryTokens: readonly string[],
): CapabilitySkillCategory[] {
  const scoreByCategory = new Map<string, number>();
  for (const candidate of candidates) {
    const score = candidateScore(candidate, queryTokens);
    scoreByCategory.set(candidate.category, Math.max(scoreByCategory.get(candidate.category) ?? 0, score));
  }
  return [...categories].toSorted(
    (left, right) =>
      (scoreByCategory.get(right.category) ?? 0) - (scoreByCategory.get(left.category) ?? 0) ||
      compareStrings(left.category, right.category),
  );
}

function rankNamespaces(
  namespaces: readonly CapabilitySkillNamespace[],
  candidates: readonly CapabilitySkillCandidate[],
  queryTokens: readonly string[],
): CapabilitySkillNamespace[] {
  const scoreByNamespace = new Map<string, number>();
  for (const candidate of candidates) {
    const score = candidateScore(candidate, queryTokens);
    scoreByNamespace.set(
      candidate.workflowNamespace,
      Math.max(scoreByNamespace.get(candidate.workflowNamespace) ?? 0, score),
    );
  }
  return [...namespaces].toSorted(
    (left, right) =>
      (scoreByNamespace.get(right.workflowNamespace) ?? 0) -
        (scoreByNamespace.get(left.workflowNamespace) ?? 0) ||
      compareStrings(left.category, right.category) ||
      compareStrings(left.workflowNamespace, right.workflowNamespace),
  );
}

/**
 * Builds a default-disabled, caller-owned Skill discovery projection. It never
 * loads a Skill body or renders a prompt; active routing belongs to a later V3 package.
 */
export function resolveCapabilitySkills(
  input: CapabilitySkillResolverInput,
): CapabilitySkillResolverResult {
  if (input.enabled !== true) {
    return { enabled: false, mode: "disabled", diagnostics: [] };
  }

  const diagnostics = [
    ...validateBudget(input.budget),
    ...validateDirectProjectionPolicy(input.directProjection),
  ];
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { enabled: true, mode: "invalid", diagnostics };
  }

  const catalog = buildCapabilityShadowCatalog(input.catalog.descriptors);
  const candidates = catalog.descriptors
    .filter((descriptor) => descriptor.kind === "skill")
    .map(asCandidate)
    .toSorted(compareCandidates);
  const namespaces = buildNamespaces(candidates);
  const categories = buildCategories(candidates, input.budget.l0MaxTriggerKeywordsPerEntry);
  const l0Result = buildL0Projection(categories, input.budget);
  const directProjectionCharacterCountValue = directProjectionCharacterCount(candidates);
  const mode = canUseDirectProjection({
    candidates,
    characterCount: directProjectionCharacterCountValue,
    sourceDiagnostics: input.catalog.diagnostics,
    policy: input.directProjection,
  })
    ? "direct-projection"
    : "hierarchical";
  const resultDiagnostics = [...diagnostics, ...l0Result.diagnostics];
  const resolverHash = hashCapabilityMetadata({
    schemaVersion: CAPABILITY_SKILL_RESOLVER_SCHEMA_VERSION,
    mode,
    catalogSnapshotHash: catalog.snapshotHash,
    l0: l0Result.projection,
    namespaces,
    candidates,
    directProjectionCharacterCount: directProjectionCharacterCountValue,
    diagnostics: resultDiagnostics,
  });
  return {
    enabled: true,
    mode,
    schemaVersion: CAPABILITY_SKILL_RESOLVER_SCHEMA_VERSION,
    catalogSnapshotHash: catalog.snapshotHash,
    resolverHash,
    l0: l0Result.projection,
    namespaces,
    candidates,
    directProjectionCharacterCount: directProjectionCharacterCountValue,
    diagnostics: resultDiagnostics,
  };
}

/** Ranks existing V3 Skill metadata without loading a Skill body or prompt. */
export function searchCapabilitySkills(
  result: CapabilitySkillResolverReadyResult,
  query: string,
): CapabilitySkillSearchResult {
  const queryTokens = normalizeSearchTokens(query);
  const allCategories = buildCategories(result.candidates, Number.MAX_SAFE_INTEGER);
  return {
    categories: rankCategories(allCategories, result.candidates, queryTokens),
    namespaces: rankNamespaces(result.namespaces, result.candidates, queryTokens),
    candidates: rankCandidates(result.candidates, queryTokens),
  };
}
