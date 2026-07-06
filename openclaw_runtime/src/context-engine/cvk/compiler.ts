import { createHash } from 'node:crypto';
import {
  type Chunk,
  type CompactView,
  type CvkChecksum,
  type CvkResourceKind,
  type ResourceId,
  type Selector,
  normalizeChecksum,
  normalizeChunk,
  normalizeCompactView,
  normalizeResourceId,
  normalizeSelector,
  stableStringifyContextRuntimeKit,
} from '../../../../shared/types/context-runtime-kit';

export type CvkToolSchemaProperty = {
  type: string | string[];
  description?: string;
  enum?: string[];
  default?: unknown;
  nullable?: boolean;
};

export type CvkToolSchema = {
  type: 'object';
  required?: string[];
  properties: Record<string, CvkToolSchemaProperty>;
};

export type CvkToolFixture = {
  name: string;
  description?: string;
  inputSchema: CvkToolSchema;
  permissions?: string[];
  sideEffects?: string[];
};

export type CvkToolsetFixtureSource = {
  kind: 'toolset';
  id: string;
  version: string;
  title: string;
  tools: CvkToolFixture[];
};

export type CvkSkillFixtureSource = {
  kind: 'skill';
  id: string;
  version: string;
  title: string;
  summary: string;
  triggers: string[];
  requiredWorkflow: string[];
  safetyRules: string[];
  examples: string[];
  source: string;
};

export type CvkProjectRuleFixtureSource = {
  kind: 'project_rule';
  id: string;
  version: string;
  title: string;
  rules: Array<{
    selector: string;
    text: string;
  }>;
};

export type CvkCompilerFixtureSource =
  | CvkToolsetFixtureSource
  | CvkSkillFixtureSource
  | CvkProjectRuleFixtureSource;

export type CvkCompilerFixtureInput = {
  sources: CvkCompilerFixtureSource[];
};

export type CvkCompiledResource = {
  resourceId: ResourceId;
  kind: CvkResourceKind;
  title: string;
  sourceChecksum: CvkChecksum;
  selectorCount: number;
};

export type CvkSelectorIndexEntry = {
  chunkId: string;
  checksum: CvkChecksum;
};

export type CvkBuildMetric = {
  covered: number;
  total: number;
  rate: number;
};

export type CvkBuildReport = {
  artifactHash: string;
  llmDependency: false;
  metrics: {
    sourceCoverage: CvkBuildMetric;
    referenceResolutionRate: CvkBuildMetric;
    artifactReproducibilityRate: CvkBuildMetric;
  };
};

export type CvkFixtureArtifact = {
  resources: CvkCompiledResource[];
  chunks: Chunk[];
  views: CompactView[];
  selectorIndex: Record<string, Record<string, CvkSelectorIndexEntry>>;
  checksums: Record<string, CvkChecksum>;
  buildReport: CvkBuildReport;
};

type CompiledSource = {
  resource: CvkCompiledResource;
  chunks: Chunk[];
  view: CompactView;
};

function checksumFor(value: unknown): CvkChecksum {
  return normalizeChecksum(`sha256:${createHash('sha256')
    .update(stableStringifyContextRuntimeKit(value))
    .digest('hex')}`);
}

