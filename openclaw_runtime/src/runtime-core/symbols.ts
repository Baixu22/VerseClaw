import type { EvidenceRef } from "./evidence.js";
import { isNonEmptyString, isRecord, isRuntimeCoreJsonObject } from "./types.js";

export const RUNTIME_SYMBOL_READONLY_OPERATIONS = [
  "overview",
  "find",
  "references",
  "diagnostics",
  "checkpoint",
] as const;

export type RuntimeSymbolReadonlyOperation =
  (typeof RUNTIME_SYMBOL_READONLY_OPERATIONS)[number];

export const RUNTIME_SYMBOL_FALLBACK_REASONS = [
  "lsp_unavailable",
  "capability_unavailable",
  "not_found",
  "ambiguous",
  "invalid_input",
  "checkpoint_drift",
] as const;

export type RuntimeSymbolFallbackReason = (typeof RUNTIME_SYMBOL_FALLBACK_REASONS)[number];

export type RuntimeSymbolPosition = {
  line: number;
  character: number;
};

export type RuntimeSymbolRange = {
  start: RuntimeSymbolPosition;
  end: RuntimeSymbolPosition;
};

export type RuntimeSymbolEvidence = EvidenceRef;

export type RuntimeSymbolContractDiagnostic = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  file?: string;
  range?: RuntimeSymbolRange;
  metadata?: Record<string, unknown>;
};

export type RuntimeSymbolFallback = {
  operation: RuntimeSymbolReadonlyOperation;
  reason: RuntimeSymbolFallbackReason;
  message: string;
  retryable: boolean;
  evidence: RuntimeSymbolEvidence[];
  metadata?: Record<string, unknown>;
};

export type RuntimeSymbolContractResult<T> =
  | {
      ok: true;
      operation: RuntimeSymbolReadonlyOperation;
      data: T;
      diagnostics: RuntimeSymbolContractDiagnostic[];
      fallback?: undefined;
    }
  | {
      ok: false;
      operation: RuntimeSymbolReadonlyOperation;
      data?: undefined;
      diagnostics: RuntimeSymbolContractDiagnostic[];
      fallback: RuntimeSymbolFallback;
    };

export type RuntimeSymbolNode = {
  symbolId: string;
  name: string;
  namePath: string[];
  kind: string;
  file: string;
  range: RuntimeSymbolRange;
  selectionRange?: RuntimeSymbolRange;
  bodyRange?: RuntimeSymbolRange;
  signature?: string;
  children: RuntimeSymbolNode[];
  evidence: RuntimeSymbolEvidence[];
};

export type RuntimeSymbolOverview = {
  file: string;
  symbols: RuntimeSymbolNode[];
  evidence: RuntimeSymbolEvidence[];
};

export type RuntimeSymbolFindQuery = {
  file?: string;
  name?: string;
  namePath?: string[];
  kind?: string;
};

export type RuntimeSymbolReference = {
  file: string;
  range: RuntimeSymbolRange;
  snippet?: string;
  evidence: RuntimeSymbolEvidence[];
};

export type RuntimeSymbolReferenceGroup = {
  file: string;
  references: RuntimeSymbolReference[];
};

export type RuntimeSymbolCheckpoint = {
  checkpointId: string;
  symbolId: string;
  file: string;
  namePath: string[];
  kind: string;
  range: RuntimeSymbolRange;
  selectionRange?: RuntimeSymbolRange;
  signature?: string;
  contentHash?: string;
  createdAt: number;
  evidence: RuntimeSymbolEvidence[];
};

export type RuntimeSymbolCheckpointResolution = {
  status: "matched" | "relocated" | "drifted";
  checkpoint: RuntimeSymbolCheckpoint;
  symbol?: RuntimeSymbolNode;
  fallback?: RuntimeSymbolFallback;
  diagnostics: RuntimeSymbolContractDiagnostic[];
};

export type RuntimeReadonlySymbolLspSession = {
  sessionId: string;
  documentSymbols(params: { file: string }): Promise<unknown>;
  references?(params: {
    file: string;
    position: RuntimeSymbolPosition;
    includeDeclaration?: boolean;
  }): Promise<unknown>;
  diagnostics?(params: { file?: string }): Promise<unknown>;
  dispose?: () => Promise<void>;
};

export type RuntimeLspDocumentSymbol = {
  name: string;
  kind: number | string;
  range: RuntimeSymbolRange;
  selectionRange?: RuntimeSymbolRange;
  detail?: string;
  children?: RuntimeLspDocumentSymbol[];
};

export type RuntimeLspLocation = {
  uri?: string;
  targetUri?: string;
  range?: RuntimeSymbolRange;
  targetRange?: RuntimeSymbolRange;
};

