import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileCvkFixtureSources,
  type CvkCompilerFixtureInput,
  type CvkFixtureArtifact,
} from '../../openclaw_runtime/src/context-engine/cvk/compiler';
import { verifyCvkToolCallSelectors } from '../../openclaw_runtime/src/context-engine/cvk/tool-call-gate';

function loadArtifact(): CvkFixtureArtifact {
  const fixturePath = join(process.cwd(), 'tests/fixtures/context-runtime-kit/compiler.fixture.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as CvkCompilerFixtureInput;
  return compileCvkFixtureSources(fixture);
}

const TOOL_RESOURCE_ID = 'toolset:local.shell@v1';
const TOOL_NAME = 'run_shell';
const REQUIRED_SELECTORS = [
  'schema:tool.run_shell.required',
  'schema:tool.run_shell.field.mode.enum',
  'schema:tool.run_shell.field.command.type',
  'schema:tool.run_shell.field.cwd.type',
  'schema:tool.run_shell.field.mode.type',
  'schema:tool.run_shell.field.cwd.default',
  'schema:tool.run_shell.field.mode.default',
  'schema:tool.run_shell.field.cwd.nullable',
  'schema:tool.run_shell.permission',
  'schema:tool.run_shell.side_effect',
];

describe('Context Runtime Kit report-only tool call gate', () => {
  it.each([
    ['required', 'schema:tool.run_shell.required'],
    ['enum', 'schema:tool.run_shell.field.mode.enum'],
    ['type', 'schema:tool.run_shell.field.command.type'],
    ['default', 'schema:tool.run_shell.field.cwd.default'],
    ['nullable', 'schema:tool.run_shell.field.cwd.nullable'],
    ['permission', 'schema:tool.run_shell.permission'],
    ['side_effect', 'schema:tool.run_shell.side_effect'],
  ])('reports missing %s selectors as would-block diagnostics', (family, missingSelector) => {
    const artifact = loadArtifact();
    const result = verifyCvkToolCallSelectors({
      artifact,
      mode: 'report_only',
      resourceId: TOOL_RESOURCE_ID,
      toolName: TOOL_NAME,
      retrievedSelectors: REQUIRED_SELECTORS.filter((selector) => selector !== missingSelector),
    });

    expect(result.mode).toBe('report_only');
    expect(result.ok).toBe(false);
    expect(result.wouldBlock).toBe(true);
    expect(result.missingSelectors).toEqual([
      expect.objectContaining({ family, selector: missingSelector }),
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'missing_tool_selector',
        severity: 'would_block',
        selector: missingSelector,
        family,
      }),
    ]);
  });

  it('passes in report-only mode when all required selectors are present', () => {
    const result = verifyCvkToolCallSelectors({
      artifact: loadArtifact(),
      mode: 'report_only',
      resourceId: TOOL_RESOURCE_ID,
      toolName: TOOL_NAME,
      retrievedSelectors: REQUIRED_SELECTORS,
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'report_only',
      wouldBlock: false,
      missingSelectors: [],
      diagnostics: [],
    });
  });

  it('returns missing selectors in deterministic family order', () => {
    const result = verifyCvkToolCallSelectors({
      artifact: loadArtifact(),
      mode: 'report_only',
      resourceId: TOOL_RESOURCE_ID,
      toolName: TOOL_NAME,
      retrievedSelectors: [],
    });

    expect(result.missingSelectors.map((item) => item.selector)).toEqual(REQUIRED_SELECTORS);
    expect(result.missingSelectors.map((item) => item.family)).toEqual([
      'required',
      'enum',
      'type',
      'type',
      'type',
      'default',
      'default',
      'nullable',
      'permission',
      'side_effect',
    ]);
  });
});
