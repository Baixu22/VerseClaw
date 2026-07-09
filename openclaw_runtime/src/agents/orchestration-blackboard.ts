export type BlackboardEntryType =
  | "fact"
  | "claim"
  | "question"
  | "risk"
  | "decision"
  | "artifact"
  | "conflict"
  | "handoff"
  | "memory_proposal";

export type BlackboardTrustBoundary =
  | "trusted-system"
  | "role-output"
  | "tool-output"
  | "file-content"
  | "external-content";

export type BlackboardVisibility = "run" | "role" | "verifier" | "public-result";
export type BlackboardStatus = "open" | "resolved" | "superseded" | "rejected" | "needs_review";

export type BlackboardEntry = {
  id: string;
  type: BlackboardEntryType;
  authorRole: string;
  taskId: string;
  content: Record<string, unknown>;
  confidence: number;
  evidenceRefs: string[];
  visibility: BlackboardVisibility;
  status: BlackboardStatus;
  trustBoundary: BlackboardTrustBoundary;
  version: number;
  createdAt: string;
  updatedAt: string;
  supersedes?: string;
  conflictsWith?: string[];
};

export type BlackboardState = {
  entries: BlackboardEntry[];
};

export type BlackboardValidationIssue = {
  path: string;
  message: string;
};

export type BlackboardValidationResult = {
  ok: boolean;
  issues: BlackboardValidationIssue[];
};

const SUPPORTED_ENTRY_TYPES = [
  "fact",
  "claim",
  "question",
  "risk",
  "decision",
  "artifact",
  "conflict",
  "handoff",
  "memory_proposal",
] as const satisfies readonly BlackboardEntryType[];

const SUPPORTED_VISIBILITIES = ["run", "role", "verifier", "public-result"] as const satisfies readonly BlackboardVisibility[];

const SUPPORTED_STATUSES = ["open", "resolved", "superseded", "rejected", "needs_review"] as const satisfies readonly BlackboardStatus[];

const SUPPORTED_TRUST_BOUNDARIES = [
  "trusted-system",
  "role-output",
  "tool-output",
  "file-content",
  "external-content",
] as const satisfies readonly BlackboardTrustBoundary[];

const EVIDENCE_REQUIRED_TYPES = new Set<BlackboardEntryType>([
  "fact",
  "claim",
  "decision",
  "artifact",
  "conflict",
  "handoff",
  "memory_proposal",
]);

const UNSAFE_CONTENT_KEYS = new Set(["tools", "permissions", "prompt", "memoryWrite"]);

function issue(path: string, message: string): BlackboardValidationIssue {
  return { path, message };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return hasText(value) && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectUnsafeContentIssues(value: unknown, path: string, issues: BlackboardValidationIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnsafeContentIssues(item, `${path}.${index}`, issues));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (UNSAFE_CONTENT_KEYS.has(key)) {
      issues.push(issue(childPath, "Blackboard content cannot grant permissions, prompts, tools, or memory writes."));
    }
    collectUnsafeContentIssues(child, childPath, issues);
  }
}

function validateHandoffContent(
  content: Record<string, unknown>,
  knownRoleNames: readonly string[],
  issues: BlackboardValidationIssue[],
): void {
  for (const key of ["fromRole", "toRole", "summary"] as const) {
    if (!hasText(content[key])) {
      issues.push(issue(`content.${key}`, "Blackboard handoff entries require structured fromRole, toRole, and summary fields."));
    }
  }
  for (const key of ["fromRole", "toRole"] as const) {
    if (hasText(content[key]) && !knownRoleNames.includes(content[key])) {
      issues.push(issue(`content.${key}`, "Blackboard handoff role must be a known role."));
    }
  }
}

function isSupportedEntryType(value: unknown): value is BlackboardEntryType {
  return SUPPORTED_ENTRY_TYPES.includes(value as BlackboardEntryType);
}

function isSupportedVisibility(value: unknown): value is BlackboardVisibility {
  return SUPPORTED_VISIBILITIES.includes(value as BlackboardVisibility);
}

function isSupportedStatus(value: unknown): value is BlackboardStatus {
  return SUPPORTED_STATUSES.includes(value as BlackboardStatus);
}

function isSupportedTrustBoundary(value: unknown): value is BlackboardTrustBoundary {
  return SUPPORTED_TRUST_BOUNDARIES.includes(value as BlackboardTrustBoundary);
}