const RUNTIME_SYMBOL_OPERATION_SET = new Set<RuntimeSymbolReadonlyOperation>(
  RUNTIME_SYMBOL_READONLY_OPERATIONS,
);
const RUNTIME_SYMBOL_FALLBACK_REASON_SET = new Set<RuntimeSymbolFallbackReason>(
  RUNTIME_SYMBOL_FALLBACK_REASONS,
);

function isFinitePositionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isRuntimeSymbolPosition(value: unknown): value is RuntimeSymbolPosition {
  return (
    isRecord(value) &&
    isFinitePositionNumber(value.line) &&
    isFinitePositionNumber(value.character)
  );
}

export function isRuntimeSymbolRange(value: unknown): value is RuntimeSymbolRange {
  return isRecord(value) && isRuntimeSymbolPosition(value.start) && isRuntimeSymbolPosition(value.end);
}

export function isRuntimeSymbolReadonlyOperation(
  value: unknown,
): value is RuntimeSymbolReadonlyOperation {
  return (
    typeof value === "string" &&
    RUNTIME_SYMBOL_OPERATION_SET.has(value as RuntimeSymbolReadonlyOperation)
  );
}

export function isRuntimeSymbolFallbackReason(
  value: unknown,
): value is RuntimeSymbolFallbackReason {
  return (
    typeof value === "string" &&
    RUNTIME_SYMBOL_FALLBACK_REASON_SET.has(value as RuntimeSymbolFallbackReason)
  );
}

function isEvidenceRefShape(value: unknown): value is EvidenceRef {
  return (
    isRecord(value) &&
    isNonEmptyString(value.type) &&
    isNonEmptyString(value.ref) &&
    (value.label === undefined || typeof value.label === "string") &&
    (value.summary === undefined || typeof value.summary === "string") &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isRuntimeSymbolFallback(value: unknown): value is RuntimeSymbolFallback {
  return (
    isRecord(value) &&
    isRuntimeSymbolReadonlyOperation(value.operation) &&
    isRuntimeSymbolFallbackReason(value.reason) &&
    isNonEmptyString(value.message) &&
    typeof value.retryable === "boolean" &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isEvidenceRefShape)
  );
}

export function isRuntimeSymbolNode(value: unknown): value is RuntimeSymbolNode {
  return (
    isRecord(value) &&
    isNonEmptyString(value.symbolId) &&
    isNonEmptyString(value.name) &&
    Array.isArray(value.namePath) &&
    value.namePath.every(isNonEmptyString) &&
    isNonEmptyString(value.kind) &&
    isNonEmptyString(value.file) &&
    isRuntimeSymbolRange(value.range) &&
    (value.selectionRange === undefined || isRuntimeSymbolRange(value.selectionRange)) &&
    (value.bodyRange === undefined || isRuntimeSymbolRange(value.bodyRange)) &&
    (value.signature === undefined || typeof value.signature === "string") &&
    Array.isArray(value.children) &&
    value.children.every(isRuntimeSymbolNode) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isEvidenceRefShape)
  );
}

export function isRuntimeSymbolOverview(value: unknown): value is RuntimeSymbolOverview {
  return (
    isRecord(value) &&
    isNonEmptyString(value.file) &&
    Array.isArray(value.symbols) &&
    value.symbols.every(isRuntimeSymbolNode) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isEvidenceRefShape)
  );
}

export function isRuntimeSymbolContractDiagnostic(
  value: unknown,
): value is RuntimeSymbolContractDiagnostic {
  return (
    isRecord(value) &&
    isNonEmptyString(value.code) &&
    (value.severity === "info" || value.severity === "warning" || value.severity === "error") &&
    isNonEmptyString(value.message) &&
    (value.file === undefined || typeof value.file === "string") &&
    (value.range === undefined || isRuntimeSymbolRange(value.range))
  );
}