function resourceIdForSource(source: CvkCompilerFixtureSource): ResourceId {
  return normalizeResourceId(`${source.kind}:${source.id}@${source.version}`);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function chunkFor(resourceId: ResourceId, selector: string, text: string, metadata?: Record<string, unknown>): Chunk {
  const normalizedSelector = normalizeSelector(selector);
  const checksum = checksumFor({ resourceId, selector: normalizedSelector, text, metadata });
  return normalizeChunk({
    resourceId,
    selector: normalizedSelector,
    checksum,
    text,
    chunkId: `${resourceId}#${normalizedSelector}`,
    tokenCount: estimateTokens(text),
    ...(metadata ? { metadata } : {}),
  });
}

function compactViewFor(params: {
  resourceId: ResourceId;
  kind: CvkResourceKind;
  title: string;
  summary: string;
  selectors: Selector[];
}): CompactView {
  const tokenEstimate = estimateTokens([
    params.title,
    params.summary,
    ...params.selectors,
  ].join('\n'));
  return normalizeCompactView({
    resourceId: params.resourceId,
    kind: params.kind,
    title: params.title,
    summary: params.summary,
    hardSelectors: params.selectors,
    mustExpandBefore: params.selectors,
    sourceSelectors: params.selectors,
    tokenEstimate,
  });
}

function hasDefault(property: CvkToolSchemaProperty): boolean {
  return Object.prototype.hasOwnProperty.call(property, 'default');
}

function isNullable(property: CvkToolSchemaProperty): boolean {
  return property.nullable === true || (Array.isArray(property.type) && property.type.includes('null'));
}

function compileToolset(source: CvkToolsetFixtureSource): CompiledSource {
  const resourceId = resourceIdForSource(source);
  const chunks: Chunk[] = [];

  for (const tool of [...source.tools].sort((left, right) => left.name.localeCompare(right.name))) {
    const required = [...(tool.inputSchema.required ?? [])].sort();
    if (required.length) {
      chunks.push(chunkFor(
        resourceId,
        `schema:tool.${tool.name}.required`,
        stableStringifyContextRuntimeKit({ tool: tool.name, required }),
        { family: 'tool_schema_required', tool: tool.name },
      ));
    }

    for (const fieldName of Object.keys(tool.inputSchema.properties).sort()) {
      const property = tool.inputSchema.properties[fieldName]!;
      chunks.push(chunkFor(
        resourceId,
        `schema:tool.${tool.name}.field.${fieldName}.type`,
        stableStringifyContextRuntimeKit({
          tool: tool.name,
          field: fieldName,
          type: property.type,
          description: property.description ?? '',
        }),
        { family: 'tool_schema_type', tool: tool.name, field: fieldName },
      ));

      if (property.enum?.length) {
        chunks.push(chunkFor(
          resourceId,
          `schema:tool.${tool.name}.field.${fieldName}.enum`,
          stableStringifyContextRuntimeKit({
            tool: tool.name,
            field: fieldName,
            enum: [...property.enum].sort(),
          }),
          { family: 'tool_schema_enum', tool: tool.name, field: fieldName },
        ));
      }

      if (hasDefault(property)) {
        chunks.push(chunkFor(
          resourceId,
          `schema:tool.${tool.name}.field.${fieldName}.default`,
          stableStringifyContextRuntimeKit({
            tool: tool.name,
            field: fieldName,
            default: property.default,
          }),
          { family: 'tool_schema_default', tool: tool.name, field: fieldName },
        ));
      }

      if (isNullable(property)) {
        chunks.push(chunkFor(
          resourceId,
          `schema:tool.${tool.name}.field.${fieldName}.nullable`,
          stableStringifyContextRuntimeKit({
            tool: tool.name,
            field: fieldName,
            nullable: true,
          }),
          { family: 'tool_schema_nullable', tool: tool.name, field: fieldName },
        ));
      }
    }

    if (tool.permissions?.length) {
      chunks.push(chunkFor(
        resourceId,
        `schema:tool.${tool.name}.permission`,
        stableStringifyContextRuntimeKit({
          tool: tool.name,
          permissions: [...tool.permissions].sort(),
        }),
        { family: 'tool_schema_permission', tool: tool.name },
      ));
    }

    if (tool.sideEffects?.length) {
      chunks.push(chunkFor(
        resourceId,
        `schema:tool.${tool.name}.side_effect`,
        stableStringifyContextRuntimeKit({
          tool: tool.name,
          sideEffects: [...tool.sideEffects].sort(),
        }),
        { family: 'tool_schema_side_effect', tool: tool.name },
      ));
    }
  }

  const selectors = chunks.map((chunk) => chunk.selector);
  return {
    resource: {
      resourceId,
      kind: 'toolset',
      title: source.title,
      sourceChecksum: checksumFor(source),
      selectorCount: selectors.length,
    },
    chunks,
    view: compactViewFor({
      resourceId,
      kind: 'toolset',
      title: source.title,
      summary: 'Navigation-only toolset schema view with selectors for required, enum, type, default, nullable, permission, and side-effect constraints.',
      selectors,
    }),
  };
}

function compileSkill(source: CvkSkillFixtureSource): CompiledSource {
  const resourceId = resourceIdForSource(source);
  const chunks = [
    chunkFor(resourceId, 'skill:summary', source.summary, { family: 'skill_summary' }),
    chunkFor(resourceId, 'skill:triggers', stableStringifyContextRuntimeKit([...source.triggers].sort()), { family: 'skill_triggers' }),
    chunkFor(resourceId, 'skill:required_workflow', stableStringifyContextRuntimeKit(source.requiredWorkflow), { family: 'skill_required_workflow' }),
    chunkFor(resourceId, 'skill:safety_rules', stableStringifyContextRuntimeKit(source.safetyRules), { family: 'skill_safety_rules' }),
    chunkFor(resourceId, 'skill:examples', stableStringifyContextRuntimeKit(source.examples), { family: 'skill_examples' }),
    chunkFor(resourceId, 'skill:source', source.source, { family: 'skill_source' }),
  ];
  const selectors = chunks.map((chunk) => chunk.selector);

  return {
    resource: {
      resourceId,
      kind: 'skill',
      title: source.title,
      sourceChecksum: checksumFor(source),
      selectorCount: selectors.length,
    },
    chunks,
    view: compactViewFor({
      resourceId,
      kind: 'skill',
      title: source.title,
      summary: 'Navigation-only skill view with selectors for summary, triggers, workflow, safety rules, examples, and full source.',
      selectors,
    }),
  };
}

function compileProjectRule(source: CvkProjectRuleFixtureSource): CompiledSource {
  const resourceId = resourceIdForSource(source);
  const chunks = [...source.rules]
    .sort((left, right) => left.selector.localeCompare(right.selector))
    .map((rule) => chunkFor(
      resourceId,
      rule.selector,
      rule.text,
      { family: 'project_rule', title: source.title },
    ));
  const selectors = chunks.map((chunk) => chunk.selector);

  return {
    resource: {
      resourceId,
      kind: 'project_rule',
      title: source.title,
      sourceChecksum: checksumFor(source),
      selectorCount: selectors.length,
    },
    chunks,
    view: compactViewFor({
      resourceId,
      kind: 'project_rule',
      title: source.title,
      summary: 'Navigation-only project rule view with selectors for exact rule text.',
      selectors,
    }),
  };
}

function compileSource(source: CvkCompilerFixtureSource): CompiledSource {
  if (source.kind === 'toolset') return compileToolset(source);
  if (source.kind === 'skill') return compileSkill(source);
  return compileProjectRule(source);
}

function buildSelectorIndex(chunks: Chunk[]): {
  selectorIndex: Record<string, Record<string, CvkSelectorIndexEntry>>;
  checksums: Record<string, CvkChecksum>;
} {
  const selectorIndex: Record<string, Record<string, CvkSelectorIndexEntry>> = {};
  const checksums: Record<string, CvkChecksum> = {};

  for (const chunk of chunks) {
    const resourceSelectors = selectorIndex[chunk.resourceId] ?? {};
    const chunkId = chunk.chunkId ?? `${chunk.resourceId}#${chunk.selector}`;
    resourceSelectors[chunk.selector] = {
      chunkId,
      checksum: chunk.checksum,
    };
    selectorIndex[chunk.resourceId] = resourceSelectors;
    checksums[chunkId] = chunk.checksum;
  }

  return { selectorIndex, checksums };
}

function metric(covered: number, total: number): CvkBuildMetric {
  return {
    covered,
    total,
    rate: total === 0 ? 1 : covered / total,
  };
}

function referenceResolutionMetric(
  views: CompactView[],
  selectorIndex: Record<string, Record<string, CvkSelectorIndexEntry>>,
): CvkBuildMetric {
  const refs = views.flatMap((view) => [
    ...view.hardSelectors,
    ...view.mustExpandBefore,
    ...view.sourceSelectors,
  ].map((selector) => ({ resourceId: view.resourceId, selector })));
  const uniqueRefs = [...new Map(refs.map((ref) => [`${ref.resourceId}\u0000${ref.selector}`, ref])).values()];
  const covered = uniqueRefs.filter((ref) => Boolean(selectorIndex[ref.resourceId]?.[ref.selector])).length;
  return metric(covered, uniqueRefs.length);
}

export function compileCvkFixtureSources(input: CvkCompilerFixtureInput): CvkFixtureArtifact {
  const compiled = input.sources
    .map((source) => compileSource(source))
    .sort((left, right) => left.resource.resourceId.localeCompare(right.resource.resourceId));
  const resources = compiled.map((item) => item.resource);
  const chunks = compiled.flatMap((item) => item.chunks)
    .sort((left, right) => `${left.resourceId}\u0000${left.selector}`.localeCompare(`${right.resourceId}\u0000${right.selector}`));
  const views = compiled.map((item) => item.view)
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  const { selectorIndex, checksums } = buildSelectorIndex(chunks);
  const coveredSourceChunks = chunks.filter((chunk) => chunk.text.trim()).length;
  const buildReportInput = {
    resources,
    chunks,
    views,
    selectorIndex,
    checksums,
    metrics: {
      sourceCoverage: metric(coveredSourceChunks, chunks.length),
      referenceResolutionRate: referenceResolutionMetric(views, selectorIndex),
      artifactReproducibilityRate: metric(1, 1),
    },
    llmDependency: false,
  };
  const artifactHash = checksumFor(buildReportInput);

  return {
    resources,
    chunks,
    views,
    selectorIndex,
    checksums,
    buildReport: {
      artifactHash,
      llmDependency: false,
      metrics: buildReportInput.metrics,
    },
  };
}
