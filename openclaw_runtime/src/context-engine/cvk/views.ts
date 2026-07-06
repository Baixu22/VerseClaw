import {
  type CvkChecksum,
  type CvkResourceKind,
  type ResourceId,
  type Selector,
  normalizeResourceId,
  normalizeSelector,
  stableStringifyContextRuntimeKit,
} from '../../../../shared/types/context-runtime-kit';
import type {
  CvkCompiledResource,
  CvkFixtureArtifact,
} from './compiler';

export type CvkRegistryViewEntry = {
  resourceId: ResourceId;
  kind: CvkResourceKind;
  title: string;
  purpose: string;
  triggerHints: string[];
  compactViewAvailable: boolean;
};

export type CvkRegistryView = {
  level: 0;
  navigationOnly: true;
  entries: CvkRegistryViewEntry[];
  tokenEstimate: number;
};

export type CvkHardSelectorRef = {
  resourceId: ResourceId;
  selector: Selector;
  checksum: CvkChecksum;
};

export type CvkGeneratedCompactView = {
  level: 1;
  resourceId: ResourceId;
  kind: CvkResourceKind;
  title: string;
  summary: string;
  navigationOnly: true;
  hardSelectors: Selector[];
  mustExpandBeforeCall: Selector[];
  sourceSelectors: Selector[];
  hardSelectorRefs: CvkHardSelectorRef[];
  tokenEstimate: number;
};

export type CvkRawChunkSelector = {
  level: 2;
  resourceId: ResourceId;
  selector: Selector;
  checksum: CvkChecksum;
  chunkId: string;
};

export type CvkViewProjection = {
  registryView: CvkRegistryView;
  compactViews: CvkGeneratedCompactView[];
  rawChunkSelectors: CvkRawChunkSelector[];
  tokenEstimate: number;
};

export type CvkViewGenerationOptions = {
  selectedSkillResourceIds?: string[];
  includeRawChunkSelectors?: boolean;
};

function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(stableStringifyContextRuntimeKit(value).length / 4));
}

function parseStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    return [];
  }
  return [];
}

function chunkText(artifact: CvkFixtureArtifact, resourceId: ResourceId, selector: string): string | undefined {
  return artifact.chunks.find((chunk) => chunk.resourceId === resourceId && chunk.selector === selector)?.text;
}

function registryPurpose(resource: CvkCompiledResource, artifact: CvkFixtureArtifact): string {
  if (resource.kind === 'skill') {
    return chunkText(artifact, resource.resourceId, 'skill:summary') ?? resource.title;
  }
  return resource.title;
}

function registryTriggers(resource: CvkCompiledResource, artifact: CvkFixtureArtifact): string[] {
  if (resource.kind === 'skill') {
    return parseStringArray(chunkText(artifact, resource.resourceId, 'skill:triggers')).slice(0, 8);
  }
  const selectorNames = Object.keys(artifact.selectorIndex[resource.resourceId] ?? {});
  return selectorNames.slice(0, 8);
}

function compactViewAvailable(resource: CvkCompiledResource, selectedSkillResourceIds: Set<string>): boolean {
  return resource.kind !== 'skill' || selectedSkillResourceIds.has(resource.resourceId);
}

function buildRegistryView(
  artifact: CvkFixtureArtifact,
  selectedSkillResourceIds: Set<string>,
): CvkRegistryView {
  const entries = artifact.resources.map((resource) => ({
    resourceId: resource.resourceId,
    kind: resource.kind,
    title: resource.title,
    purpose: registryPurpose(resource, artifact),
    triggerHints: registryTriggers(resource, artifact),
    compactViewAvailable: compactViewAvailable(resource, selectedSkillResourceIds),
  }));

  return {
    level: 0,
    navigationOnly: true,
    entries,
    tokenEstimate: estimateTokens(entries),
  };
}

function selectorRefs(
  artifact: CvkFixtureArtifact,
  resourceId: ResourceId,
  selectors: Selector[],
): CvkHardSelectorRef[] {
  return selectors.map((selector) => {
    const entry = artifact.selectorIndex[resourceId]?.[selector];
    if (!entry) {
      throw new Error(`Selector ${selector} is not source-backed for ${resourceId}`);
    }
    return {
      resourceId,
      selector,
      checksum: entry.checksum,
    };
  });
}

function buildCompactView(
  artifact: CvkFixtureArtifact,
  resource: CvkCompiledResource,
  selectors: Selector[],
): CvkGeneratedCompactView {
  const sourceView = artifact.views.find((view) => view.resourceId === resource.resourceId);
  const summary = sourceView?.summary ?? 'Navigation-only compact view.';
  const hardSelectorRefs = selectorRefs(artifact, resource.resourceId, selectors);
  return {
    level: 1,
    resourceId: resource.resourceId,
    kind: resource.kind,
    title: resource.title,
    summary,
    navigationOnly: true,
    hardSelectors: selectors,
    mustExpandBeforeCall: selectors,
    sourceSelectors: selectors,
    hardSelectorRefs,
    tokenEstimate: estimateTokens({
      resourceId: resource.resourceId,
      title: resource.title,
      summary,
      selectors,
      checksums: hardSelectorRefs.map((ref) => ref.checksum),
    }),
  };
}

function selectorsForCompactView(
  artifact: CvkFixtureArtifact,
  resource: CvkCompiledResource,
  selectedSkillResourceIds: Set<string>,
): Selector[] {
  if (resource.kind === 'skill') {
    return selectedSkillResourceIds.has(resource.resourceId)
      ? [normalizeSelector('skill:required_workflow')]
      : [];
  }
  return artifact.views.find((view) => view.resourceId === resource.resourceId)?.hardSelectors ?? [];
}

function buildCompactViews(
  artifact: CvkFixtureArtifact,
  selectedSkillResourceIds: Set<string>,
): CvkGeneratedCompactView[] {
  return artifact.resources.flatMap((resource) => {
    const selectors = selectorsForCompactView(artifact, resource, selectedSkillResourceIds);
    if (!selectors.length) return [];
    return [buildCompactView(artifact, resource, selectors)];
  });
}

function buildRawChunkSelectors(artifact: CvkFixtureArtifact): CvkRawChunkSelector[] {
  return artifact.chunks.map((chunk) => ({
    level: 2,
    resourceId: chunk.resourceId,
    selector: chunk.selector,
    checksum: chunk.checksum,
    chunkId: chunk.chunkId ?? `${chunk.resourceId}#${chunk.selector}`,
  }));
}

export function generateCvkViews(
  artifact: CvkFixtureArtifact,
  options: CvkViewGenerationOptions = {},
): CvkViewProjection {
  const selectedSkillResourceIds = new Set((options.selectedSkillResourceIds ?? []).map((resourceId) => (
    normalizeResourceId(resourceId)
  )));
  const registryView = buildRegistryView(artifact, selectedSkillResourceIds);
  const compactViews = buildCompactViews(artifact, selectedSkillResourceIds);
  const rawChunkSelectors = options.includeRawChunkSelectors ? buildRawChunkSelectors(artifact) : [];

  return {
    registryView,
    compactViews,
    rawChunkSelectors,
    tokenEstimate: estimateTokens({ registryView, compactViews, rawChunkSelectors }),
  };
}