export function createRuntimeSymbolFallback(params: {
  operation: RuntimeSymbolReadonlyOperation;
  reason: RuntimeSymbolFallbackReason;
  message: string;
  retryable?: boolean;
  evidence?: RuntimeSymbolEvidence[];
  metadata?: Record<string, unknown>;
}): RuntimeSymbolFallback {
  return {
    operation: params.operation,
    reason: params.reason,
    message: params.message,
    retryable: params.retryable ?? false,
    evidence: params.evidence ?? [],
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

export function runtimeSymbolSuccess<T>(
  operation: RuntimeSymbolReadonlyOperation,
  data: T,
  diagnostics: RuntimeSymbolContractDiagnostic[] = [],
): RuntimeSymbolContractResult<T> {
  return { ok: true, operation, data, diagnostics };
}

export function runtimeSymbolFailure<T = never>(
  fallback: RuntimeSymbolFallback,
  diagnostics: RuntimeSymbolContractDiagnostic[] = [],
): RuntimeSymbolContractResult<T> {
  return { ok: false, operation: fallback.operation, diagnostics, fallback };
}

export function createLspUnavailableSymbolResult<T>(
  operation: RuntimeSymbolReadonlyOperation,
  message = "Language server is unavailable for this symbol request.",
): RuntimeSymbolContractResult<T> {
  return runtimeSymbolFailure<T>(
    createRuntimeSymbolFallback({
      operation,
      reason: "lsp_unavailable",
      message,
      retryable: true,
    }),
    [
      {
        code: "symbol.lsp_unavailable",
        severity: "warning",
        message,
      },
    ],
  );
}

export function buildRuntimeSymbolOverview(params: {
  file: string;
  symbols: RuntimeLspDocumentSymbol[];
  evidence?: RuntimeSymbolEvidence[];
}): RuntimeSymbolOverview {
  const evidence = params.evidence ?? [{ type: "file", ref: params.file, label: "Document symbols" }];
  const symbols = params.symbols.map((symbol, index) =>
    normalizeLspDocumentSymbol({
      symbol,
      file: params.file,
      parentPath: [],
      ordinalPath: [index + 1],
      evidence,
    }),
  );
  return { file: params.file, symbols, evidence };
}

function normalizeLspDocumentSymbol(params: {
  symbol: RuntimeLspDocumentSymbol;
  file: string;
  parentPath: string[];
  ordinalPath: number[];
  evidence: RuntimeSymbolEvidence[];
}): RuntimeSymbolNode {
  const namePath = [...params.parentPath, params.symbol.name];
  const ordinal = params.ordinalPath.join(".");
  const symbolId = `${params.file}#${namePath.join("/")}@${ordinal}`;
  const children = (params.symbol.children ?? []).map((child, index) =>
    normalizeLspDocumentSymbol({
      symbol: child,
      file: params.file,
      parentPath: namePath,
      ordinalPath: [...params.ordinalPath, index + 1],
      evidence: params.evidence,
    }),
  );
  return {
    symbolId,
    name: params.symbol.name,
    namePath,
    kind: String(params.symbol.kind),
    file: params.file,
    range: params.symbol.range,
    ...(params.symbol.selectionRange ? { selectionRange: params.symbol.selectionRange } : {}),
    bodyRange: params.symbol.range,
    ...(params.symbol.detail ? { signature: params.symbol.detail } : {}),
    children,
    evidence: params.evidence,
  };
}

export function flattenRuntimeSymbols(symbols: readonly RuntimeSymbolNode[]): RuntimeSymbolNode[] {
  const flattened: RuntimeSymbolNode[] = [];
  for (const symbol of symbols) {
    flattened.push(symbol, ...flattenRuntimeSymbols(symbol.children));
  }
  return flattened;
}

export function findRuntimeSymbols(
  overviews: readonly RuntimeSymbolOverview[],
  query: RuntimeSymbolFindQuery,
): RuntimeSymbolContractResult<RuntimeSymbolNode[]> {
  if (!query.name && (!query.namePath || query.namePath.length === 0)) {
    return runtimeSymbolFailure(
      createRuntimeSymbolFallback({
        operation: "find",
        reason: "invalid_input",
        message: "Symbol find requires name or namePath.",
      }),
    );
  }

  const candidates = overviews
    .filter((overview) => !query.file || overview.file === query.file)
    .flatMap((overview) => flattenRuntimeSymbols(overview.symbols))
    .filter((symbol) => {
      if (query.kind && symbol.kind !== query.kind) {
        return false;
      }
      if (query.namePath && query.namePath.length > 0) {
        return sameStringArray(symbol.namePath, query.namePath);
      }
      return symbol.name === query.name;
    });

  if (candidates.length === 0) {
    return runtimeSymbolFailure(
      createRuntimeSymbolFallback({
        operation: "find",
        reason: "not_found",
        message: "No symbol matched the readonly symbol query.",
        metadata: { query },
      }),
    );
  }

  if (query.name && (!query.namePath || query.namePath.length === 0) && candidates.length > 1) {
    return runtimeSymbolFailure(
      createRuntimeSymbolFallback({
        operation: "find",
        reason: "ambiguous",
        message: "Multiple symbols share that name; provide namePath or file to disambiguate.",
        metadata: {
          matches: candidates.map((symbol) => ({
            symbolId: symbol.symbolId,
            file: symbol.file,
            namePath: symbol.namePath,
            range: symbol.range,
          })),
        },
      }),
    );
  }

  return runtimeSymbolSuccess("find", candidates);
}

export function groupRuntimeSymbolReferences(params: {
  locations: RuntimeLspLocation[];
  snippets?: Record<string, string[]>;
  evidence?: RuntimeSymbolEvidence[];
}): RuntimeSymbolReferenceGroup[] {
  const evidence = params.evidence ?? [];
  const byFile = new Map<string, RuntimeSymbolReference[]>();
  for (const location of params.locations) {
    const file = normalizeFileUri(location.uri ?? location.targetUri ?? "");
    const range = location.range ?? location.targetRange;
    if (!file || !range) {
      continue;
    }
    const lines = params.snippets?.[file] ?? [];
    const lineText = lines[range.start.line]?.trim();
    const references = byFile.get(file) ?? [];
    references.push({
      file,
      range,
      ...(lineText ? { snippet: lineText } : {}),
      evidence,
    });
    byFile.set(file, references);
  }
  return Array.from(byFile.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, references]) => ({
      file,
      references: [...references].sort(compareReferenceRange),
    }));
}

