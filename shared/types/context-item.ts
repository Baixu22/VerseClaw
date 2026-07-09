import {
  normalizeChecksum,
  normalizeResourceId,
  normalizeSelector,
  type CvkChecksum,
  type ResourceId,
  type Selector,
} from './context-runtime-kit';

type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ContextItemId = Brand<string, 'ContextItemId'>;
export type LifecycleEventId = Brand<string, 'LifecycleEventId'>;

export type ContextItemKind =
  | 'instruction'
  | 'observation'
  | 'reasoning'
  | 'user_intent'
  | 'ledger'
  | 'derived';

export type LifecycleState =
  | 'ingested'
  | 'active'
  | 'masked'
  | 'archived'
  | 'compacted'
  | 'evicted';

export type ProjectionMode =
  | 'verbatim'
  | 'masked'
  | 'summary'
  | 'index_only'
  | 'omitted';

export type SourceRefType =
  | 'transcript'
  | 'tool_call'
  | 'bootstrap_file'
  | 'system_prompt'
  | 'compaction'
  | 'compression_artifact'
  | 'resume_checkpoint'
  | 'cvk'
  | 'task_ledger'
  | 'clawgraph'
  | 'observability'
  | 'memory'
  | 'knowledge'
  | 'context_pack'
  | 'archive'
  | 'other';

export type SourceRangeRef = {
  start?: number;
  end?: number;
  startLine?: number;
  endLine?: number;
};

export type SourceRef = {
  type: SourceRefType;
  sessionId?: string;
  turnId?: string;
  entryId?: string;
  toolCallId?: string;
  path?: string;
  resourceId?: ResourceId;
  selector?: Selector;
  checksum?: CvkChecksum;
  range?: SourceRangeRef;
  ownerId?: string;
  label?: string;
};

export type ArchiveHandle = {
  uri: string;
  checksum: CvkChecksum;
  byteLength: number;
  source?: SourceRef;
  createdAt?: string;
};

export type CvkReference = {
  resourceId: ResourceId;
  selector: Selector;
  checksum?: CvkChecksum;
};

export type ProjectionSpec = {
  mode: ProjectionMode;
  tokenEstimate?: number;
  archiveHandle?: ArchiveHandle;
  cvk?: CvkReference;
  metadata?: Record<string, unknown>;
};

export type ProvenanceEvidenceRef =
  | ({
      type: 'cvk';
    } & CvkReference)
  | {
      type: Exclude<SourceRefType, 'cvk'>;
      source: SourceRef;
      checksum?: CvkChecksum;
    };

export type Provenance = {
  createdAt?: string;
  producer?: string;
  derivedFrom?: ContextItemId[];
  evidence?: ProvenanceEvidenceRef[];
  reason?: string;
};

export type LifecycleEvent = {
  id: LifecycleEventId;
  itemId: ContextItemId;
  from?: LifecycleState;
  to: LifecycleState;
  reason: string;
  occurredAt?: string;
  actor?: string;
  source?: SourceRef;
  metadata?: Record<string, unknown>;
};

export type ContextItem = {
  id: ContextItemId;
  schemaVersion: 1;
  kind: ContextItemKind;
  lifecycleState: LifecycleState;
  source: SourceRef;
  projection: ProjectionSpec;
  provenance: Provenance;
  archiveHandle?: ArchiveHandle;
  contentHash?: CvkChecksum;
  metadata?: Record<string, unknown>;
};

export type ContextStatusSnapshot = {
  schemaVersion: 1;
  generatedAt?: string;
  totalItems: number;
  countsByKind: Partial<Record<ContextItemKind, number>>;
  countsByLifecycleState: Partial<Record<LifecycleState, number>>;
  archiveAvailable: boolean;
  recoveryAvailable: boolean;
  warnings: string[];
};

export type ContextFamilyValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export class ContextFamilyValidationError extends Error {
  readonly issues: ContextFamilyValidationIssue[];

  constructor(message: string, issues: ContextFamilyValidationIssue[] = [{ code: 'invalid', message }]) {
    super(message);
    this.name = 'ContextFamilyValidationError';
    this.issues = issues;
  }
}

