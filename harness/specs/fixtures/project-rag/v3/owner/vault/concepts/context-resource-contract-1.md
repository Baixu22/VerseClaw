---
title: shared/types/context-runtime-kit.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T04:49:07.401Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: shared/types/context-runtime-kit.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ResourceId = Brand<string, 'ResourceId'>;
export type Selector = Brand<string, 'Selector'>;
export type CvkChecksum = Brand<string, 'CvkChecksum'>;

export type CvkResourceKind =
  | 'toolset'
  | 'skill'
  | 'project_rule'
  | 'document'
  | 'codebase'
  | 'trace'
  | 'memory'
  | 'other';

export type RetrievalReason =
  | 'prefetch'
  | 'tool_call_gate'
  | 'hard_claim'
  | 'recovery'
  | 'user_requested'
  | 'model_requested';

export type VerificationGate =
  | 'selector_resolution'
  | 'checksum'
  | 'hard_claim'
  | 'tool_call'
  | 'recovery'
  | 'compression_quality'
  | 'protocol';

export type VerificationSeverity = 'info' | 'warning' | 'error' | 'blocking';

export type ContextRuntimeKitValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export class ContextRuntimeKitValidationError extends Error {
  readonly issues: ContextRuntimeKitValidationIssue[];

  constructor(message: string, issues: ContextRuntimeKitValidationIssue[] = [{ code: 'invalid', message }]) {
    super(message);
    this.name = 'ContextRuntimeKitValidationError';
    this.issues = issues;
  }
}

export type SourceRange = {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
};

export type Chunk = {
  resourceId: ResourceId;
  selector: Selector;
  checksum: CvkChecksum;
  text: string;
  chunkId?: string;
  tokenCount?: number;
  sourceRange?: SourceRange;
  metadata?: Record<string, unknown>;
};

export type CompactView = {
  resourceId: ResourceId;
  selector?: Selector;
  checksum?: CvkChecksum;
  title: string;
  kind: CvkResourceKind;
  summary: string;
  navigationOnly: true;
  hardSelectors: Selector[];
  mustExpandBefore: Selector[];
  sourceSelectors: Selector[];
  tokenEstimate: number;
  metadata?: Record<string, unknown>;
};

export type CvkEvidenceRef = {
  resourceId: ResourceId;
  selector: Selector;
  checksum?: CvkChecksum;
  label?: string;
  kind?: CvkResourceKind;
  hardClaim?: boolean;
};

export type RetrievalTraceEntry = {
  resourceId: ResourceId;
  selector: Selector;
  checksum?: CvkChecksum;
  chunkId?: string;
  tokenCount?: number;
  reason: RetrievalReason;
};

export type PromptBundleResourceMapEntry = {
  resourceId: ResourceId;
  kind: CvkResourceKind;
  title: string;
  summary?: string;
  selectors: Selector[];
};

export type PromptBundle = {
  schemaVersion: 1;
  instructionKernel?: string;
  resourceMap: PromptBundleResourceMapEntry[];
  compactViews: CompactView[];
  compactRecoveryProjection?: string;
  selectedChunks: Chunk[];
  currentTask: string;
  tokenBudget?: {
    input: number;
    outputReserve: number;
  };
  retrievalPlan: CvkEvidenceRef[];
  retrievalTrace: RetrievalTraceEntry[];
  createdAt?: string;
};

export type VerificationDiagnostic = {
  code: string;
  message: string;
  resourceId?: ResourceId;
  selector?: Selector;
  checksum?: CvkChecksum;
  evidenceRef?: CvkEvidenceRef;
};

export type VerificationResult = {
  ok: boolean;
  gate: VerificationGate;
  severity: VerificationSeverity;
  diagnostics: VerificationDiagnostic[];
  checkedAt?: string;
};