export function validateBlackboardEntry(
  entry: BlackboardEntry,
  knownRoleNames: readonly string[],
): BlackboardValidationResult {
  const issues: BlackboardValidationIssue[] = [];

  if (!hasText(entry.id)) {
    issues.push(issue("id", "Blackboard entry requires a stable id."));
  }
  if (!isSupportedEntryType(entry.type)) {
    issues.push(issue("type", "Blackboard entry type is not supported."));
  }
  if (!knownRoleNames.includes(entry.authorRole)) {
    issues.push(issue("authorRole", "Blackboard entry authorRole must be a known role."));
  }
  if (!hasText(entry.taskId)) {
    issues.push(issue("taskId", "Blackboard entry requires a taskId."));
  }
  if (typeof entry.confidence !== "number" || entry.confidence < 0 || entry.confidence > 1) {
    issues.push(issue("confidence", "Blackboard entry confidence must be between 0 and 1."));
  }
  if (!isSupportedVisibility(entry.visibility)) {
    issues.push(issue("visibility", "Blackboard entry visibility is not supported."));
  }
  if (!isSupportedStatus(entry.status)) {
    issues.push(issue("status", "Blackboard entry status is not supported."));
  }
  if (!isSupportedTrustBoundary(entry.trustBoundary)) {
    issues.push(issue("trustBoundary", "Blackboard entry trust boundary is not supported."));
  }
  if (!Number.isInteger(entry.version) || entry.version < 1) {
    issues.push(issue("version", "Blackboard entry version must be a positive integer."));
  }
  if (!isTimestamp(entry.createdAt)) {
    issues.push(issue("createdAt", "Blackboard entry createdAt must be a valid timestamp."));
  }
  if (!isTimestamp(entry.updatedAt)) {
    issues.push(issue("updatedAt", "Blackboard entry updatedAt must be a valid timestamp."));
  }
  if (!Array.isArray(entry.evidenceRefs)) {
    issues.push(issue("evidenceRefs", "Blackboard entry evidenceRefs must be an array."));
  } else if (isSupportedEntryType(entry.type) && EVIDENCE_REQUIRED_TYPES.has(entry.type) && entry.evidenceRefs.length === 0) {
    issues.push(issue("evidenceRefs", "This blackboard entry type requires at least one evidence ref."));
  }
  if (!isRecord(entry.content)) {
    issues.push(issue("content", "Blackboard entry content must be a structured object."));
  } else {
    if (entry.type === "handoff") {
      validateHandoffContent(entry.content, knownRoleNames, issues);
    }
    collectUnsafeContentIssues(entry.content, "content", issues);
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function normalizeClaimPart(value: unknown): string | undefined {
  return hasText(value) ? value.trim().toLowerCase().replace(/\s+/g, " ") : undefined;
}

function conflictId(left: BlackboardEntry, right: BlackboardEntry): string {
  return `bb_conflict_${left.id}_${right.id}`;
}

function hasConflictForPair(state: BlackboardState, left: BlackboardEntry, right: BlackboardEntry): boolean {
  const expected = [left.id, right.id].sort();
  return state.entries.some((entry) =>
    entry.type === "conflict" &&
    [...(entry.conflictsWith ?? [])].sort().join("\0") === expected.join("\0")
  );
}

export function detectBlackboardConflicts(
  state: BlackboardState,
  knownRoleNames: readonly string[],
  now = new Date().toISOString(),
): { state: BlackboardState; conflicts: BlackboardEntry[]; issues: BlackboardValidationIssue[] } {
  let nextState = state;
  const conflicts: BlackboardEntry[] = [];
  const issues: BlackboardValidationIssue[] = [];
  const claims = state.entries.filter((entry) => entry.type === "claim" && entry.status !== "superseded");

  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const left = claims[leftIndex];
      const right = claims[rightIndex];
      if (!left || !right || hasConflictForPair(nextState, left, right)) {
        continue;
      }
      const leftSubject = normalizeClaimPart(left.content.subject);
      const rightSubject = normalizeClaimPart(right.content.subject);
      const leftConclusion = normalizeClaimPart(left.content.conclusion);
      const rightConclusion = normalizeClaimPart(right.content.conclusion);
      if (!leftSubject || leftSubject !== rightSubject || !leftConclusion || !rightConclusion || leftConclusion === rightConclusion) {
        continue;
      }

      const result = appendBlackboardEntry(
        nextState,
        {
          id: conflictId(left, right),
          type: "conflict",
          authorRole: left.authorRole,
          taskId: right.taskId,
          content: {
            subject: left.content.subject,
            leftConclusion: left.content.conclusion,
            rightConclusion: right.content.conclusion,
          },
          confidence: Math.min(left.confidence, right.confidence),
          evidenceRefs: [...left.evidenceRefs, ...right.evidenceRefs],
          visibility: "verifier",
          status: "open",
          trustBoundary: "role-output",
          conflictsWith: [left.id, right.id],
        },
        knownRoleNames,
        now,
      );
      issues.push(...result.issues);
      if (result.entry) {
        conflicts.push(result.entry);
        nextState = result.state;
      }
    }
  }

  return { state: nextState, conflicts, issues };
}

