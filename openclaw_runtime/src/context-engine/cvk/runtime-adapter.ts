import type {
  ContextEngineProjectContextFile,
  ContextEngineSkillMetadata,
  ContextEngineToolMetadata,
} from '../types.js';
import type {
  CvkCompilerFixtureInput,
  CvkProjectRuleFixtureSource,
  CvkSkillFixtureSource,
  CvkToolFixture,
  CvkToolSchemaProperty,
} from './compiler.js';

export type CvkRuntimeAdapterInput = {
  activeTools?: ContextEngineToolMetadata[];
  projectContextFiles?: ContextEngineProjectContextFile[];
  skillsMetadata?: ContextEngineSkillMetadata[];
};

type JsonSchemaRecord = Record<string, unknown>;

function stableStrings(values: readonly unknown[] | undefined): string[] {
  if (!values) {
    return [];
  }
  return [...new Set(values.filter((value): value is string => (
    typeof value === 'string' && value.trim().length > 0
  )).map((value) => value.trim()))].sort();
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized || fallback;
}

function asRecord(value: unknown): JsonSchemaRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonSchemaRecord
    : undefined;
}

function schemaProperties(schema: unknown): Record<string, JsonSchemaRecord> {
  const record = asRecord(schema);
  const properties = asRecord(record?.properties);
  if (!properties) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(properties)
      .filter((entry): entry is [string, JsonSchemaRecord] => Boolean(asRecord(entry[1])))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function schemaRequired(schema: unknown): string[] {
  const record = asRecord(schema);
  return stableStrings(Array.isArray(record?.required) ? record.required : undefined);
}

function normalizePropertyType(property: JsonSchemaRecord): string | string[] {
  if (typeof property.type === 'string' && property.type.trim()) {
    return property.type.trim();
  }
  if (Array.isArray(property.type)) {
    return stableStrings(property.type);
  }
  if (Array.isArray(property.enum) && property.enum.every((item) => typeof item === 'string')) {
    return 'string';
  }
  return 'object';
}

function normalizeToolSchemaProperty(property: JsonSchemaRecord): CvkToolSchemaProperty {
  const normalized: CvkToolSchemaProperty = {
    type: normalizePropertyType(property),
  };
  if (typeof property.description === 'string' && property.description.trim()) {
    normalized.description = property.description.trim();
  }
  if (Array.isArray(property.enum)) {
    const enumValues = stableStrings(property.enum);
    if (enumValues.length > 0) {
      normalized.enum = enumValues;
    }
  }
  if (Object.hasOwn(property, 'default')) {
    normalized.default = property.default;
  }
  if (property.nullable === true || (
    Array.isArray(normalized.type) && normalized.type.includes('null')
  )) {
    normalized.nullable = true;
  }
  return normalized;
}

function toolFixture(tool: ContextEngineToolMetadata): CvkToolFixture {
  const properties = schemaProperties(tool.parameters);
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: {
      type: 'object',
      required: schemaRequired(tool.parameters),
      properties: Object.fromEntries(
        Object.entries(properties).map(([name, property]) => [
          name,
          normalizeToolSchemaProperty(property),
        ]),
      ),
    },
    ...(stableStrings(tool.permissions).length
      ? { permissions: stableStrings(tool.permissions) }
      : {}),
    ...(stableStrings(tool.sideEffects).length
      ? { sideEffects: stableStrings(tool.sideEffects) }
      : {}),
  };
}

function buildToolsetSource(activeTools: ContextEngineToolMetadata[]): CvkCompilerFixtureInput['sources'] {
  const tools = activeTools
    .filter((tool) => typeof tool.name === 'string' && tool.name.trim())
    .map((tool) => toolFixture({ ...tool, name: tool.name.trim() }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (tools.length === 0) {
    return [];
  }
  return [{
    kind: 'toolset',
    id: 'runtime-tools',
    version: 'active',
    title: 'Runtime Active Tools',
    tools,
  }];
}

function projectRuleSource(file: ContextEngineProjectContextFile): CvkProjectRuleFixtureSource {
  const id = slug(file.path || file.title || 'context-file', 'context-file');
  const lines = file.content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const rules = (lines.length > 0 ? lines : [`Context file ${file.path} was selected.`])
    .map((text, index) => ({
      selector: `rule:context_file.${id}.line-${index + 1}`,
      text,
    }));
  return {
    kind: 'project_rule',
    id,
    version: 'active',
    title: file.title?.trim() || file.path,
    rules,
  };
}

function buildProjectRuleSources(
  projectContextFiles: ContextEngineProjectContextFile[],
): CvkProjectRuleFixtureSource[] {
  return projectContextFiles
    .filter((file) => typeof file.path === 'string' && file.path.trim())
    .map((file) => projectRuleSource({
      ...file,
      path: file.path.trim(),
      content: typeof file.content === 'string' ? file.content : '',
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function skillSource(skill: ContextEngineSkillMetadata): CvkSkillFixtureSource {
  const title = skill.title?.trim() || skill.name?.trim() || skill.id?.trim() || 'Runtime Skill';
  const id = slug(skill.id?.trim() || skill.name?.trim() || title, 'runtime-skill');
  const summary = skill.summary?.trim() || skill.description?.trim() || title;
  return {
    kind: 'skill',
    id,
    version: skill.version?.trim() || 'active',
    title,
    summary,
    triggers: stableStrings(skill.triggers),
    requiredWorkflow: stableStrings(skill.requiredWorkflow),
    safetyRules: stableStrings(skill.safetyRules),
    examples: stableStrings(skill.examples),
    source: skill.source?.trim() || skill.content?.trim() || summary,
  };
}

function buildSkillSources(skillsMetadata: ContextEngineSkillMetadata[]): CvkSkillFixtureSource[] {
  return skillsMetadata
    .filter((skill) => Boolean(skill.id || skill.name || skill.title))
    .map(skillSource)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function buildCvkCompilerInputFromRuntimeContext(
  input: CvkRuntimeAdapterInput,
): CvkCompilerFixtureInput {
  return {
    sources: [
      ...buildProjectRuleSources(input.projectContextFiles ?? []),
      ...buildSkillSources(input.skillsMetadata ?? []),
      ...buildToolsetSource(input.activeTools ?? []),
    ],
  };
}
