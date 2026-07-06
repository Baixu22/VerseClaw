import type {
  CompressionArtifact,
  CompressionCvkEvidenceRef,
} from '../../../packages/agent-core/src/harness/compaction/compression-artifact';
import type { Chunk } from '../../../../shared/types/context-runtime-kit';
import type { CvkFixtureArtifact } from './compiler';
import {
  resolveCvkSelector,
  type CvkSelectorResolutionFailureStatus,
} from './resolver';
import { generateCvkViews, type CvkRegistryViewEntry } from './views';

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

export type CvkRecoveryContextResult = {
  ok: boolean;
  projection: CvkRecoveryProjection;
  diagnostics: CvkRecoveryReferenceDiagnostic[];
  rollback: {
    available: true;
    strategy: 'legacy_transcript_replay';
  };
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
    rollback: {
      available: true,
      strategy: 'legacy_transcript_replay',
    },
  };
}
