import type {
  CompressionArtifact,
  CompressionCvkEvidenceRef,
} from '../../../packages/agent-core/src/harness/compaction/compression-artifact.js';
import type { Chunk } from '../../../../shared/types/context-runtime-kit.js';
import type { CvkFixtureArtifact } from './compiler.js';
import {
  resolveCvkSelector,
  type CvkSelectorResolutionFailureStatus,
} from './resolver.js';
import { generateCvkViews, type CvkRegistryViewEntry } from './views.js';

export type CvkRecoveryReferenceDiagnostic = {
  status: CvkSelectorResolutionFailureStatus | 'stale_reference';
  resourceId: string;
  selector: string;
  checksum?: string;
  message: string;
};

export type CvkRecoveryProjection = {
  resourceMap: CvkRegistryViewEntry[];
  requiredSelectors: CompressionCvkEvidenceRef[];
  resolvedChunks: Array<{
    resourceId: string;
    selector: string;
    checksum: string;
    chunk: Chunk;
  }>;
  unverifiedClaims: string[];
  blockers: string[];
  failedAttemptsToAvoid: string[];
  nextAction: string;
  missingReferenceDiagnostics: CvkRecoveryReferenceDiagnostic[];
  staleReferenceDiagnostics: CvkRecoveryReferenceDiagnostic[];
};

/**
 * Reason code for a rollback declaration that is explicitly *not* available.
 *
 * - `no_executor_wired`: a CVK recovery projection was built, but no runtime
 *   consumer in this repository executes a compacted-session transcript replay,
 *   so nothing can roll the projection back.
 * - `legacy_projection_retained`: this call degraded to the caller-supplied
 *   legacy projection, so no CVK projection exists to roll back in the first
 *   place.
 */
export type CvkRecoveryRollbackUnavailableReason =
  | 'no_executor_wired'
  | 'legacy_projection_retained';

/** No rollback executor exists for the CVK recovery projection. */
export type CvkRecoveryRollbackUnavailable = {
  available: false;
  strategy: 'unimplemented';
  reason: CvkRecoveryRollbackUnavailableReason;
};

/**
 * A rollback that is really available. Constructing this requires naming the
 * consumer-reachable executor that performs it, so availability cannot be
 * claimed by flipping a literal.
 */
export type CvkRecoveryRollbackAvailable = {
  available: true;
  strategy: 'legacy_transcript_replay';
  /** Identifier of the wired executor that actually performs the replay. */
  executorId: string;
};

/**
 * Honest rollback declaration for a CVK recovery result.
 *
 * `buildCvkRecoveryContext` is a report-only projection builder: it resolves
 * selector refs and emits diagnostics, and never executes a rollback. A
 * repo-wide search for `legacy_transcript_replay`, `rollback.strategy`, and
 * `rollback.available` finds no runtime consumer that executes the strategy, so
 * the only state these modules produce is `available: false`. The
 * `available: true` member is kept so a future implementation must name the
 * executor it is wired to instead of hardcoding availability.
 */
export type CvkRecoveryRollback =
  | CvkRecoveryRollbackUnavailable
  | CvkRecoveryRollbackAvailable;

/**
 * Build the honest "no rollback executor" declaration. Typed so that
 * availability cannot be flipped back to a hardcoded `true`.
 */
export function unavailableCvkRecoveryRollback(
  reason: CvkRecoveryRollbackUnavailableReason,
): CvkRecoveryRollbackUnavailable {
  return {
    available: false,
    strategy: 'unimplemented',
    reason,
  };
}

export type CvkRecoveryContextResult = {
  ok: boolean;
  projection: CvkRecoveryProjection;
  diagnostics: CvkRecoveryReferenceDiagnostic[];
  rollback: CvkRecoveryRollback;
};

export type CvkRecoveryContextInput = {
  compressionArtifact: CompressionArtifact;
  cvkArtifact: CvkFixtureArtifact;
};

