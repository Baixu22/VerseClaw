import { describe, expect, it } from 'vitest';
import {
  CLAWX_VERSESHELL_FACADE,
  VERSESHELL_DEFERRED_ALIASES,
  decodeOperationCatalogEntry,
  facadeCatalogEntries,
  validateOperationArgs,
} from '@shared/verseshell';

describe('ClawX VerseShell facade catalog', () => {
  it('keeps the exact four-operation order and canonical mapping', () => {
    expect(CLAWX_VERSESHELL_FACADE.map(({ name, canonical_op }) => [name, canonical_op])).toEqual([
      ['read_file', 'file.view'],
      ['search_content', 'repo.search'],
      ['run_command', 'exec.run'],
      ['result_query', 'result.query'],
    ]);
    expect(CLAWX_VERSESHELL_FACADE).toHaveLength(4);
  });

  it('provides concise when/not-when guidance and closed model-facing schemas', () => {
    for (const operation of CLAWX_VERSESHELL_FACADE) {
      expect(operation.when_to_use.length).toBeGreaterThan(10);
      expect(operation.when_not_to_use).toMatch(/^Do not use/u);
      expect(operation.input_schema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(() => decodeOperationCatalogEntry(facadeCatalogEntries().find((entry) => entry.mcp_name === operation.name))).not.toThrow();
    }

    const runCommand = CLAWX_VERSESHELL_FACADE[2];
    expect(Object.keys(runCommand.input_schema.properties ?? {})).toEqual(['argv', 'cwd']);
    expect(Object.keys(runCommand.input_schema.properties ?? {})).not.toContain('max_memory_mb');
    expect(Object.keys(runCommand.input_schema.properties ?? {})).not.toContain('max_processes');
    expect(Object.keys(runCommand.input_schema.properties ?? {})).not.toContain('artifact');
    expect(() => validateOperationArgs(runCommand.input_schema, { argv: ['pnpm', 'test'] })).not.toThrow();
    expect(() => validateOperationArgs(runCommand.input_schema, { argv: 'pnpm test' })).toThrow(
      /expected an array/u,
    );
  });

  it('keeps deferred aliases separate, unique, and canonical-only', () => {
    const facadeNames = new Set(CLAWX_VERSESHELL_FACADE.map((entry) => entry.name));
    const aliases = VERSESHELL_DEFERRED_ALIASES.map((entry) => entry.alias);
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(aliases.every((alias) => !facadeNames.has(alias as never))).toBe(true);
    expect(VERSESHELL_DEFERRED_ALIASES.every((entry) => entry.status === 'deferred')).toBe(true);
    expect(VERSESHELL_DEFERRED_ALIASES.map((entry) => entry.canonical_op)).not.toContain('result.query');
  });
});
