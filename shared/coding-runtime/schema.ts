/**
 * P0: TypeBox runtime validators for the UFTK contract.
 *
 * Runtime boundaries validate untrusted / recovered records through these
 * schemas before they enter audit storage, replay, or query paths. The
 * canonical TypeScript types live in `types.ts`; compile-time equality checks
 * below fail the build if either side drifts.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import {
  CODING_RUNTIME_EVENT_TYPES,
  CODING_RUNTIME_SCHEMA_VERSION,
  type CodingAuditEvent,
  type CodingExecEvent,
  type CodingMutation,
  type CodingMutationEvent,
  type CodingRollbackEvent,
  type FileVersion,
} from './types.js';

type LiteralUnionSchema<T extends readonly string[]> = TSchema & { static: T[number] };

function literalUnion<const T extends readonly string[]>(values: T): LiteralUnionSchema<T> {
  return Type.Union(
    values.map((value) => Type.Literal(value)) as unknown as [TSchema, TSchema, ...TSchema[]],
  ) as unknown as LiteralUnionSchema<T>;
}

function hashOrNull() {
  return Type.Union([Type.String({ minLength: 1 }), Type.Null()]);
}

function nonEmptyString() {
  return Type.String({ minLength: 1 });
}

function nonNegativeNumber() {
  return Type.Number({ minimum: 0 });
}

export const CodingEventFlagsSchema = Type.Record(
  Type.String(),
  Type.Union([Type.Boolean(), Type.String()]),
);

export const FileVersionSchema = Type.Object({
  path: nonEmptyString(),
  contentHash: nonEmptyString(),
  mtimeMs: nonNegativeNumber(),
  size: nonNegativeNumber(),
}, { additionalProperties: false });

export const CodingTextEditSchema = Type.Object({
  oldText: Type.String(),
  newText: Type.String(),
  replaceAll: Type.Optional(Type.Boolean()),
  fuzzy: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const CodingWriteMutationSchema = Type.Object({
  kind: Type.Literal('write'),
  path: nonEmptyString(),
  content: Type.String(),
  baseVersion: Type.Optional(FileVersionSchema),
}, { additionalProperties: false });

export const CodingEditMutationSchema = Type.Object({
  kind: Type.Literal('edit'),
  path: nonEmptyString(),
  edits: Type.Array(CodingTextEditSchema, { minItems: 1 }),
  baseVersion: Type.Optional(FileVersionSchema),
}, { additionalProperties: false });

export const CodingApplyPatchMutationSchema = Type.Object({
  kind: Type.Literal('apply_patch'),
  input: Type.String({ minLength: 1 }),
  baseVersions: Type.Optional(Type.Array(FileVersionSchema)),
}, { additionalProperties: false });

export const CodingDeleteMutationSchema = Type.Object({
  kind: Type.Literal('delete'),
  path: nonEmptyString(),
  baseVersion: Type.Optional(FileVersionSchema),
}, { additionalProperties: false });

export const CodingMoveMutationSchema = Type.Object({
  kind: Type.Literal('move'),
  from: nonEmptyString(),
  to: nonEmptyString(),
  overwrite: Type.Optional(Type.Boolean()),
  baseVersion: Type.Optional(FileVersionSchema),
}, { additionalProperties: false });

export const CodingMutationSchema = Type.Union([
  CodingWriteMutationSchema,
  CodingEditMutationSchema,
  CodingApplyPatchMutationSchema,
  CodingDeleteMutationSchema,
  CodingMoveMutationSchema,
], { discriminator: 'kind' });

export const CodingEventBaseSchema = Type.Object({
  schemaVersion: Type.Literal(CODING_RUNTIME_SCHEMA_VERSION),
  eventId: nonEmptyString(),
  eventType: literalUnion([
    CODING_RUNTIME_EVENT_TYPES.MUTATION,
    CODING_RUNTIME_EVENT_TYPES.EXEC,
    CODING_RUNTIME_EVENT_TYPES.ROLLBACK,
  ]),
  sessionId: nonEmptyString(),
  requestId: nonEmptyString(),
  toolName: nonEmptyString(),
  timestamp: nonNegativeNumber(),
  path: nonEmptyString(),
  beforeHash: hashOrNull(),
  afterHash: hashOrNull(),
  workspaceRoot: nonEmptyString(),
  flags: Type.Optional(CodingEventFlagsSchema),
}, { additionalProperties: false });

export const CodingMutationEventSchema = Type.Composite([
  CodingEventBaseSchema,
  Type.Object({
    eventType: Type.Literal(CODING_RUNTIME_EVENT_TYPES.MUTATION),
    phase: literalUnion(['committed', 'rolled_back', 'recovery_required']),
    mutationId: nonEmptyString(),
    batchId: Type.Optional(nonEmptyString()),
    kind: literalUnion(['write', 'edit', 'apply_patch', 'delete', 'move']),
    mutation: CodingMutationSchema,
    targetPath: Type.Optional(nonEmptyString()),
    hadPrior: Type.Boolean(),
    bytesBefore: nonNegativeNumber(),
    bytesAfter: nonNegativeNumber(),
    beforeVersion: Type.Union([FileVersionSchema, Type.Null()]),
    afterVersion: Type.Union([FileVersionSchema, Type.Null()]),
    error: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
], { additionalProperties: false });

export const CodingApprovalSchema = Type.Object({
  decision: literalUnion(['allow', 'prompt', 'forbidden']),
  policyId: Type.Optional(nonEmptyString()),
  matchedPrefix: Type.Optional(Type.String()),
  reason: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const CodingFileSideEffectSchema = Type.Object({
  path: nonEmptyString(),
  status: literalUnion(['added', 'modified', 'deleted']),
  beforeHash: hashOrNull(),
  afterHash: hashOrNull(),
  beforeVersion: Type.Union([FileVersionSchema, Type.Null()]),
  afterVersion: Type.Union([FileVersionSchema, Type.Null()]),
  bytesBefore: nonNegativeNumber(),
  bytesAfter: nonNegativeNumber(),
}, { additionalProperties: false });

export const CodingExecEventSchema = Type.Composite([
  CodingEventBaseSchema,
  Type.Object({
    eventType: Type.Literal(CODING_RUNTIME_EVENT_TYPES.EXEC),
    commandId: nonEmptyString(),
    commandHash: nonEmptyString(),
    commandRedacted: nonEmptyString(),
    cwd: nonEmptyString(),
    shell: Type.Optional(nonEmptyString()),
    status: literalUnion(['succeeded', 'failed', 'timeout', 'cancelled', 'denied', 'running']),
    approval: Type.Optional(CodingApprovalSchema),
    exitCode: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    durationMs: nonNegativeNumber(),
    timeoutMs: Type.Optional(nonNegativeNumber()),
    outputTruncated: Type.Boolean(),
    sideEffects: Type.Array(CodingFileSideEffectSchema),
    error: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
], { additionalProperties: false });

export const CodingRollbackFileOutcomeSchema = Type.Object({
  path: nonEmptyString(),
  status: literalUnion(['restored', 'removed', 'restore_failed']),
  beforeHash: hashOrNull(),
  afterHash: hashOrNull(),
  beforeVersion: Type.Optional(FileVersionSchema),
  afterVersion: Type.Optional(FileVersionSchema),
  error: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const CodingRollbackEventSchema = Type.Composite([
  CodingEventBaseSchema,
  Type.Object({
    eventType: Type.Literal(CODING_RUNTIME_EVENT_TYPES.ROLLBACK),
    batchId: nonEmptyString(),
    rollbackId: nonEmptyString(),
    status: literalUnion(['rolled_back', 'recovery_required']),
    preview: Type.Boolean(),
    diff: Type.String(),
    files: Type.Array(CodingRollbackFileOutcomeSchema),
    error: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
], { additionalProperties: false });

export const CodingAuditEventSchema = Type.Union([
  CodingMutationEventSchema,
  CodingExecEventSchema,
  CodingRollbackEventSchema,
], { discriminator: 'eventType' });

export const MutationPrepareOptionsSchema = Type.Object({
  sessionId: nonEmptyString(),
  requestId: nonEmptyString(),
  workspaceRoot: nonEmptyString(),
  toolName: Type.Optional(nonEmptyString()),
  batchId: Type.Optional(nonEmptyString()),
  baseVersion: Type.Optional(FileVersionSchema),
  flags: Type.Optional(CodingEventFlagsSchema),
}, { additionalProperties: false });

export const PreparedMutationSchema = Type.Object({
  mutationId: nonEmptyString(),
  batchId: nonEmptyString(),
  sessionId: nonEmptyString(),
  requestId: nonEmptyString(),
  workspaceRoot: nonEmptyString(),
  preparedAt: nonNegativeNumber(),
  mutation: CodingMutationSchema,
  baseVersions: Type.Array(FileVersionSchema),
  status: Type.Literal('prepared'),
}, { additionalProperties: false });

export const CodingFileCommitOutcomeSchema = Type.Object({
  path: nonEmptyString(),
  targetPath: Type.Optional(nonEmptyString()),
  status: literalUnion(['committed', 'rolled_back', 'recovery_required']),
  beforeVersion: Type.Union([FileVersionSchema, Type.Null()]),
  afterVersion: Type.Union([FileVersionSchema, Type.Null()]),
  error: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const CommitResultSchema = Type.Object({
  mutationId: nonEmptyString(),
  batchId: nonEmptyString(),
  status: literalUnion(['committed', 'recovery_required']),
  files: Type.Array(CodingFileCommitOutcomeSchema),
  events: Type.Array(CodingMutationEventSchema),
  error: Type.Optional(Type.String()),
  recoveryRef: Type.Optional(nonEmptyString()),
}, { additionalProperties: false });

export const RollbackOptionsSchema = Type.Object({
  preview: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const RollbackResultSchema = Type.Object({
  batchId: nonEmptyString(),
  status: literalUnion(['rolled_back', 'recovery_required']),
  preview: Type.Boolean(),
  diff: Type.String(),
  files: Type.Array(CodingRollbackFileOutcomeSchema),
  events: Type.Array(CodingRollbackEventSchema),
  error: Type.Optional(Type.String()),
  recoveryRef: Type.Optional(nonEmptyString()),
}, { additionalProperties: false });

export const AuditQuerySchema = Type.Object({
  fromMs: Type.Optional(nonNegativeNumber()),
  toMs: Type.Optional(nonNegativeNumber()),
  toolName: Type.Optional(nonEmptyString()),
  path: Type.Optional(nonEmptyString()),
  command: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1 })),
  cursor: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const CodingAuditPageSchema = Type.Object({
  items: Type.Array(CodingAuditEventSchema),
  nextCursor: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const CodingRuntimeErrorSchema = Type.Object({
  code: literalUnion([
    'E_INVALID_MUTATION',
    'E_WORKSPACE_BOUNDARY',
    'E_CONFLICT',
    'E_BATCH_STATE',
    'E_NOT_PREPARED',
    'E_LOCK_TIMEOUT',
    'E_AUDIT_WRITE_FAILED',
    'E_ROLLBACK_FAILED',
    'E_COMMAND_FORBIDDEN',
    'E_GIT_CHECKPOINT_DISABLED',
    'E_GIT_CHECKPOINT_UNSUPPORTED',
    'E_GIT_CHECKPOINT_NOT_FOUND',
    'E_GIT_CHECKPOINT_CONFLICT',
    'E_GIT_CHECKPOINT_TIMEOUT',
    'E_GIT_CHECKPOINT_FAILED',
    'E_GIT_CHECKPOINT_RECOVERY_REQUIRED',
  ]),
  message: nonEmptyString(),
  path: Type.Optional(nonEmptyString()),
  batchId: Type.Optional(nonEmptyString()),
  baseVersion: Type.Optional(FileVersionSchema),
  currentVersion: Type.Optional(FileVersionSchema),
  diff: Type.Optional(Type.String()),
}, { additionalProperties: false });

export type FileVersionSchemaType = Static<typeof FileVersionSchema>;
export type CodingMutationSchemaType = Static<typeof CodingMutationSchema>;
export type CodingMutationEventSchemaType = Static<typeof CodingMutationEventSchema>;
export type CodingExecEventSchemaType = Static<typeof CodingExecEventSchema>;
export type CodingRollbackEventSchemaType = Static<typeof CodingRollbackEventSchema>;
export type CodingAuditEventSchemaType = Static<typeof CodingAuditEventSchema>;

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

// Keep the hand-written contract and the runtime validator as one contract.
// Mutual assignability is used instead of strict equality because TypeBox's
// `Static` can materialize equivalent intersections as anonymous object
// shapes; a drift in either direction still fails the build.
export type FileVersionSchemaMatchesType = Assert<MutuallyAssignable<FileVersion, FileVersionSchemaType>>;
export type CodingMutationSchemaMatchesType = Assert<MutuallyAssignable<CodingMutation, CodingMutationSchemaType>>;
export type CodingMutationEventSchemaMatchesType = Assert<MutuallyAssignable<CodingMutationEvent, CodingMutationEventSchemaType>>;
export type CodingExecEventSchemaMatchesType = Assert<MutuallyAssignable<CodingExecEvent, CodingExecEventSchemaType>>;
export type CodingRollbackEventSchemaMatchesType = Assert<MutuallyAssignable<CodingRollbackEvent, CodingRollbackEventSchemaType>>;
export type CodingAuditEventSchemaMatchesType = Assert<MutuallyAssignable<CodingAuditEvent, CodingAuditEventSchemaType>>;

export type CodingSchemaIssue = {
  path: string;
  message: string;
};

export type CodingSchemaValidationResult =
  | { ok: true; errors: CodingSchemaIssue[] }
  | { ok: false; errors: CodingSchemaIssue[] };

export type CodingParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: CodingSchemaIssue[] };

function collectErrors(schema: TSchema, value: unknown): CodingSchemaIssue[] {
  return [...Value.Errors(schema, value)].map((error) => ({
    path: error.path || '/',
    message: error.message,
  }));
}

export function validateCodingAuditEvent(value: unknown): CodingSchemaValidationResult {
  const errors = collectErrors(CodingAuditEventSchema, value);
  return { ok: errors.length === 0, errors };
}

export function validateCodingMutation(value: unknown): CodingSchemaValidationResult {
  const errors = collectErrors(CodingMutationSchema, value);
  return { ok: errors.length === 0, errors };
}

export function validateFileVersion(value: unknown): CodingSchemaValidationResult {
  const errors = collectErrors(FileVersionSchema, value);
  return { ok: errors.length === 0, errors };
}

export function isCodingAuditEvent(value: unknown): value is CodingAuditEvent {
  return Value.Check(CodingAuditEventSchema, value);
}

export function isCodingMutation(value: unknown): value is CodingMutation {
  return Value.Check(CodingMutationSchema, value);
}

export function isFileVersion(value: unknown): value is FileVersion {
  return Value.Check(FileVersionSchema, value);
}

export function parseCodingAuditEvent(value: unknown): CodingParseResult<CodingAuditEvent> {
  const validation = validateCodingAuditEvent(value);
  if (!validation.ok) return validation;
  return { ok: true, value: value as CodingAuditEvent };
}

export function parseCodingMutation(value: unknown): CodingParseResult<CodingMutation> {
  const validation = validateCodingMutation(value);
  if (!validation.ok) return validation;
  return { ok: true, value: value as CodingMutation };
}

export function parseFileVersion(value: unknown): CodingParseResult<FileVersion> {
  const validation = validateFileVersion(value);
  if (!validation.ok) return validation;
  return { ok: true, value: value as FileVersion };
}

function assertionError(kind: string, validation: CodingSchemaValidationResult): Error {
  const details = validation.errors
    .slice(0, 5)
    .map((issue) => `${issue.path} ${issue.message}`)
    .join('; ');
  return new Error(`Invalid ${kind}: ${details || 'unknown schema error'}`);
}

export function assertCodingAuditEvent(value: unknown): asserts value is CodingAuditEvent {
  const validation = validateCodingAuditEvent(value);
  if (!validation.ok) throw assertionError('coding audit event', validation);
}

export function assertCodingMutation(value: unknown): asserts value is CodingMutation {
  const validation = validateCodingMutation(value);
  if (!validation.ok) throw assertionError('coding mutation', validation);
}

export function assertFileVersion(value: unknown): asserts value is FileVersion {
  const validation = validateFileVersion(value);
  if (!validation.ok) throw assertionError('file version', validation);
}