function sameRef(left: CompressionCvkEvidenceRef, right: CompressionCvkEvidenceRef): boolean {
  return left.resourceId === right.resourceId && left.selector === right.selector;
}

function diagnosticFromRef(
  status: CvkRecoveryReferenceDiagnostic['status'],
  ref: CompressionCvkEvidenceRef,
  message: string,
): CvkRecoveryReferenceDiagnostic {
  return {
    status,
    resourceId: ref.resourceId,
    selector: ref.selector,
    ...(ref.checksum ? { checksum: ref.checksum } : {}),
    message,
  };
}

function staleDiagnostics(artifact: CompressionArtifact): CvkRecoveryReferenceDiagnostic[] {
  return (artifact.staleReferences ?? []).map((ref) => diagnosticFromRef(
    'stale_reference',
    ref,
    'Recovery reference is stale and must be revalidated before trust.',
  ));
}

function resolveRequiredSelectors(
  compressionArtifact: CompressionArtifact,
  cvkArtifact: CvkFixtureArtifact,
): {
  resolvedChunks: CvkRecoveryProjection['resolvedChunks'];
  missingReferenceDiagnostics: CvkRecoveryReferenceDiagnostic[];
} {
  const staleRefs = compressionArtifact.staleReferences ?? [];
  const resolvedChunks: CvkRecoveryProjection['resolvedChunks'] = [];
  const missingReferenceDiagnostics: CvkRecoveryReferenceDiagnostic[] = [];

  for (const ref of compressionArtifact.requiredSelectors ?? []) {
    if (staleRefs.some((staleRef) => sameRef(staleRef, ref))) {
      continue;
    }
    const result = resolveCvkSelector(cvkArtifact, {
      resourceId: ref.resourceId,
      selector: ref.selector,
      ...(ref.checksum ? { checksum: ref.checksum } : {}),
      hardClaim: true,
    });
    if (result.ok) {
      resolvedChunks.push({
        resourceId: result.ref.resourceId,
        selector: result.ref.selector,
        checksum: result.chunk.checksum,
        chunk: result.chunk,
      });
    } else {
      missingReferenceDiagnostics.push({
        status: result.status,
        resourceId: ref.resourceId,
        selector: ref.selector,
        ...(ref.checksum ? { checksum: ref.checksum } : {}),
        message: result.diagnostic.message,
      });
    }
  }

  return { resolvedChunks, missingReferenceDiagnostics };
}

/**
 * Build a report-only recovery projection from a `CompressionArtifact` plus CVK
 * selector resolution. It never executes a rollback, so the returned
 * `rollback` declaration is always `available: false`.
 */
export function buildCvkRecoveryContext(input: CvkRecoveryContextInput): CvkRecoveryContextResult {
  const resourceMap = generateCvkViews(input.cvkArtifact).registryView.entries;
  const staleReferenceDiagnostics = staleDiagnostics(input.compressionArtifact);
  const { resolvedChunks, missingReferenceDiagnostics } = resolveRequiredSelectors(
    input.compressionArtifact,
    input.cvkArtifact,
  );
  const projection: CvkRecoveryProjection = {
    resourceMap,
    requiredSelectors: input.compressionArtifact.requiredSelectors ?? [],
    resolvedChunks,
    unverifiedClaims: input.compressionArtifact.unverifiedClaims,
    blockers: input.compressionArtifact.blocked.map((item) => item.text),
    failedAttemptsToAvoid: input.compressionArtifact.failedAttempts.map((item) => item.text),
    nextAction: input.compressionArtifact.nextAction,
    missingReferenceDiagnostics,
    staleReferenceDiagnostics,
  };
  const diagnostics = [
    ...missingReferenceDiagnostics,
    ...staleReferenceDiagnostics,
  ];

  return {
    ok: diagnostics.length === 0,
    projection,
    diagnostics,
    rollback: unavailableCvkRecoveryRollback('no_executor_wired'),
  };
}