const CONTEXT_ITEM_ID_PATTERN = /^ctx:[A-Za-z0-9._/-]+$/;
const LIFECYCLE_EVENT_ID_PATTERN = /^evt:[A-Za-z0-9._/-]+$/;
const ARCHIVE_URI_PATTERN = /^context-archive:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const MAX_METADATA_JSON_BYTES = 4096;

const CONTEXT_ITEM_KINDS = new Set<ContextItemKind>([
  'instruction',
  'observation',
  'reasoning',
  'user_intent',
  'ledger',
  'derived',
]);

const LIFECYCLE_STATES = new Set<LifecycleState>([
  'ingested',
  'active',
  'masked',
  'archived',
  'compacted',
  'evicted',
]);

const PROJECTION_MODES = new Set<ProjectionMode>([
  'verbatim',
  'masked',
  'summary',
  'index_only',
  'omitted',
]);

const SOURCE_REF_TYPES = new Set<SourceRefType>([
  'transcript',
  'tool_call',
  'bootstrap_file',
  'system_prompt',
  'compaction',
  'compression_artifact',
  'resume_checkpoint',
  'cvk',
  'task_ledger',
  'clawgraph',
  'observability',
  'memory',
  'knowledge',
  'context_pack',
  'archive',
  'other',
]);

const ALLOWED_LIFECYCLE_TRANSITIONS: ReadonlyMap<LifecycleState, ReadonlySet<LifecycleState>> = new Map([
  ['ingested', new Set<LifecycleState>(['active', 'archived', 'evicted'])],
  ['active', new Set<LifecycleState>(['masked', 'compacted', 'archived', 'evicted'])],
  ['masked', new Set<LifecycleState>(['active', 'compacted', 'archived', 'evicted'])],
  ['archived', new Set<LifecycleState>(['active', 'masked', 'compacted', 'evicted'])],
  ['compacted', new Set<LifecycleState>(['archived', 'evicted'])],
  ['evicted', new Set<LifecycleState>([])],
]);

function validationError(message: string, code: string, path?: string): never {
  throw new ContextFamilyValidationError(message, [{ code, message, ...(path ? { path } : {}) }]);
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

function normalizeDateString(value: unknown, label: string): string | undefined {
  const text = optionalString(value, label);
  if (!text) return undefined;
  if (Number.isNaN(new Date(text).getTime())) {
    validationError(`${label} must be an ISO-compatible date string`, 'invalid_date');
  }
  return text;
}

function optionalRecord(value: unknown, label: string, maxJsonBytes = MAX_METADATA_JSON_BYTES): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, label);
  if (JSON.stringify(record).length > maxJsonBytes) {
    validationError(`${label} is too large`, 'metadata_too_large');
  }
  return record;
}

function optionalChecksum(value: unknown): CvkChecksum | undefined {
  if (value === undefined) return undefined;
  return normalizeChecksum(value);
}

function optionalSourceRangeRef(value: unknown): SourceRangeRef | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, 'Source range');
  const start = record.start === undefined ? undefined : nonNegativeInteger(record.start, 'Source range start');
  const end = record.end === undefined ? undefined : nonNegativeInteger(record.end, 'Source range end');
  const startLine = record.startLine === undefined ? undefined : nonNegativeInteger(record.startLine, 'Source range startLine');
  const endLine = record.endLine === undefined ? undefined : nonNegativeInteger(record.endLine, 'Source range endLine');
  if (start !== undefined && end !== undefined && start > end) {
    validationError('Invalid source range: start must not be after end', 'invalid_source_range');
  }
  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    validationError('Invalid source range: startLine must not be after endLine', 'invalid_source_range');
  }
  return {
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    ...(startLine !== undefined ? { startLine } : {}),
    ...(endLine !== undefined ? { endLine } : {}),
  };
}