export function createRuntimeSymbolCheckpoint(params: {
  symbol: RuntimeSymbolNode;
  contentHash?: string;
  createdAt?: number;
}): RuntimeSymbolCheckpoint {
  return {
    checkpointId: `${params.symbol.symbolId}:${params.contentHash ?? "nohash"}`,
    symbolId: params.symbol.symbolId,
    file: params.symbol.file,
    namePath: params.symbol.namePath,
    kind: params.symbol.kind,
    range: params.symbol.range,
    ...(params.symbol.selectionRange ? { selectionRange: params.symbol.selectionRange } : {}),
    ...(params.symbol.signature ? { signature: params.symbol.signature } : {}),
    ...(params.contentHash ? { contentHash: params.contentHash } : {}),
    createdAt: params.createdAt ?? Date.now(),
    evidence: params.symbol.evidence,
  };
}

export function resolveRuntimeSymbolCheckpoint(params: {
  checkpoint: RuntimeSymbolCheckpoint;
  overviews: readonly RuntimeSymbolOverview[];
  contentHash?: string;
}): RuntimeSymbolCheckpointResolution {
  const allSymbols = params.overviews
    .filter((overview) => overview.file === params.checkpoint.file)
    .flatMap((overview) => flattenRuntimeSymbols(overview.symbols));
  const sameIdentity = allSymbols.find(
    (symbol) =>
      sameStringArray(symbol.namePath, params.checkpoint.namePath) &&
      symbol.kind === params.checkpoint.kind,
  );

  if (!sameIdentity) {
    return driftedCheckpoint(params.checkpoint, "Checkpoint symbol could not be located.");
  }

  if (
    params.checkpoint.contentHash &&
    params.contentHash &&
    params.checkpoint.contentHash !== params.contentHash
  ) {
    return driftedCheckpoint(params.checkpoint, "Checkpoint content hash no longer matches.", sameIdentity);
  }

  const rangeMatched = sameRange(sameIdentity.range, params.checkpoint.range);
  return {
    status: rangeMatched ? "matched" : "relocated",
    checkpoint: params.checkpoint,
    symbol: sameIdentity,
    diagnostics: rangeMatched
      ? []
      : [
          {
            code: "symbol.checkpoint_relocated",
            severity: "info",
            message: "Checkpoint symbol was found at a new range.",
            file: sameIdentity.file,
            range: sameIdentity.range,
          },
        ],
  };
}

function driftedCheckpoint(
  checkpoint: RuntimeSymbolCheckpoint,
  message: string,
  symbol?: RuntimeSymbolNode,
): RuntimeSymbolCheckpointResolution {
  return {
    status: "drifted",
    checkpoint,
    ...(symbol ? { symbol } : {}),
    fallback: createRuntimeSymbolFallback({
      operation: "checkpoint",
      reason: "checkpoint_drift",
      message,
      retryable: true,
      evidence: checkpoint.evidence,
      metadata: {
        checkpointId: checkpoint.checkpointId,
        symbolId: checkpoint.symbolId,
      },
    }),
    diagnostics: [
      {
        code: "symbol.checkpoint_drift",
        severity: "warning",
        message,
        file: checkpoint.file,
        range: checkpoint.range,
      },
    ],
  };
}

function normalizeFileUri(value: string): string {
  if (!value.startsWith("file://")) {
    return value;
  }
  try {
    return decodeURIComponent(new URL(value).pathname).replace(/^\/([A-Za-z]:\/)/u, "$1");
  } catch {
    return value;
  }
}

function compareReferenceRange(left: RuntimeSymbolReference, right: RuntimeSymbolReference): number {
  return (
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character
  );
}

function sameRange(left: RuntimeSymbolRange, right: RuntimeSymbolRange): boolean {
  return (
    left.start.line === right.start.line &&
    left.start.character === right.start.character &&
    left.end.line === right.end.line &&
    left.end.character === right.end.character
  );
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