const RESOURCE_ID_PATTERN = /^(toolset|skill|project_rule|document|codebase|trace|memory|other):[a-z0-9][a-z0-9._/-]*(?:@[A-Za-z0-9._-]+)?$/;
const SELECTOR_PATTERN = /^(skill|schema|doc|code|rule|trace|memory|view):[A-Za-z0-9._/#:-]+$/;
const CHECKSUM_PATTERN = /^sha256:[0-9a-f]{64}$/;

const RESOURCE_KINDS = new Set<CvkResourceKind>([
  'toolset',
  'skill',
  'project_rule',
  'document',
  'codebase',
  'trace',
  'memory',
  'other',
]);

const RETRIEVAL_REASONS = new Set<RetrievalReason>([
  'prefetch',
  'tool_call_gate',
  'hard_claim',
  'recovery',
  'user_requested',
  'model_requested',
]);

const VERIFICATION_GATES = new Set<VerificationGate>([
  'selector_resolution',
  'checksum',
  'hard_claim',
  'tool_call',
  'recovery',
  'compression_quality',
  'protocol',
]);

const VERIFICATION_SEVERITIES = new Set<VerificationSeverity>([
  'info',
  'warning',
  'error',
  'blocking',
]);

function validationError(message: string, code: string, path?: string): never {
  throw new ContextRuntimeKitValidationError(message, [{ code, message, ...(path ? { path } : {}) }]);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    validationError(`${label} must be an object`, 'invalid_object');
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    validationError(`${label} must be a non-empty string`, 'invalid_string');
  }
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return nonEmptyString(value, label);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    validationError(`${label} must be a non-negative integer`, 'invalid_integer');
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    validationError(`${label} must be a positive integer`, 'invalid_integer');
  }
  return value as number;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return asRecord(value, label);
}

function normalizeKind(value: unknown): CvkResourceKind {
  if (value === undefined) return 'other';
  if (typeof value === 'string' && RESOURCE_KINDS.has(value as CvkResourceKind)) {
    return value as CvkResourceKind;
  }
  validationError('Invalid resource kind', 'invalid_resource_kind');
}

function normalizeDateString(value: unknown, label: string): string | undefined {
  const text = optionalString(value, label);
  if (!text) return undefined;
  if (Number.isNaN(new Date(text).getTime())) {
    validationError(`${label} must be an ISO-compatible date string`, 'invalid_date');
  }
  return text;
}

export function normalizeResourceId(value: unknown): ResourceId {
  const text = nonEmptyString(value, 'Resource id');
  if (!RESOURCE_ID_PATTERN.test(text) || text.includes('..') || text.includes('//')) {
    validationError(`Invalid resource id: ${text}`, 'invalid_resource_id');
  }
  return text as ResourceId;
}

export function normalizeSelector(value: unknown): Selector {
  const text = nonEmptyString(value, 'Selector');
  if (!SELECTOR_PATTERN.test(text) || /\s/.test(text) || text.includes('..')) {
    validationError(`Invalid selector: ${text}`, 'invalid_selector');
  }
  return text as Selector;
}

export function normalizeChecksum(value: unknown): CvkChecksum {
  const text = nonEmptyString(value, 'Checksum').toLowerCase();
  if (!CHECKSUM_PATTERN.test(text)) {
    validationError(`Invalid checksum: ${text}`, 'invalid_checksum');
  }
  return text as CvkChecksum;
}

export function normalizeSourceRange(value: unknown): SourceRange | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, 'Chunk range');
  const startLine = positiveInteger(record.startLine, 'Chunk range startLine');
  const endLine = positiveInteger(record.endLine, 'Chunk range endLine');
  const startColumn = record.startColumn === undefined
    ? undefined
    : positiveInteger(record.startColumn, 'Chunk range startColumn');
  const endColumn = record.endColumn === undefined
    ? undefined
    : positiveInteger(record.endColumn, 'Chunk range endColumn');

  if (startLine > endLine || (startLine === endLine && startColumn !== undefined && endColumn !== undefined && startColumn > endColumn)) {
    validationError('Invalid chunk range: start must not be after end', 'invalid_chunk_range');
  }

  return {
    startLine,
    endLine,
    ...(startColumn !== undefined ? { startColumn } : {}),
    ...(endColumn !== undefined ? { endColumn } : {}),
  };
}

function normalizeSelectorList(value: unknown, label: string): Selector[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    validationError(`${label} must be an array of selectors`, 'invalid_selector_list');
  }
  return [...new Set(value.map((item) => normalizeSelector(item)))].sort();
}