export function normalizeContextItemId(value: unknown): ContextItemId {
  const text = nonEmptyString(value, 'Context item id');
  if (!CONTEXT_ITEM_ID_PATTERN.test(text) || text.includes('..') || text.includes('//')) {
    validationError(`Invalid context item id: ${text}`, 'invalid_context_item_id');
  }
  return text as ContextItemId;
}

export function normalizeLifecycleEventId(value: unknown): LifecycleEventId {
  const text = nonEmptyString(value, 'Lifecycle event id');
  if (!LIFECYCLE_EVENT_ID_PATTERN.test(text) || text.includes('..') || text.includes('//')) {
    validationError(`Invalid lifecycle event id: ${text}`, 'invalid_lifecycle_event_id');
  }
  return text as LifecycleEventId;
}

export function normalizeContextItemKind(value: unknown): ContextItemKind {
  if (typeof value === 'string' && CONTEXT_ITEM_KINDS.has(value as ContextItemKind)) {
    return value as ContextItemKind;
  }
  validationError('Invalid context item kind', 'invalid_context_item_kind');
}

export function normalizeLifecycleState(value: unknown): LifecycleState {
  if (typeof value === 'string' && LIFECYCLE_STATES.has(value as LifecycleState)) {
    return value as LifecycleState;
  }
  validationError('Invalid lifecycle state', 'invalid_lifecycle_state');
}

export function normalizeProjectionMode(value: unknown): ProjectionMode {
  if (typeof value === 'string' && PROJECTION_MODES.has(value as ProjectionMode)) {
    return value as ProjectionMode;
  }
  validationError('Invalid projection mode', 'invalid_projection_mode');
}

