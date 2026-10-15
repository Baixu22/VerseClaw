import type { JsonSchema, OperationCatalogEntry } from './types.js';

export interface ClawXFacadeOperation {
  name: 'read_file' | 'read_files' | 'search_content' | 'run_command' | 'result_query';
  canonical_op: 'file.view' | 'file.read_many' | 'repo.search' | 'exec.run' | 'result.query';
  when_to_use: string;
  when_not_to_use: string;
  input_schema: JsonSchema;
}

function objectSchema(
  properties: NonNullable<JsonSchema['properties']>,
  required: string[],
): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

/** Stable, deliberately small model-facing surface. Array order is API. */
export const CLAWX_VERSESHELL_FACADE = [
  {
    name: 'read_file',
    canonical_op: 'file.view',
    when_to_use: 'Read a focused window of a known text file.',
    when_not_to_use: 'Do not use for repository search or command execution.',
    input_schema: objectSchema(
      {
        path: { type: 'string', description: 'Workspace-relative file path.' },
        cursor: { type: 'integer', minimum: 1, description: 'One-based center line.' },
        window: { type: 'integer', minimum: 1, description: 'Maximum surrounding line window.' },
      },
      ['path'],
    ),
  },
  {
    name: 'read_files',
    canonical_op: 'file.read_many',
    when_to_use: 'Read a bounded line window from several known files in one call.',
    when_not_to_use: 'Do not use for repository search, or when only one file is needed.',
    input_schema: objectSchema(
      {
        paths: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: { type: 'string', description: 'Workspace-relative file path.' },
          description: 'Files to read, aligned by index with the optional per-file windows.',
        },
        windows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              start_line: { type: 'integer', minimum: 1 },
              window: { type: 'integer', minimum: 1 },
            },
          },
          description: 'Optional per-file overrides, aligned by index with paths.',
        },
        window: { type: 'integer', minimum: 1, description: 'Default surrounding line window.' },
        max_total_lines: {
          type: 'integer',
          minimum: 1,
          description: 'Budget for the whole batch; entries that no longer fit come back empty with truncated=true.',
        },
      },
      ['paths'],
    ),
  },
  {
    name: 'search_content',
    canonical_op: 'repo.search',
    when_to_use: 'Find literal text in workspace files before opening a match.',
    when_not_to_use: 'Do not use when the file and location are already known.',
    input_schema: objectSchema(
      {
        query: { type: 'string', description: 'Literal text to find.' },
        glob: { type: 'string', description: 'Optional file-name glob.' },
        context_lines: { type: 'integer', minimum: 0, description: 'Context lines around each match.' },
        max_items: { type: 'integer', minimum: 1, description: 'Maximum returned matches.' },
      },
      ['query'],
    ),
  },
  {
    name: 'run_command',
    canonical_op: 'exec.run',
    when_to_use: 'Run a non-interactive argv command such as a focused build or test.',
    when_not_to_use: 'Do not use to read files or search source content.',
    input_schema: objectSchema(
      {
        argv: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'Program and arguments without shell-string parsing.',
        },
        cwd: { type: 'string', description: 'Workspace-relative working directory.' },
      },
      ['argv'],
    ),
  },
  {
    name: 'result_query',
    canonical_op: 'result.query',
    when_to_use: 'Inspect a bounded portion of a result:// artifact returned earlier.',
    when_not_to_use: 'Do not use before an observation returns an artifact handle.',
    input_schema: objectSchema(
      {
        handle: { type: 'string', description: 'A result://sha256 artifact handle.' },
        mode: { type: 'string', enum: ['meta', 'head', 'tail', 'slice', 'grep', 'raw'] },
        lines: { type: 'integer', minimum: 1 },
        start_line: { type: 'integer', minimum: 1 },
        end_line: { type: 'integer', minimum: 1 },
        pattern: { type: 'string' },
        max_matches: { type: 'integer', minimum: 1 },
      },
      ['handle', 'mode'],
    ),
  },
] as const satisfies readonly ClawXFacadeOperation[];

/**
 * Deferred compatibility metadata. This is intentionally not part of the facade
 * catalog and does not enumerate the VerseShell DSL or complete operation set.
 */
export const VERSESHELL_DEFERRED_ALIASES = [
  { alias: 'file_view', canonical_op: 'file.view', status: 'deferred' },
  { alias: 'repo_search', canonical_op: 'repo.search', status: 'deferred' },
  { alias: 'exec_run', canonical_op: 'exec.run', status: 'deferred' },
] as const;

export function facadeCatalogEntries(): OperationCatalogEntry[] {
  return CLAWX_VERSESHELL_FACADE.map((entry) => ({
    name: entry.canonical_op,
    mcp_name: entry.name,
    description: `${entry.when_to_use} ${entry.when_not_to_use}`,
    effect:
      entry.canonical_op === 'exec.run'
        ? 'process.spawn'
        : entry.canonical_op === 'result.query'
          ? 'artifact.read'
          : entry.canonical_op === 'repo.search'
            ? 'repo.search'
            : 'fs.read',
    capability: entry.canonical_op === 'exec.run' || entry.canonical_op === 'result.query' ? 'shell.exec' : 'file.read',
    input_schema: entry.input_schema,
  }));
}