export function normalizeChunk(value: unknown): Chunk {
  const record = asRecord(value, 'Chunk');
  const tokenCount = record.tokenCount === undefined
    ? undefined
    : nonNegativeInteger(record.tokenCount, 'Chunk tokenCount');
  const chunkId = optionalString(record.chunkId, 'Chunk id');
  const metadata = optionalRecord(record.metadata, 'Chunk metadata');

  return {
    resourceId: normalizeResourceId(record.resourceId),
    selector: normalizeSelector(record.selector),
    checksum: normalizeChecksum(record.checksum),
    text: nonEmptyString(record.text, 'Chunk text'),
    ...(chunkId ? { chunkId } : {}),
    ...(tokenCount !== undefined ? { tokenCount } : {}),
    ...(normalizeSourceRange(record.sourceRange) ? { sourceRange: normalizeSourceRange(record.sourceRange) } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function normalizeCompactView(value: unknown): CompactView {
  const record = asRecord(value, 'Compact view');
  if (record.navigationOnly === false) {
    validationError('Compact views must be navigation-only', 'invalid_navigation_only_view');
  }
  const selector = record.selector === undefined ? undefined : normalizeSelector(record.selector);
  const checksum = record.checksum === undefined ? undefined : normalizeChecksum(record.checksum);
  const metadata = optionalRecord(record.metadata, 'Compact view metadata');

  return {
    resourceId: normalizeResourceId(record.resourceId),
    ...(selector ? { selector } : {}),
    ...(checksum ? { checksum } : {}),
    title: nonEmptyString(record.title, 'Compact view title'),
    kind: normalizeKind(record.kind),
    summary: nonEmptyString(record.summary, 'Compact view summary'),
    navigationOnly: true,
    hardSelectors: normalizeSelectorList(record.hardSelectors, 'Compact view hardSelectors'),
    mustExpandBefore: normalizeSelectorList(record.mustExpandBefore, 'Compact view mustExpandBefore'),
    sourceSelectors: normalizeSelectorList(record.sourceSelectors, 'Compact view sourceSelectors'),
    tokenEstimate: nonNegativeInteger(record.tokenEstimate, 'Compact view tokenEstimate'),
    ...(metadata ? { metadata } : {}),
  };
}

export function normalizeCvkEvidenceRef(value: unknown): CvkEvidenceRef {
  const record = asRecord(value, 'Evidence ref');
  const checksum = record.checksum === undefined ? undefined : normalizeChecksum(record.checksum);
  const hardClaim = record.hardClaim === undefined ? undefined : Boolean(record.hardClaim);
  if (hardClaim && !checksum) {
    validationError('Hard claim evidence refs require checksum', 'missing_hard_claim_checksum');
  }
  const label = optionalString(record.label, 'Evidence ref label');

  return {
    resourceId: normalizeResourceId(record.resourceId),
    selector: normalizeSelector(record.selector),
    ...(checksum ? { checksum } : {}),
    ...(label ? { label } : {}),
    ...(record.kind !== undefined ? { kind: normalizeKind(record.kind) } : {}),
    ...(hardClaim !== undefined ? { hardClaim } : {}),
  };
}

export function normalizeRetrievalTraceEntry(value: unknown): RetrievalTraceEntry {
  const record = asRecord(value, 'Retrieval trace entry');
  if (typeof record.reason !== 'string' || !RETRIEVAL_REASONS.has(record.reason as RetrievalReason)) {
    validationError('Invalid retrieval reason', 'invalid_retrieval_reason');
  }
  const checksum = record.checksum === undefined ? undefined : normalizeChecksum(record.checksum);
  const chunkId = optionalString(record.chunkId, 'Retrieval trace chunkId');
  const tokenCount = record.tokenCount === undefined
    ? undefined
    : nonNegativeInteger(record.tokenCount, 'Retrieval trace tokenCount');

  return {
    resourceId: normalizeResourceId(record.resourceId),
    selector: normalizeSelector(record.selector),
    ...(checksum ? { checksum } : {}),
    ...(chunkId ? { chunkId } : {}),
    ...(tokenCount !== undefined ? { tokenCount } : {}),
    reason: record.reason as RetrievalReason,
  };
}

function normalizeResourceMapEntry(value: unknown): PromptBundleResourceMapEntry {
  const record = asRecord(value, 'Prompt bundle resource map entry');
  const summary = optionalString(record.summary, 'Prompt bundle resource summary');

  return {
    resourceId: normalizeResourceId(record.resourceId),
    kind: normalizeKind(record.kind),
    title: nonEmptyString(record.title, 'Prompt bundle resource title'),
    ...(summary ? { summary } : {}),
    selectors: normalizeSelectorList(record.selectors, 'Prompt bundle resource selectors'),
  };
}

function normalizeArray<T>(value: unknown, label: string, normalize: (item: unknown) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    validationError(`${label} must be an array`, 'invalid_array');
  }
  return value.map((item) => normalize(item));
}

export function normalizePromptBundle(value: unknown): PromptBundle {
  const record = asRecord(value, 'Prompt bundle');
  if (record.schemaVersion !== 1) {
    validationError('Prompt bundle schemaVersion must be 1', 'invalid_schema_version');
  }

  const tokenBudgetRecord = record.tokenBudget === undefined
    ? undefined
    : asRecord(record.tokenBudget, 'Prompt bundle tokenBudget');
  const instructionKernel = optionalString(record.instructionKernel, 'Prompt bundle instructionKernel');
  const compactRecoveryProjection = optionalString(record.compactRecoveryProjection, 'Prompt bundle compactRecoveryProjection');
  const createdAt = normalizeDateString(record.createdAt, 'Prompt bundle createdAt');

  return {
    schemaVersion: 1,
    ...(instructionKernel ? { instructionKernel } : {}),
    resourceMap: normalizeArray(record.resourceMap, 'Prompt bundle resourceMap', normalizeResourceMapEntry),
    compactViews: normalizeArray(record.compactViews, 'Prompt bundle compactViews', normalizeCompactView),
    ...(compactRecoveryProjection ? { compactRecoveryProjection } : {}),
    selectedChunks: normalizeArray(record.selectedChunks, 'Prompt bundle selectedChunks', normalizeChunk),
    currentTask: nonEmptyString(record.currentTask, 'Prompt bundle currentTask'),
    ...(tokenBudgetRecord
      ? {
          tokenBudget: {
            input: nonNegativeInteger(tokenBudgetRecord.input, 'Prompt bundle tokenBudget input'),
            outputReserve: nonNegativeInteger(tokenBudgetRecord.outputReserve, 'Prompt bundle tokenBudget outputReserve'),
          },
        }
      : {}),
    retrievalPlan: normalizeArray(record.retrievalPlan, 'Prompt bundle retrievalPlan', normalizeCvkEvidenceRef),
    retrievalTrace: normalizeArray(record.retrievalTrace, 'Prompt bundle retrievalTrace', normalizeRetrievalTraceEntry),
    ...(createdAt ? { createdAt } : {}),
  };
}

function normalizeVerificationDiagnostic(value: unknown): VerificationDiagnostic {
  const record = asRecord(value, 'Verification diagnostic');
  const resourceId = record.resourceId === undefined ? undefined : normalizeResourceId(record.resourceId);
  const selector = record.selector === undefined ? undefined : normalizeSelector(record.selector);
  const checksum = record.checksum === undefined ? undefined : normalizeChecksum(record.checksum);
  const evidenceRef = record.evidenceRef === undefined ? undefined : normalizeCvkEvidenceRef(record.evidenceRef);

  return {
    code: nonEmptyString(record.code, 'Verification diagnostic code'),
    message: nonEmptyString(record.message, 'Verification diagnostic message'),
    ...(resourceId ? { resourceId } : {}),
    ...(selector ? { selector } : {}),
    ...(checksum ? { checksum } : {}),
    ...(evidenceRef ? { evidenceRef } : {}),
  };
}

export function normalizeVerificationResult(value: unknown): VerificationResult {
  const record = asRecord(value, 'Verification result');
  if (typeof record.ok !== 'boolean') {
    validationError('Verification result ok must be a boolean', 'invalid_boolean');
  }
  if (typeof record.gate !== 'string' || !VERIFICATION_GATES.has(record.gate as VerificationGate)) {
    validationError('Invalid verification gate', 'invalid_verification_gate');
  }
  const severity = record.severity === undefined ? 'error' : record.severity;
  if (typeof severity !== 'string' || !VERIFICATION_SEVERITIES.has(severity as VerificationSeverity)) {
    validationError('Invalid verification severity', 'invalid_verification_severity');
  }

  return {
    ok: record.ok,
    gate: record.gate as VerificationGate,
    severity: severity as VerificationSeverity,
    diagnostics: normalizeArray(record.diagnostics, 'Verification diagnostics', normalizeVerificationDiagnostic),
    ...(normalizeDateString(record.checkedAt, 'Verification checkedAt')
      ? { checkedAt: normalizeDateString(record.checkedAt, 'Verification checkedAt') }
      : {}),
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((accumulator, key) => {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) {
        accumulator[key] = stableValue(item);
      }
      return accumulator;
    }, {});
}

export function stableStringifyContextRuntimeKit(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

~~~
