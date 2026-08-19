// Stage 2 data-plane adapters: owner stores produce digest-only ContextRef/v1
// artifacts. These adapters compute bounded canonical ids/digests and validate
// against the frozen Stage 0 schema; they never retain payload text and never
// make admission, budget, selection, ordering, or omission decisions.
import { createHash } from 'node:crypto';

import {
  normalizeContextRef,
  type ContextRef,
  type ContextRefKind,
  type ContextRefOwner,
} from '../../../shared/types/context-control-plane/artifacts.js';
import { canonicalJsonValue } from '../agents/approval-ledger.js';

export const STAGE2_CONTEXT_REF_SCHEMA = 'ContextRef/v1' as const;
export const STAGE2_CONTEXT_REF_PRODUCER_VERSION = '1' as const;
export const STAGE2_CONTEXT_REF_RETENTION_POLICY =
  'stage2-owner-retention-policy:v1' as const;

export type Stage2ContextRefProducerId =
  | 'stage2-user-intent-adapter:v1'
  | 'stage2-task-ledger-adapter:v1'
  | 'stage2-tool-result-adapter:v1';

export type Stage2ContextRefBuildResult =
  | { ok: true; ref: ContextRef }
  | { ok: false; reason: string };

const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function digestUnknown(value: unknown): string {
  return sha256Text(canonicalJsonValue(value ?? null));
}

function actorIds(sessionKey: string, runId: string): string[] {
  return [`session:${sessionKey}`, `run:${runId}`];
}

function shortChecksum(checksum: string): string {
  return checksum.slice('sha256:'.length, 'sha256:'.length + 16);
}

function normalizeBuiltRef(input: {
  kind: ContextRefKind;
  owner: ContextRefOwner;
  refId: string;
  sourceRef: string;
  revision: string;
  contentDigest: string;
  aclScope: ContextRef['acl']['scope'];
  sessionKey: string;
  runId: string;
  producerId: Stage2ContextRefProducerId;
  observedAt: string;
  evidenceRefs?: string[];
  lifecycle?: ContextRef['lifecycle'];
}): Stage2ContextRefBuildResult {
  try {
    const ref = normalizeContextRef({
      schema: STAGE2_CONTEXT_REF_SCHEMA,
      refId: input.refId,
      kind: input.kind,
      owner: input.owner,
      sourceRef: input.sourceRef,
      revision: input.revision,
      contentDigest: input.contentDigest,
      acl: {
        scope: input.aclScope,
        allowedActors: actorIds(input.sessionKey, input.runId),
      },
      retention: {
        policyId: STAGE2_CONTEXT_REF_RETENTION_POLICY,
      },
      provenance: {
        producerId: input.producerId,
        observedAt: input.observedAt,
        evidenceRefs: input.evidenceRefs ?? [],
      },
      lifecycle: input.lifecycle ?? 'active',
    });
    return { ok: true, ref };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Transcript-owned user-intent ref. `payload` is digested exactly once and is
 * not copied, stored, or returned. sourceRef/revision are transcript-native.
 */
export function buildStage2UserIntentContextRef(input: {
  sessionKey: string;
  runId: string;
  /** Native transcript address of the user intent (session entry id). */
  entryId: string;
  payload: unknown;
  observedAt: string;
  evidenceRefs?: string[];
}): Stage2ContextRefBuildResult {
  return normalizeBuiltRef({
    kind: 'user_intent',
    owner: 'transcript',
    refId: `ctxref:transcript:${input.entryId}`,
    sourceRef: `transcript:${input.sessionKey}:${input.entryId}`,
    revision: `rev:${input.entryId}`,
    contentDigest: `sha256:${digestUnknown(input.payload)}`,
    aclScope: 'turn',
    sessionKey: input.sessionKey,
    runId: input.runId,
    producerId: 'stage2-user-intent-adapter:v1',
    observedAt: input.observedAt,
    evidenceRefs: input.evidenceRefs,
  });
}

/**
 * Task-ledger ref. The caller obtains `revision` and `contentDigest` from the
 * read-only ledger projection (readLongTaskLedgerRevision); this adapter never
 * reads or copies ledger payload itself.
 */
export function buildStage2TaskLedgerContextRef(input: {
  sessionKey: string;
  runId: string;
  taskLedgerRootId: string;
  revision: string;
  contentDigest: string;
  observedAt: string;
  evidenceRefs?: string[];
}): Stage2ContextRefBuildResult {
  if (!SHA256_DIGEST_RE.test(input.contentDigest)) {
    return { ok: false, reason: 'task-ledger contentDigest must be sha256:<64hex>' };
  }
  return normalizeBuiltRef({
    kind: 'task_ledger',
    owner: 'task_ledger',
    refId: `ctxref:task_ledger:${input.taskLedgerRootId}`,
    sourceRef: `task-ledger:${input.taskLedgerRootId}`,
    revision: input.revision,
    contentDigest: input.contentDigest,
    aclScope: 'task',
    sessionKey: input.sessionKey,
    runId: input.runId,
    producerId: 'stage2-task-ledger-adapter:v1',
    observedAt: input.observedAt,
    evidenceRefs: input.evidenceRefs,
  });
}

/**
 * Archive-owned tool-result ref. The real ArchiveHandle checksum is the content
 * digest and revision; raw tool output never enters the ref.
 */
export function buildStage2ToolResultContextRef(input: {
  sessionKey: string;
  runId: string;
  handle: { uri: string; checksum: string; byteLength: number };
  observedAt: string;
  evidenceRefs?: string[];
}): Stage2ContextRefBuildResult {
  if (!SHA256_DIGEST_RE.test(input.handle.checksum)) {
    return { ok: false, reason: 'archive handle checksum must be sha256:<64hex>' };
  }
  if (!Number.isSafeInteger(input.handle.byteLength) || input.handle.byteLength < 0) {
    return { ok: false, reason: 'archive handle byteLength must be a non-negative integer' };
  }
  return normalizeBuiltRef({
    kind: 'tool_result',
    owner: 'archive',
    refId: `ctxref:archive:${shortChecksum(input.handle.checksum)}`,
    sourceRef: input.handle.uri,
    revision: input.handle.checksum,
    contentDigest: input.handle.checksum,
    aclScope: 'turn',
    sessionKey: input.sessionKey,
    runId: input.runId,
    producerId: 'stage2-tool-result-adapter:v1',
    observedAt: input.observedAt,
    evidenceRefs: input.evidenceRefs,
  });
}
