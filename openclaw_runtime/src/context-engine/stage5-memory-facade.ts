/**
 * Stage 5 memory convergence surface.
 *
 * The facade is deliberately a projection boundary: adapters may retrieve or
 * summarize candidates, while only the injected namespace owner may persist.
 * It never decides admission, authorization, or execution outcomes.
 *
 * Every compatibility tool name and every adapter-produced candidate is
 * validated against the frozen Stage 0 id/reference/digest boundaries before
 * it is projected, so unknown tool names or schema-invalid adapter output
 * fail closed with a queryable reason instead of being passed through.
 */

export type MemoryCompatibilityToolName =
  | "memory_search"
  | "memory_get"
  | "memory_query"
  | "context_search"
  | "context_read";

export type MemoryBackend = "semantic-memory" | "block-store" | "adapter";
export type MemorySource = "memory" | "context" | "summary" | "retrieval";

export type MemoryEvidenceRef = {
  ref: string;
  digest: string;
};

export type MemoryCandidate = {
  id: string;
  namespace: string;
  contentRef: string;
  backend: MemoryBackend;
  source: MemorySource;
  freshness: "fresh" | "stale" | "unknown";
  evidence: readonly MemoryEvidenceRef[];
};

export type MemoryQuery = {
  namespace: string;
  query?: string;
  id?: string;
  limit?: number;
};

export type MemoryWriteRequest = {
  namespace: string;
  contentRef: string;
  evidence: readonly MemoryEvidenceRef[];
};

export type SemanticMemoryAdapter = {
  search: (query: MemoryQuery) => readonly MemoryCandidate[];
  get?: (query: MemoryQuery) => MemoryCandidate | undefined;
};

export type SemanticMemoryOwner = {
  /** The sole durable write boundary for one semantic-memory namespace. */
  append: (request: MemoryWriteRequest) => void;
};

export type MemoryFacadeResult = {
  tool: MemoryCompatibilityToolName;
  candidates: readonly MemoryCandidate[];
  authority: "candidate-only";
};

export type SemanticMemoryFacade = {
  search: (tool: MemoryCompatibilityToolName, query: MemoryQuery) => MemoryFacadeResult;
  persist: (request: MemoryWriteRequest) => { ok: true; owner: "semantic-memory" };
};

export const STAGE5_MEMORY_WRITE_BOUNDARY = "semantic-memory-owner:single-writer:v1";

export const STAGE5_MEMORY_TOOL_NAMES: readonly MemoryCompatibilityToolName[] = [
  "memory_search",
  "memory_get",
  "memory_query",
  "context_search",
  "context_read",
] as const;

const MAX_ID_LENGTH = 256;
const MAX_REFERENCE_LENGTH = 512;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 5;

// Same boundaries as the frozen Stage 0 id/reference/digest schemas:
// no leading separators, no whitespace/newline/wildcards, bounded length.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@%+_-]*$/;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

const BACKEND_VALUES = new Set<MemoryBackend>(["semantic-memory", "block-store", "adapter"]);
const SOURCE_VALUES = new Set<MemorySource>(["memory", "context", "summary", "retrieval"]);
const FRESHNESS_VALUES = new Set(["fresh", "stale", "unknown"]);
const TOOL_VALUES = new Set<MemoryCompatibilityToolName>(STAGE5_MEMORY_TOOL_NAMES);

function fail(reason: string): never {
  throw new Error(reason);
}

function validateToolName(value: unknown): MemoryCompatibilityToolName {
  if (typeof value !== "string" || !TOOL_VALUES.has(value as MemoryCompatibilityToolName)) {
    fail("memory-invalid-tool-name");
  }
  return value as MemoryCompatibilityToolName;
}

function validateId(field: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH || !ID_RE.test(value)) {
    fail(`memory-invalid-${field}`);
  }
  return value;
}

function validateReference(field: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REFERENCE_LENGTH || !REFERENCE_RE.test(value)) {
    fail(`memory-invalid-${field}`);
  }
  return value;
}

function validateDigest(value: unknown): string {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    fail("memory-invalid-evidence-digest");
  }
  return value;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1) fail("memory-invalid-limit");
  return Math.min(MAX_LIMIT, limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeNamespace(namespace: string): string {
  if (typeof namespace !== "string" || namespace !== namespace.trim()) fail("memory-invalid-namespace");
  return validateId("namespace", namespace);
}

function normalizeEvidence(entry: MemoryEvidenceRef): MemoryEvidenceRef {
  if (!isRecord(entry)) fail("memory-invalid-evidence");
  return {
    ref: validateReference("evidence-ref", entry.ref),
    digest: validateDigest(entry.digest),
  };
}

function normalizeCandidate(candidate: MemoryCandidate): MemoryCandidate {
  if (!isRecord(candidate)) fail("memory-invalid-candidate");
  if (!Array.isArray(candidate.evidence)) fail("memory-invalid-evidence");
  return {
    id: validateId("candidate-id", candidate.id),
    namespace: normalizeNamespace(candidate.namespace),
    contentRef: validateReference("candidate-content-ref", candidate.contentRef),
    backend: BACKEND_VALUES.has(candidate.backend) ? candidate.backend : fail("memory-invalid-backend"),
    source: SOURCE_VALUES.has(candidate.source) ? candidate.source : fail("memory-invalid-source"),
    freshness: FRESHNESS_VALUES.has(candidate.freshness)
      ? (candidate.freshness as MemoryCandidate["freshness"])
      : fail("memory-invalid-freshness"),
    evidence: candidate.evidence.map(normalizeEvidence),
  };
}

function projectCandidates(
  tool: MemoryCompatibilityToolName,
  query: MemoryQuery,
  candidates: readonly MemoryCandidate[],
): MemoryFacadeResult {
  const namespace = normalizeNamespace(query.namespace);
  const limit = normalizeLimit(query.limit);
  if (query.id !== undefined) validateId("query-id", query.id);
  if (!Array.isArray(candidates)) fail("memory-invalid-candidates");
  const projected = candidates
    .filter((candidate) => {
      if (!isRecord(candidate) || typeof candidate.namespace !== "string") fail("memory-invalid-candidate-namespace");
      return candidate.namespace === namespace;
    })
    .slice(0, limit)
    .map(normalizeCandidate);
  return { tool, candidates: projected, authority: "candidate-only" };
}

export function createSemanticMemoryFacade(params: {
  owner: SemanticMemoryOwner;
  adapter: SemanticMemoryAdapter;
}): SemanticMemoryFacade {
  return {
    search(tool, query) {
      const validatedTool = validateToolName(tool);
      const normalized = {
        ...query,
        namespace: normalizeNamespace(query.namespace),
        limit: normalizeLimit(query.limit),
      };
      if (normalized.id !== undefined) validateId("query-id", normalized.id);
      const candidates =
        validatedTool === "memory_get" && params.adapter.get
          ? (() => {
              const candidate = params.adapter.get(normalized);
              return candidate ? [candidate] : [];
            })()
          : params.adapter.search(normalized);
      return projectCandidates(validatedTool, normalized, candidates);
    },
    persist(request) {
      const normalized = {
        namespace: normalizeNamespace(request.namespace),
        contentRef: validateReference("content-ref", request.contentRef),
        evidence: request.evidence.map(normalizeEvidence),
      };
      params.owner.append(normalized);
      return { ok: true, owner: "semantic-memory" };
    },
  };
}

export function projectStage5FlagOff<T>(legacy: T): T {
  return legacy;
}