export function canTransitionLifecycle(from: LifecycleState, to: LifecycleState): boolean {
  if (from === to) return true;
  return ALLOWED_LIFECYCLE_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function normalizeSourceRef(value: unknown): SourceRef {
  const record = asRecord(value, 'Source ref');
  if (typeof record.type !== 'string' || !SOURCE_REF_TYPES.has(record.type as SourceRefType)) {
    validationError('Invalid source ref type', 'invalid_source_ref_type');
  }
  const resourceId = record.resourceId === undefined ? undefined : normalizeResourceId(record.resourceId);
  const selector = record.selector === undefined ? undefined : normalizeSelector(record.selector);
  const checksum = optionalChecksum(record.checksum);
  return {
    type: record.type as SourceRefType,
    ...(optionalString(record.sessionId, 'Source ref sessionId') ? { sessionId: optionalString(record.sessionId, 'Source ref sessionId') } : {}),
    ...(optionalString(record.turnId, 'Source ref turnId') ? { turnId: optionalString(record.turnId, 'Source ref turnId') } : {}),
    ...(optionalString(record.entryId, 'Source ref entryId') ? { entryId: optionalString(record.entryId, 'Source ref entryId') } : {}),
    ...(optionalString(record.toolCallId, 'Source ref toolCallId') ? { toolCallId: optionalString(record.toolCallId, 'Source ref toolCallId') } : {}),
    ...(optionalString(record.path, 'Source ref path') ? { path: optionalString(record.path, 'Source ref path') } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(selector ? { selector } : {}),
    ...(checksum ? { checksum } : {}),
    ...(optionalSourceRangeRef(record.range) ? { range: optionalSourceRangeRef(record.range) } : {}),
    ...(optionalString(record.ownerId, 'Source ref ownerId') ? { ownerId: optionalString(record.ownerId, 'Source ref ownerId') } : {}),
    ...(optionalString(record.label, 'Source ref label') ? { label: optionalString(record.label, 'Source ref label') } : {}),
  };
}

export function normalizeArchiveHandle(value: unknown): ArchiveHandle {
  const record = asRecord(value, 'Archive handle');
  const uri = nonEmptyString(record.uri, 'Archive handle uri');
  if (!ARCHIVE_URI_PATTERN.test(uri) || uri.includes('..')) {
    validationError(`Invalid archive handle uri: ${uri}`, 'invalid_archive_handle_uri');
  }
  return {
    uri,
    checksum: normalizeChecksum(record.checksum),
    byteLength: nonNegativeInteger(record.byteLength, 'Archive handle byteLength'),
    ...(record.source !== undefined ? { source: normalizeSourceRef(record.source) } : {}),
    ...(normalizeDateString(record.createdAt, 'Archive handle createdAt')
      ? { createdAt: normalizeDateString(record.createdAt, 'Archive handle createdAt') }
      : {}),
  };
}

export function normalizeCvkReference(value: unknown): CvkReference {
  const record = asRecord(value, 'CVK reference');
  return {
    resourceId: normalizeResourceId(record.resourceId),
    selector: normalizeSelector(record.selector),
    ...(record.checksum !== undefined ? { checksum: normalizeChecksum(record.checksum) } : {}),
  };
}

export function normalizeProjectionSpec(value: unknown): ProjectionSpec {
  const record = asRecord(value, 'Projection spec');
  const metadata = optionalRecord(record.metadata, 'Projection metadata');
  return {
    mode: normalizeProjectionMode(record.mode),
    ...(record.tokenEstimate !== undefined ? { tokenEstimate: nonNegativeInteger(record.tokenEstimate, 'Projection tokenEstimate') } : {}),
    ...(record.archiveHandle !== undefined ? { archiveHandle: normalizeArchiveHandle(record.archiveHandle) } : {}),
    ...(record.cvk !== undefined ? { cvk: normalizeCvkReference(record.cvk) } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeStringList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    validationError(`${label} must be an array`, 'invalid_array');
  }
  return [...new Set(value.map((item) => nonEmptyString(item, label)))].sort();
}

function normalizeContextItemIdList(value: unknown, label: string): ContextItemId[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    validationError(`${label} must be an array`, 'invalid_array');
  }
  return [...new Set(value.map((item) => normalizeContextItemId(item)))].sort();
}

function normalizeProvenanceEvidenceRef(value: unknown): ProvenanceEvidenceRef {
  const record = asRecord(value, 'Provenance evidence ref');
  if (record.type === 'cvk') {
    return {
      type: 'cvk',
      ...normalizeCvkReference(record),
    };
  }
  if (typeof record.type !== 'string' || !SOURCE_REF_TYPES.has(record.type as SourceRefType)) {
    validationError('Invalid provenance evidence type', 'invalid_provenance_evidence_type');
  }
  return {
    type: record.type as Exclude<SourceRefType, 'cvk'>,
    source: normalizeSourceRef(record.source),
    ...(record.checksum !== undefined ? { checksum: normalizeChecksum(record.checksum) } : {}),
  };
}

function normalizeArray<T>(value: unknown, label: string, normalize: (item: unknown) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    validationError(`${label} must be an array`, 'invalid_array');
  }
  return value.map((item) => normalize(item));
}

export function normalizeProvenance(value: unknown): Provenance {
  const record = asRecord(value, 'Provenance');
  return {
    ...(normalizeDateString(record.createdAt, 'Provenance createdAt')
      ? { createdAt: normalizeDateString(record.createdAt, 'Provenance createdAt') }
      : {}),
    ...(optionalString(record.producer, 'Provenance producer') ? { producer: optionalString(record.producer, 'Provenance producer') } : {}),
    ...(record.derivedFrom !== undefined ? { derivedFrom: normalizeContextItemIdList(record.derivedFrom, 'Provenance derivedFrom') } : {}),
    ...(record.evidence !== undefined ? { evidence: normalizeArray(record.evidence, 'Provenance evidence', normalizeProvenanceEvidenceRef) } : {}),
    ...(optionalString(record.reason, 'Provenance reason') ? { reason: optionalString(record.reason, 'Provenance reason') } : {}),
  };
}

export function normalizeLifecycleEvent(value: unknown): LifecycleEvent {
  const record = asRecord(value, 'Lifecycle event');
  const from = record.from === undefined ? undefined : normalizeLifecycleState(record.from);
  const to = normalizeLifecycleState(record.to);
  if (from && !canTransitionLifecycle(from, to)) {
    validationError(`Invalid lifecycle transition: ${from} -> ${to}`, 'invalid_lifecycle_transition');
  }
  const metadata = optionalRecord(record.metadata, 'Lifecycle event metadata');
  return {
    id: normalizeLifecycleEventId(record.id),
    itemId: normalizeContextItemId(record.itemId),
    ...(from ? { from } : {}),
    to,
    reason: nonEmptyString(record.reason, 'Lifecycle event reason'),
    ...(normalizeDateString(record.occurredAt, 'Lifecycle event occurredAt')
      ? { occurredAt: normalizeDateString(record.occurredAt, 'Lifecycle event occurredAt') }
      : {}),
    ...(optionalString(record.actor, 'Lifecycle event actor') ? { actor: optionalString(record.actor, 'Lifecycle event actor') } : {}),
    ...(record.source !== undefined ? { source: normalizeSourceRef(record.source) } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function normalizeContextItem(value: unknown): ContextItem {
  const record = asRecord(value, 'Context item');
  if (record.schemaVersion !== 1) {
    validationError('Context item schemaVersion must be 1', 'invalid_schema_version');
  }
  const metadata = optionalRecord(record.metadata, 'Context item metadata');
  return {
    id: normalizeContextItemId(record.id),
    schemaVersion: 1,
    kind: normalizeContextItemKind(record.kind),
    lifecycleState: normalizeLifecycleState(record.lifecycleState),
    source: normalizeSourceRef(record.source),
    projection: normalizeProjectionSpec(record.projection),
    provenance: normalizeProvenance(record.provenance),
    ...(record.archiveHandle !== undefined ? { archiveHandle: normalizeArchiveHandle(record.archiveHandle) } : {}),
    ...(record.contentHash !== undefined ? { contentHash: normalizeChecksum(record.contentHash) } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeCountMap<T extends string>(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<T>,
): Partial<Record<T, number>> {
  if (value === undefined) return {};
  const record = asRecord(value, label);
  return Object.keys(record).sort().reduce<Partial<Record<T, number>>>((accumulator, key) => {
    if (!allowedKeys.has(key as T)) {
      validationError(`Invalid ${label} key: ${key}`, 'invalid_count_key');
    }
    accumulator[key as T] = nonNegativeInteger(record[key], `${label} ${key}`);
    return accumulator;
  }, {});
}

export function normalizeStatusSnapshot(value: unknown): ContextStatusSnapshot {
  const record = asRecord(value, 'Context status snapshot');
  if (record.schemaVersion !== 1) {
    validationError('Context status snapshot schemaVersion must be 1', 'invalid_schema_version');
  }
  if (typeof record.archiveAvailable !== 'boolean' || typeof record.recoveryAvailable !== 'boolean') {
    validationError('Context status snapshot availability flags must be boolean', 'invalid_boolean');
  }
  return {
    schemaVersion: 1,
    ...(normalizeDateString(record.generatedAt, 'Context status snapshot generatedAt')
      ? { generatedAt: normalizeDateString(record.generatedAt, 'Context status snapshot generatedAt') }
      : {}),
    totalItems: nonNegativeInteger(record.totalItems, 'Context status snapshot totalItems'),
    countsByKind: normalizeCountMap(record.countsByKind, 'countsByKind', CONTEXT_ITEM_KINDS),
    countsByLifecycleState: normalizeCountMap(record.countsByLifecycleState, 'countsByLifecycleState', LIFECYCLE_STATES),
    archiveAvailable: record.archiveAvailable,
    recoveryAvailable: record.recoveryAvailable,
    warnings: normalizeStringList(record.warnings, 'Context status snapshot warnings'),
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

export function stableStringifyContextFamily(value: unknown): string {
  return JSON.stringify(stableValue(value));
}
