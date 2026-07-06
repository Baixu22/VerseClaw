import {
  type Chunk,
  type CvkChecksum,
  type ResourceId,
  type Selector,
  normalizeChecksum,
  normalizeResourceId,
  normalizeSelector,
} from '../../../../shared/types/context-runtime-kit';
import type {
  CvkCompiledResource,
  CvkFixtureArtifact,
} from './compiler';

export type CvkSelectorRef = {
  resourceId: string;
  selector: string;
  checksum?: string;
  sourceChecksum?: string;
  hardClaim?: boolean;
};

export type CvkSelectorResolutionFailureStatus =
  | 'invalid_ref'
  | 'missing_selector'
  | 'stale_selector'
  | 'ambiguous_selector'
  | 'wrong_resource'
  | 'checksum_mismatch'
  | 'hard_claim_missing_checksum';

export type CvkSelectorResolutionDiagnostic = {
  code: CvkSelectorResolutionFailureStatus;
  message: string;
  resourceId?: string;
  selector?: string;
  checksum?: string;
  expectedChecksum?: string;
  actualChecksum?: string;
};

export type CvkSelectorResolutionSuccess = {
  ok: true;
  ref: {
    resourceId: ResourceId;
    selector: Selector;
    checksum?: CvkChecksum;
    sourceChecksum?: CvkChecksum;
    hardClaim?: boolean;
  };
  chunk: Chunk;
  resource: CvkCompiledResource;
};

export type CvkSelectorResolutionFailure = {
  ok: false;
  status: CvkSelectorResolutionFailureStatus;
  ref: CvkSelectorRef;
  diagnostic: CvkSelectorResolutionDiagnostic;
};

export type CvkSelectorResolutionResult =
  | CvkSelectorResolutionSuccess
  | CvkSelectorResolutionFailure;

function failure(
  status: CvkSelectorResolutionFailureStatus,
  ref: CvkSelectorRef,
  message: string,
  details: Partial<CvkSelectorResolutionDiagnostic> = {},
): CvkSelectorResolutionFailure {
  return {
    ok: false,
    status,
    ref,
    diagnostic: {
      code: status,
      message,
      resourceId: ref.resourceId,
      selector: ref.selector,
      ...(ref.checksum ? { checksum: ref.checksum } : {}),
      ...details,
    },
  };
}

function normalizeRef(ref: CvkSelectorRef): CvkSelectorResolutionSuccess['ref'] {
  return {
    resourceId: normalizeResourceId(ref.resourceId),
    selector: normalizeSelector(ref.selector),
    ...(ref.checksum ? { checksum: normalizeChecksum(ref.checksum) } : {}),
    ...(ref.sourceChecksum ? { sourceChecksum: normalizeChecksum(ref.sourceChecksum) } : {}),
    ...(ref.hardClaim !== undefined ? { hardClaim: Boolean(ref.hardClaim) } : {}),
  };
}

function findResource(artifact: CvkFixtureArtifact, resourceId: ResourceId): CvkCompiledResource | undefined {
  return artifact.resources.find((resource) => resource.resourceId === resourceId);
}

function findSelectorMatches(artifact: CvkFixtureArtifact, resourceId: ResourceId, selector: Selector): Chunk[] {
  return artifact.chunks.filter((chunk) => chunk.resourceId === resourceId && chunk.selector === selector);
}

function selectorExistsElsewhere(artifact: CvkFixtureArtifact, resourceId: ResourceId, selector: Selector): boolean {
  return artifact.chunks.some((chunk) => chunk.selector === selector && chunk.resourceId !== resourceId);
}

export function resolveCvkSelector(
  artifact: CvkFixtureArtifact,
  ref: CvkSelectorRef,
): CvkSelectorResolutionResult {
  let normalized: CvkSelectorResolutionSuccess['ref'];
  try {
    normalized = normalizeRef(ref);
  } catch (error) {
    return failure(
      'invalid_ref',
      ref,
      error instanceof Error ? error.message : 'Invalid selector reference.',
    );
  }

  if (normalized.hardClaim && !normalized.checksum) {
    return failure(
      'hard_claim_missing_checksum',
      normalized,
      'Hard claim selector references must include a checksum.',
    );
  }

  const resource = findResource(artifact, normalized.resourceId);
  if (!resource) {
    return failure(
      selectorExistsElsewhere(artifact, normalized.resourceId, normalized.selector)
        ? 'wrong_resource'
        : 'missing_selector',
      normalized,
      selectorExistsElsewhere(artifact, normalized.resourceId, normalized.selector)
        ? 'Selector exists, but not under the requested resource id.'
        : 'Selector could not be resolved because the resource id was not found.',
    );
  }

  if (normalized.sourceChecksum && normalized.sourceChecksum !== resource.sourceChecksum) {
    return failure(
      'stale_selector',
      normalized,
      'Selector reference was built against a stale resource checksum.',
      {
        expectedChecksum: normalized.sourceChecksum,
        actualChecksum: resource.sourceChecksum,
      },
    );
  }

  const matches = findSelectorMatches(artifact, normalized.resourceId, normalized.selector);
  if (matches.length > 1) {
    return failure(
      'ambiguous_selector',
      normalized,
      'Selector resolved to multiple chunks for the same resource.',
    );
  }

  if (matches.length === 0) {
    return failure(
      selectorExistsElsewhere(artifact, normalized.resourceId, normalized.selector)
        ? 'wrong_resource'
        : 'missing_selector',
      normalized,
      selectorExistsElsewhere(artifact, normalized.resourceId, normalized.selector)
        ? 'Selector exists, but not under the requested resource id.'
        : 'Selector could not be resolved for the requested resource.',
    );
  }

  const chunk = matches[0]!;
  if (normalized.checksum && normalized.checksum !== chunk.checksum) {
    return failure(
      'checksum_mismatch',
      normalized,
      'Selector checksum does not match the resolved chunk.',
      {
        expectedChecksum: normalized.checksum,
        actualChecksum: chunk.checksum,
      },
    );
  }

  return {
    ok: true,
    ref: normalized,
    chunk,
    resource,
  };
}

export function resolveCvkSelectorBatch(
  artifact: CvkFixtureArtifact,
  refs: CvkSelectorRef[],
): CvkSelectorResolutionResult[] {
  return refs.map((ref) => resolveCvkSelector(artifact, ref));
}
