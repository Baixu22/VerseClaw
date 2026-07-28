import { createHash } from "node:crypto";

export const VERSESHELL_FOUNDATION_SHADOW_OPS = [
  "file.view",
  "file.read_range",
  "file.hash",
  "repo.search",
  "repo.summary",
  "tx.status",
  "runtime.handshake",
  "ops.list",
  "result.metadata",
] as const;

export type VerseShellFoundationShadowOperation = (typeof VERSESHELL_FOUNDATION_SHADOW_OPS)[number];

export type VerseShellFoundationShadowPlan = {
  operation: string;
  eligible: boolean;
  access: "none" | "read-only";
  reason: string;
  argumentCount: number;
  argumentFingerprint?: string;
};

export type VerseShellFoundationDiagnostic = {
  code: string;
  severity?: "info" | "warning" | "error";
  path?: string;
  /** Deliberately ignored by comparison and evidence. */
  message?: string;
};

export type VerseShellFoundationArtifactMetadata = {
  mediaType?: string;
  sizeBytes?: number;
  sha256?: string;
  expiresAt?: string;
};

export type VerseShellFoundationComparableResult = {
  ok: boolean;
  errorCode?: string;
  paths?: string[];
  data?: unknown;
  diagnostics?: VerseShellFoundationDiagnostic[];
  effects?: string[];
  capabilities?: string[];
  artifacts?: VerseShellFoundationArtifactMetadata[];
  approvalState?: "not-required" | "pending" | "approved" | "denied";
  /** Human prose is never part of the comparison contract. */
  prose?: string;
};

export type VerseShellFoundationShadowMismatch = {
  field: string;
  expectedFingerprint: string;
  actualFingerprint: string;
};

export type VerseShellFoundationShadowEvidence = {
  schemaVersion: 1;
  operation: VerseShellFoundationShadowOperation;
  match: boolean;
  comparedFields: readonly string[];
  mismatches: VerseShellFoundationShadowMismatch[];
  mismatchCount: number;
  truncated: boolean;
  evidenceBytes: number;
};

const SENSITIVE_KEY =
  /(?:arg(?:ument)?s?|content|text|prose|message|stdout|stderr|command|secret|token|password|credential|authorization|cookie|private[-_]?key)/i;
const PATH_KEY = /(?:^|_)(?:path|file|root|cwd|workspace)(?:$|_)/i;
const MAX_FINGERPRINT_DEPTH = 8;
const MAX_FINGERPRINT_KEYS = 128;
const MAX_FINGERPRINT_ARRAY = 128;
const COMPARED_FIELDS = [
  "outcome",
  "paths",
  "data",
  "diagnostics",
  "effects",
  "capabilities",
  "artifacts",
  "approvalState",
] as const;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizePath(value: string): string {
  let normalized = value.trim().replaceAll("\\", "/").replace(/\/+/g, "/");
  normalized = normalized.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function normalizeForFingerprint(value: unknown, depth = 0): unknown {
  if (depth >= MAX_FINGERPRINT_DEPTH) return "[depth-limit]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 512);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_FINGERPRINT_ARRAY)
      .map((entry) => normalizeForFingerprint(entry, depth + 1));
  }
  if (typeof value !== "object") return `[${typeof value}]`;

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort().slice(0, MAX_FINGERPRINT_KEYS)) {
    if (SENSITIVE_KEY.test(key)) {
      normalized[key] = "[redacted]";
      continue;
    }
    const fieldValue = record[key];
    normalized[key] =
      PATH_KEY.test(key) && typeof fieldValue === "string"
        ? `sha256:${fingerprint(normalizePath(fieldValue))}`
        : normalizeForFingerprint(fieldValue, depth + 1);
  }
  return normalized;
}

function sortedUnique(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort();
}