export function createBlackboardState(): BlackboardState {
  return { entries: [] };
}

type BlackboardAppendInput = Omit<BlackboardEntry, "version" | "createdAt" | "updatedAt">;
type UntrustedBlackboardAppendInput =
  Omit<BlackboardAppendInput, "trustBoundary"> &
  { trustBoundary?: Exclude<BlackboardTrustBoundary, "trusted-system"> | "trusted-system" };

export function appendBlackboardEntry(
  state: BlackboardState,
  entry: BlackboardAppendInput,
  knownRoleNames: readonly string[],
  now = new Date().toISOString(),
): { state: BlackboardState; entry?: BlackboardEntry; issues: BlackboardValidationIssue[] } {
  if (state.entries.some((existing) => existing.id === entry.id)) {
    return {
      state,
      issues: [issue("id", "Blackboard append cannot reuse an existing entry id.")],
    };
  }
  const candidate: BlackboardEntry = {
    ...entry,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const validation = validateBlackboardEntry(candidate, knownRoleNames);
  if (!validation.ok) {
    return {
      state,
      issues: validation.issues,
    };
  }
  return {
    state: { entries: [...state.entries, candidate] },
    entry: candidate,
    issues: [],
  };
}

export function appendUntrustedBlackboardEntry(
  state: BlackboardState,
  entry: UntrustedBlackboardAppendInput,
  knownRoleNames: readonly string[],
  now = new Date().toISOString(),
): { state: BlackboardState; entry?: BlackboardEntry; issues: BlackboardValidationIssue[] } {
  if (entry.trustBoundary === "trusted-system") {
    return {
      state,
      issues: [issue("trustBoundary", "Untrusted blackboard append paths cannot claim trusted-system authority.")],
    };
  }
  return appendBlackboardEntry(
    state,
    {
      ...entry,
      trustBoundary: entry.trustBoundary ?? "role-output",
    },
    knownRoleNames,
    now,
  );
}

type BlackboardUpdatePatch = Partial<Pick<
  BlackboardEntry,
  "content" | "confidence" | "evidenceRefs" | "visibility" | "status"
>>;

function versionRef(entry: Pick<BlackboardEntry, "id" | "version">): string {
  return `${entry.id}@${entry.version}`;
}

export function updateBlackboardEntry(
  state: BlackboardState,
  entryId: string,
  patch: BlackboardUpdatePatch,
  knownRoleNames: readonly string[],
  now = new Date().toISOString(),
): { state: BlackboardState; entry?: BlackboardEntry; issues: BlackboardValidationIssue[] } {
  const current = [...state.entries]
    .reverse()
    .find((entry) => entry.id === entryId && entry.status !== "superseded");
  if (!current) {
    return {
      state,
      issues: [issue("entryId", "Cannot update a blackboard entry that does not exist.")],
    };
  }

  const next: BlackboardEntry = {
    ...current,
    ...patch,
    version: current.version + 1,
    updatedAt: now,
    supersedes: versionRef(current),
  };
  const validation = validateBlackboardEntry(next, knownRoleNames);
  if (!validation.ok) {
    return {
      state,
      issues: validation.issues,
    };
  }

  const supersededCurrent: BlackboardEntry = {
    ...current,
    status: "superseded",
    updatedAt: now,
  };
  const entries = state.entries.map((entry) =>
    entry === current ? supersededCurrent : entry
  );
  return {
    state: { entries: [...entries, next] },
    entry: next,
    issues: [],
  };
}