function projection(result: VerseShellFoundationComparableResult): Record<string, unknown> {
  return {
    outcome: result.ok ? { ok: true } : { ok: false, errorCode: result.errorCode ?? "unknown" },
    paths: sortedUnique(result.paths?.map((path) => fingerprint(normalizePath(path)))),
    data: fingerprint(normalizeForFingerprint(result.data)),
    diagnostics: (result.diagnostics ?? [])
      .map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity ?? "error",
        pathFingerprint: diagnostic.path ? fingerprint(normalizePath(diagnostic.path)) : undefined,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    effects: sortedUnique(result.effects),
    capabilities: sortedUnique(result.capabilities),
    artifacts: (result.artifacts ?? [])
      .map((artifact) => ({
        mediaType: artifact.mediaType,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256?.toLowerCase(),
        expiresAt: artifact.expiresAt,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    approvalState: result.approvalState ?? "not-required",
  };
}

export function isVerseShellFoundationShadowOperation(
  operation: string,
): operation is VerseShellFoundationShadowOperation {
  return (VERSESHELL_FOUNDATION_SHADOW_OPS as readonly string[]).includes(operation);
}

/** Plans eligibility only. It never invokes either runtime. */
export function planVerseShellFoundationReadOnlyShadow(input: {
  operation: string;
  args?: unknown;
}): VerseShellFoundationShadowPlan {
  const eligible = isVerseShellFoundationShadowOperation(input.operation);
  const argumentRecord =
    input.args !== null && typeof input.args === "object" && !Array.isArray(input.args)
      ? (input.args as Record<string, unknown>)
      : undefined;
  return {
    operation: input.operation,
    eligible,
    access: eligible ? "read-only" : "none",
    reason: eligible
      ? "operation is on the strict read-only shadow allowlist"
      : "operation is not on the strict read-only shadow allowlist",
    argumentCount: argumentRecord
      ? Object.keys(argumentRecord).length
      : input.args === undefined
        ? 0
        : 1,
    argumentFingerprint:
      input.args === undefined ? undefined : fingerprint(normalizeForFingerprint(input.args)),
  };
}

/**
 * Compares structured semantics only. Prose, raw arguments, content, diagnostics text,
 * stdout/stderr, commands, and secrets are neither compared nor emitted.
 */
export function compareVerseShellFoundationShadow(input: {
  operation: VerseShellFoundationShadowOperation;
  expected: VerseShellFoundationComparableResult;
  actual: VerseShellFoundationComparableResult;
  maxMismatches?: number;
  maxEvidenceBytes?: number;
}): VerseShellFoundationShadowEvidence {
  const expected = projection(input.expected);
  const actual = projection(input.actual);
  const allMismatches = COMPARED_FIELDS.flatMap((field) => {
    if (JSON.stringify(expected[field]) === JSON.stringify(actual[field])) return [];
    return [
      {
        field,
        expectedFingerprint: fingerprint(expected[field]),
        actualFingerprint: fingerprint(actual[field]),
      },
    ];
  });
  const maxMismatches = Math.max(0, Math.min(input.maxMismatches ?? 16, 32));
  const maxEvidenceBytes = Math.max(512, Math.min(input.maxEvidenceBytes ?? 8_192, 16_384));
  let mismatches = allMismatches.slice(0, maxMismatches);
  let truncated = mismatches.length < allMismatches.length;

  const base = {
    schemaVersion: 1 as const,
    operation: input.operation,
    match: allMismatches.length === 0,
    comparedFields: COMPARED_FIELDS,
    mismatchCount: allMismatches.length,
  };
  while (mismatches.length > 0) {
    const candidate = { ...base, mismatches, truncated };
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") <= maxEvidenceBytes) break;
    mismatches = mismatches.slice(0, -1);
    truncated = true;
  }
  const evidenceWithoutBytes = { ...base, mismatches, truncated };
  const evidenceBytes = Buffer.byteLength(JSON.stringify(evidenceWithoutBytes), "utf8");
  return { ...evidenceWithoutBytes, evidenceBytes };
}
